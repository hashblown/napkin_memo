// 서랍: 분류별 메모, 연재 기록, 잠근 분류(보관함), AI 정리 제안

import { store, settings } from "../store";
import { vault } from "../vault";
import { recurringKeywords, suggestReorgLocally } from "../local";
import { suggestReorg, seriesPatterns, describeError, type ReorgSuggestion } from "../ai";
import { $, esc, toast, memoItem } from "../ui";

let activeCat = "";
let activeSeries = "";
const patternCache = new Map<string, Awaited<ReturnType<typeof seriesPatterns>> | "loading">();

// ---------- 연재 ----------

function renderSeries() {
  const list = store.seriesList();
  $("#seriesBar").innerHTML = list.length
    ? `<span class="eyebrow">연재 기록</span><div class="chips">${list
        .map(
          (s) =>
            `<button class="chip series-chip ${s.name === activeSeries ? "on" : ""}" data-series="${esc(s.name)}">${esc(s.name)} <small>${s.last}${esc(s.unit)} · ${s.count}개</small></button>`,
        )
        .join("")}</div>`
    : "";
  const panel = $("#seriesPanel");
  const entries = activeSeries ? store.seriesEntries(activeSeries) : [];
  if (!entries.length) {
    panel.hidden = true;
    return;
  }
  panel.hidden = false;
  // 첫 줄(연재 이름·회차)은 빼고 본문만 센다
  const texts = entries.map((m) => m.text.split("\n").slice(1).join("\n"));
  const kw = recurringKeywords(texts);
  const ai = patternCache.get(activeSeries);
  const aiHtml =
    ai === "loading"
      ? `<p class="muted">회차들을 읽는 중…</p>`
      : ai
        ? `<div class="spark"><p>${esc(ai.summary)}</p><ul>${ai.recurring
            .map((r) => `<li><b>${esc(r.keyword)}</b> <small>${r.count}회</small> · ${esc(r.note)}</li>`)
            .join("")}</ul><p>👉 다음 회차엔: ${esc(ai.focus)}</p></div>`
        : settings.get().apiKey
          ? `<button data-series-ai>AI로 반복 패턴 보기</button>`
          : "";
  panel.innerHTML = `
    <div class="row"><h3>${esc(activeSeries)} · ${entries.length}개 기록</h3><button data-series-close>닫기</button></div>
    ${kw.length ? `<p class="eyebrow">여러 회차에 반복되는 말</p><div class="chips">${kw.map((k) => `<span class="kw">${esc(k.word)} <small>×${k.count}</small></span>`).join("")}</div>` : ""}
    ${aiHtml}
    <ol class="timeline">${entries
      .map((m) => `<li><span class="n">${m.series!.n}${esc(m.series!.unit)}</span><p>${esc(m.text.split("\n").slice(1).join("\n").trim() || m.text)}</p></li>`)
      .join("")}</ol>`;
}

$("#seriesBar").addEventListener("click", (e) => {
  const s = (e.target as HTMLElement).closest<HTMLElement>("[data-series]")?.dataset.series;
  if (s !== undefined) {
    activeSeries = activeSeries === s ? "" : s;
    renderSeries();
  }
});
$("#seriesPanel").addEventListener("click", async (e) => {
  const t = e.target as HTMLElement;
  if (t.dataset.seriesClose !== undefined) {
    activeSeries = "";
    renderSeries();
  }
  if (t.dataset.seriesAi !== undefined) {
    const name = activeSeries;
    const entries = store.seriesEntries(name).filter((m) => !m.locked);
    patternCache.set(name, "loading");
    renderSeries();
    try {
      const r = await seriesPatterns(
        settings.get().apiKey,
        name,
        entries.map((m) => ({ n: m.series!.n, date: new Date(m.createdAt).toLocaleDateString("ko-KR"), text: m.text })),
      );
      patternCache.set(name, r);
    } catch (err) {
      patternCache.delete(name);
      toast(`패턴 찾기 실패: ${describeError(err)}`);
    }
    renderSeries();
  }
});

// ---------- 분류 · 잠금 ----------

export function renderDrawer() {
  renderSeries();
  const q = $<HTMLInputElement>("#search").value.trim().toLowerCase();
  const cats = store.categories("note");
  if (activeCat && !cats.includes(activeCat)) activeCat = "";
  const locked = !!activeCat && store.isLockedCat(activeCat);
  $("#cats").innerHTML = ["", ...cats]
    .map(
      (c) =>
        `<button class="chip ${c === activeCat ? "on" : ""}" data-cat="${esc(c)}">${store.isLockedCat(c) ? "🔒 " : ""}${c ? esc(c) : "전체"}</button>`,
    )
    .join("");
  $("#renamecat").hidden = !activeCat;
  const lockBtn = $("#lockcat");
  lockBtn.hidden = !activeCat;
  lockBtn.textContent = locked ? "잠금 풀기" : "🔒 이 분류 잠그기";

  // 잠근 분류: PIN으로 열기 전엔 목록을 보여주지 않는다
  const gate = $("#vaultGate");
  const needPin = locked && vault.hasPin() && !vault.isOpen();
  gate.hidden = !locked;
  gate.innerHTML = !locked
    ? ""
    : needPin
      ? `<form id="unlockForm" class="gate"><p>🔒 잠근 분류예요. PIN을 입력하면 열려요.</p>
          <div class="row"><input id="unlockPin" type="password" inputmode="numeric" autocomplete="off" placeholder="PIN" /><button class="primary">열기</button></div></form>`
      : vault.hasPin()
        ? `<div class="gate row"><span>🔓 열려 있어요. 5분 뒤나 앱을 벗어나면 다시 잠겨요.</span><button data-vault-lock>지금 잠그기</button></div>`
        : `<div class="gate"><p>🔒 이 분류의 메모는 AI로 보내지 않아요. <b>설정 › 보관함 잠금</b>에서 PIN을 정하면 암호화되고, PIN으로만 열 수 있어요.</p></div>`;

  const list = needPin
    ? []
    : store.notes().filter((m) => {
        if (activeCat ? m.category !== activeCat : m.locked) return false; // 잠긴 메모는 그 분류 안에서만
        if (!q) return true;
        const text = vault.read(m) ?? "";
        return [text, m.category, ...m.tags, ...m.useWhen].join(" ").toLowerCase().includes(q);
      });
  $("#list").innerHTML = needPin ? "" : list.map((m) => memoItem(m)).join("") || `<li class="empty">아직 비어 있어요.</li>`;
}

$("#cats").addEventListener("click", (e) => {
  const c = (e.target as HTMLElement).dataset.cat;
  if (c !== undefined) {
    activeCat = c;
    renderDrawer();
  }
});
$("#search").addEventListener("input", renderDrawer);

$("#vaultGate").addEventListener("submit", async (e) => {
  e.preventDefault();
  const pin = $<HTMLInputElement>("#unlockPin").value;
  if (!(await vault.unlock(pin))) toast("PIN이 맞지 않아요");
});
$("#vaultGate").addEventListener("click", (e) => {
  if ((e.target as HTMLElement).dataset.vaultLock !== undefined) vault.lock();
});

$("#lockcat").addEventListener("click", async () => {
  if (!activeCat) return;
  const memos = store.notes().filter((m) => m.category === activeCat);
  if (store.isLockedCat(activeCat)) {
    if (vault.hasPin() && !vault.isOpen()) return toast("먼저 PIN으로 열어주세요");
    for (const m of memos) vault.unseal(m, activeCat);
    store.setCatLocked(activeCat, false);
    toast("잠금을 풀었어요. 이제 AI가 이 분류를 볼 수 있어요");
  } else {
    store.setCatLocked(activeCat, true);
    for (const m of memos) await vault.seal(m);
    toast(vault.hasPin() ? `🔒 '${activeCat}' 메모 ${memos.length}개를 암호화했어요` : `🔒 잠갔어요. PIN을 정하면 암호화돼요`);
  }
});

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

// ---------- AI 정리 제안 (잠긴 메모·분류는 제외) ----------

let suggestion: ReorgSuggestion | null = null;

$("#reorg").addEventListener("click", async () => {
  const memos = store.forAI().filter((m) => m.kind === "note");
  const cats = store.categories("note").filter((c) => !store.isLockedCat(c));
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
      suggestion = await suggestReorg(apiKey, memos, cats);
    } catch (e) {
      toast(`AI 실패: ${describeError(e)} → 기기 규칙으로 제안`);
    }
  }
  suggestion ??= suggestReorgLocally(memos, cats);
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
      if (!m || m.locked) return [];
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
