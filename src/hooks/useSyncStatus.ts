import { useCallback, useSyncExternalStore } from 'react';
import { useApp } from '@/store/app';
import { runtime } from '@/lib/runtime';
import { cloudSyncStatus, retrySync, type CloudSyncStatus } from '@/services/supabase/engine';

/**
 * The one reading of "what does this device still owe the database". The shell's badge and
 * the attention engine both take it from here, so a queue can never be described one way in
 * the header and another way in the alert list.
 */

const NO_CLOUD_SYNC: CloudSyncStatus = { pending: 0, errors: [], syncing: false };
const LOCAL_SYNC = {
  subscribe: () => () => { /* local mode: no engine to watch */ },
  get: () => NO_CLOUD_SYNC,
};

export interface SyncSnapshot {
  /** Whether Supabase is configured at all; without it nothing here can be retried. */
  cloud: boolean;
  online: boolean;
  /** Rows this browser holds that the database does not have yet. */
  pending: number;
  /** The engine's own sentences for the writes it was refused. */
  errors: string[];
  syncing: boolean;
  retry: () => void;
}

export function useSyncStatus(): SyncSnapshot {
  const online = useApp(s => s.online);
  const syncPending = useApp(s => s.syncPending);
  const mortality = useApp(s => s.mortality);
  const feed = useApp(s => s.feed);
  const eggs = useApp(s => s.eggs);
  const saleLogs = useApp(s => s.saleLogs);
  const saleEntries = useApp(s => s.saleEntries);
  const feedRounds = useApp(s => s.feedRounds);
  const vaccinations = useApp(s => s.vaccinations);

  // In cloud mode the queue is the engine's real diff and its refusals; on a local-only
  // device the rows carry their own `synced` flag instead.
  const cloud = runtime.cloud;
  const status = useSyncExternalStore(
    cloud ? cloudSyncStatus.subscribe : LOCAL_SYNC.subscribe,
    cloud ? cloudSyncStatus.get : LOCAL_SYNC.get,
  );
  const legacyPending = [...mortality, ...feed, ...eggs, ...saleLogs, ...saleEntries, ...feedRounds, ...vaccinations]
    .filter(x => !x.synced).length;
  const pending = cloud ? status.pending : legacyPending;

  const retry = useCallback(() => {
    if (!pending) return;
    if (cloud) retrySync();
    else syncPending();
  }, [cloud, pending, syncPending]);

  return { cloud, online, pending, errors: status.errors, syncing: cloud && status.syncing, retry };
}
