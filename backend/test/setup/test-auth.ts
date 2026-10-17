import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { TEST_ADMIN_PASSWORD, TEST_ADMIN_USERNAME } from './admin.fixture';

export interface AuthTokens {
  access: string;
  refresh: string;
  user: { id: string; username: string; email: string; role: string };
}

export async function loginAsAdmin(app: INestApplication): Promise<AuthTokens> {
  const username = process.env.ADMIN_USERNAME ?? TEST_ADMIN_USERNAME;
  // Must match the password set in test-db.ts createTestApp()
  const password = process.env.ADMIN_PASSWORD ?? TEST_ADMIN_PASSWORD;
  const res = await request(app.getHttpServer())
    .post('/api/auth/login')
    .send({ username, password })
    .expect((r) => {
      if (r.status !== 200 && r.status !== 201) {
        throw new Error(`Login failed: ${r.status} ${JSON.stringify(r.body)}`);
      }
    });
  // The refresh token is set as an httpOnly cookie, not in the JSON body.
  const rawCookie = res.headers['set-cookie'];
  const setCookie: string[] = Array.isArray(rawCookie) ? rawCookie : rawCookie ? [rawCookie] : [];
  const refreshCookie = setCookie.find((c) => c.startsWith('refreshToken='));
  const refresh = refreshCookie?.split('refreshToken=')[1]?.split(';')[0] ?? '';
  return {
    access: res.body.access,
    refresh,
    user: res.body.user,
  };
}

export function authHeader(token: string): { Authorization: string } {
  return { Authorization: `Bearer ${token}` };
}
