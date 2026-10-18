import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';
import { isValidStore, save, type Store } from './store.ts';

// どちらも公開しても問題ない値(データ保護は RLS で行う)。service_role キーは絶対に入れない
const SUPABASE_URL: string = 'https://epuzqcvuekyflqnejxru.supabase.co';
const SUPABASE_ANON_KEY: string = 'sb_publishable_k1eK6DzeXjFnzNn-LEM0dg_zS6s1-0P';
/** user_data テーブル内でこのツールを識別するキー */
const APP = 'orecalculator';
const PUSH_DELAY_MS = 1500;

export const cloudEnabled = SUPABASE_URL !== '' && SUPABASE_ANON_KEY !== '';

export type CloudStatus = 'disabled' | 'signed-out' | 'idle' | 'syncing' | 'error';

const client: SupabaseClient | null = cloudEnabled
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { flowType: 'pkce' } })
  : null;

let session: Session | null = null;
let status: CloudStatus = cloudEnabled ? 'signed-out' : 'disabled';
let store: Store;
let onRemoteApplied: () => void = () => {};
let onChange: () => void = () => {};
let timer: ReturnType<typeof setTimeout> | undefined;
let busy: Promise<void> = Promise.resolve();

function setStatus(s: CloudStatus): void {
  status = s;
  onChange();
}

export const getStatus = () => status;
export const getUserName = (): string => {
  const meta = session?.user.user_metadata ?? {};
  return String(meta.full_name ?? meta.name ?? meta.user_name ?? session?.user.email ?? '');
};

async function push(): Promise<void> {
  if (!client || !session) return;
  const { error } = await client.from('user_data').upsert({ user_id: session.user.id, app: APP, data: store, updated_at: new Date().toISOString() });
  if (error) throw error;
}

/** リモートの方が新しければ取り込み、ローカルの方が新しければ送信する */
async function sync(): Promise<void> {
  if (!client || !session) return;
  setStatus('syncing');
  try {
    const { data, error } = await client.from('user_data').select('data').eq('app', APP).maybeSingle();
    if (error) throw error;
    const remote = data?.data as Store | undefined;
    const remoteAt = remote?.updatedAt ?? 0;
    const localAt = store.updatedAt ?? 0;
    if (remote && isValidStore(remote) && remoteAt > localAt) {
      store.monsters = remote.monsters;
      store.currentId = remote.currentId;
      store.updatedAt = remoteAt;
      save(store, false);
      onRemoteApplied();
    } else if (!remote || localAt > remoteAt) {
      await push();
    }
    setStatus('idle');
  } catch (e) {
    console.error(e);
    setStatus('error');
  }
}

const enqueue = (fn: () => Promise<void>): void => {
  busy = busy.then(fn, fn);
};

/** ローカル保存のたびに呼ぶ。連続操作をまとめて送信する */
export function schedulePush(): void {
  if (!client || !session) return;
  clearTimeout(timer);
  timer = setTimeout(() => enqueue(async () => {
    try { setStatus('syncing'); await push(); setStatus('idle'); } catch (e) { console.error(e); setStatus('error'); }
  }), PUSH_DELAY_MS);
}

export async function signIn(): Promise<void> {
  await client?.auth.signInWithOAuth({ provider: 'discord', options: { redirectTo: location.origin + location.pathname } });
}

export async function signOut(): Promise<void> {
  await client?.auth.signOut();
}

export function initCloud(s: Store, opts: { onRemoteApplied: () => void; onChange: () => void }): void {
  store = s;
  onRemoteApplied = opts.onRemoteApplied;
  onChange = opts.onChange;
  if (!client) return;

  client.auth.onAuthStateChange((event, next) => {
    session = next;
    if (!next) { clearTimeout(timer); setStatus('signed-out'); return; }
    // コールバック内で直接 supabase を呼ぶとデッドロックしうるため、次のタスクに回す
    if (event === 'INITIAL_SESSION' || event === 'SIGNED_IN') setTimeout(() => enqueue(sync), 0);
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') enqueue(sync);
    else if (timer) { clearTimeout(timer); enqueue(async () => { try { await push(); } catch (e) { console.error(e); } }); }
  });
}
