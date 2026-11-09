# SYSTEM 3D web image for deploy/dev: the bundle deploy.ps1 built (apps/gis-3d/dist) on the
# same pinned nginx as apps/gis-3d/Dockerfile. nginx config and /config.json come from the
# ConfigMap in k8s/system.yaml. Build context: apps/gis-3d/dist.
FROM nginxinc/nginx-unprivileged:1.31.3-alpine@sha256:a718212f9cf21e241f14067333000a3f0930292f5354fe0db269e9a2a2596b9e
COPY . /usr/share/nginx/html
EXPOSE 8080
