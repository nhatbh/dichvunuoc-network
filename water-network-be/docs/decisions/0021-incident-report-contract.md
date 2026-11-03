# 0021 Incident Reporting Contract & State Machine (INC-1)

Date: 2026-06-17

## Status

Accepted

## Context

INC-1 introduces `water-network-incident-be`, the first incident workflow slice
(US-P3-03). It must report/classify/cancel incidents and emit integration events
that later phases (INC-2 isolation, INC-3 confirm, Phase 4 maintenance, Phase 7
customer-impact) consume. Two questions need a durable answer now: (1) how wide
is the state machine in INC-1, and (2) how are affected asset references handled
when GIS cannot confirm them.

## Decision

- **State enum is the INC-1 subset only:** `Reported`, `Classified`, `Cancelled`.
  The full machine (`IsolationRequested → IsolationPlanReady → PlanConfirmed →
  HandlingStarted → Resolved`) is added incrementally in INC-2/INC-3 alongside
  the handlers that drive those transitions. No state exists without a transition
  that reaches it.
- **Transitions:** `Reported → Classified` (re-classify allowed: `Classified →
  Classified`), and `{Reported, Classified} → Cancelled`. `Cancelled` is terminal.
  Cancel requires a reason.
- **Affected asset refs are advisory in INC-1.** Each ref is `{assetId, kind}`
  (kind ∈ Node/Pipe/Device). On report, each ref is checked via `IGisLookupPort`;
  a ref GIS cannot confirm is stored with `verified=false` (surfaced as
  `unverified`) — it never blocks creation. INC-1 ships a config-driven stub
  adapter; a real GIS HTTP/gRPC adapter swaps in later via `GisLookup:Provider`.
- **Events (all v1):** `incident.reported`, `incident.classified`,
  `incident.cancelled`. Payloads carry `tenantId` explicitly (unlike GIS outbox
  events) so downstream consumers need not infer tenant from the envelope.
- **Routes:** `/api/incidents` (no version segment — decision 0009).
- **Cross-tenant:** mutation handlers load tenant-scoped and 404 on mismatch
  (decision 0016).

## Consequences

- INC-2 extends the enum + adds `RequestIsolationAnalysis` and the gRPC topology
  port; INC-3 adds confirm/handle/resolve and the `maintenance.work-order-requested`
  contract.
- `unverified` refs may later be re-resolved when INC-2 wires the real GIS lookup.
- Severity is an integer 1–4 (1 = lowest), guarded in the domain and at the API
  boundary. Category enum: `PipeBurst`, `PressureDrop`, `WaterLoss`, `Leak`, `Other`.
