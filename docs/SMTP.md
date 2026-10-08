# SMTP, validação de conta e convites

O envio tem três responsabilidades separadas:

- os builders/templates produzem somente `{ subject, content }`;
- `SendEmail` monta o envelope simples `{ from, to, subject, content }`, valida
  os endereços e é a única camada usada pelos casos de uso e pela outbox;
- `Smtp` adapta esse envelope para o Nodemailer e controla conexão, verificação,
  aceitação, fechamento e classificação das falhas do provedor.

A configuração é lida somente quando `SendEmail.fromEnvironment()` é chamado.
A API pode continuar iniciando sem SMTP configurado.

Preencha `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_REQUIRE_TLS`,
`SMTP_FROM_NAME` e `SMTP_FROM_EMAIL` no arquivo de ambiente utilizado. Se houver
autenticação, preencha `SMTP_USER` e `SMTP_PASSWORD` juntos. Os templates de dev,
produção e container documentam essas variáveis. Não coloque segredos no frontend.

A porta 587 usa STARTTLS; a porta 465 usa TLS desde a conexão. Produção exige TLS.
Um capturador local em desenvolvimento pode usar `SMTP_REQUIRE_TLS=false`.

```ts
import { SendEmail } from "@/services/mail/send-email";
import { accountVerificationEmail } from "@/services/mail/account-verification-email";

const sender = SendEmail.fromEnvironment();
try {
  await sender.verify();
  const email = accountVerificationEmail.create({
    name: recipient.name,
    email: recipient.email,
    verificationUrl,
  });
  await sender.send({
    to: recipient,
    subject: email.subject,
    content: email.content,
  });
} finally {
  sender.close();
}
```

`content` aceita HTML e texto simples opcional. `SendEmail` não cria, mocka nem
reescreve esse conteúdo: apenas o entrega ao `Smtp`. Isso permite substituir os
arquivos atuais por templates vindos do banco sem alterar o transporte.

O retorno de `send` indica aceitação pelo SMTP, sem afirmar entrega na caixa de
entrada. Falhas são sanitizadas e tipadas como `configuration`,
`invalid_message`, `authentication`, `connection`, `recipient_rejected` ou
`delivery`. Credenciais recusadas orientam a conferir `SMTP_USER` e
`SMTP_PASSWORD`, mas respostas e segredos do provedor nunca são propagados.

## Editar templates e macros

Os arquivos ficam em `src/services/mail/templates/`:

- `membership-request.html` e `.txt`: solicitação enviada aos responsáveis com
  permissão de adicionar membros. Macros: `recipient_name`, `recipient_email`,
  `requester_name`, `requester_email`, `scope_name`, `scope_type`, `review_url`.
- `verify-account.html` e `.txt`: validação do e-mail e definição inicial de
  senha. Macros: `recipient_name`, `recipient_email`, `verification_url`.
- `access-invite.html` e `.txt`: convite individual de uma conta já validada.
  Macros: `scope_type`, `scope_name`, `author_name`, `role_name`,
  `recipient_email`, `invite_url`, `expiry_text`.

Use `{{macro}}` no arquivo. `Template.render` retorna `subject` e
`content: { html, text }`; os builders concretos ligam as variáveis do sistema
às macros e validam o endereço de ação. Eles não escolhem remetente/destinatário
nem enviam. Valores inseridos no HTML são escapados automaticamente.
Macros ausentes falham antes do envio. Não há execução de código no template.
Reinicie o processo após editar os arquivos. `npm run build` copia os templates
para `dist/services/mail/templates` junto ao JavaScript compilado.

## Validação de conta e convites

O cadastro grava uma conta pendente e envia um token opaco válido por 24 horas.
Somente SHA-256 e hint entram em `account_verifications`. A senha não é recebida
na primeira etapa: ela é definida na tela aberta pelo e-mail. Um reenvio é aceito
após 60 segundos e invalida o link anterior.

Ao iniciar “Criar organização” pela Home, o retorno à tela de criação é incluído
no link de validação. A organização só pode ser criada pela sessão da conta já
validada, que se torna seu owner.

Para contas já validadas, o convite individual envia `/pt-br/invite/:token` e
exige clique em Aceitar. Para endereços ainda sem conta, o e-mail de validação
também carrega internamente o convite, e a ativação cria a área pessoal antes de
provisionar os acessos convidados. Links genéricos são copiados pela UI e não
disparam SMTP.

## Solicitações de acesso

O link de solicitação abre a revisão autenticada; não aprova por GET. O endpoint
de aceite revalida `add_members`, o template escolhido e a delegação, persistindo
o usuário da sessão em `accepted_by` na mesma transação da membership.
`notified_emails` registra somente destinatários aceitos pelo SMTP. Falhas de
envio preservam o pedido para revisão pela interface. Na outbox,
`notification_deliveries.last_error` guarda apenas o código sanitizado da falha
para diagnóstico e política de retry. Payloads antigos com `html`/`text` no
nível raiz são convertidos ao novo `content` durante a leitura. Veja
[PERMISSOES.md](PERMISSOES.md) para as tabelas e rotas.

As classes aceitam transporte injetado. Os testes não enviam mensagens externas e
não gravam credenciais ou convites reais. SMTP configurado no ambiente é
necessário para entregar mensagens; o código não inventa um provedor.

Referência: [transporte SMTP do Nodemailer](https://nodemailer.com/smtp).
