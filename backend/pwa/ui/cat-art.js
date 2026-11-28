import { familyOf } from '../core/facets.js';
// Первое совпадение берёт наиболее точную категорию; имена файлов заданы в коде.
const stockImages = [
  [/^без категории$|невош|^прочее$/i, 'unsorted'],
  [/стекло/i, 'glass'],
  [/прямоугольн.*труб|труб.*прямоугольн/i, 'pipe-rect'],
  [/квадратн.*труб|труб.*квадратн/i, 'pipe-square'],
  [/кругл.*труб|труб.*кругл/i, 'pipe-round'],
  [/^труб[аы]$|профильн/i, 'pipes'],
  [/лист/i, 'sheets'],
  [/метиз|креп[её]ж/i, 'fasteners'],
  [/расходн/i, 'consumables'],
  [/покупн|комплектующ|фурнитур/i, 'purchased'],
  [/^оборудование$|инструмент|станок/i, 'equipment'],
];

const productImages = [
  [/основн|^склад$/i, 'rack'],
  [/скам|мебел|благоустр/i, 'bench'],
  [/урн/i, 'bin'],
  [/велопарк/i, 'bike-rack'],
  [/стенд|указат|вывеск/i, 'sign'],
  [/навес|беседк/i, 'canopy'],
  [/огражд|забор/i, 'fence'],
  [/стол|шахмат/i, 'picnic-table'],
  [/трибун/i, 'bleachers'],
  [/вазон|клумб/i, 'planter'],
  [/горк/i, 'slide'],
  [/карусел/i, 'carousel'],
  [/пружин/i, 'spring-rider'],
  [/балансир/i, 'seesaw'],
  [/качел/i, 'swing'],
  [/песочн/i, 'sandbox'],
  [/домик/i, 'playhouse'],
  [/сет|паутин/i, 'rope-pyramid'],
  [/игров.*комплекс|детских игровых/i, 'play-complex'],
  [/игров.*оборуд/i, 'activity-panel'],
  [/детск.*спорт/i, 'climbing-frame'],
  [/полос|препятств/i, 'obstacle-course'],
  [/воркаут/i, 'workout'],
  [/тренаж/i, 'trainer'],
  [/спорт/i, 'sport-goal'],
];

function categoryImageUrl(name) {
  const label = String(name ?? '').trim();
  const stock = stockImages.find(([pattern]) => pattern.test(label));
  const product = stock ? null : productImages.find(([pattern]) => pattern.test(label));
  const file = stock ? stock[1] : product ? 'categories/' + product[1] : null;
  return file ? new URL('./catalog-art/' + file + '.webp', import.meta.url).href : null;
}

const image = url => `<img src="${url}" alt="" decoding="async" />`;
export function catArt(name) {
  return image(categoryImageUrl(name) || new URL('./catalog-art/unsorted.webp', import.meta.url).href);
}

const typeLabels = {
  bolt: 'Болт',
  boltFurn: 'Болт мебельный',
  boltAnchor: 'Анкерный болт',
  nut: 'Гайка',
  nutCap: 'Гайка колпачковая',
  nutInsert: 'Гайка со вставкой',
  nutRym: 'Рым-гайка',
  washer: 'Шайба плоская',
  washerBig: 'Шайба увеличенная',
  washerSpring: 'Шайба гроверная',
  screw: 'Саморез',
  woodScrew: 'Шуруп',
  vint: 'Винт',
  ringScrew: 'Винт-кольцо',
  stud: 'Шпилька',
  rivet: 'Заклёпка',
  rivetHex: 'Заклёпка шестигранная',
  pipeRound: 'Труба круглая',
  pipeRoundSS: 'Труба круглая нержавеющая',
  pipeProf: 'Труба профильная',
  pipeProfSS: 'Труба профильная нержавеющая',
  sheet: 'Лист',
  sheetPlate: 'Лист рифлёный',
  angle: 'Профиль, уголок',
  mesh: 'Сетка',
  drill: 'Сверло',
  bit: 'Бита',
  mill: 'Фреза',
  burr: 'Борфреза',
  collet: 'Цанга',
  disc: 'Диск, круг отрезной',
  saw: 'Диск пильный',
  flap: 'Круг лепестковый',
  blade: 'Лезвие, нож',
  hammer: 'Молоток, инструмент',
  rule: 'Рулетка',
  caliper: 'Штангенциркуль, микрометр',
  level: 'Уровень',
  scale: 'Весы',
  gloves: 'Перчатки',
  mask: 'Маска сварщика',
  suit: 'Костюм, пелерина',
  spray: 'Краска-спрей',
  marker: 'Маркер',
  glue: 'Клей',
  grease: 'Смазка',
  putty: 'Шпаклёвка',
  tapeRoll: 'Скотч, лента',
  film: 'Плёнка, рулон',
  bearing: 'Подшипник',
  rail: 'Направляющая, вал',
  spring: 'Пружина',
  wheel: 'Колесо',
  bush: 'Втулка',
  shackle: 'Скоба, такелаж',
  swivel: 'Вертлюг',
  chain: 'Цепь',
  clamp: 'Хомут',
  zap: 'Электрика',
  neon: 'Гибкий неон',
  router: 'Роутер',
  ups: 'ИБП, блок',
  battery: 'Батарейка',
  plug: 'Разъём',
  swing: 'Качели',
  seat: 'Сиденье',
  pallet: 'Поддон',
  cap: 'Заглушка',
  box: 'Прочее',
  boltNut: 'Болт с гайкой',
  screwMetal: 'Саморез по металлу',
  screwRoof: 'Саморез кровельный',
};

/** Тип → свой рисунок (первое совпадение сверху вниз; тип приходит как есть, регистр не важен). */
const TYPE_OWN = [
  [/болт.*с гайк/i, 'boltNut'], [/саморез.*кровел/i, 'screwRoof'], [/саморез.*(?:по металлу|sorrex)/i, 'screwMetal'],
  [/закл[её]пк.*(?:внутр.*резьб|резьбов)/i, 'rivetHex'],
  [/вертлюг/i, 'swivel'], [/шакле|[cс]коб|такелаж/i, 'shackle'], [/[cс]труб/i, 'clamp'],
  [/анкер/i, 'boltAnchor'], [/мебельн/i, 'boltFurn'], [/болт/i, 'bolt'],
  [/колпачк/i, 'nutCap'], [/вставк/i, 'nutInsert'], [/рым/i, 'nutRym'], [/гайк/i, 'nut'],
  [/гровер/i, 'washerSpring'], [/увеличен/i, 'washerBig'], [/шайб/i, 'washer'],
  [/саморез/i, 'screw'], [/шуруп/i, 'woodScrew'], [/винт-кольц/i, 'ringScrew'], [/винт/i, 'vint'], [/шпильк/i, 'stud'],
  [/шестигр.*закл|закл.*шестигр/i, 'rivetHex'], [/закл[её]пк/i, 'rivet'],
  [/^труб.*нерж.*проф|^труб.*проф.*нерж/i, 'pipeProfSS'], [/^труб.*нерж/i, 'pipeRoundSS'], [/^труб.*проф/i, 'pipeProf'], [/^труб/i, 'pipeRound'],
  [/рифл/i, 'sheetPlate'], [/^лист/i, 'sheet'], [/^профиль/i, 'angle'], [/сетк/i, 'mesh'],
  [/сверл/i, 'drill'], [/борфрез/i, 'burr'], [/фрез/i, 'mill'], [/^бит[аы]?(\s|$)/i, 'bit'], [/цанг/i, 'collet'],
  [/пильн/i, 'saw'], [/лепестк/i, 'flap'], [/диск|^круг/i, 'disc'], [/лезви|^нож/i, 'blade'],
  [/молот/i, 'hammer'], [/рулетк/i, 'rule'], [/микрометр|штангенц/i, 'caliper'], [/уровень/i, 'level'], [/весы/i, 'scale'],
  [/перчатк/i, 'gloves'], [/маска/i, 'mask'], [/костюм|пелерин/i, 'suit'],
  [/маркер/i, 'marker'], [/спрей|краск/i, 'spray'], [/клей/i, 'glue'], [/смазк/i, 'grease'], [/шпаклев|шпаклёв/i, 'putty'],
  [/скотч|лент/i, 'tapeRoll'], [/стрейч|рулоны|пл[её]нк|вспен|пэт/i, 'film'],
  [/подшипник/i, 'bearing'], [/^вал(\s|$)|модуль линейн/i, 'rail'], [/пружин/i, 'spring'], [/колес/i, 'wheel'], [/втулк/i, 'bush'],
  [/цеп/i, 'chain'], [/шакле|[cс]коб/i, 'shackle'], [/вертлюг/i, 'swivel'], [/х[ао]мут/i, 'clamp'],
  [/неон/i, 'neon'], [/роутер|wi-?fi/i, 'router'], [/ибп|блок/i, 'ups'], [/марганц/i, 'battery'], [/разъ[её]м/i, 'plug'],
  [/качел/i, 'swing'], [/сиден|сидень/i, 'seat'], [/поддон/i, 'pallet'], [/заглушк/i, 'cap'],
];
/** Запасной рисунок семейства (id семейства — core/facets.js TYPE_FAMILIES). */
const FAMILY_ICON = { bolt: 'bolt', nut: 'nut', washer: 'washer', screw: 'woodScrew', vint: 'vint', rivet: 'rivet', rig: 'shackle', pipe: 'pipeRound', sheet: 'sheet', cut: 'drill', tool: 'hammer', ppe: 'gloves', chem: 'spray', bearing: 'bearing', elec: 'zap', play: 'swing', other: 'box' };

/** Какой рисунок у типа: { own: ключ своего | null, family: ключ семейства, key: итоговый }. */
export function typeIconKind(type) {
  const t = String(type || '').trim();
  const own = TYPE_OWN.find(([re]) => re.test(t))?.[1] || null;
  const family = FAMILY_ICON[familyOf(t).id] || 'box';
  return { own, family, key: own || family };
}
const typeImage = key => image(new URL('./catalog-art/types/' + key + '.webp', import.meta.url).href);
export function typeArt(type) {
  return typeImage(typeIconKind(type).key);
}

export const typeIconList = () => Object.entries(typeLabels).map(([key, label]) => ({ key, label, svg: typeImage(key) }));
