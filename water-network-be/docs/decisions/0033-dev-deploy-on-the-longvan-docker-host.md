# 0033 — The dev system runs as a Docker Compose stack on the longvan-dev host

Date: 2026-11-18. Status: Accepted (user, 2026-11-18: "Docker Compose on longvan", address
gis-dev.dichvunuoc.vn).

## Context

The tino access pack stopped working, so the k3s cluster (namespace platform-core, shared
PostgreSQL/Redis/RabbitMQ, app catalog) can no longer be deployed to. The replacement access is
the longvan-dev pack: `dev@103.200.24.110` (`longvan-ubuntu`), sudo without password, Docker 29.
That server has no Kubernetes; it hosts ~40 other containers behind nginx-proxy-manager (:443).

## Decision

- SYSTEM 3D runs there as one Compose project `water-network` (`deploy/longvan/compose.yaml`):
  its own PostGIS 16/3.4, Redis 7.4 and RabbitMQ 3.13, the three migrations as run-once services,
  gis-be, asset-be, design-be, topology-rs, import, BFF and the web container. Named volumes; no
  host ports. Secrets are generated on the server once (`~/water-network/.secrets`, mode 600).
- Images are built on the developer's computer and copied with `docker save | ssh -C | docker
  load` (no registry dependency); only tags the server lacks are sent.
- nginx-proxy-manager reaches the web container by name on a network of our own,
  `water-network-proxy`, which the deploy attaches nginx-proxy-manager to; the proxy host is
  created through its API with the admin login typed at deploy time (never stored), or by hand.
- Login stays on the existing Keycloak realm. The BFF's app-catalog check is off (no catalog
  there) unless a catalog URL is configured.
- The scripts choose the target from `DEPLOY_TARGET` (compose | k8s) in deploy.env; the
  Kubernetes path is kept for a cluster.

## Consequences

- The dev data starts empty on the new host (load the demo with seed-demo.cmd).
- DNS of gis-dev.dichvunuoc.vn must point to 103.200.24.110.
- The stack shares the host's CPU/memory with other apps; services have no resource limits yet.
