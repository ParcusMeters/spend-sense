# SpendSense

Personal finance dashboard that automatically categorises bank transactions using AI and provides spending insights.

```
CommBank + Up Bank → Redbark → Webhook → Next.js API → Claude AI → Supabase → Dashboard
```

## How It Works

**Redbark** (Australian Open Banking aggregator, $7.50/mo) connects to your bank accounts and sends transaction data via webhooks whenever new transactions sync. The webhook handler verifies the signature, stores transactions in Supabase, then triggers Claude AI to categorise each transaction and flag anomalies. The dashboard updates in real-time via Supabase Realtime subscriptions.

### Data Flow

1. Banks sync transactions to Redbark
2. Redbark sends a `transactions.synced` webhook POST to `/api/webhooks/redbark`
3. Webhook handler verifies HMAC-SHA256 signature, upserts accounts, inserts/updates transactions
4. Claude Sonnet 4 categorises transactions in batches (up to 20 per call) — returns category, confidence score, recurring flag, and cleaned merchant name
5. Anomaly detection checks for duplicates, unusual amounts, and subscription price changes
6. Dashboard and transaction list update in real-time

### AI Features

- **Auto-categorisation** — each transaction is classified into one of 14 categories (Groceries, Eating out, Transport, Subscriptions, etc.) with a confidence score
- **Anomaly detection** — flags duplicate charges, unusually large purchases, and subscription price changes
- **Weekly digest** — auto-generated every Monday via Vercel Cron with spending patterns and tips
- **Monthly report** — auto-generated on the 1st with full breakdown and trend analysis
- **On-demand insights** — generate an AI analysis for any time period

## Tech Stack

- **Next.js 16** (App Router, TypeScript)
- **Supabase** (Postgres, Realtime, Auth with magic link)
- **Tailwind CSS 4 + shadcn/ui**
- **Recharts** (charts)
- **Claude Sonnet 4** (categorisation, anomaly detection, insights)
- **Redbark** (bank data via webhooks)
- **Vercel** (hosting + cron)

## Setup

### Prerequisites

- Supabase project
- Anthropic API key
- Redbark account with webhook destination configured

### 1. Install dependencies

```bash
npm install
```

### 2. Set up Supabase

- Create a project at [supabase.com/dashboard](https://supabase.com/dashboard)
- Run `supabase/migrations/001_initial.sql` in the SQL Editor
- Go to **Authentication > URL Configuration** and add your app URL as a redirect URL
- Restrict sign-ups to your email (single-user app)

### 3. Configure environment variables

```bash
cp .env.local.example .env.local
```

```
NEXT_PUBLIC_SUPABASE_URL=https://xxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...
ANTHROPIC_API_KEY=sk-ant-...
REDBARK_WEBHOOK_SECRET=whsec_...
NEXT_PUBLIC_APP_URL=http://localhost:3000
CRON_SECRET=any-random-string
```

### 4. Configure Redbark webhook

Point your Redbark webhook destination to `https://your-domain.com/api/webhooks/redbark`. This must be a publicly accessible URL — use ngrok for local development or deploy to Vercel first.

### 5. Run locally

```bash
npm run dev
```

## Pages

| Route | Description |
|-------|-------------|
| `/` | Dashboard — balance cards, monthly trend chart, spending by category, recent transactions, savings projection |
| `/transactions` | Searchable/filterable transaction list with category overrides and anomaly badges |
| `/insights` | AI-generated weekly and monthly digests, on-demand analysis |
| `/projections` | Savings projection based on actual income/spending averages, goal tracking |
| `/login` | Magic link authentication |

## API Routes

| Route | Description |
|-------|-------------|
| `POST /api/webhooks/redbark` | Redbark webhook receiver (signature-verified, public) |
| `POST /api/categorise` | Manual category override for a transaction |
| `POST /api/insights/generate` | Generate an on-demand AI insight |
| `GET /api/cron/weekly-digest` | Weekly digest (Vercel Cron, Monday 9am) |
| `GET /api/cron/monthly-report` | Monthly report (Vercel Cron, 1st 9am) |

## Key Details

- **Amounts** are stored as integers in cents. Negative = debit. Display conversion: `(amount_cents / 100).toFixed(2)`
- **Category priority**: `user_category_override → ai_category → redbark_category → 'Other'`
- **Income detection**: `redbark_category = 'INCOME'` or description contains salary identifiers. Transfers between own accounts are excluded.
- **Auth**: Supabase magic link. RLS enabled on all tables — only authenticated users can access data. Webhook endpoint uses the service role key to bypass RLS.
- **Cron endpoints** are protected with a `CRON_SECRET` bearer token (Vercel sets this automatically).

## Deploy

Push to GitHub, connect to Vercel, and add the same env vars in Vercel project settings. Update `NEXT_PUBLIC_APP_URL` to your production URL and add it as a Supabase redirect URL. Update your Redbark webhook destination to the Vercel domain.
