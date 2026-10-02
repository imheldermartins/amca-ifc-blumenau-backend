import type { Schema } from '@/db/schemas/index';

export interface NotificationDto {
  id: string;
  workspaceId: string;
  type: Schema.NotificationType;
  resourceType: Schema.NotificationResourceType;
  resourceId: string;
  actor: { id: string; name: string | null; email: string } | null;
  data: Record<string, unknown>;
  readAt: string | null;
  createdAt: string;
}
