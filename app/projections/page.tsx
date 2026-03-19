export const dynamic = "force-dynamic";

import { createServiceClient } from "@/lib/supabase/server";
import { getLastNMonths, getMonthLabel } from "@/lib/utils/dates";
import { ProjectionsClient } from "./ProjectionsClient";
import { AuthGate } from "@/components/auth/AuthGate";

async function ProjectionsContent() {
  const supabase = createServiceClient();
  const { start } = getLastNMonths(6);

  const { data: txns } = await supabase
    .from("transactions")
    .select("date, direction, amount_cents, ai_category, redbark_category, user_category_override")
    .gte("date", start);

  const monthlyData: Record<string, { income: number; spending: number }> = {};
  for (const t of txns ?? []) {
    const m = t.date.slice(0, 7);
    if (!monthlyData[m]) monthlyData[m] = { income: 0, spending: 0 };
    const cat = t.user_category_override ?? t.redbark_category;
    if (cat === "Transfers") continue;
    if (t.direction === "credit") {
      monthlyData[m].income += t.amount_cents;
    } else {
      monthlyData[m].spending += Math.abs(t.amount_cents);
    }
  }

  const months = Object.entries(monthlyData)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([month, data]) => ({
      month: getMonthLabel(`${month}-01`),
      income: Math.round(data.income / 100),
      spending: Math.round(data.spending / 100),
    }));

  const avgIncome = months.length > 0 ? months.reduce((s, m) => s + m.income, 0) / months.length : 5841;
  const avgSpending = months.length > 0 ? months.reduce((s, m) => s + m.spending, 0) / months.length : 3085;

  const { data: accounts } = await supabase.from("accounts").select("balance");
  const currentBalance = (accounts ?? []).reduce((sum, a) => sum + Number(a.balance), 0);

  const { data: goals } = await supabase
    .from("goals")
    .select("*")
    .eq("is_active", true)
    .limit(1);

  const goal = goals?.[0] ?? { name: "Savings Goal", target_amount: 20000, current_amount: currentBalance };

  return (
    <ProjectionsClient
      avgIncome={Math.round(avgIncome)}
      avgSpending={Math.round(avgSpending)}
      currentBalance={Math.round(currentBalance)}
      months={months}
      goal={{
        name: goal.name,
        target: Number(goal.target_amount),
        current: Number(goal.current_amount),
      }}
    />
  );
}

export default function ProjectionsPage() {
  return (
    <AuthGate>
      <ProjectionsContent />
    </AuthGate>
  );
}
