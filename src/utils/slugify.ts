const DIACRITIC_FOLDS: ReadonlyArray<readonly [string, string]> = [
  ['Á', 'A'], ['À', 'A'], ['Â', 'A'], ['Ã', 'A'], ['Ä', 'A'], ['Å', 'A'],
  ['á', 'a'], ['à', 'a'], ['â', 'a'], ['ã', 'a'], ['ä', 'a'], ['å', 'a'],
  ['É', 'E'], ['È', 'E'], ['Ê', 'E'], ['Ë', 'E'],
  ['é', 'e'], ['è', 'e'], ['ê', 'e'], ['ë', 'e'],
  ['Í', 'I'], ['Ì', 'I'], ['Î', 'I'], ['Ï', 'I'],
  ['í', 'i'], ['ì', 'i'], ['î', 'i'], ['ï', 'i'],
  ['Ó', 'O'], ['Ò', 'O'], ['Ô', 'O'], ['Õ', 'O'], ['Ö', 'O'],
  ['ó', 'o'], ['ò', 'o'], ['ô', 'o'], ['õ', 'o'], ['ö', 'o'],
  ['Ú', 'U'], ['Ù', 'U'], ['Û', 'U'], ['Ü', 'U'],
  ['ú', 'u'], ['ù', 'u'], ['û', 'u'], ['ü', 'u'],
  ['Ç', 'C'], ['ç', 'c'], ['Ñ', 'N'], ['ñ', 'n'], ['Ý', 'Y'], ['ý', 'y'], ['ÿ', 'y'],
];

/** Forma canônica para comparação: preserva espaços/pontuação e ignora acentos e caixa. */
export function simplifyText(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

/** Segmento legível derivado da mesma simplificação usada nas comparações. */
export function slugify(value: string): string {
  return simplifyText(value)
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Equivalente SQLite de `simplifyText` para expressões confiáveis do repositório.
 * O rqlite não permite registrar uma função JavaScript, então a simplificação é
 * expandida na consulta sem persistir uma segunda cópia de `pages.title`.
 */
export function simplifySqlText(expression: string): string {
  const folded = DIACRITIC_FOLDS.reduce(
    (sql, [source, target]) => `replace(${sql}, '${source}', '${target}')`,
    expression,
  );
  return `lower(${folded})`;
}
