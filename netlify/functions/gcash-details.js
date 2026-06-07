// netlify/functions/gcash-details.js
// Returns GCash account details from environment variables

export const handler = async () => {
  return {
    statusCode: 200,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
    body: JSON.stringify({
      accountName:   process.env.GCASH_ACCOUNT_NAME   || "",
      accountHolder: process.env.GCASH_ACCOUNT_HOLDER || "",
      mobile:        process.env.GCASH_MOBILE         || "",
      userId:        process.env.GCASH_USER_ID         || "",
    }),
  };
};
