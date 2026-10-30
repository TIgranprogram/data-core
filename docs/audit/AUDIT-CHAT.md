# Аудит чата (2026-10-30, по коду; снимков нет)

Проверено: pwa/sections/chat.js, ui/chat-window.js, ui/chat-button.js, ui/bell.js, ui/screens.css (.cv*, .chat-*, .bell*), backend/src/modules/messages + notifications.

## 1. Что работает
- Свой значок «Чат» (chat-button.js) со счётчиком из /messages/threads (личные + «Всем»); колокольчик — отдельная кнопка.
- Окно чата поверх экрана: 420 px справа, тянется за левый край, Esc/✕/повторный клик закрывают; на ≤700 px — весь экран, кнопки 44 px.
- Внутри окна всегда «список → переписка» с «← Назад»; Enter отправляет, фото (скрепка, Ctrl+V, drag), смайлики, «прочитано», пустые состояния по-русски, aria-log/aria-label, :focus-visible у строк.
- Без innerHTML с данными; только токены var(--…).

## 2. Находки
🔴 Колокольчик НЕ очищен от чата. messages.service.ts:154-157 при личном сообщении создаёт уведомление type 'message', kind 'important'; notification-kind.ts:6 держит 'message' в IMPORTANT_TYPES. Итог: сообщение видно и в чате, и во вкладке «Важные» колокольчика, число на колокольчике растёт.
🔴 Двойной счёт: bell-badge считает «message»-уведомления, chat-button — те же сообщения; app-badge.js суммирует части 'bell'+'chat' → значок приложения/вкладки завышен вдвое.
🔴 Прочтение в чате (POST /messages/with/:id/read, messages.service.ts:162) не гасит уведомления 'message' → число на колокольчике висит, пока не нажмёшь «Прочитать все».
🟡 Ссылка уведомления '#/chat/<id>' (messages.service.ts:156) устарела: чат открывается окном по with=, а не путём; после чистки пункта 🔴 уйдёт сама (старые записи в базе — см. backend).
🟡 Окно чата: .chat-win-body padding s2 + .cv-list/.cv-conv свои padding s3 + рамки → двойная рамка/лишние поля на 390 px (screens.css:1519, 989). Сделать у .chat-win .cv-list/.cv-conv без border и с padding s2.
🟡 Строка поиска и «Сообщения» (.cv-head) — заголовок b без h-уровня; ✕ перекрывает правый край шапки: на списке есть padding-right 44px (1524), на 390 px сработает, но у «Сообщения» нет роли заголовка. Сделать h2/класс заголовка из DESIGN §2.
🟡 .cv-row.is-new отличается от .on только фоном surface-2 (998) — «новое» почти не видно (surface-2 ≈ hover). Добавить жирный заголовок/точку у .is-new.
🟡 Отправить: на 390 px кнопка «Отправить» (btn-primary) не входит в правило 44px (1032 покрывает только .btn-icon) — проверить min-height у .chat-form .btn.
🟡 Поле ввода 2 строки + подсказка «Enter — отправить, Shift+Enter…» в placeholder: на телефоне Enter = перенос, а кнопка есть; подсказка обрезается на 390 px. Короткий placeholder «Сообщение…», подсказку — в title/aria.
🟡 Смайлики: панель width min(360px,100%) absolute над формой; на 390 px кнопки 40 px < 44 (1021). Поднять до 44 в @media ≤700.
🟡 Опрос раз в 15 с только при открытом окне, значок — раз в 2 мин: новое сообщение в закрытом чате видно с задержкой до 2 мин. Допустимо; при желании 60 с, пока вкладка видима.
🟡 Страница #chat (mount) делает history.back() — при прямом заходе по ссылке уходит на home; ок, но мигает. Не критично.
Вёрстка: 390 — окно 100vw, список/переписка по очереди ✔; 1024 — 420 px справа, экран под ним сжимается не должен (position:fixed, перекрывает правый край страниц — проверить, что не закрывает правую панель ввода: z 55 > drawer 41, т.е. закрывает; приемлемо по DESIGN, но кнопки панели ввода пропадают под чатом — снимок нужен); 1920 — 420 px (можно растянуть до --chat-w), горизонтальной прокрутки нет (min-width:0, overflow-wrap).
Старый `.cv` на странице (grid 260–340 + 1fr, 988) больше не используется (чат всегда в окне) — мёртвый CSS: 988-989, 1027-1033 частично.

## 3. План правок
### backend (исполнитель backend)
1. backend/src/modules/messages/messages.service.ts:154-157 — убрать `this.notices.notify(...)`; убрать зависимость NotificationsService из конструктора (строки 7, 22) и из messages.module.ts (импорт модуля уведомлений, если больше не нужен).
2. backend/src/modules/notifications/notification-kind.ts:6 — убрать 'message' из IMPORTANT_TYPES; kindOf('message') тогда 'system' — старые записи в БД скрыть: в kindFilter/list исключить type:'message' (`type: { $ne: 'message' }`) в notifications.service.ts:79 (unreadCounts group) и :87 (список); либо разовая миграция deleteMany type:'message' — только с «да» пользователя (данные прода).
3. Тесты: messages.service.spec.ts:48-52 — ожидать `notices.notify` НЕ вызван; :82-86 оставить; notification-kind.spec.ts:5,11,19 — убрать/поправить 'message'.
4. Документы: docs/MAP.md (messages → notifications связь), docs/openapi.json не меняется.
### frontend (исполнитель frontend, pwa)
1. ui/bell.js:24 — total = S.unread.important (после backend-правки сообщений там нет); дополнительно отфильтровать клиентом `x.type !== 'message'` в serverItem-списке (bell.js:80) на период, пока старые записи не очищены.
2. ui/app-badge.js — убедиться, что сумма 'bell'+'chat' не удваивается (после правки backend ок).
3. ui/screens.css:1519-1524 — .chat-win .cv-list/.cv-conv: `border:0; border-radius:0; padding: var(--s2)`; .chat-win-body padding 0.
4. screens.css:998 — .cv-row.is-new: `font-weight:600` у `.bt-main b` + заметный маркер (цвет --gold) помимо фона.
5. screens.css в @media (max-width:700px) блок 1526-1529: `.chat-win .chat-form .btn, .chat-emoji-btn { min-height:44px; min-width:44px }`.
6. chat.js:67 — placeholder «Сообщение…», подсказка про Enter — в `title` textarea; chat.js:59 — «Сообщения» обернуть в h2 (класс из DESIGN §2).
7. chat.js:34 / screens.css:988-989,1027-1033 — удалить неиспользуемые правила страницы (.cv grid, media 720) после проверки grep, что #chat всегда в окне.
8. help-flow-data.js — если там описан путь «сообщения в колокольчике», обновить (правило «синхронизировать ?»).
### Проверка после правок
Снимки (с разрешения): 390 список/переписка/смайлики, 1024 с открытой правой панелью, 1920; отправить сообщение под вторым пользователем — в колокольчике пусто, на «Чат» +1.
