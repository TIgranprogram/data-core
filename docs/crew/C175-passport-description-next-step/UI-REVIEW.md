# C175 — проверка вида и действий в фикстуре

21.11.2026; незакоммиченный UI-diff: book-template-edit.js и book-autofill.test.mjs. Настоящие openSimpleDescription, kit, CSS приложения; подмена только endpoint списка частей и callback save, никакой рабочей авторизации/данных. Воспроизводимый сценарий evidence/harness.mjs (рабочий запуск tools/logs/c175-ui-harness.mjs).

PASS ограниченной фикстуры: обе темы1440×1100, исходное отсутствие linked→явный поиск всех частей→выбор каркаса→preview→обновление списка→ручной текст→обновление без потери→save callback→reopen. Отдельно пустой справочник manager1024×1100. Панель фактически279px, overflow0, pageerrors0. Результаты evidence/results.json. Созданные6PNG открыты выборочно: light-initial, dark-initial, light-refreshed-manual, dark-empty-manager; final dark-empty-manager пересмотрен после использования штатного ghost вместо малочитаемого secondary для ручного текста. Непросмотренные парные кадры доступны координатору.

Эталон: существующая боковая bk-panel/sideForm и kit stack/actions/button/textInput/attachCombo/buildForm. Промпт и ссылки не закрывают поиск; явная кнопка находится перед полем. Текст переносится, текущий выбор и ручной текст сохранены. Light/dark controls читаемы, токены и компоненты не менялись.

Серверное сохранение, переход в реальный справочник и back/reopen на stand эта фикстура не подтверждает; полный статус приёмки PARTIAL до независимой проверки координатором. Наполнение справочника и готовые варианты изделий отдельно.

Дополнение: настоящее сохранение/перечитывание/возврат из справочника/перезагрузка/повторное открытие/CASвосстановление проверены наowned3102. evidence/live/result.json, light-before-save/dark-reopened. Ровно2PATCH, pageerrors0, issued1unchanged. DESIGNER.md после просмотра обоих liveкадров — PASS назначенногоC175UI.
