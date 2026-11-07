// 回答内容や匿名IDを送らず、1ブラウザにつき1日1回だけ閲覧数を加算する。
(async () => {
  if (location.hash === "#preview") return;
  const namespace = "swim-parent-survey-2026";
  const key = namespace + ":views:" + new Date().toLocaleDateString("ja-JP");
  try {
    const counted = localStorage.getItem(key);
    const response = await fetch(`https://abacus.jasoncameron.dev/${counted ? "get" : "hit"}/${namespace}/views`, {
      referrerPolicy: "no-referrer", signal: AbortSignal.timeout(5000)
    });
    if (!response.ok) return;
    const data = await response.json();
    if (!Number.isFinite(data.value)) return;
    localStorage.setItem(key, "1");
    const element = document.querySelector("#viewCount");
    element.textContent = `閲覧 ${data.value.toLocaleString("ja-JP")}回`;
    element.hidden = false;
  } catch {}
})();
