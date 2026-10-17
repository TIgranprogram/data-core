import { Test, TestingModule } from '@nestjs/testing';
import { JwtStrategy } from './jwt.strategy';
import { ConfigService } from '@nestjs/config';
import { UserService } from '../../user/user.service';
import { RoleService } from '../../role/role.service';
import { UnauthorizedException } from '@nestjs/common';

describe('JwtStrategy', () => {
  let strategy: JwtStrategy;
  let mockUserService: Partial<UserService>;
  let mockRoleService: { findByName: jest.Mock };

  beforeEach(async () => {
    mockUserService = {
      findById: jest.fn(),
    };
    mockRoleService = {
      findByName: jest.fn().mockResolvedValue(null),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JwtStrategy,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              if (key === 'jwt.secret') return 'test-secret-key-for-jwt';
              return null;
            }),
          },
        },
        {
          provide: UserService,
          useValue: mockUserService,
        },
        {
          provide: RoleService,
          useValue: mockRoleService,
        },
      ],
    }).compile();

    strategy = module.get<JwtStrategy>(JwtStrategy);
  });

  it('should validate payload and return user with organizationId', async () => {
    const payload = {
      sub: 'user-123',
      username: 'testuser',
      role: 'manager',
      version: 1,
      orgId: 'org-456',
    };

    (mockUserService.findById as jest.Mock).mockResolvedValue({
      id: 'user-123',
      username: 'testuser',
      role: 'manager',
      permissions: ['user:read'],
      isActive: true,
      organizationId: 'org-456',
    });

    mockRoleService.findByName.mockResolvedValue({
      name: 'manager',
      permissions: ['material:write'],
    });

    const result = await strategy.validate(payload);

    expect(result.id).toBe('user-123');
    expect(result.username).toBe('testuser');
    expect(result.organizationId).toBe('org-456');
    expect(result.rolePermissions).toEqual(['material:write']);
    expect(mockRoleService.findByName).toHaveBeenCalledWith('manager');
  });

  it('hydrates role permissions from the persisted user role, not stale JWT role data', async () => {
    const payload = {
      sub: 'user-123',
      username: 'stale-token-name',
      role: 'admin',
      version: 1,
    };

    (mockUserService.findById as jest.Mock).mockResolvedValue({
      id: 'user-123',
      username: 'testuser',
      role: 'manager',
      permissions: ['product:read'],
      isActive: true,
      organizationId: undefined,
    });
    mockRoleService.findByName.mockResolvedValue({
      name: 'manager',
      permissions: ['material:write'],
    });

    const result = await strategy.validate(payload);

    expect(result.role).toBe('manager');
    expect(result.rolePermissions).toEqual(['material:write']);
    expect(mockRoleService.findByName).toHaveBeenCalledWith('manager');
  });

  it('should return null organizationId for user without orgId', async () => {
    const payload = {
      sub: 'user-123',
      username: 'admin',
      role: 'admin',
      version: 1,
      orgId: undefined,
    };

    (mockUserService.findById as jest.Mock).mockResolvedValue({
      id: 'user-123',
      username: 'admin',
      role: 'admin',
      permissions: ['*'],
      isActive: true,
      organizationId: undefined,
    });

    const result = await strategy.validate(payload);

    expect(result.organizationId).toBeNull();
    expect(result.rolePermissions).toEqual([]);
  });

  it('should throw UnauthorizedException for inactive user', async () => {
    const payload = {
      sub: 'user-123',
      username: 'inactive',
      role: 'user',
      version: 1,
    };

    (mockUserService.findById as jest.Mock).mockResolvedValue({
      id: 'user-123',
      username: 'inactive',
      role: 'user',
      permissions: [],
      isActive: false,
    });

    await expect(strategy.validate(payload)).rejects.toThrow(UnauthorizedException);
  });
});
