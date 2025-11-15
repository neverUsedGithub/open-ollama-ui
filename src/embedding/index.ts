import { freeOllamaModel } from "@/util/ollama";
import ollama from "ollama/browser";

// const embeddingModel = "qwen3-embedding:0.6b";
const embeddingModel = "qwen3-embedding:8b";

export async function generateEmbedding(text: string): Promise<Float32Array> {
  const embedRepsonse = await ollama.embed({
    input: text,
    model: embeddingModel,
  });

  return new Float32Array(embedRepsonse.embeddings[0]);
}

export async function freeEmbeddingModel() {
  await freeOllamaModel(embeddingModel);
}
