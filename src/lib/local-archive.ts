/** Original archives remain on this device; no upload method is supplied by this module. */
export class LocalArchiveStore {
  constructor(private name = 'mighty-private-source-files') {}
  private async database(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.name, 1);
      request.onupgradeneeded = () => request.result.createObjectStore('files');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('Local archive storage is unavailable.'));
    });
  }
  private async run<T>(key: string, mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    if (!key) throw new Error('An account-specific local archive key is required.');
    const db = await this.database();
    try {
      return await new Promise<T>((resolve, reject) => {
        const tx = db.transaction('files', mode); let value: T;
        const request = work(tx.objectStore('files'));
        request.onsuccess = () => { value = request.result; };
        tx.oncomplete = () => resolve(value);
        tx.onerror = () => reject(tx.error ?? request.error ?? new Error('Local archive storage failed.'));
        tx.onabort = () => reject(tx.error ?? new Error('Local archive storage was cancelled.'));
      });
    } finally { db.close(); }
  }
  async keep(userId: string, file: Blob): Promise<void> { await this.run(userId, 'readwrite', store => store.put(file, userId)); }
  async load(userId: string): Promise<Blob | null> { return (await this.run<Blob | undefined>(userId, 'readonly', store => store.get(userId))) ?? null; }
  async delete(userId: string): Promise<void> { await this.run(userId, 'readwrite', store => store.delete(userId)); }
}
