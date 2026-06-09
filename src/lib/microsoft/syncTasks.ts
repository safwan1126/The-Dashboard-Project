"use server";

import { getAccessToken } from "./getAccessToken";

type Task = { name: string; time: string; done: boolean; starred: boolean };

const LIST_NAME = "NeeyazOS";

// Get or create the NeeyazOS task list in Microsoft To Do
async function getOrCreateList(accessToken: string): Promise<string> {
  const res = await fetch("https://graph.microsoft.com/v1.0/me/todo/lists", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await res.json();
  const existing = data.value?.find((l: { displayName: string; id: string }) => l.displayName === LIST_NAME);
  if (existing) return existing.id;

  // Create the list if it doesn't exist
  const createRes = await fetch("https://graph.microsoft.com/v1.0/me/todo/lists", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ displayName: LIST_NAME }),
  });
  const created = await createRes.json();
  return created.id;
}

export async function syncTasksToMicrosoft(tasks: Task[]): Promise<{ success: boolean; error?: string }> {
  const accessToken = await getAccessToken();
  if (!accessToken) return { success: false, error: "Not connected to Microsoft" };

  try {
    const listId = await getOrCreateList(accessToken);
    console.log("List ID:", listId);

    // Fetch existing tasks in the list to avoid duplicates
    const existingRes = await fetch(
      `https://graph.microsoft.com/v1.0/me/todo/lists/${listId}/tasks`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    const existingData = await existingRes.json();
    console.log("Existing tasks response:", JSON.stringify(existingData));
    type MsTask = { id: string; title: string; status: string };
    const existingTasks: MsTask[] = existingData.value ?? [];
    const existingByTitle = new Map(existingTasks.map((t) => [t.title, t]));

    // Split into new tasks and existing ones that need a status update
    const toCreate = tasks.filter((t) => !existingByTitle.has(t.name));
    const toUpdate = tasks.filter((t) => {
      const ms = existingByTitle.get(t.name);
      if (!ms) return false;
      const msCompleted = ms.status === "completed";
      return msCompleted !== t.done;
    });

    console.log("Tasks to create:", toCreate.map(t => t.name));
    console.log("Tasks to update:", toUpdate.map(t => t.name));

    const results = await Promise.all([
      // Create new tasks
      ...toCreate.map(async (task) => {
        const res = await fetch(`https://graph.microsoft.com/v1.0/me/todo/lists/${listId}/tasks`, {
          method: "POST",
          headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
          body: JSON.stringify({ title: task.name, status: task.done ? "completed" : "notStarted" }),
        });
        return res.json();
      }),
      // Update completion status of existing tasks
      ...toUpdate.map(async (task) => {
        const ms = existingByTitle.get(task.name)!;
        const res = await fetch(`https://graph.microsoft.com/v1.0/me/todo/lists/${listId}/tasks/${ms.id}`, {
          method: "PATCH",
          headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
          body: JSON.stringify({ status: task.done ? "completed" : "notStarted" }),
        });
        return res.json();
      }),
    ]);

    console.log("Sync complete, results:", results.length);
    return { success: true };
  } catch (err) {
    console.error("Sync failed:", err);
    return { success: false, error: "Sync failed" };
  }
}
