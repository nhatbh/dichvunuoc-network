# US-X-01 — Cross-Tenant Mutation Guard (Design)

**Date:** 2026-06-17
**Status:** Approved (brainstorming) — ready for implementation plan
**Slice:** US-X-01 (cross-cutting security), scope (a) only
**Services:** `water-network-gis-be`, `water-network-asset-be`, building-blocks
**Related decision record:** `docs/decisions/0016-cross-tenant-mutation-guard.md` (to be written)

## 1. Problem & Threat

Every mutation command handler loads its aggregate by id only:

```csharp
var asset = await repository.GetByIdAsync(command.AssetId, ct)
    ?? throw NotFoundException.Entity("NetworkAsset", command.AssetId);
asset.Suspend(...);
await repository.SaveAsync(asset, ct);
```

`GetByIdAsync(id)` filters on `id` alone (see `NetworkNodeRepository.cs:22`,
`NetworkAssetRepository.cs:24-31`). The handler reads the caller's tenant from
`ITenantContextAccessor` but never compares it against the loaded aggregate's
`TenantId`. Therefore **an authenticated caller from tenant B who knows an
asset/node id belonging to tenant A can suspend / decommission / relocate /
soft-delete that asset.**

Read-path is already tenant-scoped (Dapper read DAOs). There is no EF global
query filter in place. The gap is exclusively on the EF mutation load path.

This is the ⚠️ HIGH item recorded in `docs/stories/backlog.md` ("Cross-tenant
mutation guard (cross-cutting, gắn US-X-01)").

## 2. Decision: dedicated tenant-scoped load overload (approach A′)

Make the *mutation* load path tenant-aware. Each affected repository interface
gains a **new overload** `GetByIdAsync(string tenantId, string id, ct)` that
filters `WHERE id = @id AND tenant_id = @tenantId`. On tenant mismatch (or
genuine absence) it returns `null`, and each handler's existing
`?? throw NotFoundException` produces a **404**.

**404, not 403** — a 403 would confirm the id exists under another tenant,
enabling id-enumeration. A cross-tenant request is indistinguishable from a
"not found" request to the caller.

No new exception type is introduced; the existing null-coalescing throw is reused.

### Why an overload, not a base-contract change (revised after code review)

The original plan was to change the shared
`IAggregateRepository<T>.GetByIdAsync` signature. Inspecting the codebase
surfaced two facts that make that the wrong move for this slice:

1. **The codebase already establishes a per-interface precedent.**
   `IDraftNetworkAssetRepository` already declares
   `GetByIdAsync(string tenantId, string id, ct)` as its own method — tenant-
   scoped load is done per-interface, not via the base contract.
2. **Changing the base contract bleeds out of scope.** `IDesignRevisionRepository`,
   `IDesignProjectRepository`, `IDesignDocumentRepository`, and
   `INetworkAssetRepository` all extend `IAggregateRepository<T>`, so a base
   change forces ~10 design-be call sites (8 command handlers + the
   `GisImportCompletedConsumer` and `RevisionApprovedPublishConsumer` event
   consumers) to thread a tenant. Worse, in gis-be the **same**
   `nodeRepository.GetByIdAsync` is shared between mutation handlers (scope a)
   and the `RegisterPipe` / `InstallDevice` endpoint/host lookups (scope b).
   A required-tenant base signature forces those lookups to pass a tenant too,
   which silently activates reference guard (b) — explicitly deferred for this
   slice.

The overload keeps the existing `GetByIdAsync(id, ct)` for reference lookups and
consumers (behaviour unchanged → (b) stays deferred, design-be untouched), and
adds the tenant-scoped overload used only by the load-then-mutate handlers. The
tenant **filtering logic lives in each concrete repository** (it queries the
persistence model, which carries `TenantId`).

Trade-off accepted: the unsafe `GetByIdAsync(id)` still exists, so a future
load-then-mutate handler could call the wrong overload. Mitigated by the
per-service cross-tenant integration test and a note in the decision record.

## 3. Affected components

| Layer | Change |
|---|---|
| gis-be interfaces | `INetworkNode/Pipe/DeviceRepository`: **add** overload `GetByIdAsync(string tenantId, string id, ct)` (keep existing id-only method) |
| gis-be repos | `NetworkNode/Pipe/DeviceRepository`: implement the overload with `x.Id == id && x.TenantId == tenantId` |
| gis-be handlers | `RelocateNodeCommandHandler` (already has tenant) → call overload; `RemoveNode/Pipe/DeviceCommandHandler` → **inject `ITenantContextAccessor`** (they currently do not) + tenant null-guard + call overload for the initial load |
| asset-be interface | `INetworkAssetRepository`: add overload `GetByIdAsync(string tenantId, string id, ct)` |
| asset-be repo | `NetworkAssetRepository`: implement the overload with tenant filter |
| asset-be handlers | `Activate / MarkAsMaintenance / Suspend / Decommission / UpdateTechnicalProfile` (all already have `tenant`) → call overload |

**Untouched (by design):** building-blocks `IAggregateRepository<T>` base; all of
design-be; gis `RegisterPipe` / `InstallDevice` reference lookups; `DeleteAsync`
(the handler's tenant-scoped load 404s before any delete, and `DeleteAsync(id)`
re-loads the same globally-unique row); `PersistAsync`'s id-keyed lookup (operates
on an already tenant-verified aggregate); read DAOs (already tenant-scoped).

## 4. Behaviour & tests (TDD — test before implementation)

- **Unit, per mutation handler:** when the repository returns `null` for a
  tenant-mismatched id, the handler throws `NotFoundException` and never calls
  `SaveAsync`. (Mock repo returns null unless `tenantId` matches.)
- **Integration, per service ("tenant A is invisible to tenant B"):** seed an
  asset/node under tenant A; a caller authenticated as tenant B issues each
  mutation → **404**, and the row in the DB is unchanged (version not bumped, no
  outbox row written).
- **Repository integration:** `GetByIdAsync(id, otherTenant)` returns `null` for
  a row owned by a different tenant; returns the aggregate for the owning tenant.
- **Regression:** all existing same-tenant unit/integration tests stay green.

## 5. Out of scope (remain deferred)

- **Reference guard (b):** cross-tenant `fromNode/toNode` endpoints on
  `RegisterPipe`, host refs on `InstallDevice`. (Backlog GIS-3 follow-up.)
- **design-be** — untouched entirely in this slice.
- **Base-contract change** to `IAggregateRepository<T>` and **EF global query
  filter** — both considered and rejected (see §2).

## 6. Definition of Done

Per roadmap §17: handler rules tested (cross-tenant unit + integration per
service), no migration needed, tenant-isolation integration test added,
`dotnet test` green with 0 warnings for both `gis-be` and `asset-be`, decision
record `0016` committed, conventional commit.
