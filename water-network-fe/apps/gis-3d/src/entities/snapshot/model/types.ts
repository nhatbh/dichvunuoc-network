// Reference slice: the snapshot entity sources its shape from the shared,
// published @wn/contracts package (BE bounded context `snapshot/`), not a local
// duplicate. This is the fleet's single source of truth for the BE contract.
import type { PublishedNetworkSnapshot } from '@wn/contracts/snapshot';

export { PublishedNetworkSnapshot as snapshotSchema } from '@wn/contracts/snapshot';
export { SnapshotStatus } from '@wn/contracts/snapshot';

export type Snapshot = PublishedNetworkSnapshot;
