import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { StatusService } from '../../modules/status/status.service';

const DEFAULT_STATUSES = [
  // Proposal
  { entityType: 'Proposal', statusId: 'draft',     label: 'Draft',     color: '#9e9e9e', sortOrder: 1, isInitial: true,  isFinal: false },
  { entityType: 'Proposal', statusId: 'sent',      label: 'Sent',      color: '#2196f3', sortOrder: 2, isInitial: false, isFinal: false },
  { entityType: 'Proposal', statusId: 'accepted',  label: 'Accepted',  color: '#4caf50', sortOrder: 3, isInitial: false, isFinal: true  },
  { entityType: 'Proposal', statusId: 'rejected',  label: 'Rejected',  color: '#f44336', sortOrder: 4, isInitial: false, isFinal: true  },
  { entityType: 'Proposal', statusId: 'archived',  label: 'Archived',  color: '#607d8b', sortOrder: 5, isInitial: false, isFinal: true  },

  // Contract
  { entityType: 'Contract', statusId: 'draft',     label: 'Draft',     color: '#9e9e9e', sortOrder: 1, isInitial: true,  isFinal: false },
  { entityType: 'Contract', statusId: 'active',    label: 'Active',    color: '#4caf50', sortOrder: 2, isInitial: false, isFinal: false },
  { entityType: 'Contract', statusId: 'closed',    label: 'Closed',    color: '#607d8b', sortOrder: 3, isInitial: false, isFinal: true  },
  { entityType: 'Contract', statusId: 'terminated',label: 'Terminated',color: '#f44336', sortOrder: 4, isInitial: false, isFinal: true  },

  // Order
  { entityType: 'Order', statusId: 'new',         label: 'New',         color: '#9e9e9e', sortOrder: 1, isInitial: true,  isFinal: false },
  { entityType: 'Order', statusId: 'in_production',label: 'In production',color: '#ff9800', sortOrder: 2, isInitial: false, isFinal: false },
  { entityType: 'Order', statusId: 'ready',       label: 'Ready',       color: '#2196f3', sortOrder: 3, isInitial: false, isFinal: false },
  { entityType: 'Order', statusId: 'shipped',     label: 'Shipped',     color: '#3f51b5', sortOrder: 4, isInitial: false, isFinal: false },
  { entityType: 'Order', statusId: 'delivered',   label: 'Delivered',   color: '#4caf50', sortOrder: 5, isInitial: false, isFinal: true  },
  { entityType: 'Order', statusId: 'cancelled',   label: 'Cancelled',   color: '#f44336', sortOrder: 6, isInitial: false, isFinal: true  },
] as const;

const DEFAULT_WORKFLOWS = [
  {
    entityType: 'Proposal',
    name: 'default',
    statuses: ['draft', 'sent', 'accepted', 'rejected', 'archived'],
    transitions: [
      { fromStatus: 'draft',    toStatus: 'sent',     roles: ['admin', 'manager'] },
      { fromStatus: 'sent',     toStatus: 'accepted', roles: ['admin', 'manager'] },
      { fromStatus: 'sent',     toStatus: 'rejected', roles: ['admin', 'manager'] },
      { fromStatus: 'accepted', toStatus: 'archived', roles: ['admin'] },
      { fromStatus: 'rejected', toStatus: 'archived', roles: ['admin'] },
    ],
    isActive: true,
  },
  {
    entityType: 'Contract',
    name: 'default',
    statuses: ['draft', 'active', 'closed', 'terminated'],
    transitions: [
      { fromStatus: 'draft',      toStatus: 'active',     roles: ['admin', 'manager'] },
      { fromStatus: 'active',     toStatus: 'closed',     roles: ['admin', 'manager'] },
      { fromStatus: 'active',     toStatus: 'terminated', roles: ['admin'] },
    ],
    isActive: true,
  },
  {
    entityType: 'Order',
    name: 'default',
    statuses: ['new', 'in_production', 'ready', 'shipped', 'delivered', 'cancelled'],
    transitions: [
      { fromStatus: 'new',          toStatus: 'in_production', roles: ['admin', 'manager'] },
      { fromStatus: 'in_production',toStatus: 'ready',         roles: ['admin', 'manager'] },
      { fromStatus: 'ready',        toStatus: 'shipped',       roles: ['admin', 'manager'] },
      { fromStatus: 'shipped',      toStatus: 'delivered',     roles: ['admin', 'manager'] },
      { fromStatus: 'new',          toStatus: 'cancelled',     roles: ['admin', 'manager'] },
      { fromStatus: 'in_production',toStatus: 'cancelled',     roles: ['admin'] },
    ],
    isActive: true,
  },
];

@Injectable()
export class StatusesSeed implements OnApplicationBootstrap {
  private readonly logger = new Logger(StatusesSeed.name);

  constructor(private readonly status: StatusService) {}

  async onApplicationBootstrap(): Promise<void> {
    for (const s of DEFAULT_STATUSES) {
      const existing = await this.status
        .findStatuses(s.entityType)
        .then((arr) => arr.find((d) => d.statusId === s.statusId));
      if (existing) continue;
      try {
        await this.status.createStatus({ ...s });
        this.logger.log(`Status seeded: ${s.entityType}/${s.statusId}`);
      } catch (err) {
        this.logger.warn(`Could not seed Status ${s.entityType}/${s.statusId}: ${(err as Error).message}`);
      }
    }

    for (const w of DEFAULT_WORKFLOWS) {
      const existing = await this.status
        .findWorkflows(w.entityType)
        .then((arr) => arr.find((d) => d.name === w.name));
      if (existing) continue;
      try {
        await this.status.createWorkflow({ ...w });
        this.logger.log(`Workflow seeded: ${w.entityType}/${w.name}`);
      } catch (err) {
        this.logger.warn(`Could not seed Workflow ${w.entityType}/${w.name}: ${(err as Error).message}`);
      }
    }
  }
}
