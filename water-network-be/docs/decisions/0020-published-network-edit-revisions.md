# Published network edits use Design revisions

Status: accepted by user, 2026-09-24.

The canonical editor stores an explicit changeset on a Design revision. CAD draft assets remain a separate revision content type. Both use Draft → Validated → Submitted → Approved → Published and the existing tenant permissions. A revision cannot mix the two content types. Every save uses the revision version; updates/deletes reference stable GIS IDs and expected GIS versions. The server captures before snapshots for review. Validation is read-only, tenant-scoped against GIS, and is repeated when publishing.

Network edit publication uses a separate event contract; the old CAD creation consumer must never interpret update/delete as create. GIS applies all operations in a single transaction, with outbox/ledger in that transaction. Conflicts reject the whole batch. Existing event payloads and CAD workflows remain compatible. Roll out GIS consumer then Design migration/API, then frontend. Rollback frontend first; retain additive schema and consumers until queued messages drain. Do not remove stored changesets on rollback.

A draft is allowed to contain incomplete geometry/properties, but structural identity, tenant, bounded payload and expected versions must be valid. Submission requires successful validation; locked revisions cannot be reopened by validation. Author/reviewer identity comes from signed request context. No permission escalation or direct canonical writes from the editor.

Background consumers publish through an outbox without ambient HTTP tenant context. The edit event payload must contain its tenant; a non-null envelope tenant must match. Missing envelope metadata does not discard an otherwise valid internal event. Replay protection is scoped by tenant and revision, and target lookup always uses the payload tenant. Integration coverage includes both missing envelope metadata and mismatches.
