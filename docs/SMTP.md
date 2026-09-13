# SMTP, validação de conta e convites

`src/core/mail/smtp-service.ts` centraliza conexão, verificação e envio SMTP com
Nodemailer. A configuração é lida quando `SmtpService.fromEnvironment()` é
chamado. A API pode continuar iniciando sem SMTP configurado.

Preencha `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_REQUIRE_TLS`,
`SMTP_FROM_NAME` e `SMTP_FROM_EMAIL` no arquivo de ambiente utilizado. Se houver
autenticação, preencha `SMTP_USER` e `SMTP_PASSWORD` juntos. Os templates de dev,
produção e container documentam essas variáveis. Não coloque segredos no frontend.

A porta 587 usa STARTTLS; a porta 465 usa TLS desde a conexão. Produção exige TLS.
Um capturador local em desenvolvimento pode usar `SMTP_REQUIRE_TLS=false`.

```ts
import { SmtpService } from "@/core/mail/smtp-service";
import { accountVerificationEmail } from "@/core/mail/account-verification-email";

const smtp = SmtpService.fromEnvironment();
try {
  await smtp.verify();
  await smtp.send(accountVerificationEmail({
    name: recipient.name,
    email: recipient.email,
    verificationUrl,
  }));
} finally {
  smtp.close();
}
```

O template tem HTML e texto simples, escapa dados do destinatário e usa um link
de ação validado. O retorno de `send` indica aceitação pelo SMTP, sem afirmar
entrega na caixa de entrada. Erros do provedor são sanitizados.

## Editar templates e macros

Os arquivos ficam em `src/core/mail/templates/`:

- `membership-request.html` e `.txt`: solicitação enviada aos responsáveis com
  permissão de adicionar membros. Macros: `recipient_name`, `recipient_email`,
  `requester_name`, `requester_email`, `scope_name`, `scope_type`, `review_url`.
- `verify-account.html` e `.txt`: validação do e-mail e definição inicial de
  senha. Macros: `recipient_name`, `recipient_email`, `verification_url`.
- `access-invite.html` e `.txt`: convite individual de uma conta já validada.
  Macros: `scope_type`, `scope_name`, `author_name`, `role_name`,
  `recipient_email`, `invite_url`, `expiry_text`.

Use `{{macro}}` no arquivo. `Template.render` retorna `subject`, `bodyHtml` e
`bodyText`; os builders concretos ligam as variáveis do sistema às macros e validam
o endereço de ação. Valores inseridos no HTML são escapados automaticamente.
Macros ausentes falham antes do envio. Não há execução de código no template.
Reinicie o processo após editar os arquivos. `npm run build` copia os templates
para `dist/core/mail/templates` junto ao JavaScript compilado.

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
envio preservam o pedido para revisão pela interface. Veja
[PERMISSOES.md](PERMISSOES.md) para as tabelas e rotas.

A classe aceita transporte injetado. Os testes não enviam mensagens externas e
não gravam credenciais ou convites reais. SMTP configurado no ambiente é
necessário para entregar mensagens; o código não inventa um provedor.

Referência: [transporte SMTP do Nodemailer](https://nodemailer.com/smtp).
