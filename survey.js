const CFG=window.SURVEY_CONFIG,LIVE=!!(CFG.apiKey&&CFG.projectId);
const $=s=>document.querySelector(s);
const DOCS=`projects/${CFG.projectId}/databases/(default)/documents`;
const FS=`https://firestore.googleapis.com/v1/${DOCS}`;
const hex=b=>[...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,"0")).join("");
const sha=async s=>hex(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(s)));
const rand=n=>hex(crypto.getRandomValues(new Uint8Array(n)));
const answers={};
let session=null,token="";
const KEY="survey-session";
const toValue=v=>Array.isArray(v)?{arrayValue:{values:v.map(s=>({stringValue:s}))}}:{stringValue:String(v)};
const fields=o=>Object.fromEntries(Object.entries(o).map(([k,v])=>[k,toValue(v)]));
async function commit(writes,idToken){
 const r=await fetch(`${FS}:commit`,{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${idToken}`},body:JSON.stringify({writes})});
 if(!r.ok){const e=new Error(r.status===403?"denied":"network");throw e}
}
async function signIn(){
 const r=await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${CFG.apiKey}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({returnSecureToken:true})});
 if(!r.ok)throw new Error("network");
 const d=await r.json();return{uid:d.localId,idToken:d.idToken,refreshToken:d.refreshToken};
}
async function refresh(s){
 const r=await fetch(`https://securetoken.googleapis.com/v1/token?key=${CFG.apiKey}`,{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({grant_type:"refresh_token",refresh_token:s.refreshToken})});
 if(!r.ok)throw new Error("network");
 const d=await r.json();s.idToken=d.id_token;s.refreshToken=d.refresh_token;return s;
}
const show=id=>{for(const s of ["#start","#form","#done","#blocked"])$(s).hidden=s!==id;scrollTo(0,0)};
function block(title,text){$("#blockedTitle").textContent=title;$("#blockedText").textContent=text;show("#blocked")}
function optEl(part,o,type){
 const l=document.createElement("label");l.className="opt";
 const i=document.createElement("input");i.type=type==="single"?"radio":"checkbox";i.name=part.id;i.value=o;
 const s=document.createElement("span");s.textContent=o;l.append(i,s);
 i.addEventListener("click",()=>{
  if(type==="single"){if(answers[part.id]===o){i.checked=false;delete answers[part.id]}else answers[part.id]=o}
  else{let a=answers[part.id]||[];
   if(i.checked){a=(part.exclusive||[]).includes(o)?[o]:a.filter(x=>!(part.exclusive||[]).includes(x)).concat(o)}else a=a.filter(x=>x!==o);
   if(a.length)answers[part.id]=a;else delete answers[part.id]}
  sync();
 });
 return l;
}
function render(){
 const root=$("#questions");
 for(const q of QUESTIONS){
  const c=document.createElement("section");c.className="card";c.dataset.q=q.no;
  const h=document.createElement("h2");h.innerHTML=`<span class="no">${q.no}</span>`;h.append(q.title);c.append(h);
  if(q.hint){const p=document.createElement("p");p.className="hint";p.textContent=q.hint;c.append(p)}
  for(const part of q.parts){
   const d=document.createElement("div");d.className="part";d.dataset.part=part.id;
   if(part.label){const p=document.createElement("p");p.className="label";p.textContent=part.label;d.append(p)}
   if(part.type==="text"){
    const t=document.createElement("textarea");t.maxLength=2000;t.addEventListener("input",()=>{const v=t.value.trim();if(v)answers[part.id]=t.value;else delete answers[part.id]});d.append(t);
   }else for(const o of part.options){
    d.append(optEl(part,o,part.type));
    if(o==="その他"&&part.other){const b=document.createElement("div");b.className="otherBox";b.dataset.other=part.other;b.hidden=true;
     const i=document.createElement("input");i.type="text";i.maxLength=200;i.placeholder="その他の内容";i.setAttribute("aria-label","その他の内容");
     i.addEventListener("input",()=>{const v=i.value.trim();if(v)answers[part.other]=v;else delete answers[part.other]});b.append(i);d.append(b)}
   }
   c.append(d);
  }
  root.append(c);
 }
 sync();
}
function clearPart(p){delete answers[p.id];if(p.other)delete answers[p.other];
 document.querySelectorAll(`[data-part="${p.id}"] input,[data-part="${p.id}"] textarea`).forEach(i=>{if(i.type==="text"||i.tagName==="TEXTAREA")i.value="";else i.checked=false})}
function sync(){
 for(const q of QUESTIONS){
  const sec=document.querySelector(`[data-q="${q.no}"]`),on=!q.showIf||q.showIf(answers);
  if(sec.hidden!==!on)sec.hidden=!on;if(!on)q.parts.forEach(clearPart);
  for(const p of q.parts){
   const el=document.querySelector(`[data-part="${p.id}"]`);
   if(p.showIf){const v=p.showIf(answers);el.hidden=!v;if(!v)clearPart(p)}
   if(p.other){const has=(answers[p.id]||[]).includes("その他"),b=el.querySelector("[data-other]");b.hidden=!has;if(!has){delete answers[p.other];b.querySelector("input").value=""}}
  }
 }
 document.querySelectorAll(".opt").forEach(l=>l.classList.toggle("on",l.querySelector("input").checked));
 document.querySelectorAll('.opt input[type=checkbox]').forEach(i=>{const a=answers[i.name];i.checked=!!a&&a.includes(i.value);i.closest(".opt").classList.toggle("on",i.checked)});
}
async function start(){
 const btn=$("#startBtn"),msg=$("#startMsg");msg.textContent="";btn.disabled=true;
 try{
  if(LIVE){
   const h=await sha(token);
   let s=JSON.parse(localStorage.getItem(KEY)||"null");
   if(!s||s.t!==h){
    const a=await signIn();const r=rand(16);
    await commit([
     {update:{name:`${DOCS}/used/${h}`,fields:{}},currentDocument:{exists:false}},
     {update:{name:`${DOCS}/claims/${a.uid}`,fields:fields({t:h,r})},currentDocument:{exists:false}}],a.idToken);
    s={...a,t:h,r};localStorage.setItem(KEY,JSON.stringify(s));
   }else await refresh(s);
   session=s;
  }
  show("#form");
 }catch(e){
  if(e.message==="denied")block("このリンクはご利用いただけません","すでに回答に使われたか、正しいリンクではありません。");
  else msg.textContent="通信できませんでした。電波の良い場所でもう一度お試しください。";
 }
 btn.disabled=false;
}
async function submit(){
 const btn=$("#sendBtn"),msg=$("#sendMsg");msg.textContent="";
 if(!Object.keys(answers).length){msg.textContent="1問以上お答えください。";return}
 btn.disabled=true;btn.textContent="送信しています…";
 try{
  if(LIVE){
   await refresh(session);
   await commit([
    {update:{name:`${DOCS}/responses/${session.r}`,fields:fields(answers)},currentDocument:{exists:false}},
    {delete:`${DOCS}/claims/${session.uid}`,currentDocument:{exists:true}}],session.idToken);
   localStorage.removeItem(KEY);
  }
  history.replaceState(null,"",location.pathname);show("#done");
 }catch(e){
  msg.textContent=e.message==="denied"?"送信できませんでした。すでに回答済みの可能性があります。":"送信できませんでした。電波の良い場所でもう一度押してください。";
 }
 btn.disabled=false;btn.textContent="回答を送信する";
}
token=new URLSearchParams(location.hash.slice(1)).get("t")||"";
render();
$("#startBtn").addEventListener("click",start);$("#sendBtn").addEventListener("click",submit);
if(!LIVE)$("#previewNote").hidden=false;
else if(!token)block("個別のリンクからお入りください","このアンケートは、お手元に届いたリンクから回答できます。");
