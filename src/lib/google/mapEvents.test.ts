import { describe, expect, it } from "vitest";
import { eventsForDay, type GcalEvent } from "./mapEvents";

const TZ = "Europe/London"; // UTC+1 in July, so zoning actually matters

describe("eventsForDay", () => {
  it("keeps a timed event on its own day and drops the neighbouring days", () => {
    const items: GcalEvent[] = [
      {
        id: "a",
        summary: "Standup",
        start: { dateTime: "2026-07-15T09:00:00+01:00" },
        end: { dateTime: "2026-07-15T09:30:00+01:00" },
      },
    ];

    expect(eventsForDay(items, "2026-07-15", TZ)).toEqual([
      { id: "a", title: "Standup", start: "09:00", end: "09:30", startMin: 540, endMin: 570, allDay: false },
    ]);
    expect(eventsForDay(items, "2026-07-14", TZ)).toEqual([]);
    expect(eventsForDay(items, "2026-07-16", TZ)).toEqual([]);
  });

  it("clamps a multi-day timed event to each day's window", () => {
    const items: GcalEvent[] = [
      {
        id: "b",
        summary: "Offsite",
        start: { dateTime: "2026-07-15T22:00:00+01:00" },
        end: { dateTime: "2026-07-16T10:00:00+01:00" },
      },
    ];

    const [first] = eventsForDay(items, "2026-07-15", TZ);
    expect(first).toMatchObject({ start: "22:00", startMin: 1320, endMin: 24 * 60 });

    const [second] = eventsForDay(items, "2026-07-16", TZ);
    expect(second).toMatchObject({ start: "00:00", end: "10:00", startMin: 0, endMin: 600 });
  });

  it("spreads an all-day event across its range, exclusive of end.date", () => {
    const items: GcalEvent[] = [
      { id: "c", summary: "Leave", start: { date: "2026-07-15" }, end: { date: "2026-07-17" } },
    ];

    expect(eventsForDay(items, "2026-07-15", TZ)).toHaveLength(1);
    expect(eventsForDay(items, "2026-07-16", TZ)).toHaveLength(1);
    // end.date is exclusive, so the 17th is not part of the event
    expect(eventsForDay(items, "2026-07-17", TZ)).toEqual([]);
    expect(eventsForDay(items, "2026-07-14", TZ)).toEqual([]);
  });

  it("reads times in the viewer's timezone, not the server's", () => {
    const items: GcalEvent[] = [
      {
        id: "d",
        summary: "Late call",
        start: { dateTime: "2026-07-15T23:30:00Z" },
        end: { dateTime: "2026-07-15T23:45:00Z" },
      },
    ];

    // 23:30Z is 00:30 on the 16th in London (UTC+1 in July)
    expect(eventsForDay(items, "2026-07-15", TZ)).toEqual([]);
    expect(eventsForDay(items, "2026-07-16", TZ)).toMatchObject([{ start: "00:30", end: "00:45" }]);

    // ...but still the 15th for a viewer in New York
    expect(eventsForDay(items, "2026-07-15", "America/New_York")).toMatchObject([{ start: "19:30" }]);
  });

  it("sorts all-day events first, then by start time", () => {
    const items: GcalEvent[] = [
      {
        id: "late",
        start: { dateTime: "2026-07-15T16:00:00+01:00" },
        end: { dateTime: "2026-07-15T17:00:00+01:00" },
      },
      {
        id: "early",
        start: { dateTime: "2026-07-15T08:00:00+01:00" },
        end: { dateTime: "2026-07-15T09:00:00+01:00" },
      },
      { id: "allday", start: { date: "2026-07-15" }, end: { date: "2026-07-16" } },
    ];

    expect(eventsForDay(items, "2026-07-15", TZ).map((e) => e.id)).toEqual(["allday", "early", "late"]);
  });

  it("falls back to a placeholder title when Google omits the summary", () => {
    const items: GcalEvent[] = [
      {
        id: "e",
        start: { dateTime: "2026-07-15T12:00:00+01:00" },
        end: { dateTime: "2026-07-15T13:00:00+01:00" },
      },
    ];

    expect(eventsForDay(items, "2026-07-15", TZ)[0].title).toBe("(untitled)");
  });
});
