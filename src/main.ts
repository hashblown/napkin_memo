import "./style.css";
import { store, settings, VAULT } from "./store";
import { vault } from "./vault";
import { inspireLocally } from "./local";
import { findUrl } from "./detect";
import { inspire, describeError } from "./ai";
import { save, editMemo, classifyNote, runBatch, maybeBatch, pendingForAI, onBatchChange, isBatchRunning, DEFAULT_BATCH } from "./pipeline";
import { dueItems, notifyDue, REMIND_PRESETS, presetAt } from "./reminders";
import { $, esc, toast, memoItem, dueLabel, onRerender, editing } from "./ui";
import { renderTodos } from "./views/todos";
import { renderLinks } from "./views/links";
import { renderDrawer } from "./views/drawer";
import { initNative } from "./native";
import { FONTS, applyFont, fontById, loadPreviews } from "./fonts";
import { initSync, signIn, signOut, syncNow, syncState, onSyncChange, type Provider } from "./sync";

const PRESETS = ["글이 막힐 때", "기획 회의 전", "새 프로젝트를 시작할 때", "마음이 지칠 때", "산책하며 생각 정리", "아무거나 꺼내줘"];
const DAY = 86_400_000;

// ---------- 화면 고정: 확대 · 가로 스크롤 막기 (세로 스크롤만) ----------
// iOS 사파리는 viewport의 user-scalable=no를 무시하므로 두 손가락 제스처를 직접 막는다
for (const type of ["gesturestart", "gesturechange", "gestureend"]) document.addEventListener(type, (e) => e.preventDefault(), { passive: false });
document.addEventListener("touchmove", (e) => e.touches.length > 1 && e.preventDefault(), { passive: false });

// ---------- 탭 (+ 설정은 오른쪽 위 톱니) ----------

function show(tab: string) {
  document.querySelectorAll<HTMLElement>(".tabs button").forEach((b) => b.classList.toggle("on", b.dataset.tab === tab));
  document.querySelectorAll<HTMLElement>(".panel").forEach((p) => p.classList.toggle("on", p.id === tab));
  $("#openSettings").classList.toggle("on", tab === "settings");
  if (tab === "settings") openSettingsPage(null);
  window.scrollTo({ top: 0 });
}

/** 설정 첫 화면은 항목 목록만, 누르면 그 항목의 세부 화면으로 들어간다 */
function openSettingsPage(key: string | null) {
  $("#settingsHome").hidden = !!key;
  document.querySelectorAll<HTMLElement>(".setting-page").forEach((p) => (p.hidden = p.dataset.page !== key));
  $<HTMLInputElement>("#apikey").value = settings.get().apiKey;
  renderAi();
  renderPin();
  if (key === "font") renderFonts();
  renderSettingsHome();
  window.scrollTo({ top: 0 });
}

function ago(ts: number | null) {
  if (!ts) return "아직 안 했어요";
  const min = Math.floor((Date.now() - ts) / 60000);
  return min < 1 ? "방금" : min < 60 ? `${min}분 전` : min < 1440 ? `${Math.floor(min / 60)}시간 전` : new Date(ts).toLocaleDateString("ko-KR");
}

function renderAccount() {
  const st = syncState();
  const area = $("#accountArea");
  $("#sumAccount").textContent = !st.configured
    ? "이 기기에만 저장 중"
    : st.user
      ? `${st.user.name || st.user.email} · ${st.status === "error" ? "동기화 오류" : st.status === "syncing" ? "동기화 중…" : `동기화 ${ago(st.lastSyncAt)}`}`
      : "로그인하면 다른 기기와 함께 써요";
  if (!st.configured) {
    area.innerHTML = `<p>지금은 메모가 <b>이 기기에만</b> 저장돼요. 동기화 서버가 아직 연결되지 않았어요.</p>
      <p class="small">서버를 연결하면 Google · 카카오로 로그인해서 여러 기기에서 같은 메모를 쓸 수 있어요.</p>`;
    return;
  }
  if (!st.user) {
    area.innerHTML = `<p>로그인하면 메모가 서버에도 저장돼서, 폰을 바꾸거나 다른 기기에서도 그대로 이어서 쓸 수 있어요.
      로그인하지 않아도 이 기기에는 계속 저장돼요.</p>
      <div class="login-buttons">
        <button type="button" class="login google" data-login="google"><span class="logo">G</span>Google로 계속하기</button>
        <button type="button" class="login kakao" data-login="kakao"><span class="logo">💬</span>카카오로 계속하기</button>
      </div>
      <p class="small">처음 로그인하면 이 기기에 있던 메모도 함께 올라가요. 보관함 메모는 암호화된 채로만 올라가요.</p>`;
    return;
  }
  const provider = st.user.provider === "kakao" ? "카카오" : st.user.provider === "google" ? "Google" : st.user.provider;
  area.innerHTML = `<div class="account-card">
      <b>${esc(st.user.name || st.user.email || "로그인됨")}</b>
      <span class="small">${esc([provider, st.user.email].filter(Boolean).join(" · "))}</span>
    </div>
    <p>마지막 동기화: <b>${st.status === "syncing" ? "하는 중…" : ago(st.lastSyncAt)}</b>${st.pending ? ` · 올릴 변경 ${st.pending}개` : ""}</p>
    ${st.status === "error" ? `<p class="error">동기화하지 못했어요: ${esc(st.error ?? "")}</p>` : ""}
    <div class="row start wrap">
      <button type="button" class="primary" data-sync-now ${st.status === "syncing" ? "disabled" : ""}>지금 동기화</button>
      <button type="button" data-logout>로그아웃</button>
    </div>
    <p class="small">로그아웃해도 이 기기의 메모는 남아 있어요. API 키 같은 설정은 기기마다 따로예요.</p>`;
}

$("#accountArea").addEventListener("click", async (e) => {
  const t = (e.target as HTMLElement).closest<HTMLElement>("[data-login],[data-sync-now],[data-logout]");
  if (!t) return;
  try {
    if (t.dataset.login) await signIn(t.dataset.login as Provider);
    if (t.dataset.syncNow !== undefined) toast((await syncNow()) ? "동기화했어요" : "동기화하지 못했어요");
    if (t.dataset.logout !== undefined) {
      await signOut();
      toast("로그아웃했어요. 이 기기의 메모는 그대로예요");
    }
  } catch (err) {
    toast(`로그인하지 못했어요: ${err instanceof Error ? err.message : err}`);
  }
});
onSyncChange(() => $("#settings").classList.contains("on") && renderAccount());

function renderSettingsHome() {
  renderAccount();
  const s = settings.get();
  const every = s.batchEvery ?? DEFAULT_BATCH;
  $("#sumFont").textContent = fontById(s.font).label;
  $("#sumAi").textContent = s.apiKey
    ? every
      ? `새 메모 ${every === 1 ? "적을 때마다" : `${every}개마다`} 정리 · 기다리는 메모 ${pendingForAI().length}개`
      : "직접 할 때만 정리"
    : "키를 넣으면 Claude가 정리해요";
  $("#sumVault").textContent = vault.hasPin() ? `잠금 번호 설정됨 · 메모 ${store.all().filter((m) => m.locked).length}개` : "잠금 번호를 정하지 않았어요";
  $("#sumNotify").textContent = "Notification" in window ? (Notification.permission === "granted" ? "켜짐" : "꺼짐") : "이 브라우저는 지원하지 않아요";
  $("#sumShare").textContent = "공유 메뉴 · 위젯에서 바로 담는 방법";
  $("#sumNative").textContent = "위젯 · 공유 메뉴 · 액션 버튼";
  $("#sumBackup").textContent = `메모 ${store.all().length}개 · 파일로 저장하고 불러오기`;
}

$("#settings").addEventListener("click", (e) => {
  const t = (e.target as HTMLElement).closest<HTMLElement>("[data-open],[data-back]");
  if (!t) return;
  openSettingsPage(t.dataset.open ?? null);
});
document.querySelectorAll<HTMLElement>(".tabs button").forEach((b) => b.addEventListener("click", () => show(b.dataset.tab!)));
$("#openSettings").addEventListener("click", () => show($("#settings").classList.contains("on") ? "home" : "settings"));

// ---------- 냅킨: 평소엔 접힌 버튼(FAB), 누르면 펼쳐지는 입력칸 ----------

const napkin = $<HTMLTextAreaElement>("#napkin");
const dock = $<HTMLFormElement>("#capture");
const fab = $<HTMLButtonElement>("#fab");
const DRAFT_KEY = "napkin.draft.v1";
const reduceMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** 저장하기 전 쓰던 글은 접어도, 앱을 껐다 켜도 남아 있다 */
function saveDraft() {
  try {
    localStorage.setItem(DRAFT_KEY, napkin.value);
  } catch {
    /* 무시 */
  }
  $("#fabDot").hidden = !napkin.value.trim();
}
try {
  napkin.value = localStorage.getItem(DRAFT_KEY) ?? "";
} catch {
  /* 무시 */
}

function openNapkin() {
  if (!dock.hidden) return;
  dock.hidden = false;
  fab.hidden = true;
  // 키보드가 뜨려면 탭한 순간 바로 포커스해야 한다 (iOS)
  napkin.focus({ preventScroll: true });
  napkin.setSelectionRange(napkin.value.length, napkin.value.length);
  autoGrow();
  renderRemindRow();
  if (!reduceMotion()) {
    dock.classList.remove("folding");
    dock.classList.add("unfolding");
  }
}

function foldNapkin() {
  if (dock.hidden || document.body.classList.contains("widget")) return;
  saveDraft();
  napkin.blur();
  $("#seriesPick").hidden = true;
  const done = () => {
    dock.hidden = true;
    dock.classList.remove("folding");
    fab.hidden = false;
  };
  if (reduceMotion()) return done();
  dock.classList.remove("unfolding");
  dock.classList.add("folding");
  $(".napkin").addEventListener("animationend", done, { once: true });
}

fab.addEventListener("click", openNapkin);
$("#foldBtn").addEventListener("click", foldNapkin);
dock.addEventListener("animationend", () => dock.classList.remove("unfolding"));
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !dock.hidden) foldNapkin();
});
let remindChoice = "";
/** 연재 버튼으로 고른 연재. 저장할 때 첫 줄에 "이름 N회차"를 붙인다 */
let seriesChoice: { name: string; n: number; unit: string } | null = null;

/** 글이 길어지면 입력칸이 화면 40%까지 늘어난다 */
function autoGrow() {
  napkin.style.height = "auto";
  napkin.style.height = `${Math.min(napkin.scrollHeight, window.innerHeight * 0.4)}px`;
}

/** 입력칸 높이만큼 본문 아래 여백을 둔다 */
new ResizeObserver(() => document.documentElement.style.setProperty("--dock-h", `${dock.offsetHeight}px`)).observe(dock);

/** 휴대폰 키보드가 올라오면 입력칸을 키보드 위로 올린다 */
const vv = window.visualViewport;
function placeDock() {
  if (!vv) return;
  const keyboard = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
  dock.style.transform = keyboard > 40 ? `translateY(${-keyboard}px)` : "";
  dock.classList.toggle("kb", keyboard > 40);
}
vv?.addEventListener("resize", placeDock);
vv?.addEventListener("scroll", placeDock);

function renderSeriesTag() {
  const tag = $("#seriesTag");
  tag.hidden = !seriesChoice;
  if (seriesChoice)
    tag.innerHTML = `<span>✎ ${esc(seriesChoice.name)} ${seriesChoice.n}${esc(seriesChoice.unit)}</span><button type="button" data-series-clear aria-label="연재 빼기">✕</button>`;
  $("#seriesBtn").classList.toggle("on", !!seriesChoice);
}

function renderSeriesPick() {
  const list = store.seriesList();
  $("#seriesPick").innerHTML = `
    <div class="row"><span class="label">어느 연재에 이어 쓸까요?</span><button type="button" data-series-close>닫기</button></div>
    ${list.length ? `<div class="chips">${list.map((s) => `<button type="button" class="chip" data-series-pick="${esc(s.name)}">${esc(s.name)} <small>${s.last + 1}${esc(s.unit)}</small></button>`).join("")}</div>` : ""}
    <div class="new-series">
      <input id="newSeriesName" placeholder="새 연재 이름 (예: 클라이밍, 탱고 수업)" />
      <select id="newSeriesUnit" aria-label="단위"><option>회차</option><option>주차</option><option>일차</option><option>편</option></select>
      <button type="button" class="primary" data-series-create>만들기</button>
    </div>`;
}

$("#seriesBtn").addEventListener("click", () => {
  const panel = $("#seriesPick");
  panel.hidden = !panel.hidden;
  if (!panel.hidden) renderSeriesPick();
});

dock.addEventListener("click", (e) => {
  const t = (e.target as HTMLElement).closest<HTMLElement>("button");
  if (!t) return;
  const d = t.dataset;
  if (d.seriesClose !== undefined) $("#seriesPick").hidden = true;
  if (d.seriesClear !== undefined) {
    seriesChoice = null;
    renderSeriesTag();
  }
  if (d.seriesPick) {
    const s = store.seriesList().find((x) => x.name === d.seriesPick);
    if (s) seriesChoice = { name: s.name, n: s.last + 1, unit: s.unit };
  }
  if (d.seriesCreate !== undefined) {
    const name = $<HTMLInputElement>("#newSeriesName").value.trim();
    if (!name) return toast("연재 이름을 적어주세요");
    if (/^\d/.test(name)) return toast("연재 이름은 숫자로 시작할 수 없어요");
    const unit = $<HTMLSelectElement>("#newSeriesUnit").value;
    store.addSeries(name, unit);
    seriesChoice = { name, n: 1, unit };
    toast(`'${name}' 연재를 만들었어요`);
  }
  if (d.seriesPick || d.seriesCreate !== undefined) {
    $("#seriesPick").hidden = true;
    renderSeriesTag();
    napkin.focus();
  }
});

function renderRemindRow() {
  const hasUrl = !!findUrl(napkin.value);
  $("#remindRow").hidden = !hasUrl;
  if (!hasUrl) return;
  $("#remindChips").innerHTML = [{ id: "", label: "안 함" }, ...REMIND_PRESETS, { id: "date", label: "날짜 지정" }]
    .map((p) => `<button type="button" class="chip ${remindChoice === p.id ? "on" : ""}" data-remind="${p.id}">${p.label}</button>`)
    .join("");
  $("#remindAt").hidden = remindChoice !== "date";
}

$("#remindChips").addEventListener("click", (e) => {
  const r = (e.target as HTMLElement).dataset.remind;
  if (r === undefined) return;
  remindChoice = r;
  renderRemindRow();
  // 고른 뒤 이어서 쓸 수 있게 입력칸으로 돌아간다
  if (r === "date") $("#remindAt").focus();
  else napkin.focus();
});

napkin.addEventListener("input", () => {
  autoGrow();
  renderRemindRow();
  saveDraft();
});
// Enter는 줄바꿈. 컴퓨터에서는 ⌘/Ctrl+Enter로 저장
napkin.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !e.isComposing) {
    e.preventDefault();
    dock.requestSubmit();
  }
});

dock.addEventListener("submit", async (e) => {
  e.preventDefault();
  const body = napkin.value.trim();
  if (!body && !seriesChoice) return napkin.focus();
  let remindAt: number | null = null;
  if (remindChoice === "date") {
    const v = $<HTMLInputElement>("#remindAt").value;
    remindAt = v ? new Date(v).getTime() : null;
  } else if (remindChoice) remindAt = presetAt(remindChoice);
  const text = seriesChoice ? `${seriesChoice.name} ${seriesChoice.n}${seriesChoice.unit}\n${body}` : body;
  const m = await save(text, { remindAt });
  if (m?.kind === "link") toast(remindAt ? `북마크에 담았어요 · ${dueLabel(remindAt)}에 알려드릴게요` : "북마크에 담았어요");
  else if (m && !m.locked) {
    const todos = store.todos().filter((t) => t.memoId === m.id).length;
    toast(
      seriesChoice
        ? `${seriesChoice.name} ${seriesChoice.n}${seriesChoice.unit}에 적었어요`
        : todos
          ? `적었어요 · 할 일 ${todos}개를 찾아 넣었어요`
          : "적었어요",
    );
  }
  napkin.value = "";
  saveDraft();
  remindChoice = "";
  seriesChoice = null;
  $<HTMLInputElement>("#remindAt").value = "";
  $("#seriesPick").hidden = true;
  renderSeriesTag();
  renderRemindRow();
  autoGrow();
  foldNapkin();
});

// 메모 고치기: 저장
document.addEventListener("click", async (e) => {
  const id = (e.target as HTMLElement).closest<HTMLElement>("[data-edit-save]")?.dataset.editSave;
  if (!id) return;
  const text = editing.draft;
  if (!text.trim()) return toast("내용을 적어주세요");
  editing.id = "";
  if (!(await editMemo(id, text))) editing.id = id;
  render();
});

// ---------- 지금 챙길 것 (리마인드 · 기한) ----------

function renderDue() {
  const { now, today } = dueItems();
  const rows = now.map((d) =>
    d.kind === "link"
      ? `<li><span>🔗 <a href="${esc(d.memo.link!.url)}" target="_blank" rel="noopener">${esc(d.memo.link!.title || d.memo.link!.site)}</a></span>
          <button data-due-snooze="link:${d.memo.id}">내일 다시</button><button class="primary" data-due-ok="link:${d.memo.id}">봤어요</button></li>`
      : `<li><span>☐ ${esc(d.todo.title)} <small>${dueLabel(d.todo.due!, d.todo.hasTime)}</small></span>
          <button data-due-snooze="todo:${d.todo.id}">내일 다시</button><button class="primary" data-due-ok="todo:${d.todo.id}">완료</button></li>`,
  );
  $("#dueNow").innerHTML =
    rows.length || today.length
      ? `<div class="due"><span class="eyebrow">지금 챙길 것${today.length ? ` · 오늘 ${today.length}개 더` : ""}</span>${rows.length ? `<ul>${rows.join("")}</ul>` : ""}</div>`
      : "";
}

$("#dueNow").addEventListener("click", (e) => {
  const t = e.target as HTMLElement;
  const [kind, id] = (t.dataset.dueOk ?? t.dataset.dueSnooze ?? "").split(":");
  if (!id) return;
  const tomorrow = new Date(Date.now() + DAY).setHours(9, 0, 0, 0);
  if (t.dataset.dueOk) kind === "link" ? store.update(id, { reminded: true }) : store.updateTodo(id, { done: true });
  else kind === "link" ? store.update(id, { remindAt: tomorrow }) : store.updateTodo(id, { snoozedUntil: tomorrow });
});

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
  const memos = store.forAI(); // 잠긴 메모는 영감 후보에서도 제외
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
  renderAi();
  toast(settings.get().apiKey ? "키를 저장했어요. 이제 Claude가 정리해요" : "키를 지웠어요. 기기 규칙으로만 나눠요");
  void maybeBatch();
});

function renderAi() {
  const on = !!settings.get().apiKey;
  const pill = $("#aiStatus");
  pill.textContent = on ? "켜짐" : "꺼짐";
  pill.classList.toggle("on", on);
  $("#aiControls").hidden = !on;
  const every = settings.get().batchEvery ?? DEFAULT_BATCH;
  $("#batchChips").innerHTML = BATCH_OPTIONS.map(
    (o) => `<button type="button" role="radio" aria-checked="${o.n === every}" class="chip ${o.n === every ? "on" : ""}" data-batch="${o.n}">${o.label}</button>`,
  ).join("");
  const pending = pendingForAI().length;
  const total = store.forAI().filter((m) => m.classifiedBy !== "user").length;
  $("#pendingInfo").textContent = isBatchRunning()
    ? "AI가 정리하는 중이에요…"
    : `AI 정리를 기다리는 새 메모 ${pending}개 · AI가 다시 정리할 수 있는 메모 ${total}개` +
      (every && pending < every ? ` (새 메모 ${every - pending}개 더 적으면 자동으로 정리해요)` : "");
  ($("#runNew") as HTMLButtonElement).disabled = isBatchRunning() || !pending;
  ($("#runAll") as HTMLButtonElement).disabled = isBatchRunning() || !total;
}

const BATCH_OPTIONS = [
  { n: 1, label: "적을 때마다" },
  { n: 5, label: "5개마다" },
  { n: 10, label: "10개마다" },
  { n: 20, label: "20개마다" },
  { n: 0, label: "직접 할 때만" },
];
$("#batchChips").addEventListener("click", (e) => {
  const n = (e.target as HTMLElement).closest<HTMLElement>("[data-batch]")?.dataset.batch;
  if (n === undefined) return;
  settings.set({ batchEvery: Number(n) });
  renderAi();
  const every = Number(n);
  toast(every === 0 ? "‘지금 정리하기’를 누를 때만 정리할게요" : every === 1 ? "적을 때마다 바로 정리할게요" : `새 메모가 ${every}개 쌓일 때마다 정리할게요`);
  void maybeBatch();
});
$("#runNew").addEventListener("click", () => void runBatch("new"));
$("#runAll").addEventListener("click", () => void runBatch("all"));
onBatchChange(() => $("#settings").classList.contains("on") && renderAi());

const FONT_SAMPLE = "냅킨에 적은 생각 가나다 Aa 123";
function renderFonts() {
  loadPreviews(FONT_SAMPLE);
  const current = fontById(settings.get().font).id;
  $("#fontList").innerHTML = FONTS.map(
    (f) => `<button type="button" role="radio" aria-checked="${f.id === current}" class="font-opt ${f.id === current ? "on" : ""}" data-font="${f.id}">
      <span class="font-sample" style="font-family:${esc(f.family)};font-size:${Math.round(f.size * 0.95)}px">냅킨에 적은</span>
      <span class="font-name">${esc(f.label)} <small>${esc(f.note)}</small></span>
    </button>`,
  ).join("");
}
$("#fontList").addEventListener("click", (e) => {
  const id = (e.target as HTMLElement).closest<HTMLElement>("[data-font]")?.dataset.font;
  if (!id) return;
  settings.set({ font: id });
  applyFont(id);
  renderFonts();
  toast(`글씨체를 '${fontById(id).label}'(으)로 바꿨어요`);
});
function renderPin() {
  const area = $("#pinArea");
  if (vault.hasPin()) {
    const n = store.all().filter((m) => m.locked).length;
    area.innerHTML = `<p>🔒 보관함 메모 ${n}개가 잠겨 있어요. ${vault.isOpen() ? "지금은 열려 있고, 5분 뒤 다시 잠겨요." : "서랍 › 보관함에서 번호를 넣으면 열려요."}</p>
      ${vault.isOpen() ? `<button data-vault-lock>지금 잠그기</button>` : ""}`;
    return;
  }
  area.innerHTML = `<p>잠금 번호를 정하면 보관함 메모가 암호화되고, 번호를 넣어야만 볼 수 있어요. <b>번호를 잊으면 되찾을 수 없으니</b> 6자리 이상으로 정해 두세요.</p>
    <form id="pinForm" class="row"><input id="pin1" type="password" inputmode="numeric" placeholder="잠금 번호" autocomplete="new-password" />
    <input id="pin2" type="password" inputmode="numeric" placeholder="한 번 더" autocomplete="new-password" /><button class="primary">잠그기</button></form>`;
}
$("#pinArea").addEventListener("submit", async (e) => {
  e.preventDefault();
  const [a, b] = [$<HTMLInputElement>("#pin1").value, $<HTMLInputElement>("#pin2").value];
  if (a.length < 4) return toast("잠금 번호는 4자리 이상이어야 해요");
  if (a !== b) return toast("두 번호가 서로 달라요");
  await vault.setPin(a);
  toast("보관함을 잠갔어요");
  renderPin();
});
$("#pinArea").addEventListener("click", (e) => {
  if ((e.target as HTMLElement).dataset.vaultLock !== undefined) vault.lock();
});

$("#notifyOn").addEventListener("click", async () => {
  if (!("Notification" in window)) return toast("이 브라우저는 알림을 지원하지 않아요. 캘린더 버튼을 써주세요");
  const p = await Notification.requestPermission();
  toast(p === "granted" ? "알림을 켰어요" : "알림이 꺼져 있어요. 브라우저 설정에서 허용해 주세요");
  void notifyDue();
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
    toast(`메모 ${store.importJson(await file.text())}개를 불러왔어요`);
  } catch {
    toast("파일을 읽지 못했어요");
  }
});

// ---------- 렌더 ----------

function render() {
  const widget = document.body.classList.contains("widget");
  const recent = store.all().filter((m) => !m.locked);
  $("#recent").innerHTML =
    recent
      .slice(0, widget ? 3 : 20)
      .map((m) => memoItem(m))
      .join("") || `<li class="empty">오른쪽 아래 냅킨을 눌러 떠오른 걸 적어 보세요.<br />할 일, 링크, 생각을 알아서 나눠 둘게요.</li>`;
  renderDue();
  renderTodos();
  renderLinks();
  renderDrawer();
  if ($("#settings").classList.contains("on")) {
    renderAi();
    renderSettingsHome();
  }
}
onRerender(render);
store.subscribe(render);
vault.subscribe(() => {
  render();
  if ($("#settings").classList.contains("on")) renderPin();
});

// ---------- 시작 옵션: ?widget, ?q=…, 공유(title/text/url) ----------

const params = new URLSearchParams(location.search);
if (params.has("widget")) {
  document.body.classList.add("widget");
  dock.hidden = false;
  fab.hidden = true;
}
saveDraft();
if (import.meta.env.VITE_DEMO) seedDemo();
applyFont(settings.get().font);
render();

// 저장만 되고 분류가 끝나기 전에 창이 닫힌 메모 이어서 분류
store
  .all()
  .filter((m) => m.classifiedBy === "pending" && !m.locked)
  .forEach((m) => void classifyNote(m));

const shared = [params.get("title"), params.get("text"), params.get("url")].filter((x): x is string => !!x?.trim());
const quick = params.get("q") ?? (shared.length ? [...new Set(shared)].join("\n") : null);
if (quick) {
  void save(quick).then((m) => toast(m?.kind === "link" ? "북마크에 담았어요" : "적었어요"));
  ["q", "title", "text", "url"].forEach((k) => params.delete(k));
  history.replaceState(null, "", `${location.pathname}${params.size ? `?${params}` : ""}`);
}

// 아이폰 앱 안이면 위젯·알림과 연결
initNative();

// 로그인 동기화 (서버가 연결돼 있을 때만)
void initSync();

// 브라우저가 저장 공간을 정리할 때 이 앱의 메모는 지우지 않도록 요청
void navigator.storage?.persist?.().catch(() => false);

// 리마인드: 1분마다, 그리고 앱으로 돌아올 때 확인
function tick() {
  renderDue();
  void notifyDue();
}
setInterval(tick, 60_000);
document.addEventListener("visibilitychange", () => !document.hidden && (render(), tick()));
tick();

if ("serviceWorker" in navigator && import.meta.env.PROD && !import.meta.env.VITE_DEMO) {
  navigator.serviceWorker.register("./sw.js").catch(() => {});
}

// ---------- 미리보기 전용 예시 데이터 ----------

function seedDemo() {
  document.body.classList.add("demo");
  // 예전 미리보기를 연 적이 있어도 새 예시(북마크·할 일·연재·보관함)는 한 번 더 넣는다
  try {
    if (localStorage.getItem("napkin.demo.v3")) return;
    localStorage.setItem("napkin.demo.v3", "1");
  } catch {
    if (store.all().length) return;
  }
  const H = 3600_000;
  const now = Date.now();
  const add = (hoursAgo: number, init: Parameters<typeof store.add>[0]) => store.add({ classifiedBy: "local", createdAt: now - hoursAgo * H, ...init });

  add(300, { kind: "note", text: "레클 25회차\n워밍업 후 e벽 초록 7회\n- 발 체중 먼저 싣고 손 올리기\n- 팔 펴고 쉬기", category: "운동", tags: ["클라이밍"], series: { name: "레클", n: 25, unit: "회차" } });
  add(200, { kind: "note", text: "레클 26회차\n노랑 도전 but 후반 실패\n- 쳐야 할 때 심호흡\n- 발 체중 싣는 걸 또 까먹음", category: "운동", tags: ["클라이밍"], series: { name: "레클", n: 26, unit: "회차" } });
  add(100, { kind: "note", text: "레클 27회차\n초록 3회 노랑 3회\n- 노랑 시작 홀드에서 발 체중 싣기\n- 팔 펴고 쉬기 잘 됨", category: "운동", tags: ["클라이밍"], series: { name: "레클", n: 27, unit: "회차" } });
  add(90, { kind: "link", text: "침대 후보", link: { url: "https://www.iloom.com/product/detail.do?productCd=HBA201501", site: "iloom.com", title: "침대 후보" }, category: "쇼핑" });
  add(80, { kind: "link", text: "", link: { url: "https://brunch.co.kr/@socandy/47", site: "brunch.co.kr", title: "서비스 기획자를 위한 지표 안내서" }, category: "읽을거리", remindAt: now - 10 * 60_000 });
  add(60, { kind: "link", text: "스테이 숙소", link: { url: "https://www.airbnb.co.kr/", site: "airbnb.co.kr", title: "스테이 숙소" }, category: "여행·숙소", remindAt: new Date(now + DAY).setHours(9, 0, 0, 0) });
  add(50, { kind: "link", text: "", link: { url: "https://youtu.be/NuZYuzPGxzA", site: "youtu.be" }, category: "영상" });
  add(30, { kind: "note", text: "사이드프로젝트 아이디어\n나만의 대나무숲", category: "사업·기획", tags: ["사이드프로젝트"] });
  add(20, { kind: "note", text: "카페 옆자리 사람들이 노트북 대신 종이에 적고 있었다. 손으로 쓰면 생각이 느려져서 좋은 걸까?", category: "관찰", tags: ["카페", "손글씨"] });
  add(10, { kind: "note", text: "예시) 증권 앱 id: 예시계정 / pw: 예시비번", category: VAULT, classifiedBy: "user", locked: true });
  const m = add(5, { kind: "note", text: "금요일 3시 치과 예약 확인\n보험금 청구하기\n임대차계약서 서류 확인", category: "생활" });

  store.addTodo({ title: "치과 예약 확인", due: new Date(now + 2 * DAY).setHours(15, 0, 0, 0), hasTime: true, memoId: m.id });
  store.addTodo({ title: "보험금 청구하기", due: null, hasTime: false, memoId: m.id });
  store.addTodo({ title: "임대차계약서 서류 확인", due: null, hasTime: false, memoId: m.id });
  store.addTodo({ title: "UX 리서치 밋업 신청", due: now - 2 * H, hasTime: true });
}
