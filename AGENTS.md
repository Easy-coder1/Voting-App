# NUTFS E-Voting — Supabase

Vite + Tailwind frontend backed by **Supabase** (Postgres, Auth, RLS, Realtime).

## Environment variables

All secrets live in `.env.local` (never committed). Vercel gets them from Project → Settings → Environment Variables.

| Variable | Purpose |
|---|---|
| `VITE_SUPABASE_URL` | Supabase project URL (`https://<ref>.supabase.co`) |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon/public key (safe in the browser with RLS) |

## Supabase SDK patterns

- Database inserts take an array: `supabase.from('table').insert([{ ... }])`.
- Reference users with `auth.users(id)` in SQL; use `auth.uid()` in RLS policies.
- Auth: `supabase.auth.signInWithPassword({ email, password })` / `signUp({ email, password, options: { data: { full_name } } })` / `signOut()`.
- Current user: `getCurrentUser()` in `src/js/supabase.js` wraps `supabase.auth.getUser()`.

## Database setup

1. Create a project at [supabase.com](https://supabase.com).
2. Run the SQL in `supabase/migrations/` via the SQL Editor (all files in timestamp order), or use the Supabase CLI: `supabase link` then `supabase db push`.
3. Promote your first admin (after registering):

```sql
UPDATE public.profiles
SET role = 'admin', account_status = 'approved', voting_rights = true
WHERE email = 'your@email.com';
```

## Local dev

```bash
npm install
cp .env.example .env.local   # then edit with your keys
npm run dev
```
