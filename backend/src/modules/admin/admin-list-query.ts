export interface AdminListQuery {
  page: number;
  limit: number;
  search?: string;
  role?: string;
  offset?: number;
}

export interface AdminListResponse<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
}

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

function positiveInteger(raw: string | undefined, fallback: number): number {
  if (raw === undefined || !/^\d+$/.test(raw)) return fallback;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function nonNegativeInteger(raw: string | undefined): number | undefined {
  if (raw === undefined || !/^\d+$/.test(raw)) return undefined;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

export function normalizeAdminListQuery(input: {
  page?: string;
  limit?: string;
  offset?: string;
  search?: string;
  role?: string;
}): AdminListQuery {
  const limit = Math.min(MAX_LIMIT, positiveInteger(input.limit, DEFAULT_LIMIT));
  const explicitPage = positiveInteger(input.page, DEFAULT_PAGE);
  const offset = nonNegativeInteger(input.offset);
  const page = input.page === undefined && offset !== undefined
    ? Math.floor(offset / limit) + 1
    : explicitPage;
  const search = input.search?.trim();
  const role = input.role?.trim();

  return {
    page,
    limit,
    ...(search ? { search } : {}),
    ...(role ? { role } : {}),
    ...(offset !== undefined ? { offset } : {}),
  };
}

export function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
