// API 키가 없거나 오프라인일 때 쓰는 가벼운 로컬 분류/검색.

import type { Memo } from "./store";

const RULES: { category: string; words: string[]; useWhen: string[] }[] = [
  { category: "할 일", words: ["해야", "하기", "사기", "예약", "연락", "보내기", "까먹지", "todo", "내일", "마감"], useWhen: ["하루 계획 세울 때"] },
  { category: "사업·기획", words: ["서비스", "앱", "사업", "고객", "기획", "아이템", "수익", "마케팅", "브랜드", "스타트업", "제품"], useWhen: ["기획 회의 전", "새 프로젝트 구상할 때"] },
  { category: "글감", words: ["문장", "제목", "글", "이야기", "소설", "에세이", "카피", "표현", "단어", "시"], useWhen: ["글이 막힐 때", "콘텐츠 주제가 필요할 때"] },
  { category: "디자인·시각", words: ["색", "디자인", "폰트", "레이아웃", "사진", "그림", "로고", "ui", "ux", "배치"], useWhen: ["디자인 작업 전"] },
  { category: "관찰", words: ["봤다", "보니", "사람들", "카페", "길에서", "지하철", "왜", "신기", "발견"], useWhen: ["사람을 이해하고 싶을 때", "새로운 관점이 필요할 때"] },
  { category: "배움", words: ["책", "강의", "배운", "읽은", "공부", "인용", "말했다", "원리", "개념"], useWhen: ["공부 방향을 잡을 때"] },
  { category: "마음·성찰", words: ["느낌", "기분", "나는", "행복", "불안", "감사", "후회", "다짐", "마음"], useWhen: ["마음이 지칠 때", "방향을 잃었을 때"] },
];

/** 사용자가 고친 메모 중 가장 비슷한 것의 분류 (비슷한 게 없으면 null) */
export function learnedCategory(text: string, labeled: { text: string; category: string }[]): string | null {
  const q = grams(text);
  if (!q.size) return null;
  let best: { category: string; score: number } | null = null;
  for (const l of labeled) {
    const g = grams(l.text);
    let hit = 0;
    q.forEach((x) => g.has(x) && hit++);
    const score = hit / Math.sqrt(q.size * g.size || 1);
    if (!best || score > best.score) best = { category: l.category, score };
  }
  return best && best.score >= 0.3 ? best.category : null;
}

export function classifyLocally(text: string, labeled: { text: string; category: string }[] = []): Pick<Memo, "category" | "tags" | "useWhen"> {
  const learned = learnedCategory(text, labeled);
  const tags0 = [...new Set((text.match(/#[\p{L}\p{N}_]+/gu) ?? []).map((t) => t.slice(1)))];
  if (learned) return { category: learned, tags: tags0, useWhen: [] };
  const lower = text.toLowerCase();
  let best = { category: "떠오른 생각", score: 0, useWhen: ["그냥 새로운 자극이 필요할 때"] };
  for (const r of RULES) {
    const score = r.words.filter((w) => lower.includes(w)).length;
    if (score > best.score) best = { category: r.category, score, useWhen: r.useWhen };
  }
  const tags = [...new Set((text.match(/#[\p{L}\p{N}_]+/gu) ?? []).map((t) => t.slice(1)))];
  return { category: best.category, tags, useWhen: best.useWhen };
}

/** 한글에도 통하도록 단어 + 글자 2-gram 단위로 쪼갠다 */
function grams(s: string): Set<string> {
  const out = new Set<string>();
  for (const w of s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean)) {
    out.add(w);
    for (let i = 0; i < w.length - 1; i++) out.add(w.slice(i, i + 2));
  }
  return out;
}

export interface Found {
  memo: Memo;
  reason: string;
}

export function inspireLocally(situation: string, memos: Memo[], n = 4): Found[] {
  const q = grams(situation);
  const scored = memos.map((m) => {
    const hay = grams([m.text, m.category, ...m.tags, ...m.useWhen].join(" "));
    let hit = 0;
    q.forEach((g) => hay.has(g) && hit++);
    return { memo: m, score: hit + Math.random() * 0.5 };
  });
  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, n - 1).filter((s) => s.score >= 1);
  // 뜻밖의 연결을 위해 관련 없는 메모 하나를 섞는다
  const rest = scored.filter((s) => !top.includes(s));
  const wild = rest[Math.floor(Math.random() * rest.length)];
  const picks: Found[] = top.map((s) => ({ memo: s.memo, reason: `「${s.memo.category}」 메모 중 지금 상황과 겹치는 말이 있어요.` }));
  if (wild) picks.push({ memo: wild.memo, reason: "엉뚱한 조합이 새 생각을 부를 때가 있어요." });
  return picks;
}

/** 로컬 정리 제안: 서로 다른 분류에 걸쳐 2번 이상 나온 키워드를 새 분류 후보로 */
export function suggestReorgLocally(memos: Memo[], categories: string[]) {
  const byTag = new Map<string, Memo[]>();
  for (const m of memos) for (const t of m.tags) byTag.set(t, [...(byTag.get(t) ?? []), m]);
  const newCategories: { name: string; reason: string }[] = [];
  const moves: { id: string; to: string; reason: string }[] = [];
  const moved = new Set<string>();
  const ranked = [...byTag.entries()].sort((a, b) => b[1].length - a[1].length);
  for (const [tag, ms] of ranked) {
    const cats = new Set(ms.map((m) => m.category));
    if (ms.length < 2 || cats.size < 2 || categories.includes(tag) || newCategories.length >= 3) continue;
    newCategories.push({ name: tag, reason: `서로 다른 분류(${[...cats].join(", ")})에 '${tag}' 이야기가 ${ms.length}번 나와요.` });
    for (const m of ms) {
      if (m.classifiedBy === "user" || moved.has(m.id)) continue;
      moved.add(m.id);
      moves.push({ id: m.id, to: tag, reason: `#${tag}` });
    }
  }
  return { newCategories, moves };
}

const JOSA = /(에서|으로|부터|까지|처럼|보다|하고|해서|하면|해야|하기|했다|한다|은|는|이|가|을|를|에|로|도|만|와|과|의)$/;
const STOP = new Set(["그리고", "하지만", "그냥", "너무", "조금", "많이", "정말", "진짜", "이번", "다음", "처음", "마지막", "워밍업", "회차", "주차", "오늘", "생각", "느낌", "것", "때"]);

/** 연재 기록들에서 여러 회차에 반복되는 단어를 센다 (회차 수 기준) */
export function recurringKeywords(texts: string[], top = 12) {
  const df = new Map<string, number>();
  for (const t of texts) {
    const words = new Set(
      t
        .split(/[^\p{L}\p{N}]+/u)
        .map((w) => (w.length > 2 ? w.replace(JOSA, "") : w))
        .filter((w) => w.length >= 2 && !STOP.has(w) && !/^\d+$/.test(w)),
    );
    words.forEach((w) => df.set(w, (df.get(w) ?? 0) + 1));
  }
  return [...df.entries()]
    .filter(([, n]) => n >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, top)
    .map(([word, count]) => ({ word, count }));
}
