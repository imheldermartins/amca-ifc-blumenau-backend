import { DB_RAFT_URL } from "@/constants/database";
import type { FetchImplementation } from "@/services/http/types/database-health.types";

const DATABASE_READINESS_TIMEOUT_MS = 3_000;

export class DatabaseHealthService {
  public constructor(
    private readonly baseUrl: string = DB_RAFT_URL,
    private readonly fetchImplementation: FetchImplementation = fetch,
    private readonly timeoutMs: number = DATABASE_READINESS_TIMEOUT_MS,
  ) {}

  public async isReady(): Promise<boolean> {
    try {
      const response = await this.fetchImplementation(`${this.baseUrl}/readyz`, {
        method: "GET",
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}

export default new DatabaseHealthService();
