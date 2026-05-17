# FF Council — Deploy Checklist

Steps to go from local dev → live URL. Each step is independent; do them in any order, but the suggested order is fastest path to live.

## 1. Push to GitHub

```bash
cd ~/ff-council
git init      # if not already
git add .
git commit -m "Initial commit"
gh repo create ff-council --private --source=. --remote=origin --push
```

(Or create the repo at github.com/new and use `git remote add` + `git push`.)

**Important:** confirm `.env.local` and `data/futures-mock.json` are gitignored. The `.env.local` is auto-ignored by Next.js defaults; check `scripts/api-samples/` too.

## 2. Buy a domain

Suggested: `ffcouncil.com`, `ffcouncil.app`, or `ffcouncil.io`. Use Namecheap, Cloudflare Registrar, or Vercel Domains. ~$10-15/year.

## 3. Deploy to Vercel

1. Go to [vercel.com/new](https://vercel.com/new)
2. Import the GitHub repo
3. Framework: Next.js (auto-detected)
4. **Environment variables** — add all of these from your local `.env.local`:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `SPORTSDATAIO_API_KEY` (optional; not used yet at runtime)
   - `ANTHROPIC_API_KEY` (only when you start scraping Vegas data)
5. Click Deploy. First build ~2 minutes.
6. Once live, attach your custom domain under Project Settings → Domains.

## 4. Update Supabase auth URLs

After Vercel gives you a production URL:

1. Open [Supabase URL Configuration](https://supabase.com/dashboard/project/nhoeirxtusoggshtgrzb/auth/url-configuration)
2. Set **Site URL** to your production URL (e.g. `https://ffcouncil.com`)
3. Under **Redirect URLs**, add:
   - `https://ffcouncil.com/**`
   - `http://localhost:3001/**` (keep for local dev)
4. Save

## 5. Real SMTP for magic links (Resend)

Supabase's default email sender is rate-limited and lands in spam. Switch to Resend:

1. Sign up at [resend.com](https://resend.com) — free tier: 3,000 emails/month
2. Verify your domain (add DNS records)
3. Generate an API key
4. In Supabase: **Authentication → Emails → SMTP Settings**
   - Host: `smtp.resend.com`
   - Port: 465
   - User: `resend`
   - Password: your Resend API key
   - Sender: `noreply@ffcouncil.com` (or whatever address from your verified domain)

## 6. Add GitHub Actions secrets

For the nightly data refresh workflow to run:

1. GitHub repo → **Settings → Secrets and variables → Actions → New repository secret**
2. Add:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`

The workflow at `.github/workflows/refresh-data.yml` runs nightly at 09:00 UTC.

## 7. Affiliate program applications (do early — takes 1-2 weeks)

Apply now so accounts are ready by launch:

- DraftKings affiliate: [draftkings.com/affiliates](https://draftkings.com/affiliates)
- FanDuel affiliate: [fanduel.com/affiliates](https://fanduel.com/affiliates)
- (Optional) Caesars, BetMGM affiliate programs

Once approved, drop the affiliate URL on player rows ("See this line at DraftKings →").

## 8. Optional: analytics

- [Plausible](https://plausible.io) — $9/mo, privacy-friendly, no cookie banner needed
- [Posthog](https://posthog.com) — free tier, more features
- Vercel Analytics — built-in, free starter tier

## Smoke test checklist after deploy

- [ ] Homepage renders
- [ ] `/league` accepts a Sleeper league ID and analyzes
- [ ] `/trade` calculator loads
- [ ] Magic-link signup arrives in inbox (not spam)
- [ ] `/council/rankings` editor works for a signed-in member
- [ ] Run `npm run fetch:espn` locally — confirm it can still hit Supabase via the production keys
