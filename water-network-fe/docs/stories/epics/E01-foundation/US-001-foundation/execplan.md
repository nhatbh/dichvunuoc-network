# Exec Plan — US-001 Foundation

> Model: **fleet-SPA** (decision 0009). Module Federation plan parked.

## Goal

Dựng nền tảng fleet-SPA tối thiểu dựa trên `core-template/sampleapptanstack`:
một `@wn/contracts` publish được, một Menu App + một gis-core MiniApp clone từ
template, và chứng minh **cross-app SSO liền mạch** — thay cho việc chứng minh
rủi ro Module Federation (đã loại bỏ ở 0009).

## Scope

In scope:

- `@wn/contracts` thành package npm publish được trong `water-network-fe`
  (build → dist js+d.ts, test xanh, exports theo bounded context). ✅ DONE.
- Scaffold **Menu App** → `apps/menu` (port 3000) qua `scripts/scaffold.sh`;
  `.env` mock (sẽ là Keycloak `login-required`).
- Scaffold **gis-core** → `apps/gis-core` (port 3001); `.env` mock (sẽ là
  Keycloak `check-sso` + silent-check-sso); cài `@wn/contracts` qua
  `file:../../packages/contracts`; thêm reference slice (snapshot entity) parse
  payload BE bằng contracts.
- Wire cross-app navigation: Menu → gis-core (`navigateToMiniApp`), gis-core →
  Menu (`navigateToMenuApp`).
- Convention chung cho fleet (đặt tên repo/app, `.env` mẫu water-network).

Out of scope:

- importer + workflow apps (Phase 2); domain features gis-core (Phase 1).
- Publish contracts lên registry thật; chốt registry/claim/gateway/CRS.
- Module Federation.

## Risk Classification

Risk flags: Auth (Keycloak SSO), Authorization (RBAC guard), Public contracts
(`@wn/contracts`), Cross-platform (multi-app fleet + SSO iframe/cookie),
Multi-domain (contracts + 2 app), Weak proof (greenfield).

Hard gates: Auth + Authorization → **high-risk** (xác nhận). Giảm nhẹ: dùng auth
facade đã chứng minh của template + `mock` mode khi chưa có Keycloak thật.

## Work Phases

1. Discovery — DONE (đọc spec, decision 0008/0009, template + scaffold.sh +
   cross-app-sso.md, intake #2).
2. Design — `design.md` cập nhật cho fleet model.
3. Validation planning — `validation.md` cập nhật.
4. Implementation:
   a. `@wn/contracts` publish-ready. ✅ DONE.
   b. Scaffold Menu App + gis-core trong `apps/`, wire `.env` mock + contracts +
      reference slice. ✅ DONE (mock auth; gates xanh cả 2 app).
5. Verification — mỗi app: `npm run typecheck/lint/test:run/build/size` xanh;
   cross-app SSO liền mạch (mock trước, Keycloak thật khi có IAM); ghi evidence.
6. Harness update — `story update` proof; decision 0009 đã ghi; `trace`; friction.

## Stop Conditions

Pause for human confirmation if:

- Cần thông tin Keycloak thật (realm, client id, URL, claim tenant) để vượt mock
  → chứng minh cross-app SSO `check-sso` thật (còn lại của Phase 0).
- Cần chốt registry của `@wn/contracts` để app cài bản publish (Phase 0 dùng
  `npm pack`/`file:` tạm).
- Đổi direction kiến trúc hoặc nới lỏng validation.
