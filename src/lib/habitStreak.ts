// Pure habit-streak math, split out from data/habits.ts (a "use server" file,
// which may only export async Server Actions at its top level).

function toDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Counts consecutive scheduled days, ending today (or yesterday if today is
// scheduled but not yet completed), that have a completion recorded.
export function computeStreak(frequency: number[], completedDates: Set<string>, today = new Date()): number {
  if (frequency.length === 0) return 0;

  const cursor = new Date(today);
  cursor.setHours(0, 0, 0, 0);
  if (frequency.includes(cursor.getDay()) && !completedDates.has(toDateKey(cursor))) {
    cursor.setDate(cursor.getDate() - 1);
  }

  let streak = 0;
  // Bounded walk-back so a habit with no completions can't loop forever.
  for (let i = 0; i < 3650; i++) {
    if (frequency.includes(cursor.getDay())) {
      if (!completedDates.has(toDateKey(cursor))) break;
      streak++;
    }
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}
