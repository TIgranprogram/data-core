import type { Connection } from 'mongoose';
import { Types } from 'mongoose';
import { openSectionsFor, sectionOpen } from '../../common/app-sections';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { canSeePayroll } from '../../common/roles-hierarchy';
import type { StockScope } from '../../common/stock-scope';
import { docScopeMatch } from '../../common/supply-scope';
import { sharedFind } from '../../common/shared-collections';
import type { Op } from './cashflow';

export function financeVisibility(actor?: AuthenticatedUser) {
  const open = openSectionsFor(actor);
  return {
    supply: sectionOpen(open, 'requests'),
    income: ['orders', 'salesorders'].some((section) => sectionOpen(open, section)),
    expense: sectionOpen(open, 'money'),
    payroll: sectionOpen(open, 'payroll') && (!actor || canSeePayroll(actor)),
  };
}

type FinanceVisibility = ReturnType<typeof financeVisibility>;
export const supplyFact = (op: Op) => op.source === 'invoice' || op.source === 'request';
export function canReadFact(op: Op, access: FinanceVisibility) {
  return supplyFact(op) ? access.supply : op.source === 'income' || op.source === 'payroll' ? access[op.source] : access.expense;
}

export function excludedFinanceSources(access: FinanceVisibility) {
  return [
    { source: 'invoice', visible: access.supply }, { source: 'request', visible: access.supply },
    { source: 'income', visible: access.income }, { source: 'payroll', visible: access.payroll },
  ].filter((item) => !item.visible).map(({ source }) => ({ source, reason: 'Недоступен исходный раздел или его денежные права' }));
}

export async function visibleFinanceRequests(connection: Connection, scope: StockScope | null, ids: string[]) {
  if (!scope) return null;
  const objectIds = [...new Set(ids)].filter((id) => Types.ObjectId.isValid(id)).map((id) => new Types.ObjectId(id));
  const docs = objectIds.length ? await sharedFind(connection.db!.collection('supplyrequests'), 'supplyrequests',
    { _id: { $in: objectIds }, deletedAt: null, ...await docScopeMatch(connection, scope) },
    { projection: { _id: 1 } },
  ).toArray() : [];
  return new Set(docs.map((r) => String(r._id)));
}
