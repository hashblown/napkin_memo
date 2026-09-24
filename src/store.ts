// 메모 저장소: 기기 내 localStorage에 보관한다. (서버 없음 → 개인 데이터가 밖으로 나가지 않음)

export type ClassifiedBy = "ai" | "local" | "pending";

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
const listeners = new Set<() => void>();

function commit() {
  write(MEMOS_KEY, memos);
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
    const counts = new Map<string, number>();
    for (const m of memos) counts.set(m.category, (counts.get(m.category) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c);
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
