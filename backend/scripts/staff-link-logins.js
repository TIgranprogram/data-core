#!/usr/bin/env node
/**
 * СВ-3: связать входы с сотрудниками по подсказке сервера (совпало ФИО).
 *   node scripts/staff-link-logins.js <local|prod>            - план, ничего не пишет
 *   node scripts/staff-link-logins.js <local|prod> --apply    - связать
 * Только через deploy/synology/api.sh. Вход без подсказки не трогается: его связывают на экране «Сотрудники».
 * Откат: в карточке сотрудника выбрать «без входа».
 */
const { api } = require('./import-metal-stock.js');

const [env, flag] = process.argv.slice(2);
if (!['local', 'prod'].includes(env)) { console.error('usage: <local|prod> [--apply]'); process.exit(2); }

async function main() {
  const r = await api('GET', '/api/staff');
  const staff = new Map((r.items || []).map((p) => [String(p.id), p]));
  const logins = r.loginsWithoutPerson || [];
  const sure = logins.filter((l) => l.suggestPersonId && staff.has(String(l.suggestPersonId)));
  const manual = logins.filter((l) => !sure.includes(l));
  console.log(`Входов без сотрудника: ${logins.length}. Связать: ${sure.length}. Вручную: ${manual.length}.`);
  for (const l of sure) console.log(`  ${l.displayName || l.username} (${l.username}) → ${staff.get(String(l.suggestPersonId)).name}`);
  for (const l of manual) console.log(`  вручную: ${l.displayName || l.username} (${l.username})`);
  if (flag !== '--apply') { console.log('\nНичего не записано (план). Записать: --apply'); return; }
  for (const l of sure) await api('PUT', `/api/staff/${l.suggestPersonId}/login`, { userId: l.userId });
  console.log(`\nГотово: связано ${sure.length}.`);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
