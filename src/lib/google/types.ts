// Shared calendar types. Kept in their own module so client components can
// import them without pulling in the server-only fetching code.

export type CalendarEvent = {
  id: string;
  title: string;
  start: string; // "HH:MM", "" for all-day
  end: string;
  startMin: number; // minutes since midnight, for timeline positioning
  endMin: number;
  allDay: boolean;
};

// Events bucketed by "YYYY-MM-DD", one entry per requested day.
export type CalendarDays = Record<string, CalendarEvent[]>;

export type CalendarResult =
  | { status: "ok"; days: CalendarDays }
  | { status: "disconnected" };
