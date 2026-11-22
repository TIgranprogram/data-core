import { Controller, Get, Query } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { Model, type PipelineStage, type Types } from 'mongoose';
import { openSectionsFor, sectionOpen } from '../../common/app-sections';
import { AppSection } from '../../common/decorators/app-section.decorator';
import { CurrentUser, type AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { escapeRe } from '../../common/list-query';
import { canSeeMoney } from '../../common/roles-hierarchy';
import { ARCHIVES, type ArchiveFile } from './order-archive.schema';
import { SalesOrder, type SalesOrderDocument } from './sales-order.schema';

class OrderActsQuery {
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1_000_000)
  page = 1;

  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  limit = 25;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200)
  search?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100)
  order?: string;

  @ApiPropertyOptional({ enum: ['live', 'archived'] }) @IsOptional() @IsIn(['live', 'archived'])
  state?: 'live' | 'archived';
}

type Act = {
  orderId: Types.ObjectId;
  orderNo?: string;
  productionNo?: string;
  customer?: string;
  uid: string;
  date?: string;
  number?: string;
  fileId?: Types.ObjectId;
  archiveVersion?: number;
};
type ArchiveFiles = { orderId: Types.ObjectId; version: number; files: ArchiveFile[] };

@ApiTags('Документация')
@AppSection('passports')
@Controller('documents/acts')
export class OrderActsController {
  constructor(
    @InjectModel(SalesOrder.name) private readonly orders: Model<SalesOrderDocument>,
    @InjectModel(ARCHIVES) private readonly archives: Model<ArchiveFiles>,
  ) {}

  @Get()
  @Roles('admin', 'director', 'manager')
  async list(@Query() q: OrderActsQuery, @CurrentUser() actor: AuthenticatedUser) {
    const { page, limit, state } = q;
    const search = q.search?.trim();
    const order = q.order?.trim();
    const activeArchive = { $gt: 0 };
    const includeFile = !actor.keyScope && canSeeMoney(actor) && sectionOpen(openSectionsFor(actor), 'salesorders');
    const pipeline: PipelineStage[] = [
      { $match: { deletedAt: null, 'legal.documents.kind': 'acceptance',
        ...(state ? { activeArchiveVersion: state === 'archived' ? activeArchive : { $not: activeArchive } } : {}),
        ...(order ? { $or: ['orderNo', 'productionNo'].map(key => ({ [key]: new RegExp('^' + escapeRe(order) + '$', 'i') })) } : {}) } },
      { $unwind: '$legal.documents' },
      { $match: { 'legal.documents.kind': 'acceptance' } },
      ...(search ? [{ $match: { $or: ['legal.documents.number', 'orderNo', 'productionNo', 'customer'].map(key => ({ [key]: new RegExp(escapeRe(search), 'i') })) } }] : []),
      { $sort: { 'legal.documents.date': -1, 'legal.documents.at': -1, _id: 1, 'legal.documents.uid': 1 } },
      { $facet: {
        count: [{ $count: 'total' }],
        items: [
          { $skip: (page - 1) * limit }, { $limit: limit },
          { $project: { _id: 0, orderId: '$_id', orderNo: 1, productionNo: 1, customer: 1, uid: '$legal.documents.uid',
            date: '$legal.documents.date', number: '$legal.documents.number', archiveVersion: '$activeArchiveVersion',
            ...(includeFile ? { fileId: '$legal.documents.fileId' } : {}) } },
        ],
      } },
    ];
    const [result] = await this.orders.aggregate<{ items: Act[]; count: Array<{ total: number }> }>(pipeline).exec();
    const rows = result?.items ?? [];
    const archived = includeFile && rows.filter(act => act.archiveVersion && act.fileId);
    const refs = archived ? [...new Map(archived.map(act => [act.orderId + ':' + act.archiveVersion,
      { orderId: act.orderId, version: act.archiveVersion }])).values()] : [];
    const files = refs.length ? await this.archives.find({ $or: refs })
      .select('orderId version files.id files.sourceId files.kind').lean().exec() : [];
    const archiveFiles = new Map(files.map(item => [item.orderId + ':' + item.version, item.files]));

    const items = rows.map(({ orderId, uid, fileId, archiveVersion, ...act }) => {
      // Архивный акт открывает копию из версии архива. Оригинал рабочего договора может иметь другой срок хранения.
      const id = String(orderId);
      const file = archiveVersion ? archiveFiles.get(id + ':' + archiveVersion)
        ?.find(item => item.kind === 'photo' && String(item.sourceId) === String(fileId))?.id : fileId?.toString();
      return {
        ...act, id: id + ':' + uid, orderId: id, name: 'Акт / УПД', fileId: file ?? null,
        ...(archiveVersion ? { archiveVersion } : {}),
      };
    });
    return { items, total: result?.count[0]?.total ?? 0, page, limit };
  }
}

