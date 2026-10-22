export class ServiceError extends Error {
  constructor(
    message: string,
    public status = 400,
    cause?: unknown,
  ) {
    super(message, { cause });
  }
}
export function checked<T>(result: {
  data: T;
  error: { message: string; code?: string } | null;
}): T {
  if (result.error) {
    if (result.error.code === "P0001")
      throw new ServiceError(result.error.message, 409);
    throw new ServiceError(
      "The database operation failed. Check that migrations are applied and retry.",
      400,
      result.error,
    );
  }
  return result.data;
}
