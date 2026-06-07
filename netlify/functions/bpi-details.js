// netlify/functions/bpi-details.js
// Returns BPI account details from environment variables (safe — no secrets exposed)

export const handler = async () => {
  return {
    statusCode: 200,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
    body: JSON.stringify({
      name:   process.env.BPI_ACCOUNT_NAME   || "",
      number: process.env.BPI_ACCOUNT_NUMBER || "",
      type:   process.env.BPI_ACCOUNT_TYPE   || "",
    }),
  };
};
