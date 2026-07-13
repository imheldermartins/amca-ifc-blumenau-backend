import { SQLBuilder } from "@db/sql-builder";
import { Model } from "@/core/db/model";
import db from "@models/index";
import type { Schema } from "@/models/schemas/index";

/**
 * Teste de SQL injection do Cub's — demonstra que a camada de dados (Model /
 * SQLBuilder) parametriza TODA entrada, fechando o vetor de injeção que existia
 * quando os valores eram concatenados no texto do SQL.
 *
 * Roda de forma NÃO-DESTRUTIVA: as provas de leitura usam `find` (SELECT) e a
 * prova de escrita usa uma tabela descartável `injection_probe`, criada e
 * apagada pelo próprio teste. Exige o rqlite dev de pé (npm run migrate feito).
 *
 * Execução: npm run test:sql-injection
 */

// Payloads clássicos de ataque.
const BYPASS = "' OR '1'='1";                 // tenta tornar o WHERE sempre verdadeiro
const APOSTROPHE = "o'brien@example.com";     // aspas simples que antes quebravam a query
const DROP = "x'; DROP TABLE injection_probe;--"; // tenta encerrar a query e dropar a tabela

let passed = 0;
let failed = 0;

function check(label: string, condition: boolean, detail?: string): void {
  if (condition) {
    passed += 1;
    console.log(`   ✓ PASS  ${label}`);
  } else {
    failed += 1;
    console.log(`   ✗ FAIL  ${label}${detail ? ` -- ${detail}` : ""}`);
  }
}

function heading(text: string): void {
  console.log(`\n${text}\n${"-".repeat(text.length)}`);
}

/** Reproduz o método ANTIGO (interpolação) só para exibir o SQL vulnerável. */
function legacyInterpolatedSql(email: string): string {
  // Era exatamente isto que o SQLBuilder fazia: `'${value}'` sem escape.
  return `SELECT * FROM users WHERE email = '${email}'`;
}

async function main(): Promise<void> {
  console.log("=".repeat(70));
  console.log(" TESTE DE SQL INJECTION — Cub's (camada Model/SQLBuilder)");
  console.log("=".repeat(70));

  // ── PASSO 1: reprodução da vulnerabilidade (o que o código ANTIGO gerava) ──
  heading("PASSO 1 — Reproducao: o SQL que a versao ANTIGA (interpolada) gerava");
  const legacy = legacyInterpolatedSql(BYPASS);
  console.log(`   payload........: ${BYPASS}`);
  console.log(`   SQL resultante.: ${legacy}`);
  console.log("   analise........: o WHERE vira `email = '' OR '1'='1'` -> SEMPRE");
  console.log("                    verdadeiro. Retornaria TODOS os usuarios (bypass).");
  console.log(`   e com apostrofo: ${legacyInterpolatedSql(APOSTROPHE)}`);
  console.log("                    -> aspas quebram a sintaxe (o crash que vimos no seed).");
  check("SQL interpolado contem o payload (prova de que era injetavel)",
    legacy.includes("OR '1'='1"));

  // ── PASSO 2: correção — o SQLBuilder agora PARAMETRIZA ──
  heading("PASSO 2 — Correcao: o SQLBuilder novo devolve statement parametrizado");
  const stmt = new SQLBuilder<Schema.User>("users").read({ email: BYPASS } as LookupValues<Schema.User>);
  console.log(`   payload........: ${BYPASS}`);
  console.log(`   text...........: ${stmt.text}`);
  console.log(`   values.........: ${JSON.stringify(stmt.values)}`);
  console.log("   analise........: o valor virou bind (?). O texto do SQL nao contem");
  console.log("                    mais nada do payload -- nao ha o que injetar.");
  check("text usa placeholder `?` (nao concatena o valor)", stmt.text.includes("?"));
  check("text NAO contem o payload de bypass", !stmt.text.includes("OR '1'='1"));
  check("payload aparece intacto em values[] (ligado por bind)", stmt.values.includes(BYPASS));

  // Identificador malicioso (coluna) tambem eh barrado.
  let identifierBlocked = false;
  try {
    new SQLBuilder<Schema.User>("users").read({ "email = '' OR 1=1 --": "x" } as unknown as LookupValues<Schema.User>);
  } catch {
    identifierBlocked = true;
  }
  check("identificador de coluna invalido eh rejeitado (assertIdentifier)", identifierBlocked);

  // ── PASSO 3: prova ao vivo contra o rqlite ──
  heading("PASSO 3 — Prova ao vivo contra o rqlite (dados reais do seed)");

  // 3a. A vulnerabilidade era REAL: rodando o SQL interpolado cru (via sqlRaw,
  //     leitura), o bypass de fato retorna usuarios.
  const bypassRows = await db.sqlRaw<{ id: string; email: string }>(
    `SELECT id, email FROM users WHERE email = '' OR '1'='1' LIMIT 3`,
    "query",
  );
  console.log(`   3a. SQL interpolado cru retornou ${bypassRows.length} usuario(s) -> bypass REAL`);
  check("o bypass interpolado realmente vaza linhas (confirma o risco)", bypassRows.length > 0);

  // 3b. Pelo caminho corrigido (Model.find), o MESMO payload nao vaza nada:
  //     procura-se literalmente o email "' OR '1'='1", que nao existe.
  const bypassFixed = await db.users.find({ email: BYPASS } as LookupValues<Schema.User>);
  console.log(`   3b. db.users.find({ email: bypass }) -> ${bypassFixed === null ? "null" : "ACHOU (!!)"}`);
  check("caminho corrigido NAO vaza usuarios com o payload de bypass", bypassFixed === null);

  // 3c. Aspas simples nao quebram mais: retorna null, sem lancar.
  let apostropheThrew = false;
  let apostropheResult: Schema.User | null = null;
  try {
    apostropheResult = await db.users.find({ email: APOSTROPHE } as LookupValues<Schema.User>);
  } catch (error) {
    apostropheThrew = true;
    console.log(`   3c. lancou: ${(error as Error).message}`);
  }
  console.log(`   3c. db.users.find({ email: "o'brien@..." }) -> ${apostropheThrew ? "THREW" : String(apostropheResult)}`);
  check("valor com aspa simples NAO quebra a query (sem throw)", !apostropheThrew);

  // 3d. Integridade: numa tabela descartavel, um payload de DROP via caminho de
  //     ESCRITA (Model.delete) nao dropa nada -- o payload eh so um valor.
  await db.sqlRaw(`CREATE TABLE IF NOT EXISTS injection_probe (id TEXT PRIMARY KEY, email TEXT)`, "execute");
  await db.sqlRaw(`DELETE FROM injection_probe`, "execute");
  await db.sqlRaw(`INSERT INTO injection_probe (id, email) VALUES ('01PROBE', 'safe@probe.local')`, "execute");

  const probe = new Model<{ id: string; email: string }>("injection_probe");
  await probe.delete({ email: DROP } as LookupValues<{ id: string; email: string }>);

  const stillThere = await db.sqlRaw<{ n: number }>(
    `SELECT COUNT(*) AS n FROM injection_probe`,
    "query",
  );
  const rowCount = stillThere[0]?.n ?? -1;
  console.log(`   3d. apos delete com payload de DROP, injection_probe tem ${rowCount} linha(s)`);
  check("tabela sobrevive ao payload de DROP (linha intacta)", rowCount === 1);

  // Limpeza da tabela de prova.
  await db.sqlRaw(`DROP TABLE IF EXISTS injection_probe`, "execute");

  // ── Resultado ──
  heading("RESULTADO");
  console.log(`   ${passed} passaram, ${failed} falharam.`);
  if (failed > 0) {
    console.log("   ✗ Ha falhas -- a protecao NAO esta completa.");
    process.exit(1);
  }
  console.log("   ✓ Todas as entradas sao parametrizadas: injecao neutralizada.");
}

main().catch((error) => {
  console.error(`[sql-injection-test] ${error instanceof Error ? error.stack : error}`);
  process.exit(1);
});
