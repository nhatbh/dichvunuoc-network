# SHW uses the canonical tenant data boundary

Date: 2026-09-14. Status: Accepted under SHW provisioning and repair request.

SHW must explicitly select gisDataSource=canonical and gisViewerMode=rich. The legacy /full contract is a global seed and is unsuitable for a newly provisioned Organization. The historical canonicalViewer flag does not select this runtime boundary.

Keep legacy compatibility within its parser: absent sourceDevices means no generic source devices in that older contract. Reject missing required data; do not reinterpret it as a valid empty network or fall back from canonical to seed. An empty canonical tenant links to Import CAD without requiring fabricated geometry.

This repairs the existing Organization-first contract. Auth roles, data ownership and source-coordinate validation are unchanged. Shared DEV remains separately managed.

## Entitlement dependency correction

Authenticated testing additionally found an unavailable catalog URL and a missing
access endpoint. The catalog menu /me role filter is not an entitlement API:
SHW can have GIS enabled and operational GIS permissions while the administrative
menu remains hidden. Use the additive caller-authenticated access endpoint with
a trusted app/client binding and enabled tenant_apps lookup. Keep broad realm
roles and menu visibility untouched. The BFF still enforces per-endpoint
permissions and never falls back to menu visibility or sample data.
