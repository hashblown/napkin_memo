// 리마인드: 앱 안 알림 줄 + (허용 시) 시스템 알림 + 앱 아이콘 배지 + 캘린더(.ics) 내보내기.
// 서버가 없으므로 앱이 꺼져 있을 때 확실히 울리는 건 캘린더 알림이다.

import { store, type Memo, type Todo } from "./store";

export type Due = { kind: "link"; memo: Memo; at: number } | { kind: "todo"; todo: Todo; at: number };

const NOTIFIED_KEY = "napkin.notified.v1";
const DAY = 86_400_000;

/** 지금 챙겨야 할 것 (기한 지남) + 오늘 안에 올 것 */
export function dueItems(now = Date.now()) {
  const items: Due[] = [];
  for (const m of store.links()) if (m.remindAt && !m.reminded) items.push({ kind: "link", memo: m, at: m.remindAt });
  for (const t of store.todos())
    if (t.due && !t.done && !t.reminded && (!t.snoozedUntil || t.snoozedUntil <= now)) items.push({ kind: "todo", todo: t, at: t.snoozedUntil ?? t.due });
  const endOfDay = new Date(now).setHours(23, 59, 59, 999);
  return {
    now: items.filter((i) => i.at <= now).sort((a, b) => a.at - b.at),
    today: items.filter((i) => i.at > now && i.at <= endOfDay).sort((a, b) => a.at - b.at),
  };
}

function notified(): string[] {
  try {
    return JSON.parse(localStorage.getItem(NOTIFIED_KEY) ?? "[]");
  } catch {
    return [];
  }
}

/** 새로 기한이 된 항목을 시스템 알림으로 한 번씩 알린다 */
export async function notifyDue() {
  const { now } = dueItems();
  const nav = navigator as Navigator & { setAppBadge?: (n: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
  try {
    if (now.length) await nav.setAppBadge?.(now.length);
    else await nav.clearAppBadge?.();
  } catch {
    /* 배지 미지원 */
  }
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  const seen = new Set(notified());
  for (const d of now) {
    const id = d.kind === "link" ? d.memo.id : `${d.todo.id}:${d.at}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const title = d.kind === "link" ? "다시 볼 링크" : "할 일 기한";
    const body = d.kind === "link" ? (d.memo.link?.title ?? d.memo.link?.url ?? "") : d.todo.title;
    try {
      const reg = await navigator.serviceWorker?.getRegistration();
      if (reg) await reg.showNotification(title, { body, tag: id, icon: "./icon-192.png" });
      else new Notification(title, { body, tag: id });
    } catch {
      /* 알림 미지원 환경 */
    }
  }
  try {
    localStorage.setItem(NOTIFIED_KEY, JSON.stringify([...seen].slice(-300)));
  } catch {
    /* 무시 */
  }
}

// ---------- 리마인드 시각 고르기 ----------

export const REMIND_PRESETS: { id: string; label: string; at: () => number }[] = [
  { id: "tonight", label: "오늘 저녁", at: () => new Date().setHours(20, 0, 0, 0) },
  { id: "tomorrow", label: "내일 아침", at: () => new Date(Date.now() + DAY).setHours(9, 0, 0, 0) },
  {
    id: "weekend",
    label: "이번 주말",
    at: () => new Date(Date.now() + ((6 - new Date().getDay() + 7) % 7 || 7) * DAY).setHours(10, 0, 0, 0),
  },
  { id: "week", label: "일주일 뒤", at: () => new Date(Date.now() + 7 * DAY).setHours(9, 0, 0, 0) },
];

export function presetAt(id: string): number | null {
  const p = REMIND_PRESETS.find((x) => x.id === id);
  if (!p) return null;
  let at = p.at();
  if (at <= Date.now()) at += DAY; // 이미 지난 '오늘 저녁' → 내일 저녁
  return at;
}

// ---------- 캘린더 (.ics) ----------

const pad = (n: number) => String(n).padStart(2, "0");
const icsTime = (ms: number) => {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00Z`;
};
const icsText = (s: string) => s.replace(/[\;,]/g, (c) => `\\${c}`).replace(/\n/g, "\\n");

/** 알림이 달린 캘린더 일정 파일. 아이폰·맥·윈도 캘린더가 그대로 연다 */
export function downloadIcs(title: string, at: number, opts: { url?: string; note?: string } = {}) {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//napkin//memo//KO",
    "BEGIN:VEVENT",
    `UID:${crypto.randomUUID()}@napkin`,
    `DTSTAMP:${icsTime(Date.now())}`,
    `DTSTART:${icsTime(at)}`,
    `DTEND:${icsTime(at + 30 * 60_000)}`,
    `SUMMARY:${icsText(title)}`,
    ...(opts.note ? [`DESCRIPTION:${icsText(opts.note)}`] : []),
    ...(opts.url ? [`URL:${opts.url}`] : []),
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    `DESCRIPTION:${icsText(title)}`,
    "TRIGGER:-PT0M",
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  const url = URL.createObjectURL(new Blob([lines.join("\r\n")], { type: "text/calendar" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: "napkin.ics" });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
