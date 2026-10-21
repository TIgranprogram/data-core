// Сценарии кнопок ‹ › (TASKS НВ.0/НВ.6) — выражение для qa-screenshot.mjs (стенд docker-compose.qa.yml):
//   QA_DIR=… node backend/scripts/qa-screenshot.mjs 1440 900 '#home' out.png "$(cat backend/scripts/qa-nav-scenarios.js)"
// Возвращает строки «сценарий · ожидание · факт · ок/НЕТ» и ошибки консоли.
(async () => {
  const w = (ms) => new Promise((r) => setTimeout(r, ms));
  const errs = []; window.addEventListener('error', (e) => errs.push(e.message));
  const back = () => document.querySelector('button[aria-label="Назад"]');
  const fwd = () => document.querySelector('button[aria-label="Вперёд"]');
  const rows = [];
  const check = (name, expect, fact) => rows.push(`${name} · ждём: ${expect} · факт: ${fact} · ${String(fact) === String(expect) ? 'ок' : 'НЕТ'}`);
  await w(800);
  check('1. «Назад» неактивна ровно на первом шаге сеанса', !(history.state?.dcIdx > 0), back().disabled);
  location.hash = '#requests'; await w(700); location.hash = '#stock'; await w(700);
  back().click(); await w(700);
  check('2. раздел → раздел → ‹', '#requests', location.hash);
  check('   подсказка ‹', 'Назад: Сегодня (Alt+←)', back().title);
  fwd().click(); await w(700);
  check('   › возвращает', '#stock', location.hash);
  check('   «Вперёд» на последнем — неактивна', true, fwd().disabled);
  // карточка: клик по строке → закрыть ✕ → ‹ ведёт на прошлый экран, а не в карточку
  document.querySelector('table.list tbody tr')?.click(); await w(1200);
  const opened = /open=/.test(location.hash);
  document.querySelector('.drawer button[aria-label="Закрыть"]')?.click(); await w(800);
  check('3. строка → карточка → ✕: карточка закрыта, адрес без open', '#stock', opened ? location.hash : 'карточка не открылась');
  back().click(); await w(800);
  check('   затем ‹ — прошлый экран, не карточка', '#requests', location.hash);
  // фильтр — без шага истории
  location.hash = '#stock'; await w(800);
  document.querySelector('.chips .chip:nth-child(2)')?.click(); await w(800);
  const filtered = location.hash;
  back().click(); await w(800);
  check('4. фильтр не добавляет шаг: ‹ уходит со «Склада»', true, filtered.includes('status=') && !location.hash.startsWith('#stock'));
  // несохранённая форма: ‹ спрашивает, «Отмена» — остаёмся с вводом
  location.hash = '#requests?new=1&of=requests'; await w(1500);
  const inp = document.querySelector('.drawer input[name="title"]'); if (inp) { inp.value = 'НВ проверка'; inp.dispatchEvent(new Event('input', { bubbles: true })); }
  back().click(); await w(800);
  const ask = document.querySelector('.modal')?.innerText.split('\n')[0];
  check('5. форма с вводом + ‹: вопрос', 'Выйти без сохранения?', ask);
  [...document.querySelectorAll('.modal button')].find((b) => b.textContent === 'Отмена')?.click(); await w(800);
  check('   «Отмена» — форма на месте, ввод цел', 'НВ проверка', document.querySelector('.drawer input[name="title"]')?.value);
  // окно поверх: ‹ закрывает окно, экран не меняется
  const before = location.hash;
  back().click(); await w(600);
  [...document.querySelectorAll('.modal button')].find((b) => b.textContent === 'Выйти')?.click(); await w(900);
  check('6. «Выйти» — уходим назад без формы', true, !document.querySelector('.drawer') && location.hash !== before);
  // окно поверх (НВ.5: жест «назад» на телефоне) — ‹ закрывает окно, экран остаётся
  location.hash = '#stock'; await w(1000);
  document.querySelector('table.list tbody tr')?.click(); await w(1200);
  [...document.querySelectorAll('.drawer .actions button')].find((b) => b.textContent.includes('Приход'))?.click(); await w(500);
  const hashWithDlg = location.hash, hadDlg = !!document.querySelector('.modal-back');
  back().click(); await w(800);
  check('7. окно «Приход» + ‹: окно закрыто, карточка на месте', 'true true', `${hadDlg && !document.querySelector('.modal-back')} ${location.hash === hashWithDlg}`);
  const r = back().getBoundingClientRect();
  check('8. кнопки ‹ › видны (на телефоне — от 44 px)', true, r.width > 0 && (innerWidth > 720 || r.height >= 44));
  return rows.join('\n') + '\nошибки консоли: ' + JSON.stringify(errs);
})()
