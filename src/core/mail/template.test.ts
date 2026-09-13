import { describe, expect, it } from "vitest";
import { Template } from "./template.js";
import { membershipRequestEmail } from "./membership-request-email.js";

describe("Template", () => {
  const template = new Template({ subject: "Convite para {{name}}", bodyHtml: "<p>{{name}}</p><a href=\"{{url}}\">Abrir</a>", bodyText: "{{name}}: {{url}}" });
  it("expande macros sem interpretar HTML, código ou macros dentro do valor", () => {
    const output = template.render({ name: '<b>{{secret}}</b>', url: 'https://example.com/" onclick="attack' });
    expect(output.bodyHtml).toBe('<p>&lt;b&gt;{{secret}}&lt;/b&gt;</p><a href="https://example.com/&quot; onclick=&quot;attack">Abrir</a>');
    expect(output.bodyText).toContain('<b>{{secret}}</b>');
  });
  it("recusa macro ausente e nova linha no assunto", () => {
    expect(() => template.render({ name: "Ana" })).toThrow("url");
    expect(() => template.render({ name: "Ana\nBcc: test@example.com", url: "https://example.com" })).toThrow("Assunto");
  });

  it("gera a solicitação com os dados do solicitante e um link para revisão", () => {
    const message = membershipRequestEmail({
      recipient: { name: "Ana", email: "ana@example.com" },
      requester: { name: "Bia <Equipe>", email: "bia@example.com" },
      scopeName: "Pesquisa", scopeType: "Workspace",
      reviewUrl: "https://cubs.example.com/pt-br/workspaces/EXAMPLE/requests/REQUEST",
    });
    expect(message.to.email).toBe("ana@example.com");
    expect(message.html).toContain("Bia &lt;Equipe&gt;");
    expect(message.html).toContain("Revisar solicitação");
    expect(message.text).toContain("Abrir este link não aprova a solicitação.");
    expect(message.html).not.toMatch(/\{\{\w+\}\}/);
  });
});
