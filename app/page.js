
"use client";
import {useMemo,useState} from "react";
const DEFAULT_JD=`We are hiring an Inside Sales Manager for a B2B SaaS business. The ideal candidate should have 6-10 years of experience in inside sales, lead generation, outbound prospecting, SaaS selling, CRM usage, team management, and pipeline development. Experience selling to US or global markets is preferred. The role involves managing SDRs, building outbound campaigns, improving meeting conversion, and owning sales pipeline metrics.`;
export default function Home(){
 const[step,setStep]=useState(1),[jobTitle,setJobTitle]=useState("Inside Sales Manager - B2B SaaS"),[location,setLocation]=useState("India"),[jd,setJd]=useState(DEFAULT_JD),[profiles,setProfiles]=useState([]),[selected,setSelected]=useState({}),[emails,setEmails]=useState({}),[loading,setLoading]=useState(false),[error,setError]=useState(""),[sent,setSent]=useState(false);
 const selectedProfiles=useMemo(()=>profiles.filter(p=>selected[p.linkedin_url]),[profiles,selected]);
 const readyCount=selectedProfiles.filter(p=>(emails[p.linkedin_url]||"").trim()).length;
 async function search(){setLoading(true);setError("");setSent(false);try{const res=await fetch("/api/search",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({jobTitle,location,jobDescription:jd})});const data=await res.json();if(!res.ok)throw new Error(data.error||"Search failed");setProfiles(data.profiles||[]);setSelected({});setStep(2)}catch(e){setError(e.message)}finally{setLoading(false)}}
 const emailPreview=`Hi {{first_name}},

We came across your professional profile and thought this opportunity may be relevant to your experience. If it is of interest, we would be glad to invite you to apply.

ROLE
${jobTitle}

LOCATION
${location}

JOB DESCRIPTION
${jd}

Regards,
Talent Acquisition Team`;
 return <div className="shell"><aside className="sidebar"><div className="logoBox"><img src="/aranca-logo.png" alt="Aranca"/></div><div className="nav"><button className="active">New Search</button><button>Jobs</button><button>Candidates</button><button>Outreach</button><button>Settings</button></div><div className="sideFoot">Internal recruiting tool<br/>Recruiter review required</div></aside>
 <main className="main"><div className="top"><h1>Recruiter Sourcing Workspace</h1><span className="badge">Internal Preview</span></div><div className="steps">{[1,2,3,4].map(i=><div key={i} className={`step ${step===i?"on":""}`}>{i===1?"1. Job Description":i===2?"2. Find Profiles":i===3?"3. Select & Enrich":"4. Invite"}</div>)}</div>
 {step===1&&<div className="card"><div className="grid2"><div><label>Job Title</label><input value={jobTitle} onChange={e=>setJobTitle(e.target.value)}/></div><div><label>Location / Market</label><input value={location} onChange={e=>setLocation(e.target.value)}/></div></div><div style={{marginTop:14}}><label>Job Description</label><textarea value={jd} onChange={e=>setJd(e.target.value)}/></div>{error&&<div className="error">{error}</div>}<div className="actions"><div className="muted">Live public web search → valid LinkedIn profile links</div><button className="btn primary" onClick={search} disabled={loading}>{loading?"Searching…":"Find Relevant LinkedIn Profiles"}</button></div></div>}
 {step===2&&<><div className="card"><div className="actions" style={{marginTop:0}}><div><b>{profiles.length} profiles found</b><div className="muted">Review each profile manually before continuing</div></div><button className="btn secondary" onClick={()=>setStep(1)}>Edit JD</button></div><div style={{marginTop:8}}>{profiles.length===0&&<div className="muted">No profiles returned. Try broadening the title/location.</div>}{profiles.map(p=><div className="profile" key={p.linkedin_url}><input type="checkbox" checked={!!selected[p.linkedin_url]} onChange={e=>setSelected(s=>({...s,[p.linkedin_url]:e.target.checked}))}/><div><div className="name">{p.full_name||"LinkedIn profile"}</div><div className="headline">{p.headline}</div><div className="snippet">{p.snippet}</div><a className="link" href={p.linkedin_url} target="_blank" rel="noopener noreferrer">Open LinkedIn profile ↗</a></div><div className="score">{p.match_score}%</div></div>)}</div></div><div className="actions"><div className="muted">{selectedProfiles.length} selected</div><button className="btn primary" disabled={!selectedProfiles.length} onClick={()=>setStep(3)}>Continue with Selected Profiles</button></div></>}
 {step===3&&<><div className="card"><b>Selected Candidates</b><div className="muted" style={{marginTop:5}}>Add or verify a work email before outreach.</div><div style={{marginTop:10}}>{selectedProfiles.map(p=><div className="selected" key={p.linkedin_url}><div><b>{p.full_name||"LinkedIn profile"}</b><div className="muted">{p.headline}</div></div><input placeholder="Work email" value={emails[p.linkedin_url]||""} onChange={e=>setEmails(x=>({...x,[p.linkedin_url]:e.target.value}))}/><a className="link" href={p.linkedin_url} target="_blank" rel="noopener noreferrer">LinkedIn ↗</a></div>)}</div></div><div className="actions"><button className="btn secondary" onClick={()=>setStep(2)}>Back</button><button className="btn primary" onClick={()=>setStep(4)}>Preview Invitation</button></div></>}
 {step===4&&<><div className="grid2"><div className="card"><b>Invitation Preview</b><div className="emailBox" style={{marginTop:12}}>{emailPreview}</div></div><div className="card"><b>Outreach Summary</b><div className="kpis" style={{marginTop:12,gridTemplateColumns:"1fr 1fr"}}><div className="kpi"><div className="kpiN">{selectedProfiles.length}</div><div className="kpiL">Selected</div></div><div className="kpi"><div className="kpiN">{readyCount}</div><div className="kpiL">Emails ready</div></div></div><div className="muted" style={{marginTop:14,lineHeight:1.55}}>This test build simulates sending. Real email delivery can be connected next.</div><button className="btn primary" style={{width:"100%",marginTop:16}} onClick={()=>setSent(true)}>Simulate Invitations</button>{sent&&<div className="success" style={{marginTop:12}}>{readyCount} invitation(s) queued in demo mode.</div>}<button className="btn secondary" style={{width:"100%",marginTop:10}} onClick={()=>setStep(3)}>Back</button></div></div></>}
 </main></div>
}
