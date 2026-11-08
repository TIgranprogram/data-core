import { BadRequestException, ConflictException } from '@nestjs/common';
import { Types, type mongo } from 'mongoose';
import { effectiveRoles } from '../../common/roles-hierarchy';

/**
 * C050: «Вход в приложение» сотрудника (`persons.userId`) — по нему рабочий видит свои задания.
 * Один вход — один сотрудник (уникальный частичный индекс в схеме Person); пишет только администратор и директор.
 */

/** Привязывать вход может администратор, директор и владелец. */
export function canLinkLogin(user: { role?: string | null; isOwner?: boolean } | undefined | null): boolean {
  if (!user) return false;
  if (user.isOwner === true) return true;
  const roles = effectiveRoles(user.role);
  return roles.includes('admin') || roles.includes('director');
}

/** Из тела запроса убирается `userId`, если права привязки нет (молча, как ставка у не-денежных ролей). */
export function loginBody(user: { role?: string | null; isOwner?: boolean } | undefined | null, body: Record<string, unknown>): Record<string, unknown> {
  if (body && !canLinkLogin(user)) delete body.userId;
  return body;
}

/**
 * Значение `userId` для записи в `persons`: `null` — снять связь, ObjectId — привязать.
 * Вход должен существовать (не «устройство»), занятый другим сотрудником — 409 «Этот вход уже привязан к <ФИО>».
 * `label` — как назвать сотрудника в сообщении; `selfId` — запись, которую правим (её собственный вход не конфликт).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function resolveLogin(db: mongo.Db, raw: unknown, selfId: string | undefined, label: (d: any) => string): Promise<Types.ObjectId | null> {
  if (raw === null || raw === '' || raw === undefined) return null;
  if (!Types.ObjectId.isValid(String(raw))) throw new BadRequestException('Вход не найден — выберите из списка');
  const uid = new Types.ObjectId(String(raw));
  const user = await db.collection('users').findOne({ _id: uid, accountType: { $ne: 'device' }, deletedAt: null }, { projection: { username: 1 } });
  if (!user) throw new BadRequestException('Вход не найден — выберите из списка');
  const other = await db.collection('persons').findOne(
    { userId: uid, deletedAt: null, ...(selfId && Types.ObjectId.isValid(selfId) ? { _id: { $ne: new Types.ObjectId(selfId) } } : {}) },
    { projection: { lastName: 1, firstName: 1, patronymic: 1 } },
  );
  if (other) throw new ConflictException(`Этот вход уже привязан к ${label(other)}`);
  return uid;
}
