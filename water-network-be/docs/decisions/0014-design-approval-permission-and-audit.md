# 0014 — Design revision approval: permission enforcement + audit trail

**Status:** accepted
**Date:** 2026-06-16
**Slice:** DSN-3 (US-P2-05); first activation of cross-cutting US-X-01.

## Context

DSN-3 introduces the first permission-sensitive action in the platform (approving a
design revision) and the first per-transition audit requirement.

## Decision

1. **Policy naming `<context>:<action>`.** Approval/rejection require `network-design:approve`;
   submit requires `network-design:write`. Enforced at the endpoint via
   `RequirePermission(...)` (claim `permission`), the helper in `BuildingBlocks.Security`.
2. **Audit via append-only table.** Every revision transition is recorded in
   `design_revision_transitions` (`from`/`to`/`actorId`/`reason`/`correlationId`/`occurredAt`),
   mirroring `asset_lifecycle_entries`. Never updated or deleted.
3. **Actor sentinel.** When the request carries no `UserId` claim, the actor is recorded as
   `"unknown"` (clearer for audit than reusing the tenant id; supersedes the DSN-1 fallback).
4. **Reject returns to Draft.** Rejection moves the revision back to `Draft` and clears
   `ValidationResult`, forcing re-validation after edits. Reason is mandatory on reject.
5. **Tenant scope.** Cross-tenant access yields 404 (load is tenant-scoped, hides id-enumeration).

## Consequences

- Keycloak real roles are out of scope (deferred per roadmap §15.2); Mock JWT carries the claim.
- DSN-4 will consume `design.revision.approved` to trigger publish→GIS.
