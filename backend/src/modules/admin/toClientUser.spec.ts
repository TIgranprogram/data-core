import { toClientUser, toClientRole } from './dto/mapper';

/**
 * TZ-257 §ШАГ 5 — DTO mapper unit specs.
 *
 * Crucial: `toClientUser` MUST NOT include `passwordHash` or any
 * other sensitive field on the response. This spec is the acceptance
 * sentinel.
 */
describe('toClientUser (TZ-257 DTO mapper)', () => {
  it('returns an object WITHOUT passwordHash', () => {
    const doc = {
      _id: '507f1f77bcf86cd799439011',
      username: 'alice',
      email: 'a@x',
      displayName: 'Alice',
      role: 'admin',
      isActive: true,
      permissions: ['user:read', 'user:write', 'user:admin', '*'],
      passwordHash: '$2b$10$SEKR3T_H4SH_DOLLAR_SIGN_NEVER_LEAK',
      refreshTokenVersion: 7,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-02T00:00:00Z'),
    };
    const out = toClientUser(doc);
    expect(out).not.toHaveProperty('passwordHash');
    expect(out).not.toHaveProperty('refreshTokenVersion');
    // All explicitly-listed safe fields ARE present.
    expect(out).toHaveProperty('id');
    expect(out).toHaveProperty('username');
    expect(out).toHaveProperty('email');
    expect(out).toHaveProperty('displayName');
    expect(out).toHaveProperty('role');
    expect(out).toHaveProperty('isActive');
    expect(out).toHaveProperty('permissions');
    expect(out).toHaveProperty('createdAt');
    expect(out).toHaveProperty('updatedAt');
  });

  it('safely coerces nested-typed fields', () => {
    const doc = {
      _id: '507f1f77bcf86cd799439011',
      username: 'alice',
      email: 'a@x',
      displayName: 'Alice',
      role: undefined,        // default to 'user'
      isActive: undefined,    // default to true
      permissions: 'not-an-array',
      passwordHash: 'should-not-leak',
    };
    const out = toClientUser(doc);
    expect(out.role).toBe('user');           // safe default
    expect(out.isActive).toBe(true);          // safe default
    expect(out.permissions).toEqual([]);      // safe default
  });

  it('returns ISO-formatted createdAt / updatedAt when timestamps present', () => {
    const doc = {
      _id: '507f1f77bcf86cd799439011',
      username: 'x',
      email: 'x',
      displayName: 'X',
      role: 'user',
      isActive: true,
      permissions: [],
      createdAt: new Date('2026-01-15T10:30:00Z'),
      updatedAt: new Date('2026-02-20T12:45:00Z'),
    };
    const out = toClientUser(doc);
    expect(out.createdAt).toBe('2026-01-15T10:30:00.000Z');
    expect(out.updatedAt).toBe('2026-02-20T12:45:00.000Z');
  });
});

describe('toClientRole (TZ-257 DTO mapper)', () => {
  it('returns an object with isSystem flag visible', () => {
    const doc = {
      _id: '5f00000000000000000000aa',
      name: 'admin',
      description: 'System administrator role',
      permissions: ['*'],
      pages: ['products', 'admin-roles'],
      isSystem: true,
    };
    const out = toClientRole(doc);
    expect(out.isSystem).toBe(true);
    expect(out.permissions).toEqual(['*']);
    expect(out.pages).toEqual(['products', 'admin-roles']);
  });

  it('defaults isSystem to false when missing', () => {
    const doc = {
      _id: '5f00000000000000000000aa',
      name: 'custom-role',
      permissions: ['material:read'],
    };
    const out = toClientRole(doc);
    expect(out.isSystem).toBe(false);
    expect(out.pages).toEqual([]);
  });
});
