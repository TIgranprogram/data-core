// Сверка карты кода: каждая папка backend/src/modules/* упомянута в docs/MAP.md.
// node backend/scripts/check-map.mjs — код выхода 1, если карта отстала. Вызывается из preflight как предупреждение.
import fs from 'fs';

const root = new URL('../../', import.meta.url);
const map = fs.readFileSync(new URL('docs/MAP.md', root), 'utf8');
const dirs = fs.readdirSync(new URL('backend/src/modules/', root), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
const missing = dirs.filter((d) => !map.includes(d));
if (missing.length) console.log('Нет в docs/MAP.md: ' + missing.join(', '));
else console.log(`карта: все ${dirs.length} модулей на месте`);
process.exit(missing.length ? 1 : 0);
