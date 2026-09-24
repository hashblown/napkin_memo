// 메모 저장소: 기기 내 localStorage에 보관한다. (서버 없음 → 개인 데이터가 밖으로 나가지 않음)

/** user: 사용자가 직접 정한 분류 → AI가 덮어쓰거나 옮기지 않는다 */
export type ClassifiedBy = "ai" | "local" | "pending" | "user";

export interface LinkInfo {
  url: string;
  site: string;
  title?: string;
  summary?: string;
}

export interface Memo {
  id: string;
  text: string;
  createdAt: number;
  category: string;
  tags: string[];
  /** 이 메모가 영감이 될 법한 상황들 (예: "기획 회의 전", "글이 막힐 때") */
  useWhen: string[];
  classifiedBy: ClassifiedBy;
  kind: "note" | "link";
  link?: LinkInfo;
  /** 사용자가 요청한 리마인드 시각 */
  remindAt?: number | null;
  reminded?: boolean;
  /** 연재 기록: "레클 12회차" → { name: "레클", n: 12, unit: "회차" } */
  series?: { name: string; n: number; unit: string };
  /** 잠근 분류에 속한 메모. AI에 보내지 않고, PIN이 있으면 text 대신 cipher로 저장 */
  locked?: boolean;
  cipher?: string;
}

export interface Todo {
  id: string;
  title: string;
  /** 기한 (ms). null이면 기한 없음 */
  due: number | null;
  /** 기한에 시각까지 있는지 (없으면 그날 오전 9시에 알림) */
  hasTime: boolean;
  done: boolean;
  createdAt: number;
  memoId?: string;
  reminded?: boolean;
  /** 기한 없는 할 일에 대한 '첫 행동' 제안 (캐시) */
  step?: string;
  snoozedUntil?: number;
}

export interface Settings {
  apiKey: string;
}

const MEMOS_KEY = "napkin.memos.v1";
const TODOS_KEY = "napkin.todos.v1";
const SETTINGS_KEY = "napkin.settings.v1";
const CATS_KEY = "napkin.categories.v1";
const LOCKED_CATS_KEY = "napkin.lockedCategories.v1";

export const VAULT = "보관함";

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // 저장소를 쓸 수 없는 환경(사생활 보호 모드 등): 이번 세션 메모리에만 유지
  }
}

let memos: Memo[] = read<Memo[]>(MEMOS_KEY, []).map((m) => ({ ...m, kind: m.kind ?? "note" }));
let todos: Todo[] = read<Todo[]>(TODOS_KEY, []);
/** 사용자가 직접 만든 분류 (아직 메모가 없어도 유지) */
let userCats: string[] = read<string[]>(CATS_KEY, []);
let lockedCats: string[] = read<string[]>(LOCKED_CATS_KEY, [VAULT]);
const listeners = new Set<() => void>();

function commit() {
  write(MEMOS_KEY, memos);
  write(TODOS_KEY, todos);
  write(CATS_KEY, userCats);
  write(LOCKED_CATS_KEY, lockedCats);
  listeners.forEach((fn) => fn());
}

export const store = {
  all: () => memos,
  notes: () => memos.filter((m) => m.kind === "note"),
  links: () => memos.filter((m) => m.kind === "link"),
  /** AI에 보내도 되는 메모: 잠긴 메모는 절대 포함하지 않는다 */
  forAI: () => memos.filter((m) => !m.locked && m.classifiedBy !== "pending"),
  get: (id: string) => memos.find((m) => m.id === id),
  subscribe(fn: () => void) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  add(init: Pick<Memo, "text" | "kind"> & Partial<Memo>): Memo {
    const memo: Memo = {
      id: crypto.randomUUID(),
      createdAt: Date.now(),
      category: "미분류",
      tags: [],
      useWhen: [],
      classifiedBy: "pending",
      ...init,
    };
    memos = [memo, ...memos];
    commit();
    return memo;
  },
  update(id: string, patch: Partial<Memo>) {
    memos = memos.map((m) => (m.id === id ? { ...m, ...patch } : m));
    commit();
  },
  remove(id: string) {
    memos = memos.filter((m) => m.id !== id);
    todos = todos.filter((t) => t.memoId !== id || t.done);
    commit();
  },

  // ---------- 분류 ----------
  categories(kind: Memo["kind"] = "note"): string[] {
    const counts = new Map<string, number>(kind === "note" ? [...userCats, ...lockedCats].map((c) => [c, 0]) : []);
    for (const m of memos) if (m.kind === kind) counts.set(m.category, (counts.get(m.category) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c);
  },
  isLockedCat: (c: string) => lockedCats.includes(c),
  setCatLocked(c: string, locked: boolean) {
    lockedCats = locked ? [...new Set([...lockedCats, c])] : lockedCats.filter((x) => x !== c);
    commit();
  },
  addCategory(name: string) {
    if (!userCats.includes(name)) userCats = [...userCats, name];
    commit();
  },
  /** 이름 바꾸기. 이미 있는 이름이면 두 분류가 합쳐진다 */
  renameCategory(from: string, to: string) {
    userCats = [...new Set(userCats.map((c) => (c === from ? to : c)))];
    lockedCats = [...new Set(lockedCats.map((c) => (c === from ? to : c)))];
    memos = memos.map((m) => (m.category === from ? { ...m, category: to } : m));
    commit();
  },
  /** 여러 변경을 한 번에 적용 (정리 제안 수락). 잠긴 메모와 잠긴 분류는 건드리지 않는다 */
  apply(newCats: string[], moves: { id: string; to: string }[]) {
    userCats = [...new Set([...userCats, ...newCats])];
    const to = new Map(moves.filter((m) => !lockedCats.includes(m.to)).map((m) => [m.id, m.to]));
    memos = memos.map((m) => (to.has(m.id) && !m.locked ? { ...m, category: to.get(m.id)!, classifiedBy: "ai" } : m));
    commit();
  },

  // ---------- 연재 ----------
  seriesList() {
    const map = new Map<string, { name: string; last: number; unit: string; count: number; lastAt: number }>();
    for (const m of memos) {
      if (!m.series) continue;
      const s = map.get(m.series.name) ?? { name: m.series.name, last: 0, unit: m.series.unit, count: 0, lastAt: 0 };
      s.count++;
      if (m.series.n >= s.last) {
        s.last = m.series.n;
        s.unit = m.series.unit;
      }
      s.lastAt = Math.max(s.lastAt, m.createdAt);
      map.set(m.series.name, s);
    }
    return [...map.values()].sort((a, b) => b.lastAt - a.lastAt);
  },
  seriesEntries: (name: string) =>
    memos.filter((m) => m.series?.name === name).sort((a, b) => b.series!.n - a.series!.n || b.createdAt - a.createdAt),

  // ---------- 할 일 ----------
  todos: () => todos,
  addTodo(t: Omit<Todo, "id" | "createdAt" | "done">) {
    const todo: Todo = { id: crypto.randomUUID(), createdAt: Date.now(), done: false, ...t };
    todos = [todo, ...todos];
    commit();
    return todo;
  },
  updateTodo(id: string, patch: Partial<Todo>) {
    todos = todos.map((t) => (t.id === id ? { ...t, ...patch } : t));
    commit();
  },
  removeTodo(id: string) {
    todos = todos.filter((t) => t.id !== id);
    commit();
  },

  // ---------- 백업 ----------
  exportJson: () => JSON.stringify({ version: 2, memos, todos, userCats, lockedCats }, null, 2),
  importJson(json: string): number {
    const data = JSON.parse(json) as { memos?: Memo[]; todos?: Todo[]; userCats?: string[]; lockedCats?: string[] };
    const incoming = (data.memos ?? []).filter((m) => m.id && typeof m.text === "string");
    const known = new Set(memos.map((m) => m.id));
    const fresh = incoming.filter((m) => !known.has(m.id)).map((m) => ({ ...m, kind: m.kind ?? "note" }));
    memos = [...fresh, ...memos].sort((a, b) => b.createdAt - a.createdAt);
    const knownT = new Set(todos.map((t) => t.id));
    todos = [...(data.todos ?? []).filter((t) => !knownT.has(t.id)), ...todos];
    userCats = [...new Set([...userCats, ...(data.userCats ?? [])])];
    lockedCats = [...new Set([...lockedCats, ...(data.lockedCats ?? [])])];
    commit();
    return fresh.length;
  },
};

export const settings = {
  get: () => read<Settings>(SETTINGS_KEY, { apiKey: "" }),
  set: (s: Settings) => write(SETTINGS_KEY, s),
};
