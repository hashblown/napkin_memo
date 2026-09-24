// 메모 저장소: 기기 내 localStorage에 보관한다. (서버 없음 → 개인 데이터가 밖으로 나가지 않음)

/** user: 사용자가 직접 정한 분류 → AI가 덮어쓰거나 옮기지 않는다 */
export type ClassifiedBy = "ai" | "local" | "pending" | "user";

export interface Memo {
  id: string;
  text: string;
  createdAt: number;
  category: string;
  tags: string[];
  /** 이 메모가 영감이 될 법한 상황들 (예: "기획 회의 전", "글이 막힐 때") */
  useWhen: string[];
  classifiedBy: ClassifiedBy;
}

export interface Settings {
  apiKey: string;
}

const MEMOS_KEY = "napkin.memos.v1";
const SETTINGS_KEY = "napkin.settings.v1";
const CATS_KEY = "napkin.categories.v1";

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

let memos: Memo[] = read<Memo[]>(MEMOS_KEY, []);
/** 사용자가 직접 만든 분류 (아직 메모가 없어도 유지) */
let userCats: string[] = read<string[]>(CATS_KEY, []);
const listeners = new Set<() => void>();

function commit() {
  write(MEMOS_KEY, memos);
  write(CATS_KEY, userCats);
  listeners.forEach((fn) => fn());
}

export const store = {
  all: () => memos,
  get: (id: string) => memos.find((m) => m.id === id),
  subscribe(fn: () => void) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  add(text: string): Memo {
    const memo: Memo = {
      id: crypto.randomUUID(),
      text,
      createdAt: Date.now(),
      category: "미분류",
      tags: [],
      useWhen: [],
      classifiedBy: "pending",
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
    commit();
  },
  categories(): string[] {
    const counts = new Map<string, number>(userCats.map((c) => [c, 0]));
    for (const m of memos) counts.set(m.category, (counts.get(m.category) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c);
  },
  addCategory(name: string) {
    if (!userCats.includes(name)) userCats = [...userCats, name];
    commit();
  },
  /** 이름 바꾸기. 이미 있는 이름이면 두 분류가 합쳐진다 */
  renameCategory(from: string, to: string) {
    userCats = [...new Set(userCats.map((c) => (c === from ? to : c)))];
    memos = memos.map((m) => (m.category === from ? { ...m, category: to } : m));
    commit();
  },
  /** 여러 변경을 한 번에 적용 (정리 제안 수락) */
  apply(newCats: string[], moves: { id: string; to: string }[]) {
    userCats = [...new Set([...userCats, ...newCats])];
    const to = new Map(moves.map((m) => [m.id, m.to]));
    memos = memos.map((m) => (to.has(m.id) ? { ...m, category: to.get(m.id)!, classifiedBy: "ai" } : m));
    commit();
  },
  exportJson: () => JSON.stringify({ version: 1, memos }, null, 2),
  importJson(json: string): number {
    const data = JSON.parse(json) as { memos?: Memo[] };
    const incoming = (data.memos ?? []).filter((m) => m.id && typeof m.text === "string");
    const known = new Set(memos.map((m) => m.id));
    const fresh = incoming.filter((m) => !known.has(m.id));
    memos = [...fresh, ...memos].sort((a, b) => b.createdAt - a.createdAt);
    commit();
    return fresh.length;
  },
};

export const settings = {
  get: () => read<Settings>(SETTINGS_KEY, { apiKey: "" }),
  set: (s: Settings) => write(SETTINGS_KEY, s),
};
