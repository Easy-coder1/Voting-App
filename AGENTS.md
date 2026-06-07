# AGENTS.md

## Project overview

NUTFS E-Voting - a Vite + Tailwind frontend that talks to an InsForge backend (`https://rv9eiy4g.eu-central.insforge.app`).

## Environment variables

All secrets live in `.env.local` (never committed). Vercel gets them from Project - Settings - Environment Variables.

| Variable | Purpose |
|---|---|
| `VITE_INSFORGE_URL` | InsForge API base URL |
| `VITE_INSFORGE_ANON_KEY` | InsForge anonymous/public API key |

## InsForge SDK patterns (for future edits)

- Database inserts take an array: `insforge.database.from('table').insert([{ ... }])`.
- Reference users with `auth.users(id)` in SQL; use `auth.uid()` in RLS policies.
- Auth: `insforge.auth.signInWithPassword({ email, password })` / `signUp({ email, password, name })` / `signOut()`.
- Current user: `insforge.auth.getCurrentUser()` returns `{ data: { user }, error }`.
