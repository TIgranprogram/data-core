import { ExecutionContext } from '@nestjs/common';
import {
  AuthenticatedUser,
  getAuthenticatedUser,
} from './current-user.decorator';

describe('getAuthenticatedUser', () => {
  it('returns the authenticated user with organizationId from the request', () => {
    const mockUser: AuthenticatedUser = {
      id: 'user-123',
      username: 'testuser',
      role: 'manager',
      permissions: ['user:read'],
      organizationId: 'org-456',
    };

    const result = getAuthenticatedUser({
      switchToHttp: () => ({
        getRequest: () => ({ user: mockUser }),
      }),
    } as unknown as ExecutionContext);

    expect(result).toEqual(mockUser);
    expect(result.organizationId).toBe('org-456');
  });

  it('returns null organizationId for a system administrator', () => {
    const mockUser: AuthenticatedUser = {
      id: 'admin-123',
      username: 'admin',
      role: 'admin',
      permissions: ['*'],
      organizationId: null,
    };

    const result = getAuthenticatedUser({
      switchToHttp: () => ({
        getRequest: () => ({ user: mockUser }),
      }),
    } as unknown as ExecutionContext);

    expect(result.organizationId).toBeNull();
  });
});
