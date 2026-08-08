"use server";

import { createClient } from "@/lib/supabase/server";

const BUCKET = "note-images";
const SIGNED_URL_TTL = 60 * 60 * 24 * 7; // 7 days — this app never re-fetches notes mid-session
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

export type NoteImage = { id: string; url: string; storagePath: string };
export type NoteRow = {
  id: string;
  body: string;
  createdAt: string;
  updatedAt: string;
  images: NoteImage[];
};

type RawImage = { id: string; storage_path: string; position: number };
type RawNote = { id: string; body: string; created_at: string; updated_at: string; note_images: RawImage[] };

async function hydrateNotes(
  supabase: Awaited<ReturnType<typeof createClient>>,
  rows: RawNote[]
): Promise<NoteRow[]> {
  const allPaths = rows.flatMap((r) => r.note_images.map((i) => i.storage_path));
  const urlByPath = new Map<string, string>();

  if (allPaths.length > 0) {
    const { data: signed, error } = await supabase.storage
      .from(BUCKET)
      .createSignedUrls(allPaths, SIGNED_URL_TTL);
    if (error) throw error;
    for (const s of signed ?? []) {
      if (s.signedUrl) urlByPath.set(s.path ?? "", s.signedUrl);
    }
  }

  return rows.map((r) => ({
    id: r.id,
    body: r.body,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    images: [...r.note_images]
      .sort((a, b) => a.position - b.position)
      .map((i) => ({ id: i.id, storagePath: i.storage_path, url: urlByPath.get(i.storage_path) ?? "" })),
  }));
}

export async function getNotes(userId?: string): Promise<NoteRow[]> {
  const supabase = await createClient();
  if (!userId) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Not authenticated");
    userId = user.id;
  }

  const { data, error } = await supabase
    .from("notes")
    .select("id, body, created_at, updated_at, note_images(id, storage_path, position)")
    .order("updated_at", { ascending: false });

  if (error) { console.error("[getNotes]", error); throw error; }

  return hydrateNotes(supabase, (data ?? []) as RawNote[]);
}

function validateImageFile(file: File) {
  if (!ALLOWED_IMAGE_TYPES.has(file.type)) throw new Error(`Unsupported image type: ${file.type}`);
  if (file.size > MAX_IMAGE_BYTES) throw new Error(`Image too large: ${file.name}`);
}

async function uploadImages(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  noteId: string,
  files: File[]
): Promise<{ storage_path: string; position: number }[]> {
  const uploads = [];
  for (const [i, file] of files.entries()) {
    validateImageFile(file);
    const path = `${userId}/${noteId}/${crypto.randomUUID()}-${file.name}`;
    const { error } = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type });
    if (error) throw error;
    uploads.push({ storage_path: path, position: i });
  }
  return uploads;
}

function imagesFromFormData(formData: FormData): File[] {
  return formData.getAll("images").filter((v): v is File => v instanceof File && v.size > 0);
}

export async function addNote(formData: FormData): Promise<NoteRow> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const body = String(formData.get("body") ?? "");

  const { data: note, error } = await supabase
    .from("notes")
    .insert({ user_id: user.id, body })
    .select("id, body, created_at, updated_at")
    .single();
  if (error) throw error;

  const files = imagesFromFormData(formData);
  let rawImages: RawImage[] = [];
  if (files.length > 0) {
    const uploaded = await uploadImages(supabase, user.id, note.id, files);
    const { data: inserted, error: imgError } = await supabase
      .from("note_images")
      .insert(uploaded.map((u) => ({ ...u, note_id: note.id, user_id: user.id })))
      .select("id, storage_path, position");
    if (imgError) throw imgError;
    rawImages = inserted ?? [];
  }

  const [hydrated] = await hydrateNotes(supabase, [{ ...note, note_images: rawImages }]);
  return hydrated;
}

export async function updateNoteBody(id: string, body: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("notes")
    .update({ body, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

export async function deleteNote(id: string): Promise<void> {
  const supabase = await createClient();

  const { data: images, error: fetchError } = await supabase
    .from("note_images")
    .select("storage_path")
    .eq("note_id", id);
  if (fetchError) throw fetchError;

  const paths = (images ?? []).map((i) => i.storage_path);
  if (paths.length > 0) {
    const { error: removeError } = await supabase.storage.from(BUCKET).remove(paths);
    if (removeError) console.error("[deleteNote] failed to remove storage objects", removeError);
  }

  const { error } = await supabase.from("notes").delete().eq("id", id);
  if (error) throw error;
}

export async function addNoteImages(noteId: string, formData: FormData): Promise<NoteImage[]> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const files = imagesFromFormData(formData);
  if (files.length === 0) return [];

  const { count } = await supabase
    .from("note_images")
    .select("id", { count: "exact", head: true })
    .eq("note_id", noteId);

  const uploaded = await uploadImages(supabase, user.id, noteId, files);
  const startPosition = count ?? 0;
  const { data: inserted, error } = await supabase
    .from("note_images")
    .insert(uploaded.map((u, i) => ({ ...u, position: startPosition + i, note_id: noteId, user_id: user.id })))
    .select("id, storage_path, position");
  if (error) throw error;

  await supabase.from("notes").update({ updated_at: new Date().toISOString() }).eq("id", noteId);

  const [hydrated] = await hydrateNotes(supabase, [
    { id: noteId, body: "", created_at: "", updated_at: "", note_images: inserted ?? [] },
  ]);
  return hydrated.images;
}

export async function removeNoteImage(imageId: string): Promise<void> {
  const supabase = await createClient();

  const { data: image, error: fetchError } = await supabase
    .from("note_images")
    .select("storage_path, note_id")
    .eq("id", imageId)
    .single();
  if (fetchError) throw fetchError;

  const { error: removeError } = await supabase.storage.from(BUCKET).remove([image.storage_path]);
  if (removeError) console.error("[removeNoteImage] failed to remove storage object", removeError);

  const { error } = await supabase.from("note_images").delete().eq("id", imageId);
  if (error) throw error;

  await supabase.from("notes").update({ updated_at: new Date().toISOString() }).eq("id", image.note_id);
}
