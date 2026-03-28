// netlify/functions/contact-info.js
export const handler = async () => ({
  statusCode: 200,
  headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  body: JSON.stringify({
    email: process.env.CONTACT_EMAIL || process.env.GMAIL_USER || '',
  }),
});
