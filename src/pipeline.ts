// 저장 → (민감정보면 잠금) → 링크면 북마크 / 아니면 메모 → 바로 기기 규칙으로 정리
// AI 정리는 새 메모가 정해진 개수만큼 쌓이면 한꺼번에 한다 (runBatch)

import { store, settings, VAULT, type Memo } from "./store";
import { vault } from "./vault";
import { classifyLocally, learnedCategory } from "./local";
import { asLink, siteOf, classifyLinkLocally, detectSensitive, parseSeries, extractTodosLocally } from "./detect";
import { classifyBatch, describeLink, parseDueString, describeError, type Example } from "./ai";
import { toast } from "./ui";

const aiReady = () => !!settings.get().apiKey && navigator.onLine;
export const DEFAULT_BATCH = 10;
const CHUNK = 30;

export async function save(raw: string, opts: { remindAt?: number | null } = {}): Promise<Memo | null> {
  const text = raw.trim();
  if (!text) return null;

  // 1) 민감정보는 AI에 가기 전에 여기서 잠근다
  const sensitive = detectSensitive(text);
  if (sensitive) {
    const m = store.add({ text, kind: "note", category: VAULT, classifiedBy: "user" });
    await vault.seal(m, VAULT);
    toast(vault.hasPin() ? `🔒 ${sensitive} 정보가 있어 보관함에 잠갔어요` : `🔒 ${sensitive} 정보가 있어 보관함에 넣었어요. 설정에서 잠금 번호를 정하면 암호화돼요`);
    return m;
  }

  // 2) 링크 중심 메모 → 북마크
  const link = asLink(text);
  if (link) {
    const m = store.add({
      text: link.note,
      kind: "link",
      link: { url: link.url, site: siteOf(link.url), title: link.note || undefined },
      category: learnedFor(link.note || link.url, "link") ?? classifyLinkLocally(link.url, link.note),
      classifiedBy: "local",
      remindAt: opts.remindAt ?? null,
    });
    void maybeBatch();
    return m;
  }

  // 3) 일반 메모 (연재 번호가 있으면 연재로 묶는다)
  const m = store.add({ text, kind: "note", series: parseSeries(text) ?? undefined });
  classifyNote(m);
  void maybeBatch();
  return m;
}

/** 사용자가 직접 정한 분류들 (잠긴 메모 제외) */
function labeled(kind: Memo["kind"]) {
  const fromMemos = store
    .all()
    .filter((m) => m.kind === kind && m.classifiedBy === "user" && !m.locked && !m.series)
    .map((m) => ({ text: kind === "link" ? `${m.text} ${m.link?.title ?? ""} ${m.link?.site ?? ""}` : m.text, category: m.category }));
  const fromFixes = store
    .corrections()
    .filter((c) => c.kind === kind && c.category)
    .map((c) => ({ text: c.text, category: c.category! }));
  return [...fromFixes, ...fromMemos];
}

const learnedFor = (text: string, kind: Memo["kind"]) => learnedCategory(text, labeled(kind));

function replaceTodos(m: Memo, todos: { title: string; due: number | null; hasTime: boolean }[], quiet = false) {
  if (m.noTodo || m.series) todos = [];
  store
    .todos()
    .filter((t) => t.memoId === m.id && !t.done)
    .forEach((t) => store.removeTodo(t.id));
  for (const t of todos) store.addTodo({ ...t, memoId: m.id });
  if (todos.length && !quiet) toast(`할 일 ${todos.length}개를 할 일 목록에 넣었어요`);
}

/** 기기 규칙으로 바로 정리 (사용자가 고친 메모와 비슷하면 그 분류를 따른다) */
export function classifyNote(m: Memo) {
  if (m.locked) return;
  const local = classifyLocally(m.text, labeled("note"));
  store.update(m.id, { ...local, category: m.series?.name ?? local.category, classifiedBy: "local" });
  replaceTodos(m, extractTodosLocally(m.text), true);
}

// ---------- AI 정리 (한꺼번에) ----------

/** AI 정리를 기다리는 메모: 기기 규칙으로만 정리된 것 */
export function pendingForAI() {
  return store.forAI().filter((m) => m.classifiedBy === "local");
}

let running = false;
const listeners = new Set<() => void>();
export const onBatchChange = (fn: () => void) => listeners.add(fn);
export const isBatchRunning = () => running;

/** 새 메모가 정해진 개수만큼 쌓였으면 AI 정리를 돌린다 */
export async function maybeBatch() {
  const every = settings.get().batchEvery ?? DEFAULT_BATCH;
  if (!every || !aiReady() || running) return;
  if (pendingForAI().length >= every) await runBatch("new");
}

/**
 * scope "new": AI가 아직 안 본 메모만. "all": 전부 다시.
 * 어느 쪽이든 사용자가 직접 고친 메모와 잠긴 메모는 건드리지 않는다.
 */
export async function runBatch(scope: "new" | "all") {
  if (running) return;
  if (!aiReady()) return toast("AI 정리를 쓰려면 설정에서 API 키를 넣어주세요");
  const pool = store.forAI().filter((m) => m.classifiedBy !== "user");
  const targets = scope === "new" ? pool.filter((m) => m.classifiedBy === "local") : pool;
  if (!targets.length) return toast("새로 정리할 메모가 없어요");
  running = true;
  listeners.forEach((fn) => fn());
  let done = 0;
  try {
    const examples: Example[] = store.corrections().map((c) => ({ text: c.text, category: c.category, todo: c.todo }));
    const notes = targets.filter((m) => m.kind === "note");
    for (let i = 0; i < notes.length; i += CHUNK) {
      const chunk = notes.slice(i, i + CHUNK);
      const cats = store.categories("note").filter((c) => c !== "미분류" && !store.isLockedCat(c));
      const results = await classifyBatch(settings.get().apiKey, chunk, cats, examples);
      for (const r of results) {
        const m = store.get(r.id);
        if (!m || m.locked || m.classifiedBy === "user") continue; // 그새 사용자가 고쳤으면 그대로 둔다
        store.update(m.id, { category: m.series?.name ?? r.category, tags: r.tags, useWhen: r.useWhen, classifiedBy: "ai" });
        replaceTodos(
          m,
          r.todos.map((t) => {
            const d = parseDueString(t.due);
            return { title: t.title, due: d?.due ?? null, hasTime: d?.hasTime ?? false };
          }),
          true,
        );
        done++;
      }
    }
    for (const m of targets.filter((x) => x.kind === "link")) {
      if (await enrichLink(m)) done++;
    }
    toast(`AI가 메모 ${done}개를 정리했어요`);
  } catch (e) {
    toast(`AI 정리 실패: ${describeError(e)}`);
  } finally {
    running = false;
    listeners.forEach((fn) => fn());
  }
}

export async function enrichLink(m: Memo) {
  if (!m.link || m.locked || !aiReady()) return false;
  try {
    const r = await describeLink(settings.get().apiKey, m.link.url, m.text, store.categories("link"));
    const cur = store.get(m.id);
    if (!cur?.link || cur.classifiedBy === "user") return false;
    store.update(m.id, { link: { ...cur.link, title: r.title, summary: r.summary }, category: r.category, classifiedBy: "ai" });
    return true;
  } catch (e) {
    toast(`링크 정리 실패: ${describeError(e)}`);
    return false;
  }
}

// ---------- 메모 고치기 ----------

/**
 * 이미 적은 메모를 고친다.
 * - 잠긴 메모: 보관함이 열려 있을 때만, 고친 뒤 다시 잠근다
 * - 링크: 메모(설명)를 고치고, 주소가 바뀌면 새 주소로
 * - 일반 메모: 민감정보가 새로 생기면 보관함으로. 아니면 다시 나누고 할 일도 다시 찾는다
 *   (내가 직접 고친 분류는 그대로 둔다)
 */
export async function editMemo(id: string, raw: string): Promise<boolean> {
  const m = store.get(id);
  const text = raw.trim();
  if (!m || !text) return false;

  if (m.locked) {
    if (vault.read(m) === null) {
      toast("먼저 보관함을 열어주세요");
      return false;
    }
    store.update(id, { text, cipher: undefined });
    await vault.seal(store.get(id)!);
    toast("고쳤어요 🔒");
    return true;
  }

  if (m.kind === "link" && m.link) {
    const link = asLink(text);
    const url = link?.url ?? m.link.url;
    const note = link ? link.note : text.replace(m.link.url, "").trim();
    const moved = url !== m.link.url;
    store.update(id, {
      text: note,
      link: moved ? { url, site: siteOf(url), title: note || undefined } : { ...m.link, title: m.classifiedBy === "ai" ? m.link.title : note || m.link.title },
      classifiedBy: m.classifiedBy === "user" ? "user" : "local",
    });
    toast("고쳤어요");
    void maybeBatch();
    return true;
  }

  const sensitive = detectSensitive(text);
  if (sensitive) {
    store.update(id, { text });
    await vault.seal(store.get(id)!, VAULT);
    toast(`🔒 ${sensitive} 정보가 있어 보관함으로 옮겼어요`);
    return true;
  }

  store.update(id, { text, series: parseSeries(text) ?? undefined });
  const cur = store.get(id)!;
  if (cur.classifiedBy === "user") {
    // 분류는 그대로, 할 일만 다시 찾는다
    replaceTodos(cur, extractTodosLocally(text), true);
  } else classifyNote(cur);
  const todos = store.todos().filter((t) => t.memoId === id && !t.done).length;
  toast(todos ? `고쳤어요 · 할 일 ${todos}개` : "고쳤어요");
  void maybeBatch();
  return true;
}
