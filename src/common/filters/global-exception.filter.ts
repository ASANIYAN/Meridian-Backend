import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

const PG_UNIQUE_VIOLATION = '23505';
const PG_FOREIGN_KEY_VIOLATION = '23503';
const PG_NOT_NULL_VIOLATION = '23502';

interface ErrorShape {
  statusCode: number;
  message: string | string[];
  error: string;
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

function classifyPgError(code: string): ErrorShape {
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

    const { statusCode, message, error } = this.classify(exception);

    if (statusCode >= 500) {
      this.logger.error(
        `${request.method} ${request.url} → ${statusCode}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    response.status(statusCode).json({
      statusCode,
      message,
      error,
      timestamp: new Date().toISOString(),
      path: request.url,
    });
  }

  private classify(exception: unknown): ErrorShape {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const res = exception.getResponse();

      if (typeof res === 'string') {
        return {
          statusCode: status,
          message: res,
          error: HttpStatus[status] ?? 'Error',
        };
      }

      const body = res as Record<string, unknown>;
      return {
        statusCode: status,
        message: (body.message as string | string[]) ?? exception.message,
        error: (body.error as string) ?? HttpStatus[status] ?? 'Error',
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
