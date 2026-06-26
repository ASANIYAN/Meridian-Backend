import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { AiContentExistenceError } from '../../ai/errors/ai-content-existence.error';
import { AiScopeError } from '../../ai/errors/ai-scope.error';
import { AiValidationError } from '../../ai/errors/ai-validation.error';

const PG_UNIQUE_VIOLATION = '23505';
const PG_FOREIGN_KEY_VIOLATION = '23503';
const PG_NOT_NULL_VIOLATION = '23502';

interface ErrorBody {
  statusCode: number;
  message: string | string[];
  error: string;
  [key: string]: unknown;
}

// Human-readable reason phrases. HttpStatus[status] yields SCREAMING_SNAKE_CASE
// (e.g. 'NOT_FOUND'), which doesn't match the 'Not Found' style the rest of the API
// and the Swagger examples use, so map the statuses we emit explicitly.
const REASON_PHRASES: Record<number, string> = {
  [HttpStatus.BAD_REQUEST]: 'Bad Request',
  [HttpStatus.UNAUTHORIZED]: 'Unauthorized',
  [HttpStatus.FORBIDDEN]: 'Forbidden',
  [HttpStatus.NOT_FOUND]: 'Not Found',
  [HttpStatus.CONFLICT]: 'Conflict',
  [HttpStatus.UNPROCESSABLE_ENTITY]: 'Unprocessable Entity',
  [HttpStatus.TOO_MANY_REQUESTS]: 'Too Many Requests',
  [HttpStatus.INTERNAL_SERVER_ERROR]: 'Internal Server Error',
};

function reasonPhrase(status: number): string {
  return REASON_PHRASES[status] ?? 'Error';
}

function isPgConstraintError(err: unknown): err is { code: string } {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    typeof (err as Record<string, unknown>).code === 'string' &&
    String((err as Record<string, unknown>).code).startsWith('23')
  );
}

function classifyPgError(code: string): ErrorBody {
  switch (code) {
    case PG_UNIQUE_VIOLATION:
      return {
        statusCode: HttpStatus.CONFLICT,
        message: 'Resource already exists',
        error: 'Conflict',
      };
    case PG_FOREIGN_KEY_VIOLATION:
      return {
        statusCode: HttpStatus.BAD_REQUEST,
        message: 'Referenced resource does not exist',
        error: 'Bad Request',
      };
    case PG_NOT_NULL_VIOLATION:
      return {
        statusCode: HttpStatus.BAD_REQUEST,
        message: 'A required field is missing',
        error: 'Bad Request',
      };
    default:
      return {
        statusCode: HttpStatus.BAD_REQUEST,
        message: 'Database constraint violation',
        error: 'Bad Request',
      };
  }
}

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const body = this.classify(exception);

    if (body.statusCode >= 500) {
      this.logger.error(
        `${request.method} ${request.url} → ${body.statusCode}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    response.status(body.statusCode).json({
      ...body,
      timestamp: new Date().toISOString(),
      path: request.url,
    });
  }

  private classify(exception: unknown): ErrorBody {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const res = exception.getResponse();

      if (typeof res === 'string') {
        return {
          statusCode: status,
          message: res,
          error: reasonPhrase(status),
        };
      }

      // Preserve any structured fields the thrown exception attached (ValidationPipe
      // message arrays, and our own domain detail objects) instead of collapsing the
      // body to message/error and dropping the rest.
      const attached = res as Record<string, unknown>;
      return {
        error: reasonPhrase(status),
        message: exception.message,
        ...attached,
        statusCode: status,
      };
    }

    // Domain errors from the AI pipeline are translated here so the chat handler stays a
    // plain call → response, and the structured detail fields reach the client intact.
    if (exception instanceof AiContentExistenceError) {
      return {
        statusCode: HttpStatus.CONFLICT,
        error: reasonPhrase(HttpStatus.CONFLICT),
        message: 'Referenced text has changed; author confirmation required',
        check: 'content_existence',
        operation_index: exception.operationIndex,
        expected_text: exception.expectedText,
        actual_text: exception.actualText,
      };
    }

    if (exception instanceof AiScopeError) {
      return {
        statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
        error: reasonPhrase(HttpStatus.UNPROCESSABLE_ENTITY),
        message: exception.reason,
        check: 'scope',
        reason: exception.reason,
      };
    }

    if (exception instanceof AiValidationError) {
      return {
        statusCode: HttpStatus.BAD_REQUEST,
        error: reasonPhrase(HttpStatus.BAD_REQUEST),
        message: exception.reason,
        reason: exception.reason,
      };
    }

    if (isPgConstraintError(exception)) {
      return classifyPgError(String(exception.code));
    }

    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Internal server error',
      error: 'Internal Server Error',
    };
  }
}
