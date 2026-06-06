import { applyDecorators, Type } from '@nestjs/common';
import { ApiExtraModels, ApiOkResponse, getSchemaPath } from '@nestjs/swagger';

type ApiSuccessResponseEnvelopeOptions = {
  dataDto: Type<unknown>;
  description: string;
  messageExample: string;
  isArray?: boolean;
};

export function ApiSuccessResponseEnvelope(
  options: ApiSuccessResponseEnvelopeOptions,
) {
  return applyDecorators(
    ApiExtraModels(options.dataDto),
    ApiOkResponse({
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
