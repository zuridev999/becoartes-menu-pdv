import { AppApi } from './api';
import { getQrVisitId } from './qr-analytics';

let pending: { key: string; at: number; promise: ReturnType<typeof AppApi.resolveQrFlow> } | undefined;

export function resolveQrEntry(table: number, retry = false) {
  const visit = getQrVisitId();
  const key = `${table}:${visit}`;
  if (!retry && pending?.key === key && Date.now() - pending.at < 15_000) return pending.promise;
  const promise = AppApi.resolveQrFlow(table, visit);
  pending = { key, at: Date.now(), promise };
  void promise.catch(() => { if (pending?.promise === promise) pending = undefined; });
  return promise;
}

export function preloadQrEntry() {
  const match = window.location.pathname.match(/(?:^|\/)mesa\/(\d+)\/?$/);
  const params = new URLSearchParams(window.location.search);
  const table = Number(match?.[1] || params.get('mesa') || params.get('table'));
  if (table > 0 && Number.isInteger(table)) void resolveQrEntry(table).catch(() => undefined);
}
