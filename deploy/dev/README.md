# Deploying the whole system to the dev cluster

`deploy-system.cmd` (repository root) runs `deploy/dev/deploy.ps1`. One run builds, pushes and
deploys every component of SYSTEM 3D to the tino k3s cluster (namespace `platform-core`):

| Component | Image | Notes |
|---|---|---|
| water-network-gis-3d | frontend bundle on nginx | serves the app at `https://FRONTEND_HOST`, proxies `/api/gis/` to the BFF |
| water-network-bff | BFF | the app's only API |
| water-network-gis-be, -asset-be, -design-be | .NET services | databases `wn_gis`, `wn_asset`, `wn_design` migrated by Jobs first |
| water-network-topology-rs | topology | graph from RabbitMQ events, rebuilt from gis-be on demand |
| water-network-import | CAD import | manifests from `water-network-import/deploy/runtime.yaml` |

It uses the cluster's **shared** PostgreSQL (PostGIS), Redis and RabbitMQ and the existing
**Keycloak** realm. It does not touch APISIX, `api-dev` routes or other apps.

## Before the first run

1. VPN on; `ssh tino32` works (dev access pack; `sudo -n k3s kubectl` allowed).
2. Docker Desktop running; `docker login registry-dev.dichvunuoc.vn` once. pnpm and git installed.
3. Run `deploy-system.cmd -Discover`: lists the shared PostgreSQL/Redis/RabbitMQ/app-catalog
   services and the water-network resources already in the namespace.
4. The first run creates `deploy/dev/deploy.env` from `deploy.env.example`. Fill in the shared
   services' hosts and credentials (in-cluster names, e.g. `postgres.db.svc.cluster.local`) and
   the app-catalog URL. The file is git-ignored; the passwords go only into the Kubernetes secret
   `water-network-system`.
5. PostgreSQL: the user must be able to create the three databases and the PostGIS extension, or
   create them beforehand.
6. Keycloak: client `water-network-gis-fe` must allow `https://FRONTEND_HOST/*` as a redirect URI
   and `https://FRONTEND_HOST` as a web origin; tokens must carry the `water-platform` audience.
7. DNS: `FRONTEND_HOST` (default `gis3d-dev.dichvunuoc.vn`) needs an A record to the cluster
   ingress (103.142.24.213).

## Run

```
deploy-system.cmd                 build everything, push, migrate, roll out, check
deploy-system.cmd -DryRun         only render the manifests to deploy\dev\.rendered
deploy-system.cmd -SkipBuild      redeploy images already pushed for this commit (or -Tag TAG)
deploy-system.cmd -Seed           also load the Vinh Thinh Dot 3 network when gis-be is empty
```

Images are tagged with the commit (`<sha>`, or `<sha>-dirty-<time>` with uncommitted changes).
If `FRONTEND_HOST` is served by the frontend-only demo, the script asks before replacing it.

`-Seed` asks for an access token: sign in to SYSTEM 3D as a user of the target tenant with
`network-gis` write rights, open the browser's developer tools, copy the `Authorization` header of
any `/api/gis` request (without `Bearer `) and paste it. The network is registered through gis-be's
API over an ssh port-forward, exactly as the local stack seeds it.

## Roll back / remove

- Roll back: `deploy-system.cmd -SkipBuild -Tag <previous tag>` (migrations only move forward).
- Remove: `ssh tino32 "sudo k3s kubectl -n platform-core delete deploy,svc,ingress,configmap,secret,job -l app.kubernetes.io/part-of=water-network-system"`
  (the PVC `water-network-design-files` and the import service's resources are kept).
