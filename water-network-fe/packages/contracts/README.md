# @wn/contracts

Zod data contracts for the **water-network** platform. Single source of truth for
the shape of the `water-network-gis-be` REST API (DTOs), shared across the
MiniApp fleet as a published npm package.

- Organised by **BE bounded context** (not by MFE): `common/`, `snapshot/`,
  `revision/`, `import/`, `workflow/`, `binding/`. Phase 0 ships `common/` +
  `snapshot/` to fix the pattern; the rest land as their MiniApps are built.
- Schema + inferred types only — no fetching, no `solid`/`ol` dependency. `zod`
  is a peer dependency so every app resolves one copy.
- Every schema gets a round-trip parse test and (later) a contract test against a
  sample BE payload.

## Use

```bash
npm install @wn/contracts zod
```

```ts
import { PublishedNetworkSnapshot } from '@wn/contracts/snapshot';
const snapshot = PublishedNetworkSnapshot.parse(await res.json());
```

## Develop

```bash
npm install
npm test          # vitest
npm run build     # emits dist/ (js + d.ts)
```

> Target registry (public npm vs private/Verdaccio) is an open decision — see
> `docs/decisions/0009-fe-fleet-via-core-template.md`.
