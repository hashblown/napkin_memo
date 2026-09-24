// 북마크: 링크 메모만 모아 분류별로 보고, 링크마다 리마인드를 걸 수 있다

import { store, type Memo } from "../store";
import { REMIND_PRESETS, presetAt, downloadIcs } from "../reminders";
import { $, esc, when, dueLabel, toast } from "../ui";

let activeCat = "";
let menuFor = "";

function linkItem(m: Memo) {
  const l = m.link!;
  const remind = m.remindAt && !m.reminded;
  return `<li class="memo link" data-id="${m.id}">
    <a class="ltitle" href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.title || l.site)}</a>
    <span class="site">${esc(l.site)}</span>
    ${l.summary ? `<p class="lsum">${esc(l.summary)}</p>` : ""}
    ${m.text && m.text !== l.title ? `<p>${esc(m.text)}</p>` : ""}
    <div class="meta">
      <button class="cat" data-recat="${m.id}">${esc(m.category)}</button>
      ${remind ? `<span class="rem">⏰ ${dueLabel(m.remindAt!)}</span><button class="icon" data-link-ics="${m.id}" title="캘린더에 넣기">📅</button>` : ""}
      <span class="time">${when(m.createdAt)}</span>
      <button class="icon" data-remind-menu="${m.id}" aria-label="리마인드">⏰</button>
      <button class="del" data-del="${m.id}" aria-label="삭제">×</button>
    </div>
    ${
      menuFor === m.id
        ? `<div class="remind-menu chips">
        ${REMIND_PRESETS.map((p) => `<button class="chip" data-remind-set="${p.id}">${p.label}</button>`).join("")}
        <input type="datetime-local" data-remind-date aria-label="날짜 지정" />
        ${remind ? `<button class="chip" data-remind-set="off">끄기</button>` : ""}
      </div>`
        : ""
    }
  </li>`;
}

export function renderLinks() {
  const q = $<HTMLInputElement>("#linkSearch").value.trim().toLowerCase();
  const cats = store.categories("link");
  if (activeCat && !cats.includes(activeCat)) activeCat = "";
  const links = store.links();
  $("#linkCats").innerHTML = links.length
    ? ["", ...cats]
        .map((c) => `<button class="chip ${c === activeCat ? "on" : ""}" data-lcat="${esc(c)}">${c ? esc(c) : "전체"}</button>`)
        .join("")
    : "";
  const list = links
    .filter((m) => !activeCat || m.category === activeCat)
    .filter((m) => !q || [m.text, m.category, m.link?.url, m.link?.title, m.link?.summary].join(" ").toLowerCase().includes(q))
    // 리마인드 걸린 것을 위로
    .sort((a, b) => Number(!!b.remindAt && !b.reminded) - Number(!!a.remindAt && !a.reminded) || b.createdAt - a.createdAt);
  $("#linkList").innerHTML =
    list.map(linkItem).join("") || `<li class="empty">냅킨에 링크를 붙여넣으면 여기로 모여요.<br />무슨 페이지인지 알아서 분류해 둘게요.</li>`;
}

$("#linkCats").addEventListener("click", (e) => {
  const c = (e.target as HTMLElement).dataset.lcat;
  if (c !== undefined) {
    activeCat = c;
    renderLinks();
  }
});
$("#linkSearch").addEventListener("input", renderLinks);

function setRemind(id: string, at: number | null) {
  store.update(id, { remindAt: at, reminded: false });
  menuFor = "";
  toast(at ? `${dueLabel(at)}에 다시 알려드릴게요` : "리마인드를 껐어요");
}

document.addEventListener("click", (e) => {
  const el = (e.target as HTMLElement).closest<HTMLElement>("[data-remind-menu],[data-remind-set],[data-link-ics]");
  if (!el) return;
  const id = el.closest<HTMLElement>("[data-id]")?.dataset.id ?? "";
  if (el.dataset.remindMenu) {
    menuFor = menuFor === el.dataset.remindMenu ? "" : el.dataset.remindMenu;
    renderLinks();
  }
  if (el.dataset.remindSet) setRemind(id, el.dataset.remindSet === "off" ? null : presetAt(el.dataset.remindSet));
  if (el.dataset.linkIcs) {
    const m = store.get(el.dataset.linkIcs);
    if (m?.remindAt && m.link) downloadIcs(`다시 보기: ${m.link.title || m.link.site}`, m.remindAt, { url: m.link.url, note: m.text });
  }
});
document.addEventListener("change", (e) => {
  const el = e.target as HTMLInputElement;
  if (!el.matches("[data-remind-date]") || !el.value) return;
  const id = el.closest<HTMLElement>("[data-id]")?.dataset.id;
  if (id) setRemind(id, new Date(el.value).getTime());
});
