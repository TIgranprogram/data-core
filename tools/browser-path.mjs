// Где браузер для проверок (Playwright, обходы): одна копия правила для Windows и Linux.
// Порядок: DESIGN_BROWSER → EDGE (их пишет tools/setup-ubuntu.sh) → Edge/Chrome Windows → Chrome/Chromium Linux.
import fs from 'node:fs';

const CANDIDATES = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/microsoft-edge',
];

/** Путь к браузеру или undefined, если на ПК его нет. */
export function findBrowser(env = process.env, exists = fs.existsSync) {
  return [env.DESIGN_BROWSER, env.EDGE, ...CANDIDATES].filter(Boolean).find((p) => exists(p));
}
