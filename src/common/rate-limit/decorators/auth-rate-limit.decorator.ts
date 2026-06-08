import { Throttle } from '@nestjs/throttler';

export function AuthRateLimit() {
  return Throttle({
    auth: {},
  });
}
