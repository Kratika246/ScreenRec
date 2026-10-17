const domain = () => (import.meta.env.WXT_COGNITO_DOMAIN || '').replace(/\/$/, '');
const clientId = () => import.meta.env.WXT_COGNITO_CLIENT_ID || '';
const encode = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
let refreshing: Promise<string> | undefined;
async function exchange(body: URLSearchParams) {
  const res = await fetch(`${domain()}/oauth2/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  if (!res.ok) throw new Error('Sign-in expired. Please sign in again.');
  const data = await res.json();
  const existing = await chrome.storage.local.get('refreshToken');
  await chrome.storage.local.set({ authToken: data.id_token, refreshToken: data.refresh_token || existing.refreshToken, expiresAt: Date.now() + data.expires_in * 1000 });
  return data.id_token as string;
}
export async function signIn() {
  if (!domain() || !clientId()) throw new Error('Configure Cognito domain and client ID first.');
  const verifier = encode(crypto.getRandomValues(new Uint8Array(32)));
  const state = encode(crypto.getRandomValues(new Uint8Array(24)));
  const challenge = encode(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
  const redirect = chrome.identity.getRedirectURL();
  const params = new URLSearchParams({ client_id: clientId(), response_type: 'code', redirect_uri: redirect, scope: 'openid email profile', state, code_challenge: challenge, code_challenge_method: 'S256' });
  const callback = await chrome.identity.launchWebAuthFlow({ url: `${domain()}/oauth2/authorize?${params}`, interactive: true });
  if (!callback || !callback.startsWith(redirect)) throw new Error('Invalid sign-in redirect.');
  const result = new URL(callback).searchParams;
  if (result.get('state') !== state || !result.get('code')) throw new Error('Sign-in canceled or invalid OAuth state.');
  await exchange(new URLSearchParams({ grant_type: 'authorization_code', client_id: clientId(), code: result.get('code')!, redirect_uri: redirect, code_verifier: verifier }));
}
export async function token(): Promise<string> {
  const stored = await chrome.storage.local.get(['authToken', 'expiresAt', 'refreshToken']);
  if (stored.authToken && Number(stored.expiresAt) > Date.now() + 60000) return stored.authToken as string;
  if (!stored.refreshToken) throw new Error('Sign in before cloud recording, or choose Local recording.');
  refreshing ??= exchange(new URLSearchParams({ grant_type: 'refresh_token', client_id: clientId(), refresh_token: stored.refreshToken as string })).finally(() => { refreshing = undefined; });
  return refreshing;
}
export async function signOut() {
  const { refreshToken } = await chrome.storage.local.get('refreshToken');
  await chrome.storage.local.remove(['authToken', 'refreshToken', 'expiresAt']);
  if (refreshToken) await fetch(`${domain()}/oauth2/revoke`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: clientId(), token: refreshToken as string }) }).catch(() => {});
  if (domain() && clientId()) await chrome.identity.launchWebAuthFlow({ url: `${domain()}/logout?${new URLSearchParams({ client_id: clientId(), logout_uri: chrome.identity.getRedirectURL() })}`, interactive: true }).catch(() => {});
}
export async function api(path: string, body?: object, method?: string) {
  const base = (import.meta.env.WXT_API_BASE || '').replace(/\/$/, '');
  if (!base) throw new Error('Missing WXT_API_BASE configuration.');
  const response = await fetch(`${base}${path}`, { method: method || (body ? 'POST' : 'GET'), headers: { Authorization: `Bearer ${await token()}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const data = await response.json();
  if (!response.ok) throw new Error(`${data.error || 'Request failed. Please retry.'}${data.requestId ? ' (Reference: ' + data.requestId + ')' : ''}`);
  return data;
}
