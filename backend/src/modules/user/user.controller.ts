import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery } from '@nestjs/swagger';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { ChangePasswordDto } from './dto/change-password.dto';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserService } from './user.service';

@ApiTags('Управление — Пользователи')
@Controller('users')
export class UserController {
  constructor(private readonly service: UserService) {}

  @Get()
  @Roles('admin', 'manager')
  @ApiOperation({ summary: 'List all users with pagination' })
  @ApiQuery({ name: 'page', required: false, description: 'Page number' })
  @ApiQuery({ name: 'limit', required: false, description: 'Items per page' })
  @ApiResponse({ status: 200, description: 'Paginated list of users' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  list(@Query('page') page = '1', @Query('limit') limit = '20') {
    return this.service.findAll(parseInt(page, 10), parseInt(limit, 10));
  }

  /**
   * Read a user: self can always read self; admin can read anyone.
   */
  @Get(':id')
  @ApiOperation({ summary: 'Get user by ID (self or admin only)' })
  @ApiResponse({ status: 200, description: 'User found' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'User not found' })
  async findOne(
    @Param('id') id: string,
    @CurrentUser() me: AuthenticatedUser,
  ) {
    if (me.role !== 'admin' && me.id !== id) {
      throw new ForbiddenException('You can only view your own profile');
    }
    return this.service.findById(id);
  }

  @Get('me/profile')
  @Roles('admin', 'manager', 'user')
  @ApiOperation({ summary: 'Get current user profile' })
  @ApiResponse({ status: 200, description: 'User profile' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  getMe(@CurrentUser() me: AuthenticatedUser) {
    return this.service.findById(me.id);
  }

  @Post()
  @Roles('admin')
  @ApiOperation({ summary: 'Create a new user (admin only)' })
  @ApiResponse({ status: 201, description: 'User created' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 409, description: 'Username or email already exists' })
  create(@Body() dto: CreateUserDto) {
    return this.service.create(dto);
  }

  /**
   * Self-update: limited to displayName, phone, fullName, email.
   * Admin can update anyone and can additionally change role, isActive, permissions.
   */
  @Patch(':id')
  @Roles('admin', 'manager', 'user')
  @ApiOperation({ summary: 'Update a user (self or admin)' })
  @ApiResponse({ status: 200, description: 'User updated' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'User not found' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateUserDto,
    @CurrentUser() me: AuthenticatedUser,
  ) {
    if (me.role !== 'admin' && me.id !== id) {
      throw new ForbiddenException('You can only edit your own profile');
    }
    if (me.role !== 'admin') {
      // Non-admin cannot change role / isActive / permissions
      delete (dto as Partial<UpdateUserDto> & Record<string, unknown>).role;
      delete (dto as Partial<UpdateUserDto> & Record<string, unknown>).isActive;
      delete (dto as Partial<UpdateUserDto> & Record<string, unknown>).permissions;
    }
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @Roles('admin')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a user (admin only)' })
  @ApiResponse({ status: 204, description: 'User deleted' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'User not found' })
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }

  @Post(':id/change-password')
  @Roles('admin', 'manager', 'user')
  @ApiOperation({ summary: 'Change user password (self or admin)' })
  @ApiResponse({ status: 200, description: 'Password changed' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  changePassword(
    @Param('id') id: string,
    @Body() dto: ChangePasswordDto,
    @CurrentUser() me: AuthenticatedUser,
  ) {
    if (me.role !== 'admin' && me.id !== id) {
      throw new ForbiddenException('You can only change your own password');
    }
    return this.service.changePassword(id, dto);
  }
}
