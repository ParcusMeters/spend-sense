"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowDownLeft, ArrowUpRight, DollarSign, PiggyBank } from "lucide-react";
import { formatCurrency } from "@/lib/utils/currency";
import type { MonthPace, PaceFigure } from "@/lib/dashboard/month-pace";

interface BalanceCardsProps {
  totalBalance: number;
  incomeThisMonth: number;
  spendingThisMonth: number;
  netSaved: number;
  /** This month so far against the same stretch of previous months. */
  pace?: MonthPace;
  /** Buys net of sells this month; neither spending nor income. */
  investedThisMonth?: number;
}

/**
 * For spending, above the usual pace is bad; for income and savings it is good.
 * Without that the same colour would mean opposite things on adjacent cards.
 */
function PaceLine({
  figure,
  dayOfMonth,
  higherIsBetter,
}: {
  figure: PaceFigure;
  dayOfMonth: number;
  higherIsBetter: boolean;
}) {
  const { delta, deltaPct, typical } = figure;
  const by = `by day ${dayOfMonth}`;

  if (typical === 0) {
    return (
      <p className="mt-1 text-xs text-muted-foreground">no comparable history yet</p>
    );
  }

  const good = higherIsBetter ? delta > 0 : delta < 0;
  const tone =
    delta === 0
      ? "text-muted-foreground"
      : good
        ? "text-emerald-600 dark:text-emerald-400"
        : "text-red-600 dark:text-red-400";

  return (
    <p className="mt-1 text-xs">
      <span className={tone}>
        {delta === 0
          ? "on pace"
          : `${deltaPct === null ? "" : `${Math.abs(deltaPct)}% `}${
              delta > 0 ? "above" : "below"
            } usual`}
      </span>
      <span className="text-muted-foreground"> · typically {formatCurrency(typical)} {by}</span>
    </p>
  );
}

export function BalanceCards({
  totalBalance,
  incomeThisMonth,
  spendingThisMonth,
  netSaved,
  pace,
  investedThisMonth,
}: BalanceCardsProps) {
  const cards = [
    {
      title: "Total Balance",
      value: formatCurrency(totalBalance),
      icon: DollarSign,
      color: "text-emerald-600 dark:text-emerald-400",
      bg: "bg-emerald-50 dark:bg-emerald-950",
    },
    {
      title: "Income This Month",
      value: formatCurrency(incomeThisMonth),
      pace: pace?.income,
      higherIsBetter: true,
      icon: ArrowDownLeft,
      color: "text-blue-600 dark:text-blue-400",
      bg: "bg-blue-50 dark:bg-blue-950",
    },
    {
      title: "Spending This Month",
      value: formatCurrency(spendingThisMonth),
      pace: pace?.spending,
      higherIsBetter: false,
      icon: ArrowUpRight,
      color: "text-rose-600 dark:text-rose-400",
      bg: "bg-rose-50 dark:bg-rose-950",
    },
    {
      title: "Net Saved",
      value: formatCurrency(netSaved),
      pace: pace?.netSaved,
      higherIsBetter: true,
      // Investing is neither spending nor income, so the money is still "saved";
      // this says how much of it has been moved into the market.
      note:
        investedThisMonth && investedThisMonth !== 0
          ? `${formatCurrency(Math.abs(investedThisMonth))} ${
              investedThisMonth > 0 ? "moved into" : "returned from"
            } investments`
          : undefined,
      icon: PiggyBank,
      color: netSaved >= 0
        ? "text-emerald-600 dark:text-emerald-400"
        : "text-rose-600 dark:text-rose-400",
      bg: netSaved >= 0
        ? "bg-emerald-50 dark:bg-emerald-950"
        : "bg-rose-50 dark:bg-rose-950",
    },
  ];

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {cards.map((card) => (
        <Card key={card.title}>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {card.title}
            </CardTitle>
            <div className={`rounded-lg p-2 ${card.bg}`}>
              <card.icon className={`h-4 w-4 ${card.color}`} />
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{card.value}</p>
            {card.pace && pace && (
              <PaceLine
                figure={card.pace}
                dayOfMonth={pace.dayOfMonth}
                higherIsBetter={card.higherIsBetter ?? true}
              />
            )}
            {card.note && (
              <p className="mt-1 text-xs text-muted-foreground">{card.note}</p>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
