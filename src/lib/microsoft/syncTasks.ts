"use server";

import { getAccessToken } from "./getAccessToken";

type Task = { msId?: string; name: string; time: string; done: boolean; starred: boolean };

// A task that was just typed has no `msId` yet. The sync reports back the id it
// created (or adopted, for a title that already existed in To Do) so the
// dashboard can attach it and match by id from then on.
export type SyncedId = { name: string; msId: string };
export type SyncResult = { success: boolean; error?: string; ids?: SyncedId[] };

type MsTask = { id: string; title: string; status: string };

const LIST_NAME = "LifeOS";
const GRAPH = "https://graph.microsoft.com/v1.0/me/todo/lists";

function statusFor(done: boolean) {
  return done ? "completed" : "notStarted";
}

// Get or create the LifeOS task list in Microsoft To Do
async function getOrCreateList(accessToken: string): Promise<string> {
  const res = await fetch(GRAPH, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await res.json();
  const existing = data.value?.find((l: { displayName: string; id: string }) => l.displayName === LIST_NAME);
  if (existing) return existing.id;

  // Create the list if it doesn't exist
  const createRes = await fetch(GRAPH, {
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

export async function deleteTaskFromMicrosoft(taskId: string): Promise<void> {
  const accessToken = await getAccessToken();
  if (!accessToken) return;
  const listId = await getOrCreateList(accessToken);
  await fetch(`${GRAPH}/${listId}/tasks/${taskId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

export async function syncTasksToMicrosoft(tasks: Task[]): Promise<SyncResult> {
  const accessToken = await getAccessToken();
  if (!accessToken) return { success: false, error: "Not connected to Microsoft" };

  try {
    const listId = await getOrCreateList(accessToken);
    const authJson = {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    };

    const existingRes = await fetch(`${GRAPH}/${listId}/tasks`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const existingData = await existingRes.json();
    const existingTasks: MsTask[] = existingData.value ?? [];
    const byId = new Map(existingTasks.map((t) => [t.id, t]));
    // Only consulted for a task that has no id of its own yet: matching on
    // title there keeps a task that already exists in To Do (added on the
    // phone, say) from being created a second time.
    const byTitle = new Map(existingTasks.map((t) => [t.title, t]));

    // Matching is by id, so a task renamed on the dashboard is renamed in To Do
    // rather than created again under its new title.
    const toCreate: Task[] = [];
    const toUpdate: { task: Task; remote: MsTask }[] = [];
    const adopted: SyncedId[] = [];

    for (const task of tasks) {
      const remote = task.msId ? byId.get(task.msId) : byTitle.get(task.name);
      if (!remote) {
        toCreate.push(task);
        continue;
      }
      if (!task.msId) adopted.push({ name: task.name, msId: remote.id });
      if (remote.title !== task.name || (remote.status === "completed") !== task.done) {
        toUpdate.push({ task, remote });
      }
    }

    const [created] = await Promise.all([
      Promise.all(
        toCreate.map(async (task) => {
          const res = await fetch(`${GRAPH}/${listId}/tasks`, {
            method: "POST",
            headers: authJson,
            body: JSON.stringify({ title: task.name, status: statusFor(task.done) }),
          });
          const body = await res.json();
          return { name: task.name, msId: body.id as string | undefined };
        })
      ),
      Promise.all(
        toUpdate.map(({ task, remote }) =>
          fetch(`${GRAPH}/${listId}/tasks/${remote.id}`, {
            method: "PATCH",
            headers: authJson,
            body: JSON.stringify({ title: task.name, status: statusFor(task.done) }),
          })
        )
      ),
    ]);

    const ids = [
      ...adopted,
      ...created.filter((c): c is SyncedId => typeof c.msId === "string"),
    ];
    return { success: true, ids };
  } catch (err) {
    console.error("[syncTasksToMicrosoft]", err);
    return { success: false, error: "Sync failed" };
  }
}
