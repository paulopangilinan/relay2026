// netlify/lib/hotel-confirmation-email.js
// Printable lodging confirmation for international registrants (Round 97).
//
// The PDF attachment originally planned for this was parked, so the EMAIL is
// the printable artifact — a registrant is expected to hit Ctrl+P (or "Print"
// in their mail client) and hand the result to reception. That drives most of
// the styling choices below, which differ from gathering-email.js on purpose:
//
//   - No hero image. A remote banner is usually blocked by default in mail
//     clients and silently dropped by "print background graphics: off", which
//     is the default in Chrome/Safari. A printed page that leans on it would
//     come out with a blank band at the top.
//   - Header/labels use border + dark text rather than a colored gradient
//     block, for the same reason — backgrounds don't print by default, so
//     anything carrying meaning has to survive as text and rules.
//   - Layout is a <table>, not flex/grid. Mail clients and print engines both
//     handle tables predictably; neither handles modern CSS reliably.
//   - A @media print block hides the "keep this for your records" preamble
//     (screen-only chrome) and forces black-on-white.

export function escapeHtml(str) {
  return String(str || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// Fixed, published constants — the venue IS the lodging, so these are the
// conference's own dates/address rather than anything per-registrant. Same
// values already repeated across submit.js, submit-international.js,
// verify.js and admin-data.js; centralized here for this feature so the
// admin isn't retyping known facts into a modal.
export const HOTEL = {
  name: "CCT Tagaytay Retreat & Training Center",
  address: "Km 58, Tagaytay\u2013Nasugbu Highway, Tagaytay City, Cavite, Philippines",
  checkInDate: "2026-09-23",
  checkOutDate: "2026-09-26",
};

// Whole days between the two dates. Both are plain YYYY-MM-DD (no time, no
// zone), so parsing them as UTC keeps this from drifting by a day depending
// on where the function happens to run.
export function nightsBetween(checkInDate, checkOutDate) {
  const a = Date.parse(`${checkInDate}T00:00:00Z`);
  const b = Date.parse(`${checkOutDate}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / 86400000);
}

// "September 23, 2026" — spelled out rather than numeric, since 09/23/2026 vs
// 23/09/2026 is genuinely ambiguous to an international audience.
export function formatLongDate(isoDate) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return isoDate;
  return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
}

// Same spelled-out style, plus a Manila clock time — for booking_date, which
// (unlike check-in/check-out) is a real instant rather than a plain calendar
// date, so it needs a timezone to render a time at all.
export function formatLongDateTime(isoTimestamp) {
  const d = new Date(isoTimestamp);
  if (Number.isNaN(d.getTime())) return isoTimestamp;
  const date = d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "Asia/Manila" });
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Manila" });
  return `${date}, ${time}`;
}

function detailRow(label, value, opts = {}) {
  if (value === null || value === undefined || value === "") return "";
  return `
    <tr>
      <td style="padding:9px 12px;border-bottom:1px solid #D4E2EA;font-size:12px;color:#6B8A9A;text-transform:uppercase;letter-spacing:0.04em;white-space:nowrap;vertical-align:top;">${escapeHtml(label)}</td>
      <td style="padding:9px 12px;border-bottom:1px solid #D4E2EA;font-size:14px;color:#1C2B38;${opts.strong ? "font-weight:700;" : ""}">${escapeHtml(value)}</td>
    </tr>`;
}

/**
 * @param row  the hotel_confirmations record (plus `guest_name`), i.e. the
 *             values actually stored — never the raw modal input — so a
 *             reprint always matches what was sent.
 */
export function hotelConfirmationEmail(row, { imgUrl = "" } = {}) {
  const checkIn  = `${formatLongDate(row.check_in_date)} \u2014 from ${row.check_in_time}`;
  const checkOut = `${formatLongDate(row.check_out_date)} \u2014 by ${row.check_out_time}`;

  // What the registrant is shown. The hotel's own reference wins when we have
  // one — that's the number reception will recognise. Ours is still stored on
  // the row either way as the internal audit key.
  const displayNo = row.external_confirmation_no || row.confirmation_no;

  // Off by default, and only ever rendered when there's somewhere to load it
  // from. Everything below it still reads correctly with the image blocked,
  // missing, or dropped by "print background graphics: off" — the banner is
  // decoration, never the carrier of any fact.
  const banner = (row.show_banner && imgUrl)
    ? `<img src="${escapeHtml(imgUrl)}/assets/images/confirmation-header.jpg" alt="" style="display:block;width:100%;max-width:100%;height:auto;border:0;border-radius:6px;margin-bottom:18px;">`
    : "";

  const subtitle = row.show_subtitle
    ? `<div style="font-size:12px;color:#6B8A9A;margin-top:3px;">Sovereign Grace Churches</div>`
    : "";

  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>
  @media print {
    body { background:#fff !important; padding:0 !important; }
    .sheet { box-shadow:none !important; border:none !important; max-width:none !important; }
    .screen-only { display:none !important; }
    /* Keep the details block from splitting across two pages. */
    .details { page-break-inside:avoid; }
  }
</style></head>
<body style="font-family:Arial,Helvetica,sans-serif;background:#F2F5F8;margin:0;padding:24px;">
  <div class="sheet" style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #D4E2EA;border-radius:10px;padding:28px;">

    ${banner}

    <div style="border-bottom:3px solid #1C2B38;padding-bottom:12px;margin-bottom:6px;">
      <div style="font-size:20px;font-weight:700;color:#1C2B38;letter-spacing:0.02em;">RELAY Asia-Pacific Conference 2026</div>
      ${subtitle}
      <div style="font-size:13px;color:#6B8A9A;margin-top:2px;">Accommodation Confirmation</div>
    </div>

    <div style="text-align:right;font-size:12px;color:#6B8A9A;margin-bottom:20px;">
      Confirmation No. <strong style="color:#1C2B38;font-family:'Courier New',monospace;">${escapeHtml(displayNo)}</strong>
    </div>

    <p class="screen-only" style="margin:0 0 18px;font-size:14px;color:#2A3D4A;line-height:1.6;">
      Hi ${escapeHtml(row.guest_name)}, your accommodation for RELAY 2026 is confirmed.
      Please print this email or show it on your phone when you arrive.
    </p>

    <table class="details" role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;border-top:1px solid #D4E2EA;">
      ${detailRow("Guest", row.guest_name, { strong: true })}
      ${detailRow("Venue", row.hotel_name, { strong: true })}
      ${detailRow("Address", row.hotel_address)}
      ${detailRow("Booked On", row.booking_date ? formatLongDateTime(row.booking_date) : "")}
      ${detailRow("Room Type", row.room_type)}
      ${detailRow("Max Occupancy", `${row.max_occupancy} guest(s)`)}
      ${detailRow("Check-in", checkIn)}
      ${detailRow("Check-out", checkOut)}
      ${detailRow("Nights", String(row.num_nights))}
      ${detailRow("Roommates", row.roommates)}
      ${detailRow("Notes", row.notes)}
    </table>

    <p style="margin:20px 0 0;font-size:12px;color:#6B8A9A;line-height:1.6;">
      Present this confirmation at the registration desk on arrival.
      For any changes, reply to this email before ${escapeHtml(formatLongDate(row.check_in_date))}.
    </p>

    <div style="margin-top:20px;padding-top:12px;border-top:1px solid #D4E2EA;font-size:11px;color:#6B8A9A;">
      RELAY 2026 &middot; ${escapeHtml(HOTEL.name)}<br>
      Issued ${escapeHtml(formatLongDate(new Date().toISOString().slice(0, 10)))}
    </div>

  </div>
</body></html>`;
}

// Same "hotel's number wins" rule as the body — the registrant should be able
// to search their inbox for whichever reference reception quotes at them.
export function hotelConfirmationSubject(row) {
  const displayNo = row.external_confirmation_no || row.confirmation_no;
  return `Accommodation Confirmation ${displayNo} \u2014 RELAY Asia-Pacific Conference 2026`;
}
