export async function POST(req) {
  try {
    const { jobTitle = "", location = "", jobDescription = "" } = await req.json();

    if (!jobDescription.trim())
      return Response.json({ error: "Job description is required." }, { status: 400 });

    const key = process.env.GOOGLE_CSE_KEY;
    const cx  = process.env.GOOGLE_CSE_CX;

    if (!key || !cx)
      return Response.json(
        { error: "Search provider is not configured.", code: "GOOGLE_CSE_MISSING" },
        { status: 503 }
      );

    // ── Clean job title ───────────────────────────────────────────────────────
    const cleanTitle = jobTitle
      .split(/[-–—|]/)[0]
      .replace(/[^a-zA-Z0-9 &]/g, "")
      .trim();

    // ── Build keyword hints from JD ───────────────────────────────────────────
    const hay = `${jobTitle} ${jobDescription}`.toLowerCase();
    const HINT_POOL = [
      "inside sales", "b2b saas", "saas", "sales development", "sdr",
      "outbound", "lead generation", "business development", "pipeline",
      "crm", "us market", "global markets", "sales manager", "account executive",
      "revenue operations", "enterprise sales", "solution selling",
    ];
    const hints = HINT_POOL.filter((t) => hay.includes(t)).slice(0, 5);
    const safeLoc = location?.trim() ? `"${location.trim()}"` : "";
    const hintPart = hints.slice(0, 2).map(h => `"${h}"`).join(" ");

    // ── Single query — Google CSE searches linkedin.com/in/* by default ──────
    const q = `"${cleanTitle}" ${hintPart} ${safeLoc}`
      .replace(/\s+/g, " ").trim();

    // ── Call Google Custom Search API ─────────────────────────────────────────
    let sr;
    try {
      const url = new URL("https://www.googleapis.com/customsearch/v1");
      url.searchParams.set("key", key);
      url.searchParams.set("cx", cx);
      url.searchParams.set("q", q);
      url.searchParams.set("num", "10"); // max 10 per request on free tier
      url.searchParams.set("gl", "in");
      url.searchParams.set("hl", "en");

      sr = await fetch(url.toString());
    } catch (fetchErr) {
      console.error("[ProfileScout] Network error calling Google CSE:", fetchErr.message);
      return Response.json({ error: "Network error reaching search provider." }, { status: 502 });
    }

    if (!sr.ok) {
      let errorBody = "";
      try { errorBody = await sr.text(); } catch (_) {}
      console.error(`[ProfileScout] Google CSE ${sr.status} for query "${q}":`, errorBody);

      const friendlyError =
        sr.status === 429
          ? "Daily search quota exceeded (100 searches/day on free tier). Try again tomorrow."
          : sr.status === 400
          ? "Invalid search configuration. Please check GOOGLE_CSE_KEY and GOOGLE_CSE_CX in Vercel settings."
          : sr.status === 403
          ? "Google API key invalid or Custom Search API not enabled. Check console.cloud.google.com."
          : `Search provider returned ${sr.status}: ${errorBody}`;

      return Response.json(
        { error: friendlyError, status: sr.status, detail: errorBody, failed_query: q },
        { status: 502 }
      );
    }

    const payload = await sr.json();

    // ── Parse Google CSE results ──────────────────────────────────────────────
    const normalizeLinkedIn = (url) => {
      try {
        const u = new URL(url);
        if (!u.hostname.endsWith("linkedin.com") || !u.pathname.startsWith("/in/")) return null;
        u.search = "";
        u.hash = "";
        return u.toString().replace(/\/$/, "");
      } catch { return null; }
    };

    const nameFromTitle = (t = "") =>
      t.split(" - ")[0].split(" | ")[0].replace(/\s+\|\s+LinkedIn.*$/i, "").trim();

    const score = (r) => {
      const txt = `${r.title || ""} ${r.snippet || ""}`.toLowerCase();
      const hits = hints.filter((t) => txt.includes(t)).length;
      return Math.min(99, 60 + hits * 7);
    };

    const items = payload?.items || [];
    const results = [];

    for (const r of items) {
      const url = normalizeLinkedIn(r.link || "");
      if (!url) continue;
      results.push({
        linkedin_url: url,
        full_name: nameFromTitle(r.title || ""),
        headline: r.title || "",
        snippet: r.snippet || "",
        source_query: q,
        match_score: score(r),
      });
    }

    // ── Deduplicate & rank ────────────────────────────────────────────────────
    const dedup = new Map();
    for (const p of results) {
      if (!dedup.has(p.linkedin_url) || dedup.get(p.linkedin_url).match_score < p.match_score)
        dedup.set(p.linkedin_url, p);
    }

    return Response.json({
      queries: [q],
      provider: "google-cse",
      total_results: payload?.searchInformation?.totalResults || "0",
      profiles: [...dedup.values()]
        .sort((a, b) => b.match_score - a.match_score)
        .slice(0, 50),
    });

  } catch (e) {
    console.error("[ProfileScout] Unhandled error:", e);
    return Response.json({ error: e?.message || "Search failed." }, { status: 500 });
  }
}
