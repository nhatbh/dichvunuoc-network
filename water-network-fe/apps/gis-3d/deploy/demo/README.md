# 3D GIS demo deployment (frontend only)

Publishes `apps/gis-3d` as a **demo** to https://gis3d-dev.dichvunuoc.vn on the tino k3s cluster:
mock login (`demo@example.com` / `password123`) and the mock Hanoi network, served entirely in the
browser by MSW. No backend, Keycloak or registry is involved.

## Deploy / update

VPN on, the tino32 **dev** access pack installed (`ssh tino32` works, account `dev-k3s`), then
double-click `deploy.cmd` or run (add `-SshHost tino-32` to use the personal `nhat` account instead):

```powershell
powershell -ExecutionPolicy Bypass -File .\deploy.ps1            # build + publish
powershell -ExecutionPolicy Bypass -File .\deploy.ps1 -SkipInstall   # faster, deps unchanged
```

The script builds the shared packages and `pnpm run build:demo` (`.env.demo`), uploads `dist` to
`tino-32:/srv/water-network/gis-3d-demo/releases/<timestamp>`, points `current` at it, and applies
this folder with `kubectl apply -k` (nginx pod pinned to tino-32 + service + ingress with the
existing `wildcard-dichvunuoc-tls` certificate, namespace `platform-core`). Re-running only swaps
the files; the pod keeps serving. The last 3 releases are kept.

## DNS

`gis3d-dev.dichvunuoc.vn` needs an A record to `103.142.24.213`. Until it exists, add
`103.142.24.213  gis3d-dev.dichvunuoc.vn` to `C:\Windows\System32\drivers\etc\hosts` to test.

## Roll back / remove

- Previous release: `ssh tino-32`, `ls /srv/water-network/gis-3d-demo/releases`, then
  `sudo ln -sfn releases/<older> /srv/water-network/gis-3d-demo/current`.
- Remove: `undeploy.ps1` (add `-RemoveFiles` to delete the uploaded files too).

Saved drafts and branches live in each visitor's browser (localStorage); there is no server state.
