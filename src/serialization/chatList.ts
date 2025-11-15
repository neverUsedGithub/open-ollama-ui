import type { ChatData } from "@/types";

export function loadChats(): ChatData[] {
  const chats = localStorage.getItem("llm-ui-chats");
  return chats ? JSON.parse(chats) : [];
}

export function saveChats(chats: ChatData[]): void {
  localStorage.setItem("llm-ui-chats", JSON.stringify(chats));
}
