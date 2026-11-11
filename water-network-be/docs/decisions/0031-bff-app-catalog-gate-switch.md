# 0031 — Dev switches: the BFF's app-catalog gate, and the flat tenant_id for CAD import

Date: 2026-11-11. Status: Accepted (user, 2026-11-11).

## Context

The BFF asks app-catalog `GET /api/platform/app-catalog/me/apps/{AppCode}/access` before every
`/api/gis` and `/bff/water-network` request and answers 403 on a denial (TenantAppEntitlementMiddleware).
On the dev cluster the catalog has no record for the GIS map app (`ml-0`): the user's `/me` lists
`ml-1`…`ml-7` only, so every request was refused although the token, tenant and permissions were
correct. Registering the app, enabling it for the tenant and binding the Keycloak client is work
for the catalog owners; the user asked to bypass the check meanwhile.

## Decision

`AppEntitlement:Enabled` (default `true`). `false` skips the catalog call entirely; authentication,
tenant resolution and every endpoint's permission policy still run. Options validation refuses
`false` when the environment is Production, and the BFF logs a warning (event 3101) at start when
the gate is off. The dev deploy exposes it as `APP_ENTITLEMENT_ENABLED` in `deploy.env` and asks
it interactively.

## Consequences

- With the gate off, any authenticated user of the realm with the GIS permissions can use the map,
  whether or not their tenant has the app. Acceptable on dev/staging only.
- Turn it back on (`APP_ENTITLEMENT_ENABLED=true`) once the catalog lists the app for the tenant;
  `deploy/dev/check-access.ps1` shows whether it does.

## Addendum (2026-11-12): flat tenant_id for CAD import and the editor

Dev users have a flat `tenant_id` claim and no Keycloak Organization. The map works (the .NET
services allow the flat claim), but the frontend refused CAD import and the editor's design
revisions for such a "legacy" session, and the import service refuses it unless
`IMPORT_ALLOW_FLAT_TENANT=true`. The frontend now allows the legacy session there when the runtime
config sets `organization.allowLegacyTenantIdFallback: true` — the same flag that makes it resolve
the flat claim at all. The dev deploy sets both from one setting, `ALLOW_FLAT_TENANT` in
`deploy.env` (default false). Production keeps the Organization-only rule: leave the flag unset
and give users an Organization.
