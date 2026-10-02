import type { NotificationDto } from '@/controllers/types/notification-controller.types';
import type { ServiceResult } from '@/controllers/types/service-result.types';
import type { Schema } from '@/db/schemas/index';
import notificationStore, { NotificationStore } from '@/repositories/notification-repository';
import type { NotificationRow } from '@/repositories/types/notification-repository.types';
import { isUlid } from '@/utils/ulid';

function parseData(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value !== 'string') return {};
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function project(row: NotificationRow): NotificationDto {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    type: row.type as Schema.NotificationType,
    resourceType: row.resource_type as Schema.NotificationResourceType,
    resourceId: row.resource_id,
    actor: row.actor_user_id && row.actor_email
      ? { id: row.actor_user_id, name: row.actor_name, email: row.actor_email }
      : null,
    data: parseData(row.data),
    readAt: row.read_at,
    createdAt: row.created_at,
  };
}

export class NotificationController {
  public constructor(private readonly store: NotificationStore = notificationStore) {}

  public async list(workspaceId: string, userId: string): Promise<ServiceResult<NotificationDto[]>> {
    if (!isUlid(workspaceId) || !isUlid(userId)) {
      return { ok: false, reason: 'validation', message: 'Notificações inválidas' };
    }
    try {
      const rows = await this.store.list(workspaceId as NonEmptyString, userId as NonEmptyString);
      return { ok: true, data: rows.map(project) };
    } catch (error) {
      this.log(error);
      return { ok: false, reason: 'server_error', message: 'Erro ao carregar notificações' };
    }
  }

  public async markRead(
    workspaceId: string,
    notificationId: string,
    userId: string,
  ): Promise<ServiceResult<null>> {
    if (!isUlid(workspaceId) || !isUlid(notificationId) || !isUlid(userId)) {
      return { ok: false, reason: 'validation', message: 'Notificação inválida' };
    }
    try {
      const saved = await this.store.markRead(
        workspaceId as NonEmptyString,
        userId as NonEmptyString,
        notificationId as NonEmptyString,
      );
      return saved
        ? { ok: true, data: null }
        : { ok: false, reason: 'not_found', message: 'Notificação não encontrada' };
    } catch (error) {
      this.log(error);
      return { ok: false, reason: 'server_error', message: 'Erro ao atualizar notificação' };
    }
  }

  private log(error: unknown): void {
    if (error instanceof Error) console.error(`[${error.cause}] ${error.message}`);
  }
}

export default new NotificationController();
