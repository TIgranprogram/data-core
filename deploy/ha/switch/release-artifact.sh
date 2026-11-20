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
    [[ ! -f "$gate/watch-held" ]] || return 0
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
