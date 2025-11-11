import ArrowUpIcon from "lucide-solid/icons/arrow-up";
import ImagePlusIcon from "lucide-solid/icons/image-plus";
import PaperclipIcon from "lucide-solid/icons/paperclip";
import BrainIcon from "lucide-solid/icons/brain";
import PlusIcon from "lucide-solid/icons/plus";
import SquareIcon from "lucide-solid/icons/square";
import GlobeIcon from "lucide-solid/icons/globe";
import LightbulbIcon from "lucide-solid/icons/lightbulb";
import XIcon from "lucide-solid/icons/x";
import CheckIcon from "lucide-solid/icons/check";
import TriangleAlert from "lucide-solid/icons/triangle-alert";
import CalculatorIcon from "lucide-solid/icons/calculator";
import BinaryIcon from "lucide-solid/icons/binary";
import BookOpenText from "lucide-solid/icons/book-open-text";
import ollama from "ollama/browser";
import type { AbortableAsyncIterator, ChatResponse, ShowResponse } from "ollama";
import { createEffect, createMemo, createSignal, For, onMount, Show } from "solid-js";
import TurndownService from "turndown";
import * as streamingMarkdown from "streaming-markdown";
import { Dropdown } from "@/components/Dropdown";
import { IconButton } from "@/components/IconButton";
import * as imageGen from "@/imagegen";
import { cn } from "@/util/cn";
import { promptTemplates } from "@/util/constant";
import { freeOllamaModel } from "@/util/ollama";
import { buildSystemPrompt } from "@/util/prompt";
import { Dynamic } from "solid-js/web";
import * as pdfjs from "pdfjs-dist";
import * as embedding from "@/embedding";
import * as vectordb from "@/vectordb";
import hljs from "highlight.js";
import { splitText } from "@/util/splitText";
import type {
  AssistantChatMessage,
  ChatMessage,
  ChatMessageAttachment,
  ChatMessageState,
  InputTag,
  NativeChatMessage,
  ModelState,
  PromptTemplate,
  SubChatMessage,
  SubChatMessageData,
  TextSubChatMessage,
  ModelTool,
  ToolOutput,
  SupportContext,
  ToolContext,
  UserChatMessage,
  UserFile,
  RAGDocument,
} from "@/types";
import { BraveSearchProvider } from "@/search/providers/brave";
import { extensionApi, isExtensionInstalled } from "@/util/extension";
import pdfjsWorkerURL from "pdfjs-dist/build/pdf.worker.mjs?url";
import katex from "katex";
import { extractPDF } from "./documents/pdf";

import "./Chat.css";

pdfjs.GlobalWorkerOptions.workerSrc = pdfjsWorkerURL;

const availableHighlightingLanguages = hljs.listLanguages();

const modelTools: ModelTool[] = [
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
  {
    name: "code_interpreter",
    icon: BinaryIcon,
    summary: "Executing a piece of code.",
    description: `Executes a python code snippet.
The currently supported python version is 3.10.
The container running the python program is NOT guaranteed to have internet connectivity.
The file system of the python environment is NOT persistent, it will reset between code_interpreter calls.`,
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

    async execute(properties: { code: string }) {
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
              content: properties.code,
            },
          ],
          stdin: "",
          args: [],
        }),
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

        const summaryModel = "granite4:micro-h";
        const summarized = await ollama.chat({
          model: summaryModel,
          stream: false,
          options: {
            num_ctx: 64000,
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
      "Search for relevant information inside an uploaded document. Should be used when you need to reference a document to answer one of the user's questions, requests, or tasks. The model should generate multiple search queries that capture different ways the relevant information might appear in the document, including synonyms, paraphrases, and related concepts. This helps ensure semantic search can find the most relevant chunks.",
    parameters: {
      type: "object",
      properties: {
        document_id: {
          type: "number",
          description: "The document id to search for the provided query or queries.",
        },
        query: {
          type: ["string", "string[]"],
          description:
            "The user's question or topic to search for in the document. The model should generate around 5 semantically varied queries that cover different ways the relevant information might appear. Queries should focus on meaning rather than exact wording, and avoid including instructions or filler text. These queries will be used for embedding-based search.",
        },
      },
      required: ["document_id", "query"],
    },

    async execute(properties: { document_id: number; query: string | string[] }, context) {
      if (properties.document_id < 0 && properties.document_id >= context.documents.length) {
        return {
          data: "Invalid `document_id` provided. Please check if the user has provided a document with that id.",
        };
      }

      const contextDocument = context.documents[properties.document_id];
      const queries = Array.isArray(properties.query) ? properties.query : [properties.query];
      let matches: vectordb.DBQueryResult[] = [];

      for (const query of queries) {
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
        model: "granite4:micro-h",
        options: {
          num_ctx: 64000,
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
          description: "The document id to summarize",
        },
      },
      required: ["document_id"],
    },

    async execute(properties: { document_id: number }, context) {
      if (properties.document_id < 0 && properties.document_id >= context.documents.length) {
        return {
          data: "Invalid `document_id` provided. Please check if the user has provided a document with that id.",
        };
      }

      const contextDocument = context.documents[properties.document_id];
      const stitched = contextDocument.chunks.join("");

      const response = await ollama.chat({
        model: "granite4:micro-h",
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

const inputTags: InputTag[] = [
  {
    id: "create-image",

    name: "Create Image",
    short: "Image",
    icon: ImagePlusIcon,
    placeholder: "Describe an image",

    prompt:
      "You should create an image using the `image_gen` tool by the user's description. If you aren't certain the user's prompt is describing an image, ask the user for further details.",

    isSupported() {
      return imageGen.isAvailable();
    },
  },

  {
    id: "search-web",

    name: "Web Search",
    short: "Search",
    icon: GlobeIcon,

    prompt: "You should prefer executing a web search based on the user's query.",

    async isSupported() {
      return isExtensionInstalled();
    },
  },

  {
    id: "think",

    name: "Thinking",
    short: "Think",
    icon: LightbulbIcon,

    async isSupported(ctx) {
      return ctx.modelMetaData.capabilities.includes("thinking");
    },
  },
];

function OptionsButton(props: {
  freeLoadedModels: () => void;
  promptFileUpload: () => void;
  toggleTag: (tag: string) => void;
  inputTag: string | null;
  tagSupport: Record<string, boolean>;
}) {
  return (
    <Dropdown>
      <Dropdown.Trigger>
        <button class="not-disabled:hover:bg-background-higher size-9 cursor-default rounded-full p-2 not-disabled:cursor-pointer">
          <PlusIcon class="text-foreground-muted size-5" />
        </button>
      </Dropdown.Trigger>
      <Dropdown.Content>
        <Dropdown.Item onSelect={props.promptFileUpload}>
          <PaperclipIcon class="size-4" />
          <span class="-translate-y-0.25">Add photo or file</span>
        </Dropdown.Item>
        <Dropdown.Separator />
        <For each={inputTags}>
          {(tag) => (
            <Dropdown.Item
              onSelect={() => props.toggleTag(tag.id)}
              class={cn(props.inputTag === tag.id && "text-accent-default")}
              disabled={!props.tagSupport[tag.id]}
            >
              <Dynamic component={tag.icon} class="size-4" />
              <span class="-translate-y-0.25">{tag.name}</span>
              <Show when={props.inputTag === tag.id}>
                <div class="ml-auto">
                  <CheckIcon class="size-4" />
                </div>
              </Show>
            </Dropdown.Item>
          )}
        </For>
        <Dropdown.Separator />
        <Dropdown.Item onSelect={props.freeLoadedModels}>
          <BrainIcon class="size-4" />
          <span class="-translate-y-0.25">Free VRAM</span>
        </Dropdown.Item>
      </Dropdown.Content>
    </Dropdown>
  );
}

function SendButton(props: {
  allowMessage: boolean;
  modelState: ModelState;
  stopMessage: () => void;
  sendMessage: () => void;
}) {
  return (
    <>
      <Show when={props.modelState !== "typing"}>
        <IconButton
          icon={<ArrowUpIcon />}
          class={cn(props.allowMessage && "bg-foreground text-background")}
          onClick={props.sendMessage}
        />
      </Show>

      <Show when={props.modelState === "typing"}>
        <IconButton icon={<SquareIcon fill="white" />} class="text-foreground p-3" onClick={props.stopMessage} />
      </Show>
    </>
  );
}

function ChatMessageAttachmentView(props: { attachment: ChatMessageAttachment }) {
  if (props.attachment.type === "image")
    return <img class="ml-6 w-full rounded-2xl sm:w-1/2" src={URL.createObjectURL(props.attachment.source)} />;
}

function formatErrorData(error: unknown) {
  if (!(error instanceof Error)) return `${error}`;

  return `${error.name}: ${error.message}\n${(error.stack ?? "")
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => `  ${line}`)
    .join("\n")}`;
}

function SubMessageView(props: { subMessage: SubChatMessage; messageState: ChatMessageState; latest: boolean }) {
  if (props.subMessage.kind === "attachment")
    return <ChatMessageAttachmentView attachment={props.subMessage.attachment} />;

  if (props.subMessage.kind === "toolcall") {
    const toolName = props.subMessage.toolName;
    const tool = modelTools.find((tool) => tool.name === toolName)!;

    return (
      <div class="text-foreground-muted flex items-center gap-2">
        <Dynamic component={tool.icon} class="size-4" />
        <span class="-translate-y-0.25">{props.subMessage.summary}</span>
      </div>
    );
  }

  if (props.subMessage.kind === "image-mock")
    return (
      <div
        class="ml-6 overflow-hidden rounded-2xl sm:max-w-1/2"
        style={{ "aspect-ratio": `${props.subMessage.width} / ${props.subMessage.height}` }}
      >
        <div class="bg-background-default h-full w-full animate-pulse"></div>
      </div>
    );

  if (props.subMessage.kind === "error") {
    const [errorExpanded, setErrorExpanded] = createSignal(false);

    return (
      <div class="flex flex-col gap-2">
        <button
          class="bg-error-overlay text-error-default border-error-dimmer flex w-fit cursor-pointer items-center gap-2 rounded-xl border-1 py-3 pr-5 pl-4"
          onClick={() => setErrorExpanded((state) => !state)}
        >
          <TriangleAlert class="size-4" />
          <span class="-translate-y-0.25">{props.subMessage.title}</span>
        </button>
        <Show when={errorExpanded()}>
          <div class="bg-error-overlay text-error-default border-error-dimmer flex w-fit items-center gap-2 rounded-xl border-1 py-3 pr-5 pl-4">
            <pre>
              <code>{formatErrorData(props.subMessage.message)}</code>
            </pre>
          </div>
        </Show>
      </div>
    );
  }

  const messageContainer = (
    <div class="markdown-container h-fit w-full overflow-hidden text-wrap break-words"></div>
  ) as HTMLDivElement;

  let renderer: streamingMarkdown.Default_Renderer | null = null;
  let parser: streamingMarkdown.Parser | null = null;
  let lastWritten = 0;

  const codeBlockObserver = new MutationObserver((mutationList) => {
    for (const mutation of mutationList) {
      const targetEement = mutation.target as HTMLElement;
      if (!targetEement.className) return;

      const result = hljs.highlight(targetEement.textContent, { language: targetEement.className });
      (targetEement.previousSibling! as HTMLElement).innerHTML = result.value;
    }
  });

  const latexObserver = new MutationObserver((mutationList) => {
    for (const mutation of mutationList) {
      const targetEement = mutation.target as HTMLElement;

      try {
        const string = katex.renderToString(targetEement.textContent, {
          displayMode: targetEement.tagName === "EQUATION-BLOCK",
          throwOnError: true,
        });

        (targetEement.previousSibling! as HTMLElement).innerHTML = string;
      } catch {
        console.log("failed to render");
      }
    }
  });

  const newElementObserver = new MutationObserver((mutationList) => {
    for (const mutation of mutationList) {
      if (mutation.type === "childList") {
        for (const node of mutation.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            const elem = node as HTMLElement;

            if (elem.tagName === "A") {
              (elem as HTMLAnchorElement).target = "_blank";
            }

            if (
              elem.tagName === "CODE" &&
              elem.parentElement &&
              elem.parentElement.tagName === "PRE" &&
              availableHighlightingLanguages.includes(elem.className) &&
              !elem.dataset.highlighted
            ) {
              const clone = elem.cloneNode() as HTMLElement;
              clone.dataset.highlighted = "true";
              elem.parentElement.insertBefore(clone, elem);
              elem.style.display = "none";

              codeBlockObserver.observe(elem, { childList: true });
            }

            if (elem.parentElement && (elem.tagName === "EQUATION-BLOCK" || elem.tagName === "EQUATION-INLINE")) {
              const display = document.createElement("div");
              elem.parentElement.insertBefore(display, elem);
              elem.style.display = "none";

              latexObserver.observe(elem, { childList: true });
            }
          }
        }
      }
    }
  });

  newElementObserver.observe(messageContainer, { childList: true, subtree: true });

  const timeEnd: number = props.subMessage.timeEnd() || props.subMessage.timeStart();

  const [thinkingTime, setThinkingTime] = createSignal(timeEnd - props.subMessage.timeStart());
  const [thinkingExpanded, setThinkingExpanded] = createSignal(false);

  if (props.subMessage.thinking) {
    const updateTime = 10;

    function thinkingIncrement() {
      const sub = props.subMessage as TextSubChatMessage;
      if (sub.finished) return;

      setThinkingTime((time) => time + updateTime);
      setTimeout(thinkingIncrement, updateTime);
    }

    setTimeout(thinkingIncrement, updateTime);
  }

  createEffect(() => {
    renderer ??= streamingMarkdown.default_renderer(messageContainer);
    parser ??= streamingMarkdown.parser(renderer);

    streamingMarkdown.parser_write(parser, (props.subMessage as TextSubChatMessage).content().substring(lastWritten));
    lastWritten = (props.subMessage as TextSubChatMessage).content().length;
  });

  createEffect(() => {
    if (!props.latest && parser) {
      streamingMarkdown.parser_end(parser);
    }
  });

  props.subMessage.removeToolCall = function removeToolCall() {
    let removedToolBlock = false;

    if (messageContainer.children.length > 0) {
      const lastChild = messageContainer.children[messageContainer.children.length - 1];

      if (lastChild.tagName === "PRE" && lastChild.children.length === 1 && lastChild.children[0].tagName === "CODE") {
        lastChild.remove();
        removedToolBlock = true;
      } else if (lastChild.tagName === "P") {
        lastChild.textContent = lastChild.textContent.substring(0, lastChild.textContent.indexOf("<tool>"));
        removedToolBlock = true;
      }
    }

    if (!removedToolBlock) {
      console.warn("failed to remove tool call");
    }
  };

  if (props.subMessage.thinking) {
    return (
      <div class="text-foreground-muted flex flex-col gap-2">
        <button class="flex cursor-pointer items-center gap-2" onClick={() => setThinkingExpanded((prev) => !prev)}>
          <LightbulbIcon class="size-4" />
          <span class="-translate-y-0.25">
            {props.latest && !props.subMessage.finished ? "Thinking" : "Thought"} for{" "}
            {(thinkingTime() / 1000).toFixed(1)}s
          </span>
        </button>
        <Show when={thinkingExpanded()}>
          <div class="border-l-background-higher ml-1.75 border-l-2 pl-4">{messageContainer}</div>
        </Show>
      </div>
    );
  }

  return messageContainer;
}

function ChatMessageView(props: { message: ChatMessage }) {
  if (props.message.role === "user") {
    return (
      <div class="bg-background-default h-fit w-fit max-w-3/4 self-end rounded-2xl p-2 px-4">
        <pre class="text-wrap break-words">{props.message.content}</pre>
      </div>
    );
  }

  const subMessageCount = createMemo(() =>
    props.message.role === "assistant" ? props.message.subMessages().length : 0,
  );

  return (
    <>
      <div class="flex flex-col gap-2 px-4 py-2">
        <For each={props.message.subMessages()}>
          {(subMessage, index) => (
            <SubMessageView
              subMessage={subMessage}
              messageState={(props.message as AssistantChatMessage).state()}
              latest={index() === subMessageCount() - 1}
            />
          )}
        </For>

        <Show when={props.message.state() === "loading"}>
          <div class="flex gap-2 rounded-2xl py-2">
            <div class="bg-foreground animate-beat size-3 rounded-full"></div>
          </div>
        </Show>
      </div>
    </>
  );
}

function noop() {}

function createSubMessage(data: SubChatMessageData): SubChatMessage {
  if (data.kind !== "text") return data;

  const [content, setContent] = createSignal(data.content);

  const [timeEnd, setTimeEnd] = createSignal(data.timeEnd);
  const [timeStart, setTimeStart] = createSignal(data.timeStart);

  function stream(data: string) {
    setContent((curr) => curr + data);
  }

  return {
    kind: "text",
    content,
    stream,
    thinking: data.thinking,
    finished: data.finished,

    removeToolCall: noop,

    timeStart,
    timeEnd,

    setTimeStart,
    setTimeEnd,
  };
}

export function createChatMessage(role: "user", content: string, files: UserFile[]): UserChatMessage;
export function createChatMessage(role: "assistant"): AssistantChatMessage;
export function createChatMessage(
  role: string,
  content?: string,
  files?: UserFile[],
): UserChatMessage | AssistantChatMessage {
  if (role === "user") return { role, content: content!, files: files! };

  const [state, setState] = createSignal<ChatMessageState>("loading");
  const [subMessages, setSubMessages] = createSignal<SubChatMessage[]>([]);

  return {
    role: role as "assistant",

    state,
    setState,

    subMessages,

    push(subMessage) {
      const sub = createSubMessage(subMessage);
      const lastMessage = subMessages()[subMessages().length - 1];

      if (lastMessage && lastMessage.kind === "text") {
        lastMessage.finished = true;

        if (lastMessage.timeEnd() === 0) {
          lastMessage.setTimeEnd(Date.now());
        }
      }

      setSubMessages([...subMessages(), sub]);

      return sub;
    },

    remove(subMessage) {
      setSubMessages(subMessages().filter((msg) => msg !== subMessage));
    },
  };
}

function InputTagButton(props: { tag: string; toggleTag: (tag: string) => void }) {
  const tagData = createMemo(() => inputTags.find((tag) => tag.id === props.tag)!);

  return (
    <button
      class="not-disabled:hover:bg-accent-overlay text-accent-default input-tag-button flex h-[36px] cursor-default items-center gap-2 rounded-full p-2 px-3 not-disabled:cursor-pointer"
      onClick={() => props.toggleTag(props.tag)}
    >
      <Dynamic component={tagData().icon} class="size-5" />
      <XIcon class="bg-accent-overlay size-5 rounded-full p-0.75" />
      {tagData().short}
    </button>
  );
}

export interface ChatViewProps {
  selectedModel: string;

  dataMessages: NativeChatMessage[];
  addDataMessage(message: NativeChatMessage): void;

  addChatMessage(message: ChatMessage): void;
  chatMessages: ChatMessage[];
}

export function ChatView(props: ChatViewProps) {
  const [modelMetadata, setModelMetadata] = createSignal<ShowResponse | null>(null);
  const [modelState, setModelState] = createSignal<ModelState>("loading");
  const [inputTag, setInputTag] = createSignal<string | null>(null);
  const [inputMultiLine, setInputMultiLine] = createSignal(false);
  const [inputText, setInputText] = createSignal("");
  const [userFileUploads, setUserFileUploads] = createSignal<UserFile[]>([]);

  const expanded = createMemo(() => inputMultiLine() || inputTag() !== null);
  const allowMessage = createMemo(() => inputText() !== "" && modelState() === "idle");
  const inputTagData = createMemo(() => inputTags.find((tag) => tag.id === inputTag()));
  const modelSupportsTools = createMemo(() => modelMetadata()?.capabilities.includes("tools"));

  const [tagSupport, setTagSupport] = createSignal<Record<string, boolean>>({});
  const [toolSupport, setToolSupport] = createSignal<Record<string, boolean>>({});

  const ragDocuments: RAGDocument[] = [];

  const inputTextArea = (
    <textarea
      placeholder={inputTagData()?.placeholder ?? "Ask about anything"}
      class="placeholder-foreground-muted transition-[height 2s linear] w-full resize-none overflow-y-auto text-wrap break-all outline-none"
      value={inputText()}
      onInput={(ev) => onTextareaInput(ev.target.value)}
      onKeyPress={handleKeyPress}
      rows="1"
    ></textarea>
  ) as HTMLTextAreaElement;

  let inputLineHeight: number = 0;
  let messagesContainer!: HTMLDivElement;
  let ollamaResponse: AbortableAsyncIterator<ChatResponse> | null = null;

  createEffect(async () => {
    const metadata = modelMetadata();
    if (!metadata) return;

    const supportContext: SupportContext = {
      modelMetaData: metadata,
    };

    for (const tag of inputTags) {
      if (!tag.isSupported) {
        setTagSupport((current) => ({ ...current, [tag.id]: true }));
        continue;
      }

      tag
        .isSupported(supportContext)
        .then((support) => setTagSupport((current) => ({ ...current, [tag.id]: support })));
    }

    for (const tool of modelTools) {
      if (!tool.isSupported) {
        setToolSupport((current) => ({ ...current, [tool.name]: true }));
        continue;
      }

      tool
        .isSupported(supportContext)
        .then((support) => setToolSupport((current) => ({ ...current, [tool.name]: support })));
    }
  });

  createEffect(() => {
    const model = props.selectedModel;

    ollama.show({ model }).then((meta) => {
      setModelMetadata(meta);
      setModelState("idle");
    });
  });

  createEffect(() => {
    props.chatMessages;

    if (messagesContainer?.parentElement?.parentElement) {
      messagesContainer.parentElement.parentElement.scrollTo({ top: messagesContainer.scrollHeight });
    }
  });

  function insertTemplate(template: PromptTemplate) {
    setInputTag(null);
    sendMessage(template.insertion);
  }

  function handleKeyPress(ev: KeyboardEvent) {
    if (ev.key !== "Enter") return;
    if (ev.shiftKey) return;

    ev.preventDefault();
    sendMessage(inputText());
  }

  function stopMessage() {
    if (ollamaResponse) ollamaResponse.abort();
  }

  async function freeLoadedModels() {
    const runningModels = await ollama.ps();
    for (const model of runningModels.models) {
      await freeOllamaModel(model.name);
    }

    await imageGen.freeResources();
  }

  function promptFileUpload() {
    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = ".png,.jpg,.webp,.pdf";
    fileInput.multiple = true;

    fileInput.addEventListener("change", async () => {
      if (!fileInput.files) return;
      const newFiles = [...userFileUploads()];

      for (const file of fileInput.files) {
        const bytes = await file.bytes();

        if (file.name.endsWith(".pdf")) {
          newFiles.push({ kind: "document", fileName: file.name, content: bytes });
        } else {
          newFiles.push({ kind: "image", content: bytes, encoded: await ollama.encodeImage(bytes) });
        }
      }

      setUserFileUploads(newFiles);
    });

    fileInput.click();
  }

  onMount(() => {
    const inputComputedStyle = getComputedStyle(inputTextArea);

    inputLineHeight = parseInt(inputComputedStyle.lineHeight);

    inputTextArea.style.height = `${inputLineHeight}px`;
    inputTextArea.style.maxHeight = `${inputLineHeight * 12}px`;
  });

  function fitTextArea() {
    if (inputText() === "") {
      setInputMultiLine(false);
    } else if (!inputMultiLine()) {
      setInputMultiLine(inputTextArea.scrollHeight > inputLineHeight);
    }

    inputTextArea.style.height = "fit-content";
    inputTextArea.style.height = `${inputTextArea.scrollHeight}px`;
  }

  function onTextareaInput(text: string) {
    setInputText(text);
    fitTextArea();
  }

  function toggleTag(tag: string) {
    if (inputTag() === tag) {
      setInputTag(null);
    } else {
      setInputTag(tag);
    }
  }

  async function runModelTool(
    assistantMessage: AssistantChatMessage,
    supportedTools: ModelTool[],
    lastMessage: string,
    toolName: string,
    toolParams: Record<string, string>,
  ): Promise<ToolOutput> {
    const foundTool = supportedTools.find((tool) => tool.name === toolName);
    if (!foundTool) throw new Error();

    for (const required of foundTool.parameters.required) {
      if (!(required in toolParams)) throw new Error("model produced invalid tool call");
    }

    const mocks: SubChatMessage[] = [];

    if (foundTool.mockOutput) {
      for (const mock of foundTool.mockOutput) {
        if (mock.kind === "image") {
          const imageWidth = typeof mock.width === "string" ? toolParams[mock.width] : mock.width;
          const imageHeight = typeof mock.height === "string" ? toolParams[mock.height] : mock.height;

          if (typeof imageWidth !== "number" || typeof imageHeight !== "number") continue;

          mocks.push(assistantMessage.push({ kind: "image-mock", width: imageWidth, height: imageHeight }));
        }
      }
    }

    const toolContext: ToolContext = {
      model: props.selectedModel,
      documents: ragDocuments,
      lastMessage: lastMessage,
    };

    const result = await foundTool.execute(toolParams, toolContext);

    for (const mock of mocks) assistantMessage.remove(mock);

    if (result.images) {
      for (const image of result.images) {
        assistantMessage.push({
          kind: "attachment",
          attachment: { type: "image", source: image },
        });
      }
    }

    return result;
  }

  async function processDocumentUploads(fileUploads: UserFile[]) {
    // const pdfRenderCanvas = document.createElement("canvas");
    const partialDocuments: { name: string; chunks: string[] }[] = [];

    for (const file of fileUploads) {
      if (file.kind !== "document") continue;

      console.group(`[DOC] ${file.fileName}`);

      let documentText: string;

      if (file.fileName.endsWith(".pdf")) {
        documentText = await extractPDF(file.content);
      } else {
        throw new Error(`cannot parse document '${file.fileName}'`);
      }

      partialDocuments.push({ name: file.fileName, chunks: splitText(documentText, 512) });
      console.groupEnd();
    }

    for (const doc of partialDocuments) {
      const db = await vectordb.createDatabase();

      for (let i = 0; i < doc.chunks.length; i++) {
        console.log(`[EMBED] processing chunk`);
        const vector = await embedding.generateEmbedding(doc.chunks[i]);

        console.log(`[RAG] appending chunk`);
        db.add(i, [vector]);
      }

      props.addDataMessage({
        role: "user",
        content: `[user uploaded document '${doc.name}', document id ${ragDocuments.length}]`,
        hidden: true,
      });

      ragDocuments.push({
        name: doc.name,
        chunks: doc.chunks,
        vectors: db,
      });
    }
  }

  async function sendMessage(userMessage: string): Promise<void> {
    if (modelState() !== "idle" || userMessage === "") return;

    const fileUploads = userFileUploads();

    const currentTag = inputTagData();
    const assistantMessage = createChatMessage("assistant");
    const userChatMessage = createChatMessage("user", userMessage, fileUploads);

    const supportedTools = modelTools.filter((tool) => toolSupport()[tool.name]);
    const promptTools = modelSupportsTools() ? undefined : supportedTools;
    const modelSystemRole = "system";

    if (props.dataMessages.length === 0) {
      props.addDataMessage({
        role: modelSystemRole,
        content: buildSystemPrompt({ tools: promptTools }),
        hidden: true,
      });
    }

    props.dataMessages[0].content = buildSystemPrompt({ tools: promptTools });

    if (currentTag && currentTag.prompt) {
      props.addDataMessage({ role: "user", content: currentTag.prompt });
    }

    await processDocumentUploads(fileUploads);

    let userImages: string[] = [];

    for (const file of fileUploads) {
      if (file.kind === "image") {
        userImages.push(file.encoded);
      }
    }

    props.addDataMessage({
      role: "user",
      content: userMessage,
      images: userImages.length > 0 ? userImages : undefined,
    });

    setInputText("");
    setUserFileUploads([]);
    setInputTag(null);
    fitTextArea();

    setModelState("loading");

    props.addChatMessage(userChatMessage);
    props.addChatMessage(assistantMessage);

    const codeBlockRegex = /((?<!`)`(?!`))(?:.(?!\1))*.?(?<close>\1)?/;

    let newTurn = false;

    let errored = false;
    let error: unknown = null;

    turnLoop: do {
      newTurn = false;

      const runningModels = await ollama.ps();

      if (!runningModels.models.find((model) => model.model === props.selectedModel)) {
        setModelState("loading");
        assistantMessage.setState("loading");
      }

      console.log(props.dataMessages);

      ollamaResponse = await ollama.chat({
        messages: props.dataMessages,
        model: props.selectedModel,
        tools: modelSupportsTools()
          ? supportedTools.map((tool) => ({
              type: "function",
              function: tool,
            }))
          : undefined,
        stream: true,
        think: !currentTag
          ? true
          : currentTag.id === "think" && props.selectedModel.includes("gpt-oss")
            ? "high"
            : true,
      });

      let isToolCall = false;

      let textContent = "";
      let thinkingContent = "";

      let currentTextSubmessage: TextSubChatMessage | null = null;

      try {
        let lastBlockIndex = 0;

        for await (const part of ollamaResponse) {
          if (part.message.tool_calls) {
            props.addDataMessage({
              role: "assistant",
              content: textContent,
              thinking: thinkingContent,
              tool_calls: part.message.tool_calls,
            });

            assistantMessage.setState("toolcall");

            for (const tool of part.message.tool_calls) {
              const summary = modelTools.find((mtool) => mtool.name === tool.function.name)?.summary;
              assistantMessage.push({ kind: "toolcall", summary: summary ?? "", toolName: tool.function.name });

              const result = await runModelTool(
                assistantMessage,
                supportedTools,
                userMessage,
                tool.function.name,
                tool.function.arguments,
              );

              props.addDataMessage({
                role: "tool",
                tool_name: tool.function.name,
                content: JSON.stringify(result.data, null, 2),
                hidden: true,
              });
            }

            newTurn = true;

            continue turnLoop;
          }

          if (part.message.thinking && (currentTextSubmessage === null || !currentTextSubmessage.thinking)) {
            setModelState("typing");
            assistantMessage.setState("thinking");

            currentTextSubmessage = assistantMessage.push({
              kind: "text",
              content: "",
              thinking: true,
              finished: false,
              timeStart: Date.now(),
              timeEnd: 0,
            });
          }

          if (!part.message.thinking && (!currentTextSubmessage || currentTextSubmessage.thinking)) {
            setModelState("typing");
            assistantMessage.setState("typing");

            currentTextSubmessage = assistantMessage.push({
              kind: "text",
              content: "",
              thinking: false,
              finished: false,
              timeStart: Date.now(),
              timeEnd: 0,
            });
          }

          if (!currentTextSubmessage) {
            throw new Error("");
          }

          textContent += part.message.content;
          if (modelSupportsTools() || !isToolCall) currentTextSubmessage.stream(part.message.content);

          if (part.message.thinking) {
            thinkingContent += part.message.thinking;
            currentTextSubmessage.stream(part.message.thinking);
          }

          if (!modelSupportsTools()) {
            const codeBlockMatch = textContent.substring(lastBlockIndex).match(codeBlockRegex);
            const inCodeBlock = codeBlockMatch !== null;

            if (inCodeBlock) {
              if (codeBlockMatch.groups?.close) {
                lastBlockIndex = (codeBlockMatch.index ?? 0) + codeBlockMatch[0].length;
              }
            } else {
              if (textContent.includes("<tool>") && !isToolCall) {
                isToolCall = true;
                assistantMessage.setState("toolcall");
                currentTextSubmessage.removeToolCall();
              }
            }
          }
        }
      } catch (e) {
        error = e;
        errored = true;
        newTurn = false;
        console.error(e);
      }

      if (!modelSupportsTools()) {
        if (!errored && isToolCall) {
          try {
            assistantMessage.setState("toolcall");

            const toolContent = textContent.substring(
              textContent.indexOf("<tool>"),
              textContent.lastIndexOf("</tool>") + "</tool>".length,
            );

            const parsed = new DOMParser().parseFromString(toolContent, "text/xml");
            const toolName = parsed.querySelector("name")?.textContent;
            const parameters = Array.from(parsed.querySelectorAll("parameter"));
            const toolParams: Record<string, string> = {};

            if (!toolName) throw new Error("model produced invalid tool call (missing name)");

            const summaryText = parsed.querySelector("summary")?.textContent ?? `Executing tool '${toolName}'.`;

            assistantMessage.push({ kind: "toolcall", summary: summaryText, toolName });

            for (const parameter of parameters) {
              const parameterName = parameter.getAttribute("name");

              if (!parameterName)
                throw new Error(`model produced invalid tool call (missing paramater '${parameterName}')`);
              toolParams[parameterName] = parameter.textContent;
            }

            const result = await runModelTool(assistantMessage, supportedTools, userMessage, toolName, toolParams);

            props.addDataMessage({ role: "assistant", content: `\`\`\`xml\n${toolContent}\n\`\`\``, hidden: true });
            props.addDataMessage({
              role: "user",
              content: `The output of tool '${toolName}'. The user cannot see this message.

\`\`\`json
${JSON.stringify(result.data, null, 2)}
\`\`\``,
              hidden: true,
            });

            newTurn = true;

            continue;
          } catch (e) {
            error = e;
            errored = true;
            newTurn = false;
            console.warn(e);
          }
        }
      }

      props.addDataMessage({ role: "assistant", content: textContent, thinking: thinkingContent });
    } while (newTurn);

    if (errored && !(error instanceof DOMException && error.name === "AbortError")) {
      assistantMessage.push({ kind: "error", title: "Internal Error", message: error });
    }

    assistantMessage.setState("finished");
    setModelState("idle");
    ollamaResponse = null;

    inputTextArea.focus();
  }

  return (
    <div class="flex h-screen p-8">
      <div class="flex w-8/12 flex-1 flex-col gap-8">
        <Show when={props.chatMessages.length === 0}>
          <div class="flex h-1/2 items-end justify-center gap-4">
            <img src="open-llm-ui.svg" alt="" class="size-12" />
            <h2 class="font-handwriting -translate-y-1 text-4xl">{props.selectedModel}</h2>
          </div>
        </Show>

        <Show when={props.chatMessages.length > 0}>
          <div class="flex-1 overflow-y-auto">
            <div class="mx-auto h-full max-h-full w-full max-w-[800px]">
              <div class="flex flex-col gap-4 overflow-x-hidden pb-32" ref={messagesContainer}>
                <For each={props.chatMessages}>{(message) => <ChatMessageView message={message} />}</For>
              </div>
            </div>
          </div>
        </Show>

        <div class="bg-background mx-auto flex w-full max-w-[800px] flex-col items-center">
          <div
            class={cn(
              "bg-background-default border-border flex w-full items-center gap-2 rounded-4xl border px-3 shadow-xl/20",
              expanded() && "flex-col",
            )}
          >
            <Show when={!expanded()}>
              <OptionsButton
                freeLoadedModels={freeLoadedModels}
                promptFileUpload={promptFileUpload}
                toggleTag={toggleTag}
                inputTag={inputTag()}
                tagSupport={tagSupport()}
              />
            </Show>

            <div class={cn("min-h-fit w-full min-w-fit flex-1 py-3.5", expanded() && "px-3.5 pb-0")}>
              {inputTextArea}
            </div>

            <Show when={!expanded()}>
              <SendButton
                allowMessage={allowMessage()}
                modelState={modelState()}
                stopMessage={stopMessage}
                sendMessage={() => sendMessage(inputText())}
              />
            </Show>

            <Show when={expanded()}>
              <div class="flex w-full pt-1 pb-3">
                <OptionsButton
                  freeLoadedModels={freeLoadedModels}
                  promptFileUpload={promptFileUpload}
                  toggleTag={toggleTag}
                  inputTag={inputTag()}
                  tagSupport={tagSupport()}
                />

                <Show when={inputTag() !== null}>
                  <InputTagButton tag={inputTag()!} toggleTag={toggleTag} />
                </Show>

                <div class="flex-1"></div>

                <SendButton
                  allowMessage={allowMessage()}
                  modelState={modelState()}
                  stopMessage={stopMessage}
                  sendMessage={() => sendMessage(inputText())}
                />
              </div>
            </Show>
          </div>

          <Show when={props.chatMessages.length === 0}>
            <div class="grid w-full grid-cols-1 grid-rows-2 gap-2 pt-4 md:grid-cols-2 lg:grid-cols-3">
              {promptTemplates.map((template) => (
                <button
                  class="bg-background-default hover:bg-background-higher hover:[&>.icon]:text-background-highest relative cursor-pointer overflow-hidden rounded-2xl p-4 text-left"
                  onClick={() => insertTemplate(template)}
                >
                  <div>{template.top}</div>
                  <div class="text-foreground-muted text-sm">{template.bottom}</div>
                  <div class="text-background-higher icon absolute right-0 bottom-0 scale-300">{template.icon}</div>
                </button>
              ))}
            </div>
          </Show>
        </div>
      </div>
    </div>
  );
}
