/**
 * Converte um título em slug URL-friendly: remove acentos, baixa a caixa e
 * troca separadores por hífens. Devolve `null` para entrada vazia (o slug de
 * page_edges é nullable). Usado ao criar arestas (controller/seed) para o
 * segmento de caminho do breadcrumb.
 */
export function slugify(text: string | null | undefined): string | null {
  if (!text) return null;

  const slug = text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "") // tira acentos
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/[\s-]+/g, "-")
    .replace(/^-|-$/g, "");

  return slug || null;
}
