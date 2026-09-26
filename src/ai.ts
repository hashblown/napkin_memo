// Claude로 메모를 분류하고, 상황에 맞는 메모를 골라 영감을 만들어준다.
// API 키는 사용자 기기에만 저장되고 브라우저에서 Anthropic API로 직접 호출한다.

import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import type { Memo } from "./store";

const MODEL = "claude-opus-5";
// 거절(refusal) 시 서버가 권장 모델로 자동 재시도
const FALLBACK = { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const };

function client(apiKey: string) {
  return new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 1 });
}

export function describeError(e: unknown): string {
  if (e instanceof Anthropic.AuthenticationError) return "API 키가 올바르지 않아요.";
  if (e instanceof Anthropic.RateLimitError) return "요청이 많아요. 잠시 후 다시 시도해요.";
  if (e instanceof Anthropic.APIConnectionError) return "네트워크에 연결할 수 없어요.";
  if (e instanceof Anthropic.APIError) return `API 오류 (${e.status ?? "?"})`;
  return e instanceof Error ? e.message : String(e);
}

const TODO_GUIDE =
  "할 일 판단 기준:\n" +
  "- 할 일: 사용자가 앞으로 직접 해야 하는 구체적인 행동이나 챙길 일정. 예) '보험금입금하기', '북클 예약', '치과 가야 함', '우유 사야지', " +
  "'11/13 7시 잠실 UX 밋업', '보고서 금요일까지 제출', '딥노이드 지원 (~8/20)', 목록 '장보기 / 우유 / 계란'은 항목마다 하나씩.\n" +
  "- 할 일 아님: 이미 한 일('어제 치과 다녀왔다'), 바람('복숭아 먹고싶다'), 감상·관찰, 아이디어('사이드프로젝트 아이디어 …'), " +
  "수업·운동 피드백과 배운 점('상체가 쏠리지 않도록 하기', '~라고 생각할 것'), 인용문('오늘의 문장: …'), 추천 목록('간식 추천', 영화 제목들), 공지·안내 전문.\n" +
  "- 제목은 짧은 동사형으로 다듬는다(예: '보험금 입금하기'). 날짜·시각이 있으면 due로 바꾸고, 요일·'내일'·'다음 주'는 기준 날짜로 계산한다. " +
  "메모를 적은 날짜(at)가 기준이다. 애매하면 할 일로 넣지 않는다.";

const Classification = z.object({
  category: z.string().describe("짧은 한국어 분류명 (2~6글자). 기존 분류가 맞으면 그대로 재사용"),
  tags: z.array(z.string()).describe("핵심 키워드 1~4개"),
  useWhen: z.array(z.string()).describe("이 메모가 영감이 될 만한 구체적 상황 2~3개"),
  todos: z
    .array(
      z.object({
        title: z.string().describe("짧은 할 일 문장 (예: '임대차계약서 서류 확인')"),
        due: z.string().describe("기한. 'YYYY-MM-DD' 또는 'YYYY-MM-DDTHH:mm'. 기한이 없으면 빈 문자열"),
      }),
    )
    .describe("메모에서 사용자가 실제로 해야 할 일. 일정·약속·마감·입금·예약·챙길 것 등. 감상·배운 점·조언은 넣지 않는다. 없으면 빈 배열"),
});

/** 오늘 날짜를 알려줘야 '내일', '다음 주' 같은 말을 날짜로 바꿀 수 있다 */
function nowLine() {
  const d = new Date();
  const days = "일월화수목금토";
  return `지금: ${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} (${days[d.getDay()]}) ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function parseDueString(due: string): { due: number; hasTime: boolean } | null {
  const m = due.match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/);
  if (!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3], m[4] ? +m[4] : 9, m[5] ? +m[5] : 0);
  return isNaN(d.getTime()) ? null : { due: d.getTime(), hasTime: !!m[4] };
}

export async function classify(apiKey: string, text: string, existing: string[]) {
  const res = await client(apiKey).beta.messages.parse({
    model: MODEL,
    max_tokens: 4096,
    output_config: { effort: "low", format: betaZodOutputFormat(Classification) },
    ...FALLBACK,
    system:
      "사용자가 불현듯 떠오른 생각을 냅킨에 적듯 급히 적은 메모를 정리하는 조수다. " +
      "메모를 하나의 분류로 묶고, 나중에 어떤 상황에서 이 메모를 다시 꺼내 보면 좋을지 적는다. " +
      "메모 안에 해야 할 일이 있으면 할 일로 뽑고, 날짜나 시각이 있으면 기한으로 바꾼다. " +
      TODO_GUIDE +
      "\n" +
      "분류는 너무 잘게 쪼개지 말고, 기존 분류 중 맞는 것이 있으면 재사용한다. 모든 출력은 한국어로.",
    messages: [
      {
        role: "user",
        content: `${nowLine()}\n기존 분류: ${existing.length ? existing.join(", ") : "(없음)"}\n\n메모:\n${text}`,
      },
    ],
  });
  if (res.stop_reason === "refusal" || !res.parsed_output) throw new Error("분류하지 못했어요.");
  return res.parsed_output;
}

const BatchResult = z.object({
  results: z.array(
    z.object({
      id: z.string(),
      category: z.string().describe("짧은 한국어 분류명 (2~6글자). 기존 분류 · 사용자가 고친 예시를 우선 따른다"),
      tags: z.array(z.string()).describe("핵심 키워드 1~4개"),
      useWhen: z.array(z.string()).describe("이 메모가 영감이 될 만한 구체적 상황 2~3개"),
      todos: z
        .array(z.object({ title: z.string(), due: z.string().describe("'YYYY-MM-DD' 또는 'YYYY-MM-DDTHH:mm'. 없으면 빈 문자열") }))
        .describe("실제로 해야 할 일. 감상·배운 점·조언은 넣지 않는다. 없으면 빈 배열"),
    }),
  ),
});

export type Example = { text: string; category?: string; todo?: boolean };

/** 여러 메모를 한 번에 정리한다. 사용자가 고친 분류를 예시로 넘겨 그 기준을 따르게 한다 */
export async function classifyBatch(
  apiKey: string,
  memos: { id: string; text: string; createdAt: number }[],
  existing: string[],
  examples: Example[],
) {
  const exampleLines = examples
    .slice(0, 40)
    .map((e) => `- "${e.text.replace(/\s+/g, " ").slice(0, 120)}" → ${[e.category ? `분류: ${e.category}` : "", e.todo === false ? "할 일 아님" : e.todo ? "할 일임" : ""].filter(Boolean).join(", ")}`)
    .join("\n");
  const res = await client(apiKey).beta.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    output_config: { effort: "low", format: betaZodOutputFormat(BatchResult) },
    ...FALLBACK,
    system:
      "사용자가 급히 적은 메모들을 정리하는 조수다. 메모마다 분류 하나, 키워드, 다시 꺼내 보면 좋을 상황, 해야 할 일을 뽑는다. " +
      "사용자가 직접 고친 예시가 있으면 그 기준을 가장 우선한다(특히 '할 일 아님'으로 고친 것과 비슷한 메모는 할 일로 넣지 않는다). " +
      "분류는 너무 잘게 쪼개지 말고 기존 분류를 재사용한다. 모든 메모에 대해 id를 그대로 돌려준다. 한국어로 답한다.\n\n" +
      TODO_GUIDE,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `기존 분류: ${existing.join(", ") || "(없음)"}\n\n사용자가 고친 예시:\n${exampleLines || "(없음)"}`,
            cache_control: { type: "ephemeral" },
          },
          {
            type: "text",
            text: `${nowLine()}\n\n정리할 메모 (JSON lines, at은 적은 날짜):\n${memos
              .map((m) => JSON.stringify({ id: m.id, at: new Date(m.createdAt).toISOString().slice(0, 10), text: m.text }))
              .join("\n")}`,
          },
        ],
      },
    ],
  });
  if (res.stop_reason === "refusal" || !res.parsed_output) throw new Error("정리하지 못했어요.");
  return res.parsed_output.results;
}

const LinkMeta = z.object({
  title: z.string().describe("페이지 제목 (짧게)"),
  summary: z.string().describe("무슨 페이지인지 한 문장 요약"),
  category: z.string().describe("짧은 분류명 (예: 쇼핑, 여행·숙소, 커리어, 읽을거리, 영상, 장소). 기존 분류가 맞으면 재사용"),
});

/** 링크 페이지를 읽어 제목·요약·분류를 만든다 (Claude의 웹 페이지 읽기 도구 사용) */
export async function describeLink(apiKey: string, url: string, note: string, existing: string[]) {
  const c = client(apiKey);
  const messages: Anthropic.Beta.BetaMessageParam[] = [
    {
      role: "user",
      content:
        `이 링크가 어떤 페이지인지 읽고 북마크로 정리해줘. 페이지를 읽을 수 없으면 주소와 메모만 보고 추정해.\n` +
        `기존 북마크 분류: ${existing.join(", ") || "(없음)"}\n링크: ${url}\n사용자 메모: ${note || "(없음)"}`,
    },
  ];
  // 서버 도구가 길어지면 pause_turn으로 멈출 수 있다 → 이어서 요청 (최대 3번)
  for (let i = 0; i < 3; i++) {
    const res = await c.beta.messages.parse({
      model: MODEL,
      max_tokens: 4096,
      output_config: { effort: "low", format: betaZodOutputFormat(LinkMeta) },
      ...FALLBACK,
      tools: [{ type: "web_fetch_20260209", name: "web_fetch", max_uses: 1 }],
      system: "사용자가 저장한 링크를 북마크로 정리하는 조수다. 한국어로 답한다.",
      messages,
    });
    if (res.stop_reason === "pause_turn") {
      messages.splice(1, messages.length - 1, { role: "assistant", content: res.content as Anthropic.Beta.BetaContentBlockParam[] });
      continue;
    }
    if (res.stop_reason === "refusal" || !res.parsed_output) break;
    return res.parsed_output;
  }
  throw new Error("링크를 정리하지 못했어요.");
}

const Step = z.object({
  step: z.string().describe("10~30분 안에 바로 할 수 있는 구체적인 첫 행동 한 문장"),
});

/** 기한 없는 할 일에 대해 '지금 해볼 첫 행동'을 제안한다 */
export async function nextStep(apiKey: string, title: string, context: string) {
  const res = await client(apiKey).beta.messages.parse({
    model: MODEL,
    max_tokens: 2048,
    output_config: { effort: "low", format: betaZodOutputFormat(Step) },
    ...FALLBACK,
    system: "미뤄둔 할 일을 작게 쪼개서 지금 바로 시작하게 돕는 조수다. 한국어로, 부담 없는 말투로.",
    messages: [{ role: "user", content: `할 일: ${title}${context ? `\n원래 메모: ${context}` : ""}` }],
  });
  if (res.stop_reason === "refusal" || !res.parsed_output) throw new Error("제안을 만들지 못했어요.");
  return res.parsed_output.step;
}

const Patterns = z.object({
  summary: z.string().describe("이 연재 기록 전체에서 보이는 흐름·성장을 2~3문장으로"),
  recurring: z
    .array(z.object({ keyword: z.string(), count: z.number().describe("등장한 기록 수"), note: z.string().describe("무엇이 반복되는지 한 문장") }))
    .describe("여러 회차에 반복해서 나오는 키워드·지적·주제 3~6개. 많이 나온 순"),
  focus: z.string().describe("다음 회차 전에 신경 쓸 한 가지"),
});

/** 연재 기록을 묶어 반복되는 키워드와 흐름을 뽑는다 */
export async function seriesPatterns(apiKey: string, name: string, entries: { n: number; date: string; text: string }[]) {
  const res = await client(apiKey).beta.messages.parse({
    model: MODEL,
    max_tokens: 8000,
    output_config: { effort: "medium", format: betaZodOutputFormat(Patterns) },
    ...FALLBACK,
    system: "사용자가 회차별로 남긴 연습·수업·운동 기록을 읽고 반복되는 패턴을 찾아주는 코치다. 한국어로 답한다.",
    messages: [
      {
        role: "user",
        content: `연재 이름: ${name}\n\n${entries.map((e) => `[${e.n}회 · ${e.date}]\n${e.text}`).join("\n\n")}`,
      },
    ],
  });
  if (res.stop_reason === "refusal" || !res.parsed_output) throw new Error("패턴을 찾지 못했어요.");
  return res.parsed_output;
}

const Inspiration = z.object({
  picks: z
    .array(z.object({ id: z.string(), reason: z.string().describe("이 상황에 왜 도움이 되는지 한 문장") }))
    .describe("상황에 도움이 될 메모 3~5개. 직접 관련된 것과 뜻밖의 연결을 섞는다"),
  spark: z.string().describe("고른 메모들을 엮어 지금 상황에 바로 써볼 수 있는 새 아이디어 2~3문장"),
});

export async function inspire(apiKey: string, situation: string, memos: Memo[]) {
  const catalog = memos
    .map((m) => JSON.stringify({ id: m.id, text: m.text, category: m.category, useWhen: m.useWhen }))
    .join("\n");
  const res = await client(apiKey).beta.messages.parse({
    model: MODEL,
    max_tokens: 8000,
    output_config: { effort: "medium", format: betaZodOutputFormat(Inspiration) },
    ...FALLBACK,
    system:
      "사용자가 그동안 적어둔 메모 더미에서, 지금 사용자가 처한 상황에 영감을 줄 메모를 골라주는 조수다. " +
      "뻔한 키워드 일치보다 생각이 확장되는 연결을 중시한다. 메모 id는 목록에 있는 것만 쓴다. 한국어로 답한다.",
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: `내 메모 목록 (JSON lines):\n${catalog}`, cache_control: { type: "ephemeral" } },
          { type: "text", text: `지금 상황: ${situation}` },
        ],
      },
    ],
  });
  if (res.stop_reason === "refusal" || !res.parsed_output) throw new Error("영감을 찾지 못했어요.");
  const byId = new Map(memos.map((m) => [m.id, m]));
  return {
    picks: res.parsed_output.picks.flatMap((p) => {
      const memo = byId.get(p.id);
      return memo ? [{ memo, reason: p.reason }] : [];
    }),
    spark: res.parsed_output.spark,
  };
}

const Reorg = z.object({
  newCategories: z
    .array(z.object({ name: z.string().describe("짧은 한국어 분류명 (2~6글자)"), reason: z.string().describe("메모들에서 어떤 경향을 봤는지 한 문장") }))
    .describe("새로 만들면 좋을 분류 0~3개. 여러 메모에 반복되는 주제·관심사가 뚜렷할 때만"),
  moves: z
    .array(z.object({ id: z.string(), to: z.string().describe("기존 분류 또는 newCategories의 이름"), reason: z.string().describe("짧은 이유") }))
    .describe("분류를 옮기면 더 잘 맞는 메모들. 현재 분류가 적절하면 넣지 않는다"),
});

export type ReorgSuggestion = z.infer<typeof Reorg>;

/** 전체 메모의 경향을 보고 새 분류와 재분류를 제안한다. 사용자가 직접 정한 메모(locked)는 옮기지 않는다 */
export async function suggestReorg(apiKey: string, memos: Memo[], categories: string[]): Promise<ReorgSuggestion> {
  const catalog = memos
    .map((m) => JSON.stringify({ id: m.id, text: m.text, category: m.category, tags: m.tags, locked: m.classifiedBy === "user" }))
    .join("\n");
  const res = await client(apiKey).beta.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    output_config: { effort: "medium", format: betaZodOutputFormat(Reorg) },
    ...FALLBACK,
    system:
      "사용자가 쌓아온 메모 전체를 보고 분류 체계를 다듬는 조수다. " +
      "여러 메모에 걸쳐 반복되는 주제나 관심사가 보이면 새 분류를 제안하고, 지금 분류보다 더 잘 맞는 곳이 있는 메모는 옮기자고 제안한다. " +
      "분류를 잘게 쪼개지 말고, 확신이 있을 때만 제안한다. locked가 true인 메모는 사용자가 직접 정한 것이니 옮기지 않는다. 한국어로 답한다.",
    messages: [
      {
        role: "user",
        content: `현재 분류: ${categories.join(", ") || "(없음)"}\n\n메모 목록 (JSON lines):\n${catalog}`,
      },
    ],
  });
  if (res.stop_reason === "refusal" || !res.parsed_output) throw new Error("정리 제안을 만들지 못했어요.");
  const ids = new Set(memos.filter((m) => m.classifiedBy !== "user").map((m) => m.id));
  const current = new Map(memos.map((m) => [m.id, m.category]));
  const out = res.parsed_output;
  return { ...out, moves: out.moves.filter((mv) => ids.has(mv.id) && current.get(mv.id) !== mv.to) };
}
