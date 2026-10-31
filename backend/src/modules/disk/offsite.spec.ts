import { createDecipheriv, scryptSync } from 'crypto';
import { existsSync, mkdtempSync, readFileSync, statSync } from 'fs';
import { Types } from 'mongoose';
import { tmpdir } from 'os';
import { join } from 'path';
import { Readable } from 'stream';
import { encryptStream, MAGIC, OffsiteService, openSecret, sealSecret } from './offsite';

/* eslint-disable @typescript-eslint/no-explicit-any */

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

describe('БКП: сетевая папка (SMB)', () => {
  // Минимальная замена коллекции в памяти
  const makeSvc = () => {
    const docs: any[] = []; 
    const coll = {
      findOne: async (q: any) => docs.find((d) => String(d._id) === String(q._id)) ?? null,
      find: (q: any) => ({ sort: () => ({ toArray: async () => docs.filter((d) => d._id !== 'settings') }), toArray: async () => docs.filter((d) => d._id !== 'settings' && (!q.enabled || d.enabled)) }),
      insertOne: async (d: any) => { const _id = new Types.ObjectId(); docs.push({ _id, ...d }); return { insertedId: _id }; },
      updateOne: async (q: any, u: any) => { const d = docs.find((x) => String(x._id) === String(q._id)); if (d) Object.assign(d, u.$set); return { matchedCount: d ? 1 : 0 }; },
      deleteOne: async (q: any) => { const i = docs.findIndex((x) => String(x._id) === String(q._id)); if (i >= 0) docs.splice(i, 1); },
    };
    return { svc: new OffsiteService({ db: { collection: () => coll } } as any), docs };
  };
  const body = { kind: 'smb', name: 'NAS', url: '//192.168.88.2/ERPBak', username: 'bak', password: 'сек-ретный-пароль' };
  afterEach(() => { delete process.env.OFFSITE_SMB; delete process.env.OFFSITE_SMB_AUTH_DIR; });

  it('SMB есть на любом сервере (без флага); OFFSITE_SMB=0 — выключено явно', async () => {
    process.env.OFFSITE_SMB_AUTH_DIR = mkdtempSync(join(tmpdir(), 'smb-'));
    expect((await makeSvc().svc.view())).toMatchObject({ smbEnabled: true, smbAgentAt: null });
    process.env.OFFSITE_SMB = '0';
    const { svc } = makeSvc();
    await expect(svc.saveTarget(null, body)).rejects.toThrow('не включена');
    expect((await svc.view()).smbEnabled).toBeUndefined();
  });

  it('с флагом: цель сохранена, authfile 600 с паролем, наружу пароля нет, кроме hasSecret', async () => {
    process.env.OFFSITE_SMB = '1'; const dir = mkdtempSync(join(tmpdir(), 'smb-')); process.env.OFFSITE_SMB_AUTH_DIR = dir;
    const { svc, docs } = makeSvc();
    const v = await svc.saveTarget(null, body);
    expect(v.smbEnabled).toBe(true);
    const t = v.targets[0];
    expect(JSON.stringify(v)).not.toContain('сек-ретный');
    expect(t).toMatchObject({ kind: 'smb', keep: 14, folder: 'srv-erp', hasSecret: true });
    const f = join(dir, `auth.${t.id}`);
    expect(readFileSync(f, 'utf8')).toBe('username=bak\npassword=сек-ретный-пароль\ndomain=WORKGROUP\n');
    if (process.platform !== 'win32') expect(statSync(f).mode & 0o777).toBe(0o600);
    expect(docs[0].secret).not.toContain('сек-ретный');
    await svc.removeTarget(t.id);
    expect(existsSync(f)).toBe(false);
  });

  it('проверка и отправка smb ставят флаги; общий запуск smb не трогает', async () => {
    process.env.OFFSITE_SMB = '1'; process.env.OFFSITE_SMB_AUTH_DIR = mkdtempSync(join(tmpdir(), 'smb-'));
    const { svc, docs } = makeSvc();
    const id = (await svc.saveTarget(null, body)).targets[0].id;
    expect((await svc.test(id)).ok).toBe(true);
    expect(docs[0].requestTest).toBe(true);
    await svc.runAll(id);
    expect(docs[0].requestRun).toBe(true);
    await expect(svc.runAll()).rejects.toThrow(); // без пароля шифрования; smb в общий запуск не входит
    docs[0].lastAt = new Date(); docs[0].lastError = 'нет связи';
    expect((await svc.view()).targets[0].last).toMatchObject({ ok: false, message: 'нет связи' });
  });

  it('неверный адрес smb -> 400', async () => {
    process.env.OFFSITE_SMB = '1'; process.env.OFFSITE_SMB_AUTH_DIR = mkdtempSync(join(tmpdir(), 'smb-'));
    await expect(makeSvc().svc.saveTarget(null, { ...body, url: 'https://x' })).rejects.toThrow('//сервер/папка');
  });
});
