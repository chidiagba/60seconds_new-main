# Supabase Dashboard – OTP Setup (Signup + Forget Password)

Client ko **mobile app par hi** OTP se verify / password reset karwana hai. Iske liye ye steps Supabase Dashboard par karne hain.

---

## Step 1: `otp_codes` table banana

1. **Supabase Dashboard** kholo → Project select karo  
2. Left side **SQL Editor** par jao  
3. **New query** kholo  
4. Neeche wala SQL paste karo aur **Run** karo:

```sql
-- OTP codes for signup and password recovery (in-app, no email link)
create table if not exists public.otp_codes (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  code text not null,
  type text not null check (type in ('signup', 'recovery')),
  user_id uuid null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

-- Index for quick lookup and cleanup
create index if not exists idx_otp_codes_email_type on public.otp_codes (email, type);
create index if not exists idx_otp_codes_expires on public.otp_codes (expires_at);

-- RLS: only service role (edge functions) should use this; anon/authenticated = no access
alter table public.otp_codes enable row level security;

-- (No policies = anon/auth get no access; edge functions use service_role and bypass RLS)
```

5. **Run** dabao – `otp_codes` table create ho jana chahiye.

---

## Step 2: Edge Functions ke liye Secrets check karna

1. **Project Settings** (gear icon) → **Edge Functions**  
2. **Secrets** section mein ye hona chahiye:
   - `SUPABASE_URL` – usually auto
   - `SUPABASE_SERVICE_ROLE_KEY` – usually auto
   - `POSTMARK_API_KEY` – agar `send-welcome-email` / `send-password-reset` chal raha hai to yeh pehle se hi hoga

Agar `POSTMARK_API_KEY` nahi hai to:
- Postmark account se **Server API Token** lo  
- **Add secret** → Name: `POSTMARK_API_KEY`, Value: token

---

## Step 3: Edge Functions deploy karna

Yeh 2 nayi functions hain: `send-otp` aur `verify-otp`.  
Code project ke andar `supabase/functions/send-otp` aur `supabase/functions/verify-otp` mein hai.

### Option A: Supabase CLI se (recommended)

Project root par:

```bash
npx supabase functions deploy send-otp
npx supabase functions deploy verify-otp
```

(Pehle `supabase login` zaroor karna agar login nahi hai.)

### Option B: Dashboard se (manual)

1. **Edge Functions** → **Create function**  
2. `send-otp` naam se create karo, `supabase/functions/send-otp/index.ts` ka code paste karo, deploy karo  
3. Phir `verify-otp` ke liye same tarah

---

## Step 4: Auth settings (optional – link ab bhi kaam karega)

- **Authentication** → **Providers** → **Email**  
  - **Confirm email** = ON rehne do (OTP ke sath sath agar koi link bhi use kare to chal jaye)  
- **URL Configuration**:
  - **Site URL**: app ka main URL (e.g. `https://yourapp.com` ya custom scheme `myapp://`)  
  - **Redirect URLs** mein agar deep link add karna hai to add karo (OTP flow ke liye zaroori nahi)

---

## Step 5: Deploy ke baad test karna

1. **Edge Functions** → `send-otp` → **Logs**  
   - App se “Send OTP” / “Resend” dabao, logs mein request dikhna chahiye  
2. `verify-otp` ke **Logs** bhi check karo jab OTP verify karo  

Agar 4xx/5xx aaye to logs se error dekh kar fix karo.

---

## Short checklist

| # | Kaam | Done? |
|---|------|-------|
| 1 | `otp_codes` table SQL run | ☐ |
| 2 | `POSTMARK_API_KEY` (aur zaruri secrets) set | ☐ |
| 3 | `send-otp` deploy | ☐ |
| 4 | `verify-otp` deploy | ☐ |
| 5 | Dono functions ke logs se ek baar test | ☐ |

---

## Agar `send-otp` / `verify-otp` 404 ya “function not found” de

- Confirm karo dono functions **deploy** hue hain (Edge Functions list mein dikhne chahiye)  
- Thodi der wait karke phir try karo  
- CLI se deploy kiya hai to: `npx supabase functions list` se check karo

---

## Agar OTP email nahi aa raha

- Postmark **Activity** / **Logs** check karo  
- `POSTMARK_API_KEY` sahi hai aur **Sender signature** verify hai  
- `send-otp` logs mein error to nahi (e.g. “Postmark error”, “Invalid API key”)
