import { EmailDeliveryError, emailFailureFeedback } from "@/services/mail/mail-error";
import { Smtp } from "@/services/mail/smtp";
import type {
  EmailAddress,
  EmailDelivery,
  EmailDeliveryReceipt,
  EmailFailureFeedback,
  SendEmailInput,
} from "@/services/mail/types/mail.types";

export type {
  EmailAddress,
  EmailContent,
  EmailDeliveryReceipt,
  EmailFailureCode,
  EmailFailureFeedback,
  SendEmailInput,
} from "@/services/mail/types/mail.types";
export { EmailDeliveryError, emailFailureFeedback } from "@/services/mail/mail-error";

const EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
type FailureReporter = (failure: EmailFailureFeedback) => void;

/** Caso de uso único de e-mail: monta o envelope simples e delega só a entrega ao SMTP. */
export class SendEmail {
  constructor(
    private readonly smtp: EmailDelivery,
    public readonly from: EmailAddress,
    private readonly reportFailure: FailureReporter = (failure) => {
      console.error(`[EMAIL:${failure.code}] ${failure.message}`);
    },
  ) {}

  public static fromEnvironment(env: NodeJS.ProcessEnv = process.env): SendEmail {
    try {
      const configuration = Smtp.configurationFromEnvironment(env);
      return new SendEmail(new Smtp(configuration.smtp), configuration.from);
    } catch (error) {
      const feedback = emailFailureFeedback(error);
      console.error(`[EMAIL:${feedback.code}] ${feedback.message}`);
      throw error;
    }
  }

  public async verify(): Promise<void> {
    try {
      await this.smtp.verify();
    } catch (error) {
      this.fail(error);
    }
  }

  public async send(input: SendEmailInput): Promise<EmailDeliveryReceipt> {
    if (
      !this.from.name.trim()
      || !input.to.name.trim()
      || !EMAIL.test(this.from.email)
      || !EMAIL.test(input.to.email)
      || !input.subject.trim()
      || /[\r\n]/.test(input.subject)
      || !input.content.html.trim()
    ) {
      this.fail(new EmailDeliveryError("invalid_message"));
    }
    try {
      return await this.smtp.deliver({ from: this.from, ...input });
    } catch (error) {
      this.fail(error);
    }
  }

  public close(): void {
    this.smtp.close();
  }

  private fail(error: unknown): never {
    const feedback = emailFailureFeedback(error);
    this.reportFailure(feedback);
    throw error instanceof EmailDeliveryError
      ? error
      : new EmailDeliveryError(feedback.code, feedback.message);
  }
}
