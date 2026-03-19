"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowDownLeft, ArrowUpRight, DollarSign, PiggyBank } from "lucide-react";
import { formatCurrency } from "@/lib/utils/currency";

interface BalanceCardsProps {
  totalBalance: number;
  incomeThisMonth: number;
  spendingThisMonth: number;
  netSaved: number;
}

export function BalanceCards({
  totalBalance,
  incomeThisMonth,
  spendingThisMonth,
  netSaved,
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
      icon: ArrowDownLeft,
      color: "text-blue-600 dark:text-blue-400",
      bg: "bg-blue-50 dark:bg-blue-950",
    },
    {
      title: "Spending This Month",
      value: formatCurrency(spendingThisMonth),
      icon: ArrowUpRight,
      color: "text-rose-600 dark:text-rose-400",
      bg: "bg-rose-50 dark:bg-rose-950",
    },
    {
      title: "Net Saved",
      value: formatCurrency(netSaved),
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
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
