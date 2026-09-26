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
  /** 사용자가 '할 일 아님'으로 고친 메모 → AI가 할 일을 다시 만들지 않는다 */
  noTodo?: boolean;
  /** 마지막으로 바뀐 시각 (동기화에서 더 최근 것이 이긴다) */
  updatedAt?: number;
}

/** 사용자가 고친 분류. 로컬 규칙과 AI에 예시로 쓰인다 */
export interface Correction {
  text: string;
  kind: Memo["kind"];
  category?: string;
  todo?: boolean;
  at: number;
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
  updatedAt?: number;
}

export interface Settings {
  apiKey: string;
  /** AI 정리 주기: 새 메모가 N개 쌓일 때마다. 0이면 직접 할 때만 */
  batchEvery?: number;
  /** 냅킨 입력칸 글씨체 (fonts.ts의 id) */
  font?: string;
}

const MEMOS_KEY = "napkin.memos.v1";
const TODOS_KEY = "napkin.todos.v1";
const SETTINGS_KEY = "napkin.settings.v1";
const CATS_KEY = "napkin.categories.v1";
const LOCKED_CATS_KEY = "napkin.lockedCategories.v1";
const SERIES_KEY = "napkin.series.v1";
const CORRECTIONS_KEY = "napkin.corrections.v1";
const DIRTY_KEY = "napkin.sync.dirty.v1";
const DELETED_KEY = "napkin.sync.deleted.v1";
const META_TIME_KEY = "napkin.sync.metaTime.v1";

/** 동기화에 쓰는 이름: "memo:<id>", "todo:<id>", "meta:<이름>" */
export type SyncKey = string;
export const META_NAMES = ["userCats", "lockedCats", "seriesDefs", "corrections", "vault"] as const;
export type MetaName = (typeof META_NAMES)[number];
export interface SyncRecord {
  kind: "memo" | "todo" | "meta";
  id: string;
  data: unknown;
  updated_at: number;
  deleted: boolean;
}

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
/** 사용자가 만든 연재 (아직 기록이 없어도 유지) */
let seriesDefs: { name: string; unit: string }[] = read(SERIES_KEY, []);
let corrections: Correction[] = read(CORRECTIONS_KEY, []);
/** 서버에 아직 안 올린 변경 */
let dirty = new Set<SyncKey>(read<SyncKey[]>(DIRTY_KEY, []));
/** 지운 항목 (다른 기기에도 지우라고 알리기 위해) */
let deleted: Record<SyncKey, number> = read(DELETED_KEY, {});
let metaTime: Partial<Record<MetaName, number>> = read(META_TIME_KEY, {});
/** 바깥(보관함 등)이 관리하는 동기화 항목 */
const externalMeta: Partial<Record<MetaName, { get(): unknown; set(v: unknown): void }>> = {};

function touch(key: SyncKey) {
  dirty.add(key);
  if (key.startsWith("meta:")) metaTime[key.slice(5) as MetaName] = Date.now();
}
const listeners = new Set<() => void>();

function commit() {
  write(MEMOS_KEY, memos);
  write(TODOS_KEY, todos);
  write(CATS_KEY, userCats);
  write(LOCKED_CATS_KEY, lockedCats);
  write(SERIES_KEY, seriesDefs);
  write(CORRECTIONS_KEY, corrections);
  write(DIRTY_KEY, [...dirty]);
  write(DELETED_KEY, deleted);
  write(META_TIME_KEY, metaTime);
  listeners.forEach((fn) => fn());
}

function metaValue(name: MetaName): unknown {
  switch (name) {
    case "userCats":
      return userCats;
    case "lockedCats":
      return lockedCats;
    case "seriesDefs":
      return seriesDefs;
    case "corrections":
      return corrections;
    default:
      return externalMeta[name]?.get() ?? null;
  }
}

function setMetaValue(name: MetaName, v: unknown) {
  switch (name) {
    case "userCats":
      userCats = v as string[];
      break;
    case "lockedCats":
      lockedCats = v as string[];
      break;
    case "seriesDefs":
      seriesDefs = v as typeof seriesDefs;
      break;
    case "corrections":
      corrections = v as Correction[];
      break;
    default:
      externalMeta[name]?.set(v);
  }
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
      updatedAt: Date.now(),
    };
    memos = [memo, ...memos];
    touch(`memo:${memo.id}`);
    commit();
    return memo;
  },
  update(id: string, patch: Partial<Memo>) {
    memos = memos.map((m) => (m.id === id ? { ...m, ...patch, updatedAt: Date.now() } : m));
    touch(`memo:${id}`);
    commit();
  },
  remove(id: string) {
    memos = memos.filter((m) => m.id !== id);
    deleted[`memo:${id}`] = Date.now();
    touch(`memo:${id}`);
    for (const t of todos.filter((t) => t.memoId === id && !t.done)) {
      deleted[`todo:${t.id}`] = Date.now();
      touch(`todo:${t.id}`);
    }
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
    touch("meta:lockedCats");
    commit();
  },
  addCategory(name: string) {
    if (!userCats.includes(name)) userCats = [...userCats, name];
    touch("meta:userCats");
    commit();
  },
  /** 이름 바꾸기. 이미 있는 이름이면 두 분류가 합쳐진다 */
  renameCategory(from: string, to: string) {
    userCats = [...new Set(userCats.map((c) => (c === from ? to : c)))];
    lockedCats = [...new Set(lockedCats.map((c) => (c === from ? to : c)))];
    memos = memos.map((m) => {
      if (m.category !== from) return m;
      touch(`memo:${m.id}`);
      return { ...m, category: to, updatedAt: Date.now() };
    });
    touch("meta:userCats");
    touch("meta:lockedCats");
    commit();
  },
  /** 여러 변경을 한 번에 적용 (정리 제안 수락). 잠긴 메모와 잠긴 분류는 건드리지 않는다 */
  apply(newCats: string[], moves: { id: string; to: string }[]) {
    userCats = [...new Set([...userCats, ...newCats])];
    const to = new Map(moves.filter((m) => !lockedCats.includes(m.to)).map((m) => [m.id, m.to]));
    memos = memos.map((m) => {
      if (!to.has(m.id) || m.locked) return m;
      touch(`memo:${m.id}`);
      return { ...m, category: to.get(m.id)!, classifiedBy: "ai", updatedAt: Date.now() };
    });
    touch("meta:userCats");
    commit();
  },

  // ---------- 사용자가 고친 분류 ----------
  corrections: () => corrections,
  addCorrection(c: Omit<Correction, "at">) {
    // 잠긴 메모 내용은 예시로도 남기지 않는다 (호출하는 쪽에서 걸러서 온다)
    corrections = [{ ...c, text: c.text.slice(0, 300), at: Date.now() }, ...corrections].slice(0, 100);
    touch("meta:corrections");
    commit();
  },

  // ---------- 연재 ----------
  /** 새 연재 만들기: 같은 이름의 분류도 함께 만든다 */
  addSeries(name: string, unit: string) {
    if (!seriesDefs.some((s) => s.name === name)) seriesDefs = [...seriesDefs, { name, unit }];
    if (!userCats.includes(name)) userCats = [...userCats, name];
    touch("meta:seriesDefs");
    touch("meta:userCats");
    commit();
  },
  seriesList() {
    const map = new Map<string, { name: string; last: number; unit: string; count: number; lastAt: number }>(
      seriesDefs.map((d) => [d.name, { name: d.name, last: 0, unit: d.unit, count: 0, lastAt: 0 }]),
    );
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
    const todo: Todo = { id: crypto.randomUUID(), createdAt: Date.now(), done: false, ...t, updatedAt: Date.now() };
    todos = [todo, ...todos];
    touch(`todo:${todo.id}`);
    commit();
    return todo;
  },
  updateTodo(id: string, patch: Partial<Todo>) {
    todos = todos.map((t) => (t.id === id ? { ...t, ...patch, updatedAt: Date.now() } : t));
    touch(`todo:${id}`);
    commit();
  },
  removeTodo(id: string) {
    todos = todos.filter((t) => t.id !== id);
    deleted[`todo:${id}`] = Date.now();
    touch(`todo:${id}`);
    commit();
  },

  // ---------- 동기화 ----------
  sync: {
    /** 보관함처럼 store 밖에서 관리하는 항목을 동기화에 연결한다 */
    registerMeta(name: MetaName, io: { get(): unknown; set(v: unknown): void }) {
      externalMeta[name] = io;
    },
    markMeta(name: MetaName) {
      touch(`meta:${name}`);
      commit();
    },
    hasPending: () => dirty.size > 0,
    /** 처음 로그인했을 때: 이 기기의 모든 것을 올릴 대상으로 */
    markAll() {
      memos.forEach((m) => dirty.add(`memo:${m.id}`));
      todos.forEach((t) => dirty.add(`todo:${t.id}`));
      META_NAMES.forEach((n) => {
        dirty.add(`meta:${n}`);
        metaTime[n] ??= 0;
      });
      commit();
    },
    pending(): SyncRecord[] {
      const out: SyncRecord[] = [];
      for (const key of dirty) {
        const [kind, ...rest] = key.split(":");
        const id = rest.join(":");
        if (kind === "memo" || kind === "todo") {
          const item = kind === "memo" ? memos.find((m) => m.id === id) : todos.find((t) => t.id === id);
          if (item) out.push({ kind, id, data: item, updated_at: item.updatedAt ?? item.createdAt, deleted: false });
          else if (deleted[key]) out.push({ kind, id, data: null, updated_at: deleted[key], deleted: true });
        } else if (kind === "meta") {
          const name = id as MetaName;
          out.push({ kind: "meta", id: name, data: metaValue(name), updated_at: metaTime[name] ?? 0, deleted: false });
        }
      }
      return out;
    },
    /** 서버에 올라간 것은 변경 목록에서 뺀다 (올리는 사이 또 바뀐 건 남긴다) */
    pushed(records: SyncRecord[]) {
      for (const r of records) {
        const key = `${r.kind}:${r.id}`;
        const now = r.kind === "meta" ? (metaTime[r.id as MetaName] ?? 0) : r.kind === "memo" ? memos.find((m) => m.id === r.id)?.updatedAt : todos.find((t) => t.id === r.id)?.updatedAt;
        if (r.deleted || (now ?? 0) <= r.updated_at) dirty.delete(key);
      }
      commit();
    },
    /** 서버에서 받은 것을 합친다: 더 최근에 바뀐 쪽이 이긴다 */
    applyRemote(records: SyncRecord[]): number {
      let changed = 0;
      for (const r of records) {
        const key = `${r.kind}:${r.id}`;
        if (r.kind === "meta") {
          const name = r.id as MetaName;
          if ((metaTime[name] ?? -1) >= r.updated_at || r.data == null) continue;
          setMetaValue(name, r.data);
          metaTime[name] = r.updated_at;
          dirty.delete(key);
          changed++;
          continue;
        }
        const list: { id: string; updatedAt?: number; createdAt: number }[] = r.kind === "memo" ? memos : todos;
        const local = list.find((x) => x.id === r.id);
        const localTime = local ? (local.updatedAt ?? local.createdAt) : (deleted[key] ?? -1);
        if (localTime >= r.updated_at) continue;
        if (r.deleted) {
          if (r.kind === "memo") memos = memos.filter((m) => m.id !== r.id);
          else todos = todos.filter((t) => t.id !== r.id);
          deleted[key] = r.updated_at;
        } else if (r.kind === "memo") {
          const m = { ...(r.data as Memo), kind: (r.data as Memo).kind ?? "note" };
          memos = local ? memos.map((x) => (x.id === r.id ? m : x)) : [...memos, m].sort((a, b) => b.createdAt - a.createdAt);
        } else {
          const t = r.data as Todo;
          todos = local ? todos.map((x) => (x.id === r.id ? t : x)) : [t, ...todos];
        }
        dirty.delete(key);
        changed++;
      }
      if (changed) commit();
      return changed;
    },
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
    fresh.forEach((m) => touch(`memo:${m.id}`));
    todos.forEach((t) => !knownT.has(t.id) && touch(`todo:${t.id}`));
    touch("meta:userCats");
    touch("meta:lockedCats");
    commit();
    return fresh.length;
  },
};

export const settings = {
  get: () => read<Settings>(SETTINGS_KEY, { apiKey: "" }),
  /** 바꾼 항목만 넘기면 나머지는 유지된다 */
  set: (patch: Partial<Settings>) => write(SETTINGS_KEY, { ...settings.get(), ...patch }),
};
