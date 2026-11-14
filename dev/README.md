# Developer archive

Screens here are outside Expo Router and are not shipped as routes. Old scripts retain their historical relative paths and are reference material; inspect paths before running them.

`legacy-sql/` is an archive, not a deployment source. Some archived scripts disable RLS or grant broad permissions. Do not run them. `supabase/migrations/` is the canonical, ordered database schema. Use `python3 scripts/test-database.py` with a dedicated empty `TEST_DATABASE_URL` to check a clean rebuild.
