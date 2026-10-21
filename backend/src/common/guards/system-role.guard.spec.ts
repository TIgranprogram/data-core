/**
 * SystemRoleGuard unit tests.
 *
 * Policy (PO 2026-08-09):
 *  - non-system role → PATCH/DELETE allowed (further guards decide)
 *  - system role + DELETE → SYSTEM_ROLE_FROZEN always
 *  - system role + PATCH without admin → SYSTEM_ROLE_FROZEN
 *  - system role + PATCH as admin → allowed
 *  - GET always allowed
 *  - escalate isSystem:true on custom → SYSTEM_ROLE_ESCALATION
 */
import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { ForbiddenException } from '@nestjs/common';
import { SystemRoleGuard } from './system-role.guard';
import { Role } from '../../modules/role/role.schema';

function buildModelMock(existing: Record<string, unknown> | null = null) {
  return {
    findById: jest.fn().mockReturnValue({
      lean: () => ({
        exec: jest.fn().mockResolvedValue(existing),
      }),
    }),
  };
}

describe('SystemRoleGuard', () => {
  function makeContext(
    method: string,
    params: Record<string, string>,
    body?: unknown,
    user?: { id: string; role: string; permissions?: string[] },
  ) {
    return {
      switchToHttp: () => ({
        getRequest: () => ({ method, params, body, user }),
      }),
    } as unknown as Parameters<SystemRoleGuard['canActivate']>[0];
  }

  async function boot(model: ReturnType<typeof buildModelMock>) {
    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        SystemRoleGuard,
        { provide: getModelToken(Role.name), useValue: model },
      ],
    }).compile();
    return moduleRef.get(SystemRoleGuard);
  }

  it('allows PATCH on a non-system role (isSystem: false)', async () => {
    const guard = await boot(
      buildModelMock({ isSystem: false, name: 'editor' }),
    );
    await expect(
      guard.canActivate(
        makeContext(
          'PATCH',
          { id: '64a0000000000000000000aa' },
          { displayName: 'X' },
        ),
      ),
    ).resolves.toBe(true);
  });

  it('refuses PATCH on a system role when actor is not admin', async () => {
    const guard = await boot(
      buildModelMock({ isSystem: true, name: 'manager' }),
    );
    await expect(
      guard.canActivate(
        makeContext(
          'PATCH',
          { id: '64a0000000000000000000bb' },
          { displayName: 'X' },
          { id: 'u1', role: 'manager', permissions: ['role:write'] },
        ),
      ),
    ).rejects.toThrow(ForbiddenException);
    try {
      await guard.canActivate(
        makeContext(
          'PATCH',
          { id: '64a0000000000000000000bb' },
          { displayName: 'X' },
          { id: 'u1', role: 'manager', permissions: ['role:write'] },
        ),
      );
    } catch (err) {
      expect((err as ForbiddenException).getResponse()).toMatchObject({
        code: 'SYSTEM_ROLE_FROZEN',
      });
    }
  });

  it('allows PATCH on a system role when actor is admin', async () => {
    const guard = await boot(
      buildModelMock({ isSystem: true, name: 'director' }),
    );
    await expect(
      guard.canActivate(
        makeContext(
          'PATCH',
          { id: '64a0000000000000000000bb' },
          { label: 'Директор', permissions: ['sales:read'] },
          { id: 'u-admin', role: 'admin', permissions: [] },
        ),
      ),
    ).resolves.toBe(true);
  });

  it('allows PATCH on a system role when actor has wildcard permissions', async () => {
    const guard = await boot(
      buildModelMock({ isSystem: true, name: 'manager' }),
    );
    await expect(
      guard.canActivate(
        makeContext(
          'PATCH',
          { id: '64a0000000000000000000bb' },
          { pages: ['products'] },
          { id: 'u-star', role: 'custom-admin', permissions: ['*'] },
        ),
      ),
    ).resolves.toBe(true);
  });

  it('refuses DELETE on a system role even for admin', async () => {
    const guard = await boot(buildModelMock({ isSystem: true, name: 'admin' }));
    await expect(
      guard.canActivate(
        makeContext(
          'DELETE',
          { id: '64a0000000000000000000cc' },
          {},
          { id: 'u-admin', role: 'admin', permissions: ['*'] },
        ),
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('GET (read) bypasses the guard, even on a system role', async () => {
    const guard = await boot(buildModelMock({ isSystem: true, name: 'admin' }));
    await expect(
      guard.canActivate(
        makeContext('GET', { id: '64a0000000000000000000dd' }, {}),
      ),
    ).resolves.toBe(true);
  });

  it('refuses PATCH trying to set isSystem: true on a non-system role (escalation)', async () => {
    const guard = await boot(
      buildModelMock({ isSystem: false, name: 'editor' }),
    );
    await expect(
      guard.canActivate(
        makeContext(
          'PATCH',
          { id: '64a0000000000000000000ee' },
          { isSystem: true },
          { id: 'u-admin', role: 'admin', permissions: [] },
        ),
      ),
    ).rejects.toThrow(ForbiddenException);
    try {
      await guard.canActivate(
        makeContext(
          'PATCH',
          { id: '64a0000000000000000000ee' },
          { isSystem: true },
          { id: 'u-admin', role: 'admin', permissions: [] },
        ),
      );
    } catch (err) {
      expect((err as ForbiddenException).getResponse()).toMatchObject({
        code: 'SYSTEM_ROLE_ESCALATION',
      });
    }
  });
});
