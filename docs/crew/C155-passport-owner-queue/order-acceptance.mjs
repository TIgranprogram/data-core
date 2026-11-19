// Только запуск через api.sh stand BROWSER с проверенным acceptance.test.mjs.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(import.meta.url);
const fromLogs = path.basename(path.dirname(script)) === 'logs';
const guard = fromLogs ? '../../docs/crew/C155-passport-owner-queue/acceptance.test.mjs' : './acceptance.test.mjs';
const { runOrderAcceptance } = await import(guard);
const orderId = process.env.C155_ORDER_ID;
const writeIncome = process.env.C155_ORDER_INCOME_ID;
const allowIssue = process.env.C155_ORDER_ISSUE === '1';
const planPath = (id) => '/api/passports/order/' + id + '/plan?presentationVersion=1&variant=short';
const statusFields = (p) => p && [p.id, p.status, p.number, p.presentationVersion, p.variant];
const markOf = (p) => p.number ? 'Паспорт № ' + p.number : 'Паспорт — черновик';

await runOrderAcceptance(async ({
  app, page, book, button, read, authFetch, listen, json, closeBook, screenshot,
  check, at, expect, need, objectId, exactBody, grant, cardPath, numberOf, statusOf,
}) => {
  await check('order-position', async (result) => {
    expect((!orderId || objectId(orderId)) && (!writeIncome || objectId(writeIncome))
      && (!allowIssue || (orderId && writeIncome)), 'Для выпуска нужны точные id договора и позиции.');
    const products = await read('/api/showcase?search=1066&limit=30');
    const product = products.items.find((item) => String(item.sku).trim() === '1066');
    need(objectId(product?.id), 'Изделие 1066 недоступно на стенде.');
    const contracts = orderId ? [await read('/api/salesorders/' + orderId)]
      : (await read('/api/salesorders?productId=' + product.id + '&limit=10')).items;
    const keys = [...new Set(contracts.map((item) => item.productionNo || item.id))];
    const candidates = [];
    for (const key of keys) {
      const production = await read('/api/production-orders/' + encodeURIComponent(key));
      for (const contract of production.orders || []) {
        if (orderId && contract.id !== orderId) continue;
        const rows = contract.lines || [];
        const matching = rows.filter((line) => line.productId === product.id && !line.cancelledAt);
        if (matching.length < 2) continue;
        const plan = await read(planPath(contract.id));
        const lines = plan.lines.filter((line) => matching.some((row) => row.id === line.incomeId));
        if (objectId(plan.firm?.id) && lines.length >= 2) candidates.push({ key, plan, lines, rows, grouped: production.orders.length > 1 });
      }
    }
    result.inspectedProductionOrders = keys.length;
    result.candidates = candidates.map(({ plan, lines }) => ({
      orderId: plan.orderId,
      lines: lines.map((line) => ({ incomeId: line.incomeId, state: line.state, passport: statusFields(line.passport) })),
    }));
    const fixture = candidates.find(({ lines }) => writeIncome
      ? lines.some((line) => line.incomeId === writeIncome && line.state === 'ready' && !line.passport)
      : lines.some((line) => line.state === 'ready' || line.passport));
    need(fixture, 'На копии не найдены две подходящие позиции 1066 одного договора с сохранённой фирмой.');
    const { key, plan, lines, rows, grouped } = fixture;
    const targetLine = lines.find((line) => writeIncome ? line.incomeId === writeIncome : line.state === 'ready' && !line.passport)
      || lines.find((line) => line.passport);
    const peer = lines.find((line) => line !== targetLine && line.passport) || lines.find((line) => line !== targetLine);
    const context = (line) => ({ incomeId: line.incomeId, salesOrderId: plan.orderId, productId: product.id });
    const belongs = (passport, line) => Object.entries(context(line)).every(([field, value]) => passport[field] === value);
    const before = (await read('/api/passports?salesOrderId=' + plan.orderId + '&limit=200')).items;
    result.contexts = [{ ...context(targetLine), passport: targetLine.passport?.id ?? null },
      { ...context(peer), passport: peer.passport?.id ?? null }];
    result.savedFirm = true;
    await page.goto(app + '#salesorders?tab=pos&open=' + encodeURIComponent(key));

    async function openLine(line) {
      const source = rows.find((row) => row.id === line.incomeId);
      expect(source, 'Позиция плана отсутствует в карточке заказа.');
      const ordinal = source.seqNo ?? source.lineNo ?? rows.indexOf(source) + 1;
      const block = grouped
        ? page.locator('.k-pos-block').filter({ hasText: 'Договор ' + plan.orderNo })
        : page;
      const row = block.locator('.k-pos-table tbody tr[tabindex="0"]').filter({
        has: page.locator('td.muted').getByText(String(ordinal), { exact: true }),
      }).filter({ hasText: source.title });
      await row.first().waitFor();
      expect(await row.count() === 1, 'Карточка заказа не даёт однозначно найти строку по номеру и названию.');
      await row.press('Enter');
      const documents = page.locator('.k-pos-table tr.k-pos-more article.tcard').filter({ has: page.getByText('Документы', { exact: true }) });
      await documents.waitFor();
      return documents;
    }

    for (const line of [peer, targetLine]) {
      const documents = await at(result, 'Открыть «Документы» позиции', () => openLine(line));
      if (line.passport) {
        const opened = listen('GET', cardPath(line.passport.id), { readOnly: '1' });
        await button(documents, markOf(line.passport)).click();
        const item = await json(opened, 'Чтение паспорта позиции');
        expect(item.id === line.passport.id && belongs(item, line), 'Открыт паспорт другой позиции, договора или изделия.');
        await book.waitFor();
        if (item.presentationVersion !== 1) {
          await book.getByText('Старый образец', { exact: true }).waitFor();
          expect(!await book.locator('.bk-edit').count() && !await button(book, 'Выпустить').count(), 'Для legacy доступно изменение или выпуск.');
        }
        await closeBook();
        continue;
      }
      const create = button(documents, 'Создать черновик паспорта');
      await create.waitFor();
      if (!allowIssue || line.incomeId !== writeIncome) continue;
      expect(line.state === 'ready' && !before.some((item) => item.incomeId === line.incomeId && statusOf(item) !== 'annulled'),
        'У выбранной строки уже есть живой паспорт или выпуск заблокирован.');
      const createBody = { ...context(line), presentationVersion: 1, variant: 'short' };
      const issueBody = { presentationVersion: 1, variant: 'short' };
      grant('POST', '/api/passports', (body) => exactBody(body, createBody));
      const createdResponse = listen('POST', '/api/passports');
      await at(result, 'Создать черновик только выбранной позиции', () => create.click());
      const created = await json(createdResponse, 'Создание паспорта позиции');
      expect(objectId(created.id) && belongs(created, line) && created.supplierOrgId === plan.firm.id
        && created.presentationVersion === 1 && created.variant === 'short' && statusOf(created) === 'draft' && !numberOf(created),
      'Создан не тот черновик, не на фирму договора или с преждевременным номером.');
      const target = cardPath(created.id) + '/issue';
      grant('POST', target, (body) => exactBody(body, issueBody), 2);
      await button(book, 'Выпустить').click();
      const issuing = listen('POST', target);
      const confirm = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Выпустить паспорт?', exact: true }) });
      await at(result, 'Подтвердить выпуск паспорта позиции', () => button(confirm, 'Выпустить').click());
      const issued = await json(issuing, 'Выпуск паспорта позиции');
      expect(issued.id === created.id && numberOf(issued) && statusOf(issued) === 'issued', 'Номер присвоен не той записи.');
      const again = await authFetch(target, issueBody);
      expect(again.status === 200 && again.data?.id === created.id && numberOf(again.data) === numberOf(issued), 'Повтор выдачи вернул другой id или номер.');
      const saved = await read(cardPath(created.id) + '?readOnly=1');
      expect(belongs(saved, line) && saved.supplierOrgId === plan.firm.id, 'После выпуска изменились позиция или фирма договора.');
      result.issued = { id: created.id, number: numberOf(issued), ...context(line), repeatStatus: again.status };
      await book.getByText('выпущен', { exact: true }).waitFor();
      await screenshot('order-context', book.locator('.bk-head'), '.bk-head h2 { color: transparent !important; } .bk-head h2 .badge { color: var(--text) !important; }');
      await closeBook();
    }
    const after = await read(planPath(plan.orderId));
    const peerAfter = after.lines.find((line) => line.incomeId === peer.incomeId);
    expect(peerAfter && JSON.stringify(statusFields(peerAfter.passport)) === JSON.stringify(statusFields(peer.passport)),
      'Вторая позиция того же изделия изменилась.');
    if (!result.issued) need(!allowIssue && lines.some((line) => line.passport), 'Обе позиции свободны, выпуск этой фазой не разрешён.');
    if (result.issued) expect(after.lines.find((line) => line.incomeId === writeIncome)?.passport?.id === result.issued.id,
      'План не показывает выданный экземпляр выбранной строки.');
    result.peerUnchanged = true;
    if (peer.passport || peer.state !== 'ready') return;
    await page.goto(app + '#docs?tab=orders&of=orderpass&open=' + plan.orderId);
    const lineTitle = page.locator('.form-sec-t').filter({ hasText: new RegExp('^' + Number(peer.lineNo) + ' · ') });
    const row = page.locator('details.k-sec-plain').filter({ has: lineTitle });
    const templatePath = '/api/showcase/' + product.id + '/passport-template';
    const opening = listen('GET', templatePath, { variant: 'short' });
    await at(result, 'Открыть шаблон второй позиции из плана', () => button(row, 'Править шаблон').click());
    const template = await json(opening, 'Чтение шаблона позиции');
    expect(template.productId === product.id && template.mode === 'template' && !template.document?.id,
      'Для соседней строки не открылся шаблон того же изделия.');
    await book.locator('.bk-sku span').filter({ hasText: 'поз. ' + peer.lineNo }).waitFor();
    result.peerTemplate = true;
    await closeBook();
  });
}, script);
