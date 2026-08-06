// scripts/gender-csv-to-sql.mjs
//
// Turns the reviewed gender-review.csv into a SQL script you run in the
// Supabase SQL editor, the same way as the migrations.
//
//   node scripts/gender-csv-to-sql.mjs            # validate only, writes nothing
//   node scripts/gender-csv-to-sql.mjs --write    # emit the .sql file
//
// Only `id` and `gender` are read. Blank gender rows are skipped, so a partial
// review is fine — run it again after filling in more.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';

const CSV_PATH = 'gender-review.csv';
const WRITE    = process.argv.includes('--write');

// ── CSV parsing ───────────────────────────────────────────────────────────────
// Hand-rolled rather than split(',') because names and church fields are quoted
// and contain commas — a naive split silently shifts every later column.
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }   // escaped quote
        else inQuotes = false;
      } else field += c;
      continue;
    }
    if (c === '"')       inQuotes = true;
    else if (c === ',')  { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.length > 1 || (r[0] || '').trim());
}

if (!existsSync(CSV_PATH)) {
  console.error(`Not found: ${CSV_PATH}`);
  process.exit(1);
}

const rows   = parseCsv(readFileSync(CSV_PATH, 'utf8').replace(/^﻿/, ''));
const header = rows[0].map(h => h.trim().toLowerCase());
const idIdx  = header.indexOf('id');
const genIdx = header.indexOf('gender');
const nameIdx = header.indexOf('name');

if (idIdx === -1 || genIdx === -1) {
  console.error('CSV must keep its `id` and `gender` columns.');
  process.exit(1);
}

const UUID  = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VALID = new Set(['male', 'female']);

const updates = [];
const problems = [];
let blank = 0;

rows.slice(1).forEach((r, n) => {
  const line   = n + 2;
  const id     = (r[idIdx]  || '').trim();
  const gender = (r[genIdx] || '').trim().toLowerCase();
  const name   = (r[nameIdx] || '').trim();

  if (!id) { problems.push(`line ${line}: missing id`); return; }
  if (!UUID.test(id)) { problems.push(`line ${line}: "${id}" is not a valid id`); return; }
  if (!gender) { blank++; return; }
  if (!VALID.has(gender)) {
    problems.push(`line ${line}: gender "${r[genIdx]}" for ${name} — must be male, female, or blank`);
    return;
  }
  updates.push({ id, gender, name });
});

const males   = updates.filter(u => u.gender === 'male').length;
const females = updates.filter(u => u.gender === 'female').length;

console.log(`rows read      : ${rows.length - 1}`);
console.log(`to update      : ${updates.length}  (${males} male, ${females} female)`);
console.log(`left blank     : ${blank}  (skipped — fill them in and re-run)`);
console.log(`problems       : ${problems.length}`);
for (const p of problems) console.log('  ! ' + p);

if (problems.length) {
  console.error('\nFix the rows above first — nothing was written.');
  process.exit(1);
}
if (!updates.length) {
  console.error('\nNo gender values to apply.');
  process.exit(1);
}

if (!WRITE) {
  console.log('\nValidation only. Re-run with --write to produce the SQL file.');
  process.exit(0);
}

const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
const out   = `migrations/${stamp}_gender_backfill.sql`;

const sql = `-- Gender backfill — generated ${new Date().toISOString()} from ${CSV_PATH}
-- ${updates.length} registration rows (${males} male, ${females} female).
-- Rows, not people: someone who registered more than once appears once per
-- registration, so don't read these as a headcount.
-- Values were set by hand; nothing here was inferred from names.
--
-- Safe to re-run: each statement only writes when the stored value differs.

BEGIN;

${updates.map(u =>
  // The name is only a trailing comment, but the CSV is hand-edited: a newline
  // inside a quoted field would push the rest onto its own line as live SQL.
  `UPDATE public.registrations SET gender = '${u.gender}' WHERE id = '${u.id}' AND gender IS DISTINCT FROM '${u.gender}';  -- ${u.name.replace(/[\r\n]+/g, ' ').replace(/--+/g, '-')}`
).join('\n')}

COMMIT;

-- Check afterwards:
--   SELECT gender, count(*) FROM public.registrations
--   WHERE registrant_type IS DISTINCT FROM 'international' GROUP BY gender;
`;

mkdirSync('migrations', { recursive: true });
writeFileSync(out, sql, 'utf8');
console.log(`\nwritten -> ${out}`);
