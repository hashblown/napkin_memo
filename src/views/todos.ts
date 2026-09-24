// 할 일: 기한 있는 것은 기한 순서대로 + 리마인드, 기한 없는 것은 하나씩 '첫 행동'을 제안

import { store, settings, type Todo } from "../store";
import { parseDue } from "../detect";
import { nextStep, describeError } from "../ai";
import { downloadIcs } from "../reminders";
import { $, esc, toast, dueLabel } from "../ui";

const DAY = 86_400_000;
let pickIndex = 0;
const asking = new Set<string>();

function localStep(title: string) {
  if (/예약/.test(title)) return "예약 페이지를 열어서 가능한 날짜만 확인해 보기";
  if (/확인|서류|검토/.test(title)) return "확인할 서류나 내용을 한 곳(폴더·메모)에 모아 두기";
  if (/사기|구매|주문/.test(title)) return "후보 하나만 골라 장바구니에 넣어 두기";
  if (/연락|전화|보내기|메일/.test(title)) return "보낼 메시지의 첫 문장만 써 두기";
  if (/입금|납부|결제|송금/.test(title)) return "계좌·금액을 확인하고 은행 앱을 열어 두기";
  if (/정리|청소|치우/.test(title)) return "타이머 10분 맞추고 눈앞의 한 구역만 하기";
  return "5분 타이머를 켜고 첫 단계만 해 보기";
}

function undatedQueue(now = Date.now()) {
  return store
    .todos()
    .filter((t) => !t.done && !t.due && (!t.snoozedUntil || t.snoozedUntil <= now))
    .sort((a, b) => a.createdAt - b.createdAt);
}

function renderStep() {
  const queue = undatedQueue();
  const box = $("#stepCard");
  if (!queue.length) {
    box.innerHTML = "";
    return;
  }
  const t = queue[pickIndex % queue.length];
  let step = t.step;
  if (!step && settings.get().apiKey && navigator.onLine && !asking.has(t.id)) {
    asking.add(t.id);
    const memo = t.memoId ? store.get(t.memoId) : undefined;
    nextStep(settings.get().apiKey, t.title, memo && !memo.locked ? memo.text : "")
      .then((s) => store.updateTodo(t.id, { step: s }))
      .catch((e) => toast(`제안 실패: ${describeError(e)}`));
  }
  step ??= asking.has(t.id) ? "첫 행동을 생각하는 중…" : localStep(t.title);
  box.innerHTML = `<div class="step">
    <span class="eyebrow">지금 하나 해볼까요? · 기한 없는 할 일 ${queue.length}개</span>
    <strong>${esc(t.title)}</strong>
    <p>👉 ${esc(step)}</p>
    <div class="row">
      <button data-step-later="${t.id}">내일 다시</button>
      <span class="grow"></span>
      ${queue.length > 1 ? `<button data-step-next>다른 거</button>` : ""}
      <button class="primary" data-todo-done="${t.id}">했어요</button>
    </div>
  </div>`;
}

function todoItem(t: Todo, now: number) {
  const overdue = t.due && !t.done && t.due < now;
  return `<li class="todo${t.done ? " done" : ""}${overdue ? " overdue" : ""}">
    <button class="check" data-todo-done="${t.id}" aria-label="완료">${t.done ? "✓" : ""}</button>
    <span class="ttl">${esc(t.title)}${t.due ? `<small>${overdue ? "기한 지남 · " : ""}${dueLabel(t.due, t.hasTime)}</small>` : ""}</span>
    ${t.due && !t.done ? `<button class="icon" data-ics="${t.id}" title="캘린더에 넣기 (알림 포함)">📅</button>` : ""}
    <button class="del" data-todo-del="${t.id}" aria-label="삭제">×</button>
  </li>`;
}

export function renderTodos() {
  const now = Date.now();
  const all = store.todos();
  const open = all.filter((t) => !t.done);
  const dated = open.filter((t) => t.due).sort((a, b) => a.due! - b.due!);
  const undated = open.filter((t) => !t.due);
  const done = all.filter((t) => t.done).slice(0, 10);
  const section = (title: string, items: Todo[]) =>
    items.length ? `<h3>${title}</h3><ul class="todos">${items.map((t) => todoItem(t, now)).join("")}</ul>` : "";
  $("#todoLists").innerHTML =
    section("기한 있음", dated) +
    section("기한 없음", undated) +
    (done.length ? `<details><summary>완료한 일 ${done.length}</summary><ul class="todos">${done.map((t) => todoItem(t, now)).join("")}</ul></details>` : "") ||
    `<p class="empty">할 일이 없어요. 적기 탭에 "금요일까지 서류 제출"처럼 적으면 여기로 모여요.</p>`;
  const overdue = open.filter((t) => t.due && t.due <= now).length;
  const badge = $("#todoBadge");
  badge.hidden = !overdue;
  badge.textContent = String(overdue);
  renderStep();
}

$<HTMLFormElement>("#todoForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const input = $<HTMLInputElement>("#todoInput");
  const title = input.value.trim();
  if (!title) return;
  const d = parseDue(title);
  store.addTodo({ title, due: d?.due ?? null, hasTime: d?.hasTime ?? false });
  input.value = "";
  toast(d ? `${dueLabel(d.due, d.hasTime)}에 알려드릴게요` : "할 일에 넣었어요");
});

document.addEventListener("click", (e) => {
  const el = (e.target as HTMLElement).closest<HTMLElement>("[data-todo-done],[data-todo-del],[data-ics],[data-step-next],[data-step-later]");
  if (!el) return;
  const d = el.dataset;
  if (d.todoDone) {
    const t = store.todos().find((x) => x.id === d.todoDone);
    if (t) store.updateTodo(t.id, { done: !t.done });
    if (t && !t.done) toast("잘했어요 ✓");
  }
  if (d.todoDel) store.removeTodo(d.todoDel);
  if (d.ics) {
    const t = store.todos().find((x) => x.id === d.ics);
    if (t?.due) downloadIcs(t.title, t.due);
  }
  if (d.stepNext !== undefined) {
    pickIndex++;
    renderStep();
  }
  if (d.stepLater) store.updateTodo(d.stepLater, { snoozedUntil: new Date(Date.now() + DAY).setHours(9, 0, 0, 0) });
});
