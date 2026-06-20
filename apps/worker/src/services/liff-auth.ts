// LIFF id_token verification.
// Mirrors the helper in routes/booking.ts but lives in services/ so that new
// route modules (e.g. events.ts) can import & share it. booking.ts keeps its
// own copy for now to avoid touching production-stable code in this PR.

import { getLineAccounts } from '@line-crm/db';

export interface VerifyEnv {
  LINE_LOGIN_CHANNEL_ID?: string;
  DB: D1Database;
}

export interface CallerProfile {
  lineUserId: string;
  displayName: string | null;
  pictureUrl: string | null;
}

/** id_token検証の共通本体。profile scopeがあれば name/picture も一緒に返す。 */
async function verifyIdTokenAgainstCandidates(idToken: string, env: VerifyEnv): Promise<CallerProfile | null> {
  const candidates: string[] = [];
  if (env.LINE_LOGIN_CHANNEL_ID) candidates.push(env.LINE_LOGIN_CHANNEL_ID);
  const dbAccounts = await getLineAccounts(env.DB);
  for (const a of dbAccounts) {
    const ch = (a as unknown as { login_channel_id?: string | null }).login_channel_id;
    if (ch && !candidates.includes(ch)) candidates.push(ch);
  }
  for (const channelId of candidates) {
    const res = await fetch('https://api.line.me/oauth2/v2.1/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ id_token: idToken, client_id: channelId }),
    });
    if (res.ok) {
      const verified = (await res.json()) as { sub?: string; name?: string; picture?: string };
      if (verified.sub) {
        return { lineUserId: verified.sub, displayName: verified.name ?? null, pictureUrl: verified.picture ?? null };
      }
    }
  }
  return null;
}

export async function verifyCallerLineUserId(
  authHeader: string | undefined,
  env: VerifyEnv,
): Promise<string | null> {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const idToken = authHeader.slice('Bearer '.length).trim();
  if (!idToken) return null;
  const profile = await verifyIdTokenAgainstCandidates(idToken, env);
  return profile?.lineUserId ?? null;
}

/** verifyCallerLineUserId と同じ検証だが、表示名/画像も合わせて返す (スタッフ登録フロー用)。 */
export async function verifyCallerProfile(
  authHeader: string | undefined,
  env: VerifyEnv,
): Promise<CallerProfile | null> {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const idToken = authHeader.slice('Bearer '.length).trim();
  if (!idToken) return null;
  return verifyIdTokenAgainstCandidates(idToken, env);
}
