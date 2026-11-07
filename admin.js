const CFG = window.SURVEY_CONFIG;
const PREVIEW = location.hash === "#preview";
const LIVE = !!(CFG.apiKey && CFG.projectId) && !PREVIEW;
const $ = selector => document.querySelector(selector);
const DOCS = `projects/${CFG.projectId}/databases/(default)/documents`;
const FS = `https://firestore.googleapis.com/v1/${DOCS}`;
const AUTH = "https://identitytoolkit.googleapis.com/v1/accounts";
let idToken = "", curUid = "", curId = "", refreshToken = "", expiresAt = 0;
let refreshPending = null, rows = [], accepting = false, loaded = false, changingOpen = false, authEpoch = 0;

async function request(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try { return await fetch(url, {...options, signal: controller.signal}); }
  finally { clearTimeout(timer); }
}
function rememberAuth(data, id = curId) {
  idToken = data.idToken || data.id_token;
  curUid = data.localId || data.user_id || curUid;
  refreshToken = data.refreshToken || data.refresh_token || refreshToken;
  expiresAt = Date.now() + Number(data.expiresIn || data.expires_in || 3600) * 1000;
  curId = id;
}
async function ensureToken() {
  if (Date.now() < expiresAt - 60000) return;
  if (!refreshToken) throw new Error("expired");
  if (!refreshPending) refreshPending = (async () => {
    const epoch = authEpoch;
    const response = await request(`https://securetoken.googleapis.com/v1/token?key=${CFG.apiKey}`, {
      method: "POST", headers: {"Content-Type": "application/x-www-form-urlencoded"},
      body: new URLSearchParams({grant_type: "refresh_token", refresh_token: refreshToken})
    });
    if (!response.ok) throw new Error("expired");
    const data = await response.json();
    if (epoch !== authEpoch) throw new Error("expired");
    rememberAuth(data);
  })().finally(() => { refreshPending = null; });
  await refreshPending;
}
const hdr = () => ({"Content-Type": "application/json", Authorization: `Bearer ${idToken}`});
const fromVal = value => "arrayValue" in value
  ? (value.arrayValue.values || []).map(item => item.stringValue) : value.stringValue;
async function listAll(collection) {
  const documents = [];
  let page = "";
  do {
    await ensureToken();
    const response = await request(`${FS}/${collection}?pageSize=300${page ? `&pageToken=${encodeURIComponent(page)}` : ""}`, {headers: hdr()});
    if (!response.ok) throw new Error(String(response.status));
    const data = await response.json();
    documents.push(...(data.documents || []));
    page = data.nextPageToken || "";
  } while (page);
  return documents;
}
const toEmail = id => `${id.toLowerCase()}@${CFG.projectId}.firebaseapp.com`;
const validId = id => /^[A-Za-z0-9._-]{3,30}$/.test(id);
async function authCall(path, body) {
  const response = await request(`${AUTH}:${path}?key=${CFG.apiKey}`, {
    method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(body)
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || "auth");
  return data;
}
async function fsCommit(writes, token) {
  if (!token) await ensureToken();
  const response = await request(`${FS}:commit`, {
    method: "POST",
    headers: {"Content-Type": "application/json", Authorization: `Bearer ${token || idToken}`},
    body: JSON.stringify({writes})
  });
  if (!response.ok) throw new Error("firestore");
}
const signInPw = (id, password) => authCall("signInWithPassword", {email: toEmail(id), password, returnSecureToken: true});
async function hasAdmin(data) {
  const response = await request(`${FS}/admins/${data.localId}`, {
    headers: {Authorization: `Bearer ${data.idToken}`}
  });
  if (response.status === 404) return false;
  if (!response.ok) throw new Error("firestore");
  return true;
}
function enter(data, id) {
  rememberAuth(data, id);
  $("#pass").value = "";
  $("#login").hidden = true;
  $("#main").hidden = false;
  buildCommonPreview();
  selectPanel("qrPanel");
}
async function login() {
  const message = $("#loginMsg"), id = $("#loginId").value.trim();
  message.textContent = "";
  if (!validId(id)) { message.textContent = "IDかパスワードが違います。"; return; }
  $("#loginBtn").disabled = true;
  try {
    const data = await signInPw(id, $("#pass").value);
    if (!await hasAdmin(data)) throw new Error("firestore");
    enter(data, id);
    await load();
  } catch (error) {
    message.textContent = error.message === "firestore"
      ? "担当者の権限を確認できませんでした。通信を確認してもう一度お試しください。"
      : "ログインできませんでした。ID・パスワードと通信状態をご確認ください。";
  } finally { $("#loginBtn").disabled = false; }
}
async function setup() {
  const message = $("#loginMsg"), id = $("#loginId").value.trim(), password = $("#pass").value;
  message.textContent = "";
  if (!validId(id)) { message.textContent = "IDは英数字と . _ - の3〜30文字で決めてください。"; return; }
  if (password.length < 8) { message.textContent = "パスワードは8文字以上にしてください。"; return; }
  $("#setupBtn").disabled = true;
  try {
    let data;
    try { data = await authCall("signUp", {email: toEmail(id), password, returnSecureToken: true}); }
    catch (error) {
      if (error.message !== "EMAIL_EXISTS") throw error;
      data = await signInPw(id, password);
    }
    if (!await hasAdmin(data)) {
      try {
        await fsCommit([
          {update: {name: `${DOCS}/admins/${data.localId}`, fields: {}}, currentDocument: {exists: false}},
          {update: {name: `${DOCS}/meta/setup`, fields: {}}, currentDocument: {exists: false}}
        ], data.idToken);
      } catch (error) {
        if (!await hasAdmin(data)) throw error;
      }
    }
    enter(data, id);
    await load();
  } catch {
    message.textContent = "登録結果を確認できません。通信を確認して同じID・パスワードでもう一度お試しください。登録済みの場合はログインできます。";
  } finally { $("#setupBtn").disabled = false; }
}
async function changeLogin() {
  const message = $("#changeMsg"), current = $("#curPass").value;
  const newId = $("#newId").value.trim(), password = $("#newPass").value;
  message.textContent = "";
  if (!LIVE) { message.textContent = "見本ではID・パスワードの変更は行いません。"; return; }
  if (!current) { message.textContent = "現在のパスワードを入れてください。"; return; }
  if (!newId && !password) { message.textContent = "新しいIDかパスワードを入れてください。"; return; }
  if (newId && !validId(newId)) { message.textContent = "IDは英数字と . _ - の3〜30文字にしてください。"; return; }
  if (password && password.length < 8) { message.textContent = "パスワードは8文字以上にしてください。"; return; }
  if (password !== $("#newPass2").value) { message.textContent = "確認欄のパスワードが一致しません。"; return; }
  const changeId = newId && toEmail(newId) !== toEmail(curId);
  if (!changeId && !password) { message.textContent = "今と同じIDです。"; return; }
  $("#changeBtn").disabled = true;
  let stage = "current";
  try {
    const old = await signInPw(curId, current);
    rememberAuth(old);
    stage = "change";
    if (changeId) {
      let next;
      try { next = await authCall("signUp", {email: toEmail(newId), password: password || current, returnSecureToken: true}); }
      catch (error) {
        if (error.message !== "EMAIL_EXISTS") throw error;
        // 前回の通信切断で作成済みの場合も、同じパスワードで再開する。
        next = await signInPw(newId, password || current);
        if (await hasAdmin(next)) throw new Error("id-in-use");
      }
      try {
        await fsCommit([
          {update: {name: `${DOCS}/admins/${next.localId}`, fields: {}}, currentDocument: {exists: false}},
          {delete: `${DOCS}/admins/${old.localId}`, currentDocument: {exists: true}}
        ], old.idToken);
      } catch (error) {
        if (!await hasAdmin(next)) throw error;
      }
      rememberAuth(next, newId);
      // 権限移行を確認した後だけ、旧アカウントを整理する。
      await authCall("delete", {idToken: old.idToken}).catch(() => {});
    } else {
      const data = await authCall("update", {idToken: old.idToken, password, returnSecureToken: true});
      rememberAuth(data);
    }
    for (const selector of ["#curPass", "#newId", "#newPass", "#newPass2"]) $(selector).value = "";
    message.textContent = changeId ? "変更しました。次回から新しいIDでログインしてください。" : "パスワードを変更しました。";
  } catch (error) {
    message.textContent = stage === "current" ? "現在のパスワードと通信状態をご確認ください。"
      : error.message === "id-in-use" ? "このIDはすでに使われています。別のIDをお選びください。"
        : "変更結果を確認できません。通信を確認してください。IDを変えた場合は新しいID、パスワードを変えた場合は新しいパスワードでログインをお試しください。";
  } finally { $("#changeBtn").disabled = false; }
}
function logout() {
  authEpoch++;
  idToken = ""; refreshToken = ""; curUid = ""; curId = ""; expiresAt = 0; rows = []; loaded = false;
  $("#result").textContent = "";
  $("#main").hidden = true;
  $("#login").hidden = false;
  $("#loginId").focus();
}
async function load() {
  const epoch = authEpoch;
  $("#reloadBtn").disabled = true;
  $("#mainMsg").textContent = "";
  try {
    if (LIVE) {
      const documents = await listAll("responses");
      await loadOpen();
      if (epoch !== authEpoch) return;
      rows = documents.map(document => Object.fromEntries(Object.entries(document.fields || {}).map(([key, value]) => [key, fromVal(value)])));
    } else {
      rows = sample();
      drawOpen();
    }
    loaded = true;
    draw();
    $("#updatedAt").textContent = `最終更新 ${new Date().toLocaleString("ja-JP")}`;
  } catch {
    if (epoch !== authEpoch) return;
    $("#mainMsg").textContent = "最新の情報を取得できませんでした。通信を確認して「最新にする」を押してください。再度失敗する場合はログインし直してください。";
  } finally {
    if (epoch === authEpoch) {
      $("#reloadBtn").disabled = false;
      $("#xlsxBtn").disabled = !loaded;
      $("#rawXlsxBtn").disabled = !loaded;
    }
  }
}
function sample(){
 let seed=7;const rnd=n=>{seed=(seed*16807)%2147483647;return seed%n};const out=[];
 for(let i=0;i<24;i++){const a={};
  for(const q of QUESTIONS)for(const p of q.parts){
   if((q.showIf&&!q.showIf(a))||(p.showIf&&!p.showIf(a)))continue;
   if(p.type==="single"&&rnd(9))a[p.id]=p.options[Math.min(rnd(p.options.length),rnd(p.options.length))];
   if(p.type==="multi"&&rnd(3)){const x=p.options.filter(o=>o!=="その他"&&!(p.exclusive||[]).includes(o)&&!rnd(3));if(x.length)a[p.id]=x}
  }
  if(!rnd(3))a.q8a="（サンプル）丁寧に教えてもらえて、子供が楽しそうに通っています。";
  if(!rnd(4))a.q8b="（サンプル）練習内容を保護者にも共有してもらえると助かります。";
  out.push(a)}
 return out;
}

const flat = () => QUESTIONS.flatMap(question => question.parts.map(part => ({q: question, p: part})));
const fullTitle = ({q, p}) => `問${q.no} ${p.label || q.title}`;
function tally(part) {
  const eligible = rows.filter(row => {
    const question = QUESTIONS.find(item => item.parts.includes(part));
    return (!question.showIf || question.showIf(row)) && (!part.showIf || part.showIf(row));
  });
  const valid = eligible.filter(row => part.type === "single"
    ? part.options.includes(row[part.id])
    : Array.isArray(row[part.id]) && row[part.id].some(option => part.options.includes(option)));
  const n = valid.length;
  return {n, eligible: eligible.length, items: part.options.map(option => {
    const count = valid.filter(row => [].concat(row[part.id]).includes(option)).length;
    return {o: option, c: count, pct: n ? Math.round(count / n * 1000) / 10 : 0};
  })};
}
function el(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}
function draw() {
  $("#sAns").textContent = rows.length;
  const root = $("#result");
  root.textContent = "";
  for (const item of flat()) {
    const {p} = item, card = el("section", "card");
    card.append(el("h2", "plain", fullTitle(item)));
    if (p.type === "text") {
      const texts = rows.map(row => row[p.id]).filter(value => typeof value === "string" && value.trim());
      const details = el("details");
      details.append(el("summary", "", `自由記述 ${texts.length}件を表示（担当者用）`));
      texts.forEach(text => details.append(el("p", "quote", text)));
      card.append(details);
    } else {
      const result = tally(p);
      card.append(el("p", "hint", `有効回答 ${result.n}件 ／ 対象 ${result.eligible}件 ／ 未回答 ${result.eligible - result.n}件`));
      if (p.type === "multi") card.append(el("p", "hint", "複数回答のため、割合の合計は100%を超える場合があります。"));
      for (const count of result.items) {
        const bar = el("div", "bar"), label = el("div", "barText");
        label.append(el("span", "", count.o), el("span", "", `${count.c}件 ${count.pct}%`));
        const track = el("div", "track"), fill = el("div", "fill");
        fill.style.width = `${count.pct}%`;
        track.append(fill); bar.append(label, track); card.append(bar);
      }
      if (p.other) {
        const texts = rows.map(row => row[p.other]).filter(value => typeof value === "string" && value.trim());
        if (texts.length) {
          const details = el("details");
          details.append(el("summary", "", `「その他」の原文 ${texts.length}件を表示（担当者用）`));
          texts.forEach(text => details.append(el("p", "quote", text)));
          card.append(details);
        }
      }
    }
    root.append(card);
  }
}
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

function saveXlsx(includeRaw = false) {
  if (!loaded) return;
  if (includeRaw && !confirm("自由記述の原文を含む、担当者用のファイルを保存します。関係者に配布する場合は「共有用の集計」をお使いください。")) return;
  let table, sheetName, filename;
  if (includeRaw) {
    const columns = flat().flatMap(item => [{key: item.p.id, title: fullTitle(item)}].concat(
      item.p.other ? [{key: item.p.other, title: fullTitle(item) + "（その他の内容）"}] : []
    ));
    table = [columns.map(column => column.title), ...rows.map(row => columns.map(column => [].concat(row[column.key] ?? []).join("、")))];
    sheetName = "担当者用回答原文";
    filename = "保護者アンケート_担当者用回答原文.xlsx";
  } else {
    table = [
      ["保護者アンケート・共有用集計", "回答総数", rows.length],
      ["割合は各項目の有効回答数を分母とします。複数回答の合計は100%を超える場合があります。"],
      ["質問", "選択肢", "件数", "割合(%)", "有効回答数", "対象者数", "未回答数"]
    ];
    for (const item of flat()) if (item.p.options) {
      const result = tally(item.p);
      for (const count of result.items) table.push([fullTitle(item), count.o, count.c, count.pct, result.n, result.eligible, result.eligible - result.n]);
    }
    sheetName = "共有用集計"; filename = "保護者アンケート_共有用集計.xlsx";
  }
  const blob = zip([
    ["[Content_Types].xml", '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>'],
    ["_rels/.rels", '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
    ["xl/workbook.xml", `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${sheetName}" sheetId="1" r:id="rId1"/></sheets></workbook>`],
    ["xl/_rels/workbook.xml.rels", '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'],
    ["xl/worksheets/sheet1.xml", sheet(table)]
  ]);
  const link = el("a"), url = URL.createObjectURL(blob);
  link.href = url; link.download = filename; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const baseUrl = () => new URL("./", location.href).href;
const commonUrl = () => `${baseUrl()}#open`;
function qrSvg(text) {
  const ns = "http://www.w3.org/2000/svg", path = QR.toPath(QR.encode(text));
  const svg = document.createElementNS(ns, "svg"), shape = document.createElementNS(ns, "path");
  svg.setAttribute("viewBox", `0 0 ${path.size} ${path.size}`);
  svg.setAttribute("class", "qrCode"); svg.setAttribute("shape-rendering", "crispEdges");
  svg.setAttribute("role", "img"); svg.setAttribute("aria-label", "アンケート回答用QRコード");
  shape.setAttribute("d", path.d); shape.setAttribute("fill", "#000"); svg.append(shape);
  return svg;
}
function buildCommonPreview() {
  $("#commonQr").replaceChildren(qrSvg(commonUrl()));
  $("#commonLink").value = commonUrl();
}
function printWith(className) {
  document.body.classList.remove("printCards", "printPoster");
  document.body.classList.add(className);
  addEventListener("afterprint", () => document.body.classList.remove(className), {once: true});
  window.print();
}
function poster() {
  const sheet = $("#posterSheet"); sheet.textContent = "";
  sheet.append(
    el("p", "posterSub", "保護者の皆様へ"), el("h2", "posterTitle", "アンケートにご協力ください"),
    el("p", "posterLead", "子供たちが水泳を続けられる環境についてのアンケートです。"),
    qrSvg(commonUrl()), el("p", "posterHow", "スマートフォンのカメラで読み取ってください"),
    el("p", "posterNote", "無記名・任意回答です。回答は1人1回でお願いします。")
  );
  printWith("printPoster");
}
function smallCards() {
  const sheet = $("#qrSheet"); sheet.textContent = "";
  for (let index = 0; index < 8; index++) {
    const card = el("div", "qrCard"), text = el("div", "qrText");
    text.append(el("b", "", "保護者アンケート"), el("p", "", "子供たちが水泳を続けられる環境について"),
      el("p", "", "スマートフォンのカメラで読み取ってください。"), el("p", "", "無記名・任意回答です。回答は1人1回でお願いします。"));
    card.append(qrSvg(commonUrl()), text); sheet.append(card);
  }
  printWith("printCards");
}
async function loadOpen() {
  const response = await request(`${FS}/meta/open?key=${CFG.apiKey}`);
  if (!response.ok && response.status !== 404) throw new Error("network");
  accepting = response.ok; drawOpen();
}
function drawOpen() {
  $("#openState").textContent = accepting ? "回答を受付中です" : "回答を受け付けていません";
  $("#openState").classList.toggle("isOpen", accepting);
  $("#sState").textContent = accepting ? "受付中" : "受付停止";
  $("#openBtn").textContent = accepting ? "回答の受付を締め切る" : "回答の受付を始める";
  $("#openBtn").disabled = changingOpen;
}
async function toggleOpen() {
  if (changingOpen) return;
  const target = !accepting;
  changingOpen = true;
  const message = $("#openMsg"); message.textContent = ""; $("#openBtn").disabled = true;
  try {
    if (LIVE) {
      await loadOpen();
      if (accepting !== target) await fsCommit([target ? {update: {name: `${DOCS}/meta/open`, fields: {}}, currentDocument: {exists: false}}
        : {delete: `${DOCS}/meta/open`, currentDocument: {exists: true}}]);
      await loadOpen();
      if (accepting !== target) throw new Error("conflict");
    } else { accepting = !accepting; drawOpen(); }
  } catch {
    try { if (LIVE) await loadOpen(); } catch {}
    message.textContent = "変更結果を確認できませんでした。現在の表示を確認し、通信が安定してからもう一度お試しください。";
  } finally { changingOpen = false; $("#openBtn").disabled = false; }
}
function selectPanel(id) {
  for (const panel of document.querySelectorAll("[data-panel]")) panel.hidden = panel.id !== id;
  for (const tab of document.querySelectorAll("[data-tab]")) {
    const active = tab.dataset.tab === id;
    tab.setAttribute("aria-selected", String(active)); tab.tabIndex = active ? 0 : -1;
  }
}
for (const tab of document.querySelectorAll("[data-tab]")) {
  tab.addEventListener("click", () => { selectPanel(tab.dataset.tab); scrollTo({top: 0, behavior: "smooth"}); });
  tab.addEventListener("keydown", event => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const tabs = [...document.querySelectorAll("[data-tab]")], index = tabs.indexOf(tab);
    const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1
      : (index + (event.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length;
    selectPanel(tabs[next].dataset.tab); tabs[next].focus();
  });
}
$("#loginBtn").addEventListener("click", login);
$("#setupBtn").addEventListener("click", setup);
$("#pass").addEventListener("keydown", event => { if (event.key === "Enter") ($("#setupBox").hidden ? login() : setup()); });
$("#changeBtn").addEventListener("click", changeLogin);
$("#logoutBtn").addEventListener("click", logout);
$("#xlsxBtn").addEventListener("click", () => saveXlsx());
$("#rawXlsxBtn").addEventListener("click", () => saveXlsx(true));
$("#reloadBtn").addEventListener("click", load);
$("#posterBtn").addEventListener("click", poster);
$("#smallQrBtn").addEventListener("click", smallCards);
$("#openBtn").addEventListener("click", toggleOpen);
$("#copyCommonBtn").addEventListener("click", async () => {
  try { await navigator.clipboard.writeText(commonUrl()); $("#copyMsg").textContent = "回答用リンクをコピーしました。"; }
  catch { $("#commonLink").focus(); $("#commonLink").select(); $("#copyMsg").textContent = "リンクを長押ししてコピーしてください。"; }
});
async function initLogin() {
  try {
    const response = await request(`${FS}/meta/setup?key=${CFG.apiKey}`);
    if (response.status === 404) {
      $("#loginTitle").textContent = "担当者の登録"; $("#loginHint").hidden = false;
      $("#loginBox").hidden = true; $("#setupBox").hidden = false; $("#pass").autocomplete = "new-password";
    } else if (!response.ok) throw new Error("network");
  } catch { $("#loginMsg").textContent = "通信状態を確認してからログインしてください。"; }
  $("#login").hidden = false;
}
if (LIVE) initLogin();
else {
  $("#sampleNote").hidden = false; $("#main").hidden = false;
  $("#logoutBtn").hidden = true; buildCommonPreview(); selectPanel("qrPanel"); load();
}
