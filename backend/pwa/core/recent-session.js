import { session, PREFIX } from './api.js';
import { createRecentCards } from './recent-cards.js';

export const recentUserKey = () => String(session.user?.id || session.user?._id || '');

export function recentStore() {
  try {
    const id = recentUserKey();
    return id ? createRecentCards(localStorage, 'dc-recent-cards:' + PREFIX + ':' + id) : null;
  } catch { return null; }
}
