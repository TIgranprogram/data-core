# C163 — возврат фокуса после увеличенного фото
- Первичный аудит gallery/card-gallery/card/card-parent и evidence keyboard-results; результат исправления — в конце.
- `ui/kit/gallery.js:47` захватывает именно document.activeElement при открытии; явного opener аргумента нет.
- `:63–64` удаляет lightbox, снимает keydown, останавливает всплытие, синхронно возвращает фокус connected opener.
- Закрытие кнопкой и Escape вызывает одну функцию; двойной вызов родителем исключён stopPropagation.
- `card-gallery.js:17–20` на Enter отменяет default и всплытие; передаёт openZoom без перерисовки.
- В текущем PWA нет focusScope/focus trap, перехватывающего этот focus(): поиск activeElement/focusin/focusout отрицательный.
- `card-parent.js:15–29` скрывает/inert только родительскую панель при открытии вложенного openCard; openZoom туда не обращается.
- `card.js:169` заменяет галерею при showView(); сам просмотр фото showView не вызывает.
- Следовательно, disconnect opener возможен только из внешнего reload/setRow/load; текущие evidence этого не измеряют.
- Evidence доказывает лишь FAIL после close.click(): картинка существует, но identity и activeElement не сохранены.
- В проверке между открытием и закрытием вызывается screenshot со стилем `body > :not(.lightbox) { visibility:hidden!important }`.
- Это временно скрывает drawer и opener; влияние на connected/visible/focus нужно отделить от поведения продукта.
- Минимальный необходимый R0 proof: сохранить ссылку opener до Enter; журнал focusin/focusout (tag/class) и MutationObserver удалений opener.
- Замеры: после открытия, после screenshot, до close.click, сразу после и через requestAnimationFrame; activeElement, sameOpener, connected, visibility, inert предков.
- Повторить закрытие мышью без screenshot и Escape; сверить исполняемый gallery.js со свежим source, исключая старый модуль.
- Позже координатор подтвердил перерисовку IMG.g-big/pgal-img: disconnected opener объясняет BODY после Escape.
- Исправление gallery.js: connected original first; иначе тот же src только внутри сохранённого connected aside[data-k="drawer"].
- Таймеров/глобального fallback нет. Unit 7/7, imports 364/0, pwa-guards 359/359 PASS; код не коммитился.
- Browser proof координатору: detached replacement, click-close/Escape, обе темы; wrong asset/dead owner не получают фокус.

## Подтверждение после исправления

В `evidence/acceptance-c163-focus-lifecycle-caption-results.json` без съёмки между Enter и Escape: исходный IMG отключён уже при открытом просмотре, drawer остаётся тем же подключённым узлом, src текущего фото совпадает. После Escape и следующего кадра активен текущий видимый IMG. Это подтверждает замену дочернего фото, а не исчезновение панели. Общий viewer восстановил логический фокус по тому же src внутри исходного drawer. Исходные FAIL сохранены; снимок с временным privacy-стилем не используется как единственное доказательство фокуса.

В заключительном прогоне все 4 пары Enter → Escape вернули фокус текущему фото. В первом ходе исходный узел отсоединился при открытом просмотре. Контрольные данные и сеть прошли проверку, неожиданных записей 0. [Заключительная трасса](evidence/acceptance-c163-focus-final-results.json)
Два вспомогательных шага свежего входа завершились ошибкой сценария до фиксации принудительных тем и проверки источника JS в браузере. Тёмная тема подтверждена отдельной трассой выше. Публичный HTTP GET модуля `gallery.js` ответил 200, SHA-256 `43E828D77DAB6628DA2E52AB10C8BD177A238974EBBCCD738EF2EEC36B064DB3` совпал с файлом проекта.
