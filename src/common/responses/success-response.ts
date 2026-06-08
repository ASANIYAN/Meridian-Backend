export type SuccessResponse<T> = {
  success: true;
  message: string;
  data: T;
  meta?: Record<string, unknown>;
};

export function buildSuccessResponse<T>(
  message: string,
  data: T,
  meta?: Record<string, unknown>,
): SuccessResponse<T> {
  return {
    success: true,
    message,
    data,
    ...(meta ? { meta } : {}),
  };
}
