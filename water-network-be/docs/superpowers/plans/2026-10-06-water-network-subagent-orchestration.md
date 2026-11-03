# Water Network Subagent Orchestration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Kiểm chứng một Coordinator nhẹ dùng Pi RPC, review độc lập và pilot tra cứu canonical SHW mà không sửa dữ liệu vận hành.
**Architecture:** Python stdlib điều khiển các Pi subprocess riêng; pilot workers không có tools, chỉ trả patch/review có cấu trúc. Coordinator kiểm tra patch, chạy commands đã duyệt và ghi manifest; không tạo workflow service/dashboard hay thay platform claims. Pilot dùng nhánh MVP hiện hữu sau handoff, không triển khai trên main.
**Tech Stack:** Python 3.11+ stdlib/unittest, Pi CLI RPC 1.0.0 đã quan sát, Git, verifier SHW hiện hữu, SolidJS/OpenLayers/Vitest; Docker cho .NET fixtures khi cần.
**Spec:** `../specs/2026-10-06-water-network-subagent-orchestration-design.md` — người dùng duyệt written spec trong hội thoại; plan này chờ review và execution selection.

## Global Constraints

- **View can be composed. Write must be owned.** Không service nào đọc/ghi trực tiếp database service khác.
- Canonical EPSG:4326; không suy đoán CRS/material/đấu nối hoặc tự duyệt dữ liệu nguồn.
- Pilot chỉ có một Coordinator và tối đa hai implementer. Pilot giới hạn thêm tối đa hai Pi processes tổng cộng, kể cả reviewers.
- Defaults pilot: tối đa hai vòng sửa sau review thất bại; tối đa 30 phút mỗi agent attempt và tối đa 120 phút mỗi task gồm attempts/reviews. Không tự gia hạn.
- Plans là source of truth task/checkbox; platform ROADMAP/CLAIMS giữ service ownership; manifest chỉ giữ execution. Không restart BE Harness loop.
- Scope có owner hiện hữu là reserved đến khi handoff. Không stash/reset/clean, auto takeover hoặc tự mang WIP.
- Không merge/push/PR/deploy/đổi quyền/gateway hoặc mutate SHW. Local scoped commit do Coordinator thực hiện, không do workers.
- Reviewer đọc exact immutable output commit; code đổi làm review/checks liên quan mất hiệu lực.
- .NET phải chạy từng csproj và discovered count >0; FE lint budget180 không tăng; mock không thay backend/browser integration.
- Credentials không vào prompts/argv/artifacts. Không cài package/extension hay nâng SDK/dependency trong plan này.
- Các đường dẫn dưới đây tương đối với repo root **water-platform/**, không phải CWD water-network/.

## Review Focus

1. Prompt accepted/agent_end/exit0 nhưng provider error hoặc chưa settled phải fail, không ghi completed — Task3.
2. Patch rename/path traversal/symlink/untracked ngoài scope phải bị chặn trước integrate, không chỉ kiểm tra tracked diff — Task4.
3. Coordinator chết, PID tái dùng hoặc worktree đổi HEAD phải giữ reservation và invalidate evidence — Task2/4.
4. Review approve nhầm commit, evidence cũ hoặc test count0 phải không đạt verified — Task4/5.
5. Asset ngoài viewport, bị xóa hoặc Organization đổi lúc chờ response phải không hiển thị tài sản cũ — Task7.

## Quyết định triển khai và boundaries

- Không phụ thuộc package pi-subagents chưa có. Dùng wire RPC chính thức; Python phù hợp với verifier stdlib hiện có và không cần thêm npm/Python dependencies.
- Workers chạy `pi --mode rpc --no-session --no-tools --no-extensions --no-skills --no-prompt-templates --no-themes --no-context-files --no-approve --offline`. Provider/model IDs lấy từ lựa chọn người dùng, không fuzzy auto-pick. `--offline` chỉ tắt startup network; model request vẫn cần provider network.
- Mỗi implement/review gọi subprocess mới; không gửi toàn hội thoại Coordinator. Context gồm spec excerpt, acceptance, bounded file contents và diff do Coordinator đóng gói.
- Implementer trả unified patch, không shell command. Coordinator chạy RED/GREEN bằng argv trong approved packet, `shell=False`; workers không được tạo/thay command.
- Tool flags/resource disabling giảm khả năng hành động, **không phải OS sandbox**. No-tools protocol must reject any tool execution event. Không cấp filesystem tools hoặc bash trong pilot. Model-generated tests/code vẫn không tin cậy: commands do Coordinator chạy phải đi qua verifier Bubblewrap của Task5, không chạy trực tiếp trên host. Bubblewrap binary đã thấy trên PATH nhưng chưa xác minh user-namespace capability; capability thiếu → blocked, không fallback host. Thay verifier/package scripts cần review riêng trước chạy.
- Sandbox verification Linux: `bwrap --unshare-all --die-with-parent --new-session`; readonly bind system `/usr`, `/bin`, `/lib` và `/lib64` khi tồn tại; readonly bind selected Node version directory tới `/opt/node`; bind duy nhất child fixture workspace tới `/workspace`, cwd là repo-relative bên trong; tmpfs `/tmp` và HOME, private `/proc`/`/dev`. Không bind parent repo/git-common-dir, host home, Pi auth, kubeconfig, Docker socket hay `/etc` toàn bộ. Clear environment, chỉ set PATH/HOME/CI/HUSKY=0/npm offline/cache và artifact vars đã duyệt. Network off; dependencies/cache phải chuẩn bị trước bởi Coordinator có approval, thiếu cache/package/browser → blocked. Pilot chỉ FE/unit fixtures; .NET Testcontainers và real-backend browser network cần approval/profile fixture riêng trong plan MVP, không mở host socket bằng suy đoán.
- Runtime resume không khôi phục session LLM: đối soát manifest rồi tạo attempt mới. Không triển khai SDK extension, custom tools, server queue hoặc persistent agent memory.
- Run artifact root: `<execution-worktree>/.superpowers/network-agents/<task-id>/<attempt>/`; permission dirs0700/files0600, phải git-ignored trước chạy. Không commit logs.
- Coordinator singleton lock: `<git-common-dir>/network-agent-coordinator.lock/`, atomic mkdir; owner UUID/PID/start identity và manifest paths. Lock cũ luôn blocked cho tới khi người dùng cho phép reconciliation; không auto-delete theo PID/timestamp.
- `git worktree` không là khóa file scopes. Coordinator kiểm tra registry reservations và report active owners; mọi task chung scope/path ancestor bị serialize. Không sửa platform PLAYBOOK/CLAIMS trong pilot; giữ service-level reservation, task-level reservation chỉ trong manifests.

### Documentation/runtime references đã đọc khi lập plan

Pi installed docs: `rpc.md`, `rpc-commands.md`, `json.md`, `rpc-extension-ui.md`, `message-types.md`, `session-format.md`, `cli.md`, `cli-integration.md`, `security.md`, `containerization.md`; example `examples/rpc-client.ts`. Khi execution, đối chiếu lại `pi --help/--version`; không dựa vào absolute docs path trên máy khác.

## File map

`A` = `water-network/water-network-be/scripts/network_agents/` (directory mới, không trùng shw-mvp).

| Files mới | Trách nhiệm |
|---|---|
| `A/wn_packet.py`, `test_packet.py` | Parse task/worker/review contracts, budgets, state/manifest |
| `A/wn_audit.py`, `test_audit.py` | Read-only worktree/claims inventory và HEAD-bound report |
| `A/wn_rpc.py`, `test_rpc.py`, `fixtures/fake_pi.py` | Pi lifecycle, framing, cancel, usage, fake runtime |
| `A/wn_guard.py`, `test_guard.py` | Singleton/reservations, context bounds, patch/dirty scope |
| `A/wn_coordinator.py`, `test_coordinator.py` | RED/GREEN/reviews/evidence state machine |
| `A/wn_verify.py`, `test_verify.py` | Sandbox command execution, fresh counters/evidence và isolation probes |
| `A/cli.py`, `test_cli.py`, `README.md` | preflight/audit/run/reconcile CLI và operator runbook |
| `A/packets/shw-canonical-lookup.json` | Pilot template, không dispatch trước HEAD/handoff approval |

Documentation mới: `water-network/water-network-be/docs/reports/2026-10-06-network-agent-baseline.md`; `.../docs/reports/2026-10-06-network-agent-pilot.md`; ADR `.../docs/decisions/0031-patch-only-subagent-pilot.md` chỉ nếu number0031 còn trống trên execution branch (nếu đã dùng, chọn next free number, ghi evidence, không overwrite). README script giải thích số ADR thực.

Không sửa WIP plans ở main. Evidence MVP cập nhật trên nhánh được bàn giao đúng task; docs của cơ chế có thể nằm trong branch isolation riêng. Integration của hai branch cần approval riêng.

## Contracts dùng xuyên các tasks

`TaskPacket` dataclass: `id:str`, `spec_path:str`, `acceptance_ids:list[str]`, `dependencies:list[str]`, `base_commit:str`, `worktree:Path`, `owner:str`, `allowlist:list[str]`, `context_paths:list[str]`, `write_scopes:list[str]`, `red:VerificationCommand`, `green:list[VerificationCommand]`, `budget:Budget`, `provider:str`, `model:str`, `approval_ref:str`, `handoff_ref:str`.

`Budget`: `attempt_seconds=1800`, `task_seconds=7200`, `review_fix_rounds=2`, optional `cost_usd:float|None` and `tokens:int|None`; larger time/retry limits require explicit recorded approval. Cost/token caps are reported-usage thresholds, not guaranteed hard billing limits; unknown usage may only run without monetary cap if packet acknowledges unavailable metering.

`VerificationCommand`: `argv:list[str]`, `cwd:str` repo-relative, `timeout_seconds:int`, `discovery:str` (`trx|vitest|unittest|none`), `acceptance_ids:list[str]`. Execution reads command only from packet approved hash. No shell strings, env expansion or model-selected cwd.

`WorkerResult`: `phase:str` (`test|implementation`), `patch:str`, `acceptance_ids:list[str]`, `summary:str`. Reject extra fields, oversized output (>1MiB), empty patch for required gap, binary patch, unrelated acceptance IDs.

`ReviewResult`: `decision:str` (`approve|request_changes`), `output_commit:str`, `findings:list[Finding]`. `Finding`: `severity:str`, `path:str`, `line:int|None`, `acceptance_id:str`, `message:str`; findings must reference allowed context/diff and known acceptance. Blocking/high/medium findings forbid approve; low findings are recorded for Coordinator decision, not silently discarded.

`RunResult`: `run_id:str`, `session_id:str|None`, `status:str` (`settled|failed|cancelled|blocked`), `text:str|None`, `usage:dict|None`, `reason:str|None`.

`RunManifest`: task/packet hash, attempt/review round, owner/base/output commits, state, process identity, run/session IDs, timestamps, remaining budget, command/review/evidence refs. `implemented` means scoped output commit exists; verified requires both independent approvals and fresh checks on exact output.

## Execution workspace prerequisite

Sau khi plan và execution method được duyệt, dùng using-git-worktrees để tạo workspace cơ chế tại `/home/dannv/Workspace/TECHGEN/water-platform-network-agents`, branch `feat/network-agent-runtime`, từ exact committed documentation HEAD được người dùng chấp thuận. Kiểm tra path/branch chưa tồn tại và có owner khác hay không trước tạo; conflict → stop, không reuse tự động. Chỉ tracked committed base, không mang WIP ở main. Ghi base SHA và inventory ban đầu vào report; baseline stdlib/syntax checks trước triển khai. Product pilot dùng child branch riêng ở Task6. Không tạo worktree trong phiên planning này.

## Task 1: Read-only audit và workspace handoff report

**Files:** Create `A/wn_audit.py`, `A/test_audit.py`, baseline report. Read platform claims, `git worktree list --porcelain`, main status and MVP plans/reports; không sửa code sản phẩm.
**Interfaces:** `collect_inventory(repo:Path)->dict`; `render_audit(inventory:dict)->str`. Fixed git argv only; produces HEAD/time-bound owners, paths/status và requirement→existing source→historical evidence→fresh gap matrix, không dump file/secret contents.

- [ ] **Step1 — Tests:** `test_inventory_keeps_foreign_owner_reserved`, `test_dirty_main_not_copied`, `test_missing_claim_worktree_is_unresolved_not_free`, `test_historical_test_counts_not_fresh_pass`. Temporary Git repo/worktree fixtures; assert reserved=true for any active owner, no file copy/status mutation and historical result has freshness=false.
- [ ] **Step2 — RED:** `python3 -m unittest discover -s water-network/water-network-be/scripts/network_agents -p 'test_audit.py' -v`; expected missing module/function failure, không tool prerequisite failure.
- [ ] **Step3 — Implement:** functions trên bằng subprocess fixed argv, JSON claim parsing; malformed claims block affected scope; branch names arbitrary, không chỉ feat/*; git status includes untracked. Report actual current HEAD, không hard-code historical IDs làm base.
- [ ] **Step4 — GREEN và audit:** run test command; run read-only inventory từ CLI tạm `python3 water-network/water-network-be/scripts/network_agents/wn_audit.py --repo .`; output baseline report có main WIP, MVP owner/handoff required và các nhánh import/zone. Ghi tool versions chỉ bằng safe help/version, không login/credential refresh.
- [ ] **Step5 — Commit:** stage only module/test/report, commit `docs(network): audit subagent pilot ownership and baseline`. STOP product dispatch đến khi handoff ghi owner, exact HEAD, scope và quyền workspace. Main WIP giữ nguyên.

## Task 2: Packet validation, budgets và durable state

**Files:** Create `A/wn_packet.py`, `A/test_packet.py`.
**Interfaces:** dataclasses ở Contracts; `load_packet(path:Path, repo:Path)->TaskPacket`; `transition(manifest:RunManifest, next_state:str, facts:dict)->RunManifest`; `save_manifest(path:Path, manifest:RunManifest)->None`. Atomic temp-write/fsync/replace trong cùng dir; Coordinator writer only.

- [ ] **Step1 — Tests:** `test_default_budget_1800_7200_2`, `test_path_escape_and_secret_context_rejected`, `test_unknown_field_and_missing_approval_rejected`, `test_green_not_verified_without_reviews`, `test_changed_commit_invalidates_reviews_and_checks`, `test_round3_or_elapsed7200_stops`, `test_atomic_save_preserves_previous_on_failure`. Assertions constants như tên test; invalid transition raises ValueError; old manifest survives injected write failure.
Default-budget assertions trong `test_packet.py`:
```python
budget = Budget()
self.assertEqual((budget.attempt_seconds, budget.task_seconds, budget.review_fix_rounds), (1800, 7200, 2))
```

- [ ] **Step2 — RED:** unittest discover `-p 'test_packet.py' -v`.
- [ ] **Step3 — Implement:** reject absolute/.. paths for context/allowlist/cwd; normalize separator; deny `.env*`, kubeconfig/auth/credential keys, symlinks escaping approved tree, external artifact refs. State machine của spec; terminal release transitions cần explicit approval+evidence facts, CLI run không được tự tạo facts đó. Stopwatch monotonic khi process sống, persist elapsed đã dùng và charge downtime từ UTC timestamp khi resume (clock regression → blocked); retries không reset total budget.
- [ ] **Step4 — GREEN:** same tests; packet schema rejects tasks needing production rights. Manifest command/review evidence contains hash/base/output identities, not assistant claim strings.
- [ ] **Step5 — Commit:** `feat(network-agents): validate packets budgets and run state` scoped module/tests only.

## Task 3: Pi RPC adapter và failure/cancellation tests

**Files:** Create `A/wn_rpc.py`, `test_rpc.py`, `fixtures/fake_pi.py`.
**Interfaces:** `PiRpcRunner(executable:list[str], cwd:Path, provider:str, model:str)`; `start(prompt:str, timeout_seconds:int)->str` returns run ID immediately; `poll(run_id:str)->RunResult`; `cancel(run_id:str)->RunResult`; `close()->None`. Each runner handles one subprocess, drain stdout/stderr concurrently before sending prompt; IDs UUID, session ID from get_state.

- [ ] **Step1 — Tests fake runtime:** LF/CRLF and embedded U+2028; out-of-order responses; accepted-before-settled; agent_end→retry→settled; terminal assistant error/aborted/deferred/length; prompt handled-without-run; malformed JSON/EOF; stderr floods; tool event violation; no-tools launch args. Assert only settled + final assistant stop + valid nonempty result yields success; handled and queued are protocol failure in this single-prompt runner.
- [ ] **Step2 — RED:** unittest discover `-p 'test_rpc.py' -v`; no provider calls in automated tests.
- [ ] **Step3 — Implement:** binary LF framing, 1MiB max record/result, unknown informational events tolerated but unknown terminal/invalid records fail closed. Confirm startup get_state and set_auto_retry(false) response before prompt; drain/subscribe first to avoid fast-settled race. `prompt success` is not completion. After settled, get_last_assistant_text/get_session_stats with unique IDs; failure after accepted tracked via assistant stopReason/error and events. Usage missing/zero-price unknown is unavailable, not free.
- [ ] **Step4 — Cancellation tests:** send clear_queue→abort_retry→abort; close stdin, await child max5 seconds; process-group TERM then KILL max5 seconds each. Process identity includes start marker, not PID alone. Fake hangs and descendant fixtures must leave no running process; uncertain death returns blocked/reserved, never ready. Cancel/timeouts retain elapsed budget and output summary.
- [ ] **Step5 — GREEN:** full RPC tests. Persist only sanitized event metadata (type/time/IDs/status/usage), no raw message/tool args/thinking/stderr/prompt logs. Known supplied secrets redacted from diagnostics; secret-bearing outputs block. Commit `feat(network-agents): add bounded patch-only Pi RPC runtime`.

## Task 4: Scope guard và Coordinator RED/GREEN/review pipeline

**Files:** Create `A/wn_guard.py`, `test_guard.py`, `wn_coordinator.py`, `test_coordinator.py`.
**Interfaces:** `reserve(packet:TaskPacket, active:list[dict])->None`; `validate_patch(packet:TaskPacket, patch:str)->None`; `apply_patch(packet:TaskPacket, patch:str)->None`; `collect_context(packet:TaskPacket)->str`; `Coordinator.run(packet:TaskPacket)->RunManifest`; `Coordinator.reconcile(task_id:str)->RunManifest`. Task3 runner injected for tests; no model-generated argv.

- [ ] **Step1 — Tests guard:** ancestor-scope overlap, foreign worktree reservation, stale lock, changed/dirty base; patch traversal/rename/copy/binary/mode change/symlink; untracked outside allowlist. Context total ≤200KiB, per file≤50KiB UTF8 text; overflow raises needs-smaller-task, never silent truncation. Test secret filenames, supplied secrets and relative-link escape. Assert filesystem untouched for rejected patch.
- [ ] **Step2 — Tests pipeline:** test patch→named assertion RED→implementation patch→GREEN; failed RED import/collection/setup is blocked, not valid regression; two distinct fresh reviewer runs on exact commit; approve wrong commit rejected; edit after review invalidates; GREEN before reviews not verified; exhausted fixes/budget stop; no auto release. Exercise all five Review Focus items owned here with fake Pi/verifier processes.
- [ ] **Step3 — RED:** unittest discover `-p 'test_guard.py'`, then `-p 'test_coordinator.py'` (each `-v`).
- [ ] **Step4 — Implement guard:** singleton mkdir under actual git common dir, explicit owner/handoff check, path scopes reserved by one Coordinator. Check clean isolated base; dirty resume allowed only recorded prior patch digest. `git apply --check` then apply from stdin after strict text path/header validation, no binary/mode/rename/copy directives. Reject symlink path components; check staged/unstaged/untracked scope before and after. Worker changes to verifier/packet/ledger/package scripts forbidden unless those files are the explicitly reviewed task. Do not auto revert unexpected diffs.
- [ ] **Step5 — Implement pipeline:** fresh context for test patch; run approved RED (assert named test fails for missing behavior), new worker for implementation patch; run GREEN; Coordinator creates scoped local commit then spec and quality reviewer subprocesses read exact commit/diff. Fix findings ≤2 rounds, new output commit and both reviews rerun. Then final approved checks on exact HEAD; set awaiting-integration-approval after verified. Use monotonic bounded semaphores max2 runtime processes. Concurrent tasks must have disjoint scopes/worktrees and fulfilled dependencies; independent reviews may run in parallel on same immutable commit.
- [ ] **Step6 — GREEN:** full stdlib tests, process fixtures and diff assertions; commit `feat(network-agents): enforce scoped patches and independent review gates`. Review role rejects non-JSON results or unknown approval keys; optional low findings require documented disposition before verified.

## Task 5: CLI, evidence verification và executable smoke

**Files:** Create `A/wn_verify.py`, `test_verify.py`, `cli.py`, `test_cli.py`, `README.md`; ADR patch-only pilot. Modify `wn_coordinator.py` only for CLI/evidence integration.
**Interfaces:** `main(argv:list[str]|None)->int`; commands `audit --repo`, `preflight --packet`, `run --packet`, `reconcile --task-id --artifact-root`. `run_verification(command:VerificationCommand, packet:TaskPacket, artifacts:Path)->dict` and `validate_evidence(command:VerificationCommand, artifacts:Path, output_commit:str)->dict` in wn_verify.py; reuse existing `scripts/shw-mvp/assert_trx.py` from handed-off branch, không rewrite TRX logic. stdout summary JSON only; exit0 success,2 blocked/precondition,1 failed verification/runtime.

- [ ] **Step1 — Tests:** verify argv/environment/mount allowlist, no host-home/socket bind, no host-execution fallback on bwrap failure; real isolation probe uses temporary harmless sentinel outside workspace and asserts inaccessible, network namespace isolated and host paths unchanged. Test missing pi/model/approval/handoff, no stale TRX, zero tests, failed/skipped-only unit suite, mismatch packet or output commit, corrupted review JSON, secrets never persisted, max2 parallel fixture runs, scope overlap refused. Use fresh per-command output directories and fixture TRX/JUnit; require Vitest JUnit total>0 failures/errors=0 (and every required acceptance test executed, not skipped). Unittest runner includes explicit discovered count in Coordinator-owned summary, not grepping assistant prose.
- [ ] **Step2 — RED:** unittest discover `-p 'test_verify.py' -v`, then `-p 'test_cli.py' -v`.
- [ ] **Step3 — Implement:** preflight no provider calls, no writes outside artifact/lock directories; versions compared installed1.0.0 and verified flags/protocol, drift blocks pending compatibility smoke. Packet/report/input hashes freeze approved context; use fixed cwd/argv commands, clean fixture env with no operational credentials. run records fresh evidence output paths+hashes and validates count/exit; check commands against immutable approved packet, not result content. wn_verify builds fixed Bubblewrap policy above; node executable/path and repo-relative artifacts are translated to sandbox paths. Do not evaluate returned shell syntax. Runtime smoke has no tools; verification smoke must prove the OS boundary. Approval refs must resolve to Coordinator-recorded exact packet SHA256, not a model-created string. Include `get_session_stats` reported metering thresholds if configured; task time limits always enforced.
- [ ] **Step4 — GREEN offline:** `python3 -m unittest discover -s water-network/water-network-be/scripts/network_agents -p 'test_*.py' -v`; require count>0 and no skip substituting an isolation/protocol gate. Run fake task pair that edits distinct disposable Git files, then two reviewers+integrator checks; cancellation/failure variant must stop and retain reservation when unresolved.
- [ ] **Step5 — Live RPC smoke after provider/model/cost approval:** two no-tools jobs return fixture JSON with Unicode; separate rejected-format job; cancellation of bounded long response. No product files/tools. Store IDs/status/time and usage availability, no raw transcript; prove process shutdown and task budget. Missing credentials/capability → blocked, no `/login` or print tokens. Coordinator tạo candidate local commit `feat(network-agents): expose pilot CLI and runbook`, rồi hai reviewers fresh đọc exact commit/toàn diff của cơ chế; chỉ ghi verified sau review và fresh tests. Nếu sửa tiếp, tạo commit mới và rerun reviews/checks. Thiếu reviewer runtime không được mô tả là independent review.

## Task 6: Freeze pilot packet từ nhánh MVP đã bàn giao

**Files:** Create `A/packets/shw-canonical-lookup.json`, pilot report; update baseline audit report only after owner/handoff.
**Interfaces:** Produces packet for Task7 with actual approved current base_commit, literal provider/model, fixed commands and acceptance IDs below. No dispatch while any value is unresolved; template empty required values deliberately fail preflight until filled by Coordinator and reviewed.

- [ ] **Step1 — Re-audit:** main/WIP vs current MVP HEAD; read MVP01 Task5 evidence. Historical `17970eaa` has public API/AssetProfile/canonical wrapper but no public search/fly-to UI in TenantMapViewer. If now implemented, task becomes verification/fix observed failure only; do not recreate.
- [ ] **Step2 — Handoff approval:** owner confirms no active writer, exact HEAD/worktree and allowed paths. Recommend new child worktree branch `feat/network-agent-canonical-lookup` based on handed-off clean MVP HEAD using using-git-worktrees at execution; no cherry-pick/rebase parent or auto copy WIP. Mechanism branch commit integration requires explicit permission; alternatively run reviewed scripts from their worktree against clean child without copying them into product tree.
- [ ] **Step3 — Packet:** xác minh child không chứa operational env/credential files trong sandbox-visible tree; không mang main WIP hoặc host secrets. Kiểm kê selected Node/toolchain và offline dependency cache chuẩn bị trước; thiếu prerequisite cần approval hydration riêng, không tự mở network trong sandbox. Allow only Task7 Files, write scope canonical lookup; dependencies MVP01 Tasks1–4 source verified plus fresh affected-suite checks; context includes map port/scoped API/profile/session and existing tests, no `.env.vps` or production endpoints. Budget1800/7200/2 and local commit only. Artifacts git-ignored in child. RED target Vitest test names in Task7, GREEN full FE verifier. Add JUnit reporter path inside fresh artifact directory for targeted suite.
- [ ] **Step4 — Preflight/test:** run CLI `python3 water-network/water-network-be/scripts/network_agents/cli.py preflight --packet water-network/water-network-be/scripts/network_agents/packets/shw-canonical-lookup.json`; expect planned/ready only when actual hashes/owners/commands approved; missing handoff fixture must exit2. Test template rejection through unittest, not fake success placeholder.
- [ ] **Step5 — Review packet:** user reviews actual HEAD/context/commands/cost choice and workspace; then commit packet/report scoped, `docs(network-agents): freeze canonical lookup pilot packet`. This gate cannot be replaced by global approval of this plan.

## Task 7: Pilot public search → fly-to → profile (MVP01 Task5 subset)

**Files (on child MVP branch):** Modify `water-network/water-network-fe/apps/gis/src/pages/gis/map-page.tsx` and adjacent `map-page.test.tsx`; Create `.../src/pages/gis/screens/canonical-map.test.tsx`, `.../src/entities/gis/asset-geometry.ts` and `asset-geometry.test.ts`. Modify `.../src/pages/gis/screens/canonical-map.tsx` only if wiring requires prop changes. Reuse `entities/gis/asset-queries.ts` and `widgets/asset-inspector/asset-profile.tsx` unchanged; changing their API requires packet/review update. No package/lock/gateway changes.
**Interfaces:** keep `CanonicalMapScreen({bootstrap:GisBootstrap})` and `TenantMapViewer({homeView:PreparedTenantHomeView,scope?:string})` public signature; canonical public search/profile only when scope nonempty, preserve legacy viewer path otherwise. `assetGeometryExtent(geometry:unknown):[number,number,number,number]|null` in asset-geometry.ts: parse only Point/LineString (LineString ít nhất2 positions) finite longitude[-180,180]/latitude[-90,90], null malformed/unsupported, handle zero-area point with existing fit maxZoom behavior, never fit raw CAD coordinates. Search uses `createAssetReadApi(scope).searchAssets(filters,signal)`, overview authoritative geometry via `assetOverview(id,kind,signal)`; profile uses existing AssetProfile props. No map engine rewrite.

Acceptance IDs:

- `LOOKUP-1`: server search finds outside-viewport asset without full tenant load; enter selects result, obtains authoritative overview, calls MapEnginePort.fitToBbox and viewport request moves to target.
- `LOOKUP-2`: canonical map click/search selection shows public AssetProfile, source unavailable degrades, malformed/missing GIS geometry produces actionable error, never fit wrong coords.
- `LOOKUP-3`: changed Organization/user and late search/detail/map response cannot repaint/select old asset; 404 clears selection/profile; close clears port selection.
- `LOOKUP-4`: no `/editor/assets` full network or initial full extent query; preserve basemap/layer visibility/current viewport logic and legacy/import/editor routes.

- [ ] **Step1 — Test patch from implementer:** Vitest `search_outside_viewport_flys_to_asset`, `deleted_search_result_clears_selection`, `organization_change_discards_pending_lookup`, `invalid_geometry_never_fits_map`, `canonical_map_uses_public_profile_and_preserves_layers`, legacy runtime regression; geometry unit cases Point, LineString, NaN/range/unsupported. Use fake map port and delayed HTTP mocks, actual components/session/scoped API; assert request query and fit arguments, not just render text. Query keys include scope+filters; cancellation/disposal owns all pending writes.
Geometry assertions trong `asset-geometry.test.ts`:
```typescript
expect(assetGeometryExtent({ type: 'Point', coordinates: [105.5, 20.5] })).toEqual([105.5, 20.5, 105.5, 20.5])
expect(assetGeometryExtent({ type: 'Point', coordinates: [500000, 2300000] })).toBeNull()
expect(assetGeometryExtent({ type: 'LineString', coordinates: [[105, 20], [106, 21]] })).toEqual([105, 20, 106, 21])
```

- [ ] **Step2 — RED via Coordinator (sandbox wrapper Task5):** `npm --prefix water-network/water-network-fe/apps/gis run test:run -- src/pages/gis/map-page.test.tsx src/pages/gis/screens/canonical-map.test.tsx src/entities/gis/asset-geometry.test.ts`; required new acceptance test assertions fail, setup/import errors block. JUnit reporter enabled in packet to verify discovery, no silent missing tests.
- [ ] **Step3 — Implementation patch from fresh worker:** scoped server search UI in TenantMapViewer canonical mode, loading/error/empty results, no full dataset scan; selected id+kind and request generation/scope guard; fit authoritative overview geometry then fetch viewport. During viewport transitions keep intent only for current scoped lookup, never preserve unrelated stale feature; malformed/404 clears intent. Public AssetProfile canonical path; old AssetInspector only legacy path.
- [ ] **Step4 — GREEN affected suites (sandbox wrapper Task5):** targeted Vitest, then `bash water-network/water-network-be/scripts/shw-mvp/verify.sh --suite fe` in child worktree; artifact directory fresh; expected full positive test counts, typecheck/build/size, lint0 errors ≤180 and no increase against recorded child baseline. Tool prerequisites failure blocks, not auto install/upgrade.
- [ ] **Step5 — Reviews/integration:** Coordinator local commit; two fresh no-tools reviewers exact diff/commit and acceptance evidence. Address findings within cap. Final affected checks on exact commit, report LOOKUP1–4 fixture verification; whole runtime/product diff review independently before any integration proposal. No auto cherry-pick/merge.
- [ ] **Step6 — Real-backend/browser gate:** this pilot subset stops at verified-source if real read journeys cannot be run within existing fixture approvals. MVP01 Task5 remains incomplete until its real fixture≥10.000, outside-viewport browser journey, memory/bytes/latency, stale/session/dashboard gates pass. No invented numbers or live SHW mutation. Remaining product tasks stay in the three existing MVP plans, not new duplicates.

## Self-review / coverage

Spec1–3 intent/ownership → constraints+Task1+Task7; spec4 runtime/roles → Tasks3–5; spec5 packets/manifests → Task2+Task6; spec6 isolation/handoff → Task1/4/6; spec7 failure/budget/resume → Task2–5; spec8 permissions → preflight/policy/no-tools and Task6 gate; spec9 pilot → Task7 subset plus existing MVP plans; spec10 later phases → deferred, separate spec/plan cycles; spec11 all orchestrator acceptance scenarios → offline/fake/live tests Tasks2–5; spec12 deliverables → README/report/packet/handoff.

No requirement claims a live runtime verified in this planning session. Only CLI help/version and source/docs were inspected; no provider calls, installs, product tests or cluster access. All execution checkboxes remain unchecked.

## Completion và execution selection

- [ ] Audit ownership, approved workspace/base/side-effects recorded; original WIP unchanged.
- [ ] Stdlib tests/fake processes exercise runtime, overlap, malicious patch, review, budgets, count0 and resume.
- [ ] Live no-tools runtime smoke independently verified with provider/model approval and usage limits.
- [ ] Pilot exact commit has independent spec/quality reviews and fresh checks; remaining MVP gates explicitly incomplete.
- [ ] Branch review/report produced; no merge/push/deploy/SHW acceptance claim without separate approval.

**Recommended execution:** subagent-driven sau khi adapter Tasks1–5 đạt gates. Bootstrap Tasks1–5 dùng inline execution vì phiên hiện tại chưa có dispatch tool; fake workers chỉ là tests, không independent agents. Sau live smoke, Tasks6–7 dùng real subprocess subagents. Người dùng cần duyệt plan và lựa chọn phương án kết hợp này (hoặc inline toàn bộ, ghi rõ giới hạn independent review) trước implementation. Workspace/handoff và provider/model/cost cho live calls là approvals cụ thể ở Tasks1/5/6, không suy từ lựa chọn phương pháp.
