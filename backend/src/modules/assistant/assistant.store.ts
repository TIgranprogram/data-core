import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';
import { CHAT_KEEP_DAYS } from './assistant.config';

export interface ChatMessage {
  userId: string;
  role: 'user' | 'assistant';
  text: string;
  model?: string;
  tools?: string[];
  tokens?: { input: number; output: number; cacheRead: number; cacheWrite: number };
  usd?: number;
  createdAt: Date;
}

/** Хранилище помощника: `assistantchats` (переписка, живёт 90 дней) и `assistantusage` ($ за день по человеку). Свои коллекции, CRM их не читает. */
@Injectable()
export class AssistantStore implements OnModuleInit {
  constructor(@InjectConnection() private readonly connection: Connection) {}
  private get db() { return this.connection.db!; }

  async onModuleInit() {
    try {
      await this.db.collection('assistantchats').createIndex({ createdAt: 1 }, { expireAfterSeconds: CHAT_KEEP_DAYS * 86400 });
      await this.db.collection('assistantchats').createIndex({ userId: 1, createdAt: -1 });
      await this.db.collection('assistantusage').createIndex({ day: 1, userId: 1 }, { unique: true });
    } catch { /* индексы не критичны для старта */ }
  }

  /** Последние сообщения человека, от старых к новым. */
  async history(userId: string, limit: number): Promise<ChatMessage[]> {
    const rows = await this.db.collection('assistantchats').find({ userId }).sort({ createdAt: -1 }).limit(limit).toArray();
    return rows.reverse() as unknown as ChatMessage[];
  }

  async saveTurn(msgs: ChatMessage[]) {
    if (msgs.length) await this.db.collection('assistantchats').insertMany(msgs as never[]);
  }

  /** Потрачено за день ($): человеком и всеми. */
  async spent(day: string, userId: string): Promise<{ user: number; all: number }> {
    const rows = await this.db.collection('assistantusage').find({ day }).toArray();
    let all = 0, user = 0;
    for (const r of rows) { all += Number(r.usd) || 0; if (r.userId === userId) user += Number(r.usd) || 0; }
    return { user, all };
  }

  async addUsage(day: string, userId: string, usd: number, tokens: { input: number; output: number }) {
    await this.db.collection('assistantusage').updateOne(
      { day, userId },
      { $inc: { usd, requests: 1, inputTokens: tokens.input, outputTokens: tokens.output }, $set: { updatedAt: new Date() } },
      { upsert: true },
    );
  }
}
