import { createHash } from 'crypto';
import type { PdmItemDto, PdmTreeDto } from './dto/pdm-tree.dto';

/** Мини-дерево для тестов (по 6104 из ANALYSIS.md): изделие, модуль с тремя листовыми деталями, каталожная фанерная деталь, метиз, покупное. */

export const DXF_BUFFER = Buffer.from('  0\r\nSECTION\r\n  2\r\nHEADER\r\n  0\r\nENDSEC\r\n  0\r\nEOF\r\n');
export const DXF_SHA = createHash('sha256').update(DXF_BUFFER).digest('hex');

const sheet = (designation: string): Partial<PdmItemDto> => ({
  kind: 'part', pdmKind: 'Деталь', config: '00 Стандартная',
  file: { id: 3542, path: `C:\\PDM\\2 Детали\\${designation}.SLDPRT`, version: 3, state: 'Утверждено' },
  vars: { 'Сортамент': 'Лист, 4 мм, ГОСТ 19903-2015', 'Материал': 'Ст 3 ГОСТ 380-2005' },
  size: { length: 109, width: 80, thickness: 79 }, blank: { length: 253.1, width: 80, thickness: 4, source: 'dxf' }, massKg: 0.27, ral: ['8017'],
});

export function miniTree(root = '6104.0000.0000'): PdmTreeDto {
  const part = (designation: string, extra: Partial<PdmItemDto> = {}): PdmItemDto => ({ designation, ...sheet(designation), ...extra }) as PdmItemDto;
  return {
    schema: 'pdm-tree/1', vault: 'PDM', root,
    items: [
      { designation: root, kind: 'product', pdmKind: 'Изделие', file: { id: 100, version: 6, state: 'В разработке' }, folder: '61 Детские игровые комплексы' },
      { designation: '0000.1005.0000', kind: 'module', pdmKind: 'Сборка', file: { id: 200, version: 2, state: 'Утверждено' } },
      part('0000.1005.0001', { docs: [{ type: 'dxf', name: '0000.1005.0001.DXF', version: 2, sha256: DXF_SHA, size: DXF_BUFFER.length, state: 'Утверждено' }] }),
      part('0000.1005.0002'),
      part('0000.1005.0003'),
      {
        designation: '0000.0000.2002', kind: 'part', pdmKind: 'Деталь', file: { id: 300, version: 1, state: 'Утверждено' },
        vars: { 'Сортамент': 'Фанера, 21 мм', 'Материал': 'ФСФ' }, size: { length: 600, width: 400, thickness: 21 }, blank: { length: 600, width: 400, thickness: 21, source: 'pdm' }, massKg: 3.5,
      },
      { designation: 'SHP08.D125', kind: 'fastener', pdmKind: 'Метиз', aliases: ['ШП08.D125'], vars: { 'Сортамент': 'Шайба плоская, M8, DIN 125' } },
      { designation: 'PI.0003', kind: 'purchased', pdmKind: 'Покупное', vars: { 'Сортамент': 'Пластина резиновая' } },
    ],
    bom: [
      { parent: root, child: '0000.1005.0000', qty: 1 },
      { parent: root, child: '0000.0000.2002', qty: 2 },
      { parent: root, child: 'SHP08.D125', qty: 8 },
      { parent: root, child: 'PI.0003', qty: 1 },
      { parent: '0000.1005.0000', child: '0000.1005.0001', qty: 1 },
      { parent: '0000.1005.0000', child: '0000.1005.0002', qty: 1 },
      { parent: '0000.1005.0000', child: '0000.1005.0003', qty: 1 },
    ],
  };
}
