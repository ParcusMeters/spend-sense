"use client";

import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Copy, TrendingUp } from "lucide-react";

interface AnomalyBadgeProps {
  type: string;
  severity: string;
}

export function AnomalyBadge({ type, severity }: AnomalyBadgeProps) {
  const config: Record<string, { label: string; icon: React.ReactNode }> = {
    duplicate: { label: "Duplicate", icon: <Copy className="h-3 w-3" /> },
    unusual_amount: { label: "Unusual", icon: <TrendingUp className="h-3 w-3" /> },
    subscription_change: { label: "Price Change", icon: <AlertTriangle className="h-3 w-3" /> },
    unusual_merchant: { label: "New Merchant", icon: <AlertTriangle className="h-3 w-3" /> },
    unusual_time: { label: "Unusual Time", icon: <AlertTriangle className="h-3 w-3" /> },
  };

  const { label, icon } = config[type] ?? { label: type, icon: <AlertTriangle className="h-3 w-3" /> };

  return (
    <Badge
      variant={severity === "high" ? "destructive" : "secondary"}
      className="gap-1 text-xs"
    >
      {icon}
      {label}
    </Badge>
  );
}
