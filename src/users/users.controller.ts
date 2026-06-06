import { Controller, Get } from '@nestjs/common';
import { UsersService } from './users.service';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { UsersListItemResponseDto } from './dto/user-response.dto';
import { errorResponseSchema } from '../common/swagger/utils/error-response-schema';

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
  @ApiOkResponse({
    description: 'Users returned successfully.',
    type: UsersListItemResponseDto,
    isArray: true,
  })
  @ApiUnauthorizedResponse({
    description: 'Missing, expired, or revoked JWT.',
    schema: errorResponseSchema(401, 'Authentication required', 'Unauthorized'),
  })
  async getUsers() {
    return this.usersService.getUsers();
  }
}
