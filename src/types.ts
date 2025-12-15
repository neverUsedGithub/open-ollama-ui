import type { ModelProvider } from "./providers/provider";
import type { Accessor, JSX, Setter } from "solid-js";
import type { LucideProps } from "lucide-solid";
import type { VectorDB } from "./vectordb";

export interface PromptTemplate {
  top: string;
  bottom: string;

  icon: Element;
  insertion: string;
}

export type ChatMessageState = "loading" | "typing" | "finished" | "toolcall" | "thinking";

export interface AssistantChatMessage {
  id: string;
  role: "assistant";

  state: Accessor<ChatMessageState>;
  setState: (state: ChatMessageState) => void;

  subMessages: Accessor<SubChatMessage[]>;

  push<T extends SubChatMessageData>(message: T): SubChatMessage & { kind: T["kind"] };

  remove(subMessage: SubChatMessage): void;
}

export interface UserImageFile {
  kind: "image";
  encoded: string;
  content: Uint8Array;
  fileName: string;
}

export interface UserDocumentFile {
  kind: "document";
  content: Uint8Array;
  fileName: string;

  progress: Accessor<number>;
  setProgress: Setter<number>;
}

export type UserFile = UserImageFile | UserDocumentFile;

export interface UserChatMessage {
  id: string;
  role: "user";
  content: string;
  files: UserFile[];
}

export type DisplayChatMessage = UserChatMessage | AssistantChatMessage;

export type ModelState = "idle" | "busy" | "loading";

export type ChatMessageAttachment = { type: "image"; source: Blob };

export type SubChatMessageData =
  | { kind: "text"; content: string; thinking: boolean; finished: boolean; timeStart: number; timeEnd: number }
  | { kind: "toolcall"; summary: string; toolName: string }
  | { kind: "image-mock"; width: number; height: number }
  | { kind: "error"; title: string; message: unknown }
  | { kind: "attachment"; attachment: ChatMessageAttachment };

export type TextSubChatMessage = {
  kind: "text";
  thinking: boolean;
  content: Accessor<string>;
  stream(chunk: string): void;
  replace(content: string): void;
  removeToolCall: () => void;

  finished: Accessor<boolean>;
  timeStart: Accessor<number>;
  timeEnd: Accessor<number>;

  setFinished: Setter<boolean>;
  setTimeStart: Setter<number>;
  setTimeEnd: Setter<number>;
};

export type ErrorSubChatMessage = { kind: "error"; title: string; message: unknown };
export type MockImageSubChatMessage = { kind: "image-mock"; width: number; height: number };
export type ToolCallSubChatMessage = { kind: "toolcall"; toolName: string; summary: string };
export type AttachmentSubChatMessage = { kind: "attachment"; attachment: ChatMessageAttachment };

export type SubChatMessage =
  | TextSubChatMessage
  | MockImageSubChatMessage
  | ToolCallSubChatMessage
  | AttachmentSubChatMessage
  | ErrorSubChatMessage;

export interface NativeChatMessage {
  id: string;
  role: string;
  content: string;
  thinking?: string;
  tool_name?: string;
  tool_calls?: ToolCall[];
  images?: Uint8Array[] | string[];
}

export interface InputTag {
  id: string;
  name: string;
  short: string;
  icon: (props: LucideProps) => JSX.Element;
  isSupported?(context: SupportContext): Promise<boolean>;

  prompt?: string;
  placeholder?: string;
}

export interface SupportContext {
  metadata: ModelMetadata;
}

export interface ToolOutput {
  images?: Blob[];
  data: unknown;
}

export type MockOutputField<T> = T | string | { property: string; default: T };

export type ToolImageOutput = {
  kind: "image";

  width: MockOutputField<number>;
  height: MockOutputField<number>;
};

export type ToolMockOutput = ToolImageOutput;

export interface ModelTool {
  name: string;
  summary: string;
  description: string;
  icon: (props: LucideProps) => JSX.Element;

  parameters: {
    type: "object";
    properties: {
      [property: string]: {
        type: string | string[];
        description: string;
      };
    };
    required: string[];
  };

  mockOutput?: ToolMockOutput[];
  isSupported?(context: SupportContext): Promise<boolean>;

  execute(properties: Record<string, unknown>, context: ToolContext): ToolOutput | Promise<ToolOutput>;
}

export interface ToolContext {
  model: ListedModel;
  signal: AbortSignal;
  documents: RAGDocument[];
  freeModel(model: ListedModel): Promise<void>;
}

export interface RAGDocument {
  name: string;
  chunks: string[];
  vectors: VectorDB;
}

export interface ChatData {
  model: string;
  provider: string;
  name: string;
  id: string;
}

export interface ModelCapabilities {
  tools: boolean;
  thinking: boolean;
}

export interface ModelDetails {
  family?: string;
  parameterSize?: string;
  quantizationLevel?: string;
}

export interface ModelMetadata {
  capabilities: ModelCapabilities;
  details: ModelDetails;
}

export interface UserPreferences {
  defaultModel: string;
  defaultProvider: string;
  chatsExpanded: boolean;
  sidebarExpanded: boolean;
}

export interface ListedModel {
  identifier: string;
  provider: string;
}

export interface ToolCall {
  function: {
    name: string;
    arguments: {
      [key: string]: any;
    };
  };
}

export type StreamChunk =
  | { type: "text"; content: string }
  | { type: "thinking"; content: string }
  | { type: "toolCalls"; toolCalls: ToolCall[] };
