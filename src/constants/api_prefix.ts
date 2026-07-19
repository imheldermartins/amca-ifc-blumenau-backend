/**
 * Prefixo comum de TODAS as rotas de dados (users, pages, workspaces, auth).
 * Aplicado num ponto só, no mountRoutes do HttpServer -- os routers continuam
 * declarando caminhos relativos ao próprio recurso ("/", "/:id", ...).
 *
 * O swagger (`/api-docs`) fica FORA do prefixo: é UI, não rota de dados. Os
 * comentários @openapi também seguem sem o prefixo -- quem o adiciona no spec
 * é o `servers` do swagger.config.ts, a partir desta mesma constante.
 */
export const API_PREFIX = "/api";
