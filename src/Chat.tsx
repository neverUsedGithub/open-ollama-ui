import { Dropdown } from "@/components/Dropdown";
import * as imageGen from "@/imagegen";
import type {
  AssistantChatMessage,
  ChatMessageAttachment,
  ChatMessageState,
  DisplayChatMessage,
  ModelState,
  PromptTemplate,
  SubChatMessage,
  SupportContext,
  TextSubChatMessage,
  UserFile,
} from "@/types";
import { cn } from "@/util/cn";
import { promptTemplates } from "@/util/constant";
import { freeOllamaModel } from "@/util/ollama";
import hljs from "highlight.js";
import katex from "katex";
import ArrowUpIcon from "lucide-solid/icons/arrow-up";
import BrainIcon from "lucide-solid/icons/brain";
import CheckIcon from "lucide-solid/icons/check";
import LightbulbIcon from "lucide-solid/icons/lightbulb";
import PaperclipIcon from "lucide-solid/icons/paperclip";
import PlusIcon from "lucide-solid/icons/plus";
import SquareIcon from "lucide-solid/icons/square";
import TriangleAlert from "lucide-solid/icons/triangle-alert";
import XIcon from "lucide-solid/icons/x";
import ollama from "ollama/browser";
import * as pdfjs from "pdfjs-dist";
import pdfjsWorkerURL from "pdfjs-dist/build/pdf.worker.mjs?url";
import { createEffect, createMemo, createSignal, For, onMount, Show } from "solid-js";
import { Dynamic } from "solid-js/web";
import * as streamingMarkdown from "streaming-markdown";
import type { ChatManagerChat } from "./chatmanager/ChatManager";
import { inputTags } from "./inputtags";
import { modelTools } from "./tools";

import "./Chat.css";
import { Button } from "./components/Button";

pdfjs.GlobalWorkerOptions.workerSrc = pdfjsWorkerURL;

const availableHighlightingLanguages = hljs.listLanguages();

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
      <Dropdown.Content class="bottom-14 -left-3">
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
      <Show when={props.modelState === "idle"}>
        <Button icon={true} variant="primary" class="size-9" disabled={!props.allowMessage} onClick={props.sendMessage}>
          <ArrowUpIcon />
        </Button>
      </Show>

      <Show when={props.modelState !== "idle"}>
        <Button icon={true} class="hover:bg-background-higher size-9 p-3" onClick={props.stopMessage}>
          <SquareIcon class="text-foreground-muted" stroke-width={4} />
        </Button>
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

function highlightCode(codeblock: HTMLElement) {
  const result = hljs.highlight(codeblock.textContent, { language: codeblock.className });
  (codeblock.previousSibling! as HTMLElement).innerHTML = result.value;
}

function renderLaTeX(codeblock: HTMLElement) {
  try {
    const string = katex.renderToString(codeblock.textContent, {
      displayMode: codeblock.tagName === "EQUATION-BLOCK",
      throwOnError: true,
    });

    codeblock.previousElementSibling!.innerHTML = string;
  } catch {
    console.log("failed to render");
  }
}

function SubMessageView(props: { subMessage: SubChatMessage; messageState: ChatMessageState; latest: boolean }) {
  if (props.subMessage.kind === "attachment")
    return <ChatMessageAttachmentView attachment={props.subMessage.attachment} />;

  if (props.subMessage.kind === "toolcall") {
    const toolName = props.subMessage.toolName;
    const tool = modelTools.find((tool) => tool.name === toolName)!;

    return (
      <div class="text-foreground-muted flex gap-2">
        <Dynamic component={tool.icon} class="mt-1 size-4" />
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
            <pre class="break-all whitespace-pre-wrap">
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
      const targetElement = mutation.target as HTMLElement;
      if (!targetElement.className) return;
      highlightCode(targetElement);
    }
  });

  const latexObserver = new MutationObserver((mutationList) => {
    for (const mutation of mutationList) {
      const targetElement = mutation.target as HTMLElement;
      renderLaTeX(targetElement);
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

              highlightCode(elem);
              codeBlockObserver.observe(elem, { childList: true });
            }

            if (elem.parentElement && (elem.tagName === "EQUATION-BLOCK" || elem.tagName === "EQUATION-INLINE")) {
              const display = document.createElement("div");
              elem.parentElement.insertBefore(display, elem);
              elem.style.display = "none";

              renderLaTeX(elem);
              latexObserver.observe(elem, { childList: true });
            }
          }
        }
      }
    }
  });

  newElementObserver.observe(messageContainer, { childList: true, subtree: true });

  const timeEnd: number = props.subMessage.timeEnd() || Date.now();
  const [thinkingExpanded, setThinkingExpanded] = createSignal(false);
  const [thinkingTime, setThinkingTime] = createSignal(timeEnd - props.subMessage.timeStart());

  const textSub = props.subMessage as TextSubChatMessage;

  if (props.subMessage.thinking) {
    const updateTime = 10;

    function thinkingIncrement() {
      if (textSub.finished()) return;

      setThinkingTime((time) => time + updateTime);
      setTimeout(thinkingIncrement, updateTime);
    }

    setTimeout(thinkingIncrement, updateTime);
  }

  createEffect(() => {
    renderer ??= streamingMarkdown.default_renderer(messageContainer);
    parser ??= streamingMarkdown.parser(renderer);

    streamingMarkdown.parser_write(parser, textSub.content().substring(lastWritten));
    lastWritten = textSub.content().length;
  });

  createEffect(() => {
    if (textSub.finished() && parser) {
      streamingMarkdown.parser_end(parser);
    }
  });

  props.subMessage.removeToolCall = function removeToolCall() {
    let removedToolBlock = false;

    if (messageContainer.children.length > 0) {
      const lastChild = messageContainer.children[messageContainer.children.length - 1];

      if (lastChild.tagName === "PRE" && lastChild.children[0].tagName === "CODE") {
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
            {props.latest && !props.subMessage.finished() ? "Thinking" : "Thought"} for{" "}
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

function ChatMessageView(props: { message: DisplayChatMessage }) {
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
  chat: ChatManagerChat;
}

export function ChatView(props: ChatViewProps) {
  const [inputTag, setInputTag] = createSignal<string | null>(null);
  const [inputMultiLine, setInputMultiLine] = createSignal(false);

  const [inputText, setInputText] = createSignal("");
  const [userFileUploads, setUserFileUploads] = createSignal<UserFile[]>([]);

  const expanded = createMemo(() => inputMultiLine() || inputTag() !== null);
  const allowMessage = createMemo(() => inputText() !== "" && props.chat.modelState() === "idle");
  const inputTagData = createMemo(() => inputTags.find((tag) => tag.id === inputTag()) ?? null);

  const [tagSupport, setTagSupport] = createSignal<Record<string, boolean>>({});
  const [toolSupport, setToolSupport] = createSignal<Record<string, boolean>>({});

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

  createEffect(async () => {
    const metadata = props.chat.selectedModelMetadata();
    if (!metadata) return;

    const supportContext: SupportContext = { metadata };

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

  let shouldScrollToBottom = true;

  createEffect(() => {
    props.chat;

    shouldScrollToBottom = true;
  });

  function scrollingContainerScroll(ev: WheelEvent) {
    const parentEl = messagesContainer.parentElement!.parentElement!;

    if (ev.deltaY > 0) {
      const dist = Math.abs(messagesContainer.scrollHeight - (parentEl.scrollTop + parentEl.offsetHeight));
      shouldScrollToBottom = dist < 250;
    } else {
      shouldScrollToBottom = false;
    }
  }

  createEffect(() => {
    for (const message of props.chat.displayMessages()) {
      if (message.role === "assistant") {
        for (const subMessage of message.subMessages()) {
          if (subMessage.kind === "text") subMessage.content();
        }
      }
    }

    if (messagesContainer?.parentElement?.parentElement && shouldScrollToBottom) {
      messagesContainer.parentElement.parentElement.scrollTo({
        top: messagesContainer.scrollHeight,
        behavior: "smooth",
      });
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

  async function sendMessage(text: string) {
    const toolChecks = toolSupport();
    const result = props.chat.sendMessage(
      props.chat.selectedModel(),

      text,
      userFileUploads(),

      modelTools.filter((tool) => toolChecks[tool.name]),
      inputTagData(),
    );

    if (result.ok) {
      setInputText("");
      setInputTag(null);
      setUserFileUploads([]);
      fitTextArea();

      await result.promise;
    }
  }

  function stopMessage() {
    props.chat.abort();
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

  const chatHistoryEmpty = createMemo(() => props.chat.nativeMessages().length === 0);

  return (
    <div class="flex h-full max-h-full p-8">
      <div class="flex w-8/12 flex-1 flex-col">
        <Show when={chatHistoryEmpty()}>
          <div class="mb-8 flex h-1/2 items-end justify-center gap-4">
            <img src="open-ollama-ui.svg" alt="" class="size-12" />
            <h2 class="font-handwriting line-clamp-1 max-w-72 -translate-y-1 text-4xl">{props.chat.selectedModel()}</h2>
          </div>
        </Show>

        <Show when={!chatHistoryEmpty()}>
          <div class="flex-1 overflow-y-auto" onWheel={scrollingContainerScroll}>
            <div class="mx-auto h-full max-h-full w-full max-w-[800px]">
              <div class="flex flex-col gap-4 overflow-x-hidden pb-32" ref={messagesContainer}>
                <For each={props.chat.displayMessages()}>{(message) => <ChatMessageView message={message} />}</For>
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
                modelState={props.chat.modelState()}
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
                  modelState={props.chat.modelState()}
                  stopMessage={stopMessage}
                  sendMessage={() => sendMessage(inputText())}
                />
              </div>
            </Show>
          </div>

          <Show when={chatHistoryEmpty()}>
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
