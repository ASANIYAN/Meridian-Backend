import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiTags,
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CreateDocumentDto } from './dto/create-document.dto';
import {
  CreateDocumentResponseDataDto,
  UpdateDocumentResponseDataDto,
} from './dto/document-response.dto';
import { ListDocumentsResponseDataDto } from './dto/list-documents-response.dto';
import { GetDocumentResponseDataDto } from './dto/get-document-response.dto';
import { GetDocumentMembersResponseDataDto } from './dto/get-document-members-response.dto';
import {
  buildSuccessResponse,
  SuccessResponse,
} from '../common/responses/success-response';
import { DocumentsService } from './documents.service';
import { ApiSuccessResponseEnvelope } from '../common/swagger/decorators/api-success-response-envelope.decorator';
import { errorResponseSchema } from '../common/swagger/utils/error-response-schema';
import type { Request } from 'express';
import type { JwtPayload } from '../auth/strategies/jwt.strategy';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  DocumentAuthorGuard,
  DocumentExistsGuard,
  DocumentMembershipGuard,
  DocumentWriteAccessGuard,
} from './documents.guards';
import { UpdateDocumentDto } from './dto/update-document.dto';
import { UpdateDocumentStatusDto } from './dto/update-document-status.dto';
import { AddDocumentMemberDto } from './dto/add-document-member.dto';
import { AddDocumentMemberResponseDataDto } from './dto/add-document-member-response.dto';
import { UpdateDocumentMemberRole } from './dto/update-document-member-role.dto';
import { UpdateDocumentMemberRoleResponse } from './dto/update-document-member-role-response.dto';
import { CreateShareLinkDto } from '../share_links/dto/create-share-link.dto';
import { CreateShareLinkResponseDataDto } from '../share_links/dto/create-share-link-response.dto';
import { RevokeShareLinkResponseDataDto } from '../share_links/dto/revoke-share-link-response.dto';
import { ShareLinksService } from '../share_links/share_links.service';
import { ClaimShareLinkResponseDataDto } from './dto/claim-share-link-response.dto';

@ApiTags('Documents')
@Controller('documents')
export class DocumentsController {
  constructor(
    private readonly documentService: DocumentsService,
    private readonly sharelinksService: ShareLinksService,
  ) {}

  @Get()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'List user documents',
    description:
      'Returns all documents where the requesting user has any membership, including their role on each document. Excludes deleted documents. Ordered by last updated descending.',
  })
  @ApiSuccessResponseEnvelope({
    dataDto: ListDocumentsResponseDataDto,
    description: 'Documents retrieved successfully.',
    messageExample: 'Documents retrieved successfully.',
    meta: {
      page: { type: 'number', example: 1 },
      limit: { type: 'number', example: 10 },
      total: { type: 'number', example: 50 },
      totalPages: { type: 'number', example: 5 },
    },
  })
  @ApiUnauthorizedResponse({
    description: 'Missing, expired, or revoked JWT.',
    schema: errorResponseSchema(401, 'Authentication required', 'Unauthorized'),
  })
  async listUserDocumentsWithRole(
    @Query() query: PaginationQueryDto,
    @Req() request: Request & { user: JwtPayload },
  ) {
    const { page, limit } = query;

    const result = await this.documentService.listUserDocumentsWithRole(
      request.user.userId,
      page,
      limit,
    );

    return buildSuccessResponse(
      'Documents retrieved successfully.',
      { documents: result.data },
      result.meta,
    );
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard, DocumentExistsGuard, DocumentMembershipGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Get document',
    description:
      'Returns metadata for a single document the requesting user is a member of, including their role and the total member count.',
  })
  @ApiSuccessResponseEnvelope({
    dataDto: GetDocumentResponseDataDto,
    description: 'Document retrieved successfully.',
    messageExample: 'Document retrieved successfully.',
  })
  @ApiUnauthorizedResponse({
    description: 'Missing, expired, or revoked JWT.',
    schema: errorResponseSchema(401, 'Authentication required', 'Unauthorized'),
  })
  @ApiNotFoundResponse({
    description: 'Document does not exist or has been deleted.',
    schema: errorResponseSchema(404, 'Document not found', 'Not Found'),
  })
  @ApiForbiddenResponse({
    description: 'Authenticated user has no membership on this document.',
    schema: errorResponseSchema(
      403,
      'User is not a member of this document',
      'Forbidden',
    ),
  })
  async getDocument(
    @Param('id') documentId: string,
    @Req() request: Request & { membershipRole: string },
  ) {
    const result =
      await this.documentService.getDocumentWithMemberCount(documentId);
    const mergedResult = { ...result, role: request.membershipRole };

    return buildSuccessResponse('Document retrieved successfully.', {
      document: mergedResult,
    });
  }

  @Get(':id/members')
  @UseGuards(JwtAuthGuard, DocumentExistsGuard, DocumentMembershipGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'List document members',
    description:
      'Returns all members of a document with their role and how they joined. Accessible to all membership roles (author, editor, viewer).',
  })
  @ApiSuccessResponseEnvelope({
    dataDto: GetDocumentMembersResponseDataDto,
    description: 'Document members retrieved successfully.',
    messageExample: 'Document members retrieved successfully.',
  })
  @ApiUnauthorizedResponse({
    description: 'Missing, expired, or revoked JWT.',
    schema: errorResponseSchema(401, 'Authentication required', 'Unauthorized'),
  })
  @ApiNotFoundResponse({
    description: 'Document does not exist or has been deleted.',
    schema: errorResponseSchema(404, 'Document not found', 'Not Found'),
  })
  @ApiForbiddenResponse({
    description: 'Authenticated user has no membership on this document.',
    schema: errorResponseSchema(
      403,
      'User is not a member of this document',
      'Forbidden',
    ),
  })
  async listMembers(@Param('id') documentId: string) {
    const members = await this.documentService.getDocumentMembers(documentId);

    return buildSuccessResponse('Document members retrieved successfully.', {
      members,
    });
  }

  @Post(':id/links/:token/validate')
  @UseGuards(JwtAuthGuard, DocumentExistsGuard) // ← NO DocumentMembershipGuard
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Claim a share link' })
  @ApiSuccessResponseEnvelope(ClaimShareLinkResponseDataDto, { status: 200 })
  @ApiForbiddenResponse({ description: 'Revoked / expired / already claimed' })
  @ApiConflictResponse({ description: 'User is already a member' })
  @ApiNotFoundResponse({ description: 'Share link not found' })
  async claimShareLink(
    @Param('id') documentId: string,
    @Param('token') token: string,
    @Req() request: Request & { user: JwtPayload },
  ) {
    const userId = request.user.userId;
    const data = await this.documentService.claimShareLink(
      documentId,
      token,
      userId,
    );
    return buildSuccessResponse('Share link claimed successfully', data);
  }

  @Post(':id/members')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(
    JwtAuthGuard,
    DocumentExistsGuard,
    DocumentMembershipGuard,
    DocumentAuthorGuard,
  )
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Add document member',
    description:
      'Adds a user to a document by email with editor or viewer role. Only the document author may add members. The membership is created with mode invite.',
  })
  @ApiSuccessResponseEnvelope({
    status: 201,
    dataDto: AddDocumentMemberResponseDataDto,
    description: 'Member added successfully.',
    messageExample: 'Member added successfully.',
  })
  @ApiBadRequestResponse({
    description:
      'Validation failed — email is invalid or role is not editor or viewer.',
    schema: errorResponseSchema(
      400,
      ['role must be one of the following values: editor, viewer'],
      'Bad Request',
    ),
  })
  @ApiUnauthorizedResponse({
    description: 'Missing, expired, or revoked JWT.',
    schema: errorResponseSchema(401, 'Authentication required', 'Unauthorized'),
  })
  @ApiNotFoundResponse({
    description:
      'Document does not exist, has been deleted, or email does not match any user.',
    schema: errorResponseSchema(404, 'User not found.', 'Not Found'),
  })
  @ApiForbiddenResponse({
    description: 'Authenticated user is not the author of this document.',
    schema: errorResponseSchema(403, 'Insufficient permissions', 'Forbidden'),
  })
  @ApiConflictResponse({
    description: 'The user is already a member of this document.',
    schema: errorResponseSchema(
      409,
      'User is already a member of this document.',
      'Conflict',
    ),
  })
  async addMember(
    @Param('id') documentId: string,
    @Body() body: AddDocumentMemberDto,
  ) {
    const member = await this.documentService.addDocumentMember(
      documentId,
      body.email,
      body.role,
    );

    return buildSuccessResponse('Member added successfully.', { member });
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Create a document',
    description:
      'Creates a new document with status set to draft and automatically assigns the creator an author membership.',
  })
  @ApiSuccessResponseEnvelope({
    status: 201,
    dataDto: CreateDocumentResponseDataDto,
    description: 'Document created successfully.',
    messageExample: 'Document created successfully.',
  })
  @ApiBadRequestResponse({
    description: 'Validation failed — title is missing or not a string.',
    schema: errorResponseSchema(
      400,
      ['title should not be empty'],
      'Bad Request',
    ),
  })
  @ApiUnauthorizedResponse({
    description: 'Missing, expired, or revoked JWT.',
    schema: errorResponseSchema(401, 'Authentication required', 'Unauthorized'),
  })
  async createDocument(
    @Body() data: CreateDocumentDto,
    @Req() request: Request & { user: JwtPayload },
  ): Promise<
    SuccessResponse<{
      document: Awaited<ReturnType<DocumentsService['createDocument']>>;
    }>
  > {
    const document = await this.documentService.createDocument(
      data.title,
      request.user.userId,
    );

    return buildSuccessResponse('Document created successfully.', { document });
  }

  @Post(':id/links')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(
    JwtAuthGuard,
    DocumentExistsGuard,
    DocumentMembershipGuard,
    DocumentAuthorGuard,
  )
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Create share link',
    description:
      'Generates a shareable invitation link for the document with a pre-assigned role. Only the document author may create links. The link token is a UUID and expires in 7 days by default. Set is_single_use to true to invalidate the link after the first claim.',
  })
  @ApiSuccessResponseEnvelope({
    status: 201,
    dataDto: CreateShareLinkResponseDataDto,
    description: 'Share link created successfully.',
    messageExample: 'Link created successfully.',
  })
  @ApiBadRequestResponse({
    description: 'Validation failed — role is not editor or viewer.',
    schema: errorResponseSchema(
      400,
      ['role must be one of the following values: editor, viewer'],
      'Bad Request',
    ),
  })
  @ApiUnauthorizedResponse({
    description: 'Missing, expired, or revoked JWT.',
    schema: errorResponseSchema(401, 'Authentication required', 'Unauthorized'),
  })
  @ApiNotFoundResponse({
    description: 'Document does not exist or has been deleted.',
    schema: errorResponseSchema(404, 'Document not found', 'Not Found'),
  })
  @ApiForbiddenResponse({
    description: 'Authenticated user is not the author of this document.',
    schema: errorResponseSchema(403, 'Insufficient permissions', 'Forbidden'),
  })
  async createLink(
    @Param('id') documentId: string,
    @Body() body: CreateShareLinkDto,
    @Req() request: Request & { user: JwtPayload },
  ) {
    const link = await this.sharelinksService.createShareLink(
      documentId,
      request.user.userId,
      body,
    );

    return buildSuccessResponse('Link created successfully.', { link });
  }

  @Patch(':id/links/:token')
  @UseGuards(
    JwtAuthGuard,
    DocumentExistsGuard,
    DocumentMembershipGuard,
    DocumentAuthorGuard,
  )
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Revoke share link',
    description:
      'Revokes a share link so it can no longer be used to join the document. Only the document author may revoke links. Members who already joined via this link are unaffected.',
  })
  @ApiSuccessResponseEnvelope({
    dataDto: RevokeShareLinkResponseDataDto,
    description: 'Share link revoked successfully.',
    messageExample: 'Link revoked successfully.',
  })
  @ApiBadRequestResponse({
    description: 'Link has already been revoked.',
    schema: errorResponseSchema(400, 'Link is already revoked.', 'Bad Request'),
  })
  @ApiUnauthorizedResponse({
    description: 'Missing, expired, or revoked JWT.',
    schema: errorResponseSchema(401, 'Authentication required', 'Unauthorized'),
  })
  @ApiNotFoundResponse({
    description: 'Document does not exist or share link token not found.',
    schema: errorResponseSchema(404, 'Link is not found', 'Not Found'),
  })
  @ApiForbiddenResponse({
    description: 'Authenticated user is not the author of this document.',
    schema: errorResponseSchema(403, 'Insufficient permissions', 'Forbidden'),
  })
  async revokeLink(
    @Param('id') documentId: string,
    @Param('token') token: string,
  ) {
    const link = await this.sharelinksService.revokeShareLink(
      documentId,
      token,
    );

    return buildSuccessResponse('Link revoked successfully.', { link });
  }

  @Patch(':id/members/:userId')
  @UseGuards(
    JwtAuthGuard,
    DocumentExistsGuard,
    DocumentMembershipGuard,
    DocumentAuthorGuard,
  )
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Update member role',
    description:
      'Changes the role of a document member to editor or viewer. Only the document author may change roles. The author role cannot be changed, and the author cannot change their own role.',
  })
  @ApiSuccessResponseEnvelope({
    dataDto: UpdateDocumentMemberRoleResponse,
    description: 'Member role updated successfully.',
    messageExample: 'Member role updated successfully.',
  })
  @ApiBadRequestResponse({
    description:
      'Role is not editor or viewer, target user is the document author, or author is attempting to change their own role.',
    schema: errorResponseSchema(
      400,
      ['role must be one of the following values: editor, viewer'],
      'Bad Request',
    ),
  })
  @ApiUnauthorizedResponse({
    description: 'Missing, expired, or revoked JWT.',
    schema: errorResponseSchema(401, 'Authentication required', 'Unauthorized'),
  })
  @ApiNotFoundResponse({
    description:
      'Document does not exist, has been deleted, or target user is not a member.',
    schema: errorResponseSchema(404, 'Member not found', 'Not Found'),
  })
  @ApiForbiddenResponse({
    description: 'Authenticated user is not the author of this document.',
    schema: errorResponseSchema(403, 'Insufficient permissions', 'Forbidden'),
  })
  async updateDocumentMemberRole(
    @Param('id') documentId: string,
    @Param('userId') targetUserId: string,
    @Body() body: UpdateDocumentMemberRole,
    @Req() request: Request & { user: JwtPayload },
  ) {
    const updatedMember = await this.documentService.updateDocumentMemberRole(
      documentId,
      targetUserId,
      request.user.userId,
      body.role,
    );

    return buildSuccessResponse('Member role updated successfully.', {
      member: updatedMember,
    });
  }

  @Patch(':id/status')
  @UseGuards(
    JwtAuthGuard,
    DocumentExistsGuard,
    DocumentMembershipGuard,
    DocumentAuthorGuard,
  )
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Update document status',
    description:
      'Updates the status of a document to active or inactive. Only the document author may change status — editors and viewers receive 403. Setting status to deleted or draft via this endpoint is not permitted.',
  })
  @ApiSuccessResponseEnvelope({
    dataDto: UpdateDocumentResponseDataDto,
    description: 'Document status updated successfully.',
    messageExample: 'Document status updated successfully.',
  })
  @ApiBadRequestResponse({
    description:
      'Validation failed — status is missing, not a string, or not one of: active, inactive.',
    schema: errorResponseSchema(
      400,
      ['status must be one of the following values: active, inactive'],
      'Bad Request',
    ),
  })
  @ApiUnauthorizedResponse({
    description: 'Missing, expired, or revoked JWT.',
    schema: errorResponseSchema(401, 'Authentication required', 'Unauthorized'),
  })
  @ApiNotFoundResponse({
    description: 'Document does not exist or has been deleted.',
    schema: errorResponseSchema(404, 'Document not found', 'Not Found'),
  })
  @ApiForbiddenResponse({
    description: 'Authenticated user is not the author of this document.',
    schema: errorResponseSchema(403, 'Insufficient permissions', 'Forbidden'),
  })
  async updateDocumentStatus(
    @Param('id') documentId: string,
    @Body() body: UpdateDocumentStatusDto,
  ) {
    const updatedDocument = await this.documentService.updateDocumentStatus(
      documentId,
      body.status,
    );

    return buildSuccessResponse('Document status updated successfully.', {
      document: updatedDocument,
    });
  }

  @Patch(':id')
  @UseGuards(
    JwtAuthGuard,
    DocumentExistsGuard,
    DocumentMembershipGuard,
    DocumentWriteAccessGuard,
  )
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Update document',
    description:
      'Updates the title of a document. Only authors and editors may update — viewers receive 403. Content changes go through WebSocket, not this endpoint.',
  })
  @ApiSuccessResponseEnvelope({
    dataDto: UpdateDocumentResponseDataDto,
    description: 'Document updated successfully.',
    messageExample: 'Document updated successfully.',
  })
  @ApiBadRequestResponse({
    description:
      'Validation failed — body is empty, title is an empty string, or title is not a string.',
    schema: errorResponseSchema(
      400,
      ['At least one field must be provided', 'title should not be empty'],
      'Bad Request',
    ),
  })
  @ApiUnauthorizedResponse({
    description: 'Missing, expired, or revoked JWT.',
    schema: errorResponseSchema(401, 'Authentication required', 'Unauthorized'),
  })
  @ApiNotFoundResponse({
    description: 'Document does not exist or has been deleted.',
    schema: errorResponseSchema(404, 'Document not found', 'Not Found'),
  })
  @ApiForbiddenResponse({
    description:
      'User has no membership on this document, or is a member with viewer role.',
    schema: errorResponseSchema(403, 'Insufficient permissions', 'Forbidden'),
  })
  async updateDocument(
    @Param('id') documentId: string,
    @Body() body: UpdateDocumentDto,
  ) {
    const updatedDocument = await this.documentService.updateDocumentTitle(
      documentId,
      body.title!,
    );

    return buildSuccessResponse('Document updated successfully.', {
      document: updatedDocument,
    });
  }

  @Delete(':id/members/:userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(
    JwtAuthGuard,
    DocumentExistsGuard,
    DocumentMembershipGuard,
    DocumentAuthorGuard,
  )
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Remove document member',
    description:
      'Permanently removes a member from a document. Only the document author may remove members. The author cannot remove themselves. The removed member immediately loses document access; their operations and history are preserved.',
  })
  @ApiBadRequestResponse({
    description: 'Author attempted to remove themselves.',
    schema: errorResponseSchema(
      400,
      'Author cannot remove themselves',
      'Bad Request',
    ),
  })
  @ApiUnauthorizedResponse({
    description: 'Missing, expired, or revoked JWT.',
    schema: errorResponseSchema(401, 'Authentication required', 'Unauthorized'),
  })
  @ApiNotFoundResponse({
    description:
      'Document does not exist, has been deleted, or target user is not a member.',
    schema: errorResponseSchema(404, 'Member not found', 'Not Found'),
  })
  @ApiForbiddenResponse({
    description: 'Authenticated user is not the author of this document.',
    schema: errorResponseSchema(403, 'Insufficient permissions', 'Forbidden'),
  })
  async deleteMember(
    @Param('id') documentId: string,
    @Param('userId') targetUserId: string,
    @Req() request: Request & { user: JwtPayload },
  ) {
    await this.documentService.removeDocumentMember(
      documentId,
      targetUserId,
      request.user.userId,
    );
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(
    JwtAuthGuard,
    DocumentExistsGuard,
    DocumentMembershipGuard,
    DocumentAuthorGuard,
  )
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Delete document',
    description:
      'Soft-deletes a document by setting its status to deleted. Only the document author may delete — editors and viewers receive 403. The row is preserved in the database; all memberships, operations, and snapshots remain intact.',
  })
  @ApiUnauthorizedResponse({
    description: 'Missing, expired, or revoked JWT.',
    schema: errorResponseSchema(401, 'Authentication required', 'Unauthorized'),
  })
  @ApiNotFoundResponse({
    description: 'Document does not exist or has already been deleted.',
    schema: errorResponseSchema(404, 'Document not found', 'Not Found'),
  })
  @ApiForbiddenResponse({
    description: 'Authenticated user is not the author of this document.',
    schema: errorResponseSchema(403, 'Insufficient permissions', 'Forbidden'),
  })
  async deleteDocument(@Param('id') documentId: string): Promise<void> {
    await this.documentService.softDeleteDocument(documentId);
  }
}
