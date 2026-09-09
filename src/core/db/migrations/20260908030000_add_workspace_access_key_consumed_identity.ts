import { type Migration } from "../migrator.js";

export const migration: Migration = {
  id: "20260908030000_add_workspace_access_key_consumed_identity",
  up: [
    // issued_to_* permanece a identidade declarada na emissão. consumed_as_*
    // registra o que o usuário confirmou/editou no consumo para auditoria.
    `ALTER TABLE workspace_access_keys ADD COLUMN consumed_as_name TEXT`,
    `ALTER TABLE workspace_access_keys ADD COLUMN consumed_as_email TEXT`,
  ],
  down: [
    `ALTER TABLE workspace_access_keys DROP COLUMN consumed_as_email`,
    `ALTER TABLE workspace_access_keys DROP COLUMN consumed_as_name`,
  ],
};
