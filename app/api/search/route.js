export async function POST(req) {
  try {
    const { jobTitle = "", location = "", jobDescription = "" } = await req.json();

    if (!jobDescription.trim())
      return Response.json({ error: "Job description is required." }, { status: 400 });

    const exaKey  = process.env.EXA_API_KEY;
    const bingKey = process.env.BING_API_KEY;

    if (!exaKey && !bingKey)
      return Response.json(
        { error: "No search provider configured. Add EXA_API_KEY or BING_API_KEY in Vercel settings." },
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
    const loc   = location?.trim() || "";

    // ── Helpers ───────────────────────────────────────────────────────────────
    const normalizeLinkedIn = (url) => {
      try {
        const u = new URL(url);
        if (!u.hostname.endsWith("linkedin.com") || !u.pathname.startsWith("/in/")) return null;
        u.search = ""; u.hash = "";
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

    // ════════════════════════════════════════════════════════════════════════
    // PROVIDER 1 — Exa (neural people/profile search)
    // ════════════════════════════════════════════════════════════════════════
    async function searchExa() {
      const query = [
        `LinkedIn profile of ${cleanTitle}`,
        loc ? `in ${loc}` : "",
        hints.length ? `with experience in ${hints.slice(0, 3).join(", ")}` : "",
      ].filter(Boolean).join(" ");

      const res = await fetch("https://api.exa.ai/search", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": exaKey,
        },
        body: JSON.stringify({
          query,
          num_results: 20,
          include_domains: ["linkedin.com"],
          type: "neural",
          use_autoprompt: true,
        }),
      });

      if (!res.ok) {
        const err = await res.text();
        throw new Error(`Exa ${res.status}: ${err}`);
      }

      const data = await res.json();
      const results = [];
      for (const r of data?.results || []) {
        const url = normalizeLinkedIn(r.url || "");
        if (!url) continue;
        results.push({
          linkedin_url: url,
          full_name: nameFromTitle(r.title || ""),
          headline: r.title || "",
          snippet: r.summary || r.text?.substring(0, 200) || "",
          source_query: query,
          match_score: score({ title: r.title, snippet: r.summary || "" }),
          provider: "exa",
        });
      }
      return results;
    }

    // ════════════════════════════════════════════════════════════════════════
    // PROVIDER 2 — Bing Web Search (fallback)
    // ════════════════════════════════════════════════════════════════════════
    async function searchBing() {
      const hintPart = hints.slice(0, 2).map(h => `"${h}"`).join(" ");
      const safeLoc  = loc ? `"${loc}"` : "";
      const q = `site:linkedin.com/in "${cleanTitle}" ${hintPart} ${safeLoc}`
        .replace(/\s+/g, " ").trim();

      const url = new URL("https://api.bing.microsoft.com/v7.0/search");
      url.searchParams.set("q", q);
      url.searchParams.set("count", "20");
      url.searchParams.set("mkt", "en-IN");
      url.searchParams.set("responseFilter", "Webpages");

      const res = await fetch(url.toString(), {
        headers: { "Ocp-Apim-Subscription-Key": bingKey },
      });

      if (!res.ok) {
        const err = await res.text();
        throw new Error(`Bing ${res.status}: ${err}`);
      }

      const data = await res.json();
      const results = [];
      for (const r of data?.webPages?.value || []) {
        const url = normalizeLinkedIn(r.url || "");
        if (!url) continue;
        results.push({
          linkedin_url: url,
          full_name: nameFromTitle(r.name || ""),
          headline: r.name || "",
          snippet: r.snippet || "",
          source_query: q,
          match_score: score({ title: r.name, snippet: r.snippet }),
          provider: "bing",
        });
      }
      return results;
    }

    // ════════════════════════════════════════════════════════════════════════
    // ORCHESTRATE — Exa first, Bing fallback
    // ════════════════════════════════════════════════════════════════════════
    let rawResults = [];
    let usedProvider = "";
    let providerError = "";

    if (exaKey) {
      try {
        rawResults = await searchExa();
        usedProvider = "exa";
        console.log(`[ProfileScout] Exa returned ${rawResults.length} results`);
      } catch (e) {
        providerError = e.message;
        console.warn("[ProfileScout] Exa failed, falling back to Bing:", e.message);
      }
    }

    if (rawResults.length === 0 && bingKey) {
      try {
        rawResults = await searchBing();
        usedProvider = "bing";
        console.log(`[ProfileScout] Bing returned ${rawResults.length} results`);
      } catch (e) {
        providerError += " | Bing: " + e.message;
        console.error("[ProfileScout] Bing also failed:", e.message);
      }
    }

    if (rawResults.length === 0 && providerError) {
      return Response.json(
        { error: `All search providers failed: ${providerError}` },
        { status: 502 }
      );
    }

    // ── Deduplicate & rank ────────────────────────────────────────────────────
    const dedup = new Map();
    for (const p of rawResults) {
      if (!dedup.has(p.linkedin_url) || dedup.get(p.linkedin_url).match_score < p.match_score)
        dedup.set(p.linkedin_url, p);
    }

    return Response.json({
      provider: usedProvider,
      profiles: [...dedup.values()]
        .sort((a, b) => b.match_score - a.match_score)
        .slice(0, 50),
    });

  } catch (e) {
    console.error("[ProfileScout] Unhandled error:", e);
    return Response.json({ error: e?.message || "Search failed." }, { status: 500 });
  }
}
