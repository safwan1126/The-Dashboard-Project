"use server";

import { getAccessToken } from "./getAccessToken";

type MsTask = { id: string; title: string; status: string };

const LIST_NAME = "LifeOS";

export type RemoteTask = { id: string; name: string; done: boolean };

export async function fetchMicrosoftTasks(): Promise<RemoteTask[]> {
  const accessToken = await getAccessToken();
  if (!accessToken) return [];

  // Find the LifeOS list
  const listsRes = await fetch("https://graph.microsoft.com/v1.0/me/todo/lists", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const listsData = await listsRes.json();
  const list = listsData.value?.find((l: { displayName: string }) => l.displayName === LIST_NAME);
  if (!list) return [];

  // Fetch all tasks in the list
  const tasksRes = await fetch(
    `https://graph.microsoft.com/v1.0/me/todo/lists/${list.id}/tasks`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  const tasksData = await tasksRes.json();

  return (tasksData.value ?? []).map((t: MsTask) => ({
    id: t.id,
    name: t.title,
    done: t.status === "completed",
  }));
}
