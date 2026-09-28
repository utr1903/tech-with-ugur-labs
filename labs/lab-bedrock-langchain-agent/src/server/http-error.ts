/** What the API tells the caller when a request cannot be answered. */
export type HttpError = {
  status: 400 | 500 | 502 | 504;
  code: string;
  message: string;
};

const LOGIN: HttpError = {
  status: 502,
  code: "AWS_LOGIN_REQUIRED",
  message:
    "AWS did not accept the credentials. Run `make login` on the host and try again.",
};
const ACCESS: HttpError = {
  status: 502,
  code: "MODEL_ACCESS_DENIED",
  message:
    "Your AWS identity is not allowed to use this model. Run `make check` to see which models are accessible.",
};
const UNAVAILABLE: HttpError = {
  status: 502,
  code: "MODEL_UNAVAILABLE",
  message:
    "Bedrock rejected the model call. The model may not be offered in the configured Region; run `make check`.",
};
const BEDROCK: HttpError = {
  status: 502,
  code: "BEDROCK_ERROR",
  message: "Bedrock could not serve the request. Try again in a moment.",
};
const TIMEOUT: HttpError = {
  status: 504,
  code: "REQUEST_TIMEOUT",
  message: "The request took too long and was stopped.",
};

/** Error names, as set by the AWS SDK and LangGraph, and what they mean here. */
const BY_NAME: Record<string, HttpError> = {
  CredentialsProviderError: LOGIN,
  TokenProviderError: LOGIN,
  ExpiredTokenException: LOGIN,
  ExpiredToken: LOGIN,
  UnrecognizedClientException: LOGIN,
  InvalidSignatureException: LOGIN,
  AccessDeniedException: ACCESS,
  ValidationException: UNAVAILABLE,
  ResourceNotFoundException: UNAVAILABLE,
  ThrottlingException: BEDROCK,
  ServiceUnavailableException: BEDROCK,
  ServiceQuotaExceededException: BEDROCK,
  ModelTimeoutException: BEDROCK,
  ModelNotReadyException: BEDROCK,
  ModelErrorException: BEDROCK,
  InternalServerException: BEDROCK,
  GraphRecursionError: {
    status: 504,
    code: "AGENT_LIMIT_REACHED",
    message: "The agent did not reach an answer within its step limit.",
  },
  TimeoutError: TIMEOUT,
  AbortError: TIMEOUT,
};

/**
 * The generic 500 response: used here for any error that maps to nothing
 * more specific, and reused by `app.ts` for its last-resort error handler,
 * so the two never drift apart.
 */
export const INTERNAL_ERROR: HttpError = {
  status: 500,
  code: "INTERNAL_ERROR",
  message: "The request failed unexpectedly. See `make logs`.",
};

const MAX_CAUSE_DEPTH = 5;

/**
 * Maps any error to a response. Libraries wrap the original AWS error, so
 * the chain of causes is searched. The original message is never returned:
 * it can contain local paths.
 */
export function toHttpError(err: unknown): HttpError {
  let current: unknown = err;
  for (let depth = 0; depth < MAX_CAUSE_DEPTH; depth += 1) {
    if (!(current instanceof Error)) {
      break;
    }
    if (Object.hasOwn(BY_NAME, current.name)) {
      return BY_NAME[current.name] ?? INTERNAL_ERROR;
    }
    current = current.cause;
  }
  return INTERNAL_ERROR;
}
