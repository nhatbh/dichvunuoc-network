# water-network-gis — Rename + Real Keycloak + k8s Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename the `gis-core` MiniApp to `gis`, flip it to the real Keycloak realm `water-platform`, and ship it to k3s staging with runtime config.

**Architecture:** Independent MiniApp SPA (Solid + Vite + FSD). Auth code already supports `VITE_AUTH_MODE=keycloak` + PKCE + runtime `config.json`. We bake auth-mode at build time and deliver per-env Keycloak/API endpoints via a k8s ConfigMap-mounted `config.json`. One promotable image; env values live in the ConfigMap.

**Tech Stack:** Solid, Vite, TypeScript, Vitest, keycloak-js, Docker (multi-stage, nginx-unprivileged), k3s/kustomize, GitHub Actions, Keycloak realm-as-code.

**Spec:** `docs/superpowers/specs/2026-06-18-water-network-gis-keycloak-k8s-design.md`

**Branch:** `feat/water-network-gis-keycloak-k8s` (already created; Docker-context fix + spec already committed).

## Global Constraints
- **Naming:** service = `apps/<slug>` + artifact `water-network-<slug>`; reusable core = `@wn/*` packages. This app: slug `gis`, artifact `water-network-gis`.
- **Build-time vs runtime:** `VITE_AUTH_MODE`, `VITE_USE_RUNTIME_CONFIG`, `VITE_KEYCLOAK_ON_LOAD`, `VITE_USE_MOCK_DATA` are baked into the image at build. `apiUrl`/`keycloakUrl`/`keycloakRealm`/`keycloakClientId`/`appName` are delivered at runtime via `/config.json`.
- **Keycloak:** host `https://auth-dev.dichvunuoc.vn`, realm `water-platform`, client `water-network-gis` (public, PKCE S256, standard flow).
- **Hosts:** gis staging `https://gis-dev.dichvunuoc.vn`; API via APISIX `https://api-dev.dichvunuoc.vn`; dev origin `http://localhost:3001`.
- **Container:** nginx listens on **8080**, runs **non-root** (k8s `runAsNonRoot: true`). `/health` is the probe path.
- **Green bar:** every task ends with `npm run build`, `npm run test:run`, `npm run lint` (in `apps/gis`) passing where code changed; infra tasks verified by the stated command output.
- **Historical docs:** dated plan/spec files under `docs/superpowers/{plans,specs}` that reference `gis-core` are left UNCHANGED (they are point-in-time records). Only forward-looking docs are updated (Task 7).

---

### Task 1: Rename `gis-core → gis` (filesystem + artifacts)

Atomic mechanical rename of the app directory, package name, k8s manifest directory, compose/Dockerfile path segments, and CI wiring. The existing 103 tests + build are the regression gate.

**Files:**
- Move: `apps/gis-core/` → `apps/gis/`
- Move: `deploy/k3s/water-network-gis-core/` → `deploy/k3s/water-network-gis/`
- Modify: `apps/gis/package.json` (name), `apps/gis/Dockerfile` (path segments), `apps/gis/docker-compose.yml` (dockerfile path), `apps/gis/.env.example`
- Modify: `deploy/docker-compose.dev.yml`, `deploy/k3s/water-network-gis/{deployment,service,kustomization}.yaml`
- Modify: `.github/workflows/ci.yml`
- Modify: `package.json` (root description), `apps/gis/src/features/map-canvas/ui/map-canvas.test.tsx`, `apps/gis/src/pages/gis/gis-page.test.tsx` (string refs only)

All paths below are relative to `water-network/water-network-fe/` unless they start with `deploy/` or `.github/` (those are relative to the monorepo root `water-platform/`).

- [ ] **Step 1: Move the app and k8s directories**

```bash
cd water-network/water-network-fe
git mv apps/gis-core apps/gis
cd ../..              # monorepo root
git mv deploy/k3s/water-network-gis-core deploy/k3s/water-network-gis
```

- [ ] **Step 2: Rename the package**

In `apps/gis/package.json` change the name:
```json
  "name": "water-network-gis",
```

- [ ] **Step 3: Update the Dockerfile path segments**

In `apps/gis/Dockerfile`, replace every `apps/gis-core` with `apps/gis` (the comment header build command, the three `COPY apps/gis-core …` lines, and the `COPY --from=builder /app/apps/gis-core/dist …` + `COPY apps/gis-core/nginx.conf.template …` lines). The `packages/…` lines are unchanged.

- [ ] **Step 4: Update compose files**

`apps/gis/docker-compose.yml` — the build block:
```yaml
    build:
      context: ../..
      dockerfile: apps/gis/Dockerfile
```

`deploy/docker-compose.dev.yml` — the GIS service:
```yaml
  water-network-gis:
    build:
      context: ../water-network/water-network-fe
      dockerfile: apps/gis/Dockerfile
    image: ghcr.io/dichvunuoc/water-network-gis:dev
```
(rename the service key `water-network-gis-core` → `water-network-gis`; keep the ports/env block.)

- [ ] **Step 5: Update the k8s manifests' names + image**

In `deploy/k3s/water-network-gis/{deployment,service}.yaml` replace every `water-network-gis-core` with `water-network-gis` (metadata.name, labels `app:`, selector, service name/selector) and the image to `ghcr.io/dichvunuoc/water-network-gis:latest`. (Port/securityContext fixes happen in Task 5 — do not touch ports here.)

- [ ] **Step 6: Update CI wiring**

In `.github/workflows/ci.yml`, the `changes` path-filter and the `water-network-fe` job:
```yaml
              - 'water-network/water-network-fe/apps/gis/**'
              - 'water-network/water-network-fe/packages/**'
```
```yaml
  water-network-fe:
    needs: changes
    if: ${{ needs.changes.outputs.water_network_fe == 'true' }}
    uses: ./.github/workflows/_solid-fe.yml
    with:
      working-directory: water-network/water-network-fe/apps/gis
      pre-build: |
        npm --prefix ../../packages/contracts ci
        npm --prefix ../../packages/contracts run build
        npm --prefix ../../packages/map-runtime ci
        npm --prefix ../../packages/map-runtime run build
```

- [ ] **Step 7: Update remaining string references**

```bash
cd water-network/water-network-fe
# root description
#   "…Holds the independent MiniApp SPAs (e.g. gis) scaffolded from…"
# inspect the two test files; replace literal 'gis-core' app-name strings with 'gis'
grep -n "gis-core" apps/gis/src/features/map-canvas/ui/map-canvas.test.tsx apps/gis/src/pages/gis/gis-page.test.tsx
```
Edit `package.json` (root) description `gis-core` → `gis`, and in the two test files replace any `gis-core` that names the app/package with `gis`. Do NOT change the route path `/gis` (already correct) or unrelated identifiers.

- [ ] **Step 8: Verify build/test/lint green**

Run:
```bash
cd water-network/water-network-fe/apps/gis
npm run build && npm run test:run && npm run lint
```
Expected: build succeeds; `Tests  103 passed (103)`; lint `0 errors`.

- [ ] **Step 9: Verify Docker build from new paths**

Run (from `water-network/water-network-fe`):
```bash
docker build -f apps/gis/Dockerfile -t water-network-gis:rename-check .
docker rmi water-network-gis:rename-check
```
Expected: build completes; image removed.

- [ ] **Step 10: Verify no stale references remain in code/deploy/CI**

Run (monorepo root):
```bash
grep -rn "gis-core\|water-network-gis-core" --exclude-dir=node_modules \
  --exclude-dir=dist --exclude-dir=.git --exclude-dir=__subdot_git_archived__ \
  water-network/water-network-fe/apps water-network/water-network-fe/package.json \
  deploy .github
```
Expected: no output (historical `docs/` files are intentionally excluded and untouched).

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "refactor(water-network-gis): rename gis-core MiniApp to gis"
```

---

### Task 2: Default the silent-check-sso redirect URI to the current origin

The silent SSO check needs a redirect URI of `<origin>/silent-check-sso.html`. Rather than configure it per host, derive it from `window.location.origin` when the env var is empty. Extract a pure resolver and unit-test it.

**Files:**
- Create: `apps/gis/src/shared/lib/silent-check-sso.ts`
- Test: `apps/gis/src/shared/lib/silent-check-sso.test.ts`
- Modify: `apps/gis/src/shared/lib/keycloak-auth.ts`
- Modify: `apps/gis/.env.example`

**Interfaces:**
- Produces: `resolveSilentCheckSsoRedirectUri(configured: string, origin: string): string` — returns `configured` when non-empty, else `` `${origin}/silent-check-sso.html` ``.
- Consumed by: `keycloak-auth.ts` `initKeycloak()`.

- [ ] **Step 1: Write the failing test**

```typescript
// apps/gis/src/shared/lib/silent-check-sso.test.ts
import { describe, it, expect } from 'vitest'
import { resolveSilentCheckSsoRedirectUri } from './silent-check-sso'

describe('resolveSilentCheckSsoRedirectUri', () => {
  it('returns the configured value when provided', () => {
    expect(
      resolveSilentCheckSsoRedirectUri('https://x/sso.html', 'https://gis-dev.dichvunuoc.vn'),
    ).toBe('https://x/sso.html')
  })

  it('derives from origin when configured is empty', () => {
    expect(resolveSilentCheckSsoRedirectUri('', 'https://gis-dev.dichvunuoc.vn')).toBe(
      'https://gis-dev.dichvunuoc.vn/silent-check-sso.html',
    )
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/gis && npx vitest run src/shared/lib/silent-check-sso.test.ts`
Expected: FAIL — `Failed to resolve import './silent-check-sso'`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// apps/gis/src/shared/lib/silent-check-sso.ts
/** Resolve the Keycloak silent-check-sso redirect URI, defaulting to the current origin. */
export function resolveSilentCheckSsoRedirectUri(configured: string, origin: string): string {
  return configured || `${origin}/silent-check-sso.html`
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/gis && npx vitest run src/shared/lib/silent-check-sso.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Wire the resolver into keycloak-auth**

In `apps/gis/src/shared/lib/keycloak-auth.ts`, import the resolver and use it in `initKeycloak()`:
```typescript
import { resolveSilentCheckSsoRedirectUri } from './silent-check-sso'
```
Replace the `silentCheckSsoRedirectUri` line inside `kc.init({ … })`:
```typescript
        silentCheckSsoRedirectUri:
          typeof window === 'undefined'
            ? env.VITE_KEYCLOAK_SILENT_CHECK_SSO_REDIRECT_URI || undefined
            : resolveSilentCheckSsoRedirectUri(
                env.VITE_KEYCLOAK_SILENT_CHECK_SSO_REDIRECT_URI,
                window.location.origin,
              ),
```

- [ ] **Step 6: Fix the stale port in .env.example**

In `apps/gis/.env.example`, change the commented example from port 3000 to 3001:
```bash
# VITE_KEYCLOAK_SILENT_CHECK_SSO_REDIRECT_URI=http://localhost:3001/silent-check-sso.html
```

- [ ] **Step 7: Verify full suite green**

Run: `cd apps/gis && npm run test:run && npm run lint`
Expected: `Tests  105 passed (105)` (103 + 2 new); lint `0 errors`.

- [ ] **Step 8: Commit**

```bash
git add apps/gis/src/shared/lib/silent-check-sso.ts apps/gis/src/shared/lib/silent-check-sso.test.ts apps/gis/src/shared/lib/keycloak-auth.ts apps/gis/.env.example
git commit -m "feat(water-network-gis): default silent-check-sso redirect to origin"
```

---

### Task 3: Bake Keycloak auth-mode into the production image

The built bundle must run in `keycloak` mode with runtime config enabled. Pass these as build `ARG`s so the image is auth-correct while endpoints stay runtime-configurable.

**Files:**
- Modify: `apps/gis/Dockerfile`

- [ ] **Step 1: Add build args to the builder stage**

In `apps/gis/Dockerfile`, after `ENV HUSKY=0`, add:
```dockerfile
# Production auth posture is baked at build (the bundle freezes import.meta.env.*).
# Per-environment endpoints arrive at runtime via /config.json (see ConfigMap).
ARG VITE_AUTH_MODE=keycloak
ARG VITE_USE_RUNTIME_CONFIG=true
ARG VITE_KEYCLOAK_ON_LOAD=check-sso
ARG VITE_USE_MOCK_DATA=false
ENV VITE_AUTH_MODE=$VITE_AUTH_MODE \
    VITE_USE_RUNTIME_CONFIG=$VITE_USE_RUNTIME_CONFIG \
    VITE_KEYCLOAK_ON_LOAD=$VITE_KEYCLOAK_ON_LOAD \
    VITE_USE_MOCK_DATA=$VITE_USE_MOCK_DATA
```

- [ ] **Step 2: Build the image**

Run (from `water-network/water-network-fe`):
```bash
docker build -f apps/gis/Dockerfile -t water-network-gis:authmode .
```
Expected: build completes.

- [ ] **Step 3: Verify the bundle is in keycloak mode (mock auth stripped)**

Run:
```bash
docker run --rm --entrypoint sh water-network-gis:authmode -c \
  "grep -rl 'mock.*auth' /usr/share/nginx/html/assets >/dev/null 2>&1 && echo FOUND-MOCK || echo NO-MOCK"
```
Expected: `NO-MOCK` (production build aliases out `mock-auth` via the prod stub).

- [ ] **Step 4: Clean up and commit**

```bash
docker rmi water-network-gis:authmode
git add apps/gis/Dockerfile
git commit -m "build(water-network-gis): bake keycloak auth-mode into the image"
```

---

### Task 4: Serve as non-root on port 8080

The container currently serves on 80, but the k8s manifests target 8080 with `runAsNonRoot: true` — a mismatch. Switch nginx to the unprivileged image listening on 8080.

**Files:**
- Modify: `apps/gis/nginx.conf.template`
- Modify: `apps/gis/Dockerfile`

- [ ] **Step 1: Listen on 8080 in the nginx template**

In `apps/gis/nginx.conf.template`, change the listen directive:
```nginx
    listen 8080;
```

- [ ] **Step 2: Use the unprivileged nginx base + expose 8080**

In `apps/gis/Dockerfile` stage 2, change:
```dockerfile
# Stage 2: Serve with nginx (unprivileged: listens on 8080, runs as uid 101)
FROM nginxinc/nginx-unprivileged:alpine

COPY --from=builder /app/apps/gis/dist /usr/share/nginx/html
COPY apps/gis/nginx.conf.template /etc/nginx/templates/default.conf.template

EXPOSE 8080
```
(Drop the explicit `CMD` — the unprivileged image's default entrypoint/cmd already runs nginx with envsubst on `/etc/nginx/templates`.)

- [ ] **Step 3: Build and run, verifying 8080 + non-root**

Run (from `water-network/water-network-fe`):
```bash
docker build -f apps/gis/Dockerfile -t water-network-gis:port .
docker run -d --name gis-port -p 18099:8080 \
  -e VITE_API_URL=https://api-dev.dichvunuoc.vn -e VITE_KEYCLOAK_URL=https://auth-dev.dichvunuoc.vn \
  water-network-gis:port
sleep 3
docker exec gis-port id -u                                  # expect: 101 (non-root)
curl -s -o /dev/null -w "root=%{http_code}\n" http://localhost:18099/      # expect 200
curl -s -w " health=%{http_code}\n" http://localhost:18099/health          # expect {"status":"ok"} health=200
```
Expected: uid `101`; `root=200`; `/health` 200.

- [ ] **Step 4: Clean up and commit**

```bash
docker rm -f gis-port && docker rmi water-network-gis:port
git add apps/gis/nginx.conf.template apps/gis/Dockerfile
git commit -m "build(water-network-gis): serve non-root on 8080"
```

---

### Task 5: k8s manifests — ConfigMap + deployment fix + ingress

Deliver runtime `config.json` via a ConfigMap, remove the ineffective `VITE_*` pod env, align ports to 8080, and add the ingress for `gis-dev.dichvunuoc.vn`.

**Files:**
- Create: `deploy/k3s/water-network-gis/configmap.yaml`
- Create: `deploy/k3s/water-network-gis/ingress.yaml`
- Modify: `deploy/k3s/water-network-gis/deployment.yaml`
- Modify: `deploy/k3s/water-network-gis/service.yaml`
- Modify: `deploy/k3s/water-network-gis/kustomization.yaml`

- [ ] **Step 1: Create the ConfigMap**

```yaml
# deploy/k3s/water-network-gis/configmap.yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: water-network-gis-config
data:
  config.json: |
    {
      "apiUrl": "https://api-dev.dichvunuoc.vn",
      "keycloakUrl": "https://auth-dev.dichvunuoc.vn",
      "keycloakRealm": "water-platform",
      "keycloakClientId": "water-network-gis",
      "appName": "Bản đồ GIS — Mạng lưới cấp nước"
    }
```

- [ ] **Step 2: Rewrite the deployment (mount config, fix ports, drop dead env)**

```yaml
# deploy/k3s/water-network-gis/deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: water-network-gis
  labels:
    app: water-network-gis
spec:
  replicas: 1
  selector:
    matchLabels:
      app: water-network-gis
  template:
    metadata:
      labels:
        app: water-network-gis
    spec:
      securityContext:
        runAsNonRoot: true
        runAsUser: 101
      containers:
        - name: water-network-gis
          image: ghcr.io/dichvunuoc/water-network-gis:latest
          ports:
            - containerPort: 8080
          volumeMounts:
            - name: runtime-config
              mountPath: /usr/share/nginx/html/config.json
              subPath: config.json
              readOnly: true
          readinessProbe:
            httpGet:
              path: /health
              port: 8080
            initialDelaySeconds: 3
            periodSeconds: 10
          livenessProbe:
            httpGet:
              path: /health
              port: 8080
            initialDelaySeconds: 10
            periodSeconds: 15
          resources:
            requests:
              cpu: "20m"
              memory: "64Mi"
            limits:
              cpu: "300m"
              memory: "512Mi"
      volumes:
        - name: runtime-config
          configMap:
            name: water-network-gis-config
```

- [ ] **Step 3: Fix the service targetPort**

```yaml
# deploy/k3s/water-network-gis/service.yaml
apiVersion: v1
kind: Service
metadata:
  name: water-network-gis
spec:
  selector:
    app: water-network-gis
  ports:
    - port: 80
      targetPort: 8080
```

- [ ] **Step 4: Add the ingress**

```yaml
# deploy/k3s/water-network-gis/ingress.yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: water-network-gis
  annotations:
    cert-manager.io/cluster-issuer: letsencrypt-prod
spec:
  ingressClassName: traefik
  tls:
    - hosts: [gis-dev.dichvunuoc.vn]
      secretName: water-network-gis-tls
  rules:
    - host: gis-dev.dichvunuoc.vn
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: water-network-gis
                port:
                  number: 80
```
> If the cluster's issuer/ingressClass differ from `letsencrypt-prod`/`traefik`, set them to the cluster's actual values (see other apps under `deploy/k3s/`).

- [ ] **Step 5: Register the new resources in kustomization**

```yaml
# deploy/k3s/water-network-gis/kustomization.yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
resources:
  - configmap.yaml
  - deployment.yaml
  - service.yaml
  - ingress.yaml
```

- [ ] **Step 6: Validate the manifests render and are accepted**

Run (monorepo root):
```bash
kubectl kustomize deploy/k3s/water-network-gis >/tmp/gis-rendered.yaml && echo RENDER-OK
kubectl apply --dry-run=client -f /tmp/gis-rendered.yaml
```
Expected: `RENDER-OK`; each resource prints `… (dry run)` with no errors.

- [ ] **Step 7: Commit**

```bash
git add deploy/k3s/water-network-gis/
git commit -m "feat(water-network-gis): k8s configmap + ingress, fix ports to 8080"
```

---

### Task 6: Register the Keycloak client (realm-as-code)

Add a public PKCE client for `gis` to the shared realm and apply it.

**Files:**
- Modify: `platform-core/deploy/core/keycloak/water-platform-realm.json`

- [ ] **Step 1: Add the client to the realm JSON**

In the `clients` array of `platform-core/deploy/core/keycloak/water-platform-realm.json`, add:
```jsonc
{
  "clientId": "water-network-gis",
  "publicClient": true,
  "standardFlowEnabled": true,
  "directAccessGrantsEnabled": false,
  "redirectUris": ["https://gis-dev.dichvunuoc.vn/*", "http://localhost:3001/*"],
  "webOrigins": ["https://gis-dev.dichvunuoc.vn", "http://localhost:3001"],
  "attributes": { "pkce.code.challenge.method": "S256" }
}
```

- [ ] **Step 2: Validate the JSON parses**

Run: `python3 -c "import json; json.load(open('platform-core/deploy/core/keycloak/water-platform-realm.json')); print('JSON OK')"`
Expected: `JSON OK`.

- [ ] **Step 3: Apply to the live realm and verify**

Run (per the platform's existing path — kcadm on `tino-32`, or the bootstrap-job):
```bash
ssh tino-32   # then run the project's kcadm import/update for the water-platform realm
# verify:
bash platform-core/scripts/keycloak/verify-realm.sh   # or: kcadm get clients -r water-platform --fields clientId | grep water-network-gis
```
Expected: `water-network-gis` appears among realm clients.

- [ ] **Step 4: Commit**

```bash
git add platform-core/deploy/core/keycloak/water-platform-realm.json
git commit -m "feat(keycloak): add public PKCE client water-network-gis"
```

---

### Task 7: Update forward-looking docs to the new naming + catalog

Record the convention and updated catalog in the active docs (not the dated historical plans/specs).

**Files:**
- Modify: `docs/product/water-network-fe.md`
- Create: `docs/decisions/0011-water-network-fe-naming-and-fleet.md`

- [ ] **Step 1: Update the product doc's Affected Product Areas**

In `docs/product/water-network-fe.md`, update the area list and catalog so `gis-core` reads `gis` (`water-network-gis`), and add `monitoring`, `simulation` as reserved MiniApps; note "Analytics" is dissolved into monitoring/simulation; note reuse lives in `@wn/*`.

- [ ] **Step 2: Write ADR 0011**

```markdown
# 0011 water-network-fe naming + fleet (amends 0010)

## Status
Accepted — 2026-06-18

## Context
The fleet needs stable artifact names before MiniApps deploy to k8s and get
Keycloak clients. "gis-core" conflated the deployable app with reusability.

## Decision
- Service (deployable MiniApp): dir `apps/<slug>`, artifact `water-network-<slug>`.
- Reusable "core": shared `@wn/*` packages (e.g. `@wn/map-runtime`), never the app slug.
- Rename `gis-core → gis` (`water-network-gis`). Fleet (reserved): `gis`,
  `monitoring`, `simulation`, `importer`, `workflow`. The deferred "Analytics MFE"
  dissolves into `monitoring`/`simulation`.
- IOC (cross-domain read layer) reuses water-network MiniApps via app-catalog
  shell + shared realm SSO + `@wn/*` packages + read-models; it does not rename
  or copy them. Adding an IOC-hosted entry = adding a redirect URI to the existing
  `water-network-<slug>` client.

## Consequences
Artifact names are stable for k8s/Keycloak. Reuse is a package concern.
```

- [ ] **Step 3: Commit**

```bash
git add docs/product/water-network-fe.md docs/decisions/0011-water-network-fe-naming-and-fleet.md
git commit -m "docs(water-network-fe): record gis naming + fleet catalog (ADR 0011)"
```

---

### Task 8: End-to-end verification against real Keycloak

Prove the running image performs a real PKCE login against `auth-dev` and that k8s serves it.

**Files:**
- Create: `apps/gis/e2e/keycloak-login.spec.ts` (optional automated check; manual fallback documented)

- [ ] **Step 1: Run the image with the staging config**

Run (from `water-network/water-network-fe`):
```bash
docker build -f apps/gis/Dockerfile -t water-network-gis:e2e .
printf '%s' '{"apiUrl":"https://api-dev.dichvunuoc.vn","keycloakUrl":"https://auth-dev.dichvunuoc.vn","keycloakRealm":"water-platform","keycloakClientId":"water-network-gis","appName":"GIS"}' >/tmp/gis-config.json
docker run -d --name gis-e2e -p 18099:8080 -v /tmp/gis-config.json:/usr/share/nginx/html/config.json:ro water-network-gis:e2e
sleep 3
curl -s http://localhost:18099/config.json   # expect the staging JSON above
```
Expected: `/config.json` returns the staging values (proves runtime config is served).

- [ ] **Step 2: Verify the SPA initiates a real Keycloak redirect**

Open `http://localhost:18099/` in a browser (or Playwright) and confirm that hitting a protected route redirects to `https://auth-dev.dichvunuoc.vn/realms/water-platform/protocol/openid-connect/auth?...client_id=water-network-gis...code_challenge_method=S256`. Sign in with a realm test user; confirm return to the app authenticated and a protected route renders.

If automating, add `apps/gis/e2e/keycloak-login.spec.ts` asserting the redirect URL contains `auth-dev.dichvunuoc.vn`, `client_id=water-network-gis`, and `code_challenge_method=S256`. Otherwise record the manual run result in the PR description.

- [ ] **Step 3: Clean up local container**

```bash
docker rm -f gis-e2e && docker rmi water-network-gis:e2e
```

- [ ] **Step 4: Deploy to k3s staging and smoke-test**

Run:
```bash
# push the image (CI on merge, or manually):
#   docker build -f apps/gis/Dockerfile -t ghcr.io/dichvunuoc/water-network-gis:latest . && docker push …
kubectl apply -k deploy/k3s/water-network-gis
kubectl rollout status deploy/water-network-gis
curl -s -o /dev/null -w "%{http_code}\n" https://gis-dev.dichvunuoc.vn/health   # expect 200
```
Expected: rollout succeeds; `https://gis-dev.dichvunuoc.vn/health` returns 200; browser login via real KC succeeds; an API call through APISIX carries the bearer token.

- [ ] **Step 5: Commit any automated e2e spec**

```bash
git add apps/gis/e2e/keycloak-login.spec.ts   # if created
git commit -m "test(water-network-gis): e2e keycloak login redirect"
```

---

## Self-Review

**Spec coverage:**
- §2 naming/rename → Task 1, Task 7. ✔
- §3 ownership/reuse → recorded in ADR 0011 (Task 7). ✔
- §4 integration values → Tasks 5 (configmap), 6 (client). ✔
- §5 build-time vs runtime → Task 3 (bake) + Task 5 (configmap) + Task 2 (silent-sso). ✔
- §6A rename → Task 1. §6B client → Task 6. §6C build args → Task 3. §6D configmap → Task 5. §6E code touch-ups → Task 2. §6F port/non-root + manifests → Task 4 + Task 5. ✔
- §7 verification → Task 8. ✔
- §8 out of scope → respected (no monitoring/simulation/importer/workflow build; no IOC changes). ✔
- §9 open items → flagged inline in Task 5 (ingress issuer/class) and Task 8 (APISIX host). ✔

**Placeholder scan:** No "TBD/implement later/handle edge cases". Task 8's optional spec has explicit assertion content + a documented manual fallback. ✔

**Type/name consistency:** `resolveSilentCheckSsoRedirectUri(configured, origin)` defined in Task 2 Step 3 and consumed in Step 5 with the same signature. Artifact name `water-network-gis`, client `water-network-gis`, configmap `water-network-gis-config`, host `gis-dev.dichvunuoc.vn` consistent across Tasks 1/5/6/8. ✔
