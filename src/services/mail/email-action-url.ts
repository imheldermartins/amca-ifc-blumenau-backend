/** Os links de e-mail abrem telas; segredos e ações de escrita não entram na URL. */
export function validateEmailActionUrl(value: string): string {
  const url = new URL(value);
  const query = [...url.searchParams.entries()];
  const hasSafeReturnTo = query.length === 1
    && query[0]?.[0] === "returnTo"
    && /^\/[a-z]{2}-[a-z]{2}\/organizations\/new$/i.test(query[0][1]);
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password
    || url.hash || (query.length > 0 && !hasSafeReturnTo)) {
    throw new Error("URL de ação do e-mail inválida.");
  }
  if (url.protocol !== "https:" && !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
    throw new Error("URL pública de ação exige HTTPS.");
  }
  return url.toString();
}
