import type { NextFunction, Request, Response } from 'express';

import columnLockStore from '@/repositories/column-lock-repository';
import { StatusCode } from '@/services/http/status-code';

function userId(request: Request): NonEmptyString | null {
  return typeof request.userId === 'string' && request.userId
    ? request.userId as NonEmptyString
    : null;
}

function denied(response: Response): void {
  response.status(StatusCode.FORBIDDEN).json({ message: 'Coluna bloqueada para edição' });
}

/** Protege schema e células de uma coluna real. A autorização base roda antes. */
export function requireUnlockedColumn(parentParam?: string) {
  return async (request: Request, response: Response, next: NextFunction): Promise<void> => {
    const actorId = userId(request);
    const columnId = request.params.column_id;
    if (!actorId || typeof columnId !== 'string') {
      response.status(StatusCode.UNAUTHORIZED).json({ message: 'Não autorizado' });
      return;
    }
    try {
      const directParent = parentParam ? request.params[parentParam] : undefined;
      const parentId = typeof directParent === 'string'
        ? directParent
        : await columnLockStore.columnParentId(columnId as NonEmptyString);
      if (!parentId || !await columnLockStore.canMutate(
        parentId as NonEmptyString,
        columnId,
        actorId,
      )) {
        denied(response);
        return;
      }
      next();
    } catch {
      response.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: 'Erro no servidor' });
    }
  };
}

/** `pages.title` funciona como a coluna sintética `title` da database parent. */
export async function requireUnlockedPageTitle(
  request: Request,
  response: Response,
  next: NextFunction,
): Promise<void> {
  if (!request.body || !Object.prototype.hasOwnProperty.call(request.body, 'title')) {
    next();
    return;
  }
  const actorId = userId(request);
  const pageId = request.params.id;
  if (!actorId || typeof pageId !== 'string') {
    response.status(StatusCode.UNAUTHORIZED).json({ message: 'Não autorizado' });
    return;
  }
  try {
    const parentId = await columnLockStore.rowParentId(pageId as NonEmptyString);
    if (!parentId) {
      next();
      return;
    }
    if (!await columnLockStore.canMutate(parentId as NonEmptyString, 'title', actorId)) {
      denied(response);
      return;
    }
    next();
  } catch {
    response.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: 'Erro no servidor' });
  }
}
