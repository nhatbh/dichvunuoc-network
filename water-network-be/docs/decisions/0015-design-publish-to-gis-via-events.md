# 0015 — Design publish to GIS: event-driven 2-way contract

**Status:** accepted
**Date:** 2026-06-17
**Slice:** DSN-4 (US-P2-06); completes Phase 2 of the Water Network Platform roadmap.

## Context

DSN-4 implements the final step of the design workflow: publishing approved draft assets into
the GIS service. Two integration options were evaluated (roadmap §7.1):

1. **Synchronous HTTP** — design-be calls GIS import endpoint directly on approval.
2. **Asynchronous event** — design-be emits an event via outbox; GIS consumes, imports, and
   emits a completion event; design-be consumes to update revision status.

The key constraint is that design-be and gis-be must deploy independently and must not share
a synchronous availability dependency at publish time.

## Decision

### 1. Publish via event, not synchronous HTTP

`design.asset.ready-for-gis` v1 is published from design-be via the outbox after revision
approval (`RevisionApprovedPublishConsumer`). GIS consumes it via `DesignAssetImportConsumer`
and emits `network.gis-import.completed`. Design-be consumes the completion event via
`GisImportCompletedConsumer` to transition the revision to `Published` or `PartiallyPublished`.

Rationale: no synchronous HTTP dependency between services; outbox ensures at-least-once
delivery with natural retry; GIS can be unavailable at publish time without blocking design-be.

### 2. Two contracts, each owned by its producer

| Event | Owner | Version |
|---|---|---|
| `design.asset.ready-for-gis` | water-network-design-be | v1 |
| `network.gis-import.completed` | water-network-gis-be | v1 |

Contract test coverage: design ContractTests cover `DesignAssetReadyForGisV1` and
`DesignRevisionPublishedV1`; gis ContractTests cover `NetworkGisImportCompletedV1`.

### 3. Idempotency via `gis_import_ledger`

Table `gis_import_ledger` keys on `(revision_id, draft_asset_id)` with a unique constraint.
A duplicate delivery of `design.asset.ready-for-gis` → re-processing a ledger entry that
already succeeded → upsert is idempotent (existing `Imported` row is not overwritten). Inbox
dedup (`processed_events`) guards against double-processing at the consumer level.

### 4. GIS reuses domain factories, not command handlers

`DesignAssetImportConsumer` calls `NetworkNode.Register`, `NetworkPipe.Register`, and
`NetworkDevice.Install` directly (domain factory methods), deriving tenant from the event
payload. It does NOT reuse the command handlers, which require HTTP request context to resolve
tenant. Repositories are used directly.

Import order within a batch: Nodes first → Pipes → Devices. A pipe or device whose referenced
endpoint or host node failed to import also fails (cascade); this is intentional and is covered
by `PublishRoundTripTests`.

### 5. Terminal statuses `Published` and `PartiallyPublished`

- All assets in batch imported successfully → revision transitions to `Published`.
- At least one asset failed → revision transitions to `PartiallyPublished`.
- Both statuses are **terminal** in DSN-4. Re-publish of failed drafts (after fix) is deferred
  to DSN-5+.

### 6. Intra-batch `clientRef` resolution only

`fromRef`/`toRef`/`hostRef` on draft assets are `clientRef` values that resolve only within
the same batch. Referencing a node/pipe that was absent from the batch, or that failed import,
causes the dependent pipe/device to fail (cascade). Cross-revision and cross-existing-GIS-asset
references are not supported in DSN-4.

## Consequences

- GIS service acquires a new consumer (`DesignAssetImportConsumer`) and a new table
  (`gis_import_ledger`); outbox event type registration must include
  `NetworkGisImportCompletedV1`.
- Design service acquires `RevisionApprovedPublishConsumer` (consumes its own
  `design.revision.approved` to trigger publish) and `GisImportCompletedConsumer`.
- `AggregateRepositoryBase` rollback path does not call `ChangeTracker.Clear()`; the import
  consumer compensates by clearing the tracker in the per-asset catch block. Centralising
  clear-on-rollback in the base is a follow-up if a second batch-style consumer is needed.
- `GisImportBatch` is a transient (table-less) aggregate used purely to route the
  `network.gis-import.completed` completion event through the outbox;
  `GisImportBatchRepository` subclasses `AggregateRepositoryBase` with a no-op `PersistAsync`.
- `design.revision.published` has no consumer yet; the catalog entry exists and a consumer
  should be added when a notification or audit flow is defined.
