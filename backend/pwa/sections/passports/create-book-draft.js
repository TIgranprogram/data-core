import { api } from '../../core/api.js';
import { field, hint, modal, select, stack } from '../../ui/kit/index.js';
import { firmFor, ourCompanies, rememberFirm } from './common.js';

/** C149: сервер определяет известную фирму; неоднозначный выбор остаётся за менеджером. */
export async function createBookDraft(body, isCurrent = () => true) {
  if (!isCurrent()) return null;
  try {
    return await api('/passports', { method: 'POST', body });
  } catch (error) {
    if (error.status !== 400 || error.message !== 'Выберите фирму' || body.supplierOrgId) throw error;
    if (!isCurrent()) return null;
    const firms = await ourCompanies();
    const suggestion = await firmFor(body.salesOrderId);
    if (!isCurrent()) return null;
    if (!firms.length) throw error;
    const choice = select({
      label: 'Наша фирма', value: suggestion.id,
      options: [['', 'Выберите фирму'], ...firms.map((f) => [String(f.id), f.name || 'Фирма'])],
    });
    const id = await modal({
      title: 'От какой фирмы создать паспорт?', okText: 'Открыть паспорт',
      body: stack(hint('Реквизиты, печать и подпись в паспорте будут от выбранной фирмы.'),
        field('Наша фирма', choice, { required: true })),
      onOk: () => {
        if (!firms.some((f) => String(f.id) === choice.value)) throw new Error('Выберите фирму');
        return choice.value;
      },
    });
    if (!id || !isCurrent()) return null;
    const row = await api('/passports', { method: 'POST', body: { ...body, supplierOrgId: id } });
    rememberFirm(id);
    return row;
  }
}
