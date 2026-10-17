import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { randomUUID } from 'node:crypto';
import { ClientSession, Model, Types } from 'mongoose';
import {
  BoardLane,
  EstimateDayOverride,
  EstimateStartOffset,
  EstimateWorkerOverride,
  ModuleLane,
  Order,
  OrderDocument,
  OrderItem,
} from './order.schema';
import { Shipment, ShipmentDocument } from '../shipment/shipment.schema';
import { Quotation, QuotationDocument } from '../quotation/quotation.schema';
import { Product, ProductDocument } from '../product/product.schema';
import {
  ProductModule,
  ProductModuleDocument,
} from '../product-module/product-module.schema';
import { WorkType, WorkTypeDocument } from '../work-type/work-type.schema';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateOrderDto } from './dto/update-order.dto';
import { ShipOrderItemDto } from './dto/ship-order.dto';
import { PatchEstimateDaysDto } from './dto/patch-estimate-days.dto';
import { PatchEstimateStartDto } from './dto/patch-estimate-start.dto';
import { PatchEstimateWorkerDto } from './dto/patch-estimate-worker.dto';
import { CounterService } from '../counter/counter.service';
import { ReservationService } from '../reservation/reservation.service';
import { ShipmentService } from '../shipment/shipment.service';
import { SessionRunner } from '../../common/db/session-runner';
import { SiteService } from '../site/site.service';
import { OrganizationService } from '../organization/organization.service';

/** TZ-ORDERS-306: JWT-актор — нужен, чтобы понять, чья фирма выставляет КП. */
export interface OrderActor {
  organizationId?: string | null;
  role?: string;
}

const PLAN_UPDATE_KEYS = new Set(['plannedDate', 'priority', 'materialsSource', 'number']);
const PAYMENT_UPDATE_KEYS = new Set(['isPaid', 'paidAt']);
const PLAN_EDITABLE_FROZEN = new Set(['in_production', 'ready']);
const HARD_FROZEN = new Set(['shipped', 'delivered', 'cancelled']);
/** TZ-OPS-315 — статусы, в которых заказ МОЖЕТ быть создан (всегда через workflow). */
const CREATE_ALLOWED_STATUSES = new Set(['draft', 'confirmed']);
const ORDER_STATUS_RU: Record<string, string> = {
  draft: 'Черновик',
  confirmed: 'Подтверждён',
  in_production: 'В производстве',
  ready: 'Готов',
  shipped: 'Отгружен',
  delivered: 'Доставлен',
  cancelled: 'Отменён',
};
const MISSING_SITE_RU =
  'У заказа нет площадки (siteId) — создайте объект у контрагента';

/** TZ-COMBINE-402 — legacy OrderItem.status → boardLane (backfill only). */
const STATUS_TO_BOARD_LANE: Record<
  NonNullable<OrderItem['status']>,
  BoardLane
> = {
  pending: 'prep',
  in_production: 'shop',
  ready: 'to_ship',
  shipped: 'shipped',
};

/** TZ-COMBINE-403 — boardLane → OrderItem.status (SoT lane). */
const BOARD_LANE_TO_STATUS: Record<BoardLane, NonNullable<OrderItem['status']>> = {
  prep: 'pending',
  design: 'pending',
  shop: 'in_production',
  to_ship: 'ready',
  shipped: 'shipped',
};

/** TZ-COMBINE-406 — порядок колонок для «min» полосы модулей (prep = раньше всех). */
const LANE_ORDER: Record<BoardLane, number> = {
  prep: 0,
  design: 1,
  shop: 2,
  to_ship: 3,
  shipped: 4,
};

const LINE_DELETE_BLOCKED_RU =
  'Нельзя удалить изделие вне колонки «Комплектация»';
const LANE_SHIPPED_PATCH_RU =
  'Колонку «Отгружены» нельзя выставить вручную — используйте действие «Отгрузить» (POST /orders/:id/ship)';

/** TZ-COMBINE-408 — вход в «Цех» без видов работ/оценки дней запрещён. */
const SHOP_GATE_RU =
  'В «Цех» можно отправить позицию только с видами работ и оценкой дней — заполните состав изделия и оценку (каталог или оценка заказа).';

@Injectable()
export class OrderService {
  private readonly logger = new Logger(OrderService.name);

  constructor(
    @InjectModel(Order.name)
    private readonly model: Model<OrderDocument>,
    @InjectModel(Shipment.name)
    private readonly shipmentModel: Model<ShipmentDocument>,
    private readonly counter: CounterService,
    private readonly reservationService: ReservationService,
    private readonly shipmentService: ShipmentService,
    private readonly sessionRunner: SessionRunner,
    private readonly sites: SiteService,
    @InjectModel(Quotation.name)
    private readonly quotationModel: Model<QuotationDocument>,
    private readonly organizations: OrganizationService,
    @InjectModel(Product.name)
    private readonly productModel: Model<ProductDocument>,
    @InjectModel(ProductModule.name)
    private readonly productModuleModel: Model<ProductModuleDocument>,
    @InjectModel(WorkType.name)
    private readonly workTypeModel: Model<WorkTypeDocument>,
  ) {}

  private boardLaneFromStatus(status?: OrderItem['status']): BoardLane {
    return STATUS_TO_BOARD_LANE[status ?? 'pending'] ?? 'prep';
  }

  private statusFromBoardLane(lane: BoardLane): NonNullable<OrderItem['status']> {
    return BOARD_LANE_TO_STATUS[lane];
  }

  /**
   * TZ-COMBINE-406 — эффективная полоса линии: min по moduleLanes этой линии
   * (если есть записи), иначе boardLane линии.
   */
  effectiveLineLane(order: OrderDocument, item: OrderItem): BoardLane {
    const moduleLanes = (order.moduleLanes ?? []).filter(
      (ml) => ml.lineId === item.lineId,
    );
    if (moduleLanes.length === 0) return item.boardLane ?? 'prep';
    return moduleLanes.reduce<BoardLane>(
      (min, ml) => (LANE_ORDER[ml.lane] < LANE_ORDER[min] ? ml.lane : min),
      moduleLanes[0].lane,
    );
  }

  /**
   * TZ-COMBINE-403 / COUPLING-MAP §2 — Order.status rollup from item boardLane.
   * Never writes `shipped` (only POST ship). Monotonic: do not return to `draft`
   * after the order has left it.
   */
  rollupOrderStatus(order: OrderDocument): void {
    if (HARD_FROZEN.has(order.status)) return;
    const lanes = (order.items ?? []).map((item) =>
      this.effectiveLineLane(order, item),
    );
    if (lanes.length === 0) return;

    if (lanes.some((lane) => lane === 'shop')) {
      order.status = 'in_production';
      return;
    }

    if (lanes.every((lane) => lane === 'to_ship')) {
      order.status = 'ready';
      return;
    }

    if (lanes.every((lane) => lane === 'prep')) {
      if (order.status === 'draft') return;
      // Monotonic: once left draft, all-prep does not go back to draft.
      order.status = 'confirmed';
      return;
    }

    // First leave prep (design / mix / partial to_ship) → confirmed.
    order.status = 'confirmed';
  }

  /** TZ-COMBINE-403 — drop trailing lines only while they remain in prep. */
  private assertTrailingLinesDeletable(
    previous: OrderItem[],
    nextLength: number,
  ): void {
    for (let index = nextLength; index < previous.length; index++) {
      const lane = previous[index]?.boardLane ?? 'prep';
      if (lane !== 'prep') {
        throw new BadRequestException(LINE_DELETE_BLOCKED_RU);
      }
    }
  }

  /**
   * TZ-COMBINE-402 — fill missing lineId / boardLane on legacy items.
   * Stable lineId: `legacy-{index}-{orderId}` (or uuid on create via mapItems).
   * Returns true if mutated.
   */
  private ensureLineBoardFields(doc: OrderDocument): boolean {
    let dirty = false;
    const orderId = doc._id?.toString() ?? 'unknown';
    const items = doc.items ?? [];
    for (let index = 0; index < items.length; index++) {
      const item = items[index];
      if (!item.lineId) {
        item.lineId = `legacy-${index}-${orderId}`;
        dirty = true;
      }
      if (!item.boardLane) {
        item.boardLane = this.boardLaneFromStatus(item.status);
        dirty = true;
      }
    }
    return dirty;
  }

  private async persistLineBoardFieldsIfNeeded(doc: OrderDocument): Promise<void> {
    if (!this.ensureLineBoardFields(doc)) return;
    doc.markModified('items');
    await doc.save();
  }

  private resolvePaymentState(
    dto: Pick<CreateOrderDto, 'isPaid' | 'paidAt'>,
    existing?: Pick<Order, 'isPaid' | 'paidAt'>,
  ): { isPaid: boolean; paidAt: Date | null } {
    let isPaid = existing?.isPaid ?? false;
    let paidAt = existing?.paidAt ?? null;

    if (dto.isPaid !== undefined) {
      isPaid = dto.isPaid;
      if (!isPaid) return { isPaid: false, paidAt: null };
    }

    if (dto.paidAt !== undefined) {
      const parsed = new Date(dto.paidAt);
      if (Number.isNaN(parsed.getTime())) {
        throw new BadRequestException('Дата оплаты должна быть корректной датой ISO');
      }
      isPaid = true;
      paidAt = parsed;
    } else if (dto.isPaid === true && !paidAt) {
      paidAt = new Date();
    }

    return isPaid ? { isPaid: true, paidAt } : { isPaid: false, paidAt: null };
  }

  private mapItems(
    dtoItems: CreateOrderDto['items'],
    previousItems: OrderItem[] = [],
  ): OrderItem[] {
    return dtoItems.map((i, index) => {
      const prev = previousItems[index];
      return {
        lineId: prev?.lineId ?? randomUUID(),
        boardLane: prev?.boardLane ?? 'prep',
        productId: new Types.ObjectId(i.productId),
        productName: i.productName,
        productSku: i.productSku,
        quantity: i.quantity,
        unit: i.unit,
        unitPrice: i.unitPrice ?? 0,
        total: (i.quantity ?? 0) * (i.unitPrice ?? 0),
        ownerUserId: i.ownerUserId ? new Types.ObjectId(i.ownerUserId) : undefined,
        plannedShipDate: i.plannedShipDate ? new Date(i.plannedShipDate) : undefined,
        readyForWork: i.readyForWork ?? prev?.readyForWork ?? false,
        readyAt:
          i.readyForWork === undefined
            ? prev?.readyAt
            : i.readyForWork
              ? prev?.readyAt
              : undefined,
        readyByUserId:
          i.readyForWork === undefined
            ? prev?.readyByUserId
            : i.readyForWork
              ? prev?.readyByUserId
              : undefined,
        status: prev?.status ?? 'pending',
      };
    });
  }

  async create(dto: CreateOrderDto, session?: ClientSession): Promise<OrderDocument> {
    if (dto.status !== undefined && !CREATE_ALLOWED_STATUSES.has(dto.status)) {
      const label = ORDER_STATUS_RU[dto.status] ?? dto.status;
      throw new BadRequestException(
        `Заказ нельзя создать сразу в статусе «${label}» — используйте PATCH или действия «Отгрузить»/«Отменить»`,
      );
    }
    if (!dto.siteId) {
      throw new BadRequestException('siteId is required');
    }
    await this.sites.assertBelongsTo(dto.siteId, dto.counterpartyId);

    const number = dto.number ?? (await this.counter.next('Order', 'ORD'));
    const items = this.mapItems(dto.items);
    const total = items.reduce((s, i) => s + i.total, 0);
    const payment = this.resolvePaymentState(dto);

    // TZ-ORDERS-307: default org = isOurCompany; existing orders without org get this on create.
    let organizationId: Types.ObjectId | undefined;
    if (dto.organizationId) {
      organizationId = new Types.ObjectId(dto.organizationId);
    } else {
      try {
        const current = await this.organizations.findCurrent();
        organizationId = current._id;
      } catch {
        // org not set up yet — leave blank (migration-safe)
      }
    }

    const doc = new this.model({
      number,
      counterpartyId: new Types.ObjectId(dto.counterpartyId),
      siteId: new Types.ObjectId(dto.siteId),
      quotationId: dto.quotationId ? new Types.ObjectId(dto.quotationId) : undefined,
      contractId: dto.contractId ? new Types.ObjectId(dto.contractId) : undefined,
      date: dto.date ? new Date(dto.date) : new Date(),
      plannedDate: dto.plannedDate ? new Date(dto.plannedDate) : undefined,
      status: dto.status ?? 'draft',
      total,
      isPaid: payment.isPaid,
      paidAt: payment.paidAt,
      notes: dto.notes,
      materialsSource: dto.materialsSource ?? 'own',
      source: dto.source ?? 'manual',
      deliveryAddress: dto.deliveryAddress,
      managerId: dto.managerId ? new Types.ObjectId(dto.managerId) : undefined,
      priority: dto.priority ?? 'normal',
      items,
      organizationId,
    });
    if (session) {
      await doc.save({ session });
    } else {
      await doc.save();
    }
    return doc;
  }

  async findAll(
    counterpartyId?: string,
    status?: string,
    managerId?: string,
  ): Promise<OrderDocument[]> {
    const filter: Record<string, unknown> = { deletedAt: null };
    if (counterpartyId) {
      if (!Types.ObjectId.isValid(counterpartyId)) return [];
      filter.counterpartyId = new Types.ObjectId(counterpartyId);
    }
    if (status) filter.status = status;
    if (managerId) {
      if (!Types.ObjectId.isValid(managerId)) return [];
      filter.managerId = new Types.ObjectId(managerId);
    }
    const docs = await this.model
      .find(filter)
      .populate('counterpartyId')
      .populate('siteId')
      .populate('quotationId')
      .populate('contractId')
      .sort({ date: -1 })
      .exec();
    for (const doc of docs) {
      await this.persistLineBoardFieldsIfNeeded(doc);
    }
    return docs;
  }

  async findById(id: string): Promise<OrderDocument> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException(`Order ${id} not found`);
    }
    const doc = await this.model
      .findById(id)
      .populate('counterpartyId')
      .populate('siteId')
      .populate('quotationId')
      .populate('contractId')
      .populate('items.ownerUserId', 'displayName username fullName')
      .exec();
    if (!doc || doc.deletedAt) throw new NotFoundException(`Order ${id} not found`);
    await this.persistLineBoardFieldsIfNeeded(doc);
    return doc;
  }

  /**
   * TZ-NX-GANTT-L0-PEER-REVIEW — org-scope check for the two Gantt write
   * endpoints (estimate-days/estimate-start). `findByIdRaw`/`findById` run
   * an unscoped `Model.findById`; the only existing protection was
   * `OrgScopeGuardInterceptor`, which filters the RESPONSE after the
   * handler runs — for a write, `doc.save()` has already persisted the
   * mutation by then, so a cross-org caller could not see the result but
   * had already changed another organization's order. This throws BEFORE
   * any mutation. Mirrors `ProductService.organizationFilter`'s "no org id
   * on either side = legacy/system, allow" semantics so bootstrap/system
   * callers keep working.
   */
  private assertOrgAccess(doc: OrderDocument, organizationId?: string | null): void {
    if (!organizationId) return;
    const docOrgId = doc.organizationId;
    if (!docOrgId) return;
    if (String(docOrgId) !== organizationId) {
      throw new NotFoundException(`Order ${String(doc._id)} not found`);
    }
  }

  private async findByIdRaw(id: string): Promise<OrderDocument> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException(`Order ${id} not found`);
    }
    const doc = await this.model.findById(id).exec();
    if (!doc || doc.deletedAt) throw new NotFoundException(`Order ${id} not found`);
    this.ensureLineBoardFields(doc);
    return doc;
  }

  /**
   * TZ-ORDERS-306 — КП-заглушка для прямого заказа.
   *
   * Прямой заказ (создан без КП) не имеет `quotationId`, поэтому документы и
   * печать, которым нужна ссылка на КП, для него недостижимы. Метод создаёт
   * черновик КП из позиций заказа и связывает его в обе стороны:
   * `Order.quotationId` ↔ `Quotation.sourceOrderId`.
   *
   * Идемпотентен: если у заказа уже есть КП (настоящее или заглушка), метод
   * возвращает его с `created: false` и ничего не создаёт — повторное нажатие
   * кнопки не должно плодить КП. Статус остаётся `draft`, а не `converted`:
   * никакой конвертации не было, менеджер ещё не считал цены.
   */
  async ensureStubProposal(
    id: string,
    user?: OrderActor,
  ): Promise<{ quotation: QuotationDocument; created: boolean }> {
    const order = await this.findByIdRaw(id);

    if (order.quotationId) {
      const existing = await this.quotationModel.findById(order.quotationId).exec();
      if (existing) return { quotation: existing, created: false };
      this.logger.warn(
        `Order ${order.number}: quotationId ${order.quotationId.toString()} ссылается на удалённое КП — создаю заглушку заново`,
      );
    }

    if (order.status === 'cancelled') {
      throw new BadRequestException('Отменённому заказу КП не нужно.');
    }
    if (order.items.length === 0) {
      throw new BadRequestException(
        'В заказе нет позиций — КП будет пустым. Добавьте изделия и повторите.',
      );
    }

    // Кому выставляем: организация из JWT → «наша фирма» → единственная (PARTY-301).
    const organization = await this.organizations.findCurrent(user);
    const number = await this.counter.next('Quotation', 'QTN');
    const items = order.items.map((item, index) => ({
      productId: item.productId,
      productName: item.productName,
      productSku: item.productSku,
      quantity: item.quantity,
      unit: item.unit,
      unitPrice: item.unitPrice ?? 0,
      markupPercent: 0,
      total: (item.quantity ?? 0) * (item.unitPrice ?? 0),
      sortOrder: index,
    }));
    const quotation = await this.quotationModel.create({
      number,
      organizationId: organization._id,
      counterpartyId: order.counterpartyId,
      title: `Черновик КП к заказу №${order.number}`,
      date: new Date(),
      status: 'draft',
      isStub: true,
      sourceOrderId: order._id,
      total: items.reduce((sum, i) => sum + i.total, 0),
      notes: `Заглушка: заказ №${order.number} оформлен без КП. Проверьте цены до отправки клиенту.`,
      items,
    });

    order.quotationId = quotation._id;
    await order.save();
    this.logger.log(`Order ${order.number}: создана КП-заглушка ${quotation.number}`);
    return { quotation, created: true };
  }

  async setLineReady(
    id: string,
    lineIndex: string,
    readyForWork: boolean,
    userId: string,
    organizationId?: string | null,
  ): Promise<OrderDocument> {
    const doc = await this.findByIdRaw(id);
    this.assertOrgAccess(doc, organizationId);
    if (!['draft', 'confirmed'].includes(doc.status)) {
      throw new BadRequestException(`Order in status \"${doc.status}\" cannot change line readiness`);
    }
    const index = Number(lineIndex);
    if (!Number.isInteger(index) || index < 0 || index >= doc.items.length) {
      throw new NotFoundException(`Order line ${lineIndex} not found`);
    }
    if (!Types.ObjectId.isValid(userId)) {
      throw new BadRequestException('Invalid userId for line readiness');
    }
    const line = doc.items[index];
    line.readyForWork = readyForWork;
    line.readyAt = readyForWork ? new Date() : undefined;
    line.readyByUserId = readyForWork ? new Types.ObjectId(userId) : undefined;
    await doc.save();
    return this.findById(id);
  }

  /** TZ-DASHBOARD-400: изменение статуса отдельной позиции заказа */
  async setItemStatus(
    id: string,
    itemId: string,
    status: 'pending' | 'in_production' | 'ready' | 'shipped',
    organizationId?: string | null,
  ): Promise<OrderDocument> {
    const doc = await this.findByIdRaw(id);
    this.assertOrgAccess(doc, organizationId);
    const index = Number(itemId);
    if (!Number.isInteger(index) || index < 0 || index >= doc.items.length) {
      throw new NotFoundException(`Order line ${itemId} not found`);
    }
    // TZ-SWEEP-401: изделие нельзя отметить отгруженным, пока заказ не отгружен
    // (ship() проставляет статусы всех линий сам). Старые линии без поля просто
    // получают реальное значение при первой записи.
    if (status === 'shipped' && doc.status !== 'shipped' && doc.status !== 'delivered') {
      throw new BadRequestException(
        'Нельзя отметить изделие отгруженным — заказ ещё не отгружен',
      );
    }
    const line = doc.items[index];
    line.status = status;
    line.boardLane = this.boardLaneFromStatus(status);
    this.rollupOrderStatus(doc);
    doc.markModified('items');
    await doc.save();
    return this.findById(id);
  }

  /**
   * TZ-COMBINE-408 — direct module ids изделия (composition-first, как на фронте).
   */
  private directModuleIds(product: {
    composition?: Array<{ lineType?: string; refId?: unknown }>;
    productModuleIds?: unknown[];
  }): string[] {
    const composition = product.composition ?? [];
    if (composition.length > 0) {
      return composition
        .filter((line) => line.lineType === 'module' && line.refId)
        .map((line) => String(line.refId));
    }
    return (product.productModuleIds ?? []).map((m) => String(m));
  }

  /**
   * TZ-COMBINE-408 — вход в «Цех» разрешён, только если у модулей есть хотя бы
   * один вид работы с оценкой дней (override заказа или каталог WorkType.days).
   */
  private async assertModulesShopReady(
    doc: OrderDocument,
    orderItemIndex: number,
    moduleIds: string[],
  ): Promise<void> {
    if (moduleIds.length === 0) {
      throw new BadRequestException(SHOP_GATE_RU);
    }
    const modules = await this.productModuleModel
      .find({ _id: { $in: moduleIds } })
      .select('workTypes')
      .lean()
      .exec();
    const workTypeIds: string[] = [];
    for (const mod of modules) {
      for (const wt of mod.workTypes ?? []) {
        if (wt.workTypeId) workTypeIds.push(String(wt.workTypeId));
      }
    }
    if (workTypeIds.length === 0) {
      throw new BadRequestException(SHOP_GATE_RU);
    }

    const moduleIdSet = new Set(moduleIds);
    const workTypeIdSet = new Set(workTypeIds);
    const hasOverrideDays = (doc.estimateDayOverrides ?? []).some(
      (o) =>
        o.orderItemIndex === orderItemIndex &&
        moduleIdSet.has(String(o.moduleId)) &&
        workTypeIdSet.has(String(o.workTypeId)) &&
        (o.days ?? 0) >= 1,
    );
    if (hasOverrideDays) return;

    const workTypes = await this.workTypeModel
      .find({ _id: { $in: workTypeIds } })
      .select('days')
      .lean()
      .exec();
    const hasCatalogDays = workTypes.some(
      (wt) => typeof wt.days === 'number' && wt.days >= 1,
    );
    if (!hasCatalogDays) {
      throw new BadRequestException(SHOP_GATE_RU);
    }
  }

  /** TZ-COMBINE-408 — gate по линии: изделие → модули → workType + days. */
  private async assertLineShopReady(
    doc: OrderDocument,
    orderItemIndex: number,
    line: OrderItem,
  ): Promise<void> {
    const product = await this.productModel
      .findById(line.productId)
      .select('composition productModuleIds')
      .lean()
      .exec();
    await this.assertModulesShopReady(
      doc,
      orderItemIndex,
      product ? this.directModuleIds(product) : [],
    );
  }

  /**
   * TZ-COMBINE-403 — PATCH boardLane by stable lineId; derive item.status; rollup Order.status.
   */
  async patchLineBoardLane(
    id: string,
    lineId: string,
    lane: BoardLane,
    organizationId?: string | null,
  ): Promise<OrderDocument> {
    if (lane === 'shipped') {
      throw new BadRequestException(LANE_SHIPPED_PATCH_RU);
    }
    const doc = await this.findByIdRaw(id);
    this.assertOrgAccess(doc, organizationId);
    if (HARD_FROZEN.has(doc.status)) {
      const label = ORDER_STATUS_RU[doc.status] ?? doc.status;
      throw new BadRequestException(`Заказ в статусе «${label}» нельзя менять`);
    }
    const items = doc.items ?? [];
    const index = items.findIndex((item) => item.lineId === lineId);
    if (index < 0) {
      throw new NotFoundException(`Order line ${lineId} not found`);
    }
    const line = items[index];
    if (lane === 'shop') {
      await this.assertLineShopReady(doc, index, line);
    }
    line.boardLane = lane;
    line.status = this.statusFromBoardLane(lane);
    this.rollupOrderStatus(doc);
    doc.markModified('items');
    await doc.save();
    return this.findById(id);
  }

  /**
   * TZ-COMBINE-406 — PATCH lane модуля изделия; разреженный moduleLanes по
   * ключу (lineId, moduleId). Родительская полоса линии следует min (rollup).
   */
  async patchModuleLane(
    id: string,
    lineId: string,
    moduleId: string,
    lane: BoardLane,
    organizationId?: string | null,
  ): Promise<OrderDocument> {
    if (lane === 'shipped') {
      throw new BadRequestException(LANE_SHIPPED_PATCH_RU);
    }
    const doc = await this.findByIdRaw(id);
    this.assertOrgAccess(doc, organizationId);
    if (HARD_FROZEN.has(doc.status)) {
      const label = ORDER_STATUS_RU[doc.status] ?? doc.status;
      throw new BadRequestException(`Заказ в статусе «${label}» нельзя менять`);
    }
    const items = doc.items ?? [];
    const index = items.findIndex((item) => item.lineId === lineId);
    if (index < 0) {
      throw new NotFoundException(`Order line ${lineId} not found`);
    }
    if (!Types.ObjectId.isValid(moduleId)) {
      throw new BadRequestException('moduleId must be a valid ObjectId');
    }
    if (lane === 'shop') {
      await this.assertModulesShopReady(doc, index, [moduleId]);
    }
    const moduleOid = new Types.ObjectId(moduleId);
    const lanes: ModuleLane[] = [...(doc.moduleLanes ?? [])];
    const matchIndex = lanes.findIndex(
      (ml) => ml.lineId === lineId && ml.moduleId.equals(moduleOid),
    );
    if (matchIndex >= 0) {
      lanes[matchIndex] = { lineId, moduleId: moduleOid, lane };
    } else {
      lanes.push({ lineId, moduleId: moduleOid, lane });
    }
    doc.moduleLanes = lanes;
    this.rollupOrderStatus(doc);
    doc.markModified('moduleLanes');
    await doc.save();
    return this.findById(id);
  }

  /**
   * TZ-PRODUCTION-309 — upsert or clear order-level estimate days.
   * Composite key: (orderItemIndex, moduleId, workTypeId).
   * `days: null` removes the override (catalog WorkType.days applies).
   */
  async patchEstimateDays(
    id: string,
    dto: PatchEstimateDaysDto,
    organizationId?: string | null,
  ): Promise<OrderDocument> {
    const doc = await this.findByIdRaw(id);
    this.assertOrgAccess(doc, organizationId);
    if (!Types.ObjectId.isValid(dto.moduleId) || !Types.ObjectId.isValid(dto.workTypeId)) {
      throw new BadRequestException('moduleId and workTypeId must be valid ObjectIds');
    }
    if (!Number.isInteger(dto.orderItemIndex) || dto.orderItemIndex < 0) {
      throw new BadRequestException('orderItemIndex must be an integer ≥ 0');
    }
    if (dto.orderItemIndex >= doc.items.length) {
      throw new NotFoundException(`Order line ${dto.orderItemIndex} not found`);
    }

    const moduleId = new Types.ObjectId(dto.moduleId);
    const workTypeId = new Types.ObjectId(dto.workTypeId);
    const overrides: EstimateDayOverride[] = [...(doc.estimateDayOverrides ?? [])];
    const matchIndex = overrides.findIndex(
      (row) =>
        row.orderItemIndex === dto.orderItemIndex &&
        row.moduleId.equals(moduleId) &&
        row.workTypeId.equals(workTypeId),
    );

    if (dto.days === null) {
      if (matchIndex >= 0) {
        overrides.splice(matchIndex, 1);
      }
    } else {
      if (!Number.isInteger(dto.days) || dto.days < 1) {
        throw new BadRequestException('days must be an integer ≥ 1, or null to clear');
      }
      const next: EstimateDayOverride = {
        orderItemIndex: dto.orderItemIndex,
        moduleId,
        workTypeId,
        days: dto.days,
      };
      if (matchIndex >= 0) {
        overrides[matchIndex] = next;
      } else {
        overrides.push(next);
      }
    }

    doc.estimateDayOverrides = overrides;
    await this.healMissingSiteId(doc);
    await doc.save();
    return this.findById(id);
  }

  /**
   * TZ-PRODUCTION-316 — upsert or clear per-bar start offset from visualAnchor.
   * Composite key: (orderItemIndex, moduleId, workTypeId).
   * `offsetDays: null` removes the override (sequential pack applies).
   */
  async patchEstimateStart(
    id: string,
    dto: PatchEstimateStartDto,
    organizationId?: string | null,
  ): Promise<OrderDocument> {
    const doc = await this.findByIdRaw(id);
    this.assertOrgAccess(doc, organizationId);
    if (!Types.ObjectId.isValid(dto.moduleId) || !Types.ObjectId.isValid(dto.workTypeId)) {
      throw new BadRequestException('moduleId and workTypeId must be valid ObjectIds');
    }
    if (!Number.isInteger(dto.orderItemIndex) || dto.orderItemIndex < 0) {
      throw new BadRequestException('orderItemIndex must be an integer ≥ 0');
    }
    if (dto.orderItemIndex >= doc.items.length) {
      throw new NotFoundException(`Order line ${dto.orderItemIndex} not found`);
    }

    const moduleId = new Types.ObjectId(dto.moduleId);
    const workTypeId = new Types.ObjectId(dto.workTypeId);
    const offsets: EstimateStartOffset[] = [...(doc.estimateStartOffsets ?? [])];
    const matchIndex = offsets.findIndex(
      (row) =>
        row.orderItemIndex === dto.orderItemIndex &&
        row.moduleId.equals(moduleId) &&
        row.workTypeId.equals(workTypeId),
    );

    if (dto.offsetDays === null) {
      if (matchIndex >= 0) {
        offsets.splice(matchIndex, 1);
      }
    } else {
      if (!Number.isInteger(dto.offsetDays) || dto.offsetDays < 0) {
        throw new BadRequestException('offsetDays must be an integer ≥ 0, or null to clear');
      }
      const next: EstimateStartOffset = {
        orderItemIndex: dto.orderItemIndex,
        moduleId,
        workTypeId,
        offsetDays: dto.offsetDays,
      };
      if (matchIndex >= 0) {
        offsets[matchIndex] = next;
      } else {
        offsets.push(next);
      }
    }

    doc.estimateStartOffsets = offsets;
    await this.healMissingSiteId(doc);
    await doc.save();
    return this.findById(id);
  }

  /**
   * TZ-NX-GANTT-G14 — upsert or clear job-assignment override for one WT line.
   * Composite key: (orderItemIndex, moduleId, workTypeId).
   * `workerIds: []` clears the override (Gantt falls back to «Не назначен»,
   * never auto-fills from `Worker.workTypeIds` skills).
   */
  async patchEstimateWorker(
    id: string,
    dto: PatchEstimateWorkerDto,
    organizationId?: string | null,
  ): Promise<OrderDocument> {
    const doc = await this.findByIdRaw(id);
    this.assertOrgAccess(doc, organizationId);
    if (!Types.ObjectId.isValid(dto.moduleId) || !Types.ObjectId.isValid(dto.workTypeId)) {
      throw new BadRequestException('moduleId and workTypeId must be valid ObjectIds');
    }
    if (!Number.isInteger(dto.orderItemIndex) || dto.orderItemIndex < 0) {
      throw new BadRequestException('orderItemIndex must be an integer ≥ 0');
    }
    if (dto.orderItemIndex >= doc.items.length) {
      throw new NotFoundException(`Order line ${dto.orderItemIndex} not found`);
    }
    if (!dto.workerIds.every((w) => Types.ObjectId.isValid(w))) {
      throw new BadRequestException('workerIds must be valid ObjectIds');
    }

    const moduleId = new Types.ObjectId(dto.moduleId);
    const workTypeId = new Types.ObjectId(dto.workTypeId);
    const workerIds = dto.workerIds.map((w) => new Types.ObjectId(w));
    const overrides: EstimateWorkerOverride[] = [...(doc.estimateWorkerOverrides ?? [])];
    const matchIndex = overrides.findIndex(
      (row) =>
        row.orderItemIndex === dto.orderItemIndex &&
        row.moduleId.equals(moduleId) &&
        row.workTypeId.equals(workTypeId),
    );

    if (workerIds.length === 0) {
      if (matchIndex >= 0) {
        overrides.splice(matchIndex, 1);
      }
    } else {
      const next: EstimateWorkerOverride = {
        orderItemIndex: dto.orderItemIndex,
        moduleId,
        workTypeId,
        workerIds,
      };
      if (matchIndex >= 0) {
        overrides[matchIndex] = next;
      } else {
        overrides.push(next);
      }
    }

    doc.estimateWorkerOverrides = overrides;
    await this.healMissingSiteId(doc);
    await doc.save();
    return this.findById(id);
  }

  /**
   * TZ-SWEEP-401 — единственный PATCH-граф статуса заказа.
   *
   * PATCH разрешён только между операционными статусами доски
   * (draft ↔ confirmed ↔ in_production ↔ ready; шаг назад/прыжок вперёд ок).
   * shipped/delivered/cancelled в граф НЕ входят: отгрузка — только
   * `POST /orders/:id/ship` (создаёт Shipment), отмена — `POST /orders/:id/cancel`
   * (снимает резервы). no-op того же статуса из HARD_FROZEN пропускается —
   * дальше решает freeze состава.
   */
  private assertOrderStatusTransition(from: string, to: string): void {
    if (from === to) return;
    if (HARD_FROZEN.has(to)) {
      throw new BadRequestException(
        'Отгрузка — через действие «Отгрузить»; отмена — «Отменить заказ».',
      );
    }
    if (HARD_FROZEN.has(from)) {
      const label = ORDER_STATUS_RU[from] ?? from;
      throw new BadRequestException(`Заказ в статусе «${label}» нельзя изменить через PATCH`);
    }
    const graph = new Set(['draft', 'confirmed', 'in_production', 'ready']);
    if (!graph.has(from) || !graph.has(to)) {
      throw new BadRequestException(`Недопустимый переход статуса: ${from} → ${to}`);
    }
  }

  async update(id: string, dto: UpdateOrderDto, organizationId?: string | null): Promise<OrderDocument> {
    const doc = await this.findByIdRaw(id);
    this.assertOrgAccess(doc, organizationId);
    const definedKeys = (Object.keys(dto) as (keyof UpdateOrderDto)[]).filter(
      (key) => dto[key] !== undefined,
    );
    // TZ-SWEEP-401: переход статуса проверяется ДО freeze состава. Status-only
    // payload проходит в in_production/ready (рабочий дроп), а состав по-прежнему режется.
    if (dto.status !== undefined) {
      this.assertOrderStatusTransition(doc.status, dto.status);
    }
    if (HARD_FROZEN.has(doc.status)) {
      const blocked = definedKeys.some(
        (key) =>
          key !== 'status' &&
          key !== 'materialsSource' &&
          !PAYMENT_UPDATE_KEYS.has(key),
      );
      if (blocked) {
        const label = ORDER_STATUS_RU[doc.status] ?? doc.status;
        throw new BadRequestException(`Заказ в статусе «${label}» нельзя обновлять`);
      }
    } else if (PLAN_EDITABLE_FROZEN.has(doc.status)) {
      const blocked = definedKeys.some(
        (key) =>
          key !== 'status' &&
          !PLAN_UPDATE_KEYS.has(key) &&
          !PAYMENT_UPDATE_KEYS.has(key),
      );
      if (blocked) {
        const label = ORDER_STATUS_RU[doc.status] ?? doc.status;
        throw new BadRequestException(
          `Заказ в статусе «${label}» нельзя менять состав — только план/приоритет в Цехе`,
        );
      }
    }
    if (dto.number !== undefined) {
      const trimmed = dto.number.trim();
      if (!trimmed) {
        throw new BadRequestException('Номер заказа не может быть пустым');
      }
      if (trimmed !== doc.number) {
        const taken = await this.model
          .findOne({ number: trimmed, _id: { $ne: doc._id }, deletedAt: null })
          .exec();
        if (taken) {
          throw new ConflictException('Номер уже занят');
        }
        doc.number = trimmed;
      }
    }
    if (dto.notes !== undefined) doc.notes = dto.notes;
    if (dto.materialsSource !== undefined) doc.materialsSource = dto.materialsSource;
    if (dto.status !== undefined) doc.status = dto.status;
    if (dto.isPaid !== undefined || dto.paidAt !== undefined) {
      const payment = this.resolvePaymentState(dto, doc);
      doc.isPaid = payment.isPaid;
      doc.paidAt = payment.paidAt;
    }
    if (dto.plannedDate !== undefined) doc.plannedDate = new Date(dto.plannedDate);
    if (dto.deliveryAddress !== undefined) doc.deliveryAddress = dto.deliveryAddress;
    if (dto.priority !== undefined) doc.priority = dto.priority;
    // TZ-NX-ORDER-WS-META-INLINE: was validated by the DTO (inherited from
    // CreateOrderDto) but never applied here — PATCH { organizationId }
    // returned 200 and silently did nothing. Same cast style as create().
    if (dto.organizationId !== undefined) {
      doc.organizationId = dto.organizationId ? new Types.ObjectId(dto.organizationId) : undefined;
    }

    if (dto.siteId === undefined) {
      await this.healMissingSiteId(doc);
    }

    const nextCounterparty =
      dto.counterpartyId !== undefined
        ? dto.counterpartyId
        : doc.counterpartyId.toString();
    if (dto.counterpartyId !== undefined) {
      doc.counterpartyId = new Types.ObjectId(dto.counterpartyId);
    }
    if (dto.siteId !== undefined) {
      await this.sites.assertBelongsTo(dto.siteId, nextCounterparty);
      doc.siteId = new Types.ObjectId(dto.siteId);
    } else if (dto.counterpartyId !== undefined) {
      await this.sites.assertBelongsTo(doc.siteId.toString(), nextCounterparty);
    }
    if (dto.items !== undefined) {
      this.assertTrailingLinesDeletable(doc.items ?? [], dto.items.length);
      doc.items = this.mapItems(dto.items, doc.items);
      doc.total = doc.items.reduce((s, i) => s + i.total, 0);
    }
    try {
      return await doc.save();
    } catch (err: unknown) {
      if ((err as { code?: number })?.code === 11000) {
        throw new ConflictException('Номер уже занят');
      }
      throw err;
    }
  }

  /** TZ-PRODUCTION-331 — legacy orders without siteId fail mongoose required on any save. */
  private async healMissingSiteId(doc: OrderDocument): Promise<void> {
    if (doc.siteId) return;
    const counterpartyId = doc.counterpartyId?.toString();
    if (!counterpartyId || !Types.ObjectId.isValid(counterpartyId)) {
      throw new BadRequestException(MISSING_SITE_RU);
    }
    const sites = await this.sites.findByCounterparty(counterpartyId);
    const first = sites[0];
    if (!first?._id) {
      throw new BadRequestException(MISSING_SITE_RU);
    }
    doc.siteId = first._id;
  }

  async reserveStock(
    id: string,
    warehouseId: string,
    zoneName?: string,
    organizationId?: string | null,
  ): Promise<{ order: OrderDocument; reservationIds: string[] }> {
    return this.sessionRunner.run(async (session) => {
      const order = await this.model.findById(id).session(session).exec();
      if (!order) throw new NotFoundException(`Order ${id} not found`);
      this.assertOrgAccess(order, organizationId);
      const reservationIds: string[] = [];
      for (const item of order.items) {
        const reservation = await this.reservationService.create(
          {
            orderId: order.number,
            productId: item.productId.toString(),
            warehouseId,
            qty: item.quantity,
            zoneName,
          },
          session,
        );
        reservationIds.push(reservation._id.toString());
      }
      order.reservationIds = [
        ...(order.reservationIds ?? []),
        ...reservationIds.map((rid) => new Types.ObjectId(rid)),
      ];
      order.status = 'confirmed';
      await order.save({ session });
      return { order, reservationIds };
    });
  }

  async ship(
    id: string,
    recipient?: string,
    address?: string,
    warehouseId?: string,
    driverInfo?: string,
    partialItems?: ShipOrderItemDto[],
    organizationId?: string | null,
  ): Promise<{ order: OrderDocument; shipmentId: string }> {
    // Z-001 / TZ-SUPPLY-312: shipment creation + order update are atomic.
    return this.sessionRunner.run(async (session) => {
      const order = await this.model.findById(id).session(session).exec();
      if (!order) throw new NotFoundException(`Order ${id} not found`);
      this.assertOrgAccess(order, organizationId);
      if (
        order.status === 'cancelled' ||
        order.status === 'shipped' ||
        order.status === 'delivered'
      ) {
        throw new NotFoundException(`Cannot ship order in status ${order.status}`);
      }
      if (warehouseId && !Types.ObjectId.isValid(warehouseId)) {
        throw new BadRequestException('Invalid warehouseId');
      }

      const isPartial = partialItems !== undefined;
      let shipmentItems: Array<{
        lineId: string;
        productId: Types.ObjectId;
        productName?: string;
        quantity: number;
        unit?: string;
      }>;

      if (isPartial) {
        if (partialItems.length === 0) {
          throw new BadRequestException('Выберите хотя бы одну позицию для отгрузки');
        }
        const existing = await this.shipmentModel
          .find({ orderId: order._id, status: { $ne: 'cancelled' } })
          .session(session)
          .exec();
        const shippedByLine = new Map<string, number>();
        for (const shipment of existing) {
          for (const item of shipment.items ?? []) {
            if (item.lineId) {
              shippedByLine.set(
                item.lineId,
                (shippedByLine.get(item.lineId) ?? 0) + item.quantity,
              );
            }
          }
        }
        const lines = new Map<string, OrderItem>();
        for (let index = 0; index < order.items.length; index++) {
          const line = order.items[index];
          line.lineId ??= `legacy-${index}-${order._id.toString()}`;
          lines.set(line.lineId, line);
        }
        shipmentItems = partialItems.map((requested) => {
          const line = lines.get(requested.lineId);
          if (!line) throw new NotFoundException(`Order line ${requested.lineId} not found`);
          if (!(requested.quantity > 0)) {
            throw new BadRequestException('Количество отгружаемой позиции должно быть больше нуля');
          }
          const alreadyShipped = shippedByLine.get(requested.lineId) ?? 0;
          if (alreadyShipped + requested.quantity > line.quantity) {
            throw new BadRequestException(
              `Нельзя отгрузить больше остатка позиции «${line.productName ?? requested.lineId}»`,
            );
          }
          return {
            lineId: requested.lineId,
            productId: line.productId,
            productName: line.productName,
            quantity: requested.quantity,
            unit: line.unit,
          };
        });

        const allComplete = order.items.every((line) => {
          const lineId = line.lineId!;
          const inRequest = shipmentItems
            .filter((item) => item.lineId === lineId)
            .reduce((sum, item) => sum + item.quantity, 0);
          return (shippedByLine.get(lineId) ?? 0) + inRequest >= line.quantity;
        });
        if (allComplete) {
          order.status = 'shipped';
        }
      } else {
        shipmentItems = order.items.map((line, index) => ({
          lineId: line.lineId ?? `legacy-${index}-${order._id.toString()}`,
          productId: line.productId,
          productName: line.productName,
          quantity: line.quantity,
          unit: line.unit,
        }));
        order.status = 'shipped';
      }

      const number = isPartial
        ? await this.counter.next('Shipment', 'SHP')
        : `SHP-${order.number}`;
      const [shipment] = await this.shipmentModel.create(
        [
          {
            number,
            orderId: order._id,
            organizationId: organizationId ? new Types.ObjectId(organizationId) : undefined,
            counterpartyId: order.counterpartyId,
            recipient,
            address,
            warehouseId: warehouseId ? new Types.ObjectId(warehouseId) : undefined,
            driverInfo,
            status: 'scheduled',
            items: shipmentItems,
          },
        ],
        { session },
      );
      if (!shipment) throw new NotFoundException('Shipment create failed');
      order.shipmentIds = [
        ...(order.shipmentIds ?? []),
        new Types.ObjectId(shipment._id.toString()),
      ];
      if (order.status === 'shipped') {
        // TZ-SWEEP-401: only a fully shipped order moves every line to shipped.
        for (const item of order.items) {
          item.status = 'shipped';
          item.boardLane = 'shipped';
        }
      }
      const saved = await order.save({ session });
      return { order: saved, shipmentId: shipment._id.toString() };
    });
  }

  async cancel(id: string, organizationId?: string | null): Promise<OrderDocument> {
    return this.sessionRunner.run(async (session) => {
      const order = await this.model.findById(id).session(session).exec();
      if (!order) throw new NotFoundException(`Order ${id} not found`);
      this.assertOrgAccess(order, organizationId);
      const failures: string[] = [];
      for (const rid of order.reservationIds ?? []) {
        try {
          await this.reservationService.release(rid.toString());
        } catch (e) {
          const msg = (e as Error).message ?? String(e);
          this.logger.warn(`Reservation ${rid} release on cancel failed: ${msg}`);
          failures.push(rid.toString());
        }
      }
      if (failures.length > 0) {
        this.logger.error(
          `Cancel failed: ${failures.length} reservation(s) could not be released — rolling back`,
        );
        throw new Error(
          `Cancel aborted; reservation release failures: ${failures.join(', ')}`,
        );
      }
      order.status = 'cancelled';
      await order.save({ session });
      return order;
    });
  }

  async remove(id: string, organizationId?: string | null): Promise<void> {
    const doc = await this.findById(id);
    this.assertOrgAccess(doc, organizationId);
    await this.model
      .updateOne(
        { _id: doc._id },
        { $set: { deletedAt: new Date(), isActive: false } },
      )
      .exec();
  }
}
