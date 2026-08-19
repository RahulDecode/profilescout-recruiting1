export async function POST(req) {
  try {
    const { jobTitle = "", location = "", jobDescription = "" } = await req.json();

    if (!jobDescription.trim())
      return Response.json({ error: "Job description is required." }, { status: 400 });

    const key = process.env.BRAVE_API_KEY;
    if (!key)
      return Response.json(
        { error: "Search provider is not configured.", code: "BRAVE_API_KEY_MISSING" },
        { status: 503 }
      );

    // ── Clean job title: strip special chars that break search queries ────────
    const cleanTitle = jobTitle
      .split(/[-–—|]/)[0]
      .replace(/[^a-zA-Z0-9 &]/g, "")
      .trim();

    // ── Build keyword hints from JD ──────────────────────────────────────────
    const hay = `${jobTitle} ${jobDescription}`.toLowerCase();
    const HINT_POOL = [
      "inside sales", "b2b saas", "saas", "sales development", "sdr",
      "outbound", "lead generation", "business development", "pipeline",
      "crm", "us market", "global markets", "sales manager", "account executive",
      "revenue operations", "enterprise sales", "solution selling",
    ];
    const hints = HINT_POOL.filter((t) => hay.includes(t)).slice(0, 5);
    const safeLoc = location?.trim() ? `"${location.trim()}"` : "";

    // ── Build query ───────────────────────────────────────────────────────────
    const hintPart = hints.slice(0, 2).map(h => `"${h}"`).join(" ");
    const q = `site:linkedin.com/in "${cleanTitle}" ${hintPart} ${safeLoc}`
      .replace(/\s+/g, " ").trim();

    // ── Call Brave Search API ─────────────────────────────────────────────────
    let sr;
    try {
      const url = new URL("https://api.search.brave.com/res/v1/web/search");
      url.searchParams.set("q", q);
      url.searchParams.set("count", "20");
      url.searchParams.set("search_lang", "en");
      url.searchParams.set("country", "IN");
      url.searchParams.set("text_decorations", "false");

      sr = await fetch(url.toString(), {
        method: "GET",
        headers: {
          "Accept": "application/json",
          "Accept-Encoding": "gzip",
          "X-Subscription-Token": key,
        },
      });
    } catch (fetchErr) {
      console.error("[ProfileScout] Network error calling Brave:", fetchErr.message);
      return Response.json({ error: "Network error reaching search provider." }, { status: 502 });
    }

    if (!sr.ok) {
      let errorBody = "";
      try { errorBody = await sr.text(); } catch (_) {}
      console.error(`[ProfileScout] Brave ${sr.status} for query "${q}":`, errorBody);

      const friendlyError =
        sr.status === 429
          ? "Search quota exceeded. You have used your free Brave API limit for this month."
          : sr.status === 401 || sr.status === 403
          ? "Invalid Brave API key. Please check BRAVE_API_KEY in Vercel settings."
          : `Search provider returned ${sr.status}: ${errorBody}`;

      return Response.json(
        { error: friendlyError, status: sr.status, detail: errorBody, failed_query: q },
        { status: 502 }
      );
    }

    const payload = await sr.json();

    // ── Parse Brave results ───────────────────────────────────────────────────
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
      const txt = `${r.title || ""} ${r.description || ""}`.toLowerCase();
      const hits = hints.filter((t) => txt.includes(t)).length;
      return Math.min(99, 60 + hits * 7);
    };

    // Brave returns results under payload.web.results
    const organicResults = payload?.web?.results || [];
    const results = [];

    for (const r of organicResults) {
      const url = normalizeLinkedIn(r.url || "");
      if (!url) continue;
      results.push({
        linkedin_url: url,
        full_name: nameFromTitle(r.title || ""),
        headline: r.title || "",
        snippet: r.description || "",
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
      provider: "brave",
      profiles: [...dedup.values()]
        .sort((a, b) => b.match_score - a.match_score)
        .slice(0, 50),
    });

  } catch (e) {
    console.error("[ProfileScout] Unhandled error:", e);
    return Response.json({ error: e?.message || "Search failed." }, { status: 500 });
  }
}
