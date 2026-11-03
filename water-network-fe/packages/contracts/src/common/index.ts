import { z } from 'zod';

/**
 * Cross-context primitives shared by every bounded context. `@wn/contracts` is
 * the dependency floor: it imports nothing from the rest of the monorepo.
 */

export const IsoDateTime = z.string().datetime({ offset: true });

/** Standard error envelope returned by the BE and surfaced by the http-client. */
export const ErrorEnvelope = z.object({
  status: z.number().int(),
  code: z.string(),
  message: z.string(),
  correlationId: z.string().uuid().optional(),
  details: z.record(z.unknown()).optional(),
});
export type ErrorEnvelope = z.infer<typeof ErrorEnvelope>;

/** Optimistic-concurrency token carried on commands (BE event-sourced streams). */
export const StreamVersion = z.object({
  expectedStreamVersion: z.number().int().nonnegative(),
});
export type StreamVersion = z.infer<typeof StreamVersion>;

export const Page = <T extends z.ZodTypeAny>(item: T) =>
  z.object({
    items: z.array(item),
    total: z.number().int().nonnegative(),
    page: z.number().int().nonnegative(),
    pageSize: z.number().int().positive(),
  });
