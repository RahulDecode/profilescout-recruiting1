export async function GET() {
  const exaKey  = process.env.EXA_API_KEY  || "";
  const bingKey = process.env.BING_API_KEY || "";
  const serperKey = process.env.SERPER_API_KEY || "";

  return Response.json({
    exa_key_present:    !!exaKey,
    exa_key_length:     exaKey.length,
    exa_key_preview:    exaKey   ? exaKey.substring(0, 8)   + "..." : "MISSING",
    bing_key_present:   !!bingKey,
    bing_key_preview:   bingKey  ? bingKey.substring(0, 8)  + "..." : "MISSING",
    serper_key_present: !!serperKey,
    node_env: process.env.NODE_ENV,
  });
}
