export const DESK_CARD_TYPES = [
  'salesorders', 'salesorder', 'orders', 'design', 'work', 'products', 'modules', 'parts',
  'requests', 'stock', 'offers', 'passarchive', 'passports', 'contract', 'suppliercatalog',
  'partners', 'personal',
] as const;
export const DESK_LANES = ['focus', 'next', 'waiting'] as const;

type DeskCardType = (typeof DESK_CARD_TYPES)[number];
export type DeskRef = { of: Exclude<DeskCardType, 'personal'>; id: string };
export interface DeskLane { key: string; title: string }

export interface DeskTask {
  id: string;
  title: string;
  due?: string;
  done: boolean;
}

interface DeskCardBase {
  id: string;
  lane: string;
  done?: boolean;
  tasks?: DeskTask[];
}

export type DeskCard = DeskCardBase & (
  { of: DeskRef['of'] } | ({ of: 'personal'; refs?: DeskRef[]; deletedAt?: string } & DeskTask)
);

export interface DeskLayout {
  version: number;
  lanes?: DeskLane[];
  items: DeskCard[];
}
