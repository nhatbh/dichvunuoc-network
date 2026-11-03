#!/usr/bin/env ruby
# frozen_string_literal: true

# Prepare a resourceVersion-guarded patch from a fresh live ConfigMap. This owns
# one new import route; the existing manual-staging reconciler keeps its scope.
require 'json'
require 'yaml'
require 'digest'

module CadImportRoute
  ID = 'water-network-cad-import'
  URIS = ['/api/gis/imports', '/api/gis/imports/*'].freeze

  def self.prepare(config_map)
    metadata = config_map.fetch('metadata')
    raise 'Wrong gateway ConfigMap' unless config_map['kind'] == 'ConfigMap' &&
      metadata['name'] == 'apisix-config' && metadata['namespace'] == 'platform-core'
    version = metadata.fetch('resourceVersion')
    raise 'Missing resourceVersion' if version.to_s.empty?
    original = YAML.safe_load(config_map.fetch('data').fetch('apisix.yaml'), aliases: false)
    document = Marshal.load(Marshal.dump(original))
    routes = document.fetch('routes')
    ids = routes.map { |route| route['id'].to_s unless route['id'].nil? }.compact
    raise 'Duplicate route IDs' unless ids.uniq.length == ids.length
    raise 'Import route already exists; inspect it before changing it' if ids.include?(ID)
    routes.each do |route|
      paths = [route['uri'], *route.fetch('uris', [])].compact
      raise 'Another route owns the import URI' unless (paths & URIS).empty?
    end
    template = routes.find { |route| route['id'] == 'water-network-canonical-bootstrap' }
    raise 'Canonical authenticated bootstrap route is missing' unless template
    plugins = Marshal.load(Marshal.dump(template.fetch('plugins')))
    auth = plugins.fetch('openid-connect')
    raise 'Expected bearer-only JWKS authentication' unless auth['bearer_only'] && auth['use_jwks'] &&
      auth['client_id'] == 'water-network-gis-fe'
    plugins.fetch('cors').merge!(
      'allow_methods' => 'GET,POST,PUT,OPTIONS',
      'expose_headers' => 'X-Request-Id,Content-Disposition'
    )
    route = {
      'id' => ID, 'uris' => URIS, 'priority' => 130,
      'methods' => %w[GET POST PUT OPTIONS],
      'upstream' => {
        'type' => 'roundrobin', 'nodes' => { 'water-network-bff:8080' => 1 },
        'timeout' => { 'connect' => 5, 'send' => 120, 'read' => 120 }
      },
      'plugins' => plugins
    }
    routes << route
    raise 'Existing gateway document changed' unless document.merge('routes' => routes[0...-1]) == original
    yaml = YAML.dump(document).sub(/\A---\s*\n/, '').rstrip + "\n#END\n"
    raise 'YAML did not round trip' unless YAML.safe_load(yaml, aliases: false) == document
    patch = [
      { 'op' => 'test', 'path' => '/metadata/resourceVersion', 'value' => version },
      { 'op' => 'replace', 'path' => '/data/apisix.yaml', 'value' => yaml }
    ]
    [patch, { 'addedRoute' => ID, 'preservedRoutes' => routes.length - 1,
              'existingRoutesSha256' => Digest::SHA256.hexdigest(JSON.generate(original['routes'])) }]
  end
end

if $PROGRAM_NAME == __FILE__
  abort 'Usage: prepare-route-patch.rb LIVE_CONFIGMAP.json PATCH.json' unless ARGV.length == 2
  begin
    patch, proof = CadImportRoute.prepare(JSON.parse(File.read(ARGV[0])))
    File.open(ARGV[1], File::WRONLY | File::CREAT | File::TRUNC, 0o600) do |file|
      file.write(JSON.pretty_generate(patch))
    end
    puts JSON.generate(proof)
  rescue StandardError => error
    warn "Could not prepare import route: #{error.class}: #{error.message}"
    exit 1
  end
end
