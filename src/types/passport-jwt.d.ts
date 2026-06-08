declare module 'passport-jwt' {
  import { Strategy as PassportStrategyBase } from 'passport-strategy';

  export type JwtFromRequestFunction<T = unknown> = (req: T) => string | null;

  export interface StrategyOptionsWithoutRequest {
    jwtFromRequest: JwtFromRequestFunction;
    secretOrKey: string | Buffer;
    ignoreExpiration?: boolean;
    issuer?: string;
    audience?: string | string[];
    algorithms?: string[];
    passReqToCallback?: false;
  }

  export class Strategy extends PassportStrategyBase {
    constructor(
      options: StrategyOptionsWithoutRequest,
      verify?: (...args: unknown[]) => unknown,
    );
  }

  export const ExtractJwt: {
    fromAuthHeaderAsBearerToken(): JwtFromRequestFunction;
  };
}
