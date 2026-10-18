export interface Session { id: string; mode: string; local: boolean; videoId?: string; uploadId?: string; shareUrl?: string; duration: number; mime: string; hasAudio?: boolean; total: number; parts: { partNumber: number; etag: string; size: number }[] }
const db = new Promise<IDBDatabase>((resolve, reject) => {
  const request = indexedDB.open('screenrec', 1);
  request.onupgradeneeded = () => { request.result.createObjectStore('sessions', { keyPath: 'id' }); request.result.createObjectStore('chunks', { keyPath: ['session', 'index'] }); };
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});
async function operation<T>(name: string, mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const transaction = (await db).transaction(name, mode);
  const request = run(transaction.objectStore(name));
  return new Promise((resolve, reject) => { transaction.oncomplete = () => resolve(request.result); transaction.onerror = () => reject(transaction.error); transaction.onabort = () => reject(transaction.error); });
}
export const saveSession = (session: Session) => operation('sessions', 'readwrite', s => s.put(session));
export const sessions = () => operation<Session[]>('sessions', 'readonly', s => s.getAll());
export const saveChunk = (session: string, index: number, blob: Blob) => operation('chunks', 'readwrite', s => s.put({ session, index, blob }));
export async function recordingBlob(session: Session) {
  const chunks = await operation<{ session: string; index: number; blob: Blob }[]>('chunks', 'readonly', s => s.getAll(IDBKeyRange.bound([session.id, 0], [session.id, Number.MAX_SAFE_INTEGER])));
  return new Blob(chunks.map(c => c.blob), { type: session.mime });
}
export async function removeSession(id: string) {
  await operation('chunks', 'readwrite', s => s.delete(IDBKeyRange.bound([id, 0], [id, Number.MAX_SAFE_INTEGER])));
  await operation('sessions', 'readwrite', s => s.delete(id));
}
