import type { ServiceResult } from '@/controllers/types/service-result.types';
import type { ColumnLockConfigurationDto } from '@/controllers/types/column-lock-controller.types';
import columnLockStore, { ColumnLockStore } from '@/repositories/column-lock-repository';
import scopedAccessStore, { ScopedAccessStore } from '@/repositories/scoped-access-repository';
import { isUlid } from '@/utils/ulid';

export class ColumnLockController {
  public constructor(
    private readonly store: ColumnLockStore = columnLockStore,
    private readonly access: ScopedAccessStore = scopedAccessStore,
  ) {}

  public async get(parentId: string, userId: string): Promise<ServiceResult<ColumnLockConfigurationDto>> {
    if (!isUlid(parentId) || !isUlid(userId)) {
      return { ok: false, reason: 'validation', message: 'Configuração de bloqueio inválida' };
    }
    try {
      const [locks, canManage] = await Promise.all([
        this.store.list(parentId as NonEmptyString),
        this.access.can('page', parentId, userId, 'write', 'lock_columns'),
      ]);
      if (locks === null) return { ok: false, reason: 'not_found', message: 'Página não encontrada' };
      const editors = canManage
        ? await this.store.listEligibleEditors(parentId as NonEmptyString)
        : [];
      return { ok: true, data: { locks, canManage, editors } };
    } catch (error) {
      this.log(error);
      return { ok: false, reason: 'server_error', message: 'Erro ao carregar bloqueios' };
    }
  }

  public async titleStatus(
    pageId: string,
    userId: string,
  ): Promise<ServiceResult<{ locked: boolean; canEdit: boolean }>> {
    if (!isUlid(pageId) || !isUlid(userId)) {
      return { ok: false, reason: 'validation', message: 'Página inválida' };
    }
    try {
      const parentId = await this.store.rowParentId(pageId as NonEmptyString);
      if (!parentId) return { ok: true, data: { locked: false, canEdit: true } };
      const locks = await this.store.list(parentId as NonEmptyString);
      if (locks === null) return { ok: false, reason: 'not_found', message: 'Página não encontrada' };
      const titleLock = locks.title;
      return {
        ok: true,
        data: {
          locked: Boolean(titleLock),
          canEdit: !titleLock || titleLock.userIds.includes(userId),
        },
      };
    } catch (error) {
      this.log(error);
      return { ok: false, reason: 'server_error', message: 'Erro ao carregar bloqueio' };
    }
  }

  public async save(
    parentId: string,
    userId: string,
    input: { columnKey?: unknown; userIds?: unknown },
  ): Promise<ServiceResult<ColumnLockConfigurationDto>> {
    const columnKey = input.columnKey;
    const rawUserIds = input.userIds;
    if (
      !isUlid(parentId) || !isUlid(userId)
      || (columnKey !== 'title' && !isUlid(columnKey))
      || !Array.isArray(rawUserIds)
      || rawUserIds.some((id) => !isUlid(id))
    ) {
      return { ok: false, reason: 'validation', message: 'Configuração de bloqueio inválida' };
    }
    const userIds = [...new Set(rawUserIds as string[])] as NonEmptyString[];
    if (userIds.length > 0 && !userIds.includes(userId as NonEmptyString)) {
      return { ok: false, reason: 'validation', message: 'Quem ativa o bloqueio deve permanecer autorizado' };
    }
    try {
      const canManage = await this.access.can('page', parentId, userId, 'write', 'lock_columns');
      if (!canManage) return { ok: false, reason: 'forbidden', message: 'Acesso não permitido' };
      if (columnKey !== 'title' && !await this.store.columnBelongs(
        parentId as NonEmptyString,
        columnKey as NonEmptyString,
      )) {
        return { ok: false, reason: 'validation', message: 'Coluna não pertence a esta página' };
      }
      const editors = await this.store.listEligibleEditors(parentId as NonEmptyString);
      const eligibleIds = new Set(editors.map((editor) => editor.id));
      if (userIds.some((id) => !eligibleIds.has(id))) {
        return { ok: false, reason: 'validation', message: 'Usuário sem permissão de edição' };
      }
      const locks = await this.store.save(
        parentId as NonEmptyString,
        columnKey,
        userIds,
        userId as NonEmptyString,
      );
      return locks
        ? { ok: true, data: { locks, canManage: true, editors } }
        : { ok: false, reason: 'forbidden', message: 'Acesso não permitido' };
    } catch (error) {
      this.log(error);
      return { ok: false, reason: 'server_error', message: 'Erro ao salvar bloqueio' };
    }
  }

  private log(error: unknown): void {
    if (error instanceof Error) console.error(`[${error.cause}] ${error.message}`);
  }
}

export default new ColumnLockController();
