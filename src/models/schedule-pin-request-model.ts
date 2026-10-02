import { schemaRegistry } from '@/db/rqlite.generated';
import type { Schema } from '@/db/schemas/index';
import { Model } from '@/repositories/model';

const schedulePinRequests = new Model<Schema.SchedulePinRequest>(
  schemaRegistry.schedule_pin_requests,
);

export { schedulePinRequests };
