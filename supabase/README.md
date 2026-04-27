# Supabase setup (prepared)

1. Apply migration: `supabase db push`.
2. Seed optional demo data: `supabase db reset`.
3. App runs without keys using mock mode. Add `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY` to enable backend.

Privacy: contacts are local-first; server sync requires explicit consent and stores minimal hashed identifiers.
