// Экран «Что делать сейчас»: состояние проекта + журнал запусков → список дел с причиной и кнопкой.
// Чистая функция: сеть и диск не трогает. Ритм команд — поле every в catalog.mjs.

export const LEVELS = [
  { id: 'urgent', title: 'Сначала это', hint: 'Что-то сломано. Остальное подождёт' },
  { id: 'today', title: 'Сегодня', hint: 'Дела на сегодня и то, что мешает выкладке' },
  { id: 'soon', title: 'Рекомендуется', hint: 'Подошёл срок. Можно сделать, когда будет время' },
];

const HOUR = 3600000;
const DAY = 24 * HOUR;
const POST_CHECK_AFTER = HOUR;
const cut = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();

/** s — состояние из readStatus, runs — { id команды: { at, code, last, bad, commit } }. */
export function advise(s, runs, commands, now = Date.now()) {
  const items = [];
  const add = (level, cmd, why) => { if (!items.some((x) => x.cmd === cmd)) items.push({ level, cmd, why }); };
  const gateFiles = s.gateFiles || [];

  if (s.site === false) add('urgent', 'prod-doctor', 'Сайт не отвечает. Осмотр покажет причину.');
  const doctor = runs['prod-doctor'];
  if (doctor?.bad?.length) add('urgent', 'prod-doctor', `Прошлый осмотр нашёл: ${cut(doctor.bad[0], 130)} Передайте это Claude, затем повторите осмотр.`);
  const release = runs['deploy-release'];
  if (release && release.code !== 0) add('urgent', 'deploy-release', `Выкладка не прошла: ${cut(release.last || 'причина в журнале', 130)}`);
  if (s.route === null) add('urgent', 'setup-work', 'На этом ПК нет ключа входа на сервер. Кнопки сервера не работают.');

  if (gateFiles.length) add('today', 'git-status', `Файлов без коммита: ${gateFiles.length}. Пока они не в коммите, выкладка закрыта. Попросите Claude закоммитить.`);
  if (s.behind) add('today', 'git-pull', `В GitHub есть новые коммиты: ${s.behind}. Заберите их до начала работы.`);
  if (s.ahead) add('today', 'git-push', `Коммиты не отправлены в GitHub: ${s.ahead}. Выкладка требует, чтобы они были там.`);
  if (s.undeployed && !gateFiles.length && !s.ahead) add('today', 'deploy-release', `Не на сайте: ${s.undeployed} ${s.undeployed === 1 ? 'изменение' : 'изменений'} в коде.`);

  if (release?.code === 0) {
    const post = runs['deploy-post'];
    const age = now - release.at;
    if (!post || post.at < release.at) {
      if (age >= POST_CHECK_AFTER) add('today', 'deploy-post', 'После выкладки прошёл час. Проверьте новые ошибки с сайта.');
      else add('soon', 'deploy-post', `Выкладка была недавно. Проверку лучше сделать через ${Math.ceil((POST_CHECK_AFTER - age) / 60000)} мин.`);
    }
    if (!doctor || doctor.at < release.at) add('today', 'prod-doctor', 'После выкладки нужен осмотр сайта.');
  }

  for (const c of commands) {
    if (!c.every) continue;
    const last = runs[c.id];
    const level = c.every === 1 ? 'today' : 'soon';
    if (!last) add(level, c.id, `${c.why}. Ещё не запускалось с этого ПК.`);
    else if (c.every === 1 ? !sameDay(last.at, now) : now - last.at >= c.every * DAY) {
      add(level, c.id, c.every === 1 ? `${c.why}.` : `${c.why}. Прошло дней: ${Math.floor((now - last.at) / DAY)}.`);
    }
  }

  const done = commands.filter((c) => runs[c.id]?.code === 0 && sameDay(runs[c.id].at, now) && !items.some((x) => x.cmd === c.id))
    .map((c) => ({ cmd: c.id, at: runs[c.id].at }));
  return { items, done };
}
