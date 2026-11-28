import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection, Types } from 'mongoose';

@Injectable()
export class PassportInstallSeed implements OnApplicationBootstrap {
  constructor(@InjectConnection() private readonly connection: Connection) {}

  async onApplicationBootstrap(): Promise<void> {
    const values = this.connection.collection('dict_values');
    const key = { dict: 'passportInstall', code: 'BOLTED' };
    // Сохраняем пользовательскую запись с любым ID, включая отключённую или удалённую.
    if (await values.findOne(key, { projection: { _id: 1 } })) return;
    const now = new Date();
    // Общий ID исключает дубли при одновременном запуске нескольких экземпляров.
    await values.updateOne({ _id: new Types.ObjectId('6b09365a4db017142fd238a4'), ...key }, {
      $setOnInsert: {
        name: 'Болтовое соединение', requiredImages: 'mounting', traits: 'bolts',
        montage: 'Выполнить болтовое соединение по схеме монтажа изделия.',
        categories: '', createdAt: now, updatedAt: now, deletedAt: null,
      },
    }, { upsert: true });
  }
}
