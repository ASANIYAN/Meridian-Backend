export function errorResponseSchema(
  statusCode: number,
  message: string | string[],
  error: string,
) {
  return {
    type: 'object',
    required: ['statusCode', 'message', 'error'],
    properties: {
      statusCode: {
        type: 'number',
        example: statusCode,
      },
      message: Array.isArray(message)
        ? {
            type: 'array',
            items: {
              type: 'string',
            },
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
    },
  };
}
