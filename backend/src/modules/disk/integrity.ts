import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Types, type Connection } from 'mongoose';

/**
 * А1 (2026-10-26): проверка целостности данных склада — ТОЛЬКО ЧТЕНИЕ, ничего не исправляет.
 * Находит: отрицательные остатки, активные брони с нулём или на удалённую позицию / заказ, остатки без позиции.
 * Исправление — только по плану и «да» пользователя (data-steward). Результат держим в памяти 6 ч.
 */
export interface IntegrityIssue { key: string; title: string; count: number; sample: string[] }

const TTL = 6 * 3600 * 1000;

@Injectable()
export class IntegrityService {
  private last: { checkedAt: Date; issues: IntegrityIssue[] } | null = null;
  constructor(@InjectConnection() private readonly connection: Connection) {}

  async report(force = false) {
    if (!force && this.last && Date.now() - this.last.checkedAt.getTime() < TTL) return this.last;
    this.last = { checkedAt: new Date(), issues: await this.check() };
    return this.last;
  }

  private async check(): Promise<IntegrityIssue[]> {
    const db = this.connection.db!;
    const alive = { deletedAt: null };
    const ids = (docs: { _id: unknown }[]) => docs.slice(0, 5).map((d) => String(d._id));
    const [negative, emptyRes, resList, items] = await Promise.all([
      db.collection('storageitems').find({ ...alive, quantity: { $lt: 0 } }, { projection: { _id: 1 } }).limit(500).toArray(),
      db.collection('reservations').find({ ...alive, status: 'active', qty: { $lte: 0 } }, { projection: { _id: 1 } }).limit(500).toArray(),
      db.collection('reservations').find({ ...alive, status: 'active' }, { projection: { materialId: 1, salesOrderId: 1 } }).limit(5000).toArray(),
      db.collection('storageitems').find({ ...alive, materialId: { $ne: null } }, { projection: { materialId: 1 } }).limit(20000).toArray(),
    ]);
    const matIds = [...new Set([...resList, ...items].map((d) => d.materialId).filter(Boolean).map(String))];
    const soIds = [...new Set(resList.map((d) => d.salesOrderId).filter(Boolean).map(String))];
    const liveSet = async (coll: string, list: string[]) => new Set((await db.collection(coll)
      .find({ _id: { $in: list.map((s) => new Types.ObjectId(s)) }, ...alive }, { projection: { _id: 1 } }).toArray()).map((d) => String(d._id)));
    const [mats, sos] = await Promise.all([liveSet('materials', matIds), liveSet('salesorders', soIds)]);
    const resNoMat = resList.filter((d) => d.materialId && !mats.has(String(d.materialId)));
    const resNoSo = resList.filter((d) => d.salesOrderId && !sos.has(String(d.salesOrderId)));
    const itemNoMat = items.filter((d) => !mats.has(String(d.materialId)));
    return [
      { key: 'negative-stock', title: 'Остаток меньше нуля', count: negative.length, sample: ids(negative) },
      { key: 'empty-reservation', title: 'Активная бронь на 0', count: emptyRes.length, sample: ids(emptyRes) },
      { key: 'reservation-no-material', title: 'Бронь на удалённую позицию склада', count: resNoMat.length, sample: ids(resNoMat) },
      { key: 'reservation-no-order', title: 'Бронь под удалённый заказ', count: resNoSo.length, sample: ids(resNoSo) },
      { key: 'stock-no-material', title: 'Остаток без позиции склада', count: itemNoMat.length, sample: ids(itemNoMat) },
    ].filter((x) => x.count > 0);
  }
}
