import { z } from 'zod';

/** Current version of every contract in this package. Bump together with a migration. */
export const SCHEMA_VERSION = 1 as const;

/**
 * Stable opaque identifier. Restricted to a conservative character set so an id can be
 * used as a DOM id, a JSON key and a file-name fragment without escaping. Ids are never
 * interpolated into R or Python source; names are, and only through quoting helpers.
 */
export const Id = z
  .string()
  .min(1)
  .max(128)
  .regex(
    /^[A-Za-z0-9_][A-Za-z0-9_.:-]*$/,
    'ids may contain letters, digits, "_", ".", ":" and "-"',
  );
export type Id = z.infer<typeof Id>;

/** Human-facing short name. Any printable text; code generators are responsible for quoting. */
export const Name = z
  .string()
  .max(200)
  .refine((s) => s.trim().length > 0, 'name must not be empty')
  // eslint-disable-next-line no-control-regex
  .refine((s) => !/[\u0000-\u001f\u007f]/.test(s), 'name must not contain control characters');

/** Finite JSON number. NaN and ±Infinity can never appear in a contract. */
export const FiniteNumber = z.number().refine(Number.isFinite, 'number must be finite');

/** Why a number is absent. `null` numbers in results always carry one of these. */
export const MissingReason = z.enum([
  'not-applicable',
  'not-requested',
  'not-estimated',
  'not-supported',
  'failed',
  'non-finite',
]);
export type MissingReason = z.infer<typeof MissingReason>;

/** A result number: finite, or null (the reason is recorded next to it). */
export const Num = FiniteNumber.nullable();
export type Num = z.infer<typeof Num>;

export const Severity = z.enum(['error', 'warning', 'recommendation', 'info']);
export type Severity = z.infer<typeof Severity>;

export const IsoDateTime = z.iso.datetime({ offset: true });

export const Sha256Hex = z.string().regex(/^[0-9a-f]{64}$/, 'expected a lowercase hex sha256');
