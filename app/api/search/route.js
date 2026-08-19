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
      .split(/[-–—|]/)[0]           // take only part before hyphen/dash/pipe
      .replace(/[^a-zA-Z0-9 &]/g, "") // strip remaining special chars
      .trim();

    // ── Build keyword hints from JD ──────────────────────────────────────────
    const hay = `${jobTitle} ${jobDescription}`.toLowerCase();
    const HINT_POOL = [
      "inside sales", "b2b saas", "saas", "sales development", "sdr",
      "outbound", "lead generation", "business development", "pipeline",
      "crm", "us market", "global markets", "sales manager", "account executive",
      "revenue operations", "enterprise sales", "solution selling",
    ];
    const hints = HINT_POOL.filter((t) => hay.includes(t)).slice(0, 8);

    // ── Build queries — always safe, non-empty q strings ────────────────────
    const safeLoc = location?.trim() ? `"${location.trim()}"` : "";

    const rawQueries = [
      // Q1: clean title + location (no nested special chars)
      cleanTitle
        ? `site:linkedin.com/in "${cleanTitle}" ${safeLoc}`
        : null,
      // Q2: first 3 hints
      hints.length > 0
        ? `site:linkedin.com/in ${hints.slice(0, 3).map((h) => `"${h}"`).join(" ")} ${safeLoc}`
        : null,
      // Q3: next 3 hints (only if enough hints exist)
      hints.length > 3
        ? `site:linkedin.com/in ${hints.slice(2, 5).map((h) => `"${h}"`).join(" ")} ${safeLoc}`
        : null,
    ]
      .filter(Boolean)
      .map((q) => q.replace(/\s+/g, " ").trim())
      .filter((q) => q.length > 20);

    const queries = [...new Set(rawQueries)];

    if (queries.length === 0) {
      return Response.json(
        { error: "Could not build a valid search query. Please add more detail to the job description." },
        { status: 400 }
      );
    }

    // ── Helpers ───────────────────────────────────────────────────────────────
    const normalizeLinkedIn = (url) => {
      try {
        const u = new URL(url);
        if (!u.hostname.endsWith("linkedin.com") || !u.pathname.startsWith("/in/")) return null;
        u.search = "";
        u.hash = "";
        return u.toString().replace(/\/$/, "");
      } catch {
        return null;
      }
    };

    const nameFromTitle = (t = "") =>
      t.split(" - ")[0].split(" | ")[0].replace(/\s+\|\s+LinkedIn.*$/i, "").trim();

    const score = (r) => {
      const txt = `${r.title || ""} ${r.snippet || ""}`.toLowerCase();
      const hits = hints.filter((t) => txt.includes(t)).length;
      return Math.min(99, 60 + hits * 7);
    };

    // ── Fire Serper requests ──────────────────────────────────────────────────
    const results = [];

    for (const q of queries) {
      let sr;
      try {
        sr = await fetch("https://google.serper.dev/search", {
          method: "POST",
          headers: {
            "X-API-KEY": key,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ q, num: 20, gl: "us", hl: "en" }),
        });
      } catch (fetchErr) {
        console.error("[ProfileScout] Network error calling Serper:", fetchErr.message);
        continue;
      }

      if (!sr.ok) {
        let serperErrorBody = "";
        try { serperErrorBody = await sr.text(); } catch (_) {}
        console.error(`[ProfileScout] Serper ${sr.status} for query "${q}":`, serperErrorBody);
        return Response.json(
          {
            error: `Search provider returned ${sr.status}`,
            serper_status: sr.status,
            serper_error: serperErrorBody,
            failed_query: q,
          },
          { status: 502 }
        );
      }

      const payload = await sr.json();
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
        });
      }
    }

    // ── Deduplicate & rank ────────────────────────────────────────────────────
    const dedup = new Map();
    for (const p of results) {
      if (!dedup.has(p.linkedin_url) || dedup.get(p.linkedin_url).match_score < p.match_score)
        dedup.set(p.linkedin_url, p);
    }

    return Response.json({
      queries,
      profiles: [...dedup.values()]
        .sort((a, b) => b.match_score - a.match_score)
        .slice(0, 50),
    });
  } catch (e) {
    console.error("[ProfileScout] Unhandled error:", e);
    return Response.json({ error: e?.message || "Search failed." }, { status: 500 });
  }
}
