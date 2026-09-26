// 아이폰 앱(WKWebView) 안에서 돌고 있는지, 그리고 앱으로 메시지 보내기

type Handler = { postMessage(message: unknown): void };
declare global {
  interface Window {
    webkit?: { messageHandlers?: { napkin?: Handler } };
    napkinNative?: { ingest(payload: NativePayload): Promise<void>; authCallback(url: string): Promise<void> };
  }
}

export interface NativePayload {
  memos: { id: string; text: string; at: number }[];
  actions: { id: string; itemID: string; action: "done" | "snooze"; at: number }[];
}

export const isNative = () => !!window.webkit?.messageHandlers?.napkin;

export function postNative(message: Record<string, unknown>) {
  window.webkit?.messageHandlers?.napkin?.postMessage(message);
}
