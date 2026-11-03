# Cross-App SSO: Menu App + MiniApps

## Mô hình

```
┌───────────────────────────────────��─────────────────────┐
│                    Keycloak (IDP)                         │
│  Realm: techgen                                          │
│  SSO Session Cookie: AUTH_SESSION_ID (httpOnly)          │
└────────────┬──────────────────────────┬─────────────────┘
             │                          │
    ┌────────▼────────┐      ┌──────────▼──────────┐
    │   Menu App      │      │    MiniApp A         │
    │ menu.example.com│      │ app-a.example.com    │
    │                 │      │                      │
    │ User logs in    │      │ check-sso → auto     │
    │ via Keycloak    │─────▶│ authenticated!       │
    │                 │      │ (no login prompt)    │
    └─────────────────┘      └──────────────────────┘
```

## Cách hoạt động

1. **User login tại Menu App**: Menu App redirect user tới Keycloak, user nhập credentials. Keycloak tạo SSO session cookie (`AUTH_SESSION_ID`) trên domain Keycloak.

2. **User click vào MiniApp**: Menu App navigate user tới URL của MiniApp.

3. **MiniApp khởi tạo Keycloak adapter** với `onLoad: 'check-sso'`:
   - Keycloak adapter tạo hidden iframe tới `silent-check-sso.html`
   - iframe redirect tới Keycloak authorization endpoint
   - Keycloak nhận ra SSO session cookie → trả về authorization code
   - MiniApp exchange code → nhận tokens → user đã authenticated!
   - **Không hiện login form** vì session đã tồn tại

4. Toàn bộ quá trình xảy ra trong ~200-500ms, user không thấy gì ngoài loading spinner.

## Cấu hình

### Keycloak Admin Console

1. Tạo **1 realm** chung (e.g., `techgen`)
2. Tạo **1 client per app** (hoặc shared client):
   - Menu App: `menu-app` (public, Authorization Code + PKCE)
   - MiniApp A: `miniapp-a` (public, Authorization Code + PKCE)
3. Mỗi client cần **Valid Redirect URIs**:
   - `https://menu.example.com/*`
   - `https://app-a.example.com/*`
4. **Web Origins**: thêm domain của từng app (cho CORS)
5. Bật **"SSO Session Idle"** đủ dài (e.g., 30 phút)

### Menu App (.env)

```env
VITE_AUTH_MODE=keycloak
VITE_KEYCLOAK_URL=https://iam.example.com
VITE_KEYCLOAK_REALM=techgen
VITE_KEYCLOAK_CLIENT_ID=menu-app
VITE_KEYCLOAK_ON_LOAD=login-required
```

### MiniApp (.env)

```env
VITE_AUTH_MODE=keycloak
VITE_KEYCLOAK_URL=https://iam.example.com
VITE_KEYCLOAK_REALM=techgen
VITE_KEYCLOAK_CLIENT_ID=miniapp-a
VITE_KEYCLOAK_ON_LOAD=check-sso
VITE_KEYCLOAK_SILENT_CHECK_SSO_REDIRECT_URI=https://app-a.example.com/silent-check-sso.html
VITE_MENU_APP_URL=https://menu.example.com
```

Key difference: Menu App dùng `login-required`, MiniApp dùng `check-sso`.

## Code Usage

### Từ Menu App: Navigate sang MiniApp

```ts
import { navigateToMiniApp } from '@/shared/lib/cross-app-sso'

// User click "App A" trong menu
await navigateToMiniApp('https://app-a.example.com/dashboard')

// Mở tab mới
await navigateToMiniApp('https://app-a.example.com', { openInNewTab: true })
```

### Từ MiniApp: Quay lại Menu App

```ts
import { navigateToMenuApp } from '@/shared/lib/cross-app-sso'

// "Back to Menu" button
navigateToMenuApp()

// Navigate to specific path in menu app
navigateToMenuApp('/settings')
```

### MiniApp: Check SSO status on mount

Template đã xử lý tự động trong `AuthInitializer` + `SessionProvider`:
- `keycloak.init({ onLoad: 'check-sso' })` chạy khi app mount
- Nếu có session → user authenticated ngay
- Nếu không có session → redirect tới login (hoặc hiện UI anonymous)

## Sequence Diagram

```
Menu App          Keycloak           MiniApp
   │                 │                  │
   │─── login ──────▶│                  │
   │◀── tokens ──────│                  │
   │                 │                  │
   │ (user clicks    │                  │
   │  miniapp link)  │                  │
   │─────────────────┼─────────────────▶│
   │                 │                  │
   │                 │◀─ check-sso ─────│ (hidden iframe)
   │                 │   (has session!) │
   │                 │── auth code ────▶│
   │                 │                  │
   │                 │◀─ token req ─────│
   │                 │── tokens ───────▶│ ✅ Authenticated!
   │                 │                  │
```

## Troubleshooting

### MiniApp vẫn hiện login form

1. **Check Keycloak realm**: Cả 2 app phải cùng realm
2. **Check cookie domain**: Nếu Keycloak ở `iam.example.com`, browser gửi cookie khi iframe redirect tới `/auth/realms/...`
3. **Third-party cookie blocking**: Chrome/Safari block third-party cookies. Giải pháp:
   - Deploy Keycloak trên cùng parent domain (`.example.com`)
   - Hoặc dùng `login-required` thay `check-sso` (full redirect, không iframe)

### Cross-domain (khác TLD)

Nếu Menu App ở `menu.company-a.com` và MiniApp ở `app.company-b.com`:
- Silent check-sso sẽ **không hoạt động** (third-party cookie bị block)
- Dùng `VITE_KEYCLOAK_ON_LOAD=login-required` cho MiniApp
- Keycloak sẽ full-redirect → nhận session → redirect back (flash nhanh, ~300ms)
- User vẫn **không cần nhập password** vì session tồn tại

### Session hết hạn

- Keycloak `SSO Session Idle` / `SSO Session Max` quyết định lifetime
- Nếu session expired, MiniApp sẽ redirect user tới login
- Recommend: set session idle >= 30 phút cho UX tốt
