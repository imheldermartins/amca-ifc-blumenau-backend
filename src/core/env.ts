/**
 * Discriminador de ambiente — a fonte ÚNICA de "estamos em produção?".
 *
 * A regra é FAIL-SAFE de propósito: `NODE_ENV` ausente conta como PRODUÇÃO.
 * O contrário (default dev) seria a pior combinação possível — um deploy que
 * esqueceu a variável rodaria com segredo de desenvolvimento, CORS aberto e
 * cookie sem `Secure`, tudo em silêncio. Assim, esquecer a variável dá um erro
 * barulhento no boot; e o ambiente de dev DECLARA que é dev
 * (`NODE_ENV=development` no `.env.development`), que é o que ele já faz ao
 * carregar aquele arquivo.
 */
export const NODE_ENV = process.env.NODE_ENV ?? "production";

export const isDevelopment = NODE_ENV === "development";
export const isProduction = !isDevelopment;

/**
 * Aviso de configuração frouxa, uma vez por assunto. Em dev várias coisas são
 * toleradas (segredo fraco, CORS default) — mas toleradas em SILÊNCIO viram
 * surpresa no dia do deploy, e repetidas a cada request viram ruído que
 * ninguém lê.
 */
const warned = new Set<string>();

export function warnOnce(topic: string, message: string): void {
  if (warned.has(topic)) return;
  warned.add(topic);
  console.warn(`[cubs:config] ${message}`);
}
