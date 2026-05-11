import {
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import type { Request } from 'express';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { RedisService } from '../../redis/redis.service';
import type { JwtPayload } from '../strategies/jwt.strategy';

type AuthenticatedRequest = Request & {
  user?: JwtPayload;
};

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(
    private readonly reflector: Reflector,
    private readonly redisService: RedisService,
  ) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (this.isPublic(context)) {
      return true;
    }

    const result = await super.canActivate(context);

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = request.user;
    if (!user?.jti) {
      throw new UnauthorizedException('Authentication required');
    }

    const isBlacklisted = await this.redisService.isTokenBlacklisted(user.jti);
    if (isBlacklisted) {
      throw new UnauthorizedException('Authentication token has been revoked');
    }

    return !!result;
  }

  handleRequest<TUser>(
    err: Error | null,
    user: TUser | false | null,
    info?: Error,
  ): TUser {
    if (err) {
      throw err;
    }

    if (info || !user) {
      throw new UnauthorizedException(
        info?.message ?? 'Authentication required',
      );
    }

    return user;
  }

  private isPublic(context: ExecutionContext): boolean {
    return (
      this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? false
    );
  }
}
