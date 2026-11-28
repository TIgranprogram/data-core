import { api, session } from '../core/api.js';

export const unmatchedCount = () => (session.sees('matching') ? api('/matching/unmatched/count').catch(() => ({ total: 0, inProduction: 0 })) : Promise.resolve({ total: 0, inProduction: 0 }));
