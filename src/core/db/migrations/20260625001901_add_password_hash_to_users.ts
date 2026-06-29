import { type Migration } from '../migrator.js';

export const migration: Migration = {
  id: '20260625001901_add_password_hash_to_users',
  up: [
    /**
     * password_hash
     * - Armazena o hash bcrypt da senha do usuário (sempre 60 caracteres).
     * - Nullable: usuários criados via POST /users (cadastro administrativo, só email)
     *   ficam sem hash e simplesmente não conseguem logar até definirem uma senha.
     */
    `ALTER TABLE users ADD COLUMN password_hash TEXT`
  ],
  down: [
    `ALTER TABLE users DROP COLUMN password_hash`
  ]
};
