#!/usr/bin/env node
/**
 * Переделка задач «Проектирования», перенесённых из YouGile (yougile-import.js):
 *  - название — без «Чертежи … ЗНП … поз»: у задачи с позицией — из позиции заказа (title пустой), иначе наименование из строки ЗНП;
 *  - примечание — описание позиции по полям (артикул, кол-во, габариты, монтаж, цвет, особенности, примечание), потом служебное и история;
 *  - фото — без снимков строки ЗНП (полоска ~350×24), сжатые (≤ 1600 px, JPEG), лучшее (самое крупное) — первым (превью); прежние снимаются и удаляются.
 *   node scripts/yougile-rework.js <local|prod> <папка-выгрузки>                       — план
 *   node scripts/yougile-rework.js <local|prod> <папка> --apply --out откат.json [--only D-41,D-13]
 * Повтор безопасен: задача с меткой «⟳ фото сжаты» в примечании фото не трогает, остальное пересчитывается так же.
 */
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const [env, dir, ...flags] = process.argv.slice(2);
if (!['local', 'prod'].includes(env) || !dir) { console.error('usage: <local|prod> <папка> [--apply --out f.json] [--only D-1,D-2]'); process.exit(2); }
const APPLY = flags.includes('--apply');
// --site: без YouGile — фото берём с нашего сервера, меняем только название и фото (примечание не трогаем)
const SITE = flags.includes('--site');
const OUT = flags[flags.indexOf('--out') + 1];
const ONLY = flags.includes('--only') ? new Set(flags[flags.indexOf('--only') + 1].split(',')) : null;
if (APPLY && (!OUT || OUT.startsWith('--'))) { console.error('--apply требует --out откат.json'); process.exit(2); }
const BASE = env === 'prod' ? 'https://kppdf-crm.ru/db' : 'http://localhost:3001';
const MAX_PHOTOS = 20;
const DONE_MARK = '⟳ фото сжаты';

const read = (f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
const E = read('mcp-export.json');
const HIST = fs.existsSync(path.join(dir, 'history.json')) ? Object.fromEntries(read('history.json').map((x) => [x.id, x.h])) : {};
const USERS = Object.fromEntries(E.users.map((u) => [u.id, u.name]));

function creds() {
  const d = path.join(__dirname, '../../deploy/synology');
  const get = (k, f) => { try { const m = fs.readFileSync(path.join(d, f), 'utf8').match(new RegExp(`^${k}=(.*)$`, 'm')); return m ? m[1].replace(/["\r]/g, '') : ''; } catch { return ''; } };
  return { username: get('ACCESS_USER', 'access.env') || 'admin', password: get('ACCESS_PASSWORD', 'access.env') || get('ADMIN_PASSWORD', 'config.env') };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let token = '';
async function login() {
  const j = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(creds()) }).then((r) => r.json());
  token = j.access || j.tokens?.access;
  if (!token) throw new Error('вход не удался');
}
async function api(method, p, body, isForm) {
  for (let i = 0; ; i++) {
    await sleep(700); // лимит 100/мин
    const r = await fetch(BASE + p, { method, headers: { Authorization: `Bearer ${token}`, ...(body && !isForm ? { 'Content-Type': 'application/json' } : {}) }, body: body ? (isForm ? body : JSON.stringify(body)) : undefined });
    if (r.status === 429 && i < 5) { await sleep(15000); continue; }
    if (r.status === 401 && i < 2) { await sleep(13000); await login(); continue; }
    const txt = await r.text();
    let j; try { j = JSON.parse(txt); } catch { j = txt; }
    if (!r.ok) throw new Error(`${method} ${p} → ${r.status} ${typeof j === 'object' ? j.message : txt.slice(0, 200)}`);
    return j;
  }
}

const URL_RE = /https:\/\/yougile\.com\/user-data\/[^\s"<>]+/g;
/** Картинка из сообщения: размер превью из «…@354x24»; полоска строки ЗНП — низкая и широкая. */
const imgs = (t) => {
  const seen = new Map();
  for (const m of t.messages) for (const u of m.text.match(URL_RE) || []) {
    const clean = u.split('?')[0];
    if (!/\.(png|jpe?g|webp|gif|bmp)$/i.test(clean) || seen.has(clean)) continue;
    const s = u.match(/@(\d+)x(\d+)/); const w = s ? +s[1] : 0; const hgt = s ? +s[2] : 0;
    seen.set(clean, { url: clean, w, h: hgt, strip: !!s && hgt < 60 && w / Math.max(hgt, 1) > 5 });
  }
  return [...seen.values()];
};

const FIELDS = ['Позиция', 'Артикул', '', 'Наименование', 'Количество', 'Ед.', 'Габариты', 'Монтаж', 'Материал, покрытие', 'Цвет', 'Примечание'];
// Строка ЗНП была только картинкой (полоской) — переписана с картинки 2026-10-27
const ROW = (pos, art, name, n, unit, size, mount, mat = '', color = '', rem = '') => ({ 'Позиция': pos, 'Артикул': art, 'Наименование': name, 'Количество': n, 'Ед.': unit, 'Габариты': size, 'Монтаж': mount, 'Материал, покрытие': mat, 'Цвет': color, 'Примечание': rem });
const MANUAL = {
  'D-1': ROW('1', '3201', 'Скамейка на цепях', '3', 'шт', '2400х1200х2500', 'Нет', 'Нет', 'RAL 8017', 'скамейка — уголок 60×40, длина 130 см, спинка 54 см, сиденье 49 см; доска 131×9×2 см; длина цепи на сиденье 150 см, на спинку 114 см'),
  'D-49': ROW('6', '5101', 'Качели двойные со спинкой', '1', 'шт', '2820х1500х2100', '', '', '', 'подбираем аналоги из Дикома'),
  'D-75': ROW('4', '6106', 'Игровой комплекс КДс-15 «Дворики Юга»', '1', 'шт', '3400х2940х2490', 'бетонирование'),
  'D-76': ROW('1', '5102', 'Качели комбинированные', '1', 'шт', '5635х1760х2090', 'бетонирование'),
  'D-77': ROW('2', '5601', 'Песочница ПС-2', '1', 'шт', '1500х1490х305', 'бетонирование'),
  'D-78': ROW('3', '6002', 'Игровая сетка «Дворики Юга»', '1', 'шт', '4440х940х2160', 'бетонирование'),
  'D-79': ROW('5', '5303', 'Балансир «Мячик»', '2', 'шт', '2215х390х790', 'бетонирование'),
  'D-80': ROW('6', '3507', 'Урна УП-2', '2', 'шт', '310х280х710', 'анкер'),
  'D-81': ROW('7', '3410', 'Скамья парковая ПС-7', '2', 'шт', '', 'анкер'),
};
// Нет строки ЗНП — название по смыслу задачи
const TITLE = { 'D-65': 'Навес ДПС, ул. Тургенева', 'D-74': 'Изделие арт. 3217, 2400×1200×2500', 'D-64': 'Ограждение, Староминский район', 'D-55': 'Столбик угловой' };
/** Строка ЗНП из первого сообщения: «19\n3216\n\nОграждение…\n1\nшт\n?х?х1200\n…». Не похоже — null. */
function parseRow(t) {
  if (MANUAL[t.taskId]) return MANUAL[t.taskId];
  const first = t.messages[0]?.text || '';
  const L = first.split('\n').map((x) => x.replace(URL_RE, '').trim());
  if (!(/^\d+(\.\d+)?$/.test(L[0] || '') && /^\d{3,5}$/.test(L[1] || '') && L[3])) return null;
  const v = Object.fromEntries(FIELDS.map((k, i) => [k, L[i] || '']).filter(([k]) => k));
  const rest = L.slice(FIELDS.length).filter(Boolean).join(' ');
  if (rest) v['Примечание'] = [v['Примечание'], rest].filter(Boolean).join(' ');
  return v;
}
const ask = (s) => /^(\?|согласовать|согласование)$/i.test(s);

function build(t, cur) {
  const row = parseRow(t);
  const znp = (t.title.match(/ЗНП\s*([\d-]+)/i) || [])[1] || '';
  const pos = (t.title.match(/поз\.?\s*([\d.]+)/i) || [])[1] || '';
  const names = t.assignedUserIds.map((i) => USERS[i] || i);
  const hasPos = !!cur.incomeId;
  // название: с позицией — пусто (покажется позиция заказа); без — наименование из ЗНП; иначе — как в YouGile без «Чертежи»
  const title = hasPos ? '' : row?.['Наименование'] || TITLE[t.taskId] || t.title.replace(/^Чертежи\s+/i, '').trim();
  const desc = row ? [
    `Арт. ${row['Артикул']}${row['Позиция'] ? ` · поз. ${row['Позиция']}` : ''}${znp ? ` · ЗНП ${znp}` : ''}`,
    hasPos ? `Наименование в ЗНП: ${row['Наименование']}` : '',
    row['Количество'] ? `Количество: ${row['Количество']} ${row['Ед.'] || 'шт'}` : '',
    row['Габариты'] && !/^[?х×x ]+$/i.test(row['Габариты']) ? `Габариты: ${row['Габариты']} мм` : row['Габариты'] ? 'Габариты: уточнить' : '',
    row['Монтаж'] ? `Монтаж: ${/^нет$/i.test(row['Монтаж']) ? 'не нужен' : row['Монтаж'].replace(/^./, (c) => c.toUpperCase())}` : '',
    row['Материал, покрытие'] && !/^нет$/i.test(row['Материал, покрытие']) ? `Материал, покрытие: ${row['Материал, покрытие']}` : '',
    row['Цвет'] ? (ask(row['Цвет']) ? 'Цвет: согласовать с заказчиком' : `Цвет: ${row['Цвет']}`) : '',
    row['Примечание'] ? `Примечание: ${row['Примечание']}` : '',
  ] : [znp ? `ЗНП ${znp}${pos ? ` · поз. ${pos}` : ''}` : ''];
  const pid = cur.assigneeId;
  const items = t.checklists.flatMap((c) => c.items.map((i) => `${i.isCompleted ? '☑' : '☐'} ${i.title}`)).concat(t.subtasks.map((s) => `${s.complete ? '☑' : '☐'} ${s.title}`));
  // история: без первого сообщения (оно разобрано выше) и без строк из одних фото
  // записи истории: строка с датой «ГГГГ-ММ-ДД чч:мм …» + строки продолжения (многострочное сообщение)
  const entries = [];
  for (const l of (HIST[t.id] || '').replace(URL_RE, '[фото]').split('\n')) {
    if (/^\d{4}-\d\d-\d\d \d\d:\d\d /.test(l) || !entries.length) entries.push([l]); else entries[entries.length - 1].push(l);
  }
  const firstText = (t.messages[0]?.text || '').replace(URL_RE, '[фото]').split('\n')[0].trim();
  let prev = ''; let skippedFirst = !row;
  const hist = entries.map((e) => {
    const head = e[0].slice(17);
    const body = [head, ...e.slice(1)].map((x) => x.trim()).filter((x) => x && x !== '[фото]');
    return { stamp: e[0].slice(0, 16), head, text: body.join(' · ') };
  }).filter((e) => {
    if (!skippedFirst && firstText && !firstText.startsWith('[фото]') && /^[^:]+: /.test(e.head) && e.head.split(': ')[1].trim() === firstText) { skippedFirst = true; return false; }
    if (!skippedFirst && row && new RegExp(`^[^:]+: [\\d.]+ · ${row['Артикул']}\\b`).test(e.text)) { skippedFirst = true; return false; }
    if (/^[^:]+:\s*(\[фото\]\s*)*$/.test(e.text)) return false; // только фото — они уже в задаче
    if (e.head === prev && e.head.startsWith('Срок')) return false;
    prev = e.head; return true;
  }).map((e) => `${e.stamp} ${e.text.replace(/\s*\[фото\]/g, ' (фото)')}`).join('\n');
  const service = [
    !pid && names.length ? `Исполнитель в YouGile: ${names.join(', ')}` : names.length > 1 ? `Ещё исполнители: ${names.slice(1).join(', ')}` : '',
    items.length ? `Подзадачи: ${items.join('; ')}` : '',
  ];
  const note = [...desc, ...service].filter(Boolean).join('\n') + (hist ? `\n\nИстория из YouGile:\n${hist}` : '') + `\n\nYouGile ${t.taskId} · ${DONE_MARK}`;
  const photos = imgs(t).filter((x) => !x.strip).sort((a, b) => b.w * b.h - a.w * a.h).slice(0, MAX_PHOTOS);
  return { title, note: note.slice(0, 5000), photos, row: !!row };
}

async function slim(url, auth) {
  const r = await fetch(url, auth ? { headers: { Authorization: `Bearer ${token}` } } : undefined);
  if (!r.ok) throw new Error(`скачать ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  const meta = await sharp(buf).metadata();
  // полоска — снимок строки ЗНП (белая, широкая и низкая): не фото изделия
  if (meta.height && meta.width / meta.height > 6 && meta.height < 200) return { strip: true, before: buf.length };
  const out = await sharp(buf).rotate().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }).flatten({ background: '#ffffff' }).jpeg({ quality: 82, mozjpeg: true }).toBuffer();
  return { out, before: buf.length, area: (meta.width || 0) * (meta.height || 0) };
}

(async () => {
  await login();
  const existing = (await api('GET', '/api/design-tasks?limit=500&status=queue,work,paused,done')).items;
  const byYg = new Map(existing.map((t) => [(String(t.note || '').match(/YouGile (D-\d+)(?:\n| ·|$)/) || [])[1], t]).filter(([k]) => k));
  const todo = E.tasks.filter((t) => byYg.has(t.taskId) && (!ONLY || ONLY.has(t.taskId)));
  const plan = todo.map((t) => ({ t, cur: byYg.get(t.taskId), ...build(t, byYg.get(t.taskId)) }));
  const ph = plan.filter((p) => (SITE ? (p.cur.photos || []).some((x) => !/\.jpe?g$/i.test(x.url)) : !String(p.cur.note || '').includes(DONE_MARK)));
  console.log(`${env}: задач ${plan.length}; разобрана строка ЗНП у ${plan.filter((p) => p.row).length}; название из позиции заказа у ${plan.filter((p) => !p.title).length}`);
  console.log(`фото: снять ${ph.reduce((a, p) => a + (p.cur.photoIds || []).length, 0)}, загрузить сжатыми ${SITE ? '(без полосок, после проверки размеров)' : ph.reduce((a, p) => a + p.photos.length, 0)}`);
  const ex = plan.find((p) => p.row) || plan[0];
  if (ex) console.log(`\nпример ${ex.t.taskId} → ${ex.cur.code}: «${ex.title || '(из позиции заказа)'}»\n${ex.note.slice(0, 900)}\n`);
  if (!APPLY) return;

  const log = { env, at: new Date().toISOString(), tasks: [], problems: [] };
  const save = () => fs.writeFileSync(OUT, JSON.stringify(log, null, 1));
  let saved = 0;
  for (const p of plan) {
    const rec = { yg: p.t.taskId, id: p.cur.id, code: p.cur.code, before: { title: p.cur.title ?? null, note: p.cur.note, photoIds: p.cur.photoIds || [] }, newPhotos: [] };
    try {
      const own = p.cur.photos || [];
      const redoPhotos = SITE ? own.some((x) => !/\.jpe?g$/i.test(x.url)) : !String(p.cur.note || '').includes(DONE_MARK);
      if (redoPhotos) {
        const src = SITE ? own.map((x) => ({ url: BASE + x.url, auth: true })) : p.photos;
        const ready = [];
        for (const u of src) {
          try {
            const r = await slim(u.url, u.auth);
            if (r.strip) { rec.strips = (rec.strips || 0) + 1; continue; }
            saved += r.before - r.out.length;
            ready.push({ ...r, u });
          } catch (e) { log.problems.push(`${p.t.taskId}: фото ${path.basename(u.url)} — ${e.message}`); }
        }
        ready.sort((a, b) => b.area - a.area); // самое крупное — первым (превью)
        for (const { out, u } of ready) {
          try {
            const fd = new FormData();
            fd.append('file', new Blob([out], { type: 'image/jpeg' }), path.basename(u.url).replace(/\.\w+$/, '.jpg'));
            const res = await api('POST', '/api/photos/upload', fd, true);
            const id = res.original?._id || res.original?.id || res._id || res.id;
            rec.newPhotos.push(id);
          } catch (e) { log.problems.push(`${p.t.taskId}: фото ${path.basename(u.url)} — ${e.message}`); }
        }
        // старые снять; новые прикрепить по порядку (первое — превью)
        for (const old of rec.before.photoIds) await api('DELETE', `/api/design-tasks/${p.cur.id}/photos/${old}`);
        for (const id of rec.newPhotos) await api('POST', `/api/design-tasks/${p.cur.id}/photos`, { photoId: id });
        for (const old of rec.before.photoIds) { try { await api('DELETE', `/api/photos/${old}`); } catch (e) { log.problems.push(`${p.t.taskId}: старое фото не удалено (${e.message})`); } }
      }
      await api('PATCH', `/api/design-tasks/${p.cur.id}`, SITE ? { title: p.title } : { title: p.title, note: p.note });
      log.tasks.push(rec);
      console.log(`${p.t.taskId} → ${p.cur.code} «${p.title || 'позиция заказа'}» фото ${redoPhotos ? `${rec.newPhotos.length}${rec.strips ? `, убрано полосок ${rec.strips}` : ''}` : 'без изменений'}`);
    } catch (e) { log.problems.push(`${p.t.taskId}: ${e.message}`); console.log(`${p.t.taskId} ОШИБКА ${e.message}`); }
    save();
  }
  console.log(`итог: задач ${log.tasks.length}, сэкономлено ${(saved / 1048576).toFixed(0)} МБ, проблем ${log.problems.length}`);
  log.problems.forEach((x) => console.log(' - ' + x));
})().catch((e) => { console.error(e.message); process.exit(1); });
