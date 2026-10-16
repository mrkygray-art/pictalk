// Daily Log Examples (Ky's docs/daily-log-examples-spec.md; build notes docs/daily-log-examples.md): 3 sample Daily Logs
// per sandbox project, each written as a real foreman from that project's directory, plus a read-aloud script for
// testing SiteSnap's Daily log by voice. Content and foreman detection: api/_dailyLogExamples.js. Procore paths and
// fields: api/_dailyLog.js (the same requests the app sends).
// GET  /api/procore/daily-log-examples : the page (sign in with Procore first). Sandbox only, not linked, noindex.
// POST { action: "crew", companyId, projectId, name } : one project: can this person use its Daily Log (a light read
//      of today's manpower: 403 = no access, 404 = tool off), the project's date and last 5 working days, a stage
//      guess, foreman candidates and the whole directory, the delay types. Nothing changes.
// POST { action: "generate", foremen, dates, stage, count, avoid, delayTypes } : sample previews. No Procore calls.
// POST { action: "send", companyId, projectId, projectName, sample } : one sample's entries (Manpower, Notes, and
//      Delivery / Delay when it has them), one at a time. Each made entry goes in the ledger
//      procoreProjects/{companyId}_{projectId}/dailyLogSamples/{sampleId}_{section} first thing, so a resend skips it.
// POST { action: "ledger" } : what this page made, per project.
// POST { action: "delete", companyId, projectId } : deletes only that project's ledger entries in Procore (a 404 =
//      already gone), then their ledger rows.
// POST { action: "checkentries", companyId, projectId, dryRun } : the entries the Daily Log check page
//      (api/procore/test-dailylog.js) left behind in the last 5 working days: text starting "SiteSnap test". Lists
//      them (dryRun), else deletes them. Nothing else is touched.
// POST { action: "addforemen", companyId, projectId } : adds the two extra foremen (api/_seedDirectory.js
//      EXTRA_FOREMEN, in existing test companies) to the project with the test-people page's own steps: their
//      company onto the project, the person created or updated, added, permission template. Safe to run again.
// Entries are created as the signed-in person (Procore has no "on behalf of"): the foreman is named in the Notes
// ("Reported by: …") and their company is the manpower / delay company. Every Notes entry ends with the marker.
// Paced (about 2 calls a second); a 429 waits out Procore's window and tries once more. Same-origin JSON for POSTs.
import { config, HttpError, procoreId, readBody, requireSameOriginJson, sendError, sendJson } from "../_procore.js";
import { firestore } from "../_firestore.js";
import { addCompany, addPerson, api, pages } from "../_seedSteps.js";
import { EXTRA_FOREMEN, permissionTemplateFor, SEED } from "../_seedDirectory.js";
import { cleanEntry, delayTypeName, delayTypePaths, procoreFields, procoreMessage, projectDay, requestFor, SECTIONS } from "../_dailyLog.js";
import { findForemen, guessStage, makeSamples, MARKER, STAGES, TRADES, workingDays } from "../_dailyLogExamples.js";

export { pace } from "../_seedSteps.js";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const SAMPLE_ID = /^[A-Za-z0-9]{6,32}$/;
const PARTS = [["manpower", "manpower"], ["notes", "notes"], ["delivery", "deliveries"], ["delay", "delays"]];
const LEDGER = "dailyLogSamples";
const text = (v, max = 200) => String(v ?? "").slice(0, max);

const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>SiteSnap AI · Daily Log Examples</title>
<style>body{font-family:-apple-system,Segoe UI,Arial,sans-serif;background:#000;color:#f5efe6;max-width:820px;margin:0 auto;padding:24px 16px}
button{font:inherit;font-size:19px;font-weight:700;padding:14px 20px;border:0;border-radius:14px;background:#ffb81c;color:#1f1a14;width:100%;margin:8px 0}
button:disabled{opacity:.5}button.small{font-size:15px;padding:8px 12px;width:auto;margin:4px 6px 4px 0;border-radius:10px}button.ghost{background:#3a332b;color:#f5efe6}button.danger{background:#5a1f1c;color:#ffd9d6}
select,input,textarea{font:inherit;font-size:16px;max-width:100%;padding:8px 10px;border-radius:10px;background:#221d18;color:#f5efe6;border:1px solid #3a332b;box-sizing:border-box}textarea{width:100%;min-height:90px}
.proj{background:#16130f;border:1px solid #3a332b;border-radius:14px;padding:12px 14px;margin:14px 0}.row{display:flex;gap:10px;align-items:flex-start}.row input[type=checkbox]{width:22px;height:22px;margin-top:2px;flex:none}
.card{background:#221d18;border-radius:12px;padding:10px 14px;margin:10px 0}.card p{margin:6px 0}.script{border-left:3px solid #ffb81c;padding:6px 10px;margin:8px 0;background:#2b241d}
.chip{display:inline-flex;gap:6px;align-items:center;background:#2b241d;border-radius:10px;padding:6px 8px;margin:4px 6px 4px 0}.chip select{font-size:14px;padding:4px}.chip button{font-size:14px;padding:2px 8px;width:auto;margin:0;background:#3a332b;color:#f5efe6}
.ok{color:#30d158}.bad{color:#ff5f57}.warn{color:#ffc24d}.tag{font-size:13px;color:#ffc24d}a{color:#ffc24d}small{color:#b8ac9c}h2{margin-top:28px}
table{border-collapse:collapse;width:100%;font-size:14px;margin:8px 0}td,th{border-bottom:1px solid #3a332b;padding:6px 4px;text-align:left;vertical-align:top}
.bar{position:sticky;top:0;background:#000;padding:6px 0;z-index:2}.grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}.grid label{display:flex;flex-direction:column;gap:2px;font-size:14px}</style></head>
<body><h1>Daily Log Examples</h1>
<p>Makes <b>3 sample Daily Logs per project</b>, each written as a real foreman from that project's directory, with a <b>"say it like a foreman"</b> script you can read into SiteSnap's Daily log. Nothing goes to Procore until you press Send and confirm.</p>
<p><small>Procore creates the entries <b>as you</b> (the signed-in person), not as the foreman. So each Notes entry starts with "Reported by: name, title, company", and the foreman's company is set on the Manpower and Delay entries. Every Notes entry ends with <b>${MARKER}</b>. Everything this page creates is listed in its ledger, and <b>Delete Samples I Created</b> removes only those.</small></p>
<p id="who"><small>Checking your Procore sign-in…</small></p>
<button id="load" disabled>Load Projects</button>
<div class="bar"><div id="tools" hidden>
<button id="find" class="small">Find Foremen</button><button id="gen" class="small">Generate Previews</button><button id="sendall" class="small">Send All</button><button id="delall" class="small danger">Delete Samples I Created</button>
<button id="all" class="small ghost">Tick all</button><button id="none" class="small ghost">Untick all</button></div>
<div id="status"><small></small></div></div>
<div id="list"></div>
<script>
const $=(s)=>document.querySelector(s);
const esc=(s)=>String(s??'').replace(/[&<>"]/g,(c)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const STAGES=${JSON.stringify(STAGES)};
const EXTRA=${JSON.stringify(EXTRA_FOREMEN.map((f) => `${f.user.first_name} ${f.user.last_name} (${f.user.job_title}, ${SEED[f.company].vendor.name})`))};
const TRADES=${JSON.stringify(Object.fromEntries(Object.entries(TRADES).map(([k, t]) => [k, t.label])))};
let P=[]; let ledger={}; let editing=null;
const post=async(body)=>{ const r=await fetch('/api/procore/daily-log-examples',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}); const b=await r.json().catch(()=>({message:'No answer from the server'})); if(r.status===401) signedOut(); if(!r.ok) throw new Error(b.message||('Failed ('+r.status+')')); return b; };
// Procore sign-ins run out: say so where it shows, with the link back
function signedOut(){ const m='Your Procore sign-in ran out. <a href="/api/procore/login">Sign in with Procore</a>, come back to this page, and press Load Projects.'; $('#who').innerHTML='<span class="bad">'+m+'</span>'; status('<span class="bad">'+m+'</span>'); }
const status=(s)=>{ $('#status').innerHTML='<small>'+s+'</small>'; };
const day=(d)=>new Date(d+'T12:00:00Z').toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric',timeZone:'UTC'});
const keyOf=(p)=>p.companyId+'_'+p.projectId;
const entriesOf=(s)=>2+(s.delivery?1:0)+(s.delay?1:0);

fetch('/api/procore/projects').then(async(r)=>{
  if(r.status===401){ $('#who').innerHTML='Not signed in. <a href="/api/procore/login">Sign in with Procore</a>, then come back to this page.'; return; }
  $('#who').innerHTML='<small>Signed in.</small>'; $('#load').disabled=false;
});

$('#load').onclick=async()=>{
  $('#load').disabled=true; status('Loading projects…');
  try{
    const r=await fetch('/api/procore/projects'); const b=await r.json().catch(()=>({}));
    if(r.status===401){ signedOut(); $('#load').disabled=false; return; }
    if(!r.ok) throw new Error((b.message||'Procore did not answer')+' ('+r.status+'). Wait a minute and press Load Projects again.');
    P=(b.projects||[]).map(p=>({...p,on:true,crew:null,stage:null,picked:[],samples:[],results:[]}));
    await refreshLedger(); $('#tools').hidden=false; render();
    status(P.length?P.length+' project(s). Next: Find Foremen.':'<span class="warn">Procore listed no projects for you. Sign in again or check your Procore access, then press Load Projects.</span>');
  }catch(e){ status('<span class="bad">'+esc(e.message)+'</span>'); }
  $('#load').disabled=false;
};
async function refreshLedger(){ try{ ledger=(await post({action:'ledger'})).byKey||{}; }catch(e){ status('<span class="bad">Ledger: '+esc(e.message)+'</span>'); } }

function chip(p,f,i){
  const trades=Object.entries(TRADES).map(([k,l])=>'<option value="'+k+'"'+(k===f.trade?' selected':'')+'>'+esc(l)+'</option>').join('');
  return '<span class="chip" title="'+esc(f.why||'')+'"><span><b>'+esc(f.name)+'</b> <small>'+esc([f.title,f.company].filter(Boolean).join(' · '))+'</small>'+(f.match==='guess'?' <span class="tag">guess</span>':f.match==='manual'?' <span class="tag">picked by hand</span>':'')+'</span>'
    +'<select data-act="trade" data-k="'+P.indexOf(p)+'" data-i="'+i+'">'+trades+'</select><button data-act="unpick" data-k="'+P.indexOf(p)+'" data-i="'+i+'" title="Remove">×</button></span>';
}
function card(p,s,j){
  const k=P.indexOf(p); const ed=editing===s.id;
  const head='<p><b>'+day(s.date)+'</b> · '+esc(s.foreman.name)+' <small>'+esc([s.foreman.title,s.foreman.company,s.tradeLabel].filter(Boolean).join(' · '))+'</small>'+(s.sent?' <span class="ok">✓ sent</span>':'')+'</p>';
  if(ed){
    const f=(path,label,v,type)=>'<label>'+label+'<input data-f="'+path+'" value="'+esc(v??'')+'"'+(type?' type="'+type+'"':'')+'></label>';
    return '<div class="card">'+head+'<div class="grid">'+f('manpower.workers','Workers',s.manpower.workers,'number')+f('manpower.hours','Hours',s.manpower.hours,'number')+'</div>'
      +'<div class="grid">'+f('manpower.comment','Manpower work',s.manpower.comment)+'</div>'
      +'<p><small>Notes</small><textarea data-f="notes.text">'+esc(s.notes.text)+'</textarea></p>'
      +(s.delivery?'<p><small>Delivery</small></p><div class="grid">'+f('delivery.what','What',s.delivery.what)+f('delivery.from','From',s.delivery.from)+f('delivery.time','Time (HH:MM)',s.delivery.time)+f('delivery.comment','Condition, signed',s.delivery.comment)+'</div><label class="row"><input type="checkbox" data-f="delivery.drop"> Leave the delivery out</label>':'')
      +(s.delay?'<p><small>Delay</small></p><div class="grid">'+f('delay.type','Type',s.delay.type)+f('delay.start','Start (HH:MM)',s.delay.start)+f('delay.end','End (HH:MM)',s.delay.end)+f('delay.comment','Cause and what it held up',s.delay.comment)+'</div><label class="row"><input type="checkbox" data-f="delay.drop"> Leave the delay out</label>':'')
      +'<p><small>Say it like a foreman</small><textarea data-f="script">'+esc(s.script)+'</textarea></p>'
      +'<button class="small" data-act="save" data-k="'+k+'" data-s="'+j+'">Save</button><button class="small ghost" data-act="cancel">Cancel</button></div>';
  }
  return '<div class="card">'+head
    +'<p><b>Manpower</b> · '+esc(s.manpower.workers)+' workers · '+esc(s.manpower.hours)+' h · '+esc(s.manpower.trade)+' · '+esc(s.manpower.comment)+'</p>'
    +'<p><b>Notes</b> · '+esc(s.notes.text)+'</p>'
    +(s.delivery?'<p><b>Delivery</b> · '+esc(s.delivery.time)+' · from '+esc(s.delivery.from)+' · '+esc(s.delivery.what)+' · '+esc(s.delivery.comment)+'</p>':'')
    +(s.delay?'<p><b>Delay</b> · '+esc(s.delay.type||'no type')+' · '+esc(s.delay.start)+' to '+esc(s.delay.end)+' · '+esc(s.delay.comment)+'</p>':'')
    +'<div class="script"><small>Say it like a foreman</small><br>'+esc(s.script)+'</div>'
    +'<button class="small ghost" data-act="regen1" data-k="'+k+'" data-s="'+j+'">Regenerate</button><button class="small ghost" data-act="edit" data-k="'+k+'" data-s="'+j+'">Edit</button><button class="small ghost" data-act="remove" data-k="'+k+'" data-s="'+j+'">Remove</button></div>';
}
function results(p){
  if(!p.results.length) return '';
  return '<table><tr><th>Sample</th><th>Log type</th><th>Status</th><th>Procore ID</th><th>Error</th></tr>'+p.results.map(r=>'<tr><td>'+esc(r.n)+'</td><td>'+esc(r.label)+'</td><td class="'+(r.status==='failed'?'bad':r.status==='created'||r.status==='deleted'?'ok':'warn')+'">'+esc(r.status)+'</td><td>'+esc(r.procoreId??'')+'</td><td>'+esc(r.error??'')+'</td></tr>').join('')+'</table>';
}
function render(){
  $('#list').innerHTML=P.map((p,k)=>{
    const c=p.crew; const made=ledger[keyOf(p)]?.count||0;
    let body='';
    if(c&&c.error) body='<p class="bad">'+esc(c.error)+'</p>';
    else if(c&&c.access!=='ok') body='<p class="warn">'+esc(c.accessMessage)+'</p>';
    else if(c){
      const stages=Object.entries(STAGES).map(([v,l])=>'<option value="'+v+'"'+(v===p.stage?' selected':'')+'>'+esc(l)+'</option>').join('');
      const pickedIds=new Set(p.picked.map(f=>f.id));
      const cands=c.candidates.filter(f=>!pickedIds.has(f.id)); const others=c.directory.filter(f=>!pickedIds.has(f.id)&&!c.candidates.some(x=>x.id===f.id));
      const opt=(f)=>'<option value="'+esc(f.id)+'">'+esc(f.name+' · '+[f.title||'no title',f.company||'no company',TRADES[f.trade]].join(' · '))+'</option>';
      body='<p><small>Stage:</small> <select data-act="stage" data-k="'+k+'">'+stages+'</select> <small>'+esc(c.stageSource)+'</small></p>'
        +'<p><small>Dates (last 5 working days, project time): '+c.dates.map(day).join(', ')+'</small></p>'
        +(c.candidates.length?'':'<p class="warn">No foreman found in this project\\'s directory. Pick someone from the directory below, or untick the project to skip it.</p>')
        +'<div>'+(p.picked.map((f,i)=>chip(p,f,i)).join('')||'<small>No one picked.</small>')+'</div>'
        +'<p><select data-act="pick" data-k="'+k+'"><option value="">Add someone…</option>'+(cands.length?'<optgroup label="Foreman candidates">'+cands.map(opt).join('')+'</optgroup>':'')+(others.length?'<optgroup label="Everyone else in the directory">'+others.map(opt).join('')+'</optgroup>':'')+'</select></p>';
    } else body='<p><small>Foremen not loaded yet: press Find Foremen.</small></p>';
    const addBtn=(!c||!c.error)&&!(c&&['no_access','tool_off','no_project'].includes(c.access))?'<button class="small ghost" data-act="addforemen" data-k="'+k+'">Add 2 foremen</button>':'';
    const cards=p.samples.map((s,j)=>card(p,s,j)).join('');
    const btns=(c&&c.access==='ok'?'<button class="small ghost" data-act="regen" data-k="'+k+'">'+(p.samples.length?'Regenerate all 3':'Generate 3')+'</button>':'')
      +(p.samples.length?'<button class="small" data-act="send" data-k="'+k+'">Send this project\\'s samples</button>':'')
      +(made?'<button class="small danger" data-act="del" data-k="'+k+'">Delete samples I created here ('+made+')</button>':'')
      +addBtn
      +(c&&c.access==='ok'?'<button class="small ghost" data-act="checkleft" data-k="'+k+'">Clear old "SiteSnap test" entries</button>':'');
    return '<div class="proj"><label class="row"><input type="checkbox" data-act="on" data-k="'+k+'"'+(p.on?' checked':'')+'><span><b>'+esc(p.name)+'</b> <small>ID '+esc(p.projectId)+'</small>'+(made?' <span class="tag">'+made+' entr'+(made===1?'y':'ies')+' made by this page</span>':'')+'</span></label>'
      +(p.on?body+cards+'<div>'+btns+'</div>'+results(p):'')+'</div>';
  }).join('');
}

async function loadCrew(p){
  try{
    p.crew=await post({action:'crew',companyId:p.companyId,projectId:p.projectId,name:p.name});
    p.stage=p.crew.stage; p.picked=(p.crew.candidates||[]).map(f=>({...f}));
  }catch(e){ p.crew={error:e.message}; }
}
async function generate(p,count,keep){
  const b=await post({action:'generate',foremen:p.picked,dates:p.crew.dates,stage:p.stage,count:count||3,avoid:keep||[],delayTypes:p.crew.delayTypes});
  return b.samples;
}
const ready=(p)=>p.on&&p.crew&&p.crew.access==='ok';

$('#all').onclick=()=>{ P.forEach(p=>p.on=true); render(); };
$('#none').onclick=()=>{ P.forEach(p=>p.on=false); render(); };
$('#find').onclick=async()=>{
  const list=P.filter(p=>p.on);
  if(!list.length){ status('<span class="warn">'+(P.length?'No project is ticked. Tick at least one (or Tick all).':'No projects loaded. Press Load Projects first.')+'</span>'); return; }
  $('#find').disabled=true;
  for(const [n,p] of list.entries()){ status('Reading project '+(n+1)+' of '+list.length+': '+esc(p.name)+'…'); await loadCrew(p); render(); }
  const noAccess=list.filter(p=>p.crew&&(p.crew.error||p.crew.access!=='ok')).length; const noForeman=list.filter(p=>ready(p)&&!p.crew.candidates.length).length;
  status('Done. '+(noAccess?noAccess+' project(s) without Daily Log access. ':'')+(noForeman?noForeman+' project(s) with no foreman found: pick someone or untick them. ':'')+'Next: Generate Previews.');
  $('#find').disabled=false;
};
$('#gen').onclick=async()=>{
  const list=P.filter(p=>ready(p)&&p.picked.length); $('#gen').disabled=true;
  if(!list.length) status('<span class="warn">Find Foremen first (and pick at least one person per project).</span>');
  for(const p of list){ try{ p.samples=await generate(p,3); p.results=[]; }catch(e){ p.results=[{n:'',label:'Generate',status:'failed',error:e.message}]; } }
  editing=null; render(); if(list.length) status(list.reduce((a,p)=>a+p.samples.length,0)+' samples ready to check. Nothing has been sent.');
  $('#gen').disabled=false;
};

async function sendProject(p){
  const todo=p.samples.filter(s=>!s.sent); p.results=[];
  for(const s of todo){
    const n=p.samples.indexOf(s)+1;
    try{
      const b=await post({action:'send',companyId:p.companyId,projectId:p.projectId,projectName:p.name,sample:s});
      b.rows.forEach(r=>p.results.push({...r,n:n+' · '+day(s.date)}));
      if(b.rows.every(r=>r.status!=='failed')) s.sent=true;
    }catch(e){ p.results.push({n:n+' · '+day(s.date),label:'Sample',status:'failed',error:e.message}); }
    render();
  }
}
$('#sendall').onclick=async()=>{
  const list=P.filter(p=>p.on&&p.samples.some(s=>!s.sent));
  if(!list.length){ status('<span class="warn">Nothing to send. Generate previews first.</span>'); return; }
  const logs=list.reduce((a,p)=>a+p.samples.filter(s=>!s.sent).length,0); const entries=list.reduce((a,p)=>a+p.samples.filter(s=>!s.sent).reduce((b,s)=>b+entriesOf(s),0),0);
  if(!confirm('Create '+logs+' sample Daily Logs ('+entries+' entries) in Procore, in these '+list.length+' project(s)?\\n\\n'+list.map(p=>'• '+p.name+' ('+p.samples.filter(s=>!s.sent).length+')').join('\\n')+'\\n\\nThey are created as you.')) return;
  $('#sendall').disabled=true;
  for(const [n,p] of list.entries()){ status('Sending project '+(n+1)+' of '+list.length+': '+esc(p.name)+'…'); await sendProject(p); }
  await refreshLedger(); render(); status('Sent. Check each project\\'s table for anything failed.'); $('#sendall').disabled=false;
};
async function deleteProject(p){
  const b=await post({action:'delete',companyId:p.companyId,projectId:p.projectId});
  p.results=b.rows.map(r=>({...r,n:r.date?day(r.date):''})); p.samples.forEach(s=>s.sent=false);
}
$('#delall').onclick=async()=>{
  await refreshLedger();
  const keys=Object.keys(ledger).filter(k=>ledger[k].count);
  if(!keys.length){ status('The ledger is empty: this page has not created anything.'); render(); return; }
  const total=keys.reduce((a,k)=>a+ledger[k].count,0);
  if(!confirm('Delete '+total+' Daily Log entries this page created, in '+keys.length+' project(s)?\\n\\n'+keys.map(k=>'• '+(ledger[k].projectName||k)+' ('+ledger[k].count+')').join('\\n')+'\\n\\nOnly entries in the ledger are deleted.')) return;
  $('#delall').disabled=true;
  for(const key of keys){
    const [companyId,projectId]=key.split('_'); const p=P.find(x=>keyOf(x)===key)||{companyId,projectId,name:ledger[key].projectName||key,samples:[],results:[]};
    status('Deleting in '+esc(p.name)+'…');
    try{ await deleteProject(p); }catch(e){ p.results=[{n:'',label:'Delete',status:'failed',error:e.message}]; }
    render();
  }
  await refreshLedger(); render(); status('Done. Check the tables for anything that could not be deleted.'); $('#delall').disabled=false;
};

$('#list').addEventListener('change',(e)=>{
  const t=e.target; const p=P[t.dataset.k]; if(!p) return;
  if(t.dataset.act==='on'){ p.on=t.checked; render(); }
  if(t.dataset.act==='stage'){ p.stage=t.value; }
  if(t.dataset.act==='trade'){ p.picked[t.dataset.i].trade=t.value; }
  if(t.dataset.act==='pick'&&t.value){ const f=p.crew.candidates.find(x=>x.id===t.value)||p.crew.directory.find(x=>x.id===t.value); if(f) p.picked.push({...f,match:f.match||'manual'}); render(); }
});
$('#list').addEventListener('click',async(e)=>{
  const t=e.target.closest('button'); if(!t) return; const p=P[t.dataset.k]; const act=t.dataset.act;
  if(act==='cancel'){ editing=null; render(); return; }
  if(!p) return;
  const s=p.samples[t.dataset.s];
  try{
    if(act==='unpick'){ p.picked.splice(t.dataset.i,1); render(); }
    if(act==='regen'){ if(!p.picked.length){ alert('Pick at least one person first.'); return; } t.disabled=true; p.samples=await generate(p,3); p.results=[]; editing=null; render(); }
    if(act==='regen1'){ t.disabled=true; const keep=p.samples.filter(x=>x!==s).flatMap(x=>x.keys||[]); const [n]=await generate({...p,picked:[{...s.foreman,trade:s.trade}],crew:{...p.crew,dates:[s.date]}},1,keep); if(n) p.samples[t.dataset.s]=n; render(); }
    if(act==='remove'){ p.samples.splice(t.dataset.s,1); render(); }
    if(act==='edit'){ editing=s.id; render(); }
    if(act==='save'){
      const box=t.closest('.card'); const val=(f)=>box.querySelector('[data-f="'+f+'"]');
      for(const el of box.querySelectorAll('[data-f]')){ const [a,b]=el.dataset.f.split('.'); if(b==='drop') continue; if(b) s[a][b]=el.type==='number'?Number(el.value):el.value; else s[a]=el.value; }
      if(val('delivery.drop')?.checked) delete s.delivery; if(val('delay.drop')?.checked) delete s.delay;
      s.sent=false; editing=null; render();
    }
    if(act==='send'){
      const todo=p.samples.filter(x=>!x.sent); if(!todo.length){ alert('Every sample here is already sent.'); return; }
      if(!confirm('Create '+todo.length+' sample Daily Logs ('+todo.reduce((a,x)=>a+entriesOf(x),0)+' entries) in Procore, in "'+p.name+'"?\\n\\nThey are created as you.')) return;
      t.disabled=true; status('Sending '+esc(p.name)+'…'); await sendProject(p); await refreshLedger(); render(); status('Done: '+esc(p.name)+'.');
    }
    if(act==='addforemen'){
      if(!confirm('Add these 2 foremen to "'+p.name+'" in Procore?'+String.fromCharCode(10,10)+EXTRA.map(x=>'• '+x).join(String.fromCharCode(10))+String.fromCharCode(10,10)+'Their companies are added to the project if needed. Running it again never makes duplicates.')) return;
      t.disabled=true; status('Adding 2 foremen to '+esc(p.name)+'… (about 30 seconds)');
      const b=await post({action:'addforemen',companyId:p.companyId,projectId:p.projectId});
      p.results=b.steps.map(s=>({n:'',label:s.name,status:s.ok?'created':'failed',error:s.ok?s.detail:s.detail}));
      await loadCrew(p); render(); status('Done: '+esc(p.name)+'. Foremen reloaded.');
    }
    if(act==='checkleft'){
      t.disabled=true; const f=(await post({action:'checkentries',companyId:p.companyId,projectId:p.projectId,dryRun:true})).found;
      if(!f.length){ alert('No "SiteSnap test" entries from the Daily Log check in the last 5 working days here.'); t.disabled=false; return; }
      if(!confirm('Delete '+f.length+' entries the Daily Log check page left here?\\n\\n'+f.map(x=>'• '+day(x.date)+' · '+x.section+' · '+x.text).join('\\n'))){ t.disabled=false; return; }
      p.results=(await post({action:'checkentries',companyId:p.companyId,projectId:p.projectId,dryRun:false})).rows.map(r=>({...r,n:day(r.date)})); render();
    }
    if(act==='del'){
      const n=ledger[keyOf(p)]?.count||0; if(!confirm('Delete the '+n+' Daily Log entries this page created in "'+p.name+'"?\\n\\nOnly entries in the ledger are deleted.')) return;
      t.disabled=true; await deleteProject(p); await refreshLedger(); render();
    }
  }catch(err){ t.disabled=false; alert(err.message); }
});
</script></body></html>`;

// ---------- one project's foremen ----------

async function crew(req, res, cfg, companyId, projectId, name) {
  const proj = await api(req, res, cfg, "GET", `/rest/v1.0/projects/${projectId}`, { companyId, query: { company_id: companyId } });
  if (proj.status === 401) throw new HttpError(401, "not_connected", "Sign in with Procore again.");
  if (!proj.ok) return { access: "no_project", accessMessage: `You can't open this project in Procore (${proj.status}).` };
  const today = projectDay(proj.json?.time_zone);
  const dates = workingDays(today, 5);
  const { stage, source } = guessStage({ name: proj.json?.name ?? name, procoreStage: proj.json?.project_stage?.name ?? proj.json?.stage ?? "" });
  const base = { today, dates, stage, stageSource: source };

  const probe = await api(req, res, cfg, "GET", `/rest/v1.0/projects/${projectId}/manpower_logs`, { companyId, query: { log_date: today } });
  if (probe.status === 403) return { ...base, access: "no_access", accessMessage: "No Daily Log access on this project (Procore answered 403). Skipped." };
  if (probe.status === 404) return { ...base, access: "tool_off", accessMessage: "The Daily Log tool is turned off on this project (Procore answered 404). Skipped; turn it on in Procore's Project Tools to use it." };
  if (!probe.ok) return { ...base, access: "error", accessMessage: `Procore answered ${probe.status} reading the Daily Log: ${procoreMessage(probe) || "no details"}` };

  const users = await pages(req, res, cfg, `/rest/v1.0/projects/${projectId}/users`, { companyId });
  if (users == null) return { ...base, access: "no_directory", accessMessage: "Can't read this project's directory (Procore said no), so there's no one to write as. Skipped." };
  const { candidates, directory } = findForemen(users);

  let delayTypes = [];
  for (const path of delayTypePaths(companyId, projectId)) {
    const r = await api(req, res, cfg, "GET", path, { companyId, query: { project_id: projectId } });
    if (r.ok && Array.isArray(r.json)) {
      delayTypes = r.json.filter((t) => t.active !== false && t.visible !== false && delayTypeName(t)).map(delayTypeName);
      break;
    }
  }
  return { ...base, access: "ok", candidates, directory, delayTypes };
}

// ---------- generate (no Procore) ----------

const cleanPerson = (f) => ({
  id: text(f?.id, 20), name: text(f?.name, 80), title: text(f?.title, 80), company: text(f?.company, 120),
  companyId: procoreId(String(f?.companyId ?? "")) ?? null, trade: TRADES[f?.trade] ? f.trade : "gc",
});

function generate(body) {
  const foremen = (Array.isArray(body.foremen) ? body.foremen : []).slice(0, 50).map(cleanPerson).filter((f) => f.name);
  if (!foremen.length) throw new HttpError(400, "no_foreman", "Pick at least one person from the directory first.");
  const dates = (Array.isArray(body.dates) ? body.dates : []).filter((d) => DATE.test(d)).slice(0, 10);
  if (!dates.length) throw new HttpError(400, "no_dates", "Find Foremen again (no dates for this project).");
  const stage = STAGES[body.stage] ? body.stage : "roughin";
  const count = Math.min(3, Math.max(1, Number(body.count) || 3));
  const avoid = (Array.isArray(body.avoid) ? body.avoid : []).map((k) => text(k, 60));
  const delayTypes = (Array.isArray(body.delayTypes) ? body.delayTypes : []).map((t) => text(t, 80)).filter(Boolean);
  return { samples: makeSamples({ foremen, dates, stage, count, avoid, delayTypes }) };
}

// ---------- send one sample ----------

// The page's sample part -> what cleanEntry takes (api/_dailyLog.js)
function entryOf(part, s) {
  if (part === "manpower") return { workers: s.workers, hours: s.hours, company: s.company, trade: s.trade, comment: s.comment };
  if (part === "notes") {
    const t = String(s.text ?? "").trim();
    return { text: t.includes(MARKER) ? t : `${t} ${MARKER}` };
  }
  if (part === "delivery") return { what: s.what, time: s.time, from: s.from, comment: s.comment };
  return { type: s.type, start: s.start, end: s.end, company: s.company, comment: s.comment };
}
const refusal = (r) => {
  const said = procoreMessage(r) || (typeof r.json === "string" ? r.json : JSON.stringify(r.json ?? "")).slice(0, 300);
  const plain = r.status === 403 ? "Procore said no: either no Daily Log access here, or that day is Completed (a completed day is locked; reopen it in Procore's Daily Log Calendar). " : r.status === 404 ? "The Daily Log tool looks turned off on this project. " : r.status === 429 ? "Procore is busy; wait a minute and send again. " : "";
  return `${plain}Procore answered ${r.status}: ${said || "no details"}`;
};
// Delete one Daily Log entry. A Completed day is locked: delete and edit both answer 403, even for the admin who
// made the entry (sandbox, 2026-10-16; after Ky reopened the days, all 12 deleted at once). On a 403 the entry is
// set back to pending and deleted again, which helps only if approval is what blocks it.
// { r, note }: Procore's last answer, and what was tried.
async function deleteEntry(req, res, cfg, companyId, projectId, section, id) {
  const path = `/rest/v1.0/projects/${projectId}/${SECTIONS[section].path}/${id}`;
  const r = await api(req, res, cfg, "DELETE", path, { companyId });
  if (r.status !== 403) return { r, note: "" };
  const back = await api(req, res, cfg, "PATCH", path, { companyId, body: { [SECTIONS[section].root]: { status: "pending" } } });
  if (!back.ok) return { r, note: ` Setting it back to pending was refused too (${back.status}: ${procoreMessage(back) || "no details"}).` };
  const again = await api(req, res, cfg, "DELETE", path, { companyId });
  return { r: again, note: again.ok ? "Set back to pending, then deleted" : ` Set back to pending (status now ${back.json?.status ?? "not shown"}), but the delete was still refused.` };
}

const ledgerRef = (db, key) => db.collection("procoreProjects").doc(key).collection(LEDGER);

async function send(req, res, cfg, companyId, projectId, body) {
  const s = body.sample ?? {};
  const sampleId = String(s.id ?? "");
  if (!SAMPLE_ID.test(sampleId)) throw new HttpError(400, "bad_sample", "That sample has no id. Generate it again.");
  const date = String(s.date ?? "");
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
  if (!DATE.test(date) || date > projectDay("Pacific/Kiritimati") || weekday === 0 || weekday === 6) throw new HttpError(400, "bad_date", "Samples go on past or current working days only.");
  if (!s.manpower || !s.notes) throw new HttpError(400, "bad_sample", "Every sample needs Manpower and Notes.");
  const key = `${companyId}_${projectId}`;
  const ref = ledgerRef(await firestore(), key);
  const rows = [];
  for (const [part, section] of PARTS) {
    if (!s[part]) continue;
    const label = SECTIONS[section].label;
    const docId = `${sampleId}_${section}`;
    const had = await ref.doc(docId).get();
    if (had.exists) { rows.push({ label, status: "skipped", procoreId: had.data()?.procoreId ?? null, error: "Already sent (in the ledger)" }); continue; }
    let entry;
    try { entry = cleanEntry(section, entryOf(part, s[part])); } catch (err) { rows.push({ label, status: "failed", error: err.message }); continue; }
    const path = `/rest/v1.0/projects/${projectId}/${SECTIONS[section].path}`;
    let r = await api(req, res, cfg, "POST", path, { companyId, ...requestFor(section, procoreFields(section, entry, { date })) });
    let note = "";
    // A company Procore won't take (not on this project): once more without it, and say so
    if ((r.status === 422 || r.status === 400) && entry.company != null && ["manpower", "delays"].includes(section)) {
      const first = refusal(r);
      r = await api(req, res, cfg, "POST", path, { companyId, ...requestFor(section, procoreFields(section, { ...entry, company: null }, { date })) });
      if (r.ok) note = `Company left blank (first try: ${first})`;
    }
    if (r.status === 401) throw new HttpError(401, "not_connected", "Your Procore sign-in ran out. Sign in with Procore again, then send again (sent entries are skipped).");
    const procoreEntryId = r.ok ? r.json?.id ?? null : null;
    if (!r.ok || procoreEntryId == null) { rows.push({ label, status: "failed", error: r.ok ? "Procore answered without an id" : refusal(r) }); continue; }
    await ref.doc(docId).set({
      key, companyId, projectId, projectName: text(body.projectName, 200), sampleId, section, procoreId: String(procoreEntryId), date,
      foreman: text(s.foreman?.name, 80), createdAt: Date.now(),
    });
    if (section === "delays" && entry.type) {
      const kept = typeof r.json?.delay_type === "object" ? delayTypeName(r.json.delay_type) : r.json?.delay_type;
      if (!kept) note = [note, `Procore didn't keep the delay type (sent "${procoreFields(section, entry, { date }).delay_type}")`].filter(Boolean).join("; ");
    }
    rows.push({ label, status: "created", procoreId: String(procoreEntryId), error: note || null });
  }
  return { rows };
}

// ---------- ledger and delete ----------

async function listLedger() {
  const snap = await (await firestore()).collectionGroup(LEDGER).get();
  const byKey = {};
  for (const d of snap.docs) {
    const v = d.data();
    if (!v?.key) continue;
    byKey[v.key] ??= { count: 0, projectName: v.projectName || null };
    byKey[v.key].count += 1;
  }
  return { byKey };
}

async function remove(req, res, cfg, companyId, projectId) {
  const ref = ledgerRef(await firestore(), `${companyId}_${projectId}`);
  const snap = await ref.get();
  const rows = [];
  for (const d of snap.docs) {
    const v = d.data();
    const section = SECTIONS[v?.section] ? v.section : null;
    const label = section ? SECTIONS[section].label : String(v?.section ?? "?");
    if (!section || !procoreId(String(v.procoreId ?? ""))) { await ref.doc(d.id).delete(); rows.push({ label, status: "skipped", error: "Bad ledger row, removed" }); continue; }
    const { r, note } = await deleteEntry(req, res, cfg, companyId, projectId, section, v.procoreId);
    if (r.status === 401) throw new HttpError(401, "not_connected", "Your Procore sign-in ran out. Sign in with Procore again, then delete again.");
    if (r.ok || r.status === 404) {
      await ref.doc(d.id).delete();
      rows.push({ label, date: v.date, status: r.ok ? "deleted" : "skipped", procoreId: v.procoreId, error: r.ok ? note || null : "Already gone from Procore" });
    } else {
      // Say what the entry looks like in Procore (approval status, who made it), to see why a delete is refused
      const one = await api(req, res, cfg, "GET", `/rest/v1.0/projects/${projectId}/${SECTIONS[section].path}/${v.procoreId}`, { companyId });
      const seen = one.ok ? ` The entry in Procore: status ${one.json?.status ?? "not shown"}, made by ${one.json?.created_by?.name ?? "not shown"}, date ${one.json?.date ?? v.date}.` : ` (Reading the entry: ${one.status}.)`;
      rows.push({ label, date: v.date, status: "failed", procoreId: v.procoreId, error: `Procore wouldn't delete it. Procore answered ${r.status}: ${procoreMessage(r) || "no details"}${note}${seen}${r.status === 403 ? " If that day is Completed in Procore, reopen it in the Daily Log Calendar and delete again." : ""} It stays in the ledger.` });
    }
  }
  return { rows };
}

// ---------- leftovers from the Daily Log check page ----------

const CHECK_TEXT = /^SiteSnap test/i;
const textsOf = (x) => [x?.notes, x?.comment, x?.comments, x?.contents, x?.delivery_from].filter((t) => typeof t === "string");

async function checkEntries(req, res, cfg, companyId, projectId, dryRun) {
  const proj = await api(req, res, cfg, "GET", `/rest/v1.0/projects/${projectId}`, { companyId, query: { company_id: companyId } });
  if (proj.status === 401) throw new HttpError(401, "not_connected", "Sign in with Procore again.");
  const days = workingDays(projectDay(proj.json?.time_zone), 5);
  const found = [];
  for (const section of Object.keys(SECTIONS)) {
    for (const date of days) {
      const r = await api(req, res, cfg, "GET", `/rest/v1.0/projects/${projectId}/${SECTIONS[section].path}`, { companyId, query: { log_date: date } });
      if (r.status === 403 || r.status === 404) break;
      for (const x of Array.isArray(r.json) ? r.json : []) {
        if (x?.id != null && textsOf(x).some((t) => CHECK_TEXT.test(t.trim()))) found.push({ section, id: String(x.id), date, text: textsOf(x).find((t) => CHECK_TEXT.test(t.trim())) });
      }
    }
  }
  if (dryRun) return { found };
  const rows = [];
  for (const f of found) {
    const { r, note } = await deleteEntry(req, res, cfg, companyId, projectId, f.section, f.id);
    rows.push({ label: SECTIONS[f.section].label, date: f.date, procoreId: f.id, status: r.ok ? "deleted" : r.status === 404 ? "skipped" : "failed", error: r.ok ? note || null : `${refusal(r)}${note}` });
  }
  return { rows };
}

// ---------- two extra foremen ----------

async function addForemen(req, res, cfg, companyId, projectId) {
  const steps = [];
  for (const f of EXTRA_FOREMEN) {
    const seed = SEED[f.company];
    const co = await addCompany(req, res, cfg, companyId, projectId, seed);
    steps.push(...co.steps);
    if (co.vendorId) steps.push(...await addPerson(req, res, cfg, companyId, projectId, seed, f.user, co.vendorId, permissionTemplateFor));
  }
  return { steps };
}

export default async function handler(req, res) {
  try {
    const cfg = config();
    if (!/sandbox/i.test(cfg.apiUrl)) throw new HttpError(403, "not_sandbox", "This page only runs against Procore's sandbox.");
    if (req.method === "GET") {
      res.statusCode = 200;
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("X-Robots-Tag", "noindex");
      return res.end(PAGE);
    }
    if (req.method !== "POST") throw new HttpError(405, "bad_request", "Use POST.");
    requireSameOriginJson(req);
    const body = await readBody(req);
    if (body.action === "generate") return sendJson(res, 200, generate(body));
    if (body.action === "ledger") return sendJson(res, 200, await listLedger());
    const companyId = procoreId(String(body.companyId ?? ""));
    const projectId = procoreId(String(body.projectId ?? ""));
    if (!companyId || !projectId) throw new HttpError(400, "missing_ids", "Pick a project.");
    if (body.action === "crew") return sendJson(res, 200, await crew(req, res, cfg, companyId, projectId, text(body.name, 200)));
    if (body.action === "send") return sendJson(res, 200, await send(req, res, cfg, companyId, projectId, body));
    if (body.action === "delete") return sendJson(res, 200, await remove(req, res, cfg, companyId, projectId));
    if (body.action === "addforemen") return sendJson(res, 200, await addForemen(req, res, cfg, companyId, projectId));
    if (body.action === "checkentries") return sendJson(res, 200, await checkEntries(req, res, cfg, companyId, projectId, body.dryRun !== false));
    throw new HttpError(400, "bad_request", "Unknown action.");
  } catch (err) {
    sendError(res, err);
  }
}
