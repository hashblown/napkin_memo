// 잠근 분류(보관함)의 암호화.
// PIN을 정하면 공개키/개인키 한 쌍을 만든다. 개인키는 PIN으로 암호화해 저장하고,
// 공개키는 그대로 둔다 → 잠겨 있어도 새 메모는 바로 암호화되고, 읽을 때만 PIN이 필요하다.

import { store, type Memo } from "./store";

const META_KEY = "napkin.vault.v2";
const AUTO_LOCK_MS = 5 * 60_000;

interface VaultMeta {
  salt: string;
  publicKey: string;
  /** PIN에서 만든 키로 암호화한 개인키 */
  privateKey: string;
}

let privateKey: CryptoKey | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();
/** 잠금 해제 중 복호화해 둔 본문 (메모리에만) */
const plain = new Map<string, string>();

const enc = new TextEncoder();
const dec = new TextDecoder();
const b64 = (buf: ArrayBuffer | Uint8Array) => {
  let s = "";
  new Uint8Array(buf).forEach((b) => (s += String.fromCharCode(b)));
  return btoa(s);
};
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0)) as Uint8Array<ArrayBuffer>;
const RSA = { name: "RSA-OAEP", hash: "SHA-256" } as const;

function meta(): VaultMeta | null {
  try {
    return JSON.parse(localStorage.getItem(META_KEY) ?? "null");
  } catch {
    return null;
  }
}

async function pinKey(pin: string, salt: Uint8Array<ArrayBuffer>) {
  const base = await crypto.subtle.importKey("raw", enc.encode(pin), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: 310_000, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

async function aesEncrypt(key: CryptoKey, data: Uint8Array<ArrayBuffer>) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  return `${b64(iv)}.${b64(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, data))}`;
}

async function aesDecrypt(key: CryptoKey, s: string) {
  const [iv, ct] = s.split(".").map(unb64);
  return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct));
}

/** 공개키로 암호화: 무작위 AES 키로 본문을 암호화하고, 그 키를 공개키로 감싼다 */
async function seal(text: string) {
  const mt = meta()!;
  const pub = await crypto.subtle.importKey("spki", unb64(mt.publicKey), RSA, false, ["encrypt"]);
  const aes = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt"]);
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", aes));
  const wrapped = b64(await crypto.subtle.encrypt(RSA, pub, raw));
  return `${wrapped}.${await aesEncrypt(aes, enc.encode(text))}`;
}

async function open(cipher: string, key: CryptoKey) {
  const [wrapped, iv, ct] = cipher.split(".");
  const raw = await crypto.subtle.decrypt(RSA, key, unb64(wrapped));
  const aes = await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["decrypt"]);
  return dec.decode(await aesDecrypt(aes, `${iv}.${ct}`));
}

function touch() {
  clearTimeout(timer);
  timer = setTimeout(() => vault.lock(), AUTO_LOCK_MS);
}

function emit() {
  listeners.forEach((fn) => fn());
}

export const vault = {
  hasPin: () => !!meta(),
  isOpen: () => !!privateKey,
  subscribe(fn: () => void) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },

  /** 처음 PIN 설정: 지금까지 숨겨만 두었던 잠긴 메모를 모두 암호화한다 */
  async setPin(pin: string) {
    const pair = await crypto.subtle.generateKey({ ...RSA, modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]) }, true, [
      "encrypt",
      "decrypt",
    ]);
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const pk = await pinKey(pin, salt);
    const pkcs8 = new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
    const m: VaultMeta = {
      salt: b64(salt),
      publicKey: b64(await crypto.subtle.exportKey("spki", pair.publicKey)),
      privateKey: await aesEncrypt(pk, pkcs8),
    };
    localStorage.setItem(META_KEY, JSON.stringify(m));
    store.sync.markMeta("vault");
    privateKey = await crypto.subtle.importKey("pkcs8", pkcs8, RSA, false, ["decrypt"]);
    for (const memo of store.all()) if (memo.locked && !memo.cipher) await vault.seal(memo);
    touch();
    emit();
  },

  async unlock(pin: string) {
    const mt = meta();
    if (!mt) return false;
    try {
      const pkcs8 = await aesDecrypt(await pinKey(pin, unb64(mt.salt)), mt.privateKey);
      privateKey = await crypto.subtle.importKey("pkcs8", pkcs8, RSA, false, ["decrypt"]);
    } catch {
      return false; // PIN이 틀리면 복호화 인증에 실패한다
    }
    plain.clear();
    for (const m of store.all()) if (m.cipher) plain.set(m.id, await open(m.cipher, privateKey));
    touch();
    emit();
    return true;
  },

  lock() {
    privateKey = null;
    plain.clear();
    clearTimeout(timer);
    emit();
  },

  /** 잠긴 메모의 본문. 볼 수 없으면 null */
  read(m: Memo): string | null {
    if (!m.locked) return m.text;
    if (!m.cipher) return m.text; // PIN 설정 전: 숨겨만 둔 상태 (앱 안에서는 볼 수 있음)
    return privateKey ? (plain.get(m.id) ?? null) : null;
  },

  /** 메모를 잠근다: AI 대상에서 빠지고, PIN이 있으면 바로 암호화 */
  async seal(m: Memo, category?: string) {
    const patch: Partial<Memo> = { locked: true, ...(category ? { category, classifiedBy: "user" as const } : {}) };
    if (vault.hasPin() && !m.cipher) {
      const text = vault.read(m) ?? m.text;
      patch.cipher = await seal(text);
      if (privateKey) plain.set(m.id, text);
      Object.assign(patch, { text: "", tags: [], useWhen: [], link: undefined, series: undefined });
    }
    store.update(m.id, patch);
  },

  /** 잠금에서 꺼낸다 (볼 수 있는 상태에서만) */
  unseal(m: Memo, category: string) {
    const text = vault.read(m);
    if (text === null) return false;
    store.update(m.id, { locked: false, cipher: undefined, text, category, classifiedBy: "user" });
    plain.delete(m.id);
    return true;
  },
};

// 다른 기기에서도 같은 잠금 번호로 보관함을 열 수 있게, 잠금 정보(개인키는 잠금 번호로 암호화된 채)를 동기화한다
store.sync.registerMeta("vault", {
  get: () => meta(),
  set(v) {
    const local = meta();
    const remote = v as VaultMeta;
    // 이 기기에 이미 다른 잠금 정보가 있으면 덮어쓰지 않는다 (그 키로 잠근 메모를 못 열게 되므로)
    if (local && local.publicKey !== remote.publicKey) return;
    localStorage.setItem(META_KEY, JSON.stringify(remote));
  },
});

// 앱이 가려지면(다른 앱으로 전환 등) 바로 잠근다
document.addEventListener("visibilitychange", () => {
  if (document.hidden && privateKey) vault.lock();
});
