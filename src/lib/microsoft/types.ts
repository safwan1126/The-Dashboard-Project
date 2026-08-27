// Shared Microsoft To Do types. Kept in their own module so client components
// can import them without pulling in the server-only fetching code.

export type RemoteTask = { id: string; name: string; done: boolean };
