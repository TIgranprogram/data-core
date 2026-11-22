export const DESK_CARD_TYPES = [
  'salesorders', 'salesorder', 'orders', 'design', 'work', 'products', 'modules', 'parts',
  'requests', 'stock', 'offers', 'passarchive', 'passports', 'contract', 'suppliercatalog',
  'partners', 'personal',
] as const;
export const DESK_LANES = ['focus', 'next', 'waiting'] as const;

type DeskCardType = (typeof DESK_CARD_TYPES)[number];
type DeskLane = (typeof DESK_LANES)[number];

export interface DeskTask {
  id: string;
  title: string;
  due?: string;
  done: boolean;
}

interface DeskCardBase {
  id: string;
  lane: DeskLane;
  done?: boolean;
  tasks?: DeskTask[];
}

export type DeskCard = DeskCardBase & (
  { of: Exclude<DeskCardType, 'personal'> } | ({ of: 'personal' } & DeskTask)
);

export interface DeskLayout {
  version: number;
  items: DeskCard[];
}
