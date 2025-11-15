import { createChatMessage } from "@/chatmanager/ChatManager";
import type { DisplayChatMessage, NativeChatMessage, RAGDocument, SubChatMessageData, UserFile } from "@/types";
import { StringPool } from "@/util/stringpool";
import { createDatabase, type DBSerializedData } from "@/vectordb";

type SavedChatMessage =
  | { role: "user"; content: number; files: UserFile[] }
  | { role: "assistant"; messages: SubChatMessageData[] };

type ExcludeKeys<T, U extends keyof T> = { [K in Exclude<keyof T, U>]: T[K] };

type SavedNativeMessage = ExcludeKeys<NativeChatMessage, "content" | "thinking"> & {
  content: number;
  thinking?: number;
};

type SavedRAGDocument = ExcludeKeys<RAGDocument, "vectors"> & {
  vectors: DBSerializedData;
};

export async function loadChat(
  chatId: string,
): Promise<{ nativeMessages: NativeChatMessage[]; displayMessages: DisplayChatMessage[]; documents: RAGDocument[] }> {
  const chatData = localStorage.getItem(`llm-ui-chat-${chatId}`);
  if (!chatData) return { nativeMessages: [], displayMessages: [], documents: [] };

  const parsed: {
    stringPool: string[];
    messages: SavedChatMessage[];
    data: SavedNativeMessage[];
    documents: SavedRAGDocument[];
  } = JSON.parse(chatData);

  const documents: RAGDocument[] = [];
  const messages: DisplayChatMessage[] = [];
  const nativeMessages: NativeChatMessage[] = [];

  if (!("messages" in parsed) || !("data" in parsed)) return { nativeMessages: [], displayMessages: [], documents: [] };

  for (const message of parsed.data) {
    const nativeMessage: NativeChatMessage = message as unknown as NativeChatMessage;
    nativeMessage.content = parsed.stringPool[nativeMessage.content as unknown as number];

    if ("thinking" in nativeMessage)
      nativeMessage.thinking = parsed.stringPool[nativeMessage.thinking as unknown as number];

    nativeMessages.push(nativeMessage);
  }

  for (const message of parsed.messages) {
    if (message.role === "user") {
      messages.push(createChatMessage("user", parsed.stringPool[message.content], []));
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

  for (const document of parsed.documents) {
    const db = await createDatabase();

    db.load(document.vectors);

    documents.push({
      name: document.name,
      chunks: document.chunks,
      vectors: db,
    });
  }

  return { nativeMessages: nativeMessages, displayMessages: messages, documents };
}

export function saveChat(
  chatId: string,
  chatMessages: DisplayChatMessage[],
  dataMessages: NativeChatMessage[],
  documents: RAGDocument[],
) {
  const saveChatMessages: SavedChatMessage[] = [];
  const saveDataMessages: SavedNativeMessage[] = [];
  const saveDocuments: SavedRAGDocument[] = [];
  const stringPool = new StringPool();

  for (const doc of documents) {
    saveDocuments.push({ name: doc.name, chunks: doc.chunks, vectors: doc.vectors.serialize() });
  }

  for (const message of dataMessages) {
    const savedMessage: SavedNativeMessage = structuredClone(message) as unknown as SavedNativeMessage;
    savedMessage.content = stringPool.add(message.content);

    if (savedMessage.thinking) savedMessage.thinking = stringPool.add(message.thinking!);

    saveDataMessages.push(savedMessage);
  }

  for (const message of chatMessages) {
    if (message.role === "user") {
      saveChatMessages.push({
        role: "user",
        files: message.files,
        content: stringPool.add(message.content),
      });
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
    JSON.stringify({
      messages: saveChatMessages,
      data: saveDataMessages,
      stringPool: stringPool.finalize(),
      documents: saveDocuments,
    }),
  );
}
