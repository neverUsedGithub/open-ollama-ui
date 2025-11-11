import { ChatView, createChatMessage } from "./Chat";
import { createEffect, createSignal, untrack } from "solid-js";

import type { ChatMessage, NativeChatMessage, SubChatMessageData, UserChatMessage, UserFile } from "./types";
import { StringPool } from "./util/stringpool";

type SavedChatMessage =
  | { role: "user"; content: string; files: UserFile[] }
  | { role: "assistant"; messages: SubChatMessageData[] };

type ExcludeKeys<T, U extends keyof T> = { [K in Exclude<keyof T, U>]: T[K] };

type SavedNativeMessage = ExcludeKeys<NativeChatMessage, "content" | "thinking"> & {
  content: number;
  thinking?: number;
};

function loadChat(chatId: string): { data: NativeChatMessage[]; messages: ChatMessage[] } {
  const chatData = localStorage.getItem(`llm-ui-chat-${chatId}`);
  if (!chatData) return { data: [], messages: [] };

  const parsed: { stringPool: string[]; messages: SavedChatMessage[]; data: SavedNativeMessage[] } =
    JSON.parse(chatData);

  const messages: ChatMessage[] = [];
  const nativeMessages: NativeChatMessage[] = [];

  if (!("messages" in parsed) || !("data" in parsed)) return { data: [], messages: [] };

  for (const message of parsed.data) {
    const nativeMessage: NativeChatMessage = message as unknown as NativeChatMessage;
    nativeMessage.content = parsed.stringPool[nativeMessage.content as unknown as number];

    if ("thinking" in nativeMessage)
      nativeMessage.thinking = parsed.stringPool[nativeMessage.thinking as unknown as number];

    nativeMessages.push(nativeMessage);
  }

  for (const message of parsed.messages) {
    if (message.role === "user") {
      messages.push(createChatMessage("user", parsed.stringPool[message.content as unknown as number], []));
    } else if (message.role === "assistant") {
      const assistantMessage = createChatMessage("assistant");

      for (const subData of message.messages) {
        if (subData.kind === "text") {
          subData.content = parsed.stringPool[subData.content as unknown as number];
        }

        assistantMessage.push(subData);
      }

      assistantMessage.setState("finished");
      messages.push(assistantMessage);
    }
  }

  return { data: nativeMessages, messages };
}

function saveChat(chatId: string, chatMessages: ChatMessage[], dataMessages: NativeChatMessage[]) {
  const saveChatMessages: SavedChatMessage[] = [];
  const saveDataMessages: SavedNativeMessage[] = [];
  const stringPool = new StringPool();

  for (const message of dataMessages) {
    const savedMessage: SavedNativeMessage = structuredClone(message) as unknown as SavedNativeMessage;
    savedMessage.content = stringPool.add(message.content);

    if (savedMessage.thinking) savedMessage.thinking = stringPool.add(message.thinking!);

    saveDataMessages.push(savedMessage);
  }

  for (const message of chatMessages) {
    if (message.role === "user") {
      saveChatMessages.push({
        ...message,
        content: stringPool.add(message.content) as unknown as string,
      } satisfies UserChatMessage);
    } else {
      const sub: SubChatMessageData[] = [];

      for (const subMessage of message.subMessages()) {
        if (subMessage.kind !== "text") {
          sub.push(subMessage);
        } else {
          const poolIndex = stringPool.add(subMessage.content());

          sub.push({
            kind: "text",
            content: poolIndex as unknown as string,
            thinking: subMessage.thinking,
            finished: true,
            timeStart: subMessage.timeStart(),
            timeEnd: subMessage.timeEnd() || Date.now(),
          });
        }
      }

      saveChatMessages.push({ role: "assistant", messages: sub });
    }
  }

  localStorage.setItem(
    `llm-ui-chat-${chatId}`,
    JSON.stringify({ messages: saveChatMessages, data: saveDataMessages, stringPool: stringPool.finalize() }),
  );
}

export default function App() {
  const chatId = "foobar";
  const savedData = loadChat(chatId);

  const [chatMessages, setChatMessages] = createSignal<ChatMessage[]>(savedData.messages);
  const [dataMessages, setDataMessages] = createSignal(savedData.data);

  const addChatMessage = (message: ChatMessage) => setChatMessages([...chatMessages(), message]);
  const addDataMessage = (message: NativeChatMessage) => setDataMessages([...dataMessages(), message]);

  createEffect(() => {
    const chat = chatMessages();
    const data = dataMessages();

    for (const message of chat) {
      if (message.role === "assistant") {
        message.subMessages();
      }
    }

    untrack(() => saveChat(chatId, chat, data));
  });

  return (
    <ChatView
      selectedModel="qwen3:14b"
      dataMessages={dataMessages()}
      addDataMessage={addDataMessage}
      chatMessages={chatMessages()}
      addChatMessage={addChatMessage}
    />
  );
}
