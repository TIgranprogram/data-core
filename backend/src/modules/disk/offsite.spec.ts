import { createDecipheriv, scryptSync } from 'crypto';
import { Readable } from 'stream';
import { encryptStream, MAGIC, openSecret, sealSecret } from './offsite';

describe('БКП: шифрование', () => {
  it('секрет цели: зашифровать и открыть', () => {
    const s = sealSecret('пароль-приложения');
    expect(s).not.toContain('пароль');
    expect(openSecret(s)).toBe('пароль-приложения');
  });

  it('копия: DCB1 + соль + iv + данные + тег — расшифровывается паролем', async () => {
    const data = Buffer.from('mongo dump '.repeat(5000));
    const chunks: Buffer[] = [];
    await new Promise<void>((ok, bad) => Readable.from([data.subarray(0, 7000), data.subarray(7000)]).pipe(encryptStream('очень-длинный-пароль'))
      .on('data', (c: Buffer) => chunks.push(c)).on('end', ok).on('error', bad));
    const all = Buffer.concat(chunks);
    expect(all.subarray(0, 4)).toEqual(MAGIC);
    const salt = all.subarray(4, 20), iv = all.subarray(20, 32), tag = all.subarray(all.length - 16), body = all.subarray(32, all.length - 16);
    const d = createDecipheriv('aes-256-gcm', scryptSync('очень-длинный-пароль', salt, 32), iv); d.setAuthTag(tag);
    expect(Buffer.concat([d.update(body), d.final()])).toEqual(data);
  });
});
