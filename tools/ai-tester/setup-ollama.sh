#!/usr/bin/env bash
# Локальный ИИ на Ubuntu — Ollama (служба, без окна) вместо LM Studio (2026-11-15, ноутбук RTX 4060 8 ГБ).
#   bash tools/ai-tester/setup-ollama.sh            — поставить и настроить (пароль sudo спросит один раз)
#   bash tools/ai-tester/setup-ollama.sh --check    — только проверить
# Что делает: Ollama с ollama.com → служба: память модели 16 тыс. токенов, модель держится в памяти 1 ч,
# только 127.0.0.1 → модель по видеокарте → настройки ИИ-тестировщика и «Excel заказа» → пробный ответ.
# Модель: 8–11 ГБ видеопамяти — gemma4:e4b-it-qat (6,1 ГБ, видит картинки, умеет вызывать инструменты);
# 12 ГБ и больше — gemma4:12b-it-qat (7,2 ГБ). На Windows-ПК остаётся LM Studio (setup.mjs).
set -u
cd "$(dirname "$0")/../.."
ROOT="$(pwd)"
CHECK=0; [ "${1:-}" = "--check" ] && CHECK=1
FAIL=0
ok()  { printf '  \033[32m[ok]\033[0m %s\n' "$1"; }
bad() { printf '  \033[31m[!!]\033[0m %s\n' "$1"; FAIL=1; }
CTX=16384
BASE="http://localhost:11434"

VRAM=$(nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits 2>/dev/null | sort -n | tail -1)
VRAM=${VRAM:-0}
if [ "$VRAM" -ge 11000 ]; then MODEL="gemma4:12b-it-qat"; else MODEL="gemma4:e4b-it-qat"; fi
echo "Видеокарта: ${VRAM} МБ → модель $MODEL"

echo; echo "1. Ollama"
if command -v ollama >/dev/null 2>&1; then ok "$(ollama --version 2>/dev/null | tail -1)"
elif [ $CHECK = 1 ]; then bad "Ollama не установлена"
else
  echo "  Нужен пароль от входа в Ubuntu (символы не видны — так и должно быть)."
  sudo -v || exit 1
  curl -fsSL https://ollama.com/install.sh | sh && ok "Ollama установлена" || { bad "Ollama не установилась"; exit 1; }
fi

echo; echo "2. Служба: память $CTX токенов, модель в памяти 1 ч, только этот компьютер"
OVR=/etc/systemd/system/ollama.service.d/datacore.conf
WANT="[Service]
Environment=\"OLLAMA_CONTEXT_LENGTH=$CTX\"
Environment=\"OLLAMA_KEEP_ALIVE=1h\"
Environment=\"OLLAMA_FLASH_ATTENTION=1\"
Environment=\"OLLAMA_HOST=127.0.0.1:11434\""
if [ "$(cat "$OVR" 2>/dev/null)" = "$WANT" ]; then ok "настройки службы на месте"
elif [ $CHECK = 1 ]; then bad "нет настроек службы ($OVR)"
else
  sudo -v || exit 1
  sudo mkdir -p "$(dirname "$OVR")" && printf '%s\n' "$WANT" | sudo tee "$OVR" >/dev/null \
    && sudo systemctl daemon-reload && sudo systemctl enable --now ollama >/dev/null 2>&1 && sudo systemctl restart ollama \
    && ok "служба настроена и перезапущена" || bad "служба не настроилась"
fi
for i in $(seq 1 20); do curl -fs "$BASE/api/version" >/dev/null 2>&1 && break; sleep 1; done
curl -fs "$BASE/api/version" >/dev/null 2>&1 && ok "сервер отвечает: $BASE" || bad "сервер не отвечает: $BASE"

echo; echo "3. Модель $MODEL"
if ollama list 2>/dev/null | awk '{print $1}' | grep -qx "$MODEL"; then ok "скачана"
elif [ $CHECK = 1 ]; then bad "модель не скачана"
else echo "  Скачиваю (~6 ГБ, 5–30 минут)…"; ollama pull "$MODEL" && ok "скачана" || bad "не скачалась"; fi

echo; echo "4. Настройки тестировщика и «Excel заказа»"
if [ $CHECK = 0 ]; then
  node -e '
    const fs = require("fs"); const [root, base, model] = process.argv.slice(1);
    for (const dir of ["tools/ai-tester", "tools/local-ai-order"]) {
      const f = `${root}/${dir}/settings.json`, ex = `${root}/${dir}/settings.example.json`;
      if (!fs.existsSync(ex) && !fs.existsSync(f)) continue;
      const cur = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : JSON.parse(fs.readFileSync(ex, "utf8"));
      fs.writeFileSync(f, JSON.stringify({ ...cur, baseUrl: base + "/v1", apiKey: "ollama", model }, null, 2) + "\n");
    }' "$ROOT" "$BASE" "$MODEL"
fi
grep -q "\"model\": \"$MODEL\"" tools/ai-tester/settings.json 2>/dev/null && ok "ИИ-тестировщик смотрит на $MODEL" || bad "tools/ai-tester/settings.json не указывает на $MODEL"

echo; echo "5. Пробный ответ и видеокарта"
if [ $FAIL = 0 ]; then
  T0=$(date +%s)
  R=$(curl -fs "$BASE/v1/chat/completions" -H 'Content-Type: application/json' \
    -d "{\"model\":\"$MODEL\",\"messages\":[{\"role\":\"user\",\"content\":\"Ответь одним словом: столица России?\"}],\"max_tokens\":20}" 2>/dev/null)
  echo "$R" | grep -q '"content"' && ok "ответ за $(( $(date +%s) - T0 )) с" || bad "модель не ответила"
  ollama ps 2>/dev/null | tail -n +2 | awk '{ $1=$1; print "  в памяти: " $0 }'
  ollama ps 2>/dev/null | grep -q "100% GPU" && ok "модель целиком в видеокарте" || echo "  ⚠ модель не целиком в видеокарте — будет медленнее"
fi

echo
[ $FAIL = 0 ] && echo "ГОТОВО: локальный ИИ работает ($MODEL, $BASE)." || echo "ЕСТЬ ПУНКТЫ [!!] — исправьте и запустите снова: bash tools/ai-tester/setup-ollama.sh"
exit $FAIL
