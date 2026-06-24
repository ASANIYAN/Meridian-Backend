import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import {
  ArgumentsHost,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { GlobalExceptionFilter } from './global-exception.filter';

function createHost(url = '/v1/test', method = 'GET') {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const request = { url, method };

  return {
    host: {
      switchToHttp: jest.fn().mockReturnValue({
        getResponse: jest.fn().mockReturnValue({ status }),
        getRequest: jest.fn().mockReturnValue(request),
      }),
    } as unknown as ArgumentsHost,
    status,
    json,
  };
}

describe('GlobalExceptionFilter', () => {
  let filter: GlobalExceptionFilter;
  let loggerError: jest.Mock;

  beforeEach(() => {
    filter = new GlobalExceptionFilter();
    loggerError = jest
      .spyOn(filter['logger'], 'error')
      .mockImplementation(() => undefined) as unknown as jest.Mock;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('response shape', () => {
    it('always includes statusCode, message, error, timestamp, and path', () => {
      const { host, json } = createHost('/v1/auth/login');

      filter.catch(new NotFoundException('Not found'), host);

      const body = (json as jest.Mock<typeof json>).mock.calls[0][0] as Record<
        string,
        unknown
      >;
      expect(body).toHaveProperty('statusCode');
      expect(body).toHaveProperty('message');
      expect(body).toHaveProperty('error');
      expect(body).toHaveProperty('timestamp');
      expect(body).toHaveProperty('path', '/v1/auth/login');
    });

    it('never includes a stack property in the response', () => {
      const { host, json } = createHost();

      filter.catch(new Error('boom'), host);

      const body = (json as jest.Mock<typeof json>).mock.calls[0][0] as Record<
        string,
        unknown
      >;
      expect(body).not.toHaveProperty('stack');
    });

    it('sets timestamp to a valid ISO string', () => {
      const { host, json } = createHost();

      filter.catch(new NotFoundException(), host);

      const body = (json as jest.Mock<typeof json>).mock.calls[0][0] as Record<
        string,
        unknown
      >;
      expect(() => new Date(body.timestamp as string)).not.toThrow();
      expect(isNaN(new Date(body.timestamp as string).getTime())).toBe(false);
    });
  });

  describe('HttpException handling', () => {
    it('maps NotFoundException to 404', () => {
      const { host, status, json } = createHost();

      filter.catch(new NotFoundException('Not found'), host);

      expect(status.mock.calls[0][0]).toBe(HttpStatus.NOT_FOUND);
      const body = (json as jest.Mock<typeof json>).mock.calls[0][0] as Record<
        string,
        unknown
      >;
      expect(body.statusCode).toBe(404);
      expect(body.message).toBe('Not found');
      expect(body.error).toBe('Not Found');
    });

    it('maps UnauthorizedException to 401', () => {
      const { host, status } = createHost();

      filter.catch(new UnauthorizedException('Invalid token'), host);

      expect(status.mock.calls[0][0]).toBe(HttpStatus.UNAUTHORIZED);
    });

    it('maps ForbiddenException to 403 without leaking implementation details', () => {
      const { host, status, json } = createHost();

      filter.catch(new ForbiddenException('Access denied'), host);

      expect(status.mock.calls[0][0]).toBe(HttpStatus.FORBIDDEN);
      const body = (json as jest.Mock<typeof json>).mock.calls[0][0] as Record<
        string,
        unknown
      >;
      expect(body.message).toBe('Access denied');
    });

    it('maps ConflictException to 409', () => {
      const { host, status } = createHost();

      filter.catch(new ConflictException('Already exists'), host);

      expect(status.mock.calls[0][0]).toBe(HttpStatus.CONFLICT);
    });

    it('preserves array messages from ValidationPipe', () => {
      const { host, json } = createHost();
      const messages = ['email must be an email', 'password is too short'];

      filter.catch(new BadRequestException(messages), host);

      const body = (json as jest.Mock<typeof json>).mock.calls[0][0] as Record<
        string,
        unknown
      >;
      expect(body.message).toEqual(messages);
      expect(body.statusCode).toBe(400);
      expect(body.error).toBe('Bad Request');
    });

    it('handles raw HttpException with a string response', () => {
      const { host, json, status } = createHost();
      const exception = new HttpException('raw string', HttpStatus.GONE);

      filter.catch(exception, host);

      expect(status.mock.calls[0][0]).toBe(HttpStatus.GONE);
      const body = (json as jest.Mock<typeof json>).mock.calls[0][0] as Record<
        string,
        unknown
      >;
      expect(body.message).toBe('raw string');
    });
  });

  describe('Drizzle / Postgres constraint errors', () => {
    it('maps unique violation (23505) to 409 Conflict', () => {
      const { host, status, json } = createHost();

      filter.catch({ code: '23505' }, host);

      expect(status.mock.calls[0][0]).toBe(HttpStatus.CONFLICT);
      const body = (json as jest.Mock<typeof json>).mock.calls[0][0] as Record<
        string,
        unknown
      >;
      expect(body.statusCode).toBe(409);
      expect(body.error).toBe('Conflict');
      expect(typeof body.message).toBe('string');
    });

    it('maps foreign key violation (23503) to 400 Bad Request', () => {
      const { host, status } = createHost();

      filter.catch({ code: '23503' }, host);

      expect(status.mock.calls[0][0]).toBe(HttpStatus.BAD_REQUEST);
    });

    it('maps not-null violation (23502) to 400 Bad Request', () => {
      const { host, status } = createHost();

      filter.catch({ code: '23502' }, host);

      expect(status.mock.calls[0][0]).toBe(HttpStatus.BAD_REQUEST);
    });

    it('maps unknown 23xxx codes to 400 Bad Request', () => {
      const { host, status } = createHost();

      filter.catch({ code: '23000' }, host);

      expect(status.mock.calls[0][0]).toBe(HttpStatus.BAD_REQUEST);
    });
  });

  describe('unknown / unhandled errors', () => {
    it('maps an unhandled Error to 500 with a generic message', () => {
      const { host, status, json } = createHost();

      filter.catch(new Error('something exploded'), host);

      expect(status.mock.calls[0][0]).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
      const body = (json as jest.Mock<typeof json>).mock.calls[0][0] as Record<
        string,
        unknown
      >;
      expect(body.statusCode).toBe(500);
      expect(body.message).toBe('Internal server error');
      expect(body.error).toBe('Internal Server Error');
    });

    it('maps a non-Error throw to 500 with a generic message', () => {
      const { host, status, json } = createHost();

      filter.catch('oops', host);

      expect(status.mock.calls[0][0]).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
      const body = (json as jest.Mock<typeof json>).mock.calls[0][0] as Record<
        string,
        unknown
      >;
      expect(body.message).toBe('Internal server error');
    });

    it('does not reveal the original error message in the 500 response', () => {
      const { host, json } = createHost();

      filter.catch(new Error('DB password is hunter2'), host);

      const body = (json as jest.Mock<typeof json>).mock.calls[0][0] as Record<
        string,
        unknown
      >;
      expect(JSON.stringify(body)).not.toContain('hunter2');
    });
  });

  describe('5xx internal logging', () => {
    it('logs with the full stack trace when an unhandled error produces a 500', () => {
      const { host } = createHost('/v1/documents', 'POST');
      const err = new Error('db exploded');

      filter.catch(err, host);

      expect(loggerError).toHaveBeenCalledWith(
        'POST /v1/documents → 500',
        err.stack,
      );
    });

    it('does not log for 4xx errors', () => {
      const { host } = createHost();

      filter.catch(new NotFoundException(), host);

      expect(loggerError).not.toHaveBeenCalled();
    });

    it('does not log for pg constraint errors that map to 4xx', () => {
      const { host } = createHost();

      filter.catch({ code: '23505' }, host);

      expect(loggerError).not.toHaveBeenCalled();
    });
  });
});
