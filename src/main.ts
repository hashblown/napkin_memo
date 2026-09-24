import "./style.css";
import { store, settings, type Memo } from "./store";
import { classifyLocally, inspireLocally } from "./local";
import { classify, inspire, describeError } from "./ai";

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

const PRESETS = [
  "글이 막힐 때",
  "기획 회의 전",
  "새 프로젝트를 시작할 때",
  "마음이 지칠 때",
  "산책하며 생각 정리",
  "아무거나 꺼내줘",
];

// ---------- 공통 ----------

function toast(msg: string) {
  const el = $("#toast");
  el.textContent = msg;
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 2200);
}

function esc(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function when(ts: number) {
  const d = new Date(ts);
  const diff = (Date.now() - ts) / 60000;
  if (diff < 1) return "방금";
  if (diff < 60) return `${Math.floor(diff)}분 전`;
  if (diff < 60 * 24) return `${Math.floor(diff / 60)}시간 전`;
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function memoItem(m: Memo, reason?: string) {
  const cat = m.classifiedBy === "pending" ? `<span class="cat pending">분류 중…</span>` : `<button class="cat" data-recat="${m.id}">${esc(m.category)}</button>`;
  const tags = m.tags.map((t) => `<span class="tag">#${esc(t)}</span>`).join("");
  return `<li class="memo">
    <p>${esc(m.text)}</p>
    ${reason ? `<p class="reason">${esc(reason)}</p>` : ""}
    <div class="meta">${cat}${tags}<span class="time">${when(m.createdAt)}</span>
      <button class="del" data-del="${m.id}" aria-label="삭제">×</button></div>
  </li>`;
}

document.addEventListener("click", (e) => {
  const t = e.target as HTMLElement;
  const del = t.dataset.del;
  if (del && confirm("이 메모를 지울까요?")) store.remove(del);
  const recat = t.dataset.recat;
  if (recat) {
    const next = prompt("분류 이름", store.get(recat)?.category)?.trim();
    if (next) store.update(recat, { category: next, classifiedBy: "ai" });
  }
});

// ---------- 탭 ----------

function show(tab: string) {
  document.querySelectorAll<HTMLElement>(".tabs button").forEach((b) => b.classList.toggle("on", b.dataset.tab === tab));
  document.querySelectorAll<HTMLElement>(".panel").forEach((p) => p.classList.toggle("on", p.id === tab));
  if (tab === "write") $("#napkin").focus();
  if (tab === "settings") $<HTMLInputElement>("#apikey").value = settings.get().apiKey;
}
document.querySelectorAll<HTMLElement>(".tabs button").forEach((b) => b.addEventListener("click", () => show(b.dataset.tab!)));

// ---------- 적기 + 자동 분류 ----------

async function runClassify(m: Memo) {
  const { apiKey } = settings.get();
  if (apiKey && navigator.onLine) {
    try {
      const existing = store.categories().filter((c) => c !== "미분류");
      const r = await classify(apiKey, m.text, existing);
      store.update(m.id, { ...r, classifiedBy: "ai" });
      return;
    } catch (e) {
      toast(`AI 분류 실패: ${describeError(e)} → 기기 규칙으로 분류`);
    }
  }
  store.update(m.id, { ...classifyLocally(m.text), classifiedBy: "local" });
}

function save(text: string) {
  const clean = text.trim();
  if (!clean) return;
  const m = store.add(clean);
  void runClassify(m);
}

const napkin = $<HTMLTextAreaElement>("#napkin");
napkin.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    $<HTMLFormElement>("#capture").requestSubmit();
  }
});
$<HTMLFormElement>("#capture").addEventListener("submit", (e) => {
  e.preventDefault();
  save(napkin.value);
  napkin.value = "";
  napkin.focus();
});

// ---------- 서랍 ----------

let activeCat = "";

function renderDrawer() {
  const q = $<HTMLInputElement>("#search").value.trim().toLowerCase();
  const cats = store.categories();
  if (activeCat && !cats.includes(activeCat)) activeCat = "";
  $("#cats").innerHTML = ["", ...cats]
    .map((c) => `<button class="chip ${c === activeCat ? "on" : ""}" data-cat="${esc(c)}">${c ? esc(c) : "전체"}</button>`)
    .join("");
  const list = store.all().filter(
    (m) =>
      (!activeCat || m.category === activeCat) &&
      (!q || [m.text, m.category, ...m.tags, ...m.useWhen].join(" ").toLowerCase().includes(q)),
  );
  $("#list").innerHTML = list.map((m) => memoItem(m)).join("") || `<li class="empty">아직 비어 있어요.</li>`;
}
$("#cats").addEventListener("click", (e) => {
  const c = (e.target as HTMLElement).dataset.cat;
  if (c !== undefined) {
    activeCat = c;
    renderDrawer();
  }
});
$("#search").addEventListener("input", renderDrawer);

// ---------- 영감 ----------

$("#presets").innerHTML = PRESETS.map((p) => `<button class="chip" data-preset="${esc(p)}">${esc(p)}</button>`).join("");
$("#presets").addEventListener("click", (e) => {
  const p = (e.target as HTMLElement).dataset.preset;
  if (p) {
    $<HTMLInputElement>("#situation").value = p;
    void runInspire(p);
  }
});
$<HTMLFormElement>("#ask").addEventListener("submit", (e) => {
  e.preventDefault();
  void runInspire($<HTMLInputElement>("#situation").value.trim() || "아무거나 꺼내줘");
});

async function runInspire(situation: string) {
  const memos = store.all();
  if (!memos.length) {
    $("#spark").innerHTML = `<p class="muted">먼저 몇 가지 적어두면 여기서 꺼내드릴게요.</p>`;
    $("#picks").innerHTML = "";
    return;
  }
  const { apiKey } = settings.get();
  $("#spark").innerHTML = `<p class="muted">냅킨 더미를 뒤적이는 중…</p>`;
  $("#picks").innerHTML = "";
  if (apiKey && navigator.onLine) {
    try {
      const r = await inspire(apiKey, situation, memos);
      $("#spark").innerHTML = `<div class="spark">💡 ${esc(r.spark)}</div>`;
      $("#picks").innerHTML = r.picks.map((p) => memoItem(p.memo, p.reason)).join("");
      return;
    } catch (e) {
      toast(`AI 실패: ${describeError(e)} → 기기 안에서 찾을게요`);
    }
  }
  const picks = inspireLocally(situation, memos);
  $("#spark").innerHTML = `<p class="muted">이런 메모들이 있었어요.</p>`;
  $("#picks").innerHTML = picks.map((p) => memoItem(p.memo, p.reason)).join("");
}

// ---------- 설정 ----------

$<HTMLFormElement>("#keyform").addEventListener("submit", (e) => {
  e.preventDefault();
  settings.set({ apiKey: $<HTMLInputElement>("#apikey").value.trim() });
  toast("저장했어요");
});
$("#reclassify").addEventListener("click", async () => {
  if (!settings.get().apiKey) return toast("먼저 API 키를 넣어주세요");
  const targets = store.all().filter((m) => m.classifiedBy !== "ai");
  toast(`${targets.length}개 다시 분류 중…`);
  for (const m of targets) await runClassify(m);
  toast("다시 분류했어요");
});
$("#export").addEventListener("click", () => {
  const url = URL.createObjectURL(new Blob([store.exportJson()], { type: "application/json" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: `napkin-${new Date().toISOString().slice(0, 10)}.json` });
  a.click();
  URL.revokeObjectURL(url);
});
$<HTMLInputElement>("#import").addEventListener("change", async (e) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  try {
    toast(`${store.importJson(await file.text())}개 가져왔어요`);
  } catch {
    toast("파일을 읽지 못했어요");
  }
});

// ---------- 렌더 ----------

function render() {
  $("#recent").innerHTML = store
    .all()
    .slice(0, document.body.classList.contains("widget") ? 3 : 8)
    .map((m) => memoItem(m))
    .join("");
  renderDrawer();
}
store.subscribe(render);
render();

// ---------- 시작 옵션: ?widget, ?q=… ----------

const params = new URLSearchParams(location.search);
if (params.has("widget")) document.body.classList.add("widget");
// 저장만 되고 분류가 끝나기 전에 창이 닫힌 메모 이어서 분류
store.all().filter((m) => m.classifiedBy === "pending").forEach((m) => void runClassify(m));
const quick = params.get("q");
if (quick) {
  save(quick);
  toast("냅킨에 적었어요");
  params.delete("q");
  history.replaceState(null, "", `${location.pathname}${params.size ? `?${params}` : ""}`);
}
render();

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register("./sw.js");
}
