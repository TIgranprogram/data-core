import { normalizeAdminListQuery } from './admin-list-query';

describe('normalizeAdminListQuery (TZ-278)', () => {
  it('uses safe defaults when query parameters are missing or invalid', () => {
    expect(normalizeAdminListQuery({})).toEqual({ page: 1, limit: 50 });
    expect(normalizeAdminListQuery({ page: '0', limit: '-5' })).toEqual({ page: 1, limit: 50 });
    expect(normalizeAdminListQuery({ page: 'abc', limit: 'NaN' })).toEqual({ page: 1, limit: 50 });
  });

  it('clamps limit to the admin maximum and preserves valid page', () => {
    expect(normalizeAdminListQuery({ page: '3', limit: '9999' })).toEqual({
      page: 3,
      limit: 200,
    });
  });

  it('maps legacy offset to the equivalent page and preserves exact offset', () => {
    expect(normalizeAdminListQuery({ offset: '10', limit: '5' })).toEqual({
      page: 3,
      limit: 5,
      offset: 10,
    });
  });

  it('trims and omits blank optional filters', () => {
    expect(normalizeAdminListQuery({ search: '  alice  ', role: '  admin  ' })).toEqual({
      page: 1,
      limit: 50,
      search: 'alice',
      role: 'admin',
    });
    expect(normalizeAdminListQuery({ search: '   ', role: '   ' })).toEqual({
      page: 1,
      limit: 50,
    });
  });
});
