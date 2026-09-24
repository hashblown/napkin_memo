import "./style.css";
import { store, settings, VAULT } from "./store";
import { vault } from "./vault";
import { inspireLocally } from "./local";
import { findUrl, parseSeries } from "./detect";
import { inspire, describeError } from "./ai";
import { save, classifyNote, enrichLink } from "./pipeline";
import { dueItems, notifyDue, REMIND_PRESETS, presetAt } from "./reminders";
import { $, esc, toast, memoItem, dueLabel, onRerender } from "./ui";
import { renderTodos } from "./views/todos";
import { renderLinks } from "./views/links";
import { renderDrawer } from "./views/drawer";

const PRESETS = ["글이 막힐 때", "기획 회의 전", "새 프로젝트를 시작할 때", "마음이 지칠 때", "산책하며 생각 정리", "아무거나 꺼내줘"];
const DAY = 86_400_000;

// ---------- 탭 ----------

function show(tab: string) {
  document.querySelectorAll<HTMLElement>(".tabs button").forEach((b) => b.classList.toggle("on", b.dataset.tab === tab));
  document.querySelectorAll<HTMLElement>(".panel").forEach((p) => p.classList.toggle("on", p.id === tab));
  if (tab === "write") $("#napkin").focus();
  if (tab === "settings") {
    $<HTMLInputElement>("#apikey").value = settings.get().apiKey;
    renderPin();
  }
}
document.querySelectorAll<HTMLElement>(".tabs button").forEach((b) => b.addEventListener("click", () => show(b.dataset.tab!)));

// ---------- 적기: 연재 이어쓰기 + 링크 리마인드 ----------

const napkin = $<HTMLTextAreaElement>("#napkin");
let seriesSuggestion = "";
let remindChoice = "";

/** 첫 줄에 연재 이름을 쓰기 시작하면 다음 회차를 제안한다. 비어 있으면 최근 연재를 보여준다 */
function renderSuggest() {
  const v = napkin.value;
  const box = $("#suggest");
  const list = store.seriesList();
  seriesSuggestion = "";
  if (!list.length || v.includes("\n")) return (box.innerHTML = "");
  const typed = v.trim();
  if (!typed) {
    box.innerHTML = list
      .slice(0, 3)
      .map((s) => `<button type="button" class="chip ghost" data-fill="${esc(`${s.name} ${s.last + 1}${s.unit}`)}">✎ ${esc(s.name)} ${s.last + 1}${esc(s.unit)}</button>`)
      .join("");
    return;
  }
  if (parseSeries(typed)) return (box.innerHTML = "");
  const hit = list.find((s) => s.name.startsWith(typed) || typed.startsWith(s.name));
  if (!hit) return (box.innerHTML = "");
  seriesSuggestion = `${hit.name} ${hit.last + 1}${hit.unit}`;
  box.innerHTML = `<button type="button" class="chip ghost on" data-fill="${esc(seriesSuggestion)}">✎ ${esc(seriesSuggestion)} <kbd>Tab</kbd></button>`;
}

function fill(text: string) {
  napkin.value = `${text}\n`;
  napkin.focus();
  napkin.setSelectionRange(napkin.value.length, napkin.value.length);
  renderSuggest();
  renderRemindRow();
}

$("#suggest").addEventListener("click", (e) => {
  const f = (e.target as HTMLElement).closest<HTMLElement>("[data-fill]")?.dataset.fill;
  if (f) fill(f);
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
  // 고른 뒤 바로 Enter로 저장할 수 있게 입력칸으로 돌아간다
  if (r === "date") $("#remindAt").focus();
  else napkin.focus();
});

napkin.addEventListener("input", () => {
  renderSuggest();
  renderRemindRow();
});
napkin.addEventListener("keydown", (e) => {
  if (e.key === "Tab" && seriesSuggestion) {
    e.preventDefault();
    fill(seriesSuggestion);
  } else if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    $<HTMLFormElement>("#capture").requestSubmit();
  }
});
$<HTMLFormElement>("#capture").addEventListener("submit", async (e) => {
  e.preventDefault();
  let remindAt: number | null = null;
  if (remindChoice === "date") {
    const v = $<HTMLInputElement>("#remindAt").value;
    remindAt = v ? new Date(v).getTime() : null;
  } else if (remindChoice) remindAt = presetAt(remindChoice);
  const m = await save(napkin.value, { remindAt });
  if (m?.kind === "link") toast(remindAt ? `북마크에 담았어요 · ${dueLabel(remindAt)}에 알려드릴게요` : "북마크에 담았어요");
  napkin.value = "";
  remindChoice = "";
  $<HTMLInputElement>("#remindAt").value = "";
  renderSuggest();
  renderRemindRow();
  napkin.focus();
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
  toast("저장했어요");
});
$("#reclassify").addEventListener("click", async () => {
  if (!settings.get().apiKey) return toast("먼저 API 키를 넣어주세요");
  const targets = store.forAI().filter((m) => m.classifiedBy === "local");
  toast(`${targets.length}개 다시 분류 중…`);
  for (const m of targets) await (m.kind === "link" ? enrichLink(m) : classifyNote(m));
  toast("다시 분류했어요");
});

function renderPin() {
  const area = $("#pinArea");
  if (vault.hasPin()) {
    const n = store.all().filter((m) => m.locked).length;
    area.innerHTML = `<p class="muted">🔒 잠긴 메모 ${n}개가 암호화되어 있어요. ${vault.isOpen() ? "지금 열려 있어요." : "PIN으로만 열 수 있어요."}</p>
      ${vault.isOpen() ? `<button data-vault-lock>지금 잠그기</button>` : ""}`;
    return;
  }
  area.innerHTML = `<p class="muted">비밀번호·계좌 같은 메모는 자동으로 <b>${VAULT}</b>에 들어가고 AI로 보내지 않아요.
    PIN을 정하면 잠긴 메모를 암호화하고, 앱 안에서 PIN으로만 열 수 있어요. <b>PIN을 잊으면 복구할 수 없어요.</b> 6자리 이상을 권해요.</p>
    <form id="pinForm" class="row"><input id="pin1" type="password" inputmode="numeric" placeholder="새 PIN" autocomplete="new-password" />
    <input id="pin2" type="password" inputmode="numeric" placeholder="한 번 더" autocomplete="new-password" /><button class="primary">정하기</button></form>`;
}
$("#pinArea").addEventListener("submit", async (e) => {
  e.preventDefault();
  const [a, b] = [$<HTMLInputElement>("#pin1").value, $<HTMLInputElement>("#pin2").value];
  if (a.length < 4) return toast("PIN은 4자리 이상이어야 해요");
  if (a !== b) return toast("두 PIN이 달라요");
  await vault.setPin(a);
  toast("PIN을 정했어요. 잠긴 메모를 암호화했어요");
  renderPin();
});
$("#pinArea").addEventListener("click", (e) => {
  if ((e.target as HTMLElement).dataset.vaultLock !== undefined) vault.lock();
});

$("#notifyOn").addEventListener("click", async () => {
  if (!("Notification" in window)) return toast("이 브라우저는 알림을 지원하지 않아요. 캘린더 버튼을 써주세요");
  const p = await Notification.requestPermission();
  toast(p === "granted" ? "알림을 켰어요" : "알림이 허용되지 않았어요");
  void notifyDue();
});
$("#shareBase").textContent = `${location.origin}${location.pathname}?q=`;

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
  const widget = document.body.classList.contains("widget");
  $("#recent").innerHTML = store
    .all()
    .filter((m) => !m.locked)
    .slice(0, widget ? 3 : 8)
    .map((m) => memoItem(m))
    .join("");
  renderDue();
  renderTodos();
  renderLinks();
  renderDrawer();
}
onRerender(render);
store.subscribe(render);
vault.subscribe(() => {
  render();
  if ($("#settings").classList.contains("on")) renderPin();
});

// ---------- 시작 옵션: ?widget, ?q=…, 공유(title/text/url) ----------

const params = new URLSearchParams(location.search);
if (params.has("widget")) document.body.classList.add("widget");
if (import.meta.env.VITE_DEMO) seedDemo();
render();
renderSuggest();

// 저장만 되고 분류가 끝나기 전에 창이 닫힌 메모 이어서 분류
store
  .all()
  .filter((m) => m.classifiedBy === "pending" && !m.locked)
  .forEach((m) => void classifyNote(m));

const shared = [params.get("title"), params.get("text"), params.get("url")].filter((x): x is string => !!x?.trim());
const quick = params.get("q") ?? (shared.length ? [...new Set(shared)].join("\n") : null);
if (quick) {
  void save(quick).then((m) => toast(m?.kind === "link" ? "북마크에 담았어요" : "냅킨에 적었어요"));
  ["q", "title", "text", "url"].forEach((k) => params.delete(k));
  history.replaceState(null, "", `${location.pathname}${params.size ? `?${params}` : ""}`);
}

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
  if (store.all().length) return;
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
