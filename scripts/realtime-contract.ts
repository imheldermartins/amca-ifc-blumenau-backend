import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const backendRoot = resolve(scriptDirectory, "..");
const sourcePath = resolve(backendRoot, "src/services/realtime/contracts/realtime-contract-v1.ts");
const frontendRoot = process.env.CUBS_FRONTEND_ROOT?.trim()
  ? resolve(process.env.CUBS_FRONTEND_ROOT)
  : resolve(backendRoot, "../cubs-frontend");
const targetPath = resolve(
  frontendRoot,
  "src/services/realtime-contract-v1.ts",
);

function normalizeLineEndings(value: string): string {
  return value.replace(/\r\n/g, "\n");
}

async function main(): Promise<void> {
  const mode = process.argv[2];
  if (mode !== "sync" && mode !== "check") {
    throw new Error("Uso: realtime-contract.ts <sync|check>");
  }

  const canonical = await readFile(sourcePath, "utf8");

  if (/^\s*import\s/m.test(canonical)) {
    throw new Error(
      `O contrato canônico deve ser portátil e não pode conter imports: ${sourcePath}`,
    );
  }

  if (mode === "sync") {
    await writeFile(targetPath, canonical, "utf8");
    console.log(`Contrato realtime v1 sincronizado em ${targetPath}`);
    return;
  }

  let generated: string;
  try {
    generated = await readFile(targetPath, "utf8");
  } catch {
    throw new Error(
      `Cópia frontend ausente. Rode npm run realtime:contract:sync (${targetPath})`,
    );
  }

  if (normalizeLineEndings(generated) !== normalizeLineEndings(canonical)) {
    throw new Error(
      "Contrato realtime v1 divergente entre backend e frontend. " +
        "Rode npm run realtime:contract:sync no cubs-backend e versione a cópia gerada.",
    );
  }

  console.log("Contrato realtime v1 sincronizado entre backend e frontend.");
}

await main();
