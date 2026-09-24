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

const Classification = z.object({
  category: z.string().describe("짧은 한국어 분류명 (2~6글자). 기존 분류가 맞으면 그대로 재사용"),
  tags: z.array(z.string()).describe("핵심 키워드 1~4개"),
  useWhen: z.array(z.string()).describe("이 메모가 영감이 될 만한 구체적 상황 2~3개"),
});

export async function classify(apiKey: string, text: string, existing: string[]) {
  const res = await client(apiKey).beta.messages.parse({
    model: MODEL,
    max_tokens: 2048,
    output_config: { effort: "low", format: betaZodOutputFormat(Classification) },
    ...FALLBACK,
    system:
      "사용자가 불현듯 떠오른 생각을 냅킨에 적듯 급히 적은 메모를 정리하는 조수다. " +
      "메모를 하나의 분류로 묶고, 나중에 어떤 상황에서 이 메모를 다시 꺼내 보면 좋을지 적는다. " +
      "분류는 너무 잘게 쪼개지 말고, 기존 분류 중 맞는 것이 있으면 재사용한다. 모든 출력은 한국어로.",
    messages: [
      {
        role: "user",
        content: `기존 분류: ${existing.length ? existing.join(", ") : "(없음)"}\n\n메모:\n${text}`,
      },
    ],
  });
  if (res.stop_reason === "refusal" || !res.parsed_output) throw new Error("분류하지 못했어요.");
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
