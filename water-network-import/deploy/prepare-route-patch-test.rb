require 'minitest/autorun'
require_relative 'prepare-route-patch'

class CadImportRouteTest < Minitest::Test
  def config
    { 'kind' => 'ConfigMap', 'metadata' => { 'name' => 'apisix-config', 'namespace' => 'platform-core', 'resourceVersion' => '17' },
      'data' => { 'apisix.yaml' => YAML.dump({ 'routes' => [
        { 'id' => 'customers', 'uri' => '/api/v1/customers*', 'upstream_id' => 'existing' },
        { 'id' => 'water-network-canonical-bootstrap', 'uri' => '/api/gis/bootstrap',
          'plugins' => { 'cors' => { 'allow_origins' => 'https://gis.example' },
            'openid-connect' => { 'bearer_only' => true, 'use_jwks' => true, 'client_id' => 'water-network-gis-fe' } } }
      ], 'global_rules' => [{ 'id' => 'keep-me' }] }), 'other-key' => 'unchanged' } }
  end

  def test_adds_only_authenticated_import_route_and_guards_concurrency
    before = config
    patch, proof = CadImportRoute.prepare(before)
    assert_equal({ 'op' => 'test', 'path' => '/metadata/resourceVersion', 'value' => '17' }, patch.first)
    after = YAML.safe_load(patch.last['value'])
    original = YAML.safe_load(before['data']['apisix.yaml'])
    assert_equal original['routes'], after['routes'][0...-1]
    assert_equal original['global_rules'], after['global_rules']
    assert_equal true, after['routes'].last['plugins']['openid-connect']['bearer_only']
    assert_equal 2, proof['preservedRoutes']
  end

  def test_refuses_replacing_an_existing_import_route
    before = config
    patch, = CadImportRoute.prepare(before)
    before['data']['apisix.yaml'] = patch.last['value']
    assert_raises(RuntimeError) { CadImportRoute.prepare(before) }
  end

  def test_refuses_duplicate_owner_or_unauthenticated_template
    before = config
    doc = YAML.safe_load(before['data']['apisix.yaml'])
    doc['routes'][0]['uri'] = '/api/gis/imports/*'
    before['data']['apisix.yaml'] = YAML.dump(doc)
    assert_raises(RuntimeError) { CadImportRoute.prepare(before) }
    doc['routes'][0]['uri'] = '/api/v1/customers*'
    doc['routes'][1]['plugins']['openid-connect']['bearer_only'] = false
    before['data']['apisix.yaml'] = YAML.dump(doc)
    assert_raises(RuntimeError) { CadImportRoute.prepare(before) }
  end
end
