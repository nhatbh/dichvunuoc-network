# 0027 — CAD import draft ingestion and transport

Date: 2026-09-14. Status: implemented in the DWG import worktree; live rollout pending.

CAD conversion owns candidate generation and cleanup; Design owns reviewable projects,
revisions and publication. Geometry is never inserted directly into a GIS database by the
import worker. The worker passes its caller's verified bearer token to Design.

## Contract and atomicity

`POST /api/design/imports` requires `network-design:write` and verified tenant context.
The request is `{importKey, name, assets, provenance}`. Assets use the existing
`CreateDraftAssetRequest` contract. Provenance must be an object. A request is capped at
100 MiB and 20,000 assets; importKey is at most 160 ASCII letters/digits/`_.:-`, and the
human name is at most 160 characters. Return HTTP 200 with
`{projectId, revisionId, assetCount}` for both first acceptance and identical retry.

The Design-owned `design_import_receipts` table has primary key `(tenant_id, import_key)`.
A PostgreSQL advisory transaction lock serializes that identity. The payload SHA-256 uses
ordinally sorted JSON object keys and preserves array order. Changed content under the same
key returns 409; other tenants can use the same key independently. The receipt, project,
revision, drafts and outbox changes share one transaction. An invalid draft rolls everything
back. The existing repository ambient-transaction contract remains in use.

Project names are already tenant-unique. The persisted title adds a deterministic
`[import <16 hex characters>]` identity suffix, so a new version can use the same human title
without overwriting an earlier review. A corrected import uses a new versioned importKey.
The import receipt is retained as long as its project/revision; do not purge it independently.

Validation checks each distinct asset code in GIS once, with at most 16 concurrent
requests. Draft endpoint/host references resolve within the revision. Lookup completion
order never changes issue order, and cancellation prevents partial results from being
accepted as a validated revision.

## BFF transport

`/api/gis/imports` and child routes forward to optional `Downstream:Import:BaseUrl`.
An empty/invalid setting produces 503. The proxy preserves the full public path, query,
bearer, correlation ID, content and downstream status. GET/HEAD require design read;
mutations require design write; POST `/{jobId}/publish` requires design approve.
Tenant application entitlement checks still apply. Bodies stream with a 100 MiB cap,
including unknown-length requests. Transfers have a 120 second deadline; mutations are
never automatically retried. Redirects and cookies are disabled; hop-by-hop response
headers are stripped. JSON errors and binary download payloads both pass through.

## Document storage and health

Production still rejects LocalDisk. The new S3 provider implements the existing document
storage port using the AWS S3 SDK and the S3 PutObject API. It supports the already-existing
MinIO endpoint, a configured private bucket and scoped credentials. Keys are prefixed by
verified tenant and a generated object ID. The adapter creates neither bucket nor ACL;
no public URL is returned. Non-seekable streams are bounded before signing/upload.
S3 credentials are configured as secret fields, never URL userinfo. Private HTTP requires
an explicit opt-in; HTTPS is the default contract.

RabbitMQ health now caches only an open connection, retries a failed initial connection,
and replaces closed connections. Connection fields are set separately so URI punctuation
in credentials cannot change the destination. This fixes the observed long-lived readiness
failure after a transient startup DNS error.

## Verification

PostGIS integration covers concurrent retries, payload conflict, tenant isolation, invalid
geometry rollback including receipt/outbox, and permission/schema rejection. BFF tests cover
multipart streaming, binary export, permissions, omitted configuration, upload limit and
absence of mutation retries. Health tests cover startup failure, closed connections and
concurrent probes; S3 tests verify the exact PutObject request and failure/size behavior.

References: [AWS PutObject contract](https://docs.aws.amazon.com/sdkfornet/v4/apidocs/items/S3/TPutObjectRequest.html),
[existing Design publication decision](0015-design-publish-to-gis-via-events.md).
