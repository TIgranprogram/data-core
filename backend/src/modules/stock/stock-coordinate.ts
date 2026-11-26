import { BadRequestException, ConflictException } from '@nestjs/common';
import type { ClientSession, Connection, Types } from 'mongoose';
import { STOCK_VISIBLE } from '../../common/catalog/stock-visible';
import { scopeMatch, type StockScope } from '../../common/stock-scope';
import { dimsOf, type Dims } from './metal';
import { sectionProfile } from './stock-dimensions';
import type { StockCoordinateDto } from './stock-coordinate.dto';

const clean = (value: unknown) => String(value ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
const unit = (value: unknown) => clean(value).replace(/^(шт|м)\.$/u, '$1');
// В старой загрузке «st 3», «asi 304», «amg2», «zn» обозначают конкретные марки.
const importedGrades = new Map([['st3', 'ст3'], ['asi304', 'aisi304'], ['asi430', 'aisi430'], ['amg2', 'амг2'], ['zn', 'оцинкованная сталь']]);
const gradeCode = /^(?:aisi\d{3}[a-z]?|ст\d+[а-я]*|амг\d+|09г2с)$/u;
const grade = (value: unknown) => {
  const label = clean(value), compact = label.replace(/\s+/g, '');
  return importedGrades.get(compact) ?? (gradeCode.test(compact) ? compact : label);
};
const knownGrade = (label: string) => gradeCode.test(label) || label === 'оцинкованная сталь';
const knownUnits = new Set(['шт', 'м', 'лист', 'кг', 'м²', 'м³']);
// Загрузчик металла записывал обычному листу сортамент «Лист 3 мм», а рифлёному — отдельное описание.
const sheetThickness = (value: unknown) => {
  const match = /^лист\s+(\d+(?:[.,]\d+)?)\s*мм$/u.exec(clean(value));
  return match ? Number(match[1].replace(',', '.')) : null;
};
const pipeProfile = (assortment: unknown, dims: Dims = {}) => sectionProfile({ metal: 'pipe', assortment: String(assortment ?? ''), dims })!;

export function coordinateGuard(dto: StockCoordinateDto): string {
  const { dims, kind } = dto;
  const axes: (keyof Dims)[] = kind === 'sheet' ? ['thickness', 'width', 'length']
    : dims?.diameter != null ? ['diameter', 'thickness', 'length'] : ['width', 'height', 'thickness', 'length'];
  if (!dto.unit.trim() || (kind === 'pipe' && !['шт', 'м'].includes(unit(dto.unit)))) throw new BadRequestException('Укажите единицу учёта материала.');
  if (!dims || Object.keys(dims).some(key => !axes.includes(key as keyof Dims)) || !axes.every(key => {
    const n = dims[key];
    return typeof n === 'number' && n > 0 && Number.isSafeInteger(Math.round(n * 100)) && Math.round(n * 100) / 100 === n;
  })) throw new BadRequestException('Укажите положительные размеры в миллиметрах с точностью до сотых.');
  if (kind === 'pipe' && pipeProfile(dto.assortment, dims).state !== 'complete') throw new BadRequestException('Проверьте сечение и толщину стенки трубы.');
  const thickness = kind === 'sheet' ? sheetThickness(dto.assortment) : null;
  if (thickness != null && thickness !== dims.thickness) throw new BadRequestException('Толщина листа не совпадает с сортаментом.');
  if (kind === 'sheet' && dto.washed != null) throw new BadRequestException('Мойку указывают только для трубы.');
  // Габариты новых записей полны. Блокировка общая и при пересечении зон, и при неизвестной марке/мойке.
  return 'coordinate:' + JSON.stringify([dto.categoryId.toLowerCase(), kind, ...axes.map(key => [key, dims[key]])]);
}

type LegacyMaterial = {
  name?: string; categoryId?: string | Types.ObjectId;
  dimensions?: unknown; washed?: unknown; materialGrade?: unknown; unit?: unknown; assortment?: unknown;
  typeName?: unknown; standardRef?: unknown; surface?: unknown; coating?: unknown; profileId?: unknown;
};
type Match = 'exact' | 'possible' | 'different';

/** Название никогда не является источником признаков. Недостающая характеристика не доказывает различие. */
export function coordinateMatch(dto: StockCoordinateDto, material: LegacyMaterial): Match {
  let partial = false;
  const wantedUnit = unit(dto.unit), foundUnit = unit(material.unit);
  const wantedGrade = grade(dto.materialGrade), foundGrade = grade(material.materialGrade);
  if (wantedUnit !== foundUnit && knownUnits.has(wantedUnit) && knownUnits.has(foundUnit)) return 'different';
  if (wantedGrade !== foundGrade && knownGrade(wantedGrade) && knownGrade(foundGrade)) return 'different';
  if (!foundUnit || !foundGrade || wantedUnit !== foundUnit || wantedGrade !== foundGrade) partial = true;
  if (dto.kind === 'pipe') {
    if (typeof dto.washed === 'boolean' && typeof material.washed === 'boolean') {
      if (dto.washed !== material.washed) return 'different';
    } else partial = true;
  }

  const raw = Array.isArray(material.dimensions) ? material.dimensions : [];
  const dims = dimsOf(raw);
  const seen = new Map<string, number>();
  for (const d of raw) {
    if (!d || !['length', 'width', 'height', 'thickness', 'diameter', 'depth'].includes(d.type) || !['number', 'string'].includes(typeof d.value)
      || !['', 'мм', 'mm'].includes(clean(d.unit)) || !Number.isFinite(Number(d.value)) || Number(d.value) <= 0
      || (seen.has(d.type) && seen.get(d.type) !== Number(d.value))) return 'possible';
    seen.set(d.type, Number(d.value));
  }
  if (dims.length && dims.length !== dto.dims.length) return 'different';
  if (dims.depth || material.standardRef || material.profileId || material.surface || material.coating) partial = true;
  if (clean(dto.typeName) !== clean(material.typeName)) partial = true;
  let comparable = dims;
  if (dto.kind === 'pipe') {
    const profile = pipeProfile(material.assortment, dims);
    if (profile.state === 'conflict') return 'possible';
    if (profile.shape !== 'unknown' && profile.shape !== (dto.dims.diameter ? 'round' : 'rect')) return 'different';
    comparable = { length: dims.length, width: profile.widthMm, height: profile.heightMm, diameter: profile.diameterMm, thickness: profile.wallMm };
  } else {
    if (dims.height || dims.diameter) partial = true;
    const thickness = sheetThickness(material.assortment);
    if (thickness != null && dims.thickness !== thickness) {
      partial = true;
      comparable = { ...dims, thickness: undefined };
    }
  }
  for (const [key, expected] of Object.entries(dto.dims)) {
    const actual = comparable[key as keyof Dims];
    if (actual == null) partial = true;
    else if (actual !== expected) return 'different';
  }
  // Размерный сортамент уже учтён в профиле. Свободный текст (ГОСТ, покрытие) не отбрасываем.
  const qualifier = (value: unknown) => {
    const sizeOnly = dto.kind === 'pipe' ? pipeProfile(value).shape !== 'unknown' : sheetThickness(value) != null;
    return sizeOnly ? '' : clean(value);
  };
  if (qualifier(dto.assortment) !== qualifier(material.assortment)) partial = true;
  return partial ? 'possible' : 'exact';
}

export async function assertCoordinateFree(connection: Connection, dto: StockCoordinateDto, categoryId: Types.ObjectId, scope: StockScope, session: ClientSession) {
  // Нативный драйвер сохраняет оба исторических типа categoryId. Mongoose приводит строковое значение к ObjectId.
  const rows = connection.db!.collection<LegacyMaterial>('materials').find({
    $and: [{ categoryId: { $in: [categoryId, String(categoryId)] }, deletedAt: null, offcutOf: null, ...STOCK_VISIBLE }, scopeMatch(scope)],
  }, { session, projection: { name: 1, dimensions: 1, unit: 1, washed: 1, materialGrade: 1, assortment: 1, typeName: 1, standardRef: 1, surface: 1, coating: 1, profileId: 1 } });
  const details: Array<{ materialId: string; name: string }> = [];
  let ambiguous = false;
  for await (const row of rows) {
    const match = coordinateMatch(dto, row);
    if (match === 'different') continue;
    details.push({ materialId: String(row._id), name: String(row.name ?? '') });
    if (match === 'possible') ambiguous = true;
  }
  if (!details.length) return;
  ambiguous ||= details.length > 1;
  throw new ConflictException({ code: ambiguous ? 'STOCK_COORDINATE_AMBIGUOUS' : 'STOCK_COORDINATE_EXISTS', details,
    message: ambiguous ? 'Есть возможные совпадения. Проверьте характеристики в карточке материала.' : 'Материал с такими характеристиками уже есть. Откройте его карточку.' });
}
