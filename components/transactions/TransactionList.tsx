"use client";

import { useState, useEffect, useCallback } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { TransactionRow } from "./TransactionRow";
import { Search, ChevronLeft, ChevronRight } from "lucide-react";
import type { Transaction } from "@/lib/supabase/types";

const CATEGORIES = [
  "All",
  "Salary",
  "Groceries",
  "Eating out",
  "Drinks & nightlife",
  "Transport",
  "Subscriptions",
  "Entertainment",
  "Health",
  "Shopping",
  "Travel",
  "Bank fees",
  "Transfers",
  "Investing",
  "Other",
];

const PAGE_SIZE = 25;

interface TransactionWithAccount extends Transaction {
  accounts: { redbark_name: string } | null;
}

export function TransactionList() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const fromParam = searchParams.get("from") ?? "";
  const toParam = searchParams.get("to") ?? "";

  const [transactions, setTransactions] = useState<TransactionWithAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("All");
  const [direction, setDirection] = useState("all");
  const [dateFrom, setDateFrom] = useState(fromParam);
  const [dateTo, setDateTo] = useState(toParam);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);

  const supabase = createClient();

  useEffect(() => {
    setDateFrom(fromParam);
    setDateTo(toParam);
    setPage(0);
  }, [fromParam, toParam]);

  const fetchTransactions = useCallback(async () => {
    setLoading(true);
    let query = supabase
      .from("transactions")
      .select("*, accounts(redbark_name)")
      .order("date", { ascending: false })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

    if (dateFrom) {
      query = query.gte("date", dateFrom);
    }
    if (dateTo) {
      query = query.lte("date", dateTo);
    }

    if (search) {
      query = query.or(
        `description.ilike.%${search}%,merchant.ilike.%${search}%`
      );
    }

    if (category !== "All") {
      // Match our "effective" category priority:
      // user override -> AI -> raw Redbark.
      query = query.or(
        `user_category_override.eq.${category},ai_category.eq.${category},redbark_category.eq.${category}`
      );
    }

    if (direction !== "all") {
      query = query.eq("direction", direction);
    }

    const { data, error } = await query;

    if (!error && data) {
      setTransactions(data as TransactionWithAccount[]);
      setHasMore(data.length === PAGE_SIZE);
    }
    setLoading(false);
  }, [search, category, direction, dateFrom, dateTo, page]);

  useEffect(() => {
    fetchTransactions();
  }, [fetchTransactions]);

  const [selectedTxn, setSelectedTxn] = useState<string | null>(null);
  const [newCategory, setNewCategory] = useState("");

  async function handleRecategorise(transactionId: string, cat: string) {
    await fetch("/api/categorise", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transaction_id: transactionId, category: cat }),
    });
    setSelectedTxn(null);
    fetchTransactions();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
          <div className="relative min-w-[200px] flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search transactions..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(0);
              }}
              className="pl-9"
            />
          </div>
          <Select
            value={category}
            onValueChange={(v) => {
              if (v) {
                setCategory(v);
                setPage(0);
              }
            }}
          >
            <SelectTrigger className="w-full sm:w-[180px]">
              <SelectValue placeholder="Category" />
            </SelectTrigger>
            <SelectContent>
              {CATEGORIES.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={direction}
            onValueChange={(v) => {
              if (v) {
                setDirection(v);
                setPage(0);
              }
            }}
          >
            <SelectTrigger className="w-full sm:w-[140px]">
              <SelectValue placeholder="Direction" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="debit">Expenses</SelectItem>
              <SelectItem value="credit">Income</SelectItem>
            </SelectContent>
          </Select>
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="txn-date-from" className="text-xs text-muted-foreground">
                From
              </Label>
              <Input
                id="txn-date-from"
                type="date"
                value={dateFrom}
                onChange={(e) => {
                  setDateFrom(e.target.value);
                  setPage(0);
                }}
                className="w-full min-w-[9.5rem] sm:w-[9.5rem]"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="txn-date-to" className="text-xs text-muted-foreground">
                To
              </Label>
              <Input
                id="txn-date-to"
                type="date"
                value={dateTo}
                onChange={(e) => {
                  setDateTo(e.target.value);
                  setPage(0);
                }}
                className="w-full min-w-[9.5rem] sm:w-[9.5rem]"
              />
            </div>
            {(dateFrom || dateTo) && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="mb-0.5 shrink-0"
                onClick={() => {
                  setDateFrom("");
                  setDateTo("");
                  setPage(0);
                  router.replace(pathname);
                }}
              >
                Clear dates
              </Button>
            )}
          </div>
        </div>
      </div>

      <div className="space-y-2">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          </div>
        ) : transactions.length === 0 ? (
          <p className="text-center text-sm text-muted-foreground py-12">
            No transactions found.
          </p>
        ) : (
          transactions.map((txn) => (
            <div key={txn.id}>
              <TransactionRow
                transaction={txn}
                onClick={() => setSelectedTxn(selectedTxn === txn.id ? null : txn.id)}
              />
              {selectedTxn === txn.id && (
                <div className="ml-4 mt-2 flex items-center gap-2 rounded-lg bg-muted/50 p-3">
                  <span className="text-sm text-muted-foreground">Re-categorise:</span>
                  <Select
                    value={newCategory}
                    onValueChange={(v) => { if (v) setNewCategory(v); }}
                  >
                    <SelectTrigger className="w-[180px]">
                      <SelectValue placeholder="Choose category" />
                    </SelectTrigger>
                    <SelectContent>
                      {CATEGORIES.filter((c) => c !== "All").map((c) => (
                        <SelectItem key={c} value={c}>{c}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    size="sm"
                    onClick={() => newCategory && handleRecategorise(txn.id, newCategory)}
                    disabled={!newCategory}
                  >
                    Save
                  </Button>
                </div>
              )}
            </div>
          ))
        )}
      </div>

      <div className="flex items-center justify-between">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setPage(Math.max(0, page - 1))}
          disabled={page === 0}
        >
          <ChevronLeft className="mr-1 h-4 w-4" /> Previous
        </Button>
        <span className="text-sm text-muted-foreground">Page {page + 1}</span>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setPage(page + 1)}
          disabled={!hasMore}
        >
          Next <ChevronRight className="ml-1 h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
