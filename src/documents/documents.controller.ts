import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
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
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CreateDocumentDto } from './dto/create-document.dto';
import { CreateDocumentResponseDataDto } from './dto/document-response.dto';
import { ListDocumentsResponseDataDto } from './dto/list-documents-response.dto';
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

  @Post()
  @HttpCode(HttpStatus.CREATED)
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
}
