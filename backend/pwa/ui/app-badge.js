/**
 * Число на значке приложения (панель задач Windows, Dock). Работает в установленном PWA (Chrome/Edge);
 * в обычной вкладке и старых браузерах API нет — тихо ничего не делаем. Сумма: непрочитанные сообщения + важные уведомления.
 */
const parts = { chat: 0, bell: 0 };
export function setBadgePart(name, n) {
  parts[name] = Number(n) || 0;
  const sum = parts.chat + parts.bell;
  try {
    if (sum > 0 && navigator.setAppBadge) navigator.setAppBadge(sum).catch(() => {});
    else if (navigator.clearAppBadge) navigator.clearAppBadge().catch(() => {});
  } catch { /* не поддерживается */ }
}
