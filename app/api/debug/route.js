// TEMPORARY DEBUG ENDPOINT — remove after confirming env vars
export async function GET() {
  const key = process.env.SERPER_API_KEY || "";
  return Response.json({
    key_present: !!key,
    key_length: key.length,
    key_preview: key ? key.substring(0, 6) + "..." : "MISSING",
    node_env: process.env.NODE_ENV,
  });
}
