# water-network-gis — Rename + Real Keycloak + k8s Deploy

**Date:** 2026-06-18
**Status:** Design (approved verbally; pending written review)
**Scope:** Rename the `gis-core` MiniApp to `gis`, wire it to the real Keycloak
realm `water-platform`, and make it deployable to the k3s staging cluster with
runtime configuration. Deploy **only** the `gis` app this round; reserve the rest
of the fleet's names.

---

## 1. Context

`water-network-fe` is a **MiniApp fleet** (ADR 0008/0009/0010): each MiniApp is an
independent SPA cloned from `core-template`, deployed independently, launched from
the platform-level `app-catalog` shell with cross-app SSO via Keycloak
`check-sso`. The GIS map app (viewer + editor) is built and green (103 tests,
`vite build`, Docker image verified). Its Keycloak auth code already exists
(`keycloak-auth.ts`, `VITE_AUTH_MODE=keycloak`, PKCE S256, runtime `config.json`),
but the app has only ever run in `mock` auth mode.

This effort flips `gis` to real Keycloak and ships it to k3s staging.

## 2. Naming convention (decided)

| Layer | Convention | Example |
|-------|-----------|---------|
| Service (deployable MiniApp) | dir `apps/<slug>` · artifact `water-network-<slug>` | `apps/gis` → `water-network-gis` |
| Shared reusable ("core") | `packages/*` · npm `@wn/<name>` | `@wn/map-runtime`, `@wn/contracts`, `@wn/ui` |

Reusability is expressed at the **package** layer (`@wn/*`), never in the app slug.
The "-core" suffix is dropped: `gis-core → gis`. The reusable map core that other
domains consume is `@wn/map-runtime`.

### Fleet catalog (names reserved; only `gis` built this round)

| slug | service | dir | status |
|------|---------|-----|--------|
| `gis` | `water-network-gis` | `apps/gis` | built (currently named `gis-core`) |
| `monitoring` | `water-network-monitoring` | `apps/monitoring` | reserved |
| `simulation` | `water-network-simulation` | `apps/simulation` | reserved |
| `importer` | `water-network-importer` | `apps/importer` | reserved |
| `workflow` | `water-network-workflow` | `apps/workflow` | reserved |

The deferred "Analytics MFE" is dissolved — its features (topology graph,
pressure-zone, isolation trace, health) fold into `monitoring`/`simulation`.

## 3. Ownership vs reuse (IOC)

IOC (Khối 4) is the **cross-domain READ layer** ("đọc nhiều, ghi ít"): it does not
own the network model. Therefore:

- water-network **owns and names** the MiniApps (`water-network-*`).
- IOC **reuses** them three ways, without copying or renaming:
  1. **Shell launch / embed** of the `water-network-*` MiniApp via `app-catalog`
     + shared realm `water-platform` SSO (`check-sso`).
  2. **Shared FE packages** (`@wn/map-runtime`, `@wn/ui`) consumed by `water-ioc-fe`.
  3. **Cross-domain read-models** read by IOC.

If IOC later hosts a MiniApp under its own domain, we **add a redirect URI** to the
existing `water-network-<slug>` client — we do not create an `ioc-*` client.

## 4. Decided integration values

| Setting | Value |
|---------|-------|
| Keycloak host | `https://auth-dev.dichvunuoc.vn` |
| Realm | `water-platform` (shared) |
| Client id | `water-network-gis` (public, PKCE S256, standard flow) |
| gis staging host | `https://gis-dev.dichvunuoc.vn` |
| API access | APISIX gateway, `apiUrl = https://api-dev.dichvunuoc.vn` |
| Dev origin | `http://localhost:3001` (vite `strictPort: 3001`) |
| Config delivery | **(A)** k8s ConfigMap → `/usr/share/nginx/html/config.json` |
| Auth onLoad | `check-sso` (MiniApp convention) |

> Confirm at deploy time: exact APISIX route host for the water-network API, and
> that `gis-dev.dichvunuoc.vn` is the chosen ingress host.

## 5. The build-time vs runtime split (root design constraint)

`import.meta.env.VITE_*` is frozen at **build time** into the JS bundle. Setting
`VITE_*` as container env in the running pod does **nothing** to the SPA (the
current `deployment.yaml` does exactly this and is therefore ineffective). The
split:

- **Baked into the image at build** (per-app, env-agnostic):
  `VITE_AUTH_MODE=keycloak`, `VITE_USE_RUNTIME_CONFIG=true`,
  `VITE_KEYCLOAK_ON_LOAD=check-sso`, `VITE_USE_MOCK_DATA=false`.
- **Delivered at runtime via `config.json`** (per-environment):
  `apiUrl`, `keycloakUrl`, `keycloakRealm`, `keycloakClientId`, `appName`.

`runtime-config.ts` already fetches `/config.json` and overrides `env.*` before
render. So the same image promotes dev→prod; only the ConfigMap changes.

The one value that is host-derived, not env-config: `silentCheckSsoRedirectUri`.
`keycloak-auth.ts` will default it to `${window.location.origin}/silent-check-sso.html`
when unset, so no per-host config is needed.

## 6. Work breakdown

### A. Rename `gis-core → gis`
- `git mv apps/gis-core apps/gis`; `deploy/k3s/water-network-gis-core` → `water-network-gis`.
- Replace artifact names: package `water-network-gis-core` → `water-network-gis`;
  image `ghcr.io/dichvunuoc/water-network-gis-core` → `…/water-network-gis`.
- Update CI (`ci.yml`): path-filter `apps/gis-core/**` → `apps/gis/**`, job
  `working-directory`, and the `pre-build` paths.
- Update the Docker build context paths (Dockerfile, `apps/gis/docker-compose.yml`,
  `deploy/docker-compose.dev.yml`) — already context-aware, just the `gis-core`
  segment changes.
- Update docs/ADR references.
- Gate: `npm run build` + `test:run` + `lint` green; `docker build` green.

### B. Keycloak client (realm-as-code)
Add to `platform-core/deploy/core/keycloak/water-platform-realm.json`:
```jsonc
{
  "clientId": "water-network-gis",
  "publicClient": true,
  "standardFlowEnabled": true,
  "redirectUris": ["https://gis-dev.dichvunuoc.vn/*", "http://localhost:3001/*"],
  "webOrigins": ["https://gis-dev.dichvunuoc.vn", "http://localhost:3001"],
  "attributes": { "pkce.code.challenge.method": "S256" }
}
```
Apply via the existing bootstrap-job / `kcadm` path on `tino-32`. Verify with
`scripts/keycloak/verify-realm.sh`.

### C. Image build args
Dockerfile builds the app stage with the baked `VITE_*` from §5 (via `ARG`/`ENV`
before `npm run build`). Keep nginx CSP `envsubst` of `VITE_KEYCLOAK_URL` /
`VITE_API_URL` for the connect-src/frame-src header.

### D. Runtime config delivery — ConfigMap (option A)
`deploy/k3s/water-network-gis/configmap.yaml` holds `config.json`:
```json
{
  "apiUrl": "https://api-dev.dichvunuoc.vn",
  "keycloakUrl": "https://auth-dev.dichvunuoc.vn",
  "keycloakRealm": "water-platform",
  "keycloakClientId": "water-network-gis",
  "appName": "Bản đồ GIS — Mạng lưới cấp nước"
}
```
Mounted read-only at `/usr/share/nginx/html/config.json` (subPath).

### E. Code touch-ups
- `keycloak-auth.ts`: default `silentCheckSsoRedirectUri` to
  `${window.location.origin}/silent-check-sso.html` when env is empty.
- `.env.example`: fix the stale `localhost:3000` silent-redirect to `3001`.
- (No change to auth flow logic — it already works.)

### F. k8s manifests (fix + extend)
- **Port fix (existing bug):** container serves on **80**, but manifests target
  `8080` and set `runAsNonRoot: true` (nginx can't bind 80 unprivileged). Resolve
  by making nginx listen on **8080**: `nginx.conf.template` `listen 8080`,
  Dockerfile `EXPOSE 8080`, and run as non-root (use an unprivileged-compatible
  nginx setup — writable `/tmp`, pid path). Align `deployment`/`service`/probes to
  8080. `/health` stays the readiness/liveness path.
- `deployment.yaml`: mount the ConfigMap; drop the ineffective `VITE_API_URL`
  env; keep `VITE_KEYCLOAK_URL` only if nginx CSP needs it at runtime (else move
  the CSP host into the build).
- `configmap.yaml` (new), `service.yaml`, `kustomization.yaml` (+configmap),
  `ingress` (or APISIX route) for `gis-dev.dichvunuoc.vn` with TLS.

## 7. Verification plan

1. **Local:** rename → `build`/`test`/`lint`/`docker build` all green.
2. **Container:** run image with a dev `config.json`; assert `/config.json` served,
   `/health` 200, SPA shell loads.
3. **Auth e2e:** point at real `auth-dev` realm `water-platform` / client
   `water-network-gis`; verify PKCE redirect → token → roles parsed → protected
   route renders. Playwright spec against the real IdP (or a record of the manual
   run if headless KC is impractical).
4. **k8s:** apply kustomize to staging; ingress reachable at
   `gis-dev.dichvunuoc.vn`; SSO login succeeds; API call through APISIX returns
   with the bearer token.

## 8. Out of scope (this round)
- Building `monitoring` / `simulation` / `importer` / `workflow` (names reserved only).
- IOC embedding / `water-ioc-fe` changes.
- Extracting new `@wn/ui` shared package.
- Production (non-dev) environment values.

## 9. Open items to confirm at deploy
- Exact APISIX route host for the water-network API (`api-dev.dichvunuoc.vn` assumed).
- `gis-dev.dichvunuoc.vn` ingress host + TLS issuer (cert-manager vs provider).
- Whether nginx CSP needs `VITE_KEYCLOAK_URL` at runtime or can bake it.
