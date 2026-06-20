// QRコード経由のスタッフ向けスタンプ付与/クーポン消し込みフロー用の署名付き短命トークン。
// 店舗のLINE QRリーダーで liff.line.me URL を読むとそのままLIFFが開く仕様を利用するため、
// 専用のスキャナーUIは作らず「お客様のLIFF画面に表示したQR」をそのまま読んでもらう設計。
// トークンに有効期限を持たせることで、スクリーンショットを後から再利用される事故を防ぐ。

export interface GrantTokenPayload {
  friendId: string;
  accountId: string;
  exp: number; // epoch seconds
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(str: string): string {
  return atob(str.replace(/-/g, '+').replace(/_/g, '/'));
}

async function hmacHex(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function signGrantToken(secret: string, payload: GrantTokenPayload): Promise<string> {
  const payloadB64 = toBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const sig = await hmacHex(secret, payloadB64);
  return `${payloadB64}.${sig}`;
}

export async function verifyGrantToken(secret: string, token: string): Promise<GrantTokenPayload | null> {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payloadB64, sig] = parts;
  const expectedSig = await hmacHex(secret, payloadB64);
  if (sig !== expectedSig) return null;
  try {
    const payload = JSON.parse(fromBase64Url(payloadB64)) as GrantTokenPayload;
    if (!payload.friendId || !payload.accountId || typeof payload.exp !== 'number') return null;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}
