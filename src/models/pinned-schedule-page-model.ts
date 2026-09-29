import { schemaRegistry } from '@/db/rqlite.generated';
import type { Schema } from '@/db/schemas/index';
import { Model } from '@/repositories/model';

const pinnedSchedulePages = new Model<Schema.PinnedSchedulePage>(
  schemaRegistry.pinned_schedule_pages,
);

export { pinnedSchedulePages };
