import { DB_RAFT_URL } from "@/constants/database";

export class DatabaseWaiter {
  public constructor(
    private readonly attempts = Number(process.env.DATABASE_WAIT_ATTEMPTS) || 30,
    private readonly intervalMs = Number(process.env.DATABASE_WAIT_INTERVAL_MS) || 2_000,
  ) {}

  public async wait(): Promise<void> {
    const readyUrl = new URL("/readyz", DB_RAFT_URL);
    for (let attempt = 1; attempt <= this.attempts; attempt += 1) {
      try {
        const response = await fetch(readyUrl, { signal: AbortSignal.timeout(3_000) });
        if (response.ok) {
          console.log(`[backend] rqlite pronto em ${readyUrl.origin}`);
          return;
        }
      } catch {
        // O próximo ciclo registra o progresso sem expor detalhes de rede.
      }

      if (attempt < this.attempts) {
        console.log(`[backend] Aguardando rqlite (${attempt}/${this.attempts})...`);
        await new Promise<void>((resolve) => setTimeout(resolve, this.intervalMs));
      }
    }
    throw new Error(`[backend] rqlite indisponível após ${this.attempts} tentativas`);
  }
}

await new DatabaseWaiter().wait();
