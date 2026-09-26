// 아이폰 앱과의 연결
// - 앱 → 웹: 위젯·단축어·공유로 적은 메모와 위젯에서 누른 완료/내일 다시를 받아 반영
// - 웹 → 앱: 위젯과 알림에 쓸 '챙길 것' 목록을 보낸다

import { store } from "./store";
import { save } from "./pipeline";
import { toast } from "./ui";
import { isNative, postNative, type NativePayload } from "./bridge";
import { completeNativeAuth } from "./sync";

const PROCESSED_KEY = "napkin.native.processed.v1";
const DAY = 86_400_000;

export interface WidgetItem {
  id: string;
  kind: "todo" | "link";
  title: string;
  detail: string | null;
  /** 알릴 시각 (ms). null이면 기한 없는 할 일 */
  due: number | null;
  url: string | null;
}

/** 위젯·알림용 목록: 기한 있는 할 일(다음 30일), 리마인드 걸린 링크, 기한 없는 할 일 */
export function widgetItems(now = Date.now()): WidgetItem[] {
  const items: WidgetItem[] = [];
  for (const t of store.todos()) {
    if (t.done) continue;
    const at = t.snoozedUntil && t.snoozedUntil > now ? t.snoozedUntil : t.due;
    if (at && at > now + 30 * DAY) continue;
    items.push({ id: t.id, kind: "todo", title: t.title, detail: at ? null : (t.step ?? null), due: at ?? null, url: null });
  }
  for (const m of store.links()) {
    if (!m.remindAt || m.reminded || !m.link) continue;
    items.push({ id: m.id, kind: "link", title: m.link.title || m.link.site, detail: m.link.summary ?? m.link.site, due: m.remindAt, url: m.link.url });
  }
  return items;
}

function processed(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(PROCESSED_KEY) ?? "[]"));
  } catch {
    return new Set();
  }
}

function applyAction(itemID: string, action: "done" | "snooze") {
  const tomorrow = new Date(Date.now() + DAY).setHours(9, 0, 0, 0);
  const todo = store.todos().find((t) => t.id === itemID);
  if (todo) return store.updateTodo(itemID, action === "done" ? { done: true } : { snoozedUntil: tomorrow });
  if (store.get(itemID)) store.update(itemID, action === "done" ? { reminded: true } : { remindAt: tomorrow, reminded: false });
}

/** 앱이 쌓아둔 메모·동작을 반영한다. 같은 항목을 두 번 받아도 한 번만 처리 */
async function ingest(p: NativePayload) {
  const seen = processed();
  const ids: string[] = [];
  let added = 0;
  for (const m of p.memos ?? []) {
    if (!seen.has(m.id)) {
      const memo = await save(m.text);
      if (memo) store.update(memo.id, { createdAt: m.at });
      seen.add(m.id);
      added++;
    }
    ids.push(m.id);
  }
  for (const a of p.actions ?? []) {
    if (!seen.has(a.id)) {
      applyAction(a.itemID, a.action);
      seen.add(a.id);
    }
    ids.push(a.id);
  }
  try {
    localStorage.setItem(PROCESSED_KEY, JSON.stringify([...seen].slice(-500)));
  } catch {
    /* 무시 */
  }
  postNative({ type: "ack", ids });
  if (added) toast(`앱 밖에서 적은 메모 ${added}개를 담았어요`);
}

export function initNative() {
  if (!isNative()) return;
  document.body.classList.add("native");
  window.napkinNative = {
    ingest,
    async authCallback(url: string) {
      try {
        await completeNativeAuth(url);
      } catch (e) {
        toast(`로그인하지 못했어요: ${e instanceof Error ? e.message : e}`);
      }
    },
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const sync = () => postNative({ type: "snapshot", items: widgetItems() });
  store.subscribe(() => {
    clearTimeout(timer);
    timer = setTimeout(sync, 300);
  });
  sync();
  postNative({ type: "ready" });
}
