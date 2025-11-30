import { database } from "@/indexeddb";
import type { ChatData } from "@/types";

export async function loadChats(): Promise<ChatData[]> {
  return await database.queryAll<ChatData>("chats");
}

export async function addChat(chat: ChatData): Promise<void> {
  await database.put("chats", chat);
}

export async function deleteChat(id: string): Promise<void> {
  await database.delete("chats", id);
}
