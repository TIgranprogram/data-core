const { readFileSync } = require('node:fs');

function parseJson(text) {
  try { return JSON.parse(text); } catch { return null; }
}

function releaseVersion(text) {
  const version = parseJson(text)?.v;
  // В журнале длинные hex-строки маскируются при записи.
  return typeof version === 'string' && /^[0-9a-f]{7,31}$/.test(version) ? version : null;
}

function readVersionErrors(text, version) {
  const data = parseJson(text);
  if (!version || data?.version !== version || !Array.isArray(data.items)) return null;
  return data.items.every((item) => item?.version === version) ? data.items : null;
}

if (require.main === module) {
  const [, , action, version, hours] = process.argv;
  const input = readFileSync(0, 'utf8');
  if (action === 'version') {
    const installed = releaseVersion(input);
    if (installed) console.log(installed);
    else process.exitCode = 1;
  } else if (action === 'post-check') {
    const items = readVersionErrors(input, version);
    if (!items) {
      console.log('ПОСЛЕ ВЫКЛАДКИ: API не подтвердил выборку по версии ' + version);
      process.exitCode = 1;
    } else {
      console.log(`За ${hours} ч в версии ${version} найдено групп ошибок: ${items.length}`);
      for (const item of items.slice(0, 5)) {
        console.log(`  ${item.count}× ${item.users} чел · ${item.section || '-'} · ${String(item.message).slice(0, 90)}`);
      }
      console.log(items.length ? `ПОСЛЕ ВЫКЛАДКИ: ${items.length} групп ошибок в новой версии — в очередь первыми` : 'ПОСЛЕ ВЫКЛАДКИ: чисто');
    }
  } else process.exitCode = 2;
}

module.exports = { parseJson, readVersionErrors };
