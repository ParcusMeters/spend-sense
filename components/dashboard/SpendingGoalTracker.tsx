"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Target, Pencil, Check, X } from "lucide-react";
import { formatCurrency } from "@/lib/utils/currency";

interface SpendingGoalTrackerProps {
  weeklySpendingCents: number;
  monthlySpendingCents: number;
  daysIntoWeek: number; // 1 (Mon) to 7 (Sun)
  daysIntoMonth: number;
  daysInMonth: number;
}

const WEEKS_PER_MONTH = 4.33;

export function SpendingGoalTracker({
  weeklySpendingCents,
  monthlySpendingCents,
  daysIntoWeek,
  daysIntoMonth,
  daysInMonth,
}: SpendingGoalTrackerProps) {
  const [weeklyLimitCents, setWeeklyLimitCents] = useState<number | null>(null);
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/spending-budget")
      .then((r) => r.json())
      .then((d) => {
        if (d.budget) {
          setWeeklyLimitCents(d.budget.weekly_limit_cents);
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  async function saveBudget() {
    const cents = Math.round(parseFloat(editValue) * 100);
    if (isNaN(cents) || cents <= 0) return;
    const res = await fetch("/api/spending-budget", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ weekly_limit_cents: cents }),
    });
    const d = await res.json();
    if (d.budget) {
      setWeeklyLimitCents(d.budget.weekly_limit_cents);
    }
    setEditing(false);
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground text-sm">
          Loading spending goal...
        </CardContent>
      </Card>
    );
  }

  if (weeklyLimitCents === null && !editing) {
    return (
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Spending Goal
          </CardTitle>
          <div className="rounded-lg bg-emerald-50 p-2 dark:bg-emerald-950">
            <Target className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Set a weekly spending goal to track your budget.
          </p>
          <Button
            size="sm"
            onClick={() => {
              setEditValue("");
              setEditing(true);
            }}
          >
            Set Weekly Goal
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (editing) {
    return (
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Set Weekly Spending Goal
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">$</span>
            <Input
              type="number"
              placeholder="e.g. 500"
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && saveBudget()}
              autoFocus
              className="max-w-[140px]"
            />
            <span className="text-sm text-muted-foreground">/ week</span>
          </div>
          {editValue && parseFloat(editValue) > 0 && (
            <p className="text-xs text-muted-foreground">
              = ~{formatCurrency(Math.round(parseFloat(editValue) * 100 * WEEKS_PER_MONTH))} / month
            </p>
          )}
          <div className="flex gap-2">
            <Button size="sm" onClick={saveBudget}>
              <Check className="mr-1 h-3 w-3" /> Save
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setEditing(false)}
            >
              <X className="mr-1 h-3 w-3" /> Cancel
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  const monthlyLimitCents = Math.round(weeklyLimitCents! * WEEKS_PER_MONTH);

  // Weekly progress
  const weeklyPct = weeklyLimitCents! > 0 ? (weeklySpendingCents / weeklyLimitCents!) * 100 : 0;
  const weeklyPace = daysIntoWeek > 0 ? (daysIntoWeek / 7) * 100 : 0;
  const weeklyOnTrack = weeklyPct <= weeklyPace + 10; // 10% grace
  const weeklyRemaining = Math.max(0, weeklyLimitCents! - weeklySpendingCents);
  const weeklyDaysLeft = 7 - daysIntoWeek;
  const weeklyDailyBudget = weeklyDaysLeft > 0 ? weeklyRemaining / weeklyDaysLeft : 0;

  // Monthly progress
  const monthlyPct = monthlyLimitCents > 0 ? (monthlySpendingCents / monthlyLimitCents) * 100 : 0;
  const monthlyPace = daysIntoMonth > 0 ? (daysIntoMonth / daysInMonth) * 100 : 0;
  const monthlyOnTrack = monthlyPct <= monthlyPace + 10;
  const monthlyRemaining = Math.max(0, monthlyLimitCents - monthlySpendingCents);
  const monthlyDaysLeft = daysInMonth - daysIntoMonth;
  const monthlyDailyBudget = monthlyDaysLeft > 0 ? monthlyRemaining / monthlyDaysLeft : 0;

  function progressColor(pct: number, onTrack: boolean) {
    if (pct >= 100) return "text-red-600 dark:text-red-400";
    if (!onTrack) return "text-amber-600 dark:text-amber-400";
    return "text-emerald-600 dark:text-emerald-400";
  }

  function barClass(pct: number, onTrack: boolean) {
    if (pct >= 100) return "[&>div]:bg-red-500";
    if (!onTrack) return "[&>div]:bg-amber-500";
    return "[&>div]:bg-emerald-500";
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          Spending Goal
        </CardTitle>
        <button
          onClick={() => {
            setEditValue(((weeklyLimitCents ?? 0) / 100).toString());
            setEditing(true);
          }}
          className="rounded-lg bg-emerald-50 p-2 hover:bg-emerald-100 dark:bg-emerald-950 dark:hover:bg-emerald-900 transition-colors"
        >
          <Pencil className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
        </button>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Weekly */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">This Week</span>
            <span className={`text-sm font-semibold ${progressColor(weeklyPct, weeklyOnTrack)}`}>
              {formatCurrency(weeklySpendingCents)} / {formatCurrency(weeklyLimitCents!)}
            </span>
          </div>
          <Progress
            value={Math.min(weeklyPct, 100)}
            className={`h-2.5 ${barClass(weeklyPct, weeklyOnTrack)}`}
          />
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>
              {weeklyPct >= 100
                ? `Over by ${formatCurrency(weeklySpendingCents - weeklyLimitCents!)}`
                : `${formatCurrency(weeklyRemaining)} remaining`}
            </span>
            {weeklyDaysLeft > 0 && weeklyPct < 100 && (
              <span>{formatCurrency(Math.round(weeklyDailyBudget))}/day left</span>
            )}
          </div>
        </div>

        {/* Monthly */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">This Month</span>
            <span className={`text-sm font-semibold ${progressColor(monthlyPct, monthlyOnTrack)}`}>
              {formatCurrency(monthlySpendingCents)} / {formatCurrency(monthlyLimitCents)}
            </span>
          </div>
          <Progress
            value={Math.min(monthlyPct, 100)}
            className={`h-2.5 ${barClass(monthlyPct, monthlyOnTrack)}`}
          />
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>
              {monthlyPct >= 100
                ? `Over by ${formatCurrency(monthlySpendingCents - monthlyLimitCents)}`
                : `${formatCurrency(monthlyRemaining)} remaining`}
            </span>
            {monthlyDaysLeft > 0 && monthlyPct < 100 && (
              <span>{formatCurrency(Math.round(monthlyDailyBudget))}/day left</span>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
