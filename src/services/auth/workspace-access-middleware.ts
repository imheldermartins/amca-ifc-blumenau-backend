import { requireScopedPermission } from './scoped-access-middleware.js';
import type { WorkspaceAction, WorkspaceSubject } from './workspace-ability.js';
export function requireWorkspaceAbility(action: WorkspaceAction, subject: WorkspaceSubject, param = 'id') {
  return requireScopedPermission('workspace', action === 'read' ? 'read' : 'write',
    subject === 'WorkspaceMembers' ? (action === 'read' ? 'members' : 'promote_members') : action === 'read' ? 'view' : 'update', param);
}
