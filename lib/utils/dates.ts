import {
  format,
  startOfMonth,
  endOfMonth,
  subMonths,
  subWeeks,
  startOfWeek,
  endOfWeek,
} from "date-fns";

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

/** Completed Mon–Sun week immediately before the current calendar week (for weekly digests). */
export function getPreviousWeek(): { start: string; end: string } {
  const now = new Date();
  const prior = subWeeks(now, 1);
  return {
    start: format(startOfWeek(prior, { weekStartsOn: 1 }), "yyyy-MM-dd"),
    end: format(endOfWeek(prior, { weekStartsOn: 1 }), "yyyy-MM-dd"),
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
