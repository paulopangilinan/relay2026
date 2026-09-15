// netlify/lib/admin-auth.js
//
// Every admin function used to have its own local getAdmin(event) that did
// nothing but jwt.verify() the token and return its payload directly — so
// an admin's `permissions`, `is_super_admin`, and `force_password_change`
// were whatever got baked into the JWT at LOGIN time (admin-login.js signs
// a 12h token with those fields embedded). If a super admin changed
// another admin's permissions mid-session, that admin's already-issued
// token kept the stale values for up to 12 hours, or until they manually
// logged out and back in — the change silently didn't apply.
//
// getAdmin() now only uses the token to establish identity (and that it's
// a validly-signed, non-expired token) — every other field always comes
// from a fresh row read on every single request, so a permission change
// (or flipping is_super_admin/force_password_change, or deleting the
// admin entirely) takes effect on the very next API call, not the next
// login.
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET || process.env.ADMIN_PASSWORD || "relay2026secret";

export async function getAdmin(event, supabase) {
  let claims;
  try {
    const token = (event.headers.authorization || "").replace("Bearer ", "");
    claims = jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }

  const { data: admin, error } = await supabase
    .from("admins")
    .select("email, name, permissions, is_super_admin, force_password_change")
    .eq("email", claims.email)
    .maybeSingle();
  // A DB hiccup or a deleted/renamed admin both fail closed here — better
  // to bounce a legitimate request than serve stale permissions from the
  // token payload, which is exactly the bug this replaced.
  if (error || !admin) return null;

  return admin;
}
