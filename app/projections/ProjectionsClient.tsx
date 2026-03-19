"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { SavingsProjection } from "@/components/dashboard/SavingsProjection";
import { format, addMonths, startOfMonth } from "date-fns";
import { TrendingUp, Target, Calendar } from "lucide-react";

interface ProjectionsClientProps {
  avgIncome: number;
  avgSpending: number;
  currentBalance: number;
  months: { month: string; income: number; spending: number }[];
  goal: { name: string; target: number; current: number };
}

export function ProjectionsClient({
  avgIncome,
  avgSpending,
  currentBalance,
  months,
  goal,
}: ProjectionsClientProps) {
  const [interestRate, setInterestRate] = useState(0);
  const [targetAmount, setTargetAmount] = useState(goal.target);

  const avgSaved = avgIncome - avgSpending;
  const savingsRate = avgIncome > 0 ? (avgSaved / avgIncome) * 100 : 0;
  const monthlyRate = interestRate / 100 / 12;

  const projectionData = Array.from({ length: 13 }, (_, i) => {
    const date = addMonths(startOfMonth(new Date()), i);
    let projected = currentBalance;
    for (let m = 0; m < i; m++) {
      projected = projected * (1 + monthlyRate) + avgSaved;
    }
    return {
      month: format(date, "MMM yy"),
      projected: Math.round(projected),
      ...(i === 0 ? { actual: currentBalance } : {}),
    };
  });

  // Calculate months to goal
  let monthsToGoal = 0;
  let balance = currentBalance;
  const remaining = targetAmount - currentBalance;
  if (remaining <= 0) {
    monthsToGoal = 0;
  } else if (avgSaved <= 0) {
    monthsToGoal = -1;
  } else {
    while (balance < targetAmount && monthsToGoal < 120) {
      balance = balance * (1 + monthlyRate) + avgSaved;
      monthsToGoal++;
    }
  }

  const goalProgress = targetAmount > 0 ? Math.min(100, (goal.current / targetAmount) * 100) : 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Savings Projections</h1>
        <p className="text-muted-foreground">
          Based on your actual 3-month rolling average
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Avg Monthly Income
            </CardTitle>
            <TrendingUp className="h-4 w-4 text-emerald-500" />
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">${avgIncome.toLocaleString()}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Avg Monthly Spending
            </CardTitle>
            <TrendingUp className="h-4 w-4 text-rose-500" />
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">${avgSpending.toLocaleString()}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Savings Rate
            </CardTitle>
            <Target className="h-4 w-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{savingsRate.toFixed(1)}%</p>
            <p className="text-xs text-muted-foreground">
              ${avgSaved.toLocaleString()}/month
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Target className="h-5 w-5" />
            {goal.name}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between text-sm">
            <span>${goal.current.toLocaleString()} saved</span>
            <span>${targetAmount.toLocaleString()} target</span>
          </div>
          <Progress value={goalProgress} className="h-3" />
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Calendar className="h-4 w-4" />
            {monthsToGoal === 0 && <span>Goal reached!</span>}
            {monthsToGoal === -1 && <span>Spending exceeds income — adjust budget to reach goal</span>}
            {monthsToGoal > 0 && (
              <span>
                ~{monthsToGoal} months to go ({format(addMonths(new Date(), monthsToGoal), "MMM yyyy")})
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label>Savings Goal ($)</Label>
          <Input
            type="number"
            value={targetAmount}
            onChange={(e) => setTargetAmount(Number(e.target.value))}
          />
        </div>
        <div className="space-y-2">
          <Label>Annual Interest Rate (%)</Label>
          <Input
            type="number"
            step="0.1"
            value={interestRate}
            onChange={(e) => setInterestRate(Number(e.target.value))}
          />
        </div>
      </div>

      <SavingsProjection data={projectionData} savingsGoal={targetAmount} />
    </div>
  );
}
