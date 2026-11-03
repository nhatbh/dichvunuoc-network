from copy import deepcopy

import numpy as np
import pytest
from pyproj import CRS, Geod, Transformer

from wn_import.georeference import prepare_georeference
from wn_import.models import ReviewConfig
from test_engine import feature, run


def controls(offset=(0, 0)):
    plane = CRS.from_proj4('+proj=aeqd +lat_0=21 +lon_0=105 +datum=WGS84 +units=m +no_defs')
    to_geo = Transformer.from_crs(plane, 4326, always_xy=True)
    return [
        {'source': [x + offset[0], y + offset[1]],
         'target': list(to_geo.transform(x, y)), 'checkOnly': check}
        for x, y, check in [(0, 0, False), (100, 0, False), (0, 100, False), (100, 100, True)]
    ]


def georeview(points=None, **values):
    return ReviewConfig.model_validate({
        'expectedVersion': 1, 'sourceCrs': None, 'controlPointTargetCrs': 'EPSG:4326',
        'controlPoints': controls() if points is None else points,
        **values,
    })


def registered(points=None, **values):
    return run([feature('pipe', [[0, 0], [100, 0]])], sourceCrs=None,
               controlPointTargetCrs='EPSG:4326',
               controlPoints=controls() if points is None else points, **values)


def test_gis_targets_register_unknown_cad_and_report_authoritative_metric_residuals():
    original = controls()
    result = registered(original)
    assert result['state'] == 'ready', result['issues']
    assert result['coordinateSpace'] == 'EPSG:4326'
    report = result['georeference']
    assert report['status'] == 'valid' and report['fitPointCount'] == 3 and report['checkPointCount'] == 1
    assert report['maxErrorM'] < .001 and len(report['residuals']) == 4
    assert report['residuals'][3]['checkOnly'] is True
    assert '+proj=aeqd' in report['workingCrs'] and '+datum=WGS84' in report['workingCrs']
    pipe = next(f for f in result['clean'] if f['properties'].get('kind') == 'Pipe')
    geod = Geod(ellps='WGS84')
    for actual, pair in zip(pipe['geometry']['coordinates'], original[:2]):
        assert abs(geod.inv(*actual, *pair['target'])[2]) < .001
    assert result['raw'][0]['geometry']['coordinates'] == [[0, 0], [100, 0]]
    assert original == controls()


def test_check_pair_does_not_influence_fitting_plane_or_coefficients():
    good = prepare_georeference(georeview())
    shifted = controls()
    shifted[-1]['target'][0] += .0001
    bad = prepare_georeference(georeview(shifted))
    assert good.diagnostics['workingCrs'] == bad.diagnostics['workingCrs']
    assert bad.diagnostics['status'] == 'invalid' and bad.diagnostics['maxErrorM'] > 5
    assert all(r['errorM'] < .001 for r in bad.diagnostics['residuals'][:3])
    assert bad.affine is None
    result = registered(shifted)
    assert not result['drafts'] and result['coordinateSpace'] == 'cad'


def test_valid_overlay_without_survey_evidence_cannot_create_drafts():
    result = registered(crsEvidence='')
    assert result['georeference']['status'] == 'valid'
    assert result['coordinateSpace'] == 'EPSG:4326' and result['clean']
    assert result['state'] == 'needs_review' and not result['drafts']
    assert any(i['code'] == 'CRS_EVIDENCE_REQUIRED' for i in result['issues'])


@pytest.mark.parametrize('points', [[], controls()[:2], controls()[:3],
                                  [{'source': [0, 0], 'target': None}],
                                  [{'source': None, 'target': [105, 21]}]])
def test_incomplete_pairs_or_set_are_persistable_but_never_transform(points):
    config = georeview(points)
    assert config.model_dump()['controlPoints'] == [
        {'source': tuple(p['source']) if p.get('source') else None,
         'target': tuple(p['target']) if p.get('target') else None,
         'checkOnly': p.get('checkOnly', False)} for p in points]
    result = registered(points)
    assert result['georeference']['status'] == 'incomplete'
    assert result['coordinateSpace'] == 'cad' and not result['drafts']


@pytest.mark.parametrize('mutation', ['duplicate_fit', 'duplicate_check_source', 'duplicate_check_target',
                                     'source_collinear', 'target_collinear', 'source_near_collinear',
                                     'invalid_latitude', 'extent', 'overflow'])
def test_invalid_or_nonindependent_controls_fail_closed(mutation):
    points = controls()
    if mutation == 'duplicate_fit':
        points[1]['source'] = points[0]['source']
    elif mutation == 'duplicate_check_source':
        points[-1]['source'] = points[0]['source']
    elif mutation == 'duplicate_check_target':
        points[-1]['target'] = points[0]['target']
    elif mutation == 'source_collinear':
        points[2]['source'] = [200, 0]
    elif mutation == 'target_collinear':
        # Meridional geodesics stay collinear in the AEQD plane centered on that meridian.
        for i in range(3): points[i]['target'] = [105, 21 + i * .001]
    elif mutation == 'source_near_collinear':
        points[2]['source'] = [200, 1e-9]
    elif mutation == 'invalid_latitude':
        points[-1]['target'] = [105, 91]
    elif mutation == 'extent':
        points[-1]['target'] = [107, 21]
    else:
        points[0]['source'] = [1e308, 1e308]
        points[1]['source'] = [-1e308, -1e308]
    result = registered(points)
    assert result['georeference']['status'] == 'invalid'
    assert result['state'] == 'needs_review' and not result['drafts']


@pytest.mark.parametrize('offset', [(2_000_000, 7_000_000), (1e15, -2e15)])
def test_normalized_solver_handles_large_cad_coordinate_offsets(offset):
    registration = prepare_georeference(georeview(controls(offset)))
    assert registration.diagnostics['status'] == 'valid'
    assert registration.diagnostics['maxErrorM'] < .001
    result = run([feature('pipe', [list(offset), [offset[0] + 100, offset[1]]])],
                 sourceCrs=None, controlPointTargetCrs='EPSG:4326', controlPoints=controls(offset))
    assert result['state'] == 'ready', result['issues']
    actual = next(f for f in result['clean'] if f['properties'].get('kind') == 'Pipe')
    geod = Geod(ellps='WGS84')
    for coordinate, pair in zip(actual['geometry']['coordinates'], controls(offset)[:2]):
        assert abs(geod.inv(*coordinate, *pair['target'])[2]) < .001


@pytest.mark.parametrize('values', [{'sourceCrs': 'EPSG:3857'},
                                   {'fileCrs': [{'fileId': 'file1', 'sourceCrs': 'EPSG:32648'}]}])
def test_gis_pair_mode_does_not_silently_override_source_crs(values):
    registration = prepare_georeference(georeview(**values))
    assert registration.error_code == 'AFFINE_SCOPE' and registration.affine is None


def test_review_model_preserves_legacy_target_mode_and_rejects_nonfinite_input():
    assert ReviewConfig(expectedVersion=1).controlPointTargetCrs is None
    with pytest.raises(ValueError): georeview(controlPointTargetCrs='EPSG:3857')
    with pytest.raises(ValueError): georeview([{'source': [float('inf'), 0], 'target': [105, 21]}])
