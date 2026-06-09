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

@ApiTags('Documents')
@Controller('documents')
export class DocumentsController {
  constructor(private readonly documentService: DocumentsService) {}

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
