import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { EntityStatus, EntityStatusDocument } from './entity-status.schema';
import { StatusWorkflow, StatusWorkflowDocument, Transition } from './status-workflow.schema';

@Injectable()
export class StatusService {
  private readonly logger = new Logger(StatusService.name);

  constructor(
    @InjectModel(EntityStatus.name)
    private readonly statusModel: Model<EntityStatusDocument>,
    @InjectModel(StatusWorkflow.name)
    private readonly workflowModel: Model<StatusWorkflowDocument>,
  ) {}

  // --- EntityStatus ---

  async findStatuses(entityType: string): Promise<EntityStatusDocument[]> {
    return this.statusModel
      .find({ entityType })
      .sort({ sortOrder: 1, statusId: 1 })
      .exec();
  }

  async createStatus(data: Partial<EntityStatus>): Promise<EntityStatusDocument> {
    return this.statusModel.create(data);
  }

  async updateStatus(
    entityType: string,
    statusId: string,
    data: Partial<EntityStatus>,
  ): Promise<EntityStatusDocument> {
    const doc = await this.statusModel
      .findOneAndUpdate({ entityType, statusId }, { $set: data }, { new: true })
      .exec();
    if (!doc) throw new NotFoundException(`Status ${entityType}/${statusId} not found`);
    return doc;
  }

  // --- StatusWorkflow ---

  async findWorkflows(entityType: string): Promise<StatusWorkflowDocument[]> {
    return this.workflowModel.find({ entityType, isActive: true }).exec();
  }

  async createWorkflow(data: Partial<StatusWorkflow>): Promise<StatusWorkflowDocument> {
    return this.workflowModel.create(data);
  }

  /**
   * Throws BadRequestException if no active workflow allows the transition
   * for the given user role. Returns the matching transition on success.
   */
  async assertTransition(
    entityType: string,
    fromStatus: string,
    toStatus: string,
    userRole: string,
  ): Promise<Transition> {
    if (fromStatus === toStatus) {
      throw new BadRequestException('Status is already the requested value');
    }

    const workflows = await this.workflowModel
      .find({ entityType, isActive: true })
      .lean()
      .exec();

    if (workflows.length === 0) {
      throw new BadRequestException(
        `No active workflow defined for "${entityType}"`,
      );
    }

    for (const wf of workflows) {
      const t = wf.transitions.find(
        (x) => x.fromStatus === fromStatus && x.toStatus === toStatus,
      );
      if (!t) continue;
      if (t.roles.length === 0 || t.roles.includes(userRole)) {
        return t;
      }
    }

    throw new BadRequestException(
      `Transition ${entityType}:${fromStatus} → ${toStatus} not allowed for role "${userRole}"`,
    );
  }
}
