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
3. Double-click `deploy-system.cmd`. It first offers to list the cluster's shared
   PostgreSQL/Redis/RabbitMQ/app-catalog services, then offers to **fill the missing settings
   from the cluster**: it finds those services and reads the credentials from their secrets
   (Bitnami chart keys such as `postgres-password`, `redis-password`, `rabbitmq-password`;
   CloudNativePG / RabbitMQ-operator `username`/`password` secrets), shows what it found
   (passwords masked, with the secret each came from) and saves it on your yes. It then asks for
   every setting still missing
   (in-cluster names, e.g. `postgres.db.svc.cluster.local`; passwords are typed hidden) and saves
   them in `deploy/dev/deploy.env` (git-ignored; created from `deploy.env.example`). Passwords go
   only into that file and the Kubernetes secret `water-network-system`.
4. PostgreSQL: the user must be able to create the three databases and the PostGIS extension, or
   create them beforehand.
5. Keycloak: client `water-network-gis-fe` must allow `https://FRONTEND_HOST/*` as a redirect URI
   and `https://FRONTEND_HOST` as a web origin; tokens must carry the `water-platform` audience.
6. DNS: `FRONTEND_HOST` (default `gis3d-dev.dichvunuoc.vn`) needs an A record to the cluster
   ingress (103.142.24.213).

## Database login

If the migrations fail with `password authentication failed`, double-click `db-credentials.cmd`
(repository root). Through `ssh tino32` it finds the pod behind `POSTGRES_HOST`, shows the
user/password settings the database was started with (passwords masked unless you ask), tests
every candidate login the way the services connect (deploy.env, the database pod, the namespace's
secrets) and saves a working one to `deploy.env`. It also says whether PostGIS is available.

When none logs in but the database container's local admin is allowed, it offers to create a
dedicated login `water_network` (generated password, CREATEDB) with the databases `wn_gis`,
`wn_asset`, `wn_design` owned by it and PostGIS in them. Nothing else on the server is changed, and
it asks first. If even the local admin is refused, ask the database's owner for a login.

## Run

Double-click `deploy-system.cmd` and answer y/n (Enter takes the default in capitals):

| Question | Default |
|---|---|
| Show the cluster's shared services first? | n |
| Find the missing settings in the cluster (services and their secrets)? | Y |
| Use these values? (after showing them) | Y |
| (each setting still missing) | — |
| Dry run only (write the manifests, change nothing)? | n |
| Build and push new images of this commit? (n = deploy images already pushed, then the tag) | Y |
| Run pnpm install for the frontend packages? | Y |
| Replace the frontend-only demo on the same host? (only when it is there) | n |
| After deploying, load the Vinh Thinh Dot 3 network if gis-be is empty? | n |

Unattended (CI, no questions): pass the answers as switches, e.g.
`deploy-system.cmd -SkipBuild -Tag <tag> -Yes`; `-Discover`, `-DryRun`, `-SkipInstall`, `-Seed`,
`-AutoFill` also exist. Any switch turns the questions off.

Images are tagged with the commit (`<sha>`, or `<sha>-dirty-<time>` with uncommitted changes).
If `FRONTEND_HOST` is served by the frontend-only demo, the script asks before replacing it.

`-Seed` asks for an access token: sign in to SYSTEM 3D as a user of the target tenant with
`network-gis` write rights, open the browser's developer tools, copy the `Authorization` header of
any `/api/gis` request (without `Bearer `) and paste it. The network is registered through gis-be's
API over an ssh port-forward, exactly as the local stack seeds it.

## 403 on /api/gis (app-catalog check)

The BFF asks app-catalog whether the user's tenant has the GIS app (`APP_CODE`). `check-access.cmd`
shows the answer and the app codes the catalog lists for the user. While the catalog has no record
for the app, answer **n** to "Check app-catalog access in the BFF?" in `deploy-system.cmd` (saved as
`APP_ENTITLEMENT_ENABLED=false`, decision 0031): sign-in and permissions are still checked. The new
BFF image is needed for this switch, so build once. Turn it back on when the catalog lists the app.

## "Cần đăng nhập và chọn đơn vị để quản lý hồ sơ import"

CAD import and the editor need the user's unit (tenant). Users without a Keycloak Organization only
have a flat `tenant_id`; answer **y** to "Accept the flat tenant_id claim..." in `deploy-system.cmd`
(saved as `ALLOW_FLAT_TENANT=true`, dev only). It needs a frontend image with this support, so build once.

## Replace the current GIS frontend

`replace-gis-fe.cmd` serves SYSTEM 3D at the current GIS frontend's address (deployment
`water-network-gis`, e.g. `https://gis-dev.dichvunuoc.vn`) instead of a separate host. It reads
that deployment, its service and ingress, saves them to `deploy/dev/.backup/gis-fe-<time>/`, and
replaces the deployment's pods with the SYSTEM 3D web image (nginx serving `/config.json` from
configmap `water-network-gis-3d` and proxying `/api/gis/` to `water-network-bff`). The service,
ingress, host and TLS certificate stay; the service's target port becomes 8080 if it was
another. Keycloak needs no change: client `water-network-gis-fe` already allows that host. It
then offers to remove the separate `gis3d-dev` copy. Each later `deploy-system.cmd` moves the GIS
frontend to the new image too. Run it again to put the previous frontend back.

## Roll back / remove

- Roll back: `deploy-system.cmd -SkipBuild -Tag <previous tag>` (migrations only move forward).
- Remove: `ssh tino32 "sudo k3s kubectl -n platform-core delete deploy,svc,ingress,configmap,secret,job -l app.kubernetes.io/part-of=water-network-system"`
  (the PVC `water-network-design-files` and the import service's resources are kept).
