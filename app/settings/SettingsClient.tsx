"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Loader2, CheckCircle2, Eye, EyeOff, Copy, Check } from "lucide-react";
import { toast } from "sonner";

interface SettingsClientProps {
  initialProfile: {
    display_name: string;
    monthly_income_cents: number;
    savings_goal_cents: number;
    webhook_configured: boolean;
  };
  appUrl: string;
  userEmail: string;
}

export function SettingsClient({ initialProfile, appUrl, userEmail }: SettingsClientProps) {
  const webhookUrl = `${appUrl}/api/webhooks/redbark`;

  const [displayName, setDisplayName] = useState(initialProfile.display_name);
  const [monthlyIncome, setMonthlyIncome] = useState(
    initialProfile.monthly_income_cents ? (initialProfile.monthly_income_cents / 100).toFixed(0) : ""
  );
  const [savingsGoal, setSavingsGoal] = useState(
    initialProfile.savings_goal_cents ? (initialProfile.savings_goal_cents / 100).toFixed(0) : ""
  );
  const [savingProfile, setSavingProfile] = useState(false);

  const [webhookSecret, setWebhookSecret] = useState("");
  const [showSecret, setShowSecret] = useState(false);
  const [savingWebhook, setSavingWebhook] = useState(false);
  const [webhookConfigured, setWebhookConfigured] = useState(initialProfile.webhook_configured);

  const [copiedUrl, setCopiedUrl] = useState(false);

  async function saveProfile() {
    setSavingProfile(true);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          display_name: displayName,
          monthly_income_cents: monthlyIncome ? Math.round(parseFloat(monthlyIncome) * 100) : 0,
          savings_goal_cents: savingsGoal ? Math.round(parseFloat(savingsGoal) * 100) : 0,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      toast.success("Profile saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSavingProfile(false);
    }
  }

  async function saveWebhookSecret() {
    if (!webhookSecret.trim()) return;
    setSavingWebhook(true);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ redbark_webhook_secret: webhookSecret }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      setWebhookConfigured(true);
      setWebhookSecret("");
      toast.success("Webhook secret saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSavingWebhook(false);
    }
  }

  async function copyUrl() {
    await navigator.clipboard.writeText(webhookUrl);
    setCopiedUrl(true);
    setTimeout(() => setCopiedUrl(false), 2000);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-muted-foreground">Manage your profile and bank connection.</p>
      </div>

      {/* Profile */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Profile</CardTitle>
          <CardDescription>Used to personalise your AI assistant and digest emails.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input id="email" value={userEmail} disabled className="text-muted-foreground" />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="display-name">Display name</Label>
            <Input
              id="display-name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Your name"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="monthly-income">Monthly take-home pay</Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
                <Input
                  id="monthly-income"
                  type="number"
                  min="0"
                  step="1"
                  value={monthlyIncome}
                  onChange={(e) => setMonthlyIncome(e.target.value)}
                  placeholder="5000"
                  className="pl-6"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="savings-goal">Savings goal</Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
                <Input
                  id="savings-goal"
                  type="number"
                  min="0"
                  step="1"
                  value={savingsGoal}
                  onChange={(e) => setSavingsGoal(e.target.value)}
                  placeholder="20000"
                  className="pl-6"
                />
              </div>
            </div>
          </div>

          <Button onClick={saveProfile} disabled={savingProfile} className="w-full sm:w-auto">
            {savingProfile ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Save profile
          </Button>
        </CardContent>
      </Card>

      {/* Redbark connection */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base">Redbark connection</CardTitle>
              <CardDescription>Connect your bank account via Redbark to import transactions automatically.</CardDescription>
            </div>
            {webhookConfigured && (
              <div className="flex items-center gap-1.5 text-sm text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 className="h-4 w-4" />
                Connected
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          <ol className="space-y-3 text-sm text-muted-foreground list-none">
            <li className="flex gap-3">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-foreground">1</span>
              <span>Log in to your <strong className="text-foreground">Redbark dashboard</strong> and go to <strong className="text-foreground">Webhooks</strong>.</span>
            </li>
            <li className="flex gap-3">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-foreground">2</span>
              <span>Create a new webhook and set the URL to:</span>
            </li>
          </ol>

          <div className="flex items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2">
            <code className="flex-1 truncate text-xs">{webhookUrl}</code>
            <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={copyUrl}>
              {copiedUrl ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
            </Button>
          </div>

          <ol className="space-y-3 text-sm text-muted-foreground list-none" start={3}>
            <li className="flex gap-3">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-foreground">3</span>
              <span>Redbark will generate a <strong className="text-foreground">webhook secret</strong>. Copy it and paste it below.</span>
            </li>
          </ol>

          <Separator />

          <div className="space-y-1.5">
            <Label htmlFor="webhook-secret">
              {webhookConfigured ? "Update webhook secret" : "Webhook secret"}
            </Label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Input
                  id="webhook-secret"
                  type={showSecret ? "text" : "password"}
                  value={webhookSecret}
                  onChange={(e) => setWebhookSecret(e.target.value)}
                  placeholder={webhookConfigured ? "Paste new secret to update…" : "Paste your webhook secret…"}
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowSecret(!showSecret)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <Button onClick={saveWebhookSecret} disabled={savingWebhook || !webhookSecret.trim()}>
                {savingWebhook ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Save
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Your secret is stored securely and never shown again after saving.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
