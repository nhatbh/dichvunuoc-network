#!/usr/bin/env python3
"""Freeze one reviewed Git subtree and record build commands; never starts Docker."""
import argparse
import hashlib
import io
import json
from pathlib import Path
import re
import subprocess
import tarfile

SERVICES = {
    'worker': ('water-network/water-network-import', 'Dockerfile', 'water-network-import'),
    'fe': ('water-network/water-network-fe', 'apps/gis/Dockerfile', 'water-network-gis'),
}
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--repo', type=Path, required=True)
parser.add_argument('--target', choices=SERVICES, required=True)
parser.add_argument('--revision', required=True)
parser.add_argument('--output', type=Path, required=True)
args = parser.parse_args()
if not re.fullmatch(r'[a-f0-9]{40}', args.revision):
    parser.error('Require the root-approved full frozen commit SHA')
if args.output.exists():
    parser.error('Use a fresh private output directory')
actual = subprocess.check_output(['git', 'rev-parse', args.revision + '^{commit}'], cwd=args.repo, text=True).strip()
if actual != args.revision:
    parser.error('Revision does not resolve to the exact approved commit')
subtree, dockerfile, repository = SERVICES[args.target]
archive = subprocess.check_output(['git', 'archive', '--format=tar', args.revision + ':' + subtree], cwd=args.repo)
args.output.mkdir(parents=True, mode=0o700)
context = args.output / 'context'
context.mkdir(mode=0o700)
with tarfile.open(fileobj=io.BytesIO(archive)) as tar:
    for member in tar.getmembers():
        p = Path(member.name)
        if p.is_absolute() or '..' in p.parts or not (member.isfile() or member.isdir()):
            raise ValueError('Archive contains unsupported paths/links; inspect source before building')
    tar.extractall(context)
files = sorted(p for p in context.rglob('*') if p.is_file())
digest = hashlib.sha256()
for path in files:
    digest.update(path.relative_to(context).as_posix().encode() + b'\0' + path.read_bytes() + b'\0')
source_hash = digest.hexdigest()
tag = 'registry-dev.dichvunuoc.vn/water-platform/' + repository + ':shw-georef-20260915-' + source_hash[:12]
command = ['docker', 'buildx', 'build', '--platform', 'linux/amd64', '--load', '--provenance=false',
           '--label', 'org.opencontainers.image.revision=' + args.revision,
           '--label', 'water-platform.io.source-state=clean',
           '--label', 'water-platform.io.source-sha256=' + source_hash,
           '--label', 'water-platform.io.release-kind=manual-staging',
           '--metadata-file', str(args.output / 'image-metadata.json'),
           '-f', str(context / dockerfile), '-t', tag, str(context)]
manifest = {'sourceRevision': args.revision, 'sourceSha256': source_hash,
            'sourceState': 'clean', 'sourceType': 'git-archive', 'subtree': subtree,
            'fileCount': len(files), 'platform': 'linux/amd64', 'imageTag': tag,
            'hashAlgorithm': 'sha256(sorted relative path NUL file bytes NUL)',
            'manualDevRelease': True, 'built': False, 'pushed': False, 'deployed': False}
for filename, value in [('build-command.json', command), ('push-command.json', ['docker', 'push', tag]),
                        ('build-manifest.json', manifest)]:
    path = args.output / filename
    path.write_text(json.dumps(value, indent=2) + '\n')
    path.chmod(0o600)
print(json.dumps(manifest))
