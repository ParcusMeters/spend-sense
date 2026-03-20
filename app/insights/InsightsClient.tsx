"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Brain, Calendar, Loader2 } from "lucide-react";
import { formatDate } from "@/lib/utils/dates";
import type { Insight } from "@/lib/supabase/types";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface InsightsClientProps {
  insights: Insight[];
}

export function InsightsClient({ insights: initialInsights }: InsightsClientProps) {
  const [insights, setInsights] = useState(initialInsights);
  const [loading, setLoading] = useState(false);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  async function generateInsight() {
    if (!startDate || !endDate) return;
    setLoading(true);

    try {
      const res = await fetch("/api/insights/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "ad_hoc",
          start_date: startDate,
          end_date: endDate,
        }),
      });

      if (res.ok) {
        const newInsight = await res.json();
        setInsights([newInsight, ...insights]);
      }
    } finally {
      setLoading(false);
    }
  }

  const typeColors: Record<string, string> = {
    weekly: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
    monthly: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200",
    ad_hoc: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">AI Insights</h1>
        <p className="text-muted-foreground">
          AI-powered analysis of your spending patterns
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Brain className="h-5 w-5" />
            Generate Insight
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="space-y-1">
              <Label>Start Date</Label>
              <Input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label>End Date</Label>
              <Input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>
            <Button
              onClick={generateInsight}
              disabled={loading || !startDate || !endDate}
            >
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Analysing...
                </>
              ) : (
                <>
                  <Brain className="mr-2 h-4 w-4" />
                  Analyse
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-4">
        {insights.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12">
              <Brain className="h-12 w-12 text-muted-foreground mb-4" />
              <p className="text-muted-foreground">
                No insights yet. Generate one above or wait for your first weekly digest.
              </p>
            </CardContent>
          </Card>
        ) : (
          insights.map((insight) => (
            <Card key={insight.id}>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Badge className={typeColors[insight.type] ?? ""}>
                      {insight.type === "ad_hoc"
                        ? "On-demand"
                        : insight.type.charAt(0).toUpperCase() + insight.type.slice(1)}
                    </Badge>
                    {insight.period_start && insight.period_end && (
                      <span className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Calendar className="h-3 w-3" />
                        {formatDate(insight.period_start)} – {formatDate(insight.period_end)}
                      </span>
                    )}
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {formatDate(insight.created_at)}
                  </span>
                </div>
                {insight.summary && (
                  <CardTitle className="text-base">{insight.summary}</CardTitle>
                )}
              </CardHeader>
              <Separator />
              <CardContent className="pt-4">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  className="prose prose-sm dark:prose-invert max-w-none"
                >
                  {insight.content}
                </ReactMarkdown>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
