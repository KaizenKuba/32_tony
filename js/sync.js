// Synchronizacja projektów przez Supabase (konto e-mail + hasło).
// Projekty (JSON) idą do tabeli `projects`, bity i nagrania do magazynu `blobs/<user>/<klucz>`.
import { db } from './db.js';
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

const LS_SESSION = 'cloudSession';
const LS_UPLOADED = 'cloudUploaded';

export const cloud = {
  enabled: !!(SUPABASE_URL && SUPABASE_KEY),
  session: null,
  status: '',          // tekst dla użytkownika
  busy: false,
  onChange: () => {},  // wołane po zmianach z chmury (app odświeża widok)
  onStatus: () => {},
};

try { cloud.session = JSON.parse(localStorage.getItem(LS_SESSION) || 'null'); } catch (_) {}
let uploaded;
try { uploaded = new Set(JSON.parse(localStorage.getItem(LS_UPLOADED) || '[]')); } catch (_) { uploaded = new Set(); }
const markUploaded = k => { uploaded.add(k); localStorage.setItem(LS_UPLOADED, JSON.stringify([...uploaded])); };

function setStatus(s) { cloud.status = s; cloud.onStatus(); }
function setSession(s) {
  cloud.session = s;
  if (s) localStorage.setItem(LS_SESSION, JSON.stringify(s)); else localStorage.removeItem(LS_SESSION);
}
const userId = () => cloud.session?.user?.id;
export const loggedIn = () => cloud.enabled && !!cloud.session;

// ---------- auth ----------
async function authReq(path, body) {
  const r = await fetch(`${SUPABASE_URL}/auth/v1/${path}`, {
    method: 'POST', headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.msg || j.error_description || j.message || `Błąd ${r.status}`);
  return j;
}
const withExpiry = j => ({ ...j, expires_at: j.expires_at || Math.floor(Date.now() / 1000) + (j.expires_in || 3600) });

export async function signIn(email, password) {
  setSession(withExpiry(await authReq('token?grant_type=password', { email, password })));
  uploaded = new Set(); localStorage.removeItem(LS_UPLOADED);
  await syncAll();
}
export async function signUp(email, password) {
  const j = await authReq('signup', { email, password });
  if (j.access_token) { setSession(withExpiry(j)); await syncAll(); return true; }
  return false; // trzeba potwierdzić e-mail
}
export function signOut() { setSession(null); setStatus(''); cloud.onChange(); }

async function token() {
  const s = cloud.session;
  if (!s) throw new Error('Niezalogowany');
  if (s.expires_at - 60 < Date.now() / 1000) {
    try { setSession(withExpiry(await authReq('token?grant_type=refresh_token', { refresh_token: s.refresh_token }))); }
    catch (e) { setSession(null); cloud.onChange(); throw e; }
  }
  return cloud.session.access_token;
}
async function api(path, opts = {}) {
  const r = await fetch(`${SUPABASE_URL}${path}`, {
    ...opts, headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${await token()}`, ...(opts.headers || {}) },
  });
  if (!r.ok) throw new Error(`${r.status} ${(await r.text()).slice(0, 200)}`);
  return r;
}

// ---------- pliki audio ----------
const blobKeys = p => [p.beatKey, p.undo?.beatKey, ...p.tracks.flatMap(t => t.takes.map(k => k.key))].filter(Boolean);
const objPath = k => `blobs/${userId()}/${encodeURIComponent(k)}`;

async function uploadBlob(key) {
  if (uploaded.has(key)) return;
  const blob = await db.getBlob(key);
  if (!blob) return;
  await api(`/storage/v1/object/${objPath(key)}`, {
    method: 'POST', headers: { 'x-upsert': 'true', 'Content-Type': blob.type || 'application/octet-stream' }, body: blob,
  });
  markUploaded(key);
}

/** Pobiera brakujący plik z chmury do lokalnej bazy. */
export async function fetchBlob(key) {
  if (!loggedIn()) return null;
  try {
    const r = await api(`/storage/v1/object/authenticated/${objPath(key)}`);
    const blob = await r.blob();
    await db.putBlob(key, blob);
    markUploaded(key);
    return blob;
  } catch (_) { return null; }
}

// ---------- projekty ----------
const pending = new Map(); // id -> timer
/** Wysyła projekt po krótkiej chwili (po ostatniej zmianie). */
export function pushLater(p, deleted = false) {
  if (!loggedIn()) return;
  clearTimeout(pending.get(p.id));
  pending.set(p.id, setTimeout(() => { pending.delete(p.id); push(p, deleted).catch(e => setStatus('Błąd wysyłania: ' + e.message)); }, 1500));
}

async function push(p, deleted = false) {
  if (!deleted) for (const k of blobKeys(p)) await uploadBlob(k);
  await api('/rest/v1/projects', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ id: p.id, data: deleted ? {} : JSON.parse(JSON.stringify(p)), updated_at: p.updated || Date.now(), deleted }),
  });
  setStatus('Zsynchronizowano ' + new Date().toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' }));
}

let syncing = null;
/** Pełna synchronizacja: pobiera nowsze z chmury, wysyła nowsze lokalne. Zwraca true, jeśli coś się zmieniło lokalnie. */
export function syncAll() {
  if (!loggedIn()) return Promise.resolve(false);
  if (!syncing) syncing = doSync().finally(() => { syncing = null; cloud.busy = false; cloud.onStatus(); });
  return syncing;
}

async function doSync() {
  cloud.busy = true; setStatus('Synchronizuję…');
  try {
    const remote = await (await api('/rest/v1/projects?select=id,data,updated_at,deleted')).json();
    const local = await db.allProjects();
    const byId = new Map(local.map(p => [p.id, p]));
    let changed = false;
    for (const r of remote) {
      const l = byId.get(r.id);
      if (r.deleted) {
        if (l) { await db.deleteProject(r.id); changed = true; }
        byId.delete(r.id);
        continue;
      }
      if (!l || (l.updated || 0) < r.updated_at) {
        if (pending.has(r.id)) continue; // lokalna zmiana czeka na wysłanie – ona wygrywa
        const p = { ...r.data, updated: r.updated_at };
        await db.putProject(p); changed = true;
        blobKeys(p).forEach(markUploaded);
      } else if ((l.updated || 0) > r.updated_at) {
        await push(l);
      }
      byId.delete(r.id);
    }
    for (const l of byId.values()) await push(l); // tylko lokalne
    setStatus('Zsynchronizowano ' + new Date().toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' }));
    if (changed) cloud.onChange(true);
    return changed;
  } catch (e) {
    setStatus('Błąd synchronizacji: ' + e.message);
    return false;
  }
}
