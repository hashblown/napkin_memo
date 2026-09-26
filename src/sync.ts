// 로그인 동기화: 기기에 먼저 저장하고, 로그인하면 Supabase와 주고받는다.
// 받기 → 합치기(더 최근 것이 이김) → 올리기 순서로, 앱을 열 때 · 돌아올 때 · 바뀐 뒤 2초 · 1분마다 돈다.

import type { Session, SupabaseClient } from "@supabase/supabase-js";
import { store, type SyncRecord } from "./store";
import { isNative, postNative } from "./bridge";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config";

const CURSOR_KEY = "napkin.sync.cursor.v1";
const OWNER_KEY = "napkin.sync.owner.v1";
const LAST_KEY = "napkin.sync.last.v1";
const TABLE = "items";
const PAGE = 500;

export type Provider = "google" | "kakao";
export interface SyncState {
  configured: boolean;
  user: { id: string; name: string; email: string; provider: string } | null;
  status: "off" | "idle" | "syncing" | "error";
  lastSyncAt: number | null;
  error: string | null;
  pending: number;
}

let client: SupabaseClient | null = null;
let session: Session | null = null;
let status: SyncState["status"] = "off";
let error: string | null = null;
let running = false;
let again = false;
let timer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();

const read = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const write = (k: string, v: string | null) => {
  try {
    if (v === null) localStorage.removeItem(k);
    else localStorage.setItem(k, v);
  } catch {
    /* 무시 */
  }
};

export const syncConfigured = () => !!(SUPABASE_URL && SUPABASE_ANON_KEY);
export const onSyncChange = (fn: () => void) => listeners.add(fn);
const emit = () => listeners.forEach((fn) => fn());

export function syncState(): SyncState {
  const u = session?.user;
  const meta = (u?.user_metadata ?? {}) as Record<string, string>;
  const last = read(LAST_KEY);
  return {
    configured: syncConfigured(),
    user: u
      ? {
          id: u.id,
          name: meta.full_name || meta.name || meta.nickname || meta.preferred_username || "",
          email: u.email ?? "",
          provider: (u.app_metadata?.provider as string) ?? "",
        }
      : null,
    status,
    lastSyncAt: last ? Number(last) : null,
    error,
    pending: store.sync.pending().length,
  };
}

export async function initSync() {
  if (!syncConfigured()) return;
  // 동기화를 쓸 때만 불러온다 (첫 화면을 가볍게)
  const { createClient } = await import("@supabase/supabase-js");
  client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { flowType: "pkce", persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: "napkin.auth" },
  });
  client.auth.onAuthStateChange((_event, s) => {
    const before = session?.user.id;
    session = s;
    status = s ? "idle" : "off";
    if (s && s.user.id !== before) {
      // 이 계정으로 처음 동기화하는 기기면 기기에 있던 메모를 전부 올린다
      if (read(OWNER_KEY) !== s.user.id) {
        write(CURSOR_KEY, null);
        store.sync.markAll();
        write(OWNER_KEY, s.user.id);
      }
      // onAuthStateChange 안에서 바로 요청하면 막힐 수 있어 한 박자 뒤에
      setTimeout(() => void syncNow(), 0);
    }
    emit();
  });
  store.subscribe(() => {
    if (session && store.sync.hasPending()) schedule(2000);
  });
  document.addEventListener("visibilitychange", () => !document.hidden && void syncNow());
  window.addEventListener("online", () => void syncNow());
  setInterval(() => void syncNow(), 60_000);
}

function schedule(ms: number) {
  clearTimeout(timer);
  timer = setTimeout(() => void syncNow(), ms);
}

export async function signIn(provider: Provider) {
  if (!client) return;
  if (isNative()) {
    // 앱 안 웹 화면에서는 Google이 로그인을 막으므로, 아이폰의 시스템 로그인 창으로 연다
    const { data, error: e } = await client.auth.signInWithOAuth({
      provider,
      options: { redirectTo: "napkin://auth-callback", skipBrowserRedirect: true },
    });
    if (e) throw e;
    postNative({ type: "oauth", url: data.url });
    return;
  }
  const { error: e } = await client.auth.signInWithOAuth({ provider, options: { redirectTo: `${location.origin}${location.pathname}` } });
  if (e) throw e;
}

/** 아이폰 앱: 시스템 로그인 창이 napkin://auth-callback?code=… 로 돌아오면 세션으로 바꾼다 */
export async function completeNativeAuth(callbackUrl: string) {
  if (!client) return;
  const url = new URL(callbackUrl);
  const code = url.searchParams.get("code");
  const err = url.searchParams.get("error_description") ?? url.searchParams.get("error");
  if (err) throw new Error(err);
  if (code) await client.auth.exchangeCodeForSession(code);
}

/** 로그아웃해도 이 기기의 메모는 그대로 둔다 */
export async function signOut() {
  if (!client) return;
  await client.auth.signOut();
  write(CURSOR_KEY, null);
  write(OWNER_KEY, null);
  session = null;
  status = "off";
  emit();
}

export async function syncNow(): Promise<boolean> {
  if (!client || !session || !navigator.onLine) return false;
  if (running) {
    again = true;
    return false;
  }
  running = true;
  status = "syncing";
  error = null;
  emit();
  try {
    await pull();
    await push();
    write(LAST_KEY, String(Date.now()));
    status = "idle";
    return true;
  } catch (e) {
    status = "error";
    error = e instanceof Error ? e.message : String(e);
    return false;
  } finally {
    running = false;
    emit();
    if (again) {
      again = false;
      schedule(500);
    }
  }
}

async function pull() {
  let cursor = read(CURSOR_KEY) ?? "1970-01-01T00:00:00Z";
  for (;;) {
    const { data, error: e } = await client!
      .from(TABLE)
      .select("kind,id,data,updated_at,deleted,synced_at")
      .gt("synced_at", cursor)
      .order("synced_at", { ascending: true })
      .limit(PAGE);
    if (e) throw e;
    const rows = (data ?? []) as (SyncRecord & { synced_at: string })[];
    if (!rows.length) break;
    store.sync.applyRemote(rows.map((r) => ({ ...r, updated_at: Number(r.updated_at) })));
    cursor = rows[rows.length - 1].synced_at;
    write(CURSOR_KEY, cursor);
    if (rows.length < PAGE) break;
  }
}

async function push() {
  const records = store.sync.pending();
  const userId = session!.user.id;
  for (let i = 0; i < records.length; i += 200) {
    const chunk = records.slice(i, i + 200);
    const { error: e } = await client!.from(TABLE).upsert(
      chunk.map((r) => ({ user_id: userId, kind: r.kind, id: r.id, data: r.data, updated_at: r.updated_at, deleted: r.deleted })),
      { onConflict: "user_id,kind,id" },
    );
    if (e) throw e;
    store.sync.pushed(chunk);
  }
}
