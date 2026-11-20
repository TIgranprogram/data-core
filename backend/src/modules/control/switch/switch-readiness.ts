import { COPY_MAX_AGE_MIN, domainTransition, jobBusy, peerOf, versionsConflict, type SwitchDoc, type SwitchDomain, type SwitchSelf } from './switch.rules';

const FRESH_MS = 7 * 60_000; // мост обычно сверяет второй сервер раз в 5 минут
const CLOCK_SKEW_MS = 30_000;
export const EMPTY_DOMAIN: SwitchDomain = { owner: null, homeHealthy: null, officeHealthy: null, checkedAt: null };

export const isFresh = (iso: string | null | undefined, now: number) => {
  const age = now - Date.parse(iso ?? '');
  return age >= -CLOCK_SKEW_MS && age <= FRESH_MS;
};

export function currentDomain(domain: SwitchDomain | undefined, now: number): SwitchDomain {
  return domain && isFresh(domain.checkedAt, now) ? domain : { ...EMPTY_DOMAIN, checkedAt: domain?.checkedAt ?? null };
}

export function idleReason(doc: SwitchDoc, expectedRole: SwitchDoc['role'] = 'main'): string | undefined {
  if (jobBusy(doc.job)) return 'Переключение или обновление уже идёт. Дождитесь окончания.';
  if (doc.role !== expectedRole) return expectedRole === 'main'
    ? 'Этот сервер сейчас не главный. Запустите операцию на главном сервере.'
    : 'Этот сервер уже главный. Аварийный подъём не нужен.';
  if (expectedRole === 'main' && doc.mode !== 'normal') return 'Сервер сейчас работает в режиме «только чтение».';
}

export function refreshDomainReason(doc: SwitchDoc, self: SwitchSelf, now: number, requireDomain: boolean): string | undefined {
  if (!doc.domain && !requireDomain) return;
  const owner = currentDomain(doc.domain, now).owner;
  if (!owner) return 'Мост не подтвердил, на какой сервер направлен домен.';
  if (owner !== self) return 'Домен направлен на второй сервер. Обновление запасного остановлено.';
}

export function recoveryWarning(doc: SwitchDoc, domain: SwitchDomain, bridgeAlive: boolean): string | undefined {
  if (domainTransition(doc.job) && (!bridgeAlive || !domain.owner)) {
    return 'Исход переключения домена ещё не подтверждён. Дождитесь восстановления связи моста с VPS.';
  }
}

type PeerCheck = { healthy: boolean; self?: string | null; role?: string | null; version?: string | null; copyAt?: string | null };
export type SwitchReadiness = { state: 'ready' | 'blocked' | 'unknown'; reasons: string[] };

export function switchReadiness(
  doc: SwitchDoc, self: SwitchSelf, ownVersion: string | null,
  bridgeAlive: boolean, peerUrlSet: boolean, now: number, probe?: PeerCheck | null,
): SwitchReadiness {
  const blocked: string[] = [];
  const unknown: string[] = [];
  const domain = currentDomain(doc.domain, now);
  const idle = recoveryWarning(doc, domain, bridgeAlive) ?? idleReason(doc);
  if (idle) blocked.push(idle);
  if (!bridgeAlive) blocked.push('Служебный мост переключения на этом сервере не запущен.');
  if (!domain.owner) unknown.push('Мост не подтвердил, на какой сервер направлен домен.');
  else if (domain.owner !== self) blocked.push('Домен направлен на второй сервер.');
  if (domain.homeHealthy === false || domain.officeHealthy === false) blocked.push('С VPS не отвечает один из серверов.');
  else if (domain.homeHealthy !== true || domain.officeHealthy !== true) unknown.push('Нет свежего результата проверки обоих серверов с VPS.');

  if (!peerUrlSet) unknown.push('Не задан адрес второго сервера: его состояние не проверить.');
  if (!isFresh(doc.peerCheckedAt, now) || doc.peerHealthy == null) unknown.push('Нет свежей проверки состояния второго сервера.');
  else if (!doc.peerHealthy) blocked.push('Второй сервер не отвечает.');
  if (probe !== undefined) {
    if (!probe) unknown.push('Не удалось проверить второй сервер перед переключением.');
    else if (!probe.healthy) blocked.push('Второй сервер сейчас не отвечает.');
    else if (probe.self === self) blocked.push('По адресу второго сервера ответил этот сервер. Для переключения нужен прямой адрес второго сервера.');
    else if (!probe.self || !probe.role) unknown.push('Второй сервер не сообщил свою роль или имя.');
    else if (probe.self !== peerOf(self) || probe.role !== 'standby') blocked.push('По указанному адресу второй сервер не подтвердил роль запасного.');
  }

  const copyAt = probe === undefined ? doc.peerCopyAt : probe?.copyAt;
  const age = now - Date.parse(copyAt ?? '');
  if (!Number.isFinite(age) || age < -CLOCK_SKEW_MS) unknown.push('Неизвестно, когда второй сервер получил копию данных.');
  else if (age > COPY_MAX_AGE_MIN * 60_000) blocked.push('Копия данных на втором сервере старше суток.');
  const peerVersion = probe === undefined ? doc.peerVersion : probe?.version;
  if (!ownVersion || !peerVersion) unknown.push('Не удалось определить версии кода обоих серверов.');
  else if (versionsConflict(ownVersion, peerVersion)) blocked.push(`Версии кода на серверах разные: здесь ${ownVersion}, на запасном ${peerVersion}. Обновите код и данные запасного.`);
  return { state: blocked.length ? 'blocked' : unknown.length ? 'unknown' : 'ready', reasons: [...blocked, ...unknown] };
}
