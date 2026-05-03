import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const missingSupabaseConfigKeys = [
  supabaseUrl ? null : "VITE_SUPABASE_URL",
  supabaseAnonKey ? null : "VITE_SUPABASE_ANON_KEY",
].filter((key): key is string => Boolean(key));

export const isSupabaseConfigured = missingSupabaseConfigKeys.length === 0;

export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(supabaseUrl!, supabaseAnonKey!, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null;

export function requireSupabaseClient(): SupabaseClient {
  if (!supabase) {
    throw new Error("Supabase connection is not configured.");
  }

  return supabase;
}
