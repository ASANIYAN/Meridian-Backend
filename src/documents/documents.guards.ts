import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { DocumentsService } from './documents.service';
import { MembershipsService } from '../memberships/memberships.service';
import { JwtPayload } from '../auth/strategies/jwt.strategy';

type DocumentRequest = Request & {
  user?: JwtPayload;
  membershipRole?: string;
};

@Injectable()
export class DocumentExistsGuard implements CanActivate {
  private readonly logger = new Logger(DocumentExistsGuard.name);

  constructor(private readonly documentsService: DocumentsService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<DocumentRequest>();
    const documentId = request.params.id as string;
    const document = await this.documentsService.getDocumentById(documentId);

    if (!document || document.status === 'deleted') {
      this.logger.log(`Document ${documentId} not found or deleted`);
      throw new NotFoundException('Document not found');
    }

    return true;
  }
}

@Injectable()
export class DocumentMembershipGuard implements CanActivate {
  private readonly logger = new Logger(DocumentMembershipGuard.name);

  constructor(private readonly membershipsService: MembershipsService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<DocumentRequest>();
    const userId = request.user?.userId;

    if (!userId) {
      throw new UnauthorizedException('Authentication required');
    }

    const documentId = request.params.id as string;
    const membership = await this.membershipsService.getUserDocumentMembership(
      documentId,
      userId,
    );

    if (!membership) {
      this.logger.log(
        `User ${userId} has no membership for document ${documentId}`,
      );
      throw new ForbiddenException('User is not a member of this document');
    }

    request.membershipRole = membership.role;
    return true;
  }
}

@Injectable()
export class DocumentWriteAccessGuard implements CanActivate {
  private readonly logger = new Logger(DocumentWriteAccessGuard.name);

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<DocumentRequest>();
    const role = request.membershipRole;

    if (role !== 'author' && role !== 'editor') {
      this.logger.log(
        `Insufficient permission for user ${request.user?.userId} with role: ${role}`,
      );
      throw new ForbiddenException('Insufficient permissions');
    }

    return true;
  }
}

@Injectable()
export class DocumentAuthorGuard implements CanActivate {
  private readonly logger = new Logger(DocumentAuthorGuard.name);

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<DocumentRequest>();
    const role = request.membershipRole;

    if (role !== 'author') {
      this.logger.log(
        `Insufficient permission for user ${request.user?.userId} with role: ${role}`,
      );
      throw new ForbiddenException('Insufficient permissions');
    }

    return true;
  }
}
