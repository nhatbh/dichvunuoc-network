# Chạy UI local với dịch vụ dev VPS

Từ thư mục `apps/gis`:

```bash
npm install
npm run dev:vps
```

Mở `http://localhost:4500/gis`. Chế độ này dùng:

- Keycloak: `https://auth-dev.dichvunuoc.vn`
- API gateway: `https://api-dev.dichvunuoc.vn/api/gis`
- Design BFF revision: cấu hình bởi `VITE_EDITOR_REVISION_ID` trong `.env.vps`

Không ghi tài khoản hoặc mật khẩu vào file env. Tài khoản dev phải có các quyền:

- `network-gis:read`
- `network-design:read`
- `network-design:write`

## Giới hạn hiện tại của VPS dev

Image `water-network-gis-be` đang chạy trên VPS chưa có API canonical `/bootstrap` và `/map`
đang tồn tại trong source mới. Vì vậy mode `vps` chuyển `/gis` thẳng sang `/gis/editor`.

Editor dùng trực tiếp Design BFF để:

- tải preview của revision Draft;
- tạo nút và đường ống;
- cập nhật hình học.

Hai thao tác **Tách ống** và **Nối mạng** được vô hiệu hóa vì Design BFF dev chưa có endpoint
tương ứng. Chúng vẫn hoạt động trong chế độ mock mặc định (`npm run dev`).
