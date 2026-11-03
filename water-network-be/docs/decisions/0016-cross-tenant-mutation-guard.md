# 0016 — Cross-Tenant Mutation Guard (US-X-01)

**Status:** Accepted — 2026-06-17
**Context:** Security (multi-tenancy)

## Decision

Mutation command handlers in gis-be and asset-be loaded aggregates by id only,
so a caller in tenant B who knew an id owned by tenant A could mutate it. We add
a per-interface overload `GetByIdAsync(string tenantId, string id, ct)` that
filters `WHERE id = @id AND tenant_id = @tenantId`. Load-then-mutate handlers
call it with the caller's `tenant.TenantId`; a mismatch returns null and the
existing `?? throw NotFoundException` yields **404** (not 403 — avoids
id-enumeration).

## Why an overload, not a base-contract change

`IAggregateRepository<T>` is extended by asset-be and design-be repos, and in
gis-be the id-only `GetByIdAsync` is shared with `RegisterPipe`/`InstallDevice`
reference lookups (scope b, deferred). Changing the base signature would force
~10 design-be call sites (incl. two event consumers) to thread a tenant and
would silently activate reference guard (b). The overload contains the change to
scope (a). It follows the existing `IDraftNetworkAssetRepository.GetByIdAsync(tenantId, id)`
precedent.

## Consequences

- The id-only `GetByIdAsync(id)` still exists (used by reference lookups and
  consumers), so a future load-then-mutate handler could call the wrong overload.
  Mitigated by per-service cross-tenant integration tests; revisit with a
  base-contract or analyzer guard if a third service repeats the pattern.
- Reference guard (b) and design-be remain out of scope (deferred).
- `DeleteAsync(id)` is unchanged: the handler's tenant-scoped load 404s before
  any delete, and the delete re-loads the same globally-unique row.
- Follow-ups surfaced during review (read-path defence-in-depth, non-blocking):
  `NetworkAssetRepository.ExistsAsync(assetId)` and `AssetReadDao` lifecycle SQL
  filter on id only; safe today (ids are globally-unique PKs and the read path is
  already tenant-scoped at the outer query), but candidates for an explicit
  tenant predicate if these are ever reused as tenant-scoped gates.
