// 화면 공통 도구: 선택자, 토스트, 날짜 표시, 메모 카드, 삭제·분류 변경 처리

import { store, type Memo } from "./store";
import { vault } from "./vault";

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
      : `<button class="cat" data-recat="${m.id}">${esc(m.category)}</button>`;
  const tags = m.tags.map((t) => `<span class="tag">#${esc(t)}</span>`).join("");
  let body: string;
  if (text === null) body = `<p class="muted">잠긴 메모예요. 서랍 › ${esc(m.category)}에서 PIN으로 열 수 있어요.</p>`;
  else if (m.kind === "link" && m.link)
    body = `<a class="ltitle" href="${esc(m.link.url)}" target="_blank" rel="noopener">🔗 ${esc(m.link.title || m.link.site)}</a>
      ${m.link.summary ? `<p class="lsum">${esc(m.link.summary)}</p>` : ""}${text ? `<p>${esc(text)}</p>` : ""}`;
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
    const m = store.get(recat);
    const input = Object.assign(document.createElement("input"), { className: "cat-edit", value: m?.category ?? "" });
    const list = document.createElement("datalist");
    list.id = `cats-${recat}`;
    list.innerHTML = store
      .categories(m?.kind)
      .map((c) => `<option value="${esc(c)}"></option>`)
      .join("");
    input.setAttribute("list", list.id);
    t.replaceWith(input, list);
    input.focus();
    input.select();
    let done = false;
    input.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" && !ev.isComposing && input.value.trim()) {
        done = true;
        void recategorize(recat, input.value.trim());
      }
      if (ev.key === "Escape") rerender();
    });
    input.addEventListener("blur", () => !done && rerender());
  }
});
