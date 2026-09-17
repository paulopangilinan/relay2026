// netlify/functions/send-hotel-confirmation.js
// Round 97: sends an international registrant their printable accommodation
// confirmation, from a modal on the admin International tab.
//
// Permission: any signed-in admin, super or not (Round 97 decision) — so the
// gate here is just a valid admin plus the usual force_password_change block,
// with no capability flag. Deliberately NOT a new `permissions` key: a new key
// reads as falsy on every existing admin row, which would have meant nobody
// could send this until someone with manage_admins granted it one by one.
import { createClient } from "@supabase/supabase-js";
import { getAdmin } from "../lib/admin-auth.js";
import { sendEmail } from "../lib/mailer.js";
import {
  HOTEL,
  nightsBetween,
  hotelConfirmationEmail,
  hotelConfirmationSubject,
} from "../lib/hotel-confirmation-email.js";

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const headers = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };
const json = (statusCode, body) => ({ statusCode, headers, body: JSON.stringify(body) });

// Manila has a fixed +08:00 offset (no DST), so a "YYYY-MM-DDTHH:mm" wall-clock
// string from a <datetime-local> picker converts to an instant just by
// appending that offset — no Intl gymnastics needed going this direction.
//
// Date.parse silently rolls an invalid calendar day forward (Feb 31 becomes
// Mar 3) rather than rejecting it, so round-trip through Manila formatting
// and compare — a normal browser date picker can't produce that input, but a
// hand-crafted request could.
function isValidManilaLocalDateTime(s) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s)) return false;
  const instant = Date.parse(`${s}:00+08:00`);
  if (Number.isNaN(instant)) return false;
  const back = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(instant)).reduce((o, p) => (o[p.type] = p.value, o), {});
  return `${back.year}-${back.month}-${back.day}T${back.hour}:${back.minute}` === s;
}
function manilaLocalToInstant(s) {
  return new Date(`${s}:00+08:00`).toISOString();
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return json(200, {});
  if (event.httpMethod !== "POST") return { statusCode: 405, headers, body: "Method Not Allowed" };

  const admin = await getAdmin(event, supabase);
  if (!admin) return json(401, { error: "Unauthorized" });
  if (admin.force_password_change) return json(403, { error: "No permission" });

  try {
    const body = JSON.parse(event.body || "{}");
    const {
      registrationId, roomType, maxOccupancy, checkInTime, checkOutTime,
      roommates, notes, provider,
      externalConfirmationNo, showBanner, showSubtitle, bookingDate,
    } = body;

    if (!registrationId) return json(400, { error: "Missing registration." });

    const cleanRoomType = String(roomType || "").trim();
    if (!cleanRoomType) return json(400, { error: "Room type is required." });

    const occupancy = parseInt(maxOccupancy, 10);
    if (!Number.isFinite(occupancy) || occupancy < 1) {
      return json(400, { error: "Max occupancy must be a whole number of 1 or more." });
    }

    const { data: reg, error: regErr } = await supabase
      .from("registrations")
      .select("id, name, email, registrant_type, status, created_at")
      .eq("id", registrationId)
      .maybeSingle();
    if (regErr) throw regErr;
    if (!reg) return json(404, { error: "Registration not found." });
    // This confirmation is lodging at the venue, which is an international-
    // registrant arrangement — re-checked here rather than trusting that the
    // button only ever renders on the International tab.
    if (reg.registrant_type !== "international") {
      return json(400, { error: "Accommodation confirmations are for international registrants only." });
    }
    // The button renders at any status except cancelled; re-checked here for
    // the same reason registrant_type is — a stale table on an admin's screen
    // shouldn't be able to email a room to someone who has withdrawn.
    if (reg.status === "cancelled") {
      return json(400, { error: "This registration is cancelled." });
    }
    if (!reg.email) return json(400, { error: "This registrant has no email address on file." });

    // Dates are fixed constants, so nights is derived, never taken from the
    // client. Guard anyway so a bad constant edit fails loudly here rather
    // than silently emailing "0 nights".
    const numNights = nightsBetween(HOTEL.checkInDate, HOTEL.checkOutDate);
    if (numNights < 1) return json(500, { error: "Check-out must be after check-in." });

    // The hotel's own reference, when the admin has one. Optional — we always
    // generate ours below regardless, so this only changes what's displayed.
    const cleanExternalNo = String(externalConfirmationNo || "").trim().slice(0, 64) || null;

    // Defaults to the exact moment the registrant registered — created_at is
    // already an instant (a UTC timestamp), so unlike the date-only version
    // of this field there's no timezone math needed for the default, only for
    // validating and converting whatever the admin's picker sends back.
    const rawBookingDateTime = String(bookingDate || "").trim();
    if (rawBookingDateTime && !isValidManilaLocalDateTime(rawBookingDateTime)) {
      return json(400, { error: "Booking date & time must be a valid date and time." });
    }
    const cleanBookingDate = rawBookingDateTime ? manilaLocalToInstant(rawBookingDateTime) : reg.created_at;

    // Sequence-backed via a public wrapper (see the migration) so two
    // concurrent sends can't produce the same number.
    const { data: confirmationNo, error: seqErr } = await supabase.rpc("next_hotel_confirmation_no");
    if (seqErr) throw seqErr;

    const record = {
      registration_id: reg.id,
      hotel_name: HOTEL.name,
      hotel_address: HOTEL.address,
      room_type: cleanRoomType,
      max_occupancy: occupancy,
      check_in_date: HOTEL.checkInDate,
      check_out_date: HOTEL.checkOutDate,
      check_in_time: String(checkInTime || "").trim() || "2:00 PM",
      check_out_time: String(checkOutTime || "").trim() || "11:00 AM",
      num_nights: numNights,
      confirmation_no: confirmationNo,
      external_confirmation_no: cleanExternalNo,
      booking_date: cleanBookingDate,
      // Coerced rather than passed through: these are NOT NULL booleans, and
      // an absent field from an older client must land as false, not null.
      show_banner: showBanner === true,
      show_subtitle: showSubtitle === true,
      roommates: String(roommates || "").trim() || null,
      notes: String(notes || "").trim() || null,
      sent_by: admin.email || admin.name || "admin",
    };

    // Insert BEFORE sending: if the send throws (or the whole function times
    // out mid-send), there's still a row showing it was attempted, by whom,
    // and with what values. A confirmation that may or may not have gone out
    // is far easier to deal with than no trace at all.
    const { data: inserted, error: insErr } = await supabase
      .from("hotel_confirmations")
      .insert({ ...record, email_status: "sent", email_provider: provider || null })
      .select()
      .single();
    if (insErr) throw insErr;

    // Same source the other templates use for remote images — IMAGE_SITE_URL
    // when set, otherwise the site itself.
    const imgUrl = (process.env.IMAGE_SITE_URL || process.env.SITE_URL || "").replace(/\/+$/, "");
    const html = hotelConfirmationEmail({ ...record, guest_name: reg.name }, { imgUrl });
    try {
      await sendEmail({
        to: reg.email,
        subject: hotelConfirmationSubject(record),
        html,
        provider,
      });
    } catch (err) {
      await supabase
        .from("hotel_confirmations")
        .update({ email_status: "failed" })
        .eq("id", inserted.id);
      console.error("Hotel confirmation email failed:", err.message);
      return json(502, { error: `Saved, but the email failed to send: ${err.message}` });
    }

    return json(200, { success: true, confirmationNo, sentTo: reg.email });
  } catch (err) {
    console.error("send-hotel-confirmation error:", err);
    return json(500, { error: err.message || "Failed to send confirmation." });
  }
};
