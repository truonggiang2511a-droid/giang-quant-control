import { supabase } from "./supabase";

export async function signIn(email, password) {
  if (!supabase) {
    throw new Error("Supabase chưa được cấu hình.");
  }

  return await supabase.auth.signInWithPassword({
    email,
    password,
  });
}

export async function signOut() {
  if (!supabase) return;

  return await supabase.auth.signOut();
}

export async function getCurrentSession() {
  if (!supabase) return null;

  const { data, error } =
    await supabase.auth.getSession();

  if (error) {
    throw error;
  }

  return data.session;
}
