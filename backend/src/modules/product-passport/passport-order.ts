import { ConflictException, NotFoundException } from '@nestjs/common';
import { Types, type Connection } from 'mongoose';
import { passportCategoryFor, type PpCat } from '../../common/passport/form-values';
import { resolveKinds } from '../../common/passport/kind';
import { isIssued } from './passport-consts';

type Doc = Record<string, unknown>;
type Db = NonNullable<Connection['db']>;

/** Что плану и выпуску по заказу нужно от сервиса паспортов. */
export interface OrderHost {
  db: () => Db;
  /** Чего не хватает у изделия (шаблон): список подписей. */
  templateMissing: (productId: string, variant?: string) => Promise<string[]>;
  /** Черновик на позицию. `supplierOrgId` — выбранная фирма, если в заказе её ещё нет. */
  createDraft: (incomeId: string, title?: string, supplierOrgId?: string) => Promise<{ id: string }>;
  /** Дописать фирму в черновик без поставщика (выпуск пачки, когда в заказе фирмы нет). */
  setSupplier?: (passportId: string, supplierOrgId: string) => Promise<void>;
  /** Есть ли «наша фирма» — поставщик новых паспортов по умолчанию. */
  hasOurSupplier: () => Promise<boolean>;
  issue: (id: string) => Promise<unknown>;
  discard: (id: string) => Promise<void>;
}

export interface OrderFirm { id: string; name: string; hasSeal: boolean; hasSignature: boolean }

export interface PlanLine {
  incomeId: string;
  lineNo: number | null;
  title: string;
  productId: string | null;
  productName: string | null;
  /** артикул изделия (sku) */
  article: string | null;
  /** тип паспорта изделия (название): свой или от группы каталога; null — не задан */
  categoryName: string | null;
  qty: number | null;
  passport: { id: string; number: string | null; status: 'draft' | 'issued' } | null;
  /** issued — уже выпущен; ready — можно выпускать; blocked — чего-то не хватает */
  state: 'issued' | 'ready' | 'blocked';
  missing: string[];
}

export interface SkipLine { incomeId: string; title: string; reason: string }

const MAX_MISSING = 5;
const CHECK_PARALLEL = 8;
const brief = (labels: string[]) => (labels.length > MAX_MISSING ? [...labels.slice(0, MAX_MISSING), `и ещё ${labels.length - MAX_MISSING}`] : labels);

async function orderOf(db: Db, orderId: string) {
  const _id = Types.ObjectId.isValid(orderId) ? new Types.ObjectId(orderId) : null;
  const order = _id ? await db.collection('salesorders').findOne({ _id, deletedAt: null }, { projection: { orderNo: 1, customer: 1, companyId: 1 } }) : null;
  if (!order) throw new NotFoundException('Заказ не найден');
  return order;
}

const firmName = (org: Doc) => String(org.shortName || org.name || 'Фирма');
/** Фирма для экрана: название и есть ли печать / подпись (assets role seal / signature) — окно печати заказа (C104). */
const firmOf = (org: Doc): OrderFirm => ({ id: String(org._id), name: firmName(org), hasSeal: ((org.assets as Doc[] | undefined) || []).some((a) => a.role === 'seal'), hasSignature: ((org.assets as Doc[] | undefined) || []).some((a) => a.role === 'signature') });

/** Наша фирма заказа (`companyId`), если запись живая. */
async function orderFirm(db: Db, companyId: unknown): Promise<OrderFirm | null> {
  if (!companyId || !Types.ObjectId.isValid(String(companyId))) return null;
  const org = await db.collection('organizations').findOne(
    { _id: new Types.ObjectId(String(companyId)), isOurCompany: true, deletedAt: null },
    { projection: { name: 1, shortName: 1, assets: 1 } },
  );
  return org ? firmOf(org) : null;
}

/** Все наши фирмы — выбор в панели, когда у заказа фирмы нет (C075). */
async function ourFirmList(db: Db): Promise<OrderFirm[]> {
  const rows = await db.collection('organizations').find(
    { isOurCompany: true, deletedAt: null },
    { projection: { name: 1, shortName: 1, assets: 1 } },
  ).sort({ name: 1 }).toArray();
  return rows.map(firmOf);
}

/**
 * План «Паспорта на весь заказ»: по каждой позиции — изделие, количество, паспорт, готовность и чего не хватает.
 * `firm` — наша фирма из заказа; `firmChoices` — наши фирмы.
 * `supplierOrgId` — выбранная в панели фирма, ещё не записанная в заказ: снимает тупик «Выберите фирму» только для этого плана.
 */
export async function orderPlan(h: OrderHost, orderId: string, variant?: string, supplierOrgId?: string) {
  const db = h.db();
  const order = await orderOf(db, orderId);
  const incomes = await db.collection('incomes').find({ orderId: order._id, deletedAt: null, cancelledAt: null }, { projection: { title: 1, qty: 1, lineNo: 1, productId: 1 } }).sort({ lineNo: 1, _id: 1 }).toArray();
  const ids = incomes.map((i) => i._id);
  const pass = ids.length ? await db.collection('productpassports').find({ incomeId: { $in: ids }, deletedAt: null, status: { $ne: 'annulled' } }, { projection: { incomeId: 1, status: 1, passportNumber: 1, supplierOrgId: 1 } }).sort({ createdAt: 1 }).toArray() : [];
  const byIncome = new Map<string, Doc>();
  for (const p of pass) { const k = String(p.incomeId); const had = byIncome.get(k); if (!had || (!isIssued(had) && isIssued(p as Doc))) byIncome.set(k, p); } // выпущенный важнее черновика
  const pids = [...new Set(incomes.filter((i) => i.productId).map((i) => String(i.productId)))];
  const prods = pids.length ? await db.collection('products').find({ _id: { $in: pids.map((x) => new Types.ObjectId(x)) } }, { projection: { name: 1, sku: 1, categoryId: 1, 'passportDefaults.passportCategory': 1, 'passportDefaults.kindId': 1 } }).toArray() : [];
  const pname = new Map(prods.map((p) => [String(p._id), String(p.name ?? '')]));
  // C086: справочник и группы с родителями загружаются пакетно, независимо от числа позиций заказа.
  const cats = (prods.length ? await db.collection('dict_values').find({ dict: 'passportCategories', deletedAt: null }, { projection: { code: 1, name: 1, catalogNames: 1 } }).toArray() : []) as unknown as PpCat[];
  const catNames = new Map(cats.map((c) => [String(c.code), String(c.name ?? c.code)]));
  const groupIds = [...new Set(prods.filter((p) => !(p.passportDefaults as { passportCategory?: string } | undefined)?.passportCategory?.trim() && p.categoryId).map((p) => String(p.categoryId)))];
  const groups = groupIds.length ? await db.collection('categories').find({ _id: { $in: groupIds.map((id) => new Types.ObjectId(id)) }, deletedAt: null }, { projection: { name: 1, parentId: 1, passportCategory: 1, passportKindId: 1 } }).toArray() : [];
  const parentIds = [...new Set(groups.filter((g) => g.parentId).map((g) => String(g.parentId)))];
  const parents = parentIds.length ? await db.collection('categories').find({ _id: { $in: parentIds.map((id) => new Types.ObjectId(id)) }, deletedAt: null }, { projection: { name: 1, passportCategory: 1 } }).toArray() : [];
  const parentById = new Map(parents.map((p) => [String(p._id), p]));
  const byGroup = new Map<string, string | null>();
  for (const g of groups) {
    const parent = parentById.get(String(g.parentId));
    const inherited = passportCategoryFor({ group: parent ? String(g.name) : null, type: String((parent ?? g).name) }, cats, { group: parent ? String(g.passportCategory ?? '') : '', type: String((parent ?? g).passportCategory ?? '') });
    byGroup.set(String(g._id), inherited?.name ?? null);
  }
  // C100: категория вида изделия главнее категории группы; группы уже прочитаны выше (категории заново не читаются)
  const noOwn = prods.filter((p) => !String((p.passportDefaults as { passportCategory?: string } | undefined)?.passportCategory ?? '').trim());
  const kinds = await resolveKinds(db, noOwn, new Map(groups.map((g) => [String(g._id), g])));
  const pcat = new Map<string, string | null>();
  for (const p of prods) {
    const own = String((p.passportDefaults as { passportCategory?: string } | undefined)?.passportCategory ?? '').trim() || (kinds.get(String(p._id))?.kind?.passportCategory ?? '');
    const gid = p.categoryId ? String(p.categoryId) : '';
    pcat.set(String(p._id), own ? catNames.get(own) ?? own : (gid ? byGroup.get(gid) ?? null : null));
  }
  const psku = new Map(prods.map((p) => [String(p._id), p.sku ? String(p.sku) : null]));
  const lines: PlanLine[] = [];
  const firm = await orderFirm(db, order.companyId);
  const firmChoices = await ourFirmList(db);
  const picked = !firm && supplierOrgId ? firmChoices.find((f) => f.id === String(supplierOrgId)) ?? null : null;
  let ourSupplier: boolean | null = null;
  // Р8 (C112): проверки изделий идут пачками по 8, а не по одной подряд (50 позиций — десятки секунд)
  const templateChecks = new Map<string, string[]>();
  const toCheck = [...new Set(incomes.filter((i) => i.productId && !(byIncome.has(String(i._id)) && isIssued(byIncome.get(String(i._id))!))).map((i) => String(i.productId)))];
  for (let at = 0; at < toCheck.length; at += CHECK_PARALLEL) {
    const part = toCheck.slice(at, at + CHECK_PARALLEL);
    const res = await Promise.all(part.map((id) => h.templateMissing(id, variant)));
    part.forEach((id, k) => templateChecks.set(id, res[k]));
  }
  for (const inc of incomes) {
    const p = byIncome.get(String(inc._id));
    const issued = !!p && isIssued(p);
    const productId = inc.productId ? String(inc.productId) : null;
    let missing: string[] = [];
    if (!issued) {
      if (!productId) missing = ['К позиции не привязано изделие'];
      else missing = brief(templateChecks.get(productId) ?? []);
    }
    // выпуск требует фирму: у черновика; иначе фирма заказа или выбранная в панели (C075); иначе одна наша (C062)
    if (!issued && productId && !missing.length && !p?.supplierOrgId && !firm && !picked) {
      ourSupplier ??= await h.hasOurSupplier();
      if (!ourSupplier) missing = ['Выберите фирму'];
    }
    lines.push({
      incomeId: String(inc._id), lineNo: (inc.lineNo as number) ?? null, title: String(inc.title ?? ''), productId, productName: productId ? pname.get(productId) ?? null : null, article: productId ? psku.get(productId) ?? null : null, categoryName: productId ? pcat.get(productId) ?? null : null, qty: (inc.qty as number) ?? null,
      passport: p ? { id: String(p._id), number: issued ? String(p.passportNumber ?? '') : null, status: issued ? 'issued' : 'draft' } : null,
      state: issued ? 'issued' : missing.length ? 'blocked' : 'ready', missing,
    });
  }
  const count = (s: PlanLine['state']) => lines.filter((l) => l.state === s).length;
  return {
    orderId: String(order._id), orderNo: (order.orderNo as string) ?? null, customerName: (order.customer as string) ?? null,
    total: lines.length, issued: count('issued'), ready: count('ready'), blocked: count('blocked'), lines,
    firm, firmChoices,
  };
}

/**
 * Выпуск паспортов для готовых позиций заказа. Каждый паспорт — своя транзакция выпуска (номер из счётчика атомарно);
 * неготовые и уже выпущенные пропускаются с причиной, повтор не плодит дубли (черновик позиции переиспользуется).
 */
export async function orderIssue(h: OrderHost, orderId: string, opts: { lines?: string[]; variant?: string; supplierOrgId?: string } = {}) {
  // Р3 (C112): выпуск одного заказа идёт по одному — двойной клик и вторая вкладка получают понятный отказ, а не гонку за номерами
  if (issuing.has(orderId)) throw new ConflictException('Выпуск паспортов этого заказа уже идёт — дождитесь окончания и обновите заказ');
  issuing.add(orderId);
  try { return await issueLines(h, orderId, opts); } finally { issuing.delete(orderId); }
}

/** Заказы, по которым выпуск идёт прямо сейчас (в этом процессе; сервер данных один). */
const issuing = new Set<string>();

async function issueLines(h: OrderHost, orderId: string, opts: { lines?: string[]; variant?: string; supplierOrgId?: string }) {
  const plan = await orderPlan(h, orderId, opts.variant, opts.supplierOrgId);
  // фирма панели — только пока в заказе своей нет; записанная в заказ важнее
  const pick = !plan.firm && opts.supplierOrgId && plan.firmChoices.some((f) => f.id === String(opts.supplierOrgId)) ? String(opts.supplierOrgId) : undefined;
  const want = opts.lines?.length ? new Set(opts.lines.map(String)) : null;
  const issued: Array<{ incomeId: string; passportId: string }> = [];
  const skipped: SkipLine[] = [];
  for (const l of plan.lines) {
    if (want && !want.has(l.incomeId)) continue;
    const skip = (reason: string) => skipped.push({ incomeId: l.incomeId, title: l.title, reason });
    if (l.state === 'issued') { skip(`Паспорт № ${l.passport?.number} уже выпущен`); continue; }
    if (l.state === 'blocked') { skip(`Не готово: ${l.missing.join(', ')}`); continue; }
    const fresh = !l.passport;
    const id = l.passport ? l.passport.id : (await h.createDraft(l.incomeId, l.title, pick)).id;
    try {
      if (pick && h.setSupplier) await h.setSupplier(id, pick);
      await h.issue(id);
      issued.push({ incomeId: l.incomeId, passportId: id });
    }
    catch (e) {
      if (fresh) await h.discard(id).catch(() => undefined); // свой черновик, который не выпустился, не оставляем
      skip(`Не выпущен: ${(e as { response?: { message?: string } }).response?.message ?? (e as Error).message}`);
    }
  }
  if (want) for (const id of want) if (!plan.lines.some((l) => l.incomeId === id)) skipped.push({ incomeId: id, title: '', reason: 'Позиции нет в этом заказе' });
  return { orderId: plan.orderId, issued, skipped, counts: { issued: issued.length, skipped: skipped.length } };
}
