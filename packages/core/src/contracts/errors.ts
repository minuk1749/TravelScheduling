/** Machine-readable error codes shared by the server and the app (docs/architecture.md §13.2). */
export const API_ERROR_CODES = [
  'UNAUTHENTICATED', 'INVALID_GOOGLE_TOKEN', 'FORBIDDEN', 'NOT_FOUND', 'METHOD_NOT_ALLOWED',
  'INVALID_JSON', 'INVALID_INPUT', 'UNSUPPORTED_MEDIA_TYPE', 'PAYLOAD_TOO_LARGE',
  'INCOMPLETE_TRIP', 'STALE_INPUT', 'RESULT_UNAVAILABLE',
  'PROVIDER_UNAVAILABLE', 'PROVIDER_INVALID_RESPONSE', 'INTERNAL',
] as const;

export type ApiErrorCode = typeof API_ERROR_CODES[number];
/** A list names fields to complete; a record maps a field to a user-facing message. */
export type ApiErrorFields = readonly string[] | Record<string, string>;
export type ApiError = { code: ApiErrorCode; error: string; fields?: ApiErrorFields };

export const isApiErrorCode = (value: unknown): value is ApiErrorCode =>
  typeof value === 'string' && (API_ERROR_CODES as readonly string[]).includes(value);
