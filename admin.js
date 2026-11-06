const CFG=window.SURVEY_CONFIG,LIVE=!!(CFG.apiKey&&CFG.projectId);
const $=s=>document.querySelector(s);
const DOCS=`projects/${CFG.projectId}/databases/(default)/documents`,FS=`https://firestore.googleapis.com/v1/${DOCS}`;
let idToken="",curUid="",curId="",rows=[];
const hdr=()=>({"Content-Type":"application/json",Authorization:`Bearer ${idToken}`});
const fromVal=v=>"arrayValue"in v?(v.arrayValue.values||[]).map(x=>x.stringValue):v.stringValue;
async function listAll(col){
 const out=[];let page="";
 do{const r=await fetch(`${FS}/${col}?pageSize=300${page?`&pageToken=${encodeURIComponent(page)}`:""}`,{headers:hdr()});
  if(!r.ok)throw new Error(String(r.status));
  const d=await r.json();out.push(...(d.documents||[]));page=d.nextPageToken||""}while(page);
 return out;
}
const AUTH="https://identitytoolkit.googleapis.com/v1/accounts";
const toEmail=id=>`${id.toLowerCase()}@${CFG.projectId}.firebaseapp.com`;
const authCall=async(path,body)=>{
 const r=await fetch(`${AUTH}:${path}?key=${CFG.apiKey}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
 const d=await r.json();if(!r.ok)throw new Error(d.error?.message||"auth");return d;
};
const fsCommit=async(writes,tok=idToken)=>{const r=await fetch(`${FS}:commit`,{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${tok}`},body:JSON.stringify({writes})});if(!r.ok)throw new Error("firestore")};
const signInPw=(id,password)=>authCall("signInWithPassword",{email:toEmail(id),password,returnSecureToken:true});
const validId=id=>/^[A-Za-z0-9._-]{3,30}$/.test(id);
function enter(d,id){idToken=d.idToken;curUid=d.localId;curId=id;$("#pass").value="";$("#login").hidden=true;$("#main").hidden=false}
async function login(){
 const m=$("#loginMsg"),id=$("#loginId").value.trim();m.textContent="";
 if(!validId(id)){m.textContent="IDかパスワードが違います。";return}
 $("#loginBtn").disabled=true;
 try{const d=await signInPw(id,$("#pass").value);idToken=d.idToken;await load();enter(d,id)}
 catch(e){m.textContent=e.message==="firestore"||/^\d+$/.test(e.message)?"担当者として登録されていないか、通信できませんでした。":"IDかパスワードが違います。"}
 $("#loginBtn").disabled=false;
}
async function setup(){
 const m=$("#loginMsg"),id=$("#loginId").value.trim(),pw=$("#pass").value;m.textContent="";
 if(!validId(id)){m.textContent="IDは英数字3〜30文字で決めてください。";return}
 if(pw.length<8){m.textContent="パスワードは8文字以上にしてください。";return}
 let d;
 try{
  d=await authCall("signUp",{email:toEmail(id),password:pw,returnSecureToken:true});idToken=d.idToken;
  await fsCommit([{update:{name:`${DOCS}/admins/${d.localId}`,fields:{}},currentDocument:{exists:false}},{update:{name:`${DOCS}/meta/setup`,fields:{}},currentDocument:{exists:false}}]);
  const done=d;d=null;history.replaceState(null,"",location.pathname);enter(done,id);await load();
 }catch(e){
  if(!d&&idToken){m.textContent="";return}
  if(d)await authCall("delete",{idToken:d.idToken}).catch(()=>{});
  m.textContent=e.message==="EMAIL_EXISTS"?"このIDは使えません。":"登録できませんでした。初回登録はすでに完了している可能性があります。"}
}
async function changeLogin(){
 const m=$("#changeMsg"),cur=$("#curPass").value,nid=$("#newId").value.trim(),np=$("#newPass").value,np2=$("#newPass2").value;
 m.textContent="";
 if(!cur){m.textContent="現在のパスワードを入れてください。";return}
 if(!nid&&!np){m.textContent="新しいIDか新しいパスワードを入れてください。";return}
 if(nid&&!validId(nid)){m.textContent="IDは英数字3〜30文字で決めてください。";return}
 if(np&&np.length<8){m.textContent="パスワードは8文字以上にしてください。";return}
 if(np!==np2){m.textContent="新しいパスワードが確認欄と一致しません。";return}
 const changeId=nid&&toEmail(nid)!==toEmail(curId);
 if(!changeId&&!np){m.textContent="今と同じIDです。";return}
 $("#changeBtn").disabled=true;
 let step="cur",made=null;
 try{
  const old=await signInPw(curId,cur);step="change";
  if(changeId){
   made=await authCall("signUp",{email:toEmail(nid),password:np||cur,returnSecureToken:true});
   await fsCommit([{update:{name:`${DOCS}/admins/${made.localId}`,fields:{}},currentDocument:{exists:false}},{delete:`${DOCS}/admins/${old.localId}`}],old.idToken);
   const keep=made;made=null;await authCall("delete",{idToken:old.idToken}).catch(()=>{});
   idToken=keep.idToken;curUid=keep.localId;curId=nid;
  }else{const d=await authCall("update",{idToken:old.idToken,password:np,returnSecureToken:true});idToken=d.idToken}
  for(const s of["#curPass","#newId","#newPass","#newPass2"])$(s).value="";
  m.textContent=changeId?"変更しました。次回から新しいIDでログインしてください。":"パスワードを変更しました。";
 }catch(e){
  if(made)await authCall("delete",{idToken:made.idToken}).catch(()=>{});
  m.textContent=step==="cur"?"現在のパスワードが違います。":e.message==="EMAIL_EXISTS"?"このIDは使えません。":"変更できませんでした。"}
 $("#changeBtn").disabled=false;
}
async function load(){
 if(!LIVE){rows=sample();$("#sIssued").textContent="30";draw();return}
 await loadOpen();
 const docs=await listAll("responses");
 rows=docs.map(d=>Object.fromEntries(Object.entries(d.fields||{}).map(([k,v])=>[k,fromVal(v)])));
 $("#sIssued").textContent=(await listAll("tickets")).length;draw();
}
function sample(){
 let seed=7;const rnd=n=>{seed=(seed*16807)%2147483647;return seed%n};const out=[];
 for(let i=0;i<24;i++){const a={};
  for(const q of QUESTIONS)for(const p of q.parts){
   if(p.type==="single"&&rnd(9))a[p.id]=p.options[Math.min(rnd(p.options.length),rnd(p.options.length))];
   if(p.type==="multi"&&!p.showIf&&rnd(3)){const x=p.options.filter(o=>o!=="その他"&&!(p.exclusive||[]).includes(o)&&!rnd(3));if(x.length)a[p.id]=x}
  }
  if(!rnd(3))a.q8a="（サンプル）丁寧に教えてもらえて、子供が楽しそうに通っています。";
  if(!rnd(4))a.q8b="（サンプル）練習内容を保護者にも共有してもらえると助かります。";
  out.push(a)}
 return out;
}
const flat=()=>QUESTIONS.flatMap(q=>q.parts.map(p=>({q,p})));
const fullTitle=({q,p})=>`問${q.no} ${p.label||q.title}`;
function tally(p){
 const n=rows.filter(r=>r[p.id]!==undefined).length;
 return{n,items:p.options.map(o=>{const c=rows.filter(r=>[].concat(r[p.id]??[]).includes(o)).length;return{o,c,pct:n?Math.round(c/n*1000)/10:0}})};
}
function el(t,c,x){const e=document.createElement(t);if(c)e.className=c;if(x!==undefined)e.textContent=x;return e}
function draw(){
 $("#sAns").textContent=rows.length;
 const root=$("#result");root.textContent="";
 for(const f of flat()){
  const{p}=f,c=el("section","card");c.append(el("h2","plain",fullTitle(f)));
  if(p.type==="text"||!p.options){
   const t=rows.map(r=>r[p.id]).filter(Boolean);c.append(el("p","hint",`${t.length}件`));
   t.forEach(x=>c.append(el("p","quote",x)));
  }else{
   const{n,items}=tally(p);c.append(el("p","hint",`回答 ${n}件`));
   const max=Math.max(1,...items.map(i=>i.c));
   for(const i of items){const b=el("div","bar"),t=el("div","barText");t.append(el("span","",i.o),el("span","",`${i.c}件 ${i.pct}%`));
    const tr=el("div","track"),fi=el("div","fill");fi.style.width=`${i.c/max*100}%`;tr.append(fi);b.append(t,tr);c.append(b)}
   if(p.other){const t=rows.map(r=>r[p.other]).filter(Boolean);if(t.length){c.append(el("p","label","「その他」の内容"));t.forEach(x=>c.append(el("p","quote",x)))}}
  }
  root.append(c);
 }
}
/* --- Excel --- */
const esc=s=>String(s).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g,"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
const colName=i=>{let s="";for(i++;i;i=Math.floor((i-1)/26))s=String.fromCharCode(65+(i-1)%26)+s;return s};
const sheet=t=>`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${t.map((r,y)=>`<row r="${y+1}">${r.map((v,x)=>{const a=colName(x)+(y+1);return typeof v==="number"?`<c r="${a}"><v>${v}</v></c>`:`<c r="${a}" t="inlineStr"><is><t xml:space="preserve">${esc(v??"")}</t></is></c>`}).join("")}</row>`).join("")}</sheetData></worksheet>`;
const CRC=(()=>{const t=[];for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;t[n]=c>>>0}return t})();
const crc=b=>{let c=~0;for(const x of b)c=CRC[(c^x)&255]^(c>>>8);return(~c)>>>0};
function zip(files){
 const enc=new TextEncoder(),parts=[],central=[];let off=0;
 const u16=n=>[n&255,n>>8&255],u32=n=>[n&255,n>>>8&255,n>>>16&255,n>>>24&255];
 for(const[name,text]of files){const nm=enc.encode(name),d=enc.encode(text),c=crc(d);
  const head=[...u16(20),...u16(0x800),...u16(0),...u16(0),...u16(0x21),...u32(c),...u32(d.length),...u32(d.length),...u16(nm.length),...u16(0)];
  const l=new Uint8Array([0x50,0x4b,3,4,...head]);parts.push(l,nm,d);
  central.push([new Uint8Array([0x50,0x4b,1,2,20,0,...head,...u16(0),...u16(0),...u16(0),...u32(0),...u32(off)]),nm]);
  off+=l.length+nm.length+d.length}
 const cStart=off;let cSize=0;for(const[a,b]of central){parts.push(a,b);cSize+=a.length+b.length}
 parts.push(new Uint8Array([0x50,0x4b,5,6,0,0,0,0,...u16(files.length),...u16(files.length),...u32(cSize),...u32(cStart),0,0]));
 return new Blob(parts,{type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"});
}
function saveXlsx(){
 const cols=flat().flatMap(f=>[{key:f.p.id,title:fullTitle(f)}].concat(f.p.other?[{key:f.p.other,title:fullTitle(f)+"（その他の内容）"}]:[]));
 const all=[cols.map(c=>c.title),...rows.map(r=>cols.map(c=>[].concat(r[c.key]??[]).join("、")))];
 const sum=[["質問","選択肢","件数","割合(%)"]];
 for(const f of flat())if(f.p.options){const{items}=tally(f.p);for(const i of items)sum.push([fullTitle(f),i.o,i.c,i.pct])}
 const b=zip([
  ["[Content_Types].xml",'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>'],
  ["_rels/.rels",'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
  ["xl/workbook.xml",'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="集計" sheetId="1" r:id="rId1"/><sheet name="回答一覧" sheetId="2" r:id="rId2"/></sheets></workbook>'],
  ["xl/_rels/workbook.xml.rels",'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/></Relationships>'],
  ["xl/worksheets/sheet1.xml",sheet(sum)],["xl/worksheets/sheet2.xml",sheet(all)]]);
 const a=el("a");a.href=URL.createObjectURL(b);a.download="アンケート集計.xlsx";a.click();
}
/* --- 個別リンク --- */
const hex=b=>[...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,"0")).join("");
const sha=async s=>hex(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(s)));
const baseUrl=()=>new URL("./",location.href).href;
function qrSvg(text){
 const NS="http://www.w3.org/2000/svg",{d,size}=QR.toPath(QR.encode(text)),svg=document.createElementNS(NS,"svg"),p=document.createElementNS(NS,"path");
 svg.setAttribute("viewBox",`0 0 ${size} ${size}`);svg.setAttribute("class","qrCode");svg.setAttribute("shape-rendering","crispEdges");p.setAttribute("d",d);p.setAttribute("fill","#000");svg.append(p);return svg;
}
function printWith(cls){document.body.classList.add(cls);addEventListener("afterprint",()=>document.body.classList.remove(cls),{once:true});window.print()}
let accepting=false;
async function loadOpen(){
 if(!LIVE)return;
 const r=await fetch(`${FS}/meta/open?key=${CFG.apiKey}`);accepting=r.ok;drawOpen();
}
function drawOpen(){$("#openState").textContent=accepting?"現在：回答を受付中です":"現在：回答を受け付けていません";$("#openBtn").textContent=accepting?"回答の受付を締め切る":"回答の受付を始める"}
async function setOpen(v){
 await fsCommit([v?{update:{name:`${DOCS}/meta/open`,fields:{}}}:{delete:`${DOCS}/meta/open`}]);accepting=v;drawOpen();
}
async function toggleOpen(){
 const m=$("#openMsg");m.textContent="";$("#openBtn").disabled=true;
 try{await setOpen(!accepting)}catch(e){m.textContent="変更できませんでした。ログインし直してください。"}
 $("#openBtn").disabled=false;
}
async function poster(){
 const m=$("#openMsg");m.textContent="";
 try{if(LIVE&&!accepting)await setOpen(true)}catch(e){m.textContent="受付を始められませんでした。ログインし直してください。";return}
 const s=$("#posterSheet");s.textContent="";
 s.append(el("p","posterSub","保護者の皆様へ"),el("h2","posterTitle","アンケートにご協力ください"),el("p","posterLead","子供たちが水泳を続けられる環境についてのアンケートです。"),qrSvg(`${baseUrl()}#open`),el("p","posterHow","スマートフォンのカメラで読み取ってください"),el("p","posterNote","無記名です。お名前の入力はありません。回答は1人1回でお願いします。"));
 printWith("printPoster");
}
function buildSheet(urls){
 const sheet=$("#qrSheet");sheet.textContent="";
 for(const u of urls){
  const card=el("div","qrCard"),svg=qrSvg(u);
  const t=el("div","qrText");t.append(el("b","","保護者アンケート"),el("p","","子供たちが水泳を続けられる環境についてのアンケートです。"),el("p","","スマートフォンのカメラでQRコードを読み取ってください。"),el("p","","無記名です。お名前の入力はありません。回答できるのは1回です。"));
  card.append(svg,t);sheet.append(card);
 }
}
async function issue(){
 const m=$("#issueMsg");m.textContent="";const n=Math.min(400,Math.max(1,+$("#n").value||0));
 if(!LIVE){m.textContent="サンプル表示では発行できません。";return}
 $("#issueBtn").disabled=true;
 try{
  const base=baseUrl(),toks=[...Array(n)].map(()=>hex(crypto.getRandomValues(new Uint8Array(16))));
  const writes=await Promise.all(toks.map(async t=>({update:{name:`${DOCS}/tickets/${await sha(t)}`,fields:{}},currentDocument:{exists:false}})));
  const r=await fetch(`${FS}:commit`,{method:"POST",headers:hdr(),body:JSON.stringify({writes})});
  if(!r.ok)throw new Error();
  const urls=toks.map(t=>`${base}#t=${t}`);$("#links").textContent=urls.join("\n");$("#linkDone").textContent=`リンクを${n}本作りました。この画面を閉じると、もう一度表示できません。`;buildSheet(urls);$("#linkBox").hidden=false;await load();
 }catch(e){m.textContent="発行できませんでした。"}
 $("#issueBtn").disabled=false;
}
$("#loginBtn").addEventListener("click",login);$("#setupBtn").addEventListener("click",setup);$("#changeBtn").addEventListener("click",changeLogin);$("#xlsxBtn").addEventListener("click",saveXlsx);$("#reloadBtn").addEventListener("click",()=>load());
$("#issueBtn").addEventListener("click",issue);$("#printBtn").addEventListener("click",()=>printWith("printCards"));$("#posterBtn").addEventListener("click",poster);$("#openBtn").addEventListener("click",toggleOpen);$("#copyBtn").addEventListener("click",()=>navigator.clipboard.writeText($("#links").textContent));
async function initLogin(){
 const r=await fetch(`${FS}/meta/setup?key=${CFG.apiKey}`).catch(()=>null);
 if(r&&r.status===404){$("#loginTitle").textContent="担当者の登録";$("#loginHint").hidden=false;$("#loginBox").hidden=true;$("#setupBox").hidden=false;$("#pass").autocomplete="new-password"}
 $("#login").hidden=false;
}
if(LIVE)initLogin();else{$("#sampleNote").hidden=false;$("#main").hidden=false;load()}
