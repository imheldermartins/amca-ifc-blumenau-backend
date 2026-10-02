export interface ColumnLocksDocument {
  [columnKey: string]: { userIds: string[] };
}

export interface ColumnLockEditorRow {
  id: NonEmptyString;
  name: string | null;
  email: string;
}
