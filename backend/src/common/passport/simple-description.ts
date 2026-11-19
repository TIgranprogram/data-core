import { joinRu, type PartRec } from '../catalog/materials-text';

export type SimpleDescription<Id = string> =
  | { mode: 'parts'; partIds: Id[] }
  | { mode?: 'manual'; text: string; partIds: Id[] };

export type SelectedPartsSource = { kind: 'parts'; partIds: string[]; text: string; invalidPartIds?: string[] };

const partLabel = (value: unknown) => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';

/** Словарные формы используются только для полного перечня живых частей. */
export function renderSelectedParts(ids: string[], parts: ReadonlyMap<string, PartRec>) {
  const selected = [...new Set(ids)].map((id) => {
    const part = parts.get(id);
    return { id, name: partLabel(part?.name), gen: partLabel(part?.genSingular) };
  });
  const invalidPartIds = selected.filter((part) => !part.name).map((part) => part.id);
  if (!selected.length || invalidPartIds.length) return { text: '', invalidPartIds };
  const useGenitive = selected.every((part) => part.gen);
  const labels = new Map<string, string>();
  for (const part of selected) {
    const label = useGenitive ? part.gen : part.name;
    const key = label.toLocaleLowerCase('ru');
    if (!labels.has(key)) labels.set(key, label);
  }
  const prefix = useGenitive ? 'Изделие состоит из' : 'Основные части изделия:';
  return { text: `${prefix} ${joinRu([...labels.values()])}.`, invalidPartIds };
}

export function selectedPartsIssue(source: SelectedPartsSource) {
  if (source.text) return null;
  if (!source.partIds.length) return {
    key: 'simpleDescription', label: 'Выберите части изделия', hint: 'Откройте «Краткое описание» и выберите части из справочника',
  };
  return {
    key: 'simpleDescription', label: 'Выбранные части изделия удалены или остались без названия',
    hint: `Замените ссылки в кратком описании: ${source.invalidPartIds?.join(', ')}`,
  };
}
