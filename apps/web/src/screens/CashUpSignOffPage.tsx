import { ApprovalsPage } from "./ApprovalsPage";

/** Q02. Cash-up sign-off: the approvals inbox narrowed to cash-ups, with the count laid out for review. */
export function CashUpSignOffPage() {
  return <ApprovalsPage kinds={["cash_up"]} headingKey="cashup.signoff.title" subtitleKey="cashup.signoff.subtitle" emptyKey="cashup.signoff.empty" />;
}
