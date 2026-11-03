# CAD import backend rollout and SHW readiness

Prepared 2026-09-14 from read-only cluster checks, then used for the authorized scoped DEV
backend rollout. The initial environment facts below describe the pre-rollout state.
Deployment evidence is recorded in `deploy/k3s/water-network-core/overlays/dwg-import-backend/README.md`
at the repository root. No SHW tenant provisioning, source upload or GIS publication was performed.

## Verification commands

Run in `water-network/water-network-be`:

```sh
dotnet test src/services/water-network-design-be/tests/WaterNetwork.Design.UnitTests/WaterNetwork.Design.UnitTests.csproj
dotnet test src/services/water-network-design-be/tests/WaterNetwork.Design.IntegrationTests/WaterNetwork.Design.IntegrationTests.csproj
dotnet test src/services/water-network-bff/tests/WaterNetwork.Bff.IntegrationTests/WaterNetwork.Bff.IntegrationTests.csproj
dotnet test src/building-blocks/tests/WaterPlatform.BuildingBlocks.Infrastructure.Tests/WaterPlatform.BuildingBlocks.Infrastructure.Tests.csproj
dotnet ef migrations has-pending-model-changes --project src/services/water-network-design-be/src/WaterNetwork.Design.Infrastructure
git diff --check
```

Apply additive migration `20260914075931_AddDesignImportReceipts` with the Design-owned
migration identity before deploying the new Design runtime. Confirm the migration history
and receipt primary key. Existing aggregate saves enlist in the import's transaction.
Rollback may restore the previous runtime while leaving this additive table in place;
never drop accepted receipts while their projects or revisions exist.

## Runtime prerequisites

- BFF: optional `Downstream__Import__BaseUrl` points to the worker's internal HTTP base.
  Leave empty until the worker is available. The worker serves `/api/gis/imports` unchanged.
- Gateway: add an exact/prefix route for `/api/gis/imports` and `/api/gis/imports/*` to
  `water-network-bff:8080`, above the legacy `/api/gis/*` priority. Preserve every other
  live APISIX route. The existing manual reconciler owns only its original three route IDs;
  do not overwrite the live ConfigMap with a repository copy or repurpose the legacy service.
- Permit gateway/BFF/worker upload bodies of 100 MiB, a 120 second proxy timeout, PATCH,
  HEAD and normal import verbs. Preserve bearer and correlation headers; expose
  Content-Disposition for downloads. The BFF itself enforces the cap for chunked bodies.
- NetworkPolicy: add only BFF to import-worker ingress and matching BFF egress; worker
  to Design/GIS/Keycloak as required by the worker's token/ingestion contract. Preserve
  existing default-deny policies and service-specific PostGIS permissions.
- Design: `GisLookup__Provider=Http` with the canonical GIS service URL; Production must
  use `FileStorage__Provider=S3`. LocalDisk remains blocked. Configure the settings below
  and grant Design pods egress only to the selected object store/DNS.
- Roll new Design and GIS images containing the RabbitMQ health fix; ensure `/health`
  recovers, all replicas are Ready and Services have endpoints before attempting publication.

## Existing MinIO and S3 provider settings

MinIO is already deployed, Ready 1/1. Service: `minio.platform-core.svc.cluster.local:9000`.
Read-only `/minio/health/ready` returned 200. No standalone file-storage service exists.
The cluster has `minio-secret` root credentials, but no dedicated Design storage secret
was found. Provision a private bucket and a service identity restricted to the configured
`design-documents/*` object prefix; do not wire the root credential into Design.

| Setting | Meaning |
| --- | --- |
| `FileStorage__Provider` | `S3` |
| `FileStorage__S3__ServiceUrl` | Existing internal MinIO HTTP endpoint or an HTTPS S3 endpoint |
| `FileStorage__S3__AllowInsecureHttp` | Explicit `true` only for the selected private MinIO endpoint |
| `FileStorage__S3__Region` | Actual bucket region (MinIO default is commonly `us-east-1`; verify deployment) |
| `FileStorage__S3__Bucket` | Provisioned private Design bucket |
| `FileStorage__S3__Prefix` | `design-documents` |
| `FileStorage__S3__ForcePathStyle` | `true` for MinIO |
| `FileStorage__S3__AccessKey`, `SecretKey` | Dedicated Kubernetes secret references |
| `FileStorage__MaxSizeBytes` | Document size limit, maximum 100 MiB |

The adapter performs S3 PutObject with signed payloads, no public ACL and no automatic
bucket creation. A stored reference is `s3://bucket/design-documents/tenant/id/file`.
Configure retention/backup and verify a restore/read using the object-store operator path
before promoting the existing single-replica MinIO deployment as production storage.
An object uploaded before metadata persistence fails may be orphaned; retain/audit such
objects until an explicit reconciliation policy is in place.

## MinIO provisioning procedure

Read-only bucket inventory found billing-invoices, field-photos, master-data, rag-docs,
reports and water-business-contract-templates. Policy names were only the five built-ins.
`water-network-design` was provisioned as a new private bucket during this DEV rollout.
The checked-in `2026-09-14-design-s3-write-policy.json` allows only PutObject under its
Design prefix. Bucket listing, reading, deletion, policy and user administration are absent.

Run from an operator session whose MinIO alias and parent user are already authenticated.
The service account has an explicit policy, so the runtime receives its restricted key pair
rather than the parent account's credentials. These commands write storage configuration
and are separate from readiness inspection. The scoped DEV rollout applied this procedure,
verified restricted access, readback and backup restoration, then removed its probe versions:

```sh
umask 077
mc mb --ignore-existing "$MINIO_OPERATOR_ALIAS/water-network-design"
mc anonymous set none "$MINIO_OPERATOR_ALIAS/water-network-design"
mc version enable "$MINIO_OPERATOR_ALIAS/water-network-design"
mc --json admin user svcacct add "$MINIO_OPERATOR_ALIAS" "$MINIO_PARENT_USER" \
  --name water-network-design \
  --policy docs/superpowers/plans/2026-09-14-design-s3-write-policy.json \
  > "$DESIGN_CREDENTIALS_JSON"
```

Keep the result in an operator-owned mode-0600 temporary file, transfer its accessKey and
secretKey directly into `water-network-design-object-storage` Secret keys `ACCESS_KEY` and
`SECRET_KEY` using the cluster's secret-management path, and remove the temporary file.
Do not paste the result into a terminal transcript. Map those Secret keys to
`FileStorage__S3__AccessKey` and `FileStorage__S3__SecretKey` in the Design Deployment.
Retain the service-account identifier for rotation. Confirm with the new identity that a
small object can be PUT to the configured prefix while bucket listing and other-prefix
writes are denied. Use the operator identity to verify bytes and remove the probe object.

The [MinIO mc implementation](https://github.com/minio/mc/blob/master/cmd/admin-user-svcacct-add.go)
defines the policy and generated credential fields. The
[APISIX client-control plugin](https://apisix.apache.org/docs/apisix/plugins/client-control/)
can set a route body cap of 104857600 bytes, but only when APISIX-Runtime is present;
check the deployed runtime before enabling the plugin. Otherwise configure the existing
NGINX/APISIX body-limit mechanism. BFF and Design still enforce their own 100 MiB ceilings.

## SHW environment facts

- SSH alias `tino-32` works against the pinned staging control plane. Both k3s nodes Ready.
- GIS web: `https://gis-dev.dichvunuoc.vn`; auth realm:
  `https://auth-dev.dichvunuoc.vn/realms/water-platform`.
- Canonical BFF is `water-network-bff`; legacy service is `water-network-gis-bff`.
  `/api/gis/map` and `/bootstrap` already route to canonical BFF with priority 100.
  `/api/gis/bff/water-network/*` routes to canonical BFF with priority 120 and strips
  `/api/gis`; other `/api/gis/*` routes still go to legacy.
- Existing FE config has `newEditor=true`, `canonicalViewer=false`, and omits the current
  organization/data-source options. Source and live image/config differ; account for the
  current organization-aware frontend during rollout.
- Canonical GIS was 0/2 Ready and Design 0/1 due to permanently cached startup DNS failure
  in RabbitMQ health. Live DNS and RabbitMQ service were healthy; database polling succeeded.
  Canonical BFF 2/2, Asset 2/2 and PostGIS 1/1 were Ready.
- Live Keycloak `water-platform` organizations are hawaco, quawaco and techgen. No SHW
  organization/group/tenant attribute exists. `tnt_shw` in older spike docs is not live evidence.
- Authenticated GET `https://admin.dichvunuoc.vn/api/admin/tenants` succeeds. The equivalent
  admin-dev and api-dev routes return 404. Existing `admin-portal-bff` service credentials
  have platform-admin and can access the provisioning API. Credentials remain in
  `keycloak-secret/ADMIN_PORTAL_BFF_SECRET` and must not be logged.
- Canonical source POST same tenant URL accepts slug, displayName, primaryDomain,
  contactEmail, firstAdminEmail, appDomain, enabledAppCodes. firstAdminEmail must identify
  an existing enabled user. Verify deployed contract before POST, as deployed admin BFF
  image predates current provisioning changes. Do not invent SHW contact/admin identities.
- GIS entitlement code is `ml-0`, verified through authenticated live app-catalog `/apps`.
  Tenant creation calls app-catalog to set entitlements; use the provisioning API instead
  of direct Keycloak database writes.
- Existing canonical data: cwa has 1,819 nodes, 1,015 pipes, one device; tnt_hawaco has one
  node. The import must not modify or delete those tenants' data.

## Publication gate for these DWGs

Import preparation, cleanup preview and draft creation are distinct from authoritative
GIS publication. Confirm source CRS/georeferencing, pipe materials and real SHW tenant
context before publication. Preserve supplied-file checksums, the candidate version,
removed-feature reasons and operator decisions. Clean source candidates only; existing
GIS assets are never mass-deleted as a side effect of CAD line cleanup.

After Design accepts a stable `jobId:version` import key, reuse returned IDs on retries.
Then use existing validate, submit, approve and publication-status routes under the original
bearer token. Approval permission and valid tenant context remain mandatory.

## Import contract and batch validation

`POST /api/design/imports` accepts at most 20,000 draft assets and 100 MiB of JSON.
`name` is limited to 160 characters, and `importKey` to 160 ASCII letters, numbers,
underscores, dots, colons or hyphens. The request includes an object-valued `provenance`.
The direct success response is `{ projectId, revisionId, assetCount }` on both first
acceptance and an identical retry. Changed content under the same tenant/import key is
409. The server adds a deterministic import identity suffix to the persisted project name.

The worker's create/validate/submit chain needs `network-design:write`,
`network-design:read` and `network-gis:read` on the original bearer token. Its approve/status
chain also needs `network-design:approve`. Revision validation returns
`{ isValid, errors, warnings }`; do not infer success only from HTTP 200. Publication
results are asynchronous and may include per-asset failures.

Validation queries GIS once per distinct asset code, with at most 16 requests in flight,
then emits issues in draft order. Draft endpoint and host references resolve within the
revision and do not trigger GIS requests. Cancellation aborts validation without accepting
a partial result. These bounds prevent a large supported batch from becoming a serial
sequence of thousands of network round trips; actual completion still depends on GIS health.

GIS accepts pipe materials HDPE, PVC, DuctileIron, Steel, CastIron and Concrete, with
case-insensitive trimming. Source mappings must resolve to that catalog before approval;
a nonblank unsupported material can pass the existing Design validation but fails GIS import.
