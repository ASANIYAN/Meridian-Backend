import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
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
import {
  buildSuccessResponse,
  SuccessResponse,
} from '../common/responses/success-response';
import { DocumentsService } from './documents.service';
import { ApiSuccessResponseEnvelope } from '../common/swagger/decorators/api-success-response-envelope.decorator';
import { errorResponseSchema } from '../common/swagger/utils/error-response-schema';
import type { Request } from 'express';
import type { JwtPayload } from '../auth/strategies/jwt.strategy';

@ApiTags('Documents')
@Controller('documents')
export class DocumentsController {
  constructor(private readonly documentService: DocumentsService) {}

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
