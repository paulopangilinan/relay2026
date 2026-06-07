# RELAY 2026 — Setup Guide
# Complete this in order. Takes about 20–30 minutes.

══════════════════════════════════════════════════════
 STEP 1 — SUPABASE (Database + File Storage)
══════════════════════════════════════════════════════

1. Go to https://supabase.com → Sign Up (free)
2. Click "New Project" → name it "relay2026" → set a DB password → Create
3. Wait ~2 minutes for it to spin up
4. Go to SQL Editor (left sidebar) → New Query
5. Paste the entire contents of `supabase-schema.sql` → click Run
   ✅ You should see "Success" for each statement

6. Go to Settings → API (left sidebar)
   Copy these two values:
   - Project URL         → this is your SUPABASE_URL
   - service_role key    → this is your SUPABASE_SERVICE_ROLE_KEY
   ⚠️  Keep the service_role key secret — never put it in public code


══════════════════════════════════════════════════════
 STEP 2 — RESEND (Transactional Email)
══════════════════════════════════════════════════════

1. Go to https://resend.com → Sign Up (free, 3,000 emails/month)
2. Go to API Keys → Create API Key → name it "relay2026"
   Copy the key → this is your RESEND_API_KEY

3. Go to Domains → Add Domain
   Add your domain (e.g. yourchurch.com) and follow the DNS instructions
   OR use Resend's shared sending domain for testing (onboarding@resend.dev)

4. Update the "from" address in these two files once your domain is verified:
   - netlify/functions/submit.js   (two places)
   - netlify/functions/verify.js   (one place)
   Change: noreply@yourdomain.com → noreply@yourchurch.com


══════════════════════════════════════════════════════
 STEP 3 — NETLIFY (Hosting + Functions)
══════════════════════════════════════════════════════

1. Go to https://netlify.com → Sign Up with GitHub (free)

2. Install Netlify CLI on your computer:
   npm install -g netlify-cli

3. In your terminal, navigate to this project folder:
   cd path/to/relay-project

4. Run:
   npm install
   netlify login
   netlify init  (choose "Create & configure a new site")

5. Go to Netlify Dashboard → your site → Site Configuration → Environment Variables
   Add ALL of these:

   SUPABASE_URL              = https://xxxxx.supabase.co
   SUPABASE_SERVICE_ROLE_KEY = eyJhbGci...
   RESEND_API_KEY            = re_xxxxx
   ADMIN_EMAIL               = you@yourchurch.com
   ADMIN_PASSWORD            = choose-a-strong-password
   SITE_URL                  = https://your-site-name.netlify.app

   ⚠️  Set SITE_URL after your first deploy — Netlify gives you a URL like
       "relay2026.netlify.app". You can also set a custom domain.

6. Deploy:
   netlify deploy --prod

   Your site will be live at: https://your-site-name.netlify.app
   Admin dashboard at:        https://your-site-name.netlify.app/admin


══════════════════════════════════════════════════════
 STEP 4 — UPDATE THE QR CODE
══════════════════════════════════════════════════════

In public/index.html, find the <div class="gcash-qr"> section and replace
the placeholder SVG with your actual GCash/BPI QR image:

  <div class="gcash-qr">
    <img src="your-qr-code.png" style="width:160px;height:160px;object-fit:contain;">
  </div>

Also update the account details below the QR to your actual BPI account number.


══════════════════════════════════════════════════════
 STEP 5 — UPDATE EMAIL "FROM" ADDRESS
══════════════════════════════════════════════════════

In netlify/functions/submit.js and verify.js, replace:
  noreply@yourdomain.com  →  your verified Resend sending address


══════════════════════════════════════════════════════
 URLS AFTER DEPLOY
══════════════════════════════════════════════════════

  Registration Form:    https://your-site.netlify.app/
  Admin Dashboard:      https://your-site.netlify.app/admin/
  Submit Function:      https://your-site.netlify.app/.netlify/functions/submit
  Verify Function:      https://your-site.netlify.app/.netlify/functions/verify


══════════════════════════════════════════════════════
 CUSTOM DOMAIN (Optional)
══════════════════════════════════════════════════════

Netlify Dashboard → your site → Domain Management → Add custom domain
e.g. relay2026.yourchurch.com
Update SITE_URL environment variable to match after adding.


══════════════════════════════════════════════════════
 PROJECT FILE STRUCTURE
══════════════════════════════════════════════════════

  relay-project/
  ├── netlify.toml                    ← Netlify config
  ├── package.json                    ← Dependencies
  ├── .env.example                    ← Copy to .env for local dev
  ├── supabase-schema.sql             ← Run this in Supabase SQL editor
  ├── SETUP.md                        ← This file
  ├── netlify/
  │   └── functions/
  │       ├── submit.js               ← Handles form submissions
  │       ├── verify.js               ← Admin verify payment link
  │       └── admin-data.js           ← Feeds admin dashboard
  └── public/
      ├── index.html                  ← Registration form
      └── admin/
          └── index.html              ← Admin dashboard


══════════════════════════════════════════════════════
 TESTING LOCALLY
══════════════════════════════════════════════════════

1. Copy .env.example to .env and fill in your real values
2. Run: netlify dev
3. Visit: http://localhost:8888
   Admin:  http://localhost:8888/admin
