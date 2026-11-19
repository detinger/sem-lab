/** Stable engine error codes (docs/architecture/engine-protocol.md). */
export const ENGINE_ERROR_CODES = [
  'REQUEST_INVALID',
  'DATA_COLUMN_MISSING',
  'DATA_NOT_NUMERIC',
  'DATA_INSUFFICIENT_ROWS',
  'DATA_ZERO_VARIANCE',
  'MODEL_NOT_IDENTIFIED',
  'ENGINE_NONCONVERGENCE',
  'ENGINE_INADMISSIBLE',
  'CAPABILITY_UNSUPPORTED',
  'CANCELLED',
  'TIMEOUT',
  'ENGINE_INTERNAL',
] as const;
export type EngineErrorCode = (typeof ENGINE_ERROR_CODES)[number];

export interface EngineErrorInfo {
  code: EngineErrorCode;
  message: string;
  details?: Record<string, unknown>;
}

/**
 * A handled engine error. Messages and details may name model ids, column names and counts,
 * never a data value.
 */
export class EngineError extends Error {
  override readonly name = 'EngineError';
  readonly code: EngineErrorCode;
  readonly details: Record<string, unknown> | undefined;

  constructor(code: EngineErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.code = code;
    this.details = details;
  }

  toInfo(): EngineErrorInfo {
    return this.details && Object.keys(this.details).length > 0
      ? { code: this.code, message: this.message, details: this.details }
      : { code: this.code, message: this.message };
  }
}

export function invalid(message: string, details?: Record<string, unknown>): EngineError {
  return new EngineError('REQUEST_INVALID', message, details);
}
