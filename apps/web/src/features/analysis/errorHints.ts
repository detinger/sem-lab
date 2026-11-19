/** Fix hints for the stable engine/API error codes (docs/architecture/engine-protocol.md). */
export const ERROR_HINTS: Record<string, string> = {
  REQUEST_INVALID:
    'The request was rejected. Check the model in the Modeler and the mapped columns in the Data Lab; empty cells in mapped columns must be handled before the run.',
  DATA_COLUMN_MISSING:
    'A column the model refers to is not in the data. Re-map the indicator in the Data Lab.',
  DATA_NOT_NUMERIC:
    'A mapped column contains text. Fix the values or the missing-value tokens in the Data Lab.',
  DATA_INSUFFICIENT_ROWS:
    'Too few complete rows remain. Check missing values, or map fewer indicators.',
  DATA_ZERO_VARIANCE:
    'A mapped column has no variation. Remove that indicator or use a column that varies.',
  MODEL_NOT_IDENTIFIED:
    'The model cannot be estimated as specified: an isolated construct, no structural path, or a collinear formative block. Connect every construct or remove it.',
  ENGINE_NONCONVERGENCE:
    'The algorithm did not converge. Raise the maximum iterations or the tolerance under Advanced, or simplify the model.',
  ENGINE_INADMISSIBLE: 'The solution is inadmissible. Inspect the measurement model.',
  CAPABILITY_UNSUPPORTED:
    'The selected option is not supported by this engine. Choose another option; unsupported ones are disabled with a reason.',
  CANCELLED: 'The job was cancelled. No results were produced.',
  TIMEOUT: 'The job exceeded the time limit. Use fewer bootstrap samples or a smaller model.',
  ENGINE_INTERNAL:
    'The engine failed unexpectedly. Try again; if it persists, export the R script and run it locally.',
  LIMIT_EXCEEDED:
    'A service limit was exceeded (rows, columns or bootstrap samples). Reduce the size of the request.',
  QUEUE_FULL: 'The service is busy. Wait a moment and run again.',
  RATE_LIMITED: 'Too many runs in a short time. Wait a minute and run again.',
  NETWORK:
    'The analysis service could not be reached. Check your connection and that the service is running.',
  API_NOT_CONFIGURED: 'This build of SEM Studio has no analysis service. Analyses cannot run here.',
  RESULT_INVALID:
    'The service returned a result that does not match the result contract; it was withheld.',
};

export function hintFor(code: string): string {
  return (
    ERROR_HINTS[code] ??
    'See the technical details below. If this repeats, export the R script and run the model locally.'
  );
}
