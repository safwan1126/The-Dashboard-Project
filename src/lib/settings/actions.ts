"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export async function updateProfileName(name: string): Promise<{ success: boolean }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false };

  const { error } = await supabase
    .from("profiles")
    .update({ full_name: name.trim(), updated_at: new Date().toISOString() })
    .eq("id", user.id);

  if (error) return { success: false };
  revalidatePath("/", "layout");
  return { success: true };
}

export async function disconnectMicrosoft(): Promise<{ success: boolean }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false };

  const { error } = await supabase.from("microsoft_tokens").delete().eq("user_id", user.id);
  if (error) return { success: false };
  revalidatePath("/", "layout");
  return { success: true };
}

export async function disconnectGoogle(): Promise<{ success: boolean }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false };

  const { error } = await supabase.from("google_tokens").delete().eq("user_id", user.id);
  if (error) return { success: false };
  revalidatePath("/", "layout");
  return { success: true };
}
