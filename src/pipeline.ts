// 저장 → (민감정보면 잠금) → 링크면 북마크 / 아니면 메모 → 분류 · 할 일 뽑기

import { store, settings, VAULT, type Memo } from "./store";
import { vault } from "./vault";
import { classifyLocally } from "./local";
import { asLink, siteOf, classifyLinkLocally, detectSensitive, parseSeries, extractTodosLocally } from "./detect";
import { classify, describeLink, parseDueString, describeError } from "./ai";
import { toast } from "./ui";

const aiReady = () => !!settings.get().apiKey && navigator.onLine;

export async function save(raw: string, opts: { remindAt?: number | null } = {}): Promise<Memo | null> {
  const text = raw.trim();
  if (!text) return null;

  // 1) 민감정보는 AI에 가기 전에 여기서 잠근다
  const sensitive = detectSensitive(text);
  if (sensitive) {
    const m = store.add({ text, kind: "note", category: VAULT, classifiedBy: "user" });
    await vault.seal(m, VAULT);
    toast(vault.hasPin() ? `🔒 ${sensitive} 정보가 있어 보관함에 잠갔어요` : `🔒 ${sensitive} 정보가 있어 보관함에 넣었어요. 설정에서 PIN을 정하면 암호화돼요`);
    return m;
  }

  // 2) 링크 중심 메모 → 북마크
  const link = asLink(text);
  if (link) {
    const m = store.add({
      text: link.note,
      kind: "link",
      link: { url: link.url, site: siteOf(link.url), title: link.note || undefined },
      category: classifyLinkLocally(link.url, link.note),
      classifiedBy: "local",
      remindAt: opts.remindAt ?? null,
    });
    void enrichLink(m);
    return m;
  }

  // 3) 일반 메모 (연재 번호가 있으면 연재로 묶는다)
  const m = store.add({ text, kind: "note", series: parseSeries(text) ?? undefined });
  void classifyNote(m);
  return m;
}

function replaceTodos(m: Memo, todos: { title: string; due: number | null; hasTime: boolean }[]) {
  store
    .todos()
    .filter((t) => t.memoId === m.id && !t.done)
    .forEach((t) => store.removeTodo(t.id));
  for (const t of todos) store.addTodo({ ...t, memoId: m.id });
  if (todos.length) toast(`할 일 ${todos.length}개를 할 일 목록에 넣었어요`);
}

export async function classifyNote(m: Memo) {
  if (m.locked) return;
  if (aiReady()) {
    try {
      const cats = store.categories("note").filter((c) => c !== "미분류" && !store.isLockedCat(c));
      const r = await classify(settings.get().apiKey, m.text, cats);
      store.update(m.id, { category: r.category, tags: r.tags, useWhen: r.useWhen, classifiedBy: "ai" });
      replaceTodos(
        m,
        r.todos.map((t) => {
          const d = parseDueString(t.due);
          return { title: t.title, due: d?.due ?? null, hasTime: d?.hasTime ?? false };
        }),
      );
      return;
    } catch (e) {
      toast(`AI 분류 실패: ${describeError(e)} → 기기 규칙으로 분류`);
    }
  }
  store.update(m.id, { ...classifyLocally(m.text), classifiedBy: "local" });
  replaceTodos(m, extractTodosLocally(m.text));
}

export async function enrichLink(m: Memo) {
  if (!m.link || m.locked || !aiReady()) return;
  try {
    const r = await describeLink(settings.get().apiKey, m.link.url, m.text, store.categories("link"));
    const cur = store.get(m.id);
    if (!cur?.link) return;
    store.update(m.id, { link: { ...cur.link, title: r.title, summary: r.summary }, category: r.category, classifiedBy: "ai" });
  } catch (e) {
    toast(`링크 정리 실패: ${describeError(e)}`);
  }
}
