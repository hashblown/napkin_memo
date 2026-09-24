// 화면 공통 도구: 선택자, 토스트, 날짜 표시, 메모 카드, 삭제·분류 변경 처리

import { store, type Memo } from "./store";
import { vault } from "./vault";
import { parseDue } from "./detect";

export const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

export function toast(msg: string) {
  const el = $("#toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout((el as HTMLElement & { t?: number }).t);
  (el as HTMLElement & { t?: number }).t = window.setTimeout(() => el.classList.remove("show"), 2600);
}

export function esc(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export function when(ts: number) {
  const d = new Date(ts);
  const diff = (Date.now() - ts) / 60000;
  if (diff < 1) return "방금";
  if (diff < 60) return `${Math.floor(diff)}분 전`;
  if (diff < 60 * 24) return `${Math.floor(diff / 60)}시간 전`;
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

const DAYS = "일월화수목금토";

/** 기한 표시: "오늘 15:00", "내일", "9/30(화) 09:00" */
export function dueLabel(at: number, hasTime = true) {
  const d = new Date(at);
  const today = new Date().setHours(0, 0, 0, 0);
  const day = new Date(at).setHours(0, 0, 0, 0);
  const diff = Math.round((day - today) / 86_400_000);
  const date = diff === 0 ? "오늘" : diff === 1 ? "내일" : diff === -1 ? "어제" : `${d.getMonth() + 1}/${d.getDate()}(${DAYS[d.getDay()]})`;
  const time = hasTime ? ` ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}` : "";
  return date + time;
}

export function memoItem(m: Memo, reason?: string) {
  const text = vault.read(m);
  const lock = m.locked ? `<span class="lock" title="잠긴 메모">🔒</span>` : "";
  const cat =
    m.classifiedBy === "pending"
      ? `<span class="cat pending">분류 중…</span>`
      : `<button class="cat" data-recat="${m.id}" title="분류 고치기">${esc(m.category)} <span class="fix-hint">✎</span></button>`;
  const tags = m.tags.map((t) => `<span class="tag">#${esc(t)}</span>`).join("");
  let body: string;
  if (text === null) body = `<p class="muted">잠긴 메모예요. 서랍 › ${esc(m.category)}에서 PIN으로 열 수 있어요.</p>`;
  else if (m.kind === "link" && m.link)
    body = `<a class="ltitle" href="${esc(m.link.url)}" target="_blank" rel="noopener">🔗 ${esc(m.link.title || m.link.site)}</a>
      ${m.link.summary ? `<p class="lsum">${esc(m.link.summary)}</p>` : ""}${text && text !== m.link.title ? `<p>${esc(text)}</p>` : ""}`;
  else body = `<p>${esc(text)}</p>`;
  return `<li class="memo${m.locked ? " locked" : ""}" data-id="${m.id}">
    ${body}
    ${reason ? `<p class="reason">${esc(reason)}</p>` : ""}
    <div class="meta">${lock}${cat}${tags}<span class="time">${when(m.createdAt)}</span>
      <button class="del" data-del="${m.id}" aria-label="삭제">×</button></div>
  </li>`;
}

/** 분류 바꾸기. 잠근 분류로 옮기면 잠그고, 잠근 분류에서 꺼내면 잠금을 푼다 */
export async function recategorize(id: string, to: string) {
  const m = store.get(id);
  if (!m) return;
  if (!m.locked && !store.isLockedCat(to) && m.category !== to)
    store.addCorrection({ text: m.kind === "link" ? `${m.text} ${m.link?.title ?? ""} ${m.link?.site ?? ""}`.trim() : m.text, kind: m.kind, category: to });
  const targetLocked = m.kind === "note" && store.isLockedCat(to);
  if (targetLocked && !m.locked) {
    await vault.seal(m, to);
    toast(`🔒 '${to}'에 잠갔어요. AI는 이 메모를 보지 않아요`);
  } else if (!targetLocked && m.locked) {
    if (!vault.unseal(m, to)) toast("먼저 보관함 잠금을 풀어주세요");
  } else store.update(id, { category: to, classifiedBy: "user" });
}

let rerender: () => void = () => {};
export const onRerender = (fn: () => void) => (rerender = fn);

// 삭제는 두 번 눌러 확정, 분류 칩을 누르면 '분류 고치기'가 열린다 (브라우저 팝업 없이)
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
  const recat = t.closest<HTMLElement>("[data-recat]")?.dataset.recat;
  if (recat) openFix(recat, t.closest("li"));
});

// ---------- 분류 고치기: 분류 고르기 + 할 일 여부 ----------

let fixFor = "";

function openFix(id: string, li: Element | null) {
  const wasOpen = !!li?.querySelector(".fix");
  document.querySelectorAll(".fix").forEach((el) => el.remove());
  if (wasOpen) return void (fixFor = "");
  const m = store.get(id);
  if (!m || !li) return;
  fixFor = id;
  const cats = store.categories(m.kind).filter((c) => c !== m.category && c !== "미분류");
  const openTodos = store.todos().filter((x) => x.memoId === id && !x.done).length;
  const box = document.createElement("div");
  box.className = "fix";
  box.innerHTML = `
    <span class="label">어느 분류가 맞아요?</span>
    <div class="chips">${cats
      .map((c) => `<button type="button" class="chip" data-fix-cat="${esc(c)}">${store.isLockedCat(c) ? "🔒 " : ""}${esc(c)}</button>`)
      .join("")}</div>
    <div class="row"><input data-fix-new placeholder="새 분류 이름" /><button type="button" data-fix-add>만들어 넣기</button></div>
    ${
      m.kind === "note" && !m.locked && !m.series
        ? `<div class="row todo-fix"><span>${openTodos ? `할 일 ${openTodos}개로 들어가 있어요` : "할 일 목록에 없어요"}</span>
            <button type="button" data-fix-todo="${openTodos ? "off" : "on"}">${openTodos ? "할 일 아니에요" : "할 일이에요"}</button></div>`
        : ""
    }
    <p class="muted small">고친 내용은 기억해서 다음 메모부터 비슷하게 나눠요.</p>`;
  li.append(box);
}

document.addEventListener("click", async (e) => {
  const t = (e.target as HTMLElement).closest<HTMLElement>("[data-fix-cat],[data-fix-add],[data-fix-todo]");
  if (!t || !fixFor) return;
  const id = fixFor;
  const m = store.get(id);
  if (!m) return;
  if (t.dataset.fixCat || t.dataset.fixAdd !== undefined) {
    const to = t.dataset.fixCat ?? (t.parentElement?.querySelector<HTMLInputElement>("[data-fix-new]")?.value.trim() || "");
    if (!to) return toast("새 분류 이름을 적어주세요");
    fixFor = "";
    await recategorize(id, to);
    toast(`'${to}'(으)로 옮겼어요. 다음부터 비슷한 메모는 여기로 나눌게요`);
  }
  if (t.dataset.fixTodo) {
    fixFor = "";
    if (t.dataset.fixTodo === "off") {
      store.todos().filter((x) => x.memoId === id && !x.done).forEach((x) => store.removeTodo(x.id));
      store.update(id, { noTodo: true });
      store.addCorrection({ text: m.text, kind: "note", todo: false });
      toast("할 일에서 뺐어요. 비슷한 메모는 할 일로 넣지 않을게요");
    } else {
      const title = m.text.split("\n")[0].slice(0, 40);
      const d = parseDue(m.text);
      store.addTodo({ title, due: d?.due ?? null, hasTime: d?.hasTime ?? false, memoId: id });
      store.update(id, { noTodo: false });
      store.addCorrection({ text: m.text, kind: "note", todo: true });
      toast(d ? `할 일로 넣었어요 · ${dueLabel(d.due, d.hasTime)}` : "할 일로 넣었어요");
    }
  }
});
