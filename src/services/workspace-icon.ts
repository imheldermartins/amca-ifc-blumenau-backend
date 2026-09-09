import { icons as cuida } from "@iconify-json/cuida";
import { icons as lucide } from "@iconify-json/lucide";

const MAX_ICON_ID_LENGTH = 100;
const ICON_ID_RE = /^(cuida|lucide):([a-z0-9]+(?:-[a-z0-9]+)*)$/;
const catalogs = {
  cuida: cuida.icons,
  lucide: lucide.icons,
} as const;

/** Aceita somente ícones canônicos expostos no mesmo catálogo do IconPicker. */
export function isWorkspaceIcon(value: unknown): value is string {
  if (typeof value !== "string" || value.length > MAX_ICON_ID_LENGTH) return false;
  const match = ICON_ID_RE.exec(value);
  if (!match) return false;
  const library = match[1] as keyof typeof catalogs;
  const name = match[2];
  if (!name) return false;
  return Object.hasOwn(catalogs[library], name);
}
