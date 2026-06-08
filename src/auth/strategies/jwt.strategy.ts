import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

export type JwtPayload = {
  userId: string;
  email: string;
  jti: string;
  iat?: number;
  exp?: number;
};

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(configService: ConfigService) {
    const algorithm = configService.getOrThrow<'HS256' | 'HS384' | 'HS512'>(
      'JWT_ALGORITHM',
    );

    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.getOrThrow<string>('JWT_SECRET'),
      algorithms: [algorithm],
    });
  }

  validate(payload: JwtPayload): JwtPayload {
    if (!payload.userId || !payload.email || !payload.jti) {
      throw new UnauthorizedException('Invalid authentication token');
    }

    return payload;
  }
}
