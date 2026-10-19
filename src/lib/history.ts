import { load, type Store } from "@tauri-apps/plugin-store";
import type { ChatMessage } from "./ai";

export interface Thread {
  id: string;
  title: string;
  createdAt: number;
  sourceText: string | null;
  messages: ChatMessage[];
}

const MAX_THREADS = 30;
let storePromise: Promise<Store> | null = null;

function store(): Promise<Store> {
  if (!storePromise) storePromise = load("history.json", { autoSave: true, defaults: {} });
  return storePromise;
}

export async function listThreads(): Promise<Thread[]> {
  const s = await store();
  return (await s.get<Thread[]>("threads")) ?? [];
}

export async function upsertThread(thread: Thread): Promise<void> {
  const s = await store();
  const threads = ((await s.get<Thread[]>("threads")) ?? []).filter((t) => t.id !== thread.id);
  // Images are not kept: they would bloat the file and are only useful live.
  threads.unshift({ ...thread, messages: thread.messages.map(({ image: _image, ...m }) => m) });
  await s.set("threads", threads.slice(0, MAX_THREADS));
  await s.save();
}

export function newThread(sourceText: string | null, title: string): Thread {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title,
    createdAt: Date.now(),
    sourceText,
    messages: [],
  };
}

export async function clearThreads(): Promise<void> {
  const s = await store();
  await s.set("threads", []);
  await s.save();
}
