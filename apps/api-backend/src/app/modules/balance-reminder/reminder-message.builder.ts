import { CloudTemplateNames } from '../whatsapp/templates/cloud-template-names';

/**
 * Pure builders for every balance-reminder WhatsApp message. BOTH the real send
 * (BalanceReminderService.sendReminder / sendStatementOnly / sendWarning) and the
 * "view message" preview go through these, so what staff review is exactly the
 * template + params that get sent — never a second copy of the selection logic.
 */

export interface BuiltMessage {
  templateName: string;
  params: string[];
  /** The template has a DOCUMENT (PDF) header — the statement must be attached. */
  withDocument: boolean;
}

export interface WarningFigures {
  invoiceAmount: number;
  paymentReceived: number;
  outstanding: number;
  currentBalance: number;
}

/** Balance reminder / monthly statement. `withDocument` = statement PDF available. */
export function buildReminderMessage(opts: {
  name: string;
  customerCode: string;
  balance: number;
  monthLabel: string;
  withDocument: boolean;
}): BuiltMessage {
  const { name, customerCode, balance, monthLabel, withDocument } = opts;
  // Balance cleared (or in advance) — congratulate, never ask for payment
  const hasDue = balance > 0;
  if (withDocument) {
    if (hasDue) {
      return { templateName: CloudTemplateNames.MONTHLY_STATEMENT, params: [name, customerCode, balance.toFixed(2)], withDocument };
    }
    if (balance < 0) {
      return { templateName: CloudTemplateNames.MONTHLY_STATEMENT_ADVANCE, params: [name, monthLabel, Math.abs(balance).toFixed(2)], withDocument };
    }
    return { templateName: CloudTemplateNames.MONTHLY_STATEMENT_CLEAR, params: [name, monthLabel], withDocument };
  }
  if (hasDue) {
    return { templateName: CloudTemplateNames.BALANCE_REMINDER, params: [name, balance.toFixed(2)], withDocument };
  }
  if (balance < 0) {
    return { templateName: CloudTemplateNames.BALANCE_CLEAR_ADVANCE, params: [name, Math.abs(balance).toFixed(2)], withDocument };
  }
  return { templateName: CloudTemplateNames.BALANCE_CLEAR, params: [name], withDocument };
}

/** Statement only — neutral wording, PDF always attached. */
export function buildStatementOnlyMessage(opts: { name: string; monthLabel: string }): BuiltMessage {
  return {
    templateName: CloudTemplateNames.MONTHLY_STATEMENT_NEUTRAL,
    params: [opts.name, opts.monthLabel],
    withDocument: true,
  };
}

/** Overdue warning — 6 approved params, PDF header. */
export function buildWarningMessage(opts: { name: string; customerCode: string; figures: WarningFigures }): BuiltMessage {
  const f = opts.figures;
  return {
    templateName: CloudTemplateNames.PAYMENT_OVERDUE_WARNING,
    params: [
      opts.name,
      opts.customerCode,
      f.outstanding.toFixed(2),
      f.invoiceAmount.toFixed(2),
      f.paymentReceived.toFixed(2),
      f.currentBalance.toFixed(2),
    ],
    withDocument: true,
  };
}
