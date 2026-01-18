import type { ModelMetadata, ModelTool, NativeChatMessage, StreamChunk } from "@/types";
import { ModelProvider } from "./provider";
import { Ollama } from "ollama/browser";
import { languageMapping } from "@/util/languages";

export class OllamaProvider extends ModelProvider {
  private ollama: Ollama;

  constructor() {
    super();

    const search = new URLSearchParams(window.location.search);

    this.ollama = new Ollama({
      host: search.get("ollama_url") ?? "http://localhost:11434",
    });
  }

  override async listModels(): Promise<string[]> {
    return (await this.ollama.list()).models.map((model) => model.name);
  }

  override async listRunningModels(): Promise<string[]> {
    return (await this.ollama.ps()).models.map((model) => model.name);
  }

  override async queryModel(identifier: string): Promise<ModelMetadata> {
    const resp = await this.ollama.show({ model: identifier });

    return {
      capabilities: {
        tools: resp.capabilities.includes("tools"),
        thinking: resp.capabilities.includes("thinking"),
      },
      details: {
        family: resp.details.family,
        parameterSize: resp.details.parameter_size,
        quantizationLevel: resp.details.quantization_level,
      },
    };
  }

  override async generate(
    identifier: string,
    messages: NativeChatMessage[],
    tools: ModelTool[] | null,
    stream: (chunk: StreamChunk) => Promise<void>,
    signal: AbortSignal,
    thinking: boolean | "low" | "medium" | "high" | undefined,
  ): Promise<void> {
    const response = await this.ollama.chat({
      stream: true,
      model: identifier,
      messages,
      tools: tools === null ? undefined : tools.map((tool) => ({ type: "function", function: tool })),
      think: thinking,
      options: {
        num_ctx: 16_000,
      },
    });

    for await (const part of response) {
      signal.throwIfAborted();

      if (part.message.tool_calls) {
        await stream({ type: "toolCalls", toolCalls: part.message.tool_calls });
      }

      if (part.message.content) {
        await stream({ type: "text", content: part.message.content });
      }

      if (part.message.thinking) {
        await stream({ type: "thinking", content: part.message.thinking });
      }
    }
  }

  override async translate(
    identifier: string,
    input: string,
    sourceCode: string,
    targetCode: string,
    stream: (chunk: StreamChunk) => Promise<void>,
    signal: AbortSignal,
  ): Promise<void> {
    const sourceName = languageMapping[sourceCode];
    const targetName = languageMapping[targetCode];

    if (!sourceName || !targetName) {
      throw new Error(`Cannot find language name for '${sourceCode}' or '${targetCode}'.`);
    }

    await this.generate(
      identifier,
      [
        {
          id: "-",
          role: "user",
          content: `You are a professional ${sourceName} (${sourceCode}) to ${targetName} (${targetCode}) translator. Your goal is to accurately convey the meaning and nuances of the original ${sourceName} text while adhering to ${targetName} grammar, vocabulary, and cultural sensitivities.
Produce only the ${targetName} translation, without any additional explanations or commentary. Please translate the following ${sourceName} text into ${targetName}:


${input}`,
        },
      ],
      null,
      stream,
      signal,
      false,
    );
  }

  override async freeModel(identifier: string): Promise<void> {
    await this.ollama.generate({
      model: identifier,
      keep_alive: 0,
      prompt: "",
    });

    await new Promise((res) => setTimeout(res, 1000));
  }
}
