# 0022 Platform-wide HTTP String-Enum Serialization

Date: 2026-06-17

## Status

Accepted

## Context

INC-1's API exposes C#-enum-typed request fields (`IncidentCategory`). The
platform's minimal-API JSON options previously had no enum converter, so enums
(de)serialized as integers, causing a 500 on string enum input. All existing
services used `string`-typed fields in their API contracts, so none relied on
the numeric wire format.

## Decision

- Register `JsonStringEnumConverter` globally in
  `WaterPlatform.BuildingBlocks.WebApi`'s `AddPlatformWebApi` so all services'
  HTTP request/response enums use string names.
- Also map `BadHttpRequestException → 400` in `GlobalExceptionMiddleware`
  (malformed/undeserializable request bodies return 400, not 500).
- Note: this affects HTTP only — outbox/integration-event serialization is
  unchanged (separate serializer).

## Consequences

- New services may use enum-typed DTOs directly and get string wire format by
  default.
- Verified non-breaking: gis 97 / asset 27 / bff 13 / design 35 integration
  tests + all unit/contract tests pass.
- Any future service needing numeric enum wire format must opt out explicitly.
