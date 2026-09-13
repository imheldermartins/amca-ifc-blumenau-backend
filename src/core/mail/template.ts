import { readFileSync } from "node:fs";

export interface EmailBody {
  subject: string;
  bodyHtml: string;
  bodyText: string;
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]!);
}

/** Templates editáveis em arquivos. Macros são dados, nunca código ou HTML executável. */
export class Template<Macros extends Record<string, string>> {
  constructor(private readonly source: EmailBody) {}

  static fromFiles<Macros extends Record<string, string>>(input: {
    subject: string; html: URL; text: URL;
  }): Template<Macros> {
    return new Template<Macros>({
      subject: input.subject,
      bodyHtml: readFileSync(input.html, "utf8"),
      bodyText: readFileSync(input.text, "utf8"),
    });
  }

  render(macros: Macros): EmailBody {
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
      bodyHtml: expand(this.source.bodyHtml, true),
      bodyText: expand(this.source.bodyText, false),
    };
  }
}
