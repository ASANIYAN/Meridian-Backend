import { Controller, Get } from '@nestjs/common';
import { UsersService } from './users.service';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { UsersListItemResponseDto } from './dto/user-response.dto';
import { errorResponseSchema } from '../common/swagger/utils/error-response-schema';
import { ApiSuccessResponseEnvelope } from '../common/swagger/decorators/api-success-response-envelope.decorator';
import {
  buildSuccessResponse,
  type SuccessResponse,
} from '../common/responses/success-response';

@ApiTags('Users')
@ApiBearerAuth('access-token')
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @ApiOperation({
    summary: 'List users',
    description:
      'Returns the current user records available to the authenticated caller.',
  })
  @ApiSuccessResponseEnvelope({
    dataDto: UsersListItemResponseDto,
    description: 'Users returned successfully.',
    messageExample: 'Users retrieved successfully.',
    isArray: true,
  })
  @ApiUnauthorizedResponse({
    description: 'Missing, expired, or revoked JWT.',
    schema: errorResponseSchema(401, 'Authentication required', 'Unauthorized'),
  })
  async getUsers(): Promise<
    SuccessResponse<Awaited<ReturnType<UsersService['getUsers']>>>
  > {
    const users = await this.usersService.getUsers();
    return buildSuccessResponse('Users retrieved successfully.', users);
  }
}
