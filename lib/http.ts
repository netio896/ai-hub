export class ApiError extends Error {
  status: number;
  code: string;
  provider?: string;

  constructor(status: number, code: string, message: string, provider?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.provider = provider;
  }
}

export function jsonError(error: ApiError) {
  return Response.json(
    {
      error: {
        code: error.code,
        message: error.message,
        ...(error.provider ? { provider: error.provider } : {})
      }
    },
    { status: error.status }
  );
}

export function jsonOk<T>(payload: T, init?: ResponseInit) {
  return Response.json(payload, init);
}

export function toApiError(error: unknown) {
  if (error instanceof ApiError) {
    return error;
  }

  const message = error instanceof Error ? error.message : "Unexpected server error";
  return new ApiError(500, "internal_error", message);
}
