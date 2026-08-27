// Shared pomodoro session types, importable from client components.

export type PomoSessionRow = {
  id: string;
  taskName: string | null;
  completedAt: number;
  duration: number;
};
