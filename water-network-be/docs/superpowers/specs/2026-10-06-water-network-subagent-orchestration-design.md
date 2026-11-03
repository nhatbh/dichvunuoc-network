# Water Network — Điều phối subagent và hoàn thiện theo chặng

**Ngày:** 2026-10-06
**Trạng thái:** Approved — người dùng duyệt written spec trong hội thoại ngày 2026-10-06. Implementation plan và execution method vẫn cần review trước triển khai.
**Phạm vi spec:** cơ chế điều phối, hợp đồng task, an toàn, bằng chứng và pilot MVP SHW. Không phải spec triển khai OBS/HYD/CIM.

## 1. Ý định đã thống nhất

Người dùng muốn hoàn thiện Water Network tự động bằng subagent, theo nguyên lý và kiến trúc gốc, đạt chất lượng cao nhất có thể kiểm chứng. Hướng đã chọn: toàn bộ Water Network, nghiệm thu MVP SHW trước; xây và kiểm chứng cơ chế agent bằng chặng này.

Chất lượng được đo bằng đúng nghiệp vụ, không mất dữ liệu, cách ly tenant, truy vết, kiểm thử tích hợp và phục hồi. Không đo bằng số service, màn hình hay checkbox.

Tự động hóa công việc trong task đã duyệt, không tự động hóa quyết định nghiệp vụ của cán bộ hoặc quyền release. Mỗi chặng tiếp theo có spec → plan → review → execution riêng; approval này không cấp quyền xây toàn bộ miền cùng lúc.

## 2. Nguồn và hiện trạng quan sát

Nguồn chuẩn:

- `../../spec-init-01.md`: yêu cầu gốc.
- `2026-06-11-water-network-platform-design.md`: thiết kế foundation.
- `../plans/2026-06-13-master-implementation-roadmap.md`: phụ thuộc và các pivot.
- `2026-10-03-shw-network-records-mvp-completion-design.md`: contract sản phẩm MVP SHW.
- `../plans/2026-10-03-shw-network-records-mvp-completion.md` và ba plan con: task và evidence MVP.
- `../../decisions/`: quyết định architecture/contract/security còn hiệu lực.
- `../../../../../docs/orchestration/{README.md,PLAYBOOK.md,ROADMAP.md,CLAIMS.json}`: điều phối cấp platform hiện hành.

Quan sát read-only ngày 2026-10-06:

- Main ở `e3e36f2f`, có nhiều WIP BE docs, FE GIS, Import và thay đổi ngoài Network. Không di chuyển, stage hoặc sửa WIP này trong bước viết spec.
- Có worktree `/home/dannv/Workspace/TECHGEN/water-platform-shw-mvp`, branch `feat/shw-network-records-mvp`, HEAD `17970eaa`; `git status --short` không có output tại thời điểm kiểm tra.
- Nhánh MVP có commit search GIS, BFF public profiles/history và FE canonical reads. Đây là source tồn tại, chưa phải xác nhận tests/release hiện tại.
- Có worktree import, FE, zone và GIS integration riêng; claims import vẫn ghi in-progress. Không tiếp quản hoặc bỏ claim vì timestamp cũ.
- README/ARCHITECTURE có nội dung foundation/template chưa phản ánh đầy đủ hiện trạng. Phải đọc ADR và code, không scaffold lại theo tài liệu lỗi thời.
- Phiên hiện tại chỉ có read/bash/edit/write; không có công cụ dispatch subagent. Không tuyên bố đã có agent runtime hay đang chạy agent.

Nếu nguồn mâu thuẫn, giữ invariant an toàn và đánh dấu blocked để chốt quyết định, không tự chọn cách dễ triển khai. Quyết định mới đã duyệt thay phần lịch sử tương ứng; mocks/dev bypass lịch sử không là cấu hình production được phép.

## 3. Kiến trúc sản phẩm bất biến

- **View can be composed. Write must be owned.** Không service nào đọc/ghi trực tiếp database service khác.
- GIS sở hữu geometry và quan hệ mạng; Asset sở hữu profile/vòng đời; Design sở hữu draft/revision/approval/publish intent.
- Import sở hữu ingestion/review/provenance, giữ bản vẽ gốc bất biến; không tạo workflow duyệt song song.
- BFF không database nghiệp vụ; FE đi qua public BFF/APISIX.
- Geometry canonical EPSG:4326; CRS nguồn xác minh tại biên. Không suy đoán CRS, material, độ chính xác khảo sát hoặc đấu nối từ giao cắt.
- Outbox/inbox và idempotency giữ semantics contract hiện hành; không hứa distributed transaction toàn revision.
- Approval không đồng nghĩa GIS đã áp dụng xong. Phải đối soát receipt và biểu diễn partial/conflict/recovery đúng loại luồng.
- Bảo trì đã chuyển sang water-fsm (ADR 0025): chỉ tích hợp contract Network/FSM, không tạo lại maintenance-be trong Network.
- Tenant/actor đến từ verified session/context; permission enforced server-side; không dùng payload chọn tenant hoặc cấp quyền.

## 4. Hình thức điều phối

Chọn điều phối theo **vertical slice nghiệp vụ** với reviewer độc lập. Không giao mỗi agent một layer dài hạn; không chạy agent tự do toàn repo.

Vai trò:

| Vai trò | Trách nhiệm | Không được làm |
|---|---|---|
| Coordinator | Lập DAG task, kiểm tra ownership, budget, trạng thái, dispatch và resume | Tự duyệt kết quả implementer hoặc nghiệp vụ SHW |
| Auditor | Đối chiếu nguồn/code/test/release, phân loại gap | Tự đánh dấu hoàn tất từ tài liệu lịch sử |
| Implementer | TDD, sửa scoped BE/BFF/FE và ghi evidence | Mở rộng allowlist, sửa quyền hoặc dùng dữ liệu thật |
| Spec reviewer | Đối chiếu acceptance và invariant nghiệp vụ | Chỉ nhìn summary mà bỏ diff/contract |
| Quality/security reviewer | Kiểm tra tenant, race, compatibility, recovery, chất lượng | Dùng approval của implementer thay review |
| Integrator/verifier | Kết hợp approved commits, chạy toàn luồng trên fixture | Auto merge/push/deploy hoặc gán accepted từ build xanh |

Vai trò không đồng nghĩa sáu process chạy đồng thời. Một task có implementer, sau đó hai review riêng. Nếu không có runtime độc lập, inline execution phải được người dùng chọn trong plan; ghi rõ self-review, không gọi là independent review.

### Hợp đồng runtime tối thiểu

Plan phải chọn và xác minh adapter thật trước dispatch: start(task packet), poll(run ID), cancel(run ID), lấy kết quả và artifact, phát hiện timeout/process exit. Chỉ resume runtime run nếu adapter hỗ trợ; không thì tạo attempt mới và đối soát output cũ.

Không cài package, extension hoặc credential trong bước spec. Nếu dùng Pi, implementation phải đọc đầy đủ tài liệu Pi/adapter liên quan trước chọn API. Không dựng SDK calls giả. Parallel tool calls không phải subagents.

Trước pilot cần smoke test hai task fixture độc lập, cancellation, failure propagation và lưu run ID. Không có adapter đạt yêu cầu → trạng thái runtime blocked, không giả lập thành công. Chưa cần dashboard hoặc framework agent mới.

## 5. Task packet và source of truth

Mỗi task packet trong plan gồm:

- task ID, slice, mục tiêu và non-goals;
- spec/ADR/acceptance IDs; dependencies và contract đã chốt;
- base commit, worktree, branch, owner; allowlist đường dẫn và write scopes;
- input context tối thiểu: contract, pattern hiện hữu, fixture và invariant;
- commands, expected checks và failure paths bắt buộc;
- quyền thực thi, budget, timeout, retry cap;
- output: commit/diff, evidence paths, review findings và blockers.

Plans hiện có là source of truth task/checkbox; backlog giữ cấp epic; platform ROADMAP/CLAIMS giữ cấp service/owner. Không tạo backlog/claim engine cạnh tranh, không khởi động lại Harness loop đã pause ở BE.

Run manifest lưu trong artifact directory của task do plan chỉ định, gồm task ID, attempt, runtime run ID, owner, base/output commit, trạng thái, timestamps, budget và evidence refs. Manifest chỉ theo dõi execution, không thay approval hoặc kế hoạch nghiệp vụ. Coordinator là writer duy nhất của state/claim updates; workers trả kết quả, không sửa ledger chung.

## 6. Isolation và chống làm trùng

1. Kiểm kê worktree/branch, claims và git status trước giao task; đối chiếu nhánh MVP trước tạo gap mới.
2. Scope có worktree/owner hiện hữu là reserved. Chỉ đọc cho tới khi có handoff rõ: owner, HEAD, dirty inventory và task đang chạy. Không takeover tự động.
3. Git worktree ngăn cùng branch được checkout đồng thời, **không** ngăn hai branch sửa cùng file/nghiệp vụ. Coordinator phải reserve scope và kiểm tra giao nhau.
4. Pilot chỉ có một Coordinator và tối đa hai implementer. Hai slice chỉ song song khi độc lập cả dependencies lẫn write scopes. Shared building blocks, contracts, migrations, package locks, gateway và ledger là scope độc quyền.
5. Worktree mới dùng approved base commit sạch. WIP chưa commit không tự có trong worktree; chuyển WIP cần approval riêng và bản đối soát, không stash/reset/clean tự động.
6. Reviewer đọc immutable output commit/diff. Thay đổi code sau review làm review và evidence liên quan mất hiệu lực.
7. Integrator xác minh scope diff rồi kết hợp trên integration branch được duyệt; re-run affected suites vì từng nhánh pass không chứng minh tổ hợp pass.
8. Scope conflict chưa giải quyết → blocked. Không lách bằng cách đổi tên branch.

Pilot không hỗ trợ nhiều Coordinator cùng ghi shared ledger. Muốn multi-coordinator phải có spec khóa atomic/cross-session riêng trước mở rộng.

## 7. State machine, thất bại và resume

```text
planned → ready → running → implemented → spec-reviewed
        → quality-reviewed → verified → awaiting-integration-approval
        → integrated → awaiting-release-approval → deployed → smoke-passed → accepted
```

`implemented` chỉ nói có output; `verified` yêu cầu checks mới trên exact commit. Integrated/deployed/accepted chỉ ghi khi có approval và evidence tương ứng; pilot được phép kết thúc ở verified.

Mọi bước có thể chuyển blocked/failed/cancelled. Ghi bước đang dừng, cause và input cần từ người dùng. Không bỏ review để tiếp tục.

Defaults pilot: tối đa hai implementer; tối đa hai vòng sửa sau review thất bại; tối đa 30 phút mỗi agent attempt và tối đa 120 phút mỗi task gồm attempts/reviews. Plan có thể giảm giới hạn hoặc đề xuất tăng để người dùng duyệt trước chạy. Các timeout của test/build được cấu hình riêng, nhưng vẫn thuộc task budget.

Nếu runtime đo được cost/tokens, plan đặt cap theo đơn vị runtime; nếu không đo được, ghi unavailable và dùng attempt/time/concurrency caps, không hứa kiểm soát tiền chính xác. Không tự gia hạn.

Agent crash/timeout: cancel runtime nếu có; xác minh process đã dừng trước trả scope về ready. Nếu không xác minh được, giữ reserved/blocked. Giữ diff/log, không tự xoá worktree. Lệnh có side effect không retry mù; đối soát trạng thái trước attempt mới.

Resume đối chiếu HEAD, status, manifest, claims và evidence; commit thay đổi hoặc context/contract đổi thì invalidate checks bị ảnh hưởng. Secrets/tokens không lưu vào packet, logs hoặc artifacts; output phải redact.

## 8. Quyền tự động và approval gates

Được làm sau khi người dùng duyệt **written spec, written plan và execution method**: đọc source, viết code/test trong allowlist, chạy checks local/fixture được plan cho phép, commit local đúng scope nếu plan cấp quyền.

Không được tự merge/push/PR, deploy, đổi gateway/identity/quyền, mutate SHW hoặc dùng fixture dùng chung khi chưa được cấp quyền. Cài dependency/tool hoặc kết nối môi trường ngoài cần nằm trong plan đã duyệt. Fixture destructive tests chỉ ở DB/bucket riêng có nhãn và ownership xác minh.

Review agents không thay cán bộ duyệt dữ liệu mạng. Merge/release cần approval nêu target, commit/images và migration; runtime nhận môi trường dev cũng không mặc nhiên cấp quyền dữ liệu thật.

Breaking contract, thay architecture/security, phát hiện scope mở rộng hoặc ngân sách vượt ngưỡng → stop, ADR/spec/plan update và duyệt lại trước tiếp tục.

## 9. Pilot MVP SHW

Giữ spec 2026-10-03 và ba plan hiện hữu, không viết lại task đã implement. Cơ chế mới bọc execution và review, không đổi product acceptance.

Thứ tự:

1. **Audit/handoff:** read-only đối chiếu main/WIP và nhánh MVP `17970eaa`; lập bảng source present/verified/missing/blocked cho mỗi task. Kết quả lịch sử phải có provenance, không gán fresh verification.
2. **Runtime:** chọn adapter, smoke fixture, xác minh log/budget/cancel và exclusivity. Người dùng duyệt workspace/execution trước dispatch product task.
3. **MVP01:** baseline/toolchain, canonical map/search/list/profile/history, fixture ≥10.000 assets và số đo thật. Search toàn tenant, không tải full tenant để tìm kiếm.
4. **MVP02:** bounded edit closure, geometry/relations, save/reload/CAS, session change, separation of duties và approval. Không self-approve; before snapshots và expected version lấy đúng nguồn.
5. **MVP03:** durable receipts, completion/reconciliation/retry, regression CAD, browser journeys thật, restore/rollback drill trên fixture và release gates.
6. **Nghiệm thu:** cán bộ xác nhận read-only dữ liệu SHW; ghi/duyệt trên tenant fixture riêng đã chỉ định. Accepted cần xác nhận con người, không tự suy từ suite xanh.

Đồ thị phụ thuộc tối thiểu: public search contract → FE search; bounded closure → geometry operations; attribution/CAS → approval; durable receipts → reconciliation UI. Có thể làm fixture hoặc review độc lập song song, không tick integration chỉ từ mock.

### Bằng chứng bắt buộc

- Exact commit/diff scope, command, exit status, timestamp, environment và fixture identity.
- .NET chạy từng test csproj với discovered count >0; 0 tests là fail dù exit 0.
- FE unit/UI, typecheck, lint budget không tăng, production build và browser journeys trên backend thật.
- Python Import regressions; Rust/contract tests khi scope topology bị ảnh hưởng.
- Tenant A/B, 401/403/404, stale response/session, concurrency và geometry/reference negative paths.
- Publish duplicate delivery, partial/conflict semantics theo loại luồng, lost completion, retry và recovery không duplicate.
- Restore kiểm tra metadata và file thực; migration/image compatibility và rollback evidence, không restore backup đè mạng đang vận hành.
- Performance ghi measurements, không claim latency/SLO chưa đo.

Evidence thiếu → unverified/blocked, không tick hoàn tất. Release/image mapping và live smoke là trạng thái riêng.

## 10. Lộ trình sau pilot

Sau MVP accepted, lần lượt audit và brainstorm chặng tiếp theo:

1. Topology/trace/isolation, Zone/DMA, Incident và tích hợp water-fsm. Kiểm chứng phần đã có và ownership nhánh Zone, không tạo lại service.
2. Observation: mapping/ingest → latest/history → thresholds/alerts, valve/pump state và graph freshness.
3. Hydraulic: frozen model/scenario → EPANET export → result import/query. Không tự thêm solver hoặc công nhận model kỹ thuật khi thiếu dữ liệu/duyệt chuyên gia.
4. Customer Impact/reporting: confirmed isolation snapshot → impact → notification/report qua platform contracts.

Mỗi chặng có vertical slice BE→BFF→FE, dependency và acceptance riêng. Spec này không cấp quyền implementation các chặng đó.

## 11. Nghiệm thu cơ chế điều phối

| Tình huống | Kết quả cần chứng minh |
|---|---|
| Runtime chưa có | Blocked rõ; không báo có subagents |
| Hai tasks độc lập | Chạy tối đa hai implementer; kết quả/evidence tách biệt |
| Scope overlap hoặc active existing owner | Không dispatch; giữ reservation và báo blocker |
| Worker sửa ngoài allowlist | Không integrate; báo diff vi phạm |
| Review phát hiện thiếu acceptance | Trả implementer; không tự verified |
| Output thay sau review | Invalidate review/evidence, kiểm tra lại |
| Timeout/crash và resume | Cancel/đối soát ownership; giữ output; không chạy trùng |
| Test exit 0 nhưng count 0 | Gate fail |
| Hết retry/time budget | Stop với blocker, không tự mở vòng mới |
| Thiếu release approval | Dừng ở verified/awaiting approval |
| Task yêu cầu thao tác SHW thật | Chặn nếu chưa có approval phù hợp |
| Tổ hợp hai nhánh | Integrator chạy checks trên combined exact commit |

Cơ chế chỉ được gọi là hoạt động khi các tình huống trên có test/smoke evidence và một slice MVP qua implement → independent reviews → integration verification. Không lấy bản spec này làm bằng chứng runtime.

## 12. Deliverables và handoff

Written implementation plan sau khi spec này được duyệt phải chỉ rõ:

- audit/handoff với nhánh MVP hiện hữu;
- runtime adapter được xác minh và phương án blocked/inline được người dùng lựa chọn;
- vị trí task packets/run artifacts và Coordinator ownership;
- tests của cơ chế, pilot slice được chọn từ gap thật, commands và budgets;
- worktree/base commit strategy và quyền side effects;
- rollback/cancel/recovery và completion gates.

Không triển khai trước khi người dùng review written plan và chọn execution method. Kiến trúc/contract/security phát sinh phải có ADR; không sửa ADR lịch sử thành như thể lựa chọn mới luôn tồn tại.
