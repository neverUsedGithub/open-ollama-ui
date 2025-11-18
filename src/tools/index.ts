import * as embedding from "@/embedding";
import * as imageGen from "@/imagegen";
import { BraveSearchProvider } from "@/search/providers/brave";
import type { ModelTool, ToolContext } from "@/types";
import { extensionApi, isExtensionInstalled } from "@/util/extension";
import { freeOllamaModel } from "@/util/ollama";
import * as vectordb from "@/vectordb";
import BinaryIcon from "lucide-solid/icons/binary";
import BookOpenText from "lucide-solid/icons/book-open-text";
import CalculatorIcon from "lucide-solid/icons/calculator";
import GlobeIcon from "lucide-solid/icons/globe";
import ImagePlusIcon from "lucide-solid/icons/image-plus";
import ollama from "ollama/browser";
import TurndownService from "turndown";

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
      if (!exprRegex.test(properties.expression)) return { data: "ERROR: invalid expression" };
      return { data: eval(properties.expression) };
    },
  },
  {
    name: "image_gen",
    icon: ImagePlusIcon,
    summary: "Generating an image.",
    description: "Generate an image from a prompt.",
    parameters: {
      type: "object",
      properties: {
        prompt: {
          type: "string",
          description: `The prompt passed to an image generation AI model.
Prompts sent to \`image_gen\` should always be in English. If the user supplies a prompt in a different language, first translate the user's prompt, then refine it in English.
When refining an image prompt, the goal is to transform a short or vague request into a vivid, coherent description that an image generator can easily understand. The process begins by understanding the user's core intent. Identify the main subject of the image, such as a person, object, or scene. Determine the desired style or medium, like realistic photography, 3D render, anime, oil painting, or pixel art. Pay attention to the mood or tone the user wants—dark, cozy, mysterious, cheerful—and note the intended composition or framing, such as portrait, landscape, close-up, or wide shot. Also, look for any explicit requirements or restrictions, such as a transparent background, specific colors, or a request to exclude text or people.
Once the intent is clear, infer missing visual details that make the scene coherent. If the user doesn't specify lighting, background, or atmosphere, make reasonable assumptions that fit the context. For example, a “night scene” implies dim lighting and cool tones, while a “cozy” room would use warm light and soft textures. These inferred details should be consistent with the subject and mood but not excessive—add enough to make the prompt visually clear without overloading it.
Next, clarify ambiguous terms by replacing vague or subjective words with specific, visual ones. Instead of “cool lighting,” describe “soft golden light from a nearby lamp.” Instead of “fantasy scene,” describe “an ancient forest with glowing runes carved into stone pillars.” Resolve pronouns and unclear references so the subject of each phrase is explicit. Every part of the prompt should contribute directly to the image's appearance.
It's also important to strictly follow the user's constraints. If they request no text, transparent background, or a certain color scheme, those rules should be preserved exactly. Do not introduce new subjects, text, or elements the user didn’t mention.
Finally, rewrite the refined prompt as one to multiple clear sentences that sound natural, like instructions to a concept artist. Describe the scene in a cinematic or painterly way, focusing on sensory details and composition. For example: “A futuristic alley lit by flickering neon signs and mist, in a cyberpunk art style.” or “A tranquil forest clearing at dawn, with sunlight streaming through tall pines.” A good format to follow is: subject, style or medium, environment, lighting or mood, and any special details.`,
        },
      },
      required: ["prompt"],
    },

    mockOutput: [{ kind: "image", width: 512, height: 512 }],

    isSupported() {
      return imageGen.isAvailable();
    },

    async execute(properties: { prompt: string }, ctx: ToolContext) {
      // Free up vram for comfy.
      // TODO: for high vram users add an option to disable this.
      await freeOllamaModel(ctx.model);

      const imageBlob = await imageGen.generateImage(properties.prompt);

      return {
        data: "The image was generated successfully and will be shown to the user. Next up you should ask the user if they like the image and whether or not they would like to make any adjustments to it.",
        images: [imageBlob],
      };
    },
  },
  // {
  //   name: "code_interpreter",
  //   icon: BinaryIcon,
  //   summary: "Executing a piece of code.",
  //   description: `Executes a Python code snippet in a hidden, non-visible, internal runtime environment. Only Python is supported (version 3.10). The execution environment may not have internet access, and its file system is non-persistent — all files are cleared between calls. Code executed with this tool is never shown to the user, so do not use it to run code the user asked you to provide unless they explicitly request execution or testing. Only call this tool when it is genuinely required to answer the user’s request or when it is a necessary step in your internal reasoning; do not call it unnecessarily or speculatively.`,
  //   parameters: {
  //     type: "object",
  //     properties: {
  //       code: {
  //         type: "string",
  //         description: "The code snippet to execute.",
  //       },
  //     },

  //     required: ["code"],
  //   },

  //   mockOutput: [],

  //   async execute(properties: { code: string }) {
  //     const res = await fetch("https://emkc.org/api/v2/piston/execute", {
  //       method: "POST",
  //       headers: {
  //         "Content-Type": "application/json",
  //       },
  //       body: JSON.stringify({
  //         language: "python",
  //         version: "3.10",
  //         files: [
  //           {
  //             name: "main.py",
  //             content: properties.code,
  //           },
  //         ],
  //         stdin: "",
  //         args: [],
  //       }),
  //     });

  //     const data = await res.json();

  //     if (!res.ok) {
  //       throw new Error("code execution failed");
  //     }

  //     return {
  //       data: { code: data.run.code, output: data.run.output },
  //     };
  //   },
  // },
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

    async execute(properties: { url: string; query?: string }) {
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

        const summaryModel = "qwen3:4b-instruct-2507-fp16";
        const summarized = await ollama.chat({
          model: summaryModel,
          stream: false,
          options: {
            num_ctx: 16_000,
          },
          messages: [
            {
              role: "user",
              content: `You are an assistant that applies the user's query to a large document.

User query:
"${properties.query ?? "Summarize this web page."}"

Document:
\`\`\`markdown
${output}
\`\`\`

Instructions:
1. Identify only the information in the document that directly relates to the user's query.
2. Ignore unrelated content; do not invent answers.
3. Provide the extracted information in a concise, structured manner suitable for the main model to use.

Output only the extracted information.`,
            },
            { role: "user", content: output },
          ],
        });

        const furtherLinks = links.slice(0, 5);

        console.log({
          url: properties.url,
          title,
          links: furtherLinks,
          content: summarized.message.content,
        });

        return {
          data: {
            url: properties.url,
            title,
            links: furtherLinks,
            content: summarized.message.content,
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
          type: "string[]",
          description:
            "The user's question or topic to search for in the document. The model should generate around 5 semantically varied queries that cover different ways the relevant information might appear. Queries should focus on meaning rather than exact wording, and avoid including instructions or filler text. These queries will be used for embedding-based search.",
        },
      },
      required: ["document_id", "query"],
    },

    async execute(properties: { document_id: number; query: string[] }, context) {
      if (properties.document_id < 0 || properties.document_id >= context.documents.length) {
        return {
          data: "Invalid `document_id` provided. Please check if the user has provided a document with that id.",
        };
      }

      const contextDocument = context.documents[properties.document_id];
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

      const response = await ollama.chat({
        model: "gemma3:4b",
        options: {
          num_ctx: 16_000,
        },
        messages: [
          {
            role: "user",
            content: `You are an assistant that extracts relevant information from document chunks.

User query:
"${context.lastMessage}"

Document chunks:
${top.map((chunk, i) => `${i + 1}. ${chunk}`).join("\n")}

Instructions:
1. Identify only the information in the chunks that directly relates to the user's query.
2. Ignore unrelated content; do not invent answers.
3. Provide the extracted information in a concise, structured manner suitable for the main model to use.
4. If no chunks contain relevant information, respond with "No relevant information found."

Output only the extracted information.`,
          },
        ],
      });

      console.log(top);
      console.log("extracted");
      console.log(response.message.content);

      return {
        data: response.message.content,
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

    async execute(properties: { document_id: number }, context) {
      if (properties.document_id < 0 || properties.document_id >= context.documents.length) {
        return {
          data: "Invalid `document_id` provided. Please check if the user has provided a document with that id.",
        };
      }

      const contextDocument = context.documents[properties.document_id];
      const stitched = contextDocument.chunks.join("");

      const response = await ollama.chat({
        model: "gemma3:4b",
        options: {
          num_ctx: 64000,
        },
        messages: [
          {
            role: "user",
            content: `Summarize the following document in english, keeping important facts and information. Do not leave out important information like task numbers or markers. Respond ONLY with the summary. Don't reaffirm or provide any other commentary.

Document:
${stitched}`,
          },
        ],
      });

      return {
        data: response.message.content,
      };
    },
  },
];
