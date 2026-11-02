#!/usr/bin/env bash
# Выкладка data-core на VM по ssh — единственный путь; по шагам skill `datacore-deploy`.
# Запуск из корня репо в Git Bash:   bash deploy/synology/release.sh [--data] [--drop-archive] [--force-urgent]
#   сначала ворота deploy/synology/preflight.sh — красное → выкладки нет;
#   без флагов — сама выбирает путь (печатает «== Путь: …»):
#     быстрый — менялись только экраны (backend/pwa, backend/admin) и файлы вне сервера (docs, tools, pult, *.md):
#               без сборки и перезапуска, экраны обновляются на месте (sync-dir.sh) в примонтированных папки; бэкап — если копии базы старше суток;
#     полный  — всё остальное (бэкап → архив HEAD → замена backend/ deploy/ → build → up → проверка);
#   --dry-run       — только показать, какой путь будет выбран, и выйти (ничего не меняет);
#   --full          — всегда полный путь;
#   --data          — плюс загрузка Excel-заказов с фото и привязка заказов «Спортсет» (повторно безопасно, ничего не задваивает);
#   --drop-archive  — после бэкапа: архивные таблицы прежнего приложения (app_supply_*, app_warehouse_*) выгружаются
#                     в /var/lib/datacore/backups/archive-<дата>/ и удаляются (разово, TASKS 7.2).
# Mongo-контейнер и CRM kppdf не трогаются: пересобирается и перезапускается только datacore-backend.
set -euo pipefail
VM="${VM:-tiit@192.168.1.52}"
KEY="${KEY:-$HOME/.ssh/kppdf80-vm}"
ORDERS_DIR="${ORDERS_DIR:-для анализа/заказы}"
SSH=(ssh -i "$KEY" -o BatchMode=yes "$VM")
DATA=0; DROP=0; URGENT=""; DRY=0; FORCE_FULL=0
for a in "$@"; do [[ "$a" == "--data" ]] && DATA=1; [[ "$a" == "--drop-archive" ]] && DROP=1; [[ "$a" == "--force-urgent" ]] && URGENT="--force-urgent"; [[ "$a" == "--dry-run" ]] && DRY=1; [[ "$a" == "--full" ]] && FORCE_FULL=1; done

cd "$(git rev-parse --show-toplevel)"

# Выбор пути (быстрый / полный). Любое сомнение — полный. Пометка версии сервера — /opt/data-core/.release-commit,
# пишется только после успешной проверки, удаляется в начале выкладки и при откате.
PREV="$("${SSH[@]}" 'cat /opt/data-core/.release-commit 2>/dev/null; true' 2>/dev/null | tr -d '[:space:]' || true)"
[[ "$PREV" =~ ^[0-9a-f]{7,40}$ ]] || PREV=""
VMOK="$("${SSH[@]}" 'docker inspect -f "{{range .Mounts}}{{.Destination}} {{end}}" datacore-backend 2>/dev/null | grep -q "/app/pwa" && echo yes; true' 2>/dev/null || true)"
MODE=full; WHY=""
if [[ $FORCE_FULL == 1 || $DATA == 1 || $DROP == 1 ]]; then WHY="задан флаг полной выкладки"
elif [[ -z "$PREV" ]]; then WHY="на сервере нет пометки прошлой выкладки"
elif ! git cat-file -e "$PREV^{commit}" 2>/dev/null || ! git merge-base --is-ancestor "$PREV" HEAD; then WHY="версия сервера не найдена в истории"
elif [[ "$VMOK" != yes ]]; then WHY="экраны на сервере ещё не подключены папкой"
else
  # --no-renames: перенос файла из backend/src в pwa виден и старым путём
  OTHER="$(git diff --no-renames --name-only "$PREV" HEAD | grep -vE '^backend/(pwa|admin)/|^(docs|tools|pult)/|^[^/]+\.md$' || true)"
  if [[ -n "$OTHER" ]]; then WHY="менялся не только вид: $(echo "$OTHER" | head -3 | tr '\n' ' ')"; else MODE=fast; fi
fi
echo "== Путь: $([[ $MODE == fast ]] && echo 'быстрый (только экраны)' || echo полный)${WHY:+ — $WHY}"
[[ $DRY == 1 ]] && exit 0

# Ворота (RELEASE-GATE): незакоммиченное, push, tsc/юнит, импорты приложения, след дизайнера и full.
# --force-urgent — только когда сайт уже сломан: пропускает приёмку дизайнера и full, остальное — нет.
echo "== Ворота"
bash deploy/synology/preflight.sh $URGENT || exit 1
echo "== Версия: $(git log --oneline -1)"

# Место на диске VM (TASKS ДИ.3): показать и остановиться, если свободно < 2 ГБ (бэкап + сборка образа его съедят)
echo "== 0. Место на диске VM"
"${SSH[@]}" 'df -h /var/lib/datacore | tail -1'
FREE_KB=$("${SSH[@]}" 'df -Pk /var/lib/datacore | tail -1 | awk "{print \$4}"')
if [[ -z "$FREE_KB" || "$FREE_KB" -lt 2097152 ]]; then
  echo "СТОП: на VM свободно меньше 2 ГБ (${FREE_KB:-?} КБ) — освободите место (старые бэкапы, docker image prune) и повторите"; exit 1
fi

# с этого момента версия сервера «неизвестна», пока проверка не пройдёт
"${SSH[@]}" 'rm -f /opt/data-core/.release-commit'
TS="$(date +%Y%m%d%H%M%S)"   # имя копии backend.prev-$TS — откату передаётся точно
TMP="$(mktemp -d)"
# версия приложения — последний коммит, менявший backend/pwa (выкладка без правок приложения не просит «Обновить»)
# n — номер версии: число коммитов, менявших приложение (растёт с каждым обновлением; показ «v1.n»)
PWA_N="$(git rev-list --count HEAD -- backend/pwa)"
PWA_VER="$(git log -1 --format='{"v":"%h","n":'"$PWA_N"',"date":"%cI"}' -- backend/pwa)"

if [[ $MODE == fast ]]; then
  echo "== 1. Бэкап: копия базы моложе суток — пропуск, иначе бэкап"
  "${SSH[@]}" 'cd /opt/data-core && if find /var/lib/datacore/backups -maxdepth 1 -name "mongo-*" -mmin -1440 2>/dev/null | grep -q .; then echo "свежая копия базы есть — без бэкапа"; elif bash deploy/synology/backup.sh >/tmp/dc-backup.log 2>&1; then tail -1 /tmp/dc-backup.log; else echo "СТОП: бэкап не прошёл:"; tail -5 /tmp/dc-backup.log; exit 1; fi'
  echo "== 2. Экраны: архив pwa+admin → обновление на месте в примонтированных папках (без сборки и перезапуска)"
  # sync-dir.sh едет в том же архиве (на VM нет rsync; своя копия скрипта — независимо от версии deploy/ на сервере)
  git -c core.autocrlf=false archive --format=tar.gz -o "$TMP/screens.tgz" --add-virtual-file="backend/pwa/version.json:$PWA_VER" HEAD backend/pwa backend/admin deploy/synology/sync-dir.sh
  scp -i "$KEY" -o BatchMode=yes "$TMP/screens.tgz" "$VM:/tmp/dc-screens.tgz"
  # папки обновляются на месте (их держит привязка контейнера); version.json — последним, чтобы приложение не закэшировало смесь
  "${SSH[@]}" "TS=$TS bash -s" <<'EOS'
set -e; R=/tmp/dc-scr-$TS; mkdir -p $R; tar -xzf /tmp/dc-screens.tgz -C $R; cd /opt/data-core
cp -a backend backend.prev-$TS
bash $R/deploy/synology/sync-dir.sh $R/backend/pwa backend/pwa --skip version.json
bash $R/deploy/synology/sync-dir.sh $R/backend/admin backend/admin
cp $R/backend/pwa/version.json backend/pwa/version.json
rm -rf $R /tmp/dc-screens.tgz; echo "экраны заменены, откат: deploy/synology/rollback.sh backend.prev-$TS --screens-only"
EOS
else
echo "== 1. Бэкап базы на VM"
"${SSH[@]}" 'cd /opt/data-core && if bash deploy/synology/backup.sh >/tmp/dc-backup.log 2>&1; then tail -1 /tmp/dc-backup.log; else echo "СТОП: бэкап не прошёл:"; tail -5 /tmp/dc-backup.log; exit 1; fi'

echo "== 2. Архив и замена файлов (старые → *.prev-<время>)"
git -c core.autocrlf=false archive --format=tar.gz -o "$TMP/release.tgz" --add-virtual-file="backend/pwa/version.json:$PWA_VER" HEAD backend docker-compose.prod.yml deploy
scp -i "$KEY" -o BatchMode=yes "$TMP/release.tgz" "$VM:/tmp/dc-release.tgz"
"${SSH[@]}" "TS=$TS bash -s" <<'EOS'
set -e; R=/tmp/dc-rel-$TS; mkdir -p $R; tar -xzf /tmp/dc-release.tgz -C $R
cp /opt/data-core/deploy/synology/.env $R/deploy/synology/.env 2>/dev/null || true
cd /opt/data-core; mv backend backend.prev-$TS; mv deploy deploy.prev-$TS; cp docker-compose.prod.yml docker-compose.prod.yml.prev-$TS
mv $R/backend backend; mv $R/deploy deploy; cp $R/docker-compose.prod.yml docker-compose.prod.yml; rm -rf $R; echo "заменено, откат: deploy/synology/rollback.sh backend.prev-$TS"
EOS

echo "== 3. Сборка и перезапуск backend (mongo не трогаем)"
"${SSH[@]}" 'cd /opt/data-core && N=$(docker inspect -f "{{.Config.Image}}" datacore-backend 2>/dev/null) && docker tag "$N" datacore-backend:prev; docker compose -f docker-compose.prod.yml build backend >/tmp/dc-build.log 2>&1 && tail -2 /tmp/dc-build.log && docker compose -f docker-compose.prod.yml up -d --no-deps backend'

# 2026-10-24: кэш сборки Docker копился с каждой выкладкой (42 ГБ) — держим не больше 10 ГБ (2026-10-30: по времени разрослось до 55 ГБ)
"${SSH[@]}" 'docker builder prune -f --max-used-space 10GB >/dev/null 2>&1; docker image prune -f >/dev/null 2>&1' || true
fi
# старые копии: по имени (в нём время выкладки), не по дате папки — mv/cp -a сохраняют старую mtime; держим 9 каждого вида
"${SSH[@]}" 'cd /opt/data-core && for k in backend.prev deploy.prev docker-compose.prod.yml.prev; do ls -1d $k-* 2>/dev/null | sort -r | tail -n +10 | xargs -r rm -rf; done' || true

echo "== 4. Проверка"
CHECK="$("${SSH[@]}" 'for i in $(seq 1 30); do s=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3001/api/health/ready); [ "$s" = 200 ] && break; sleep 3; done
  echo "data-core /api/health/ready: $s"; echo "/app/: $(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3001/app/)"; echo "/admin/: $(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3001/admin/)"
  echo "kppdf :3000: $(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3000/)"; docker ps --format "{{.Names}} {{.Status}}" | grep -E "datacore|kppdf"
  echo "место после выкладки: $(df -h /var/lib/datacore | tail -1)"
  # А2 (2026-10-26): смоук оболочки — каждый файл 200 и быстрее 3 с; иначе строка «СБОЙ»
  # холодный старт медленный: до трёх попыток с паузой, иначе ложный откат здорового релиза
  for try in 1 2 3; do bad=0; for u in /api/health /app/index.html /app/main.js /app/ui/base.css /app/ui/panels.css /app/version.json /admin/index.html; do
    r=$(curl -s -o /dev/null -w "%{http_code} %{time_total}" http://127.0.0.1:3001$u); c=${r% *}; t=${r#* }
    if [ "$c" != 200 ] || awk "BEGIN{exit !($t>3)}"; then [ "$try" = 3 ] && echo "СБОЙ $u: $r"; bad=1; fi; done
    [ $bad = 0 ] && break; sleep 5; done
  [ $bad = 0 ] && echo "смоук: 7 из 7 в норме" || echo "смоук: есть сбои — смотреть выше"' || true)"
echo "$CHECK"
# пустой ответ — оборвалась связь, а не проверка: откатывать вслепую нельзя
if [[ -z "$CHECK" ]]; then echo "СТОП: нет связи с VM при проверке. Новая версия запущена, проверьте вручную: bash remote-access/check.sh"; exit 1; fi
if ! grep -q 'ready: 200' <<<"$CHECK" || ! grep -q 'смоук: 7 из 7' <<<"$CHECK"; then
  echo "СТОП: проверка не прошла, возвращаю прошлую версию"
  if [[ $MODE == fast ]]; then RB="backend.prev-$TS --screens-only"; else RB="backend.prev-$TS"; fi
  "${SSH[@]}" "cd /opt/data-core && bash deploy/synology/rollback.sh $RB" || echo "ОТКАТ НЕ ПРОШЁЛ: чинить вручную, логи — docker logs datacore-backend"
  exit 1
fi
# проверка прошла — запомнить версию сервера (следующая выкладка сравнит с ней)
"${SSH[@]}" "echo $(git rev-parse HEAD) > /opt/data-core/.release-commit"

if [[ $DATA == 1 ]]; then
  echo "== 5. Данные (в контейнере datacore-backend, его MONGO_URI)"
  "${SSH[@]}" 'mkdir -p /tmp/dc-scripts /tmp/dc-orders'
  scp -i "$KEY" -o BatchMode=yes backend/scripts/import-orders-xlsx.js backend/scripts/add-our-company.js "$VM:/tmp/dc-scripts/"
  scp -i "$KEY" -o BatchMode=yes "$ORDERS_DIR"/*.xlsx "$VM:/tmp/dc-orders/"
  "${SSH[@]}" 'set -e; docker exec datacore-backend mkdir -p /app/scripts /tmp/orders
    docker cp /tmp/dc-scripts/. datacore-backend:/app/scripts/; docker cp /tmp/dc-orders/. datacore-backend:/tmp/orders/
    echo "-- наша компания «Спортсет» и её заказы"; docker exec -w /app datacore-backend node scripts/add-our-company.js --name Спортсет --key СПОРТСЕТ --apply | tail -3
    echo "-- заказы из Excel (+фото)"; docker exec -w /app datacore-backend node scripts/import-orders-xlsx.js /tmp/orders --photos --apply | tail -6
    docker exec datacore-backend rm -rf /tmp/orders; rm -rf /tmp/dc-orders /tmp/dc-scripts'
fi

if [[ $DROP == 1 ]]; then
  echo "== 6. Архивные таблицы: выгрузка в файлы и удаление"
  scp -i "$KEY" -o BatchMode=yes backend/scripts/drop-archive-collections.js "$VM:/tmp/drop-archive-collections.js"
  "${SSH[@]}" 'set -e; D=/var/lib/datacore/backups/archive-$(date +%Y-%m-%d); docker exec datacore-backend mkdir -p /app/scripts
    docker cp /tmp/drop-archive-collections.js datacore-backend:/app/scripts/
    docker exec -w /app -e OUT_DIR=/tmp/archive-export datacore-backend node scripts/drop-archive-collections.js --apply
    mkdir -p $D; docker cp datacore-backend:/tmp/archive-export/. $D/; docker exec datacore-backend rm -rf /tmp/archive-export; ls -la $D | tail -6; rm -f /tmp/drop-archive-collections.js'
fi
echo "== 7. История проекта (импорт в devlog; сбой не валит выкладку)"
node backend/scripts/devlog-import.js prod --apply 2>&1 | tail -15 || echo "импорт истории не прошёл — выкладка не затронута"

echo "== Готово. Публично: https://kppdf-crm.ru/db/app/"
# пользователь сверяет с меню приложения («v1.N») — то ли он видит (просьба 2026-10-25)
echo "== Версия приложения: v1.$PWA_N (коммит $(git log -1 --format=%h -- backend/pwa)), сервер — $(git log --oneline -1 | cut -c1-60)"
