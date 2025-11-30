import { createChatMessage } from "@/chatmanager/ChatManager";
import { database } from "@/indexeddb";
import type { DisplayChatMessage, NativeChatMessage, RAGDocument, SubChatMessageData, UserFile } from "@/types";
import { StringPool } from "@/util/stringpool";
import { createDatabase, type DBSerializedData } from "@/vectordb";
import ollama from "ollama/browser";
import { createSignal, runWithOwner } from "solid-js";

type SavedUserFile = { kind: "image" | "document"; fileName: string; data: string };

type SavedChatMessage =
  | { role: "user"; content: number; files: SavedUserFile[] }
  | { role: "assistant"; messages: SubChatMessageData[] };

type ExcludeKeys<T, U extends keyof T> = { [K in Exclude<keyof T, U>]: T[K] };

type SavedNativeMessage = ExcludeKeys<NativeChatMessage, "content" | "thinking"> & {
  content: number;
  thinking?: number;
};

type SavedRAGDocument = ExcludeKeys<RAGDocument, "vectors"> & {
  vectors: DBSerializedData;
};

export async function loadChat(chatId: string): Promise<
  | { exists: false }
  | {
      exists: true;
      nativeMessages: NativeChatMessage[];
      displayMessages: DisplayChatMessage[];
      documents: RAGDocument[];
    }
> {
  const chatData = await database.query<{
    stringPool: string[];
    messages: SavedChatMessage[];
    data: SavedNativeMessage[];
    documents: SavedRAGDocument[];
  }>("chat-data", chatId);

  if (!chatData) return { exists: false };

  const documents: RAGDocument[] = [];
  const messages: DisplayChatMessage[] = [];
  const nativeMessages: NativeChatMessage[] = [];

  if (!("messages" in chatData) || !("data" in chatData)) throw new Error("malformed data");

  for (const message of chatData.data) {
    const nativeMessage: NativeChatMessage = message as unknown as NativeChatMessage;
    nativeMessage.content = chatData.stringPool[nativeMessage.content as unknown as number];

    if ("thinking" in nativeMessage)
      nativeMessage.thinking = chatData.stringPool[nativeMessage.thinking as unknown as number];

    nativeMessages.push(nativeMessage);
  }

  for (const message of chatData.messages) {
    if (message.role === "user") {
      const userFiles: UserFile[] = [];

      for (const file of message.files) {
        const bytes = new TextEncoder().encode(atob(file.data));

        if (file.kind === "image") {
          userFiles.push({
            kind: "image",
            fileName: file.fileName,
            content: bytes,
            encoded: await ollama.encodeImage(bytes),
          });
        } else {
          const [progress, setProgress] = runWithOwner(null, () => createSignal(1))!;

          userFiles.push({
            kind: "document",
            fileName: file.fileName,
            content: bytes,
            progress,
            setProgress,
          });
        }
      }

      messages.push(createChatMessage("user", chatData.stringPool[message.content], userFiles));
    } else if (message.role === "assistant") {
      const assistantMessage = createChatMessage("assistant");

      for (const subData of message.messages) {
        if (subData.kind === "text") {
          subData.content = chatData.stringPool[subData.content as unknown as number];
        }

        if (subData.kind === "attachment") {
          if (subData.attachment.type === "image") {
            subData.attachment.source = await fetch(subData.attachment.source as unknown as string).then((res) =>
              res.blob(),
            );
          }
        }

        assistantMessage.push(subData);
      }

      assistantMessage.setState("finished");
      messages.push(assistantMessage);
    }
  }

  for (const document of chatData.documents) {
    const db = await createDatabase();

    db.load(document.vectors);

    documents.push({
      name: document.name,
      chunks: document.chunks,
      vectors: db,
    });
  }

  return { exists: true, nativeMessages: nativeMessages, displayMessages: messages, documents };
}

function base64Blob(blob: Blob): Promise<string> {
  const reader = new FileReader();
  reader.readAsDataURL(blob);

  return new Promise((res, rej) => {
    reader.onloadend = () => res(reader.result as string);
    reader.onerror = () => rej();
  });
}

export async function saveChat(
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
      const saveFiles: SavedUserFile[] = [];

      for (const file of message.files) {
        if (file.kind === "image") {
          saveFiles.push({
            kind: "image",
            fileName: file.fileName,
            data: file.encoded,
          });
        } else {
          saveFiles.push({
            kind: "document",
            fileName: file.fileName,
            // So uh, encodeImage accepts arbitrary binary data, so this should be okay?
            // Don't know about encoding it on every save request though.
            data: await ollama.encodeImage(file.content),
          });
        }
      }

      saveChatMessages.push({
        role: "user",
        files: saveFiles,
        content: stringPool.add(message.content),
      });
    } else {
      const sub: SubChatMessageData[] = [];

      for (const subMessage of message.subMessages()) {
        if (subMessage.kind === "attachment") {
          if (subMessage.attachment.type === "image") {
            sub.push({
              kind: "attachment",
              attachment: {
                type: "image",
                source: (await base64Blob(subMessage.attachment.source)) as unknown as Blob,
              },
            });
          } else {
            sub.push(subMessage);
          }
        } else if (subMessage.kind !== "text") {
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

  await database.put("chat-data", {
    id: chatId,
    messages: saveChatMessages,
    data: saveDataMessages,
    stringPool: stringPool.finalize(),
    documents: saveDocuments,
  });
}

export async function deleteChat(chatId: string) {
  await database.delete("chat-data", chatId);
}
