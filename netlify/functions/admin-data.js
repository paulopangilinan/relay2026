// netlify/functions/admin-data.js
// Protected API endpoint — returns registrations JSON for the admin dashboard

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export const handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json",
  };

  // Simple token auth — admin dashboard sends password as Bearer token
  const auth = event.headers.authorization || "";
  const token = auth.replace("Bearer ", "");
  if (token !== process.env.ADMIN_PASSWORD) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: "Unauthorized" }) };
  }

  try {
    const { data, error } = await supabase
      .from("registrations")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) throw error;

    // Summary stats
    const stats = {
      total: data.length,
      confirmed: data.filter((r) => r.payment_verified).length,
      awaiting_payment: data.filter((r) => !r.payment_ready).length,
      pending_review: data.filter((r) => r.payment_ready && !r.payment_verified).length,
      students: data.filter((r) => r.student_status === "student").length,
      non_students: data.filter((r) => r.student_status === "non-student").length,
      by_church: data.reduce((acc, r) => {
        acc[r.church] = (acc[r.church] || 0) + 1;
        return acc;
      }, {}),
    };

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ registrations: data, stats }),
    };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
