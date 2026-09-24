import "./style.css";
import { store, settings, type Memo } from "./store";
import { classifyLocally, inspireLocally, suggestReorgLocally } from "./local";
import { classify, inspire, suggestReorg, describeError, type ReorgSuggestion } from "./ai";

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

// 삭제는 두 번 눌러 확정, 분류 이름은 그 자리에서 고친다 (브라우저 팝업 없이)
document.addEventListener("click", (e) => {
  const t = e.target as HTMLElement;
  const del = t.dataset.del;
  if (del) {
    if (t.classList.contains("armed")) return store.remove(del);
    t.classList.add("armed");
    t.textContent = "지우기";
    setTimeout(() => {
      t.classList.remove("armed");
      t.textContent = "×";
    }, 3000);
  }
  const recat = t.dataset.recat;
  if (recat) {
    const input = Object.assign(document.createElement("input"), { className: "cat-edit", value: store.get(recat)?.category ?? "" });
    t.replaceWith(input);
    input.focus();
    input.select();
    input.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" && !ev.isComposing && input.value.trim()) store.update(recat, { category: input.value.trim(), classifiedBy: "user" });
      if (ev.key === "Escape") render();
    });
    input.addEventListener("blur", () => render());
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
  $("#renamecat").hidden = !activeCat;
}

// 분류 만들기 · 이름 바꾸기 (같은 폼을 같이 쓴다)
let catMode: "add" | "rename" = "add";
function openCatForm(mode: "add" | "rename") {
  catMode = mode;
  $("#catform").hidden = false;
  const input = $<HTMLInputElement>("#catname");
  input.value = mode === "rename" ? activeCat : "";
  input.placeholder = mode === "rename" ? "새 이름 (기존 분류 이름이면 합쳐져요)" : "새 분류 이름";
  input.focus();
}
$("#addcat").addEventListener("click", () => openCatForm("add"));
$("#renamecat").addEventListener("click", () => openCatForm("rename"));
$("#catcancel").addEventListener("click", () => ($("#catform").hidden = true));
$<HTMLFormElement>("#catform").addEventListener("submit", (e) => {
  e.preventDefault();
  const name = $<HTMLInputElement>("#catname").value.trim();
  if (!name) return;
  if (catMode === "add") {
    store.addCategory(name);
    toast(`'${name}' 분류를 만들었어요`);
  } else if (name !== activeCat) {
    store.renameCategory(activeCat, name);
    activeCat = name;
    toast("이름을 바꿨어요");
  }
  $("#catform").hidden = true;
  renderDrawer();
});

// AI 정리 제안: 메모 전체의 경향을 보고 새 분류 + 옮길 메모를 추천
let suggestion: ReorgSuggestion | null = null;

$("#reorg").addEventListener("click", async () => {
  const memos = store.all().filter((m) => m.classifiedBy !== "pending");
  const box = $("#reorgbox");
  box.hidden = false;
  if (memos.length < 3) {
    box.innerHTML = `<p class="muted">메모가 조금 더 쌓이면 경향을 볼 수 있어요.</p>`;
    return;
  }
  box.innerHTML = `<p class="muted">메모 ${memos.length}개의 경향을 살펴보는 중…</p>`;
  const { apiKey } = settings.get();
  suggestion = null;
  if (apiKey && navigator.onLine) {
    try {
      suggestion = await suggestReorg(apiKey, memos, store.categories());
    } catch (e) {
      toast(`AI 실패: ${describeError(e)} → 기기 규칙으로 제안`);
    }
  }
  suggestion ??= suggestReorgLocally(memos, store.categories());
  renderSuggestion();
});

function renderSuggestion() {
  const box = $("#reorgbox");
  if (!suggestion || (!suggestion.newCategories.length && !suggestion.moves.length)) {
    box.innerHTML = `<p class="muted">지금 분류가 잘 맞아요. 바꿀 만한 게 없어요.</p><div class="row"><span></span><button data-reorg="close">닫기</button></div>`;
    return;
  }
  const cats = suggestion.newCategories
    .map((c) => `<label class="sug"><input type="checkbox" checked data-newcat="${esc(c.name)}" /><span><b>${esc(c.name)}</b><small>${esc(c.reason)}</small></span></label>`)
    .join("");
  const moves = suggestion.moves
    .flatMap((mv) => {
      const m = store.get(mv.id);
      if (!m) return [];
      const snippet = m.text.length > 40 ? `${m.text.slice(0, 40)}…` : m.text;
      return `<label class="sug"><input type="checkbox" checked data-move="${mv.id}" data-to="${esc(mv.to)}" /><span>${esc(snippet)}<small>${esc(m.category)} → <b>${esc(mv.to)}</b> · ${esc(mv.reason)}</small></span></label>`;
    })
    .join("");
  box.innerHTML = `
    ${cats ? `<h3>새 분류 제안</h3>${cats}` : ""}
    ${moves ? `<h3>옮기면 좋을 메모</h3>${moves}` : ""}
    <div class="row"><button data-reorg="close">닫기</button><button class="primary" data-reorg="apply">선택한 것 적용</button></div>`;
}

$("#reorgbox").addEventListener("click", (e) => {
  const action = (e.target as HTMLElement).dataset.reorg;
  const box = $("#reorgbox");
  if (action === "close") box.hidden = true;
  if (action !== "apply" || !suggestion) return;
  const checked = (sel: string) => [...box.querySelectorAll<HTMLInputElement>(sel)].filter((i) => i.checked);
  const newCats = checked("[data-newcat]").map((i) => i.dataset.newcat!);
  // 새 분류를 뺐다면 그 분류로 가는 이동도 뺀다
  const rejected = new Set(suggestion.newCategories.map((c) => c.name).filter((n) => !newCats.includes(n)));
  const moves = checked("[data-move]")
    .map((i) => ({ id: i.dataset.move!, to: i.dataset.to! }))
    .filter((mv) => !rejected.has(mv.to));
  store.apply(newCats, moves);
  box.hidden = true;
  toast(`분류 ${newCats.length}개 추가, 메모 ${moves.length}개 옮겼어요`);
});
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
  const targets = store.all().filter((m) => m.classifiedBy === "local" || m.classifiedBy === "pending");
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
if (import.meta.env.VITE_DEMO) seedDemo();
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

if ("serviceWorker" in navigator && import.meta.env.PROD && !import.meta.env.VITE_DEMO) {
  navigator.serviceWorker.register("./sw.js").catch(() => {});
}

// 미리보기 전용: 처음 열면 예시 메모를 채워 둔다
function seedDemo() {
  document.body.classList.add("demo");
  if (store.all().length) return;
  const H = 3600_000;
  const examples: [string, string, string[], string[], number][] = [
    ["카페 옆자리 사람들이 노트북 대신 종이에 적고 있었다. 손으로 쓰면 생각이 느려져서 좋은 걸까?", "관찰", ["카페", "손글씨"], ["사람을 이해하고 싶을 때", "글이 막힐 때"], 2],
    ["동네 카페 리뷰를 한 장짜리 지도로 모아보는 서비스", "사업·기획", ["카페", "동네"], ["기획 회의 전", "새 프로젝트를 시작할 때"], 20],
    ["제목 후보: 냅킨의 철학", "글감", ["제목", "글쓰기"], ["글이 막힐 때", "콘텐츠 주제가 필요할 때"], 30],
    ["비 오는 날엔 창가 자리부터 찬다. 사람들은 비를 보는 걸 좋아한다", "관찰", ["카페", "날씨"], ["공간을 기획할 때", "새로운 관점이 필요할 때"], 50],
    ["완벽하게 쓰려다 아무것도 못 쓴 날. 일단 적고 나중에 고치자", "마음·성찰", ["글쓰기", "습관"], ["마음이 지칠 때", "글이 막힐 때"], 70],
    ["발표는 질문 하나로 시작하면 사람들이 고개를 든다", "배움", ["발표"], ["발표를 준비할 때", "기획 회의 전"], 120],
  ];
  for (const [text, category, tags, useWhen, hoursAgo] of examples.reverse()) {
    const m = store.add(text);
    store.update(m.id, { category, tags, useWhen, classifiedBy: "local", createdAt: Date.now() - hoursAgo * H });
  }
}
