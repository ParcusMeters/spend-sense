import { format, startOfMonth, subMonths } from "date-fns";
import type { TrendTxnLite } from "./spending-chart-data";

export type InvestmentFlow = {
  /** Money sent to the broker to buy. */
  invested: number;
  /** Money returned from the broker on a sale or a reversed debit. */
  returned: number;
  /** invested − returned: capital actually put to work over the period. */
  net: number;
  buys: number;
  sells: number;
};

export type InvestmentFlowResult = {
  monthToDate: InvestmentFlow;
  /** Complete months before this one, oldest first. */
  history: { key: string; label: string; flow: InvestmentFlow }[];
  /** Net across every month in the window, including the current partial one. */
  windowNet: number;
  windowInvested: number;
};

function empty(): InvestmentFlow {
  return { invested: 0, returned: 0, net: 0, buys: 0, sells: 0 };
}

function add(flow: InvestmentFlow, t: TrendTxnLite): void {
  const amount = Math.abs(t.amount_cents);
  if (t.direction === "debit") {
    flow.invested += amount;
    flow.buys += 1;
  } else {
    flow.returned += amount;
    flow.sells += 1;
  }
  flow.net = flow.invested - flow.returned;
}

/**
 * Nets broker settlements instead of totalling them.
 *
 * Buying, selling and buying again with the same money reads as several separate
 * outflows, so gross buys badly overstate what was committed — a same-day debit
 * and its reversal would even count as a purchase on their own. Subtracting what
 * came back leaves the capital actually deployed.
 */
export function buildInvestmentFlow(
  txns: TrendTxnLite[],
  options?: { months?: number; today?: Date }
): InvestmentFlowResult {
  const months = options?.months ?? 6;
  const today = options?.today ?? new Date();
  const currentMonthKey = format(today, "yyyy-MM");

  const monthKeys: string[] = [];
  for (let i = months; i >= 1; i--) {
    monthKeys.push(format(subMonths(startOfMonth(today), i), "yyyy-MM"));
  }
  const included = new Set(monthKeys);

  const monthToDate = empty();
  const byMonth = new Map<string, InvestmentFlow>();

  for (const t of txns) {
    if (!t.is_investment_flow) continue;

    const monthKey = t.date.slice(0, 7);
    if (monthKey === currentMonthKey) {
      add(monthToDate, t);
      continue;
    }
    if (!included.has(monthKey)) continue;

    let flow = byMonth.get(monthKey);
    if (!flow) {
      flow = empty();
      byMonth.set(monthKey, flow);
    }
    add(flow, t);
  }

  const history = monthKeys.map((key) => ({
    key,
    label: format(new Date(`${key}-01T00:00:00`), "MMM"),
    flow: byMonth.get(key) ?? empty(),
  }));

  const windowInvested =
    history.reduce((sum, h) => sum + h.flow.invested, 0) + monthToDate.invested;
  const windowNet = history.reduce((sum, h) => sum + h.flow.net, 0) + monthToDate.net;

  return { monthToDate, history, windowNet, windowInvested };
}
