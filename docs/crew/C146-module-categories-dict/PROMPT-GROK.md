# Промпт для Grok — C146

Скопируй блок ниже в Grok (Agent / Composer в этой папке репо).

---

Ты исполнитель data-core. Класс M. Роль — backend+лёгкий pwa по ТЗ.

Прочитай только: `docs/crew/C146-module-categories-dict/TZ.md` и файлы из раздела «Файлы» ТЗ.

Сделай: справочник `moduleCategories` (`categories` с `type=module`) + правки подсказок со ссылкой `#dicts?d=moduleCategories`. Зеркало material-`categories`, не путать с product groups.

Нельзя: прод-данные, чужие файлы, `git add -A`, DESIGN/openapi целиком, менять enum схемы (module уже есть).

Проверки из ТЗ (smoke). Отчёт — `docs/crew/C146-module-categories-dict/REPORT.md`. Коммит не делай, пока не скажут.

Старт: прочитай ТЗ → правь → smoke → REPORT.
