import * as dns from 'dns';
import * as net from 'net';
import type { FetchFn } from './adapters/base.adapter';

const MAX_REDIRECTS = 3;

/** DNS-резолв; подменяется в тестах. */
export const dnsApi = {
  lookup: (host: string) => dns.promises.lookup(host, { all: true }),
};

/** Хост разрешён: точное совпадение или поддомен хоста из белого списка (не подстрока!). */
export function hostAllowed(host: string, hosts: string[]): boolean {
  const h = host.toLowerCase().replace(/\.$/, '');
  return hosts.some((a) => h === a || h.endsWith(`.${a}`));
}

/** Приватный/служебный IP (v4 и v6, включая ::ffff:-маппинг). */
export function isPrivateIp(raw: string): boolean {
  const ip = raw.replace(/^\[|\]$/g, '').toLowerCase();
  const kind = net.isIP(ip);
  if (kind === 4) {
    const [a, b] = ip.split('.').map(Number);
    return (
      a === 0 || a === 10 || a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127)
    );
  }
  if (kind === 6) {
    if (ip === '::1' || ip === '::') return true;
    const mapped = ip.match(/^(?:0:0:0:0:0:ffff:|::ffff:)(.+)$/);
    if (mapped) {
      const rest = mapped[1];
      if (net.isIP(rest) === 4) return isPrivateIp(rest);
      const hex = rest.split(':');
      if (hex.length === 2) {
        const hi = parseInt(hex[0], 16);
        const lo = parseInt(hex[1], 16);
        return isPrivateIp(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
      }
      return true;
    }
    const first = parseInt(ip.split(':')[0] || '0', 16);
    return (first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80;
  }
  return false;
}

/** Хост резолвится только в публичные адреса (любой приватный — отказ). */
export async function assertPublicHost(hostname: string): Promise<void> {
  const host = hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host)) {
    if (isPrivateIp(host)) throw new Error(`Адрес запрещён: ${host}`);
    return;
  }
  const addrs = await dnsApi.lookup(host);
  if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) {
    throw new Error(`Хост ${host} ведёт на запрещённый адрес`);
  }
}

/**
 * fetch с защитой от SSRF: белый список хостов, DNS-проверка, редиректы только вручную
 * (≤3, каждый Location проверяется заново).
 */
export function createSafeFetch(base: FetchFn, hosts: string[]): FetchFn {
  return async (input, init) => {
    let url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const parsed = new URL(url);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('Протокол запрещён');
      if (!hostAllowed(parsed.hostname, hosts)) throw new Error(`Хост не в белом списке: ${parsed.hostname}`);
      await assertPublicHost(parsed.hostname);
      const res = await base(url, { ...init, redirect: 'manual' });
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get('location');
        if (!loc) return res;
        url = new URL(loc, url).toString();
        continue;
      }
      return res;
    }
    throw new Error('Слишком много редиректов');
  };
}
