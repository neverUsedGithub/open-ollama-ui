import { comfyGenerateImage } from "./comfyui";

import fluxDevWorkflow from "./workflows/flux-dev.json";
import qwenImageWorkflow from "./workflows/qwen_image.json";

function readyWorkflow(type: "flux-dev" | "qwen-image", prompt: string, width: number, height: number): unknown {
  if (type === "flux-dev") {
    const workflow = structuredClone(fluxDevWorkflow);

    workflow[27].inputs.width = width;
    workflow[27].inputs.height = height;

    workflow[30].inputs.width = width;
    workflow[30].inputs.height = height;

    workflow[39].inputs.text = prompt;

    return workflow;
  }

  const workflow = structuredClone(qwenImageWorkflow);

  workflow["75:58"].inputs.width = width;
  workflow["75:58"].inputs.height = height;

  workflow["75:3"].inputs.seed = Math.floor(Math.random() * 1_000_000_000_000_000);

  workflow["75:6"].inputs.text = prompt;

  return workflow;
}

export async function generateImage(prompt: string): Promise<Blob> {
  const workflow = readyWorkflow("qwen-image", prompt, 512, 512);
  const image = await comfyGenerateImage(workflow, "http://localhost:8000");

  // Free up vram for ollama.
  // TODO: for high vram users add an option to disable this.
  await freeResources();

  return image;
}

export async function isAvailable(): Promise<boolean> {
  return fetch("http://localhost:8000").then(
    (r) => r.ok,
    () => false,
  );
}

export async function freeResources(): Promise<void> {
  await fetch(new URL("free", "http://localhost:8000"), {
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ unload_models: true, free_memory: true }),
    method: "POST",
  });

  await new Promise((res) => setTimeout(res, 3000));
}
