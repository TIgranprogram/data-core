import type { Types } from 'mongoose';

/**
 * Снимок модуля в задании «В работе» / план-полосах.
 * Только тип данных (без правил домена) — общий для work и order-line-plan.
 */
export interface ModuleWork {
  lineId: Types.ObjectId;
  moduleId: Types.ObjectId;
  designTaskId: Types.ObjectId;
  designCode: string;
  name: string;
  article?: string;
  quantity: number;
  items?: Array<{ refId: Types.ObjectId; type: string; name: string; quantity: number; unit: string }>;
}
