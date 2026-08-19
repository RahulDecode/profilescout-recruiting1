
export async function POST(req){
  try{
    const {jobTitle="",location="",jobDescription=""}=await req.json();
    if(!jobDescription.trim()) return Response.json({error:"Job description is required."},{status:400});
    const key=process.env.SERPER_API_KEY;
    if(!key) return Response.json({error:"Search provider is not configured.",code:"SERPER_API_KEY_MISSING"},{status:503});
    const hay=`${jobTitle} ${jobDescription}`.toLowerCase();
    const hints=["inside sales","b2b saas","saas","sales development","sdr","outbound","lead generation","business development","pipeline","crm","us market","global markets","sales manager","account executive"].filter(t=>hay.includes(t)).slice(0,6);
    const loc=location?.trim()?`"${location.trim()}"`:"";
    const queries=[...new Set([`site:linkedin.com/in "${jobTitle}" ${loc}`,`site:linkedin.com/in "${hints.slice(0,3).join('" "')}" ${loc}`,`site:linkedin.com/in "${hints.slice(2,5).join('" "')}" ${loc}`].map(x=>x.replace(/\s+/g," ").trim()))];
    const results=[];
    const normalizeLinkedIn=(url)=>{try{const u=new URL(url);if(!u.hostname.endsWith("linkedin.com")||!u.pathname.startsWith("/in/"))return null;u.search="";u.hash="";return u.toString().replace(/\/$/,"")}catch{return null}};
    const nameFromTitle=(t="")=>t.split(" - ")[0].split(" | ")[0].replace(/\s+\|\s+LinkedIn.*$/i,"").trim();
    const score=(r)=>{const txt=`${r.title||""} ${r.snippet||""}`.toLowerCase();const hits=hints.filter(t=>txt.includes(t)).length;return Math.min(99,60+hits*7)};
    for(const q of queries){
      const sr=await fetch("https://google.serper.dev/search",{method:"POST",headers:{"X-API-KEY":key,"Content-Type":"application/json"},body:JSON.stringify({q,num:20})});
      if(!sr.ok) throw new Error(`Search provider returned ${sr.status}`);
      const payload=await sr.json();
      for(const r of payload.organic||[]){const url=normalizeLinkedIn(r.link||"");if(!url)continue;results.push({linkedin_url:url,full_name:nameFromTitle(r.title||""),headline:r.title||"",snippet:r.snippet||"",source_query:q,match_score:score(r)})}
    }
    const dedup=new Map();for(const p of results){if(!dedup.has(p.linkedin_url)||dedup.get(p.linkedin_url).match_score<p.match_score)dedup.set(p.linkedin_url,p)}
    return Response.json({queries,profiles:[...dedup.values()].sort((a,b)=>b.match_score-a.match_score).slice(0,50)});
  }catch(e){return Response.json({error:e?.message||"Search failed."},{status:500})}
}
