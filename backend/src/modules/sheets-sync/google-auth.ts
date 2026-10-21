import { createSign } from 'crypto';

/** Поля JSON-ключа сервисного аккаунта Google, которые нам нужны. */
export interface ServiceAccountKey {
  client_email: string;
  private_key: string;
  token_uri?: string;
}

const SCOPE = 'https://www.googleapis.com/auth/spreadsheets.readonly';
const b64url = (v: string | Buffer) => Buffer.from(v).toString('base64url');

/**
 * Токен доступа Google по ключу сервисного аккаунта (OAuth 2.0 JWT bearer), без SDK:
 * подписываем JWT (RS256) приватным ключом → обмениваем на access_token (живёт час, кэшируем).
 * Права — только чтение таблиц, которыми с адресом сервисного аккаунта поделились.
 */
export class GoogleServiceAuth {
  private cached: { token: string; until: number } | null = null;

  constructor(
    private readonly key: ServiceAccountKey,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  get email(): string {
    return this.key.client_email;
  }

  async token(): Promise<string> {
    if (this.cached && Date.now() < this.cached.until) return this.cached.token;
    const tokenUri = this.key.token_uri || 'https://oauth2.googleapis.com/token';
    const now = Math.floor(Date.now() / 1000);
    const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const claims = b64url(JSON.stringify({ iss: this.key.client_email, scope: SCOPE, aud: tokenUri, iat: now, exp: now + 3600 }));
    const signature = createSign('RSA-SHA256').update(`${header}.${claims}`).sign(this.key.private_key);
    const assertion = `${header}.${claims}.${b64url(signature)}`;

    const res = await this.fetchFn(tokenUri, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }).toString(),
    });
    const body = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error_description?: string; error?: string };
    if (!res.ok || !body.access_token) {
      throw new Error(`Google не выдал доступ: ${body.error_description || body.error || res.status}`);
    }
    this.cached = { token: body.access_token, until: Date.now() + ((body.expires_in ?? 3600) - 300) * 1000 };
    return body.access_token;
  }
}
