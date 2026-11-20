#!/usr/bin/env bash
# Служебные функции штатного выпуска и моста. Архив может создать только release.sh.
release_digest() { sha256sum "$1" | cut -d ' ' -f1; }

publish_artifact() (
  set -euo pipefail
  local dc="$1" archive="$2" commit="$3" hash="$4" version="$5"
  [[ "$commit" =~ ^[a-f0-9]{40}$ && "$hash" =~ ^[a-f0-9]{64}$ && "$version" =~ ^[a-f0-9]{4,40}$ ]] || exit 1
  [[ "$(release_digest "$archive")" == "$hash" ]] || exit 1
  local catalog="$dc/.ha-releases" tmp final
  mkdir -p "$catalog" || exit 1
  final="$catalog/$commit"
  if [[ -e "$final" ]]; then
    [[ "$(cat "$final/manifest")" == "$commit $hash $version" ]] || exit 1
    [[ "$(release_digest "$final/release.tgz")" == "$hash" ]] || exit 1
  else
    tmp="$(mktemp -d "$catalog/.publish-XXXXXXXX")" || exit 1
    trap 'rm -rf -- "$tmp"' EXIT
    cp -- "$archive" "$tmp/release.tgz" || exit 1
    [[ "$(release_digest "$tmp/release.tgz")" == "$hash" ]] || exit 1
    printf '%s %s %s\n' "$commit" "$hash" "$version" > "$tmp/manifest" || exit 1
    chmod 444 "$tmp/manifest" "$tmp/release.tgz" || exit 1
    mv -T "$tmp" "$final" || exit 1
  fi
  printf '%s\n' "$commit" > "$dc/.release-commit.tmp" && mv -f "$dc/.release-commit.tmp" "$dc/.release-commit"

)

# Под общей блокировкой хоста. Оставляем текущий, три последних и версии доступных откатов.
rotate_artifacts() (
  local dc="$1" current path commit old meta
  current="$(cat "$dc/.release-commit")" || exit 1
  while read -r path; do
    commit="${path##*/}"
    [[ "$commit" =~ ^[0-9a-f]{40}$ && "$commit" != "$current" ]] || continue
    for old in "$dc"/backend.prev-*; do
      [[ -d "$old" ]] || continue
      meta="$dc/.rollback-${old##*prev-}"
      if [[ -f "$meta" ]] && grep -Fqx "release=$commit" "$meta"; then continue 2; fi
    done
    rm -f -- "$path/manifest" "$path/release.tgz" && rmdir -- "$path"
  done < <(find "$dc/.ha-releases" -mindepth 1 -maxdepth 1 -type d -printf '%T@ %p\n' | sort -rn | tail -n +4 | cut -d ' ' -f2-)
)

owns_switch_cron() {
  local watcher='(^|[[:blank:]])(/(usr/)?bin/)?bash[[:blank:]]+/opt/data-core/deploy/ha/switch/switch-watch\.sh([[:blank:]]|$)'
  crontab -l 2>/dev/null | awk '!/^[[:blank:]]*#/' | grep -E "$watcher" >/dev/null
}

# На Linux только владелец sticky-каталога, владелец файла или root может снять заявку.
# UID и первичная группа берутся на хосте в контексте пользователя, которому ставится cron.
switch_queue_dir() (
  local dir="$1" action="$2" owner actual
  [[ "$action" == setup || "$action" == repair || "$action" == check ]] || exit 1
  owner="$(id -u):$(id -g)"
  [[ "$owner" =~ ^[0-9]+:[0-9]+$ && ! -L "$dir" ]] || exit 1
  if [[ "$action" == setup && ! -e "$dir" ]]; then
    mkdir -m 1777 -- "$dir" 2>/dev/null ||
      sudo -n install -d -m 1777 -o "${owner%:*}" -g "${owner#*:}" -- "$dir" || exit 1
  fi
  [[ -d "$dir" ]] || { echo "Нет каталога заявок $dir" >&2; exit 1; }
  if [[ "$action" == setup ]]; then
    if [[ -e "$dir/alive" && "$(stat -c %u -- "$dir/alive")" != "${owner%:*}" ]] && ! owns_switch_cron; then
      echo "Уже работающий мост следует настраивать от владельца его crontab." >&2; exit 1
    fi
    [[ ! -L "$dir/.lock" ]] || exit 1
    # Docker мог впервые создать bind-каталог root:root 0755 до установки cron и его .lock.
    if [[ ! -e "$dir/.lock" && ! -w "$dir" ]]; then switch_queue_dir "$dir" repair || exit 1; fi
    if [[ -f "$dir/.lock" ]]; then exec 9<"$dir/.lock" || exit 1; else exec 9>>"$dir/.lock" || exit 1; fi
    flock -n 9 || { echo "Мост выполняет работу. Настройка каталога отложена." >&2; exit 1; }
  fi
  actual="$(stat -c '%u:%g:%a' -- "$dir")" || exit 1
  [[ "$actual" != "$owner:1777" ]] || exit 0
  if [[ "$action" == check ]]; then
    echo "Каталог заявок $dir имеет $actual. Для пользователя cron требуется $owner:1777." >&2
    exit 1
  fi
  if [[ "${actual%:*}" != "$owner" ]]; then
    if [[ "$EUID" == 0 || "${actual%%:*}" == "${owner%:*}" ]]; then
      chown -h -- "$owner" "$dir" || exit 1
    else
      sudo -n chown -h -- "$owner" "$dir" || {
        echo "Нужны права администратора для смены владельца каталога $dir на $owner." >&2; exit 1;
      }
    fi
  fi
  chmod 1777 -- "$dir" && [[ "$(stat -c '%u:%g:%a' -- "$dir")" == "$owner:1777" ]]
)

# При обновлении роль учётной записи подтверждает активная запись в её crontab.
# Другому пользователю выпуска каталог не переназначается.
check_upgrade_queue() {
  if owns_switch_cron; then switch_queue_dir "$1" check; fi
}

# Маркер на диске остаётся при SIGKILL/потере связи. До проверки незаконченной операции
# никакой второй процесс не начинает выкладку или восстановление на этом хосте.
take_operation_lock() {
  mkdir "$1/.ha-operation" 2>/dev/null || { echo 'Сервер занят выкладкой или переключением.' >&2; return 1; }
  printf '%s\n' "$2" > "$1/.ha-operation/owner"
}
# Совместимо с мостом до C166. Фоновый процесс держит штатный flock старого cron,
# пока файл владельца принадлежит этой операции. После потери управляющего SSH
# блокировка сохраняется вместе с записью незакончившегося выпуска.
hold_watch_lock() {
  local gate="$1/.ha-operation" switch_dir="$2" owner="$3" i
  [[ -d "$switch_dir" && "$(cat "$gate/owner")" == "$owner" ]] || return 1
  nohup bash -c '
    gate=$1; switch_dir=$2; expected=$3
    exec 9>"$switch_dir/.lock" || exit 1
    flock -n 9 || { touch "$gate/watch-busy"; exit 1; }
    trap '\''rm -f "$gate/watch-held"'\'' EXIT
    touch "$gate/watch-held" || exit 1
    while [[ "$(cat "$gate/owner" 2>/dev/null)" == "$expected" ]]; do /bin/sleep 1; done
  ' hold-watch "$gate" "$switch_dir" "$owner" </dev/null >/dev/null 2>&1 &
  local keeper=$!
  for i in {1..50}; do
    if [[ -f "$gate/watch-held" ]]; then check_upgrade_queue "$switch_dir"; return $?; fi
    [[ ! -f "$gate/watch-busy" ]] && kill -0 "$keeper" 2>/dev/null || return 1
    /bin/sleep 0.1
  done
  return 1
}
release_operation_lock() {
  local gate="$1/.ha-operation" owner="$2" i
  [[ "$(cat "$gate/owner" 2>/dev/null)" == "$owner" ]] || return 1
  rm -f "$gate/owner" || return 1
  for i in {1..50}; do
    [[ -e "$gate/watch-held" ]] || break
    /bin/sleep 0.1
  done
  rm -f "$gate/watch-busy" "$gate/switch-ready"
  rmdir "$gate"
}
