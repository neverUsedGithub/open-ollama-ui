import * as embedding from "@/embedding";
import * as imageGen from "@/imagegen";
import { ProviderManager } from "@/providers";
import { BraveSearchProvider } from "@/search/providers/brave";
import type { ModelTool, ToolContext } from "@/types";
import { extensionApi, isExtensionInstalled } from "@/util/extension";
import { languageMapping } from "@/util/languages";
import * as vectordb from "@/vectordb";
import BinaryIcon from "lucide-solid/icons/binary";
import BookOpenText from "lucide-solid/icons/book-open-text";
import CalculatorIcon from "lucide-solid/icons/calculator";
import GlobeIcon from "lucide-solid/icons/globe";
import ImagePlusIcon from "lucide-solid/icons/image-plus";
import LanguagesIcon from "lucide-solid/icons/languages";
import ollama from "ollama/browser";
import TurndownService from "turndown";
import { gfm as TurndownPluginGFM } from "turndown-plugin-gfm";

async function summarizeTextAbortable(ctx: ToolContext, document: string, query: string): Promise<string> {
  // TODO: should move this to the new provider system too, also hardcoded....
  const summaryModel = "qwen3:4b-instruct";

  // TODO: the initial loading time of the summarizer model CANNOT be aborted currently.
  const summaryResponse = await ollama.chat({
    model: summaryModel,
    stream: true,
    options: {
      num_ctx: 32_000,
      temperature: 0.35,
    },
    messages: [
      {
        role: "user",
        content: `You are an assistant that applies the user's query to a large document.

User query:
"${query}"

Document:
\`\`\`
${document}
\`\`\`

Instructions:
1. Identify only the information in the document that directly relates to the user's query.
2. Ignore unrelated content; do not invent answers.
3. Provide the extracted information in a concise, structured manner suitable for the main model to use.

Output only the extracted information.`,
      },
    ],
  });

  let summary = "";

  for await (const part of summaryResponse) {
    ctx.signal.throwIfAborted();
    summary += part.message.content;
  }

  return summary;
}

export const modelTools: ModelTool[] = [
  {
    name: "calculator",
    icon: CalculatorIcon,
    summary: "Executing an arithmetic expression.",
    description: "Execute arithmetic expressions (no limits on amount of operands)",
    parameters: {
      type: "object",
      properties: {
        expression: {
          type: "string",
          description: "The expression to execute. (532.1 + 93, 24 * 12, (5 + 5) * 2, etc...)",
        },
      },
      required: ["expression"],
    },

    async execute(properties: { expression: string }) {
      const exprRegex = /^[\d\.\+\-\*\/\(\) ]*$/;
      if (!exprRegex.test(properties.expression)) return { data: { ok: false, error: "invalid expression" } };
      return { data: { ok: true, result: eval(properties.expression) } };
    },
  },
  {
    name: "image_gen",
    icon: ImagePlusIcon,
    summary: "Generating an image.",
    description:
      "Generate an image based on a text prompt. After calling this tool and the image is successfully generated, try asking the user follow-up questions, whether they would like to make any adjustments or refinements to the image. Do not provide image links, or any other third-party URLs, do not summarize the content of the image, or provide any other commentary, other than the follow-up question.",
    parameters: {
      type: "object",
      properties: {
        prompt: {
          type: "string",
          description: `Always use English for prompts, translate and refine non-English inputs.
Refinement Process:
1. Clarify intent: Identify the main subject, style (e.g., photo, 3D, anime), mood (e.g., cozy, mysterious), composition (e.g., close-up, wide shot), and constraints (e.g., no text, transparent background).
2. Add missing details: Infers reasonable visual elements (lighting, background, atmosphere) based on context—e.g., "night scene" implies dim, cool lighting.
3. Replace vague terms: Use specific, visual language (e.g., "soft golden light from a lamp" instead of "cool lighting").
4. Eliminate ambiguity: Clarify pronouns and unclear references. Ensure every element directly contributes to the image.
5. Respect constraints: Strictly follow user rules (e.g., no text, specific colors).
6. Rewrite clearly: Combine all elements into 1–2 natural, cinematic sentences focusing on subject, style, environment, lighting, and key details. `,
        },
        width: {
          type: "number",
          description: "The width of the generated image. Defaults to 512.",
        },
        height: {
          type: "number",
          description: "The width of the generated image. Defaults to 512.",
        },
        quality: {
          type: "string",
          // @ts-expect-error I'm pretty sure this is supported?
          enum: ["low", "medium", "high"],
          description:
            'The quality of the generated image. There are noticable changes between "low", "medium", and "high". Defaults to "medium".',
        },
      },
      required: ["prompt"],
    },

    mockOutput: [
      { kind: "image", width: { property: "width", default: 512 }, height: { property: "height", default: 512 } },
    ],

    isSupported() {
      return imageGen.isAvailable();
    },

    async execute(
      properties: { prompt: string; width?: number; height?: number; quality?: "low" | "medium" | "high" },
      ctx: ToolContext,
    ) {
      // Free up vram for comfy.
      // TODO: for high vram users add an option to disable this.
      await ctx.freeModel(ctx.model);

      const imageBlob = await imageGen.generateImage(properties.prompt, {
        width: properties.width ?? 512,
        height: properties.height ?? 512,
        quality: properties.quality ?? "medium",
        signal: ctx.signal,
      });

      return {
        data: {
          success: true,
          message: "image generated successfully",
        },
        images: [imageBlob],
      };
    },
  },
  {
    name: "python",
    icon: BinaryIcon,
    summary: "Executing a piece of code.",
    description: `You should only use this tool for internal reasoning. Executes a Python code snippet in a hidden, non-visible, internal runtime environment. Only Python is supported (version 3.10). The execution environment may not have internet access, and its file system is non-persistent — all files are cleared between calls. Code executed with this tool is never shown to the user, so do not use it to run code the user asked you to provide unless they explicitly request execution or testing. Only call this tool when it is genuinely required to answer the user’s request or when it is a necessary step in your internal reasoning; do not call it unnecessarily or speculatively.`,
    parameters: {
      type: "object",
      properties: {
        code: {
          type: "string",
          description: "The code snippet to execute.",
        },
      },

      required: ["code"],
    },

    mockOutput: [],

    async execute(properties: { code: string }, ctx: ToolContext) {
      const res = await fetch("https://emkc.org/api/v2/piston/execute", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          language: "python",
          version: "3.10",
          files: [
            {
              name: "main.py",
              content: `
import ast
import pprint
from typing import Any

def run_snippet(code: str) -> None:
  tree = ast.parse(code, mode='exec')

  for i in range(len(tree.body) - 1, -1, -1):
    stat = tree.body[i]
    if isinstance(stat, ast.FunctionDef):
      tree.body.insert(i, ast.Global(names=[stat.name]))

  ast.fix_missing_locations(tree)

  if isinstance(tree.body[-1], ast.Expr):
    new_locals: dict[str, Any] = {}
    new_globals: dict[str, Any] = {}

    last_expr = ast.Expression(tree.body[-1].value)
    expr_head = ast.Module(tree.body[:-1], [])

    exec(compile(expr_head, filename="<file>", mode="exec"), new_globals, new_locals)

    new_globals.update(new_locals)
    result = eval(compile(last_expr, filename="<file>", mode="eval"), new_globals, {})

    if result != None:
      pprint.pp(result)
  else:
    exec(compile(tree, filename="<file>", mode="exec"))

run_snippet(${JSON.stringify(properties.code)})`,
            },
          ],
          stdin: "",
          args: [],
        }),
        signal: ctx.signal,
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error("code execution failed");
      }

      return {
        data: { code: data.run.code, output: data.run.output },
      };
    },
  },
  {
    name: "web_search",
    icon: GlobeIcon,
    summary: "Searching the web.",
    description:
      "Search the web for a search query. You should use the `web_fetch` tool to gather more information on the search results' urls if the returned data is not enough.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "The query to search for. Should follow web search best practices.",
        },
      },
      required: ["query"],
    },

    mockOutput: [],

    async isSupported() {
      return isExtensionInstalled() && localStorage.getItem("OLLMUI_BRAVE") !== null;
    },

    async execute(properties: { query: string }) {
      const braveProvider = new BraveSearchProvider(localStorage.getItem("OLLMUI_BRAVE")!);
      const results = await braveProvider.search(properties.query, { count: 8 });

      return {
        data: results,
      };
    },
  },
  {
    name: "web_fetch",
    icon: GlobeIcon,
    summary: "Fetching a website.",
    description: "Get the summary of a website's contents.",
    parameters: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "The url of the website.",
        },
        query: {
          type: "string",
          description: "An optional query a summarizer LLM will execute on the website's content.",
        },
      },
      required: ["url"],
    },

    async isSupported() {
      return isExtensionInstalled();
    },

    async execute(properties: { url: string; query?: string }, ctx: ToolContext) {
      try {
        const dataHTML = await extensionApi.fetchText(properties.url);
        const dataDOM = new DOMParser().parseFromString(dataHTML, "text/html");

        const links: { title: string; url: string }[] = [];

        const turndown = new TurndownService({
          hr: "---",
          headingStyle: "atx",
          codeBlockStyle: "fenced",
          bulletListMarker: "-",
          emDelimiter: "_",
          strongDelimiter: "**",
        });

        turndown.use(TurndownPluginGFM);

        turndown.remove(["script", "style"]);

        turndown.addRule("links", {
          filter: ["a"],
          replacement: (content, node) => {
            // @ts-expect-error
            links.push({ title: content, url: new URL(node.getAttribute("href"), properties.url) });

            return content;
          },
        });

        turndown.addRule("ignoreMedia", {
          filter: ["img", "video"],
          replacement: () => "",
        });

        const title = dataDOM.title ?? "Unnamed Page";

        const contentEl =
          dataDOM.querySelector("main") ??
          dataDOM.querySelector('[role="main"]') ??
          dataDOM.querySelector("article") ??
          dataDOM.body;

        const output = turndown.turndown(contentEl);
        const summary = await summarizeTextAbortable(
          ctx,
          output,
          "Summarize this webpage. Extract key data and information.",
        );

        const furtherLinks = links.slice(0, 5);

        console.log({
          url: properties.url,
          title,
          links: furtherLinks,
          content: summary,
        });

        return {
          data: {
            url: properties.url,
            title,
            links: furtherLinks,
            content: summary,
          },
        };
      } catch (e) {
        console.warn(e);
      }

      return {
        data: "Fetching website failed.",
      };
    },
  },
  {
    name: "file_search",
    icon: BookOpenText,
    summary: "Searching inside a document.",
    description:
      "Search for relevant information inside an uploaded document. Should be used when you need to reference a document to answer one of the user's questions, requests, or tasks. You must generate multiple search queries that capture different ways the relevant information might appear in the document, including synonyms, paraphrases, and related concepts. This helps ensure semantic search can find the most relevant chunks.",
    parameters: {
      type: "object",
      properties: {
        document_id: {
          type: "number",
          description: "The document id to search for the provided query or queries.",
        },
        query: {
          type: "array",
          // @ts-expect-error
          items: {
            type: "string",
          },
          description:
            "The user's question or topic to search for in the document. You should generate around 5 semantically varied queries that cover different ways the relevant information might appear. Queries should focus on meaning rather than exact wording, and avoid including instructions or filler text. These queries will be used for embedding-based search.",
        },
      },
      required: ["document_id", "query"],
    },

    async execute(properties: { document_id: number; query: string[] }, ctx: ToolContext) {
      if (properties.document_id < 0 || properties.document_id >= ctx.documents.length) {
        return {
          data: "Invalid `document_id` provided. Please check if the user has provided a document with that id.",
        };
      }

      const contextDocument = ctx.documents[properties.document_id];
      let matches: vectordb.DBQueryResult[] = [];

      for (const query of properties.query) {
        matches = matches.concat(contextDocument.vectors.query(await embedding.generateEmbedding(query), 5));

        for (let i = 0; i < contextDocument.chunks.length; i++) {
          if (contextDocument.chunks[i].includes(query)) {
            matches.push({ key: i, score: 0.75 });
          }
        }
      }

      matches.sort((resultA, resultB) => resultB.score - resultA.score);

      const top: string[] = [];
      const already: number[] = [];

      for (const match of matches) {
        if (top.length >= 8) break;

        if (!already.includes(match.key)) {
          already.push(match.key);
          top.push(contextDocument.chunks[match.key]);
        }
      }

      const summary = await summarizeTextAbortable(
        ctx,
        top.map((chunk, i) => `${i + 1}. ${chunk}`).join("\n\n"),
        properties.query.join(", "),
      );

      console.log(top);
      console.log("extracted");
      console.log(summary);

      return {
        data: summary,
      };
    },
  },
  {
    name: "file_summary",
    icon: BookOpenText,

    summary: "Summarizing a document",
    description:
      "Summarize an user uploaded document. Should only be used when the user explicitly asks for a document summary. Do not summarize a document only when explicitly asked to, otherwise refer to the file_search tool.",

    parameters: {
      type: "object",
      properties: {
        document_id: {
          type: "number",
          description: "The document id to summarize.",
        },
      },
      required: ["document_id"],
    },

    async execute(properties: { document_id: number }, ctx: ToolContext) {
      if (properties.document_id < 0 || properties.document_id >= ctx.documents.length) {
        return {
          data: "Invalid `document_id` provided. Please check if the user has provided a document with that id.",
        };
      }

      const contextDocument = ctx.documents[properties.document_id];
      const stitched = contextDocument.chunks.join("");

      const summary = await summarizeTextAbortable(
        ctx,
        stitched,
        "Summarize the following document in english, keeping important facts and information. Do not leave out important information like task numbers or markers. Respond ONLY with the summary. Don't reaffirm or provide any other commentary.",
      );

      return {
        data: summary,
      };
    },
  },
  {
    name: "translate",
    icon: LanguagesIcon,

    summary: "Translating a piece of text.",
    description:
      "Translate a string of text from one language, to another. Prefer using this tool for important or complicated text snippets, instead of relying on your own translations.",

    parameters: {
      type: "object",
      properties: {
        source_language_code: {
          type: "string",
          description:
            "The code of the source language (en, zh, etc...). If left empty, the source language will be guessed based on the text.",
        },
        target_language_code: {
          type: "string",
          description: "The code of the target language  (en, zh, etc...).",
        },
        text: {
          type: "string",
          description: "The text snippet to translate.",
        },
      },
      required: ["target_language_code", "text"],
    },

    async execute(props: { source_language_code?: string; target_language_code: string; text: string }, context) {
      const ollama = await ProviderManager.getInstance().getProvider("ollama");
      let sourceLanguage = props.source_language_code;

      if (typeof sourceLanguage !== "string" || !(sourceLanguage in languageMapping)) {
        sourceLanguage = "";

        await ollama!.generate(
          "qwen3:4b-instruct",
          [
            {
              id: "1",
              role: "system",
              content: `You are a language model designed to guess the language, and more specifically the language code of a snippet of text.
You should only respond with the code of the language the text uses, do not include any commentary or explanation.
Below are a list of languages and language codes for reference:\n${JSON.stringify(languageMapping, null, 2)}`,
            },
            {
              id: "2",
              role: "user",
              content: props.text,
            },
          ],
          null,
          async (chunk) => void (chunk.type === "text" && (sourceLanguage += chunk.content)),
          context.signal,
          false,
        );
      }

      let output = "";

      await ollama!.translate(
        "translategemma:12b",
        props.text,
        sourceLanguage!,
        props.target_language_code,
        async (chunk) => void (chunk.type === "text" && (output += chunk.content)),
        context.signal,
      );

      return {
        data: {
          translation: output,
        },
      };
    },
  },
];
