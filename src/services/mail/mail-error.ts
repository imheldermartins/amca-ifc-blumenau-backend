import type {
  EmailFailureCode,
  EmailFailureFeedback,
} from "@/services/mail/types/mail.types";

const FEEDBACK: Record<EmailFailureCode, Omit<EmailFailureFeedback, "code">> = {
  configuration: {
    message: "A configuração SMTP está incompleta ou inválida.",
    retryable: false,
  },
  invalid_message: {
    message: "Remetente, destinatário, assunto ou conteúdo do e-mail é inválido.",
    retryable: false,
  },
  authentication: {
    message: "O SMTP recusou as credenciais. Confira SMTP_USER e SMTP_PASSWORD.",
    retryable: false,
  },
  connection: {
    message: "Não foi possível conectar ao SMTP. Confira host, porta e TLS.",
    retryable: true,
  },
  recipient_rejected: {
    message: "O SMTP recusou o destinatário do e-mail.",
    retryable: false,
  },
  delivery: {
    message: "O SMTP não confirmou o envio do e-mail.",
    retryable: true,
  },
};

/** Erro seguro para logs, API interna e outbox; nunca inclui resposta/segredo do provedor. */
export class EmailDeliveryError extends Error {
  public readonly code: EmailFailureCode;
  public readonly retryable: boolean;

  constructor(code: EmailFailureCode, message = FEEDBACK[code].message) {
    super(message);
    this.name = "EmailDeliveryError";
    this.code = code;
    this.retryable = FEEDBACK[code].retryable;
  }
}

export function emailFailureFeedback(error: unknown): EmailFailureFeedback {
  const failure = error instanceof EmailDeliveryError
    ? error
    : new EmailDeliveryError("delivery");
  return {
    code: failure.code,
    message: failure.message,
    retryable: failure.retryable,
  };
}

export function smtpProviderFailure(error: unknown): EmailDeliveryError {
  if (error instanceof EmailDeliveryError) return error;
  const provider = error && typeof error === "object"
    ? error as { code?: unknown; responseCode?: unknown }
    : {};
  const code = typeof provider.code === "string" ? provider.code.toUpperCase() : "";
  if (code === "EAUTH" || provider.responseCode === 535) {
    return new EmailDeliveryError("authentication");
  }
  if (["ECONNECTION", "ETIMEDOUT", "ESOCKET", "EDNS", "ECONNREFUSED"].includes(code)) {
    return new EmailDeliveryError("connection");
  }
  return new EmailDeliveryError("delivery");
}
