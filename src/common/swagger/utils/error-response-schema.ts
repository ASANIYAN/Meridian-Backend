export function errorResponseSchema(
  statusCode: number,
  message: string | string[],
  error: string,
) {
  return {
    type: 'object',
    required: ['statusCode', 'message', 'error', 'timestamp', 'path'],
    properties: {
      statusCode: {
        type: 'number',
        example: statusCode,
      },
      message: Array.isArray(message)
        ? {
            type: 'array',
            items: { type: 'string' },
            example: message,
          }
        : {
            type: 'string',
            example: message,
          },
      error: {
        type: 'string',
        example: error,
      },
      timestamp: {
        type: 'string',
        example: '2026-06-24T10:00:00.000Z',
      },
      path: {
        type: 'string',
        example: '/v1/auth/login',
      },
    },
  };
}
