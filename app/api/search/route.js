export async function POST(req) {
  try {
    const { jobTitle = "", location = "", jobDescription = "" } = await req.json();

    if (!jobDescription.trim())
      return Response.json({ error: "Job description is required." }, { status: 400 });

    const key = process.env.SERPER_API_KEY;
    if (!key)
      return Response.json(
        { error: "Search provider is not configured.", code: "SERPER_API_KEY_MISSING" },
        { status: 503 }
      );

    // ── Clean job title: strip special chars that break Serper quoted queries ──
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

    // ── Single combined query to conserve API credits ────────────────────────
    // Format: site:linkedin.com/in "Job Title" "hint1" "hint2" "Location"
    const hintPart = hints.slice(0, 2).map(h => `"${h}"`).join(" ");
    const q = `site:linkedin.com/in "${cleanTitle}" ${hintPart} ${safeLoc}`
      .replace(/\s+/g, " ").trim();

    const queries = [q];

    // ── Fire single Serper request ───────────────────────────────────────────
    let sr;
    try {
      sr = await fetch("https://google.serper.dev/search", {
        method: "POST",
        headers: {
          "X-API-KEY": key,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ q, num: 20, gl: "in", hl: "en" }),
      });
    } catch (fetchErr) {
      console.error("[ProfileScout] Network error calling Serper:", fetchErr.message);
      return Response.json({ error: "Network error reaching search provider." }, { status: 502 });
    }

    if (!sr.ok) {
      let serperErrorBody = "";
      try { serperErrorBody = await sr.text(); } catch (_) {}
      console.error(`[ProfileScout] Serper ${sr.status} for query "${q}":`, serperErrorBody);

      // Friendly messages for common status codes
      const friendlyError =
        sr.status === 429 || sr.status === 402
          ? "Search quota exceeded. Please upgrade your Serper plan at serper.dev."
          : sr.status === 401 || sr.status === 403
          ? "Invalid Serper API key. Please check your SERPER_API_KEY in Vercel settings."
          : `Search provider returned ${sr.status}: ${serperErrorBody}`;

      return Response.json(
        { error: friendlyError, serper_status: sr.status, serper_error: serperErrorBody, failed_query: q },
        { status: 502 }
      );
    }

    const payload = await sr.json();

    // ── Log remaining credits ────────────────────────────────────────────────
    const remaining = sr.headers.get("x-ratelimit-remaining");
    const limit = sr.headers.get("x-ratelimit-limit");
    console.log(`[ProfileScout] Serper credits: ${remaining}/${limit} remaining`);

    // ── Parse results ────────────────────────────────────────────────────────
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

    const results = [];
    for (const r of payload.organic || []) {
      const url = normalizeLinkedIn(r.link || "");
      if (!url) continue;
      results.push({
        linkedin_url: url,
        full_name: nameFromTitle(r.title || ""),
        headline: r.title || "",
        snippet: r.snippet || "",
        source_query: q,
        match_score: score(r),
        credits_remaining: remaining ? parseInt(remaining) : null,
      });
    }

    // ── Deduplicate & rank ────────────────────────────────────────────────────
    const dedup = new Map();
    for (const p of results) {
      if (!dedup.has(p.linkedin_url) || dedup.get(p.linkedin_url).match_score < p.match_score)
        dedup.set(p.linkedin_url, p);
    }

    return Response.json({
      queries,
      credits_remaining: remaining ? parseInt(remaining) : null,
      profiles: [...dedup.values()]
        .sort((a, b) => b.match_score - a.match_score)
        .slice(0, 50),
    });

  } catch (e) {
    console.error("[ProfileScout] Unhandled error:", e);
    return Response.json({ error: e?.message || "Search failed." }, { status: 500 });
  }
}
