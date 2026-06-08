import { applyDecorators, Type } from '@nestjs/common';
import { ApiExtraModels, ApiResponse, getSchemaPath } from '@nestjs/swagger';

type ApiSuccessResponseEnvelopeOptions = {
  dataDto: Type<unknown>;
  description: string;
  messageExample: string;
  status?: number;
  isArray?: boolean;
};

export function ApiSuccessResponseEnvelope(
  options: ApiSuccessResponseEnvelopeOptions,
) {
  return applyDecorators(
    ApiExtraModels(options.dataDto),
    ApiResponse({
      status: options.status ?? 200,
      description: options.description,
      schema: {
        type: 'object',
        required: ['success', 'message', 'data'],
        properties: {
          success: {
            type: 'boolean',
            example: true,
          },
          message: {
            type: 'string',
            example: options.messageExample,
          },
          data: options.isArray
            ? {
                type: 'array',
                items: {
                  $ref: getSchemaPath(options.dataDto),
                },
              }
            : {
                $ref: getSchemaPath(options.dataDto),
              },
        },
      },
    }),
  );
}
