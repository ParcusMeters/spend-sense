import { format, startOfMonth, endOfMonth, subMonths, startOfWeek, endOfWeek } from "date-fns";

export function getCurrentMonth(): { start: string; end: string } {
  const now = new Date();
  return {
    start: format(startOfMonth(now), "yyyy-MM-dd"),
    end: format(endOfMonth(now), "yyyy-MM-dd"),
  };
}

export function getLastNMonths(n: number): { start: string; end: string } {
  const now = new Date();
  return {
    start: format(startOfMonth(subMonths(now, n - 1)), "yyyy-MM-dd"),
    end: format(endOfMonth(now), "yyyy-MM-dd"),
  };
}

export function getCurrentWeek(): { start: string; end: string } {
  const now = new Date();
  return {
    start: format(startOfWeek(now, { weekStartsOn: 1 }), "yyyy-MM-dd"),
    end: format(endOfWeek(now, { weekStartsOn: 1 }), "yyyy-MM-dd"),
  };
}

export function formatDate(date: string): string {
  return format(new Date(date), "d MMM yyyy");
}

export function formatShortDate(date: string): string {
  return format(new Date(date), "d MMM");
}

export function getMonthLabel(date: string): string {
  return format(new Date(date), "MMM yyyy");
}
