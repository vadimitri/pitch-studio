// Take storage. Session takes live in memory; kept takes go to IndexedDB in this browser. The interface is
// what a booth server store will implement later (upload, QR link, comments from phones).
import type { Comment, Take } from "./types";
import { createStore, useStore } from "./store";

export interface TakeStore {
  list(): Promise<TakeMeta[]>;
  get(id: string): Promise<Take | null>;
  put(take: Take): Promise<void>;
  remove(id: string): Promise<void>;
  addComment(id: string, c: Comment): Promise<void>;
  removeComment(id: string, commentId: string): Promise<void>;
}

export type TakeMeta = Pick<Take, "id" | "n" | "createdAt" | "durationSec" | "title" | "settings" | "comments" | "poster">;

const DB = "pitch-studio";
// Video bytes are stored as ArrayBuffer: WebKit (and Safari Private Browsing) refuse Blobs in IndexedDB.
type Stored = Omit<Take, "video"> & { video?: Blob; videoData?: ArrayBuffer };
const toStored = async (t: Take): Promise<Stored> => {
  const { video, ...rest } = t;
  return { ...rest, videoData: await video.arrayBuffer() };
};
const fromStored = (s: Stored): Take => ({ ...s, video: s.video ?? new Blob([s.videoData ?? new ArrayBuffer(0)], { type: s.mime }) } as Take);
const STORE = "takes";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T> {
  const db = await open();
  return new Promise<T>((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    t.oncomplete = () => { resolve(req ? req.result : (undefined as T)); db.close(); };
    t.onerror = () => { reject(t.error ?? new Error("IndexedDB transaction failed")); db.close(); };
    t.onabort = () => { reject(t.error ?? new Error("IndexedDB transaction aborted")); db.close(); };
  });
}

export const localStore: TakeStore = {
  async list() {
    const all = await tx<Stored[]>("readonly", (s) => s.getAll() as IDBRequest<Stored[]>);
    return all
      .map(({ id, n, createdAt, durationSec, title, settings, comments, poster }) => ({ id, n, createdAt, durationSec, title, settings, comments, poster }))
      .sort((a, b) => b.createdAt - a.createdAt);
  },
  async get(id) {
    const s = await tx<Stored | undefined>("readonly", (st) => st.get(id) as IDBRequest<Stored | undefined>);
    return s ? fromStored(s) : null;
  },
  async put(take) {
    const row = await toStored(take);
    await tx("readwrite", (s) => { s.put(row); });
    savedVersion.set((v) => v + 1);
  },
  async remove(id) {
    await tx("readwrite", (s) => { s.delete(id); });
    savedVersion.set((v) => v + 1);
  },
  async addComment(id, c) {
    const t = await this.get(id);
    if (!t) return;
    t.comments = [...t.comments.filter((x) => x.id !== c.id), c].sort((a, b) => a.t - b.t);
    await this.put(t);
  },
  async removeComment(id, commentId) {
    const t = await this.get(id);
    if (!t) return;
    t.comments = t.comments.filter((x) => x.id !== commentId);
    await this.put(t);
  },
};

/** Bumps on every write so lists can refresh. */
export const savedVersion = createStore(0);
export const useSavedVersion = () => useStore(savedVersion);

export const uid = () => {
  const b = crypto.getRandomValues(new Uint8Array(12));
  return Array.from(b, (x) => x.toString(36).padStart(2, "0")).join("").slice(0, 16);
};
