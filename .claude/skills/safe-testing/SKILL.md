---
name: safe-testing
description: How to verify changes in this project without contacting real registrants. Load BEFORE any step that could send an email or SMS, write to the registrations table, or exercise submit/verify/confirm-attendance/admin-data POST actions against live data — including anything framed as a "quick test", "dry run", or "smoke test". Triggers on - testing a send, verifying a fix end to end, checking an endpoint, trying an action, seeding test data.
---

# Safe testing on RELAY 2026

This project's database is **live production data** for a real conference. Every
row in `registrations` is a person who paid to attend. There is no staging copy.

## The hard rule

**Never send an email or SMS to, or write to the row of, a real registrant
without asking first and getting an explicit yes.**

No exceptions for:
- something you have labelled a test, dry run, or smoke test
- an action you believe is reversible
- being confident the code is correct
- the user having approved a *similar* action earlier in the session

An email cannot be unsent. A registrant receiving a message from an unfinished
feature is a trust problem for the ministry, not a technical one.

## What happened when this was ignored

On 2026-08-06, verifying a routing fix, I added `dry_run: true` to an
`attendance_invite` payload and posted it. **That flag does not exist** — it was
never written, never grepped for, and the handler ignored it. The subject was
chosen by querying the live confirmed cohort, so a real paid registrant received
a pre-conference invitation for a feature still in progress.

The bug being verified was visible by reading the two handlers side by side. The
send proved nothing that reading could not.

## Verify like this instead

In rough order of preference:

1. **Read the code.** Most routing, guard and eligibility bugs are provable by
   reading the handler. This is usually enough.
2. **Unit-test pure functions.** Template builders, `analyzeMessage`,
   `normalizePHMobile`, `attendanceCell`, filter predicates — extract and run
   them over fabricated inputs. See the patterns already used in this repo.
3. **Hit guards deliberately.** Post *ineligible* ids so the handler returns 400
   or `skipped` before any send. This proves the guard without side effects —
   confirm the response shows `sent: 0` and nothing was written.
4. **Stub the boundary.** Pass a fake `supabase` whose `insert`/`update` record
   calls instead of performing them.
5. **Read-only queries.** Always fine, no permission needed.

## If a live send is genuinely the only way

Stop and ask. State plainly:
- exactly **who** would be contacted (name, email, mobile)
- **what** they would receive
- what it **costs** (SMS credits) and that it **cannot be undone**

Then wait for a yes. Prefer a subject whose contact details belong to the user
over any third party.

## Before running anything that could send

- Grep for any flag you are relying on. If `dry_run`, `test`, or `preview` is
  not in the handler, it does not exist.
- Check the eligibility rules and confirm your subject fails at least one.
- Ask whether reading the code would answer the question just as well.

## Always safe without asking

- `SELECT`-style reads against Supabase
- `node --check`, extracting and parsing inline scripts
- Running pure functions from `netlify/lib/`
- Writing and running scripts under the scratchpad directory
- Generating files that are not executed (SQL scripts, CSV exports)
