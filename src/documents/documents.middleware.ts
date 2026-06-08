import { Injectable, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';

@Injectable()
export class DocumentExistsGuard implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    next();
  }
}

@Injectable()
export class DocumentMembershipGuard implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    next();
  }
}
