export async function GET() {
  const key = process.env.SERPER_API_KEY;
  
  // Test with the simplest possible query first
  const testQueries = [
    { q: "site:linkedin.com/in sales manager", num: 3 },
    { q: "linkedin sales manager India", num: 3 },
  ];
  
  const results = [];
  
  for (const body of testQueries) {
    let status, responseBody, headers;
    try {
      const res = await fetch("https://google.serper.dev/search", {
        method: "POST",
        headers: {
          "X-API-KEY": key,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      status = res.status;
      responseBody = await res.text();
      headers = Object.fromEntries(res.headers.entries());
    } catch (e) {
      status = "NETWORK_ERROR";
      responseBody = e.message;
      headers = {};
    }
    results.push({ query: body.q, status, responseBody: responseBody.substring(0, 500), headers });
  }
  
  return Response.json({ key_preview: key ? key.substring(0,8)+"..." : "MISSING", results });
}
