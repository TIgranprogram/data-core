/* Тема оформления «Рабочего места» и админки: светлая / тёмная / как в системе.
 * Подключается в <head> ДО стилей (обычный скрипт, не модуль), чтобы не было вспышки светлой темы.
 * Выбор хранится в этом браузере (localStorage 'dc-theme'). Цвета — ui/tokens.css (:root[data-theme='dark']). */
(function () {
  var KEY = 'dc-theme';
  var hasSoftTheme = document.currentScript.hasAttribute('data-soft-theme');
  if (hasSoftTheme) document.documentElement.setAttribute('data-workplace-theme', '');
  var media = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  function stored() { try { return localStorage.getItem(KEY) || 'auto'; } catch (e) { return 'auto'; } }
  function apply(mode) {
    var dark = mode === 'dark' || (mode === 'auto' && media && media.matches);
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : mode === 'soft' && hasSoftTheme ? 'soft' : 'light');
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', dark ? '#0b0e14' : '#1e415e');
  }
  var NAMES = { auto: 'как в системе', light: 'светлая', soft: 'средняя', dark: 'тёмная' };
  window.dcTheme = {
    get: stored,
    name: function () { return NAMES[!hasSoftTheme && stored() === 'soft' ? 'light' : stored()]; },
    cycle: function () {
      var next = hasSoftTheme
        ? ({ auto: media && media.matches ? 'light' : 'soft', light: 'soft', soft: 'dark', dark: 'light' }[stored()] || 'light')
        : ({ auto: 'light', light: 'dark', dark: 'auto' }[stored()] || 'auto');
      try { localStorage.setItem(KEY, next); } catch (e) { /* приватный режим — только на эту вкладку */ }
      apply(next);
      return NAMES[next];
    },
  };
  apply(stored());
  if (media && media.addEventListener) media.addEventListener('change', function () { if (stored() === 'auto') apply('auto'); });
})();
