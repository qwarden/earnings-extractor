const COOKIE_NAME = "session";
const SIGNATURE_SEP = ".";

function getSecret(): string {
  return process.env.APP_SECRET || process.env.APP_PASSWORD || "";
}

function getPassword(): string {
  return process.env.APP_PASSWORD || "";
}

async function getKey(): Promise<CryptoKey> {
  const secret = getSecret();
  const encoder = new TextEncoder();
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

function bufToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

async function sign(value: string): Promise<string> {
  const key = await getKey();
  const encoder = new TextEncoder();
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(value));
  return `${value}${SIGNATURE_SEP}${bufToBase64(sig)}`;
}

async function verify(signed: string): Promise<boolean> {
  const sep = signed.lastIndexOf(SIGNATURE_SEP);
  if (sep === -1) return false;
  const value = signed.slice(0, sep);
  const expected = await sign(value);
  if (expected.length !== signed.length) return false;
  let result = 0;
  for (let i = 0; i < expected.length; i++) {
    result |= expected.charCodeAt(i) ^ signed.charCodeAt(i);
  }
  return result === 0;
}

export async function createSessionCookie(): Promise<{
  name: string;
  value: string;
}> {
  const payload = `authenticated:${Date.now()}`;
  return { name: COOKIE_NAME, value: await sign(payload) };
}

export async function isValidSession(
  cookieValue: string | undefined
): Promise<boolean> {
  if (!cookieValue) return false;
  return verify(cookieValue);
}

export function checkPassword(password: string): boolean {
  const expected = getPassword();
  if (!expected || expected.length !== password.length) return false;
  let result = 0;
  for (let i = 0; i < expected.length; i++) {
    result |= expected.charCodeAt(i) ^ password.charCodeAt(i);
  }
  return result === 0;
}

export function isAuthEnabled(): boolean {
  return !!process.env.APP_PASSWORD;
}

export { COOKIE_NAME };
