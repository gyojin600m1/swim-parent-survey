const CFG = window.SURVEY_CONFIG;
const PREVIEW = location.hash === "#preview";
const OPEN = location.hash === "#open";
const LIVE = !!(CFG.apiKey && CFG.projectId) && !PREVIEW;
const $ = selector => document.querySelector(selector);
const DOCS = `projects/${CFG.projectId}/databases/(default)/documents`;
const FS = `https://firestore.googleapis.com/v1/${DOCS}`;
const PREFIX = `${CFG.projectId}:parent-survey`;
const DONE = `${PREFIX}:done`;
const VOTER = `${PREFIX}:voter`;
const answers = {};
const token = new URLSearchParams(location.hash.slice(1)).get("t") || "";
const hex = bytes => [...new Uint8Array(bytes)].map(value => value.toString(16).padStart(2, "0")).join("");
const sha = async value => hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
const rand = size => hex(crypto.getRandomValues(new Uint8Array(size)));
const sessionKey = hash => `${PREFIX}:session:${hash}`;
const draftKey = hash => `${PREFIX}:draft:${hash}`;
let session = null;

async function request(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    return await fetch(url, {...options, signal: controller.signal});
  } finally {
    clearTimeout(timer);
  }
}
function stored(key) {
  try { return JSON.parse(localStorage.getItem(key) || "null"); }
  catch { return null; }
}
function saveSession(value) {
  try {
    localStorage.setItem(sessionKey(value.t), JSON.stringify(value));
    if (OPEN) localStorage.setItem(VOTER, JSON.stringify({
      uid: value.uid, idToken: value.idToken, refreshToken: value.refreshToken
    }));
  } catch {
    throw new Error("storage");
  }
}
function removeStored(key) {
  try { localStorage.removeItem(key); } catch {}
}
async function isOpen() {
  const response = await request(`${FS}/meta/open?key=${CFG.apiKey}`);
  if (response.status === 404) return false;
  if (!response.ok) throw new Error("network");
  return true;
}
const toValue = value => Array.isArray(value)
  ? {arrayValue: {values: value.map(item => ({stringValue: item}))}}
  : typeof value === "number" ? {integerValue: String(value)} : {stringValue: String(value)};
const fields = object => Object.fromEntries(Object.entries(object).map(([key, value]) => [key, toValue(value)]));
async function commit(writes, idToken) {
  const response = await request(`${FS}:commit`, {
    method: "POST",
    headers: {"Content-Type": "application/json", Authorization: `Bearer ${idToken}`},
    body: JSON.stringify({writes})
  });
  if (!response.ok) throw new Error([403, 409].includes(response.status) ? "denied" : "network");
}
async function signIn() {
  const response = await request(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${CFG.apiKey}`, {
    method: "POST", headers: {"Content-Type": "application/json"},
    body: JSON.stringify({returnSecureToken: true})
  });
  if (!response.ok) throw new Error("network");
  const data = await response.json();
  return {uid: data.localId, idToken: data.idToken, refreshToken: data.refreshToken};
}
async function refresh(value) {
  const response = await request(`https://securetoken.googleapis.com/v1/token?key=${CFG.apiKey}`, {
    method: "POST", headers: {"Content-Type": "application/x-www-form-urlencoded"},
    body: new URLSearchParams({grant_type: "refresh_token", refresh_token: value.refreshToken})
  });
  if (!response.ok) throw new Error(response.status === 400 ? "expired" : "network");
  const data = await response.json();
  value.idToken = data.id_token;
  value.refreshToken = data.refresh_token;
  saveSession(value);
}
async function ownDocument(collection, value) {
  const response = await request(`${FS}/${collection}/${value.uid}`, {
    headers: {Authorization: `Bearer ${value.idToken}`}
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error("network");
  return response.json();
}
async function completed(value) {
  return !!await ownDocument("participants", value);
}
function saveDraft() {
  if (!session || !LIVE) return;
  try { sessionStorage.setItem(draftKey(session.t), JSON.stringify(answers)); } catch {}
}
function restoreDraft() {
  let draft;
  try { draft = JSON.parse(sessionStorage.getItem(draftKey(session.t)) || "null"); } catch {}
  if (!draft || typeof draft !== "object" || Array.isArray(draft)) return;
  for (const question of QUESTIONS) for (const part of question.parts) {
    const value = draft[part.id];
    if (part.type === "single" && part.options.includes(value)) answers[part.id] = value;
    if (part.type === "multi" && Array.isArray(value)) {
      const selected = [...new Set(value.filter(item => part.options.includes(item)))];
      const exclusive = selected.find(item => (part.exclusive || []).includes(item));
      if (selected.length) answers[part.id] = exclusive ? [exclusive] : selected;
    }
    if (part.type === "text" && typeof value === "string" && value.trim()) answers[part.id] = value.slice(0, 2000);
    if (part.other && typeof draft[part.other] === "string") answers[part.other] = draft[part.other].slice(0, 200);
  }
  for (const input of document.querySelectorAll("#questions input,#questions textarea")) {
    if (input.type === "radio") input.checked = answers[input.name] === input.value;
    if (input.type === "text") input.value = answers[input.closest("[data-other]").dataset.other] || "";
    if (input.tagName === "TEXTAREA") input.value = answers[input.closest("[data-part]").dataset.part] || "";
  }
  sync();
}
function finish() {
  if (LIVE && session) {
    if (OPEN) {
      try { localStorage.setItem(DONE, "1"); } catch {}
    }
    removeStored(sessionKey(session.t));
    const legacy = stored("survey-session");
    if (legacy?.uid === session.uid) removeStored("survey-session");
    try { sessionStorage.removeItem(draftKey(session.t)); } catch {}
    history.replaceState(null, "", location.pathname + (OPEN ? "#open" : ""));
  }
  show("#done");
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
    const t=document.createElement("textarea");t.maxLength=2000;t.placeholder="ここに入力してください（空欄でも構いません）";t.setAttribute("aria-label",part.label);t.addEventListener("input",()=>{const v=t.value.trim();if(v)answers[part.id]=t.value;else delete answers[part.id]});d.append(t);
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
 document.querySelectorAll("[data-jump]").forEach(button=>{button.hidden=document.querySelector(`[data-q="${button.dataset.jump}"]`).hidden});
 document.querySelectorAll(".opt").forEach(l=>l.classList.toggle("on",l.querySelector("input").checked));
 document.querySelectorAll('.opt input[type=checkbox]').forEach(i=>{const a=answers[i.name];i.checked=!!a&&a.includes(i.value);i.closest(".opt").classList.toggle("on",i.checked)});
}
async function start() {
  const button = $("#startBtn"), message = $("#startMsg");
  message.textContent = "";
  button.disabled = true;
  button.textContent = "確認しています…";
  try {
    if (LIVE) {
      if (OPEN && (stored(DONE) || stored("survey-done"))) {
        block("回答済みです", "このブラウザからは、すでに回答をいただいています。ご協力ありがとうございました。");
        return;
      }
      const hash = OPEN ? "open" : await sha(token);
      let value = stored(sessionKey(hash));
      const legacy = stored("survey-session");
      if (!value && legacy?.t === hash) value = legacy;
      const identity = OPEN ? stored(VOTER) : null;
      const accepting = await isOpen();
      if (!accepting && !value?.uid && !identity?.uid) {
        block("現在、回答を受け付けていません", "受付期間中にもう一度お試しください。");
        return;
      }
      if (!value?.uid || !value.refreshToken || !/^[0-9a-f]{32}$/.test(value.r || "")) {
        value = {...(identity?.uid && identity.refreshToken ? identity : await signIn()), t: hash, r: rand(16), v: 2};
      }
      // 通信の結果が不明でも、同じ匿名IDで再開できるよう先に保存する。
      saveSession(value);
      await refresh(value);
      session = value;
      if (await completed(value)) { finish(); return; }
      if (!accepting) {
        block("現在、回答を受け付けていません", "受付期間中にもう一度お試しください。入力途中の内容はこのタブに残っています。");
        return;
      }
      let claim = await ownDocument("claims", value);
      if (!claim) {
        try {
          await commit([{
            update: {name: `${DOCS}/claims/${value.uid}`, fields: fields({t: hash, r: value.r, v: 2})},
            currentDocument: {exists: false}
          }], value.idToken);
        } catch (error) {
          if (await completed(value)) { finish(); return; }
          claim = await ownDocument("claims", value);
          if (!claim) throw error;
        }
      }
      if (claim) {
        if (claim.fields?.t?.stringValue !== hash) throw new Error("denied");
        value.r = claim.fields.r.stringValue;
        value.v = claim.fields.v ? Number(claim.fields.v.integerValue) : 1;
      } else {
        value.v = 2;
      }
      saveSession(value);
      restoreDraft();
    }
    show("#form");
  } catch (error) {
    if (error.message === "denied") {
      let accepting = null;
      try { accepting = await isOpen(); } catch {}
      if (accepting === false) block("現在、回答を受け付けていません", "受付期間中にもう一度お試しください。");
      else message.textContent = "このリンクは使用済みか、現在ご利用いただけません。最新のQRコードから開き直してください。";
    } else {
      message.textContent = error.message === "storage"
        ? "回答の再開に必要な情報を保存できません。スマートフォンの標準ブラウザで開き直してください。"
        : error.message === "expired"
          ? "回答の再開情報を確認できませんでした。担当者へお問い合わせください。"
          : "通信を確認できませんでした。電波の良い場所でもう一度押してください。";
    }
  } finally {
    button.disabled = false;
    button.textContent = "回答を始める・再開する";
  }
}
async function submit() {
  const button = $("#sendBtn"), message = $("#sendMsg");
  message.textContent = "";
  if (!Object.keys(answers).length) { message.textContent = "1問以上お答えください。"; return; }
  button.disabled = true;
  button.textContent = "送信しています…";
  saveDraft();
  try {
    if (LIVE) {
      await refresh(session);
      if (await completed(session)) { finish(); return; }
      if (!await isOpen()) throw new Error("closed");
      const writes = [
        {update: {name: `${DOCS}/responses/${session.r}`, fields: fields(answers)}, currentDocument: {exists: false}},
        {delete: `${DOCS}/claims/${session.uid}`, currentDocument: {exists: true}},
        {update: {name: `${DOCS}/participants/${session.uid}`, fields: {}}, currentDocument: {exists: false}}
      ];
      if (session.t !== "open" && session.v === 2) writes.push({
        update: {name: `${DOCS}/used/${session.t}`, fields: {}}, currentDocument: {exists: false}
      });
      try {
        await commit(writes, session.idToken);
      } catch (error) {
        if (!await completed(session)) throw error;
      }
    }
    finish();
  } catch (error) {
    let accepting = null;
    if (LIVE) { try { accepting = await isOpen(); } catch {} }
    message.textContent = error.message === "closed" || accepting === false
      ? "回答の受付が締め切られました。入力内容はこのタブに残しています。再開された場合は、もう一度送信できます。"
      : error.message === "denied"
        ? "送信結果を確認できませんでした。入力内容を残したまま、もう一度押してください。改善しない場合は担当者へお問い合わせください。"
        : "通信を確認できませんでした。入力内容は残っています。電波の良い場所でもう一度押すと、保存済みか確認してから送信します。";
  } finally {
    button.disabled = false;
    button.textContent = "回答を送信する";
  }
}
render();
$("#startBtn").addEventListener("click", start);
$("#sendBtn").addEventListener("click", submit);
$("#questions").addEventListener("input", saveDraft);
$("#questions").addEventListener("click", saveDraft);
for (const question of QUESTIONS) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "questionJump";
  button.textContent = `問${question.no}`;
  button.dataset.jump = question.no;
  button.addEventListener("click", () => document.querySelector(`[data-q="${question.no}"]`).scrollIntoView({behavior: "smooth", block: "start"}));
  $("#questionNav").append(button);
}
$("#reviewBtn").addEventListener("click", () => $("#submitCard").scrollIntoView({behavior: "smooth", block: "start"}));
sync();
if (!LIVE) $("#previewNote").hidden = false;
else if (!token && !OPEN) block("QRコードからお入りください", "お手元のQRコード、または届いた回答用リンクから開いてください。");
