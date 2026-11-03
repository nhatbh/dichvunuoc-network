# Validation — US-001 Foundation

> Model: **fleet-SPA** (decision 0009).

## Proof Strategy

Phase 0 "done" khi:

1. `@wn/contracts` build (dist js+d.ts) + test xanh, cài được vào một app. ✅
   (build + 3 test xanh; cài vào app: chờ scaffold).
2. Menu App + gis-core scaffold xong, mỗi app `typecheck` + `lint` + `test:run` +
   `build` + `size` xanh (lan can template).
3. **Cross-app SSO liền mạch**: từ Menu App điều hướng sang gis-core, gis-core
   `check-sso` nhận session → không hiện login lần hai (verify mock trước; với
   Keycloak thật khi có thông tin IAM).
4. gis-core có reference slice dùng `@wn/contracts` parse payload BE (mock qua MSW
   nếu chưa có BE thật).
5. Cross-app nav 2 chiều (Menu→gis-core, gis-core→Menu) hoạt động.

## Test Plan

| Layer | Cases |
| --- | --- |
| Unit | `@wn/contracts` round-trip parse (common + snapshot) ✅; rbac/guard của app |
| Contract | snapshot khớp sample payload BE (MSW fixture) |
| Component | reference slice (entity→feature→page) với MSW mock |
| Integration (per app) | mỗi app chạy standalone `npm run dev` + `test:run` |
| E2E (Playwright) | cross-app SSO liền mạch; cross-app nav; route guard chặn khi thiếu quyền |
| Platform | `npm run build` + nginx smoke (`/health`) mỗi app |
| Performance | size-limit budget (entry ≤120KB gzip, css ≤50KB) — đã có trong template |
| Logs/Audit | Sentry/web-vitals cấu hình qua `.env` (chưa bật DSN thật ở Phase 0) |

## Fixtures

- MSW handlers cho `/api/water-network-gis/v1/snapshot/*` dùng `@wn/contracts/testing`
  (`aSnapshot()`).
- Mock `IUserContext` mỗi role cho test RBAC guard.
- Keycloak: realm/clients dev (chờ IAM) hoặc `VITE_AUTH_MODE=mock`.

## Commands

```text
# trong water-network-fe
npm run contracts:build && npm run contracts:test     # ✅ xanh

# scaffold (đã chạy) — từ core-template/sampleapptanstack, target trong water-network-fe/apps
./scripts/scaffold.sh water-network-menu     <fe>/apps/menu
./scripts/scaffold.sh water-network-gis-core <fe>/apps/gis-core

# trong mỗi app (đã xanh, mock auth)
HUSKY=0 npm install && npm run typecheck && npm run lint && npm run test:run && npm run build && npm run size
npm run test:e2e        # cross-app SSO + nav (chờ Keycloak thật)
```

## Acceptance Evidence

- [x] `@wn/contracts` typecheck clean, 3/3 vitest pass, dist emits js+d.ts.
- [x] Menu App (`apps/menu`) gates green: typecheck ✓, 56/56 tests ✓, build ✓, lint 0 errors.
- [x] gis-core (`apps/gis-core`) gates green: typecheck ✓, 58/58 tests ✓ (inc. snapshot contract slice), build ✓, lint 0 errors, size 118.81/120 kB gz.
- [x] gis-core consumes `@wn/contracts` via `file:` + snapshot reference slice parses BE payload.
- [~] Cross-app SSO seamless with real Keycloak — **DEFERRED to integration phase**
  (FE-first, BE-last; auth stays mock). Not a Phase-0 blocker.
- [ ] Cross-app navigation both directions, mock auth (helpers wired; runtime/E2E
  check optional to close US-001).
