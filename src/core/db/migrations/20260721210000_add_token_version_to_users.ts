import { type Migration } from '../migrator.js';

export const migration: Migration = {
  id: '20260721210000_add_token_version_to_users',
  up: [
    /**
     * token_version — o kill switch da sessão.
     *
     * O refresh token é um JWT stateless: sem nada no servidor, apagar o
     * cookie no logout NÃO invalida uma cópia roubada, que seguiria valendo
     * pelos 7 dias inteiros. Este inteiro resolve isso com o menor estado
     * possível: o refresh carrega o `tv` do momento da emissão, e a validação
     * compara com o valor atual da linha. Logout (e, no futuro, troca de
     * senha) incrementa — todos os refresh já emitidos para a conta morrem de
     * uma vez.
     *
     * Custo: UMA leitura por refresh (a cada 15 min por sessão, no máximo).
     * O access token continua 100% stateless, sem leitura nenhuma.
     *
     * Granularidade é por CONTA, não por dispositivo — revogar só um aparelho
     * exigiria uma tabela de `jti`, que é o degrau seguinte e não este.
     */
    `ALTER TABLE users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 0`
  ],
  down: [
    `ALTER TABLE users DROP COLUMN token_version`
  ]
};
