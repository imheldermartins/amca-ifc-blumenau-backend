/** Os links de e-mail abrem telas; segredos e ações de escrita não entram na URL. */
export function validateEmailActionUrl(value: string): string {
  const url = new URL(value);
  const isLoopback = url.hostname === "localhost" || url.hostname.endsWith(".localhost")
    || /^127(?:\.\d{1,3}){3}$/.test(url.hostname) || url.hostname === "[::1]";
  if (process.env.NODE_ENV === "production" && isLoopback) {
    throw new Error("URL de ação do e-mail não pode usar localhost em produção.");
  }
  const query = [...url.searchParams.entries()];
  const hasSafeReturnTo = query.length === 1
    && query[0]?.[0] === "returnTo"
    && /^\/[a-z]{2}-[a-z]{2}\/organizations\/new$/i.test(query[0][1]);
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password
    || url.hash || (query.length > 0 && !hasSafeReturnTo)) {
    throw new Error("URL de ação do e-mail inválida.");
  }
  if (url.protocol !== "https:" && !isLoopback) {
    throw new Error("URL pública de ação exige HTTPS.");
  }
  return url.toString();
}
