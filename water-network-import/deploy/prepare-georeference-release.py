#!/usr/bin/env python3
"""Prepare/verify narrow georeference DEV image patches; never deploys or changes IAM."""
import argparse
import copy
import hashlib
import json
from pathlib import Path
import re
import shlex
import subprocess

NAMESPACE = 'platform-core'
BASE = 'registry-dev.dichvunuoc.vn/water-platform/'
TARGETS = {
    'fe': ('water-network-gis-shw', 'water-network-gis', 'water-network-gis',
           '4bf641b1f3ac97848ad6e97d1a49d033ec019f32d4778b0e885bbc3b40db15d8', 2),
    'worker': ('water-network-import', 'import', 'water-network-import',
               '82e3007071a7b6a9913b311cb64163a962b3bbcb42897aa0b4d7c3e6a3b97fc6', 1),
}
PRESERVED = [('configmap', 'water-network-gis-shw'), ('configmap', 'water-network-import-config'),
             ('deployment', 'water-network-gis'), ('configmap', 'water-network-gis-config'),
             ('service', 'water-network-gis'), ('ingress', 'water-network-gis')]


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':')).encode()


def digest(value):
    return hashlib.sha256(canonical(value)).hexdigest()


def save(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')
    path.chmod(0o600)


def content(resource):
    return {key: resource[key] for key in ('spec', 'data', 'binaryData', 'immutable') if key in resource}


def prepare(deployment, target, image, revision, source_hash):
    name, container_name, repository, old_digest, _ = TARGETS[target]
    if deployment['metadata']['name'] != name or deployment['metadata']['namespace'] != NAMESPACE:
        raise ValueError('Unexpected deployment identity')
    if not re.fullmatch(re.escape(BASE + repository) + r'@sha256:[a-f0-9]{64}', image):
        raise ValueError('Require the exact expected image repository and immutable digest')
    if not re.fullmatch(r'[a-f0-9]{40}', revision) or not re.fullmatch(r'[a-f0-9]{64}', source_hash):
        raise ValueError('Require a verified clean source commit and snapshot hash')
    containers = deployment['spec']['template']['spec']['containers']
    matches = [(i, c) for i, c in enumerate(containers) if c['name'] == container_name]
    if len(matches) != 1:
        raise ValueError('Named container is missing or ambiguous')
    index, container = matches[0]
    old_image = BASE + repository + '@sha256:' + old_digest
    if container['image'] != old_image or image == old_image:
        raise ValueError('Running image differs from reviewed baseline or candidate has no change')
    provenance = {
        'water-platform.io/release-kind': 'manual-staging',
        'water-platform.io/build-id': 'shw-georeference-' + revision[:12],
        'water-platform.io/base-git-sha': revision,
        'water-platform.io/source-sha256': source_hash,
        'water-platform.io/source-state': 'clean',
    }
    path = f'/spec/template/spec/containers/{index}'
    patch = [
        {'op': 'test', 'path': '/metadata/resourceVersion', 'value': deployment['metadata']['resourceVersion']},
        {'op': 'test', 'path': path + '/name', 'value': container_name},
        {'op': 'test', 'path': path + '/image', 'value': old_image},
        {'op': 'replace', 'path': path + '/image', 'value': image},
    ]
    expected = copy.deepcopy(deployment['spec'])
    expected['template']['spec']['containers'][index]['image'] = image
    for metadata, location in [(deployment['metadata'], '/metadata/annotations'),
                               (deployment['spec']['template']['metadata'], '/spec/template/metadata/annotations')]:
        patch.append({'op': 'add', 'path': location, 'value': {**metadata.get('annotations', {}), **provenance}})
    expected['template']['metadata']['annotations'] = patch[-1]['value']
    summary = {'target': target, 'deployment': name, 'previousImage': old_image, 'image': image,
               'sourceRevision': revision, 'sourceSha256': source_hash, 'sourceState': 'clean',
               'provenance': provenance, 'configOrIamChanges': False, 'applied': False}
    return patch, expected, summary


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--target', choices=TARGETS, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--image')
    parser.add_argument('--source-git-sha')
    parser.add_argument('--source-sha256')
    parser.add_argument('--verify', action='store_true')
    args = parser.parse_args()

    def kube(arguments, body=None):
        return subprocess.check_output(['ssh', 'tino-32', shlex.join(
            ['sudo', 'kubectl', '-n', NAMESPACE] + arguments)], input=body, stderr=subprocess.PIPE)

    def read(kind, name):
        return json.loads(kube(['get', kind, name, '-o', 'json']))

    def preserved_hashes():
        return {kind + '/' + name: digest(content(read(kind, name))) for kind, name in PRESERVED}

    def job_receipt():
        # SELECT-only connection; no service constructors, recovery, review or other mutations.
        script = '''import sqlite3,json,hashlib,pathlib
id='8aa0a8c0-a4d8-4d8a-a217-790534afa232';tenant='tnt_shw'
db=sqlite3.connect('file:/data/imports.sqlite3?mode=ro',uri=True)
row=db.execute('SELECT body FROM jobs WHERE tenant=? AND id=?',(tenant,id)).fetchone()
assert row is not None
body=row[0];j=json.loads(body);root=pathlib.Path('/data/jobs')/hashlib.sha256(tenant.encode()).hexdigest()/id
files={str(p.relative_to(root)):hashlib.sha256(p.read_bytes()).hexdigest() for p in root.rglob('*') if p.is_file()}
audit=db.execute('SELECT action,version,at FROM audit WHERE tenant=? AND job_id=? ORDER BY sequence',(tenant,id)).fetchall()
def h(value):return hashlib.sha256(json.dumps(value,sort_keys=True,separators=(',',':')).encode()).hexdigest()
all_jobs=[]
for record in db.execute('SELECT id,tenant,version,state,body,fingerprint,created,updated FROM jobs ORDER BY tenant,id'):
 key,owner,version,state=record[:4];folder=pathlib.Path('/data/jobs')/hashlib.sha256(owner.encode()).hexdigest()/key
 all_jobs.append({'id':key,'tenant':owner,'version':version,'state':state,'rowSha256':h(record),'files':{str(p.relative_to(folder)):hashlib.sha256(p.read_bytes()).hexdigest() for p in folder.rglob('*') if p.is_file()}})
all_audit=db.execute('SELECT sequence,job_id,tenant,actor,action,version,at FROM audit ORDER BY sequence').fetchall()
print(json.dumps({'id':id,'tenant':tenant,'version':j['version'],'state':j['state'],'bodySha256':hashlib.sha256(body.encode()).hexdigest(),'files':files,'audit':audit,'submission':j.get('submission'),'tenantJobCount':db.execute('SELECT count(*) FROM jobs WHERE tenant=?',(tenant,)).fetchone()[0],'allJobs':all_jobs,'allJobCount':len(all_jobs),'allAuditCount':len(all_audit),'allAuditSha256':h(all_audit),'activeJobCount':sum(x['state'] in ('queued','analyzing','submitting') for x in all_jobs)}))
'''
        return json.loads(kube(['exec', '-i', 'deployment/water-network-import', '--', 'python', '-'], script.encode()))

    name = TARGETS[args.target][0]
    if args.verify:
        summary = json.loads((args.output / 'summary.json').read_text())
        if summary['target'] != args.target:
            raise ValueError('Target does not match prepared patch')
        expected = json.loads((args.output / 'expected-spec.private.json').read_text())
        patch = json.loads((args.output / 'deployment-patch.private.json').read_text())
        after = read('deployment', name)
        if after['spec'] != expected:
            raise ValueError('Deployment changed beyond approved image and provenance')
        actual_annotations = {k: v for k, v in after['metadata'].get('annotations', {}).items()
                              if k != 'deployment.kubernetes.io/revision'}
        expected_annotations = {k: v for k, v in patch[-2]['value'].items()
                                if k != 'deployment.kubernetes.io/revision'}
        if actual_annotations != expected_annotations:
            raise ValueError('Unrelated deployment annotations changed')
        replicas = TARGETS[args.target][-1]
        if any(after['status'].get(k) != replicas for k in ('replicas', 'updatedReplicas', 'readyReplicas', 'availableReplicas')):
            raise ValueError('Rollout is not fully Ready')
        if preserved_hashes() != json.loads((args.output / 'preserved-hashes.json').read_text()):
            raise ValueError('Config or shared frontend resources changed')
        current_job = job_receipt()
        if current_job != json.loads((args.output / 'shw-job.before.sanitized.json').read_text()):
            raise ValueError('SHW job changed; inspect concurrent user actions before claiming preservation')
        save(args.output / 'deployment.after.private.json', after)
        save(args.output / 'shw-job.after.sanitized.json', current_job)
        result = {**summary, 'applied': True, 'readyReplicas': replicas,
                  'allOtherSpecPreserved': True, 'configAndSharedFrontendPreserved': True,
                  'shwJobAndFilesUnchanged': True, 'allJobRowsAuditAndFilesUnchanged': True,
                  'publicAndAuthenticatedSmokePending': True}
        save(args.output / 'verification.json', result)
        print(json.dumps(result))
        return
    if args.output.exists():
        raise ValueError('Use a fresh private output directory')
    if not all((args.image, args.source_git_sha, args.source_sha256)):
        parser.error('Image, source commit and snapshot hash are required')
    before = read('deployment', name)
    patch, expected, summary = prepare(before, args.target, args.image, args.source_git_sha, args.source_sha256)
    config = json.loads(read('configmap', 'water-network-gis-shw')['data']['config.json'])
    expected_org = {'alias': 'shw', 'context': 'required', 'allowLegacyTenantIdFallback': False}
    if any(config.get('organization', {}).get(key) != value for key, value in expected_org.items()):
        raise ValueError('Strict SHW organization runtime differs from expected configuration')
    if config.get('gisDataSource') != 'canonical' or config.get('gisViewerMode') != 'rich':
        raise ValueError('Expected canonical SHW GIS runtime')
    job = job_receipt()
    if job['version'] != 4 or job['state'] != 'needs_review' or job['submission'] is not None:
        raise ValueError('SHW job drifted from reviewed version4 baseline')
    if job['tenantJobCount'] != 2 or job['activeJobCount'] != 0:
        raise ValueError('Expected two stable SHW jobs with no in-flight analysis/submission')
    args.output.mkdir(mode=0o700, parents=True)
    for filename, value in [('deployment.before.private.json', before), ('deployment-patch.private.json', patch),
                            ('expected-spec.private.json', expected), ('summary.json', summary),
                            ('preserved-hashes.json', preserved_hashes()), ('shw-job.before.sanitized.json', job)]:
        save(args.output / filename, value)
    kube(['patch', 'deployment', name, '--type=json', '--patch-file=/dev/stdin', '--dry-run=server', '-o', 'name'], canonical(patch))
    print(json.dumps({**summary, 'serverDryRunPassed': True}))


if __name__ == '__main__':
    main()
