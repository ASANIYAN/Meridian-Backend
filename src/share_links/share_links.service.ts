import * as schema from '../database/schema';
import {
  BadRequestException,
  ForbiddenException,
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
    const appUrl = this.configService
      .getOrThrow<string>('APP_URL')
      .replace(/\/$/, '');
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
        isSingleUse: dto.isSingleUse ?? false,
        expiresAt,
      })
      .returning();

    if (!result) {
      throw new Error('Failed to create share link');
    }

    const url = `${appUrl}/join/${documentId}?token=${result.token}`;

    return { ...result, url };
  }

  async revokeShareLink(documentId: string, token: string) {
    const [updatedLink] = await this.database
      .update(schema.shareLinks)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(schema.shareLinks.token, token),
          eq(schema.shareLinks.documentId, documentId),
          isNull(schema.shareLinks.revokedAt),
        ),
      )
      .returning();

    if (updatedLink) {
      return updatedLink;
    }

    const [existing] = await this.database
      .select()
      .from(schema.shareLinks)
      .where(
        and(
          eq(schema.shareLinks.token, token),
          eq(schema.shareLinks.documentId, documentId),
        ),
      );

    if (!existing) {
      throw new NotFoundException('Link is not found');
    }

    throw new BadRequestException('Link is already revoked.');
  }

  async findAndValidateLink(
    documentId: string,
    token: string,
    db: NodePgDatabase<typeof schema> = this.database,
  ) {
    const [link] = await db
      .select()
      .from(schema.shareLinks)
      .where(
        and(
          eq(schema.shareLinks.documentId, documentId),
          eq(schema.shareLinks.token, token),
        ),
      )
      .limit(1)
      // Lock the link row for the duration of the enclosing transaction so two
      // concurrent claims of the same single-use link serialize: the second waits
      // here, then reads the row the first already marked claimed and is rejected
      // below. Outside a transaction (the default executor) this locks only for the
      // single statement, which is harmless.
      .for('update');

    if (!link) {
      throw new NotFoundException('Link not found');
    }

    if (link.revokedAt) {
      throw new ForbiddenException('Share link has been revoked');
    }

    if (link.expiresAt && link.expiresAt <= new Date()) {
      throw new ForbiddenException('Link has expired');
    }

    if (link.isSingleUse && link.claimedAt) {
      throw new ForbiddenException('Link has already been claimed');
    }

    return link;
  }

  async markLinkAsClaimed(
    linkId: string,
    userId: string,
    db: NodePgDatabase<typeof schema> = this.database,
  ) {
    await db
      .update(schema.shareLinks)
      .set({
        claimedBy: userId,
        claimedAt: new Date(),
      })
      .where(eq(schema.shareLinks.id, linkId));
  }
}
