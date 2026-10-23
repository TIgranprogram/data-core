/* Т-14: что затронет смена кода категории паспорта MAF → BLG — ТОЛЬКО ПЛАН (режима записи нет намеренно).
 * Применять — отдельной задачей после «да» пользователя: тогда дописать запись и бэкап, и одновременно выложить код
 * (список мест в коде — ниже, CODE_PLACES), иначе паспорта BLG будут отклонены проверкой @IsIn и не найдут тексты.
 *
 *   MONGO_URI=… [MONGO_DB=…] node scripts/migrate-maf-to-blg.js
 */
const path = require('path');
const { MongoClient } = require(require.resolve('mongoose', { paths: [process.cwd(), path.join(__dirname, '..')] })).mongo;

const FROM = 'MAF'; const TO = 'BLG';
const CODE_PLACES = [
  'src/modules/product-passport/dto/create-product-passport.dto.ts — @IsIn([... MAF])',
  'src/modules/product-passport/passport-template-select.ts — PASSPORT_CATEGORIES',
  'src/modules/product-passport/passport-rules.ts — V2_REQUIRED_FIELDS.MAF, «code !== \'MAF\'» (элементы не обязательны)',
  'src/modules/product-passport/passport-texts.v2.ts — тип PassportTextsCategory',
  'src/modules/product-passport/product-passport.controller.ts — enum в @ApiQuery (2 места)',
  'src/modules/showcase/passport-defaults.ts — PASSPORT_CATEGORY_CODES',
  'src/modules/dicts/dicts.defs.ts — подсказки кодов (4 места)',
  'scripts/passport-texts.v2.json — ключ "MAF"; seed-passport-categories.js, seed-passport-dicts.js (COLOR_MAF, categories), seed-passport-texts.js (ORDER), passport-texts-transfer.js',
  'pwa/core/passport-kinds.js CAT_NAMES; pwa/sections/passports.js V2_CATS, CAT_DEFAULTS?, OLD_TO_V2; pwa/sections/passport-texts.js',
  'spec/e2e с кодом MAF',
];
const hasCode = (s) => String(s || '').split(/[,;\s]+/).includes(FROM);

(async () => {
  const c = await MongoClient.connect(process.env.MONGO_URI);
  const db = c.db(process.env.MONGO_DB || undefined);
  const pp = db.collection('productpassports');
  const out = {
    'productpassports.passportCategory': await pp.countDocuments({ passportCategory: FROM }),
    'productpassports.textSnapshot.category': await pp.countDocuments({ 'textSnapshot.category': FROM }),
    'passporttemplates (версии текстов категории)': await db.collection('passporttemplates').countDocuments({ category: FROM }),
    'products.passportDefaults.passportCategory': await db.collection('products').countDocuments({ 'passportDefaults.passportCategory': FROM }),
  };
  const dv = await db.collection('dict_values').find({ dict: /^passport/ }).toArray();
  out['dict_values: код категории (passportCategories)'] = dv.filter((d) => d.dict === 'passportCategories' && d.code === FROM).length;
  out['dict_values: оформление (category / код COLOR_MAF)'] = dv.filter((d) => d.dict === 'passportStyle' && (d.category === FROM || /_MAF$/.test(String(d.code)))).length;
  out['dict_values: списки «Категории» (элементы, материалы, установка)'] = dv.filter((d) => hasCode(d.categories)).length;
  console.log(`ПЛАН смены кода ${FROM} → ${TO} (ничего не пишем; запись — после «да», отдельной задачей)`);
  for (const [k, n] of Object.entries(out)) console.log(`  ${k}: ${n}`);
  console.log('Код (выложить одновременно с данными):'); for (const p of CODE_PLACES) console.log('  - ' + p);
  console.log('PDF: цвет обложки ищется по коду категории в «Оформлении» — меняется вместе с данными; название на обложке — из справочника (уже «Благоустройство»).');
  await c.close();
})().catch((e) => { console.error(e.message); process.exit(1); });
