/**
 * =========================================================================
 * DATA CORE — синхронизация Google-таблицы с единой базой (Таблица → База)
 * =========================================================================
 * Куда: Расширения → Apps Script → новый файл «datacore-sync» → вставить целиком.
 * Первый запуск: выбрать функцию datacoreSetup → ▶ Выполнить → разрешить доступ → ввести ключ.
 *
 * Как устроено (без дублей и потерь):
 *  - В каждом синхронизируемом листе появляется скрытая колонка «ID базы» с уникальным id строки.
 *    По нему база узнаёт строку, даже если строки отсортировали/переставили/переименовали.
 *  - Создание идемпотентно: перед созданием скрипт спрашивает базу, нет ли уже записей с этими id.
 *  - Отправляются только изменённые строки (контрольная сумма syncHash).
 *  - Строка удалена из таблицы → запись мягко удаляется в базе (восстанавливается из корзины/бэкапа).
 *    Защита: если «пропало» больше 20% записей (лист очистили по ошибке) — удаления не делаются.
 *  - Запуск: автоматически каждые 10 минут + меню «🔗 База данных → Синхронизировать сейчас».
 *  - Свой onOpen НЕ объявляется (не ломает ваши меню): меню ставится установленным триггером.
 * Данные в базе: /api/apps/<app>/<collection> (например supply/requests, warehouse/items).
 * Документация: github TIgranprogram/data-core → deploy/google-sheets/README.md
 */

const DC = {
  BASE_URL_DEFAULT: 'https://kppdf-crm.ru/db/api',
  ID_HEADER: 'ID базы',
  DELETE_GUARD_RATIO: 0.2,   // не удалять, если «пропало» больше 20% записей
  MAX_WRITES_PER_RUN: 250,   // остальное — в следующий запуск (лимит API ~100 запросов/мин)
  SHEETS: [
    // sheet — имя листа; headerRow — строка заголовков; keyHeader — без него строка не синхронизируется
    {
      sheet: 'Снабжение', headerRow: 1, app: 'supply', collection: 'requests', keyHeader: 'Наименование',
      fields: {
        '№': 'num', 'Дата': 'date', 'Категория': 'category', 'Наименование': 'name', 'Ед_изм.': 'unit',
        'Кол-во': 'qty', 'Подал заявку': 'requestedBy', 'Артикул': 'article', 'Цвет': 'color',
        'Поставщик': 'supplier', 'Ссылка': 'link', 'Заказчик': 'customer', 'Примечание': 'note',
        'Статус': 'status', 'Приоритет': 'priority', 'Наша Компания': 'ourCompany', 'Доставка': 'delivery',
        'Тип счета': 'invoiceType', '№ Счета': 'invoiceNo', 'Дата счета': 'invoiceDate', 'Цена с НДС': 'priceWithVat',
      },
      skip: ['Фото'],
    },
    {
      sheet: 'Реестр счетов', headerRow: 1, app: 'supply', collection: 'invoices', keyHeader: 'Наименование',
      fields: { '№': 'num', 'Поставщик': 'supplier', 'Категория': 'category', 'Артикул': 'article', 'Наименование': 'name',
        'Ед_изм.': 'unit', 'Кол-во': 'qty', 'Цена с НДС': 'priceWithVat', 'Тип счета': 'invoiceType', '№ Счета': 'invoiceNo', 'Дата счета': 'invoiceDate' },
      skip: ['Фото'],
    },
    {
      sheet: 'Склад', headerRow: 6, app: 'warehouse', collection: 'items', keyHeader: 'Наименование ТМЦ',
      fields: {
        'Категория': 'category', 'Наименование ТМЦ': 'name', 'Ед. изм.': 'unit', 'Начальный остаток': 'openingQty',
        'Поступило': 'receivedQty', 'Забронировано': 'reservedQty', 'Списано': 'writtenOffQty', 'Текущий остаток': 'currentQty',
        'Свободный остаток': 'freeQty', 'Статус наличия': 'stockStatus', 'Мин. остаток': 'minQty', 'Вес 1 шт.': 'weightKg',
      },
      skip: ['Фото'],
    },
    {
      // Колонки не описаны — ключи полей создаются автоматически из заголовков (транслит)
      sheet: 'Движение склада', headerRow: 1, app: 'warehouse', collection: 'movements', keyHeader: 'Наименование',
      fields: {}, skip: ['Фото'],
    },
  ],
};

/**
 * Режим «База → Таблица» (после перехода на приложение «Снабжение / Склад»).
 * Главное место ввода — приложение; таблица получает зеркало в отдельные листы «… (база)»
 * (старые листы с формулами не трогаются, остаются архивом). Лист-зеркало перезаписывается целиком.
 * Зеркало строится в той таблице, где есть исходный лист (source).
 */
const DC_PULL = [
  {
    source: 'Снабжение', sheet: 'Снабжение (база)', path: '/apps/supply/requests',
    sort: (a, b) => String(b.date || '').localeCompare(String(a.date || '')) || (Number(b.num) || 0) - (Number(a.num) || 0),
    columns: [['№', 'num'], ['Дата', 'date'], ['Фото', '@photo'], ['Категория', 'category'], ['Наименование', 'name'], ['Ед. изм.', 'unit'],
      ['Кол-во', 'qty'], ['Подал заявку', 'requestedBy'], ['Артикул', 'article'], ['Цвет', 'color'], ['Поставщик', 'supplier'],
      ['Ссылка', 'link'], ['Заказчик', 'customer'], ['Примечание', 'note'], ['Статус', 'status'], ['Приоритет', 'priority'],
      ['Наша компания', 'ourCompany'], ['Доставка', 'delivery'], ['№ счёта', 'invoiceNo'], ['Дата счёта', 'invoiceDate'],
      ['Цена с НДС', 'priceWithVat'], ['Оприходовано', 'receivedAt']],
  },
  {
    source: 'Склад', sheet: 'Склад (база)', path: '/apps/warehouse/items', stock: true,
    sort: (a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'ru'),
    columns: [['Фото', '@photo'], ['Категория', 'category'], ['Наименование ТМЦ', 'name'], ['Ед. изм.', 'unit'], ['Артикул', 'article'],
      ['Остаток', '@onHand'], ['В брони', '@reserved'], ['Свободно', '@free'], ['Мин. остаток', 'minQty'], ['Статус', '@status'],
      ['Место хранения', 'location'], ['Вес 1 шт.', 'weightKg']],
  },
  {
    source: 'Склад', sheet: 'Движение склада (база)', path: '/apps/warehouse/movements',
    sort: (a, b) => String(b.date || '').localeCompare(String(a.date || '')) || String(b.createdAt || '').localeCompare(String(a.createdAt || '')),
    columns: [['Дата', 'date'], ['Тип', '@moveType'], ['Наименование', 'itemName'], ['Кол-во', 'qty'], ['Основание / заказ', 'ref'],
      ['Примечание', 'note'], ['Кто', 'byName']],
  },
];
const DC_MOVE_LABEL = { in: 'Приход', reserve: 'Бронь', unreserve: 'Снять бронь', out: 'Списание', adjust: 'Корректировка', opening: 'Начальный остаток' };

// ------------------------------- Установка -------------------------------

function datacoreSetup() {
  const ui = SpreadsheetApp.getUi();
  const props = PropertiesService.getScriptProperties();
  const r = ui.prompt('Data Core — ключ', 'Вставьте ключ kppd_… (админка → API-ключи, права «Чтение и запись», приложения: supply, warehouse):', ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  const key = r.getResponseText().trim();
  if (!/^kppd_/.test(key)) { ui.alert('Это не похоже на ключ kppd_…'); return; }
  props.setProperty('DATACORE_KEY', key);
  if (!props.getProperty('DATACORE_BASE')) props.setProperty('DATACORE_BASE', DC.BASE_URL_DEFAULT);

  // Триггеры: пересоздаём только свои
  ScriptApp.getProjectTriggers()
    .filter((t) => ['datacoreSyncAuto', 'datacoreMenu'].includes(t.getHandlerFunction()))
    .forEach((t) => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('datacoreSyncAuto').timeBased().everyMinutes(10).create();
  ScriptApp.newTrigger('datacoreMenu').forSpreadsheet(SpreadsheetApp.getActive()).onOpen().create();
  datacoreMenu();

  const check = dcApi_('get', '/health/ready');
  ui.alert('Готово', 'Ключ сохранён, синхронизация — каждые 10 минут.\nСервер: ' + (check ? 'на связи ✅' : '?') +
    '\n\nСейчас выполню первую синхронизацию.', ui.ButtonSet.OK);
  datacoreSyncNow();
}

function datacoreMenu() {
  SpreadsheetApp.getUi().createMenu('🔗 База данных')
    .addItem('🔄 Синхронизировать сейчас', 'datacoreSyncNow')
    .addItem('ℹ️ Последняя синхронизация', 'datacoreStatus')
    .addSeparator()
    .addItem('⬆️ Режим: таблица → база (до перехода)', 'datacoreModePush')
    .addItem('⬇️ Режим: база → таблица (после перехода)', 'datacoreModePull')
    .addSeparator()
    .addItem('🔑 Сменить ключ / переустановить', 'datacoreSetup')
    .addToUi();
}

function datacoreStatus() {
  const props = PropertiesService.getScriptProperties();
  const s = props.getProperty('DATACORE_LAST') || 'ещё не запускалась';
  const mode = dcMode_() === 'pull' ? 'база → таблица (зеркало)' : 'таблица → база';
  SpreadsheetApp.getUi().alert('Последняя синхронизация', 'Режим: ' + mode + '\n\n' + s, SpreadsheetApp.getUi().ButtonSet.OK);
}

function dcMode_() { return PropertiesService.getScriptProperties().getProperty('DATACORE_MODE') || 'push'; }

function datacoreModePush() {
  const ui = SpreadsheetApp.getUi();
  if (ui.alert('Режим «таблица → база»', 'Таблица снова станет главным местом ввода и будет отправлять строки в базу. Используйте только ДО перехода на приложение. Включить?', ui.ButtonSet.YES_NO) !== ui.Button.YES) return;
  PropertiesService.getScriptProperties().setProperty('DATACORE_MODE', 'push');
  ui.alert('Режим «таблица → база» включён.');
}

function datacoreModePull() {
  const ui = SpreadsheetApp.getUi();
  if (ui.alert('Режим «база → таблица»', 'После перехода главное место ввода — приложение «Снабжение / Склад». Таблица перестанет отправлять данные в базу и будет получать зеркало в листы «… (база)». Старые листы не меняются. Включить?', ui.ButtonSet.YES_NO) !== ui.Button.YES) return;
  PropertiesService.getScriptProperties().setProperty('DATACORE_MODE', 'pull');
  datacoreSyncNow();
}

// ------------------------------- Запуск -------------------------------

function datacoreSyncAuto() { dcRun_(false); }
function datacoreSyncNow() { dcRun_(true); }

function dcRun_(interactive) {
  const lock = LockService.getDocumentLock();
  if (!lock.tryLock(20000)) { if (interactive) SpreadsheetApp.getActive().toast('Синхронизация уже идёт, попробуйте через минуту', '🔗 База'); return; }
  const lines = [];
  try {
    const budget = { writes: DC.MAX_WRITES_PER_RUN };
    const ss = SpreadsheetApp.getActive();
    if (dcMode_() === 'pull') {
      let movesCache = null;
      DC_PULL.forEach((cfg) => {
        if (!ss.getSheetByName(cfg.source)) return; // зеркало — только в той таблице, где был исходный лист
        try {
          if (cfg.stock && !movesCache) movesCache = dcListAll_('/apps/warehouse/movements');
          lines.push(dcPullSheet_(ss, cfg, movesCache));
        } catch (e) { lines.push(`${cfg.sheet}: ❌ ${e.message}`); }
      });
    } else DC.SHEETS.forEach((cfg) => {
      const sh = ss.getSheetByName(cfg.sheet);
      if (!sh) return; // этого листа в этой таблице нет — пропускаем
      try { lines.push(dcSyncSheet_(sh, cfg, budget)); }
      catch (e) { lines.push(`${cfg.sheet}: ❌ ${e.message}`); }
    });
    const msg = `${new Date().toLocaleString('ru-RU')}\n` + (lines.join('\n') || 'нет листов для синхронизации');
    PropertiesService.getScriptProperties().setProperty('DATACORE_LAST', msg);
    console.log(msg);
    if (interactive) ss.toast(lines.join(' · ') || 'Нечего синхронизировать', '🔗 База данных', 8);
  } finally {
    lock.releaseLock();
  }
}

// ------------------------- Зеркало «База → Таблица» -------------------------

function dcPullSheet_(ss, cfg, moves) {
  const docs = dcListAll_(cfg.path).filter((d) => !d.deletedAt).sort(cfg.sort);
  const base = (PropertiesService.getScriptProperties().getProperty('DATACORE_BASE') || DC.BASE_URL_DEFAULT).replace(/\/api\/?$/, '');
  const byItem = {};
  (moves || []).forEach((m) => { (byItem[m.itemUid] = byItem[m.itemUid] || []).push(m); });

  const rows = docs.map((d) => {
    const st = cfg.stock ? dcStock_(d, byItem[d.uid] || []) : null;
    return cfg.columns.map(([, key]) => {
      if (key === '@photo') {
        const p = (d.photos || [])[0];
        return p ? `=IMAGE("${base}${p.thumb || p.url}")` : '';
      }
      if (key === '@onHand') return st.onHand;
      if (key === '@reserved') return st.reserved;
      if (key === '@free') return st.onHand - st.reserved;
      if (key === '@status') {
        const min = Number(d.minQty) || 0;
        if (st.onHand <= 0) return '❌ Нет';
        return min > 0 && st.onHand - st.reserved < min ? '⚠️ К закупке' : '✅ В норме';
      }
      if (key === '@moveType') return DC_MOVE_LABEL[d.type] || d.type || '';
      const v = d[key];
      return v === null || v === undefined ? '' : (typeof v === 'object' ? JSON.stringify(v) : v);
    });
  });

  const sh = ss.getSheetByName(cfg.sheet) || ss.insertSheet(cfg.sheet);
  sh.clearContents();
  const header = cfg.columns.map(([label]) => label);
  sh.getRange(1, 1, rows.length + 1, header.length).setValues([header].concat(rows));
  sh.getRange(1, 1, 1, header.length).setFontWeight('bold');
  sh.setFrozenRows(1);
  return `${cfg.sheet}: зеркало обновлено, строк ${rows.length}`;
}

/** Остаток позиции — как в приложении: из движений; до перехода — табличные цифры. */
function dcStock_(item, mv) {
  if (!item.fromMovements && !mv.length) {
    return { onHand: Number(item.currentQty) || 0, reserved: Number(item.reservedQty) || 0 };
  }
  let onHand = 0, reserved = 0;
  mv.forEach((m) => {
    const q = Number(m.qty) || 0;
    if (m.type === 'in' || m.type === 'opening' || m.type === 'adjust') onHand += q;
    else if (m.type === 'out') onHand -= q;
    else if (m.type === 'reserve') reserved += q;
    else if (m.type === 'unreserve') reserved -= q;
  });
  return { onHand, reserved };
}

// ------------------------------- Ядро -------------------------------

function dcSyncSheet_(sh, cfg, budget) {
  const path = `/apps/${cfg.app}/${cfg.collection}`;
  const lastRow = sh.getLastRow();
  let lastCol = sh.getLastColumn();
  if (lastRow <= cfg.headerRow) return `${cfg.sheet}: пусто`;

  // Колонка «ID базы»: найти или создать (скрытая)
  let headers = sh.getRange(cfg.headerRow, 1, 1, lastCol).getValues()[0].map((h) => String(h).trim());
  let idCol = headers.indexOf(DC.ID_HEADER) + 1;
  if (!idCol) {
    idCol = lastCol + 1;
    sh.getRange(cfg.headerRow, idCol).setValue(DC.ID_HEADER);
    sh.hideColumns(idCol);
    lastCol = idCol;
    headers = sh.getRange(cfg.headerRow, 1, 1, lastCol).getValues()[0].map((h) => String(h).trim());
  }

  const n = lastRow - cfg.headerRow;
  const values = sh.getRange(cfg.headerRow + 1, 1, n, lastCol).getValues();
  const keyIdx = headers.indexOf(cfg.keyHeader);
  if (keyIdx < 0) throw new Error(`нет колонки «${cfg.keyHeader}»`);
  // Ключи полей, которые даёт эта таблица (только их скрипт имеет право очищать в базе)
  const sheetKeys = headers
    .filter((h, c) => h && c !== idCol - 1 && !(cfg.skip || []).includes(h))
    .map((h) => cfg.fields[h] || dcSlug_(h))
    .filter(Boolean);

  // 1) Строки → записи; выдать id новым строкам и «разклеить» скопированные дубли id
  const ids = values.map((r) => String(r[idCol - 1] || '').trim());
  const seen = {};
  let idsChanged = false;
  const rows = [];
  values.forEach((r, i) => {
    if (String(r[keyIdx] === null ? '' : r[keyIdx]).trim() === '') return; // пустая строка
    if (!ids[i] || seen[ids[i]]) { ids[i] = Utilities.getUuid(); idsChanged = true; }
    seen[ids[i]] = true;
    const doc = dcRowToDoc_(headers, r, cfg, idCol - 1);
    doc.uid = ids[i];
    doc.syncHash = dcHash_(doc);
    rows.push(doc);
  });
  // id пишем в таблицу СРАЗУ — до обращения к базе (повторный запуск не создаст дублей)
  if (idsChanged) sh.getRange(cfg.headerRow + 1, idCol, n, 1).setValues(ids.map((v) => [v]));

  // 2) Что уже есть в базе (по uid)
  const remote = dcListAll_(path);
  const byUid = {};
  remote.forEach((d) => { if (d.uid) byUid[d.uid] = d; });

  // 3) Создать / обновить
  const toCreate = rows.filter((d) => !byUid[d.uid]);
  const toPatch = rows.filter((d) => byUid[d.uid] && byUid[d.uid].syncHash !== d.syncHash);
  let created = 0, patched = 0, deleted = 0, skippedDelete = false;
  for (let i = 0; i < toCreate.length && budget.writes > 0; i += 200) {
    const chunk = toCreate.slice(i, i + 200);
    dcApi_('post', path, chunk);
    created += chunk.length; budget.writes -= 1;
  }
  for (const d of toPatch) {
    if (budget.writes <= 0) break;
    const prev = byUid[d.uid];
    const body = Object.assign({}, d);
    // Поле очистили в таблице → очистить и в базе. Только поля из колонок таблицы:
    // поля, которые добавило приложение (фото, связи со складом), не трогаем.
    sheetKeys.forEach((k) => { if (!(k in body) && k in prev) body[k] = null; });
    dcApi_('patch', `${path}/${prev.id}`, body);
    patched++; budget.writes--; Utilities.sleep(150);
  }

  // 4) Удалённые из таблицы строки → мягкое удаление в базе (с защитой)
  const live = {};
  rows.forEach((d) => { live[d.uid] = true; });
  const gone = remote.filter((d) => d.uid && !live[d.uid]);
  if (gone.length && gone.length > Math.max(3, remote.length * DC.DELETE_GUARD_RATIO)) {
    skippedDelete = true;
  } else {
    for (const d of gone) {
      if (budget.writes <= 0) break;
      dcApi_('delete', `${path}/${d.id}`);
      deleted++; budget.writes--; Utilities.sleep(150);
    }
  }
  return `${cfg.sheet}: строк ${rows.length}, создано ${created}, изменено ${patched}, удалено ${deleted}` +
    (skippedDelete ? ` ⚠️ удаление ${gone.length} записей пропущено (слишком много — проверьте лист)` : '');
}

function dcRowToDoc_(headers, row, cfg, idColIdx) {
  const doc = {};
  headers.forEach((h, c) => {
    if (!h || c === idColIdx || (cfg.skip || []).includes(h)) return;
    const key = cfg.fields[h] || dcSlug_(h);
    if (!key) return;
    let v = row[c];
    if (v instanceof Date) v = Utilities.formatDate(v, 'UTC', 'yyyy-MM-dd') === '1899-12-30' ? '' : Utilities.formatDate(v, Session.getScriptTimeZone(), "yyyy-MM-dd'T'HH:mm:ss");
    if (typeof v === 'string') { v = v.trim(); if (/^\d{2}\.\d{2}\.\d{4}$/.test(v)) v = v.split('.').reverse().join('-'); }
    if (v === '' || v === null || v === undefined) return;
    doc[key] = v;
  });
  return doc;
}

// Транслит заголовка в ключ поля: «Дата прихода» → dataPrihoda
function dcSlug_(h) {
  const map = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya' };
  const words = String(h).toLowerCase().split('').map((ch) => (map[ch] !== undefined ? map[ch] : ch)).join('')
    .replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);
  if (!words.length) return '';
  const key = words.map((w, i) => (i ? w[0].toUpperCase() + w.slice(1) : w)).join('');
  return /^[a-z]/.test(key) ? key : 'f' + key;
}

function dcHash_(doc) {
  const copy = Object.assign({}, doc); delete copy.syncHash;
  const s = JSON.stringify(Object.keys(copy).sort().map((k) => [k, copy[k]]));
  return Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, s, Utilities.Charset.UTF_8)
    .map((b) => ('0' + (b & 0xff).toString(16)).slice(-2)).join('');
}

function dcListAll_(path) {
  const out = [];
  for (let page = 1; page < 100; page++) {
    const r = dcApi_('get', `${path}?limit=200&page=${page}&sort=createdAt`);
    out.push(...r.items);
    if (out.length >= r.total || !r.items.length) break;
  }
  return out;
}

function dcApi_(method, path, body) {
  const props = PropertiesService.getScriptProperties();
  const key = props.getProperty('DATACORE_KEY');
  const base = props.getProperty('DATACORE_BASE') || DC.BASE_URL_DEFAULT;
  if (!key) throw new Error('не задан ключ — меню «🔗 База данных → Сменить ключ»');
  for (let attempt = 1; attempt <= 4; attempt++) {
    const res = UrlFetchApp.fetch(base + path, {
      method: method, contentType: 'application/json', muteHttpExceptions: true,
      headers: { Authorization: 'Bearer ' + key },
      payload: body === undefined ? undefined : JSON.stringify(body),
    });
    const code = res.getResponseCode();
    if (code === 429 || code >= 500) { Utilities.sleep(1500 * attempt); continue; } // перегрузка — подождать и повторить
    const text = res.getContentText();
    if (code >= 300) throw new Error(`${method.toUpperCase()} ${path} → ${code}: ${text.slice(0, 200)}`);
    return text ? JSON.parse(text) : null;
  }
  throw new Error(`${method.toUpperCase()} ${path}: сервер перегружен, повторим в следующий запуск`);
}
