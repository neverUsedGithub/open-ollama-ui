import type { ModelMetadata, ModelTool, NativeChatMessage, StreamChunk } from "@/types";

export abstract class ModelProvider {
  abstract listModels(): Promise<string[]>;
  abstract listRunningModels(): Promise<string[]>;
  abstract freeModel(identifier: string): Promise<void>;
  abstract queryModel(identifier: string): Promise<ModelMetadata>;
  abstract generate(
    identifier: string,
    messages: NativeChatMessage[],
    tools: ModelTool[] | null,
    stream: (chunk: StreamChunk) => Promise<void>,
    signal: AbortSignal,
    thinking: boolean | "low" | "medium" | "high" | undefined,
  ): Promise<void>;
  abstract translate(
    identifier: string,
    input: string,
    sourceLanguageCode: string,
    targetLanguageCode: string,
    stream: (chunk: StreamChunk) => Promise<void>,
    signal: AbortSignal,
  ): Promise<void>;
}
