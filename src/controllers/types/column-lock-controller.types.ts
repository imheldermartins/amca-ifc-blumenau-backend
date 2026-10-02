export interface ColumnLockEditorDto {
  id: string;
  name: string | null;
  email: string;
}

export interface ColumnLockConfigurationDto {
  locks: Record<string, { userIds: string[] }>;
  canManage: boolean;
  editors: ColumnLockEditorDto[];
}
