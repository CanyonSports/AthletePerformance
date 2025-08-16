
# Canyon Sports Performance — No Demo (v6)

- Auth-only (no demo routes)
- Realtime dashboard from `public.measurements`
- Root "/" redirects to "/login"
- "@/lib/*" alias enabled in tsconfig
- Includes `supabase.sql` and `.env.local.example`

## Setup
1) Copy `.env.local.example` to `.env.local` and set:
   NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
2) In Supabase → SQL Editor, run `supabase.sql`
3) npm install
4) npm run dev
5) http://localhost:3000 → /login
