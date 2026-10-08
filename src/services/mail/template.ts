import { readFileSync } from "node:fs";
import type { EmailDraft } from "@/services/mail/types/mail.types";

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]!);
}

/** Templates editáveis em arquivos. Macros são dados, nunca código ou HTML executável. */
export class Template<Macros extends Record<string, string>> {
  constructor(private readonly source: EmailDraft) {}

  static fromFiles<Macros extends Record<string, string>>(input: {
    subject: string; html: URL; text: URL;
  }): Template<Macros> {
    return new Template<Macros>({
      subject: input.subject,
      content: {
        html: readFileSync(input.html, "utf8"),
        text: readFileSync(input.text, "utf8"),
      },
    });
  }

  render(macros: Macros): EmailDraft {
    const expand = (source: string, html: boolean) => source.replace(
      /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g,
      (_match, key: string) => {
        if (!Object.hasOwn(macros, key) || typeof macros[key] !== "string") {
          throw new Error(`Macro de e-mail ausente: ${key}`);
        }
        return html ? escapeHtml(macros[key]) : macros[key];
      },
    );
    const subject = expand(this.source.subject, false);
    if (/[\r\n]/.test(subject)) throw new Error("Assunto do template inválido.");
    return {
      subject,
      content: {
        html: expand(this.source.content.html, true),
        ...(this.source.content.text !== undefined
          ? { text: expand(this.source.content.text, false) }
          : {}),
      },
    };
  }
}
