import * as schema from '../database/schema';
import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DATABASE_CONNECTION } from '../database/database-connection';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { ConfigService } from '@nestjs/config';
import { CreateShareLinkDto } from './dto/create-share-link.dto';
import { and, eq, isNull } from 'drizzle-orm';

@Injectable()
export class ShareLinksService {
  constructor(
    @Inject(DATABASE_CONNECTION)
    private readonly database: NodePgDatabase<typeof schema>,
    private readonly configService: ConfigService,
  ) {}

  async createShareLink(
    documentId: string,
    createdBy: string,
    dto: CreateShareLinkDto,
  ) {
    const appUrl = this.configService.getOrThrow<string>('APP_URL');
    const expiresAt = new Date(
      Date.now() +
        this.configService.getOrThrow<number>('SHARE_LINK_EXPIRY_DAYS') *
          86_400_000,
    );

    const [result] = await this.database
      .insert(schema.shareLinks)
      .values({
        documentId,
        createdBy,
        role: dto.role,
        isSingleUse: dto.isSingleUse,
        expiresAt,
      })
      .returning();

    const url = `${appUrl}/join/${result.token}`;

    return { ...result, url };
  }

  async revokeShareLink(documentId: string, token: string) {
    const where = and(
      eq(schema.shareLinks.token, token),
      eq(schema.shareLinks.documentId, documentId),
    );

    const [updatedLink] = await this.database
      .update(schema.shareLinks)
      .set({ revokedAt: new Date() })
      .where(and(where, isNull(schema.shareLinks.revokedAt)))
      .returning();

    if (updatedLink) {
      return updatedLink;
    }

    const [existing] = await this.database
      .select()
      .from(schema.shareLinks)
      .where(where);

    if (!existing) {
      throw new NotFoundException('Link is not found');
    }

    throw new BadRequestException('Link is already revoked.');
  }
}
