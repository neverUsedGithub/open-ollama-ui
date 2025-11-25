import type { ChatData } from "@/types";

export function loadChats(): ChatData[] {
  const chats = localStorage.getItem("llm-ui-chats");
  if (chats === null) return [];

  try {
    return JSON.parse(chats);
  } catch {
    return [];
  }
}

export function saveChats(chats: ChatData[]): void {
  localStorage.setItem("llm-ui-chats", JSON.stringify(chats));
}
