import { extractPDF } from "@/documents/pdf";
import * as embedding from "@/embedding";
import * as serializeChat from "@/serialization/chat";
import * as serializeChatList from "@/serialization/chatList";
import type {
  AssistantChatMessage,
  ChatData,
  ChatMessageState,
  DisplayChatMessage,
  InputTag,
  MockOutputField,
  ModelMetadata,
  ModelState,
  ModelTool,
  NativeChatMessage,
  RAGDocument,
  SubChatMessage,
  SubChatMessageData,
  TextSubChatMessage,
  ToolContext,
  ToolOutput,
  UserChatMessage,
  UserFile,
  UserPreferences,
} from "@/types";
import { buildSystemPrompt } from "@/util/prompt";
import * as vectordb from "@/vectordb";
import type { AbortableAsyncIterator } from "ollama";
import ollama, { type ChatResponse } from "ollama/browser";
import { createEffect, createMemo, createSignal, runWithOwner, untrack, type Accessor, type Setter } from "solid-js";

function noop() {}

function createSubMessage(data: SubChatMessageData): SubChatMessage {
  if (data.kind !== "text") return data;

  const [content, setContent] = createSignal(data.content);

  const [finished, setFinished] = createSignal(data.finished);
  const [timeEnd, setTimeEnd] = createSignal(data.timeEnd);
  const [timeStart, setTimeStart] = createSignal(data.timeStart);

  function stream(data: string) {
    setContent((curr) => curr + data);
  }

  return {
    kind: "text",

    content,
    stream,
    replace: setContent,

    thinking: data.thinking,

    removeToolCall: noop,

    finished,
    timeStart,
    timeEnd,

    setFinished,
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
    setState(newState) {
      if (newState === "finished" && subMessages().length > 0) {
        const last = subMessages()[subMessages().length - 1];
        if (last.kind === "text") last.setFinished(true);
      }
      setState(newState);
    },

    subMessages,

    push(subMessage) {
      const sub = createSubMessage(subMessage);
      const lastMessage = subMessages()[subMessages().length - 1];

      if (lastMessage && lastMessage.kind === "text") {
        lastMessage.setFinished(true);

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

type SendMessageResult = { ok: true; promise: Promise<void> } | { ok: false };

function globalEffect(fn: () => void) {
  runWithOwner(null, () => createEffect(fn));
}

export class ChatManagerChat {
  public nativeMessages: Accessor<NativeChatMessage[]>;
  private setNativeMessages: Setter<NativeChatMessage[]>;

  public displayMessages: Accessor<DisplayChatMessage[]>;
  private setDisplayMessages: Setter<DisplayChatMessage[]>;

  public modelState: Accessor<ModelState>;
  private setModelState: Setter<ModelState>;

  public name: Accessor<string>;
  protected setName: Setter<string>;

  public selectedModel: Accessor<string>;
  public setSelectedModel: Setter<string>;

  public selectedModelMetadata: Accessor<ModelMetadata | null>;
  private setSelectedModelMetadadata: Setter<ModelMetadata | null>;

  private ollamaResponse: AbortableAsyncIterator<ChatResponse> | null;

  public id: string;
  public loaded: boolean;
  public ragDocuments: RAGDocument[];

  constructor(id: string, name: string, model: string) {
    this.id = id;
    this.loaded = false;
    this.ragDocuments = [];

    this.ollamaResponse = null;

    [this.name, this.setName] = createSignal(name);
    [this.modelState, this.setModelState] = createSignal<ModelState>("idle");
    [this.selectedModel, this.setSelectedModel] = createSignal<string>(model);
    [this.selectedModelMetadata, this.setSelectedModelMetadadata] = createSignal<ModelMetadata | null>(null);

    [this.nativeMessages, this.setNativeMessages] = createSignal<NativeChatMessage[]>([]);
    [this.displayMessages, this.setDisplayMessages] = createSignal<DisplayChatMessage[]>([]);

    this.autoSave();

    createEffect(() => {
      const model = this.selectedModel();

      this.setSelectedModelMetadadata(null);
      this.loadModelMetadata(model);
    });
  }

  private async loadModelMetadata(model: string) {
    const meta = await ollama.show({ model });

    this.setSelectedModelMetadadata({
      capabilities: {
        tools: meta.capabilities.includes("tools"),
        thinking: meta.capabilities.includes("thinking"),
      },
      details: {
        family: meta.details.family,
        parameterSize: meta.details.parameter_size,
        quantizationLevel: meta.details.quantization_level,
      },
    });
  }

  private autoSave() {
    globalEffect(() => {
      this.modelState();

      for (const display of this.displayMessages()) {
        if (display.role === "assistant") {
          display.subMessages();
        }
      }

      untrack(() => this.saveChat());
    });
  }

  protected shouldSave(): boolean {
    return this.loaded;
  }

  isTemporary() {
    return this.id === "";
  }

  onOpen() {
    this.loadChat();
  }

  addNativeMessage(message: NativeChatMessage) {
    this.setNativeMessages((messages) => [...messages, message]);
  }

  changeSystemMessage(message: NativeChatMessage) {
    this.setNativeMessages([message, ...this.nativeMessages().slice(1)]);
  }

  addDisplayMessage(message: DisplayChatMessage) {
    this.setDisplayMessages([...this.displayMessages(), message]);
  }

  private resolveMockNumberField(params: Record<string, string>, field: MockOutputField<number>): number {
    if (typeof field === "number") {
      return field;
    } else if (typeof field === "string") {
      return Number(params[field]);
    }

    return Object.hasOwn(params, field.property) ? Number(params[field.property]) : field.default;
  }

  private async runModelTool(
    model: string,
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
          const imageWidth = this.resolveMockNumberField(toolParams, mock.width);
          const imageHeight = this.resolveMockNumberField(toolParams, mock.height);

          if (Number.isNaN(imageWidth) || Number.isNaN(imageHeight)) {
            console.warn("Tool call image mock contained invalid width/height, so it has been hidden.");
            continue;
          }

          mocks.push(assistantMessage.push({ kind: "image-mock", width: imageWidth, height: imageHeight }));
        }
      }
    }

    const toolContext: ToolContext = {
      model,
      documents: this.ragDocuments,
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

  private async processDocumentUploads(fileUploads: UserFile[]) {
    // const pdfRenderCanvas = document.createElement("canvas");
    const partialDocuments: { name: string; chunks: string[] }[] = [];

    for (const file of fileUploads) {
      if (file.kind !== "document") continue;

      console.group(`[DOC] ${file.fileName}`);

      if (file.fileName.endsWith(".pdf")) {
        const pages = await extractPDF(file.content);

        partialDocuments.push({ name: file.fileName, chunks: pages });
      } else {
        throw new Error(`cannot parse document '${file.fileName}'`);
      }

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

      this.addNativeMessage({
        role: "user",
        content: `[user uploaded document '${doc.name}', document id ${this.ragDocuments.length}]`,
      });

      this.ragDocuments.push({
        name: doc.name,
        chunks: doc.chunks,
        vectors: db,
      });
    }
  }

  public delete() {
    if (this.ollamaResponse) this.ollamaResponse.abort();
    serializeChat.deleteChat(this.id);
  }

  public sendMessage(
    selectedModel: string,
    userMessage: string,
    fileUploads: UserFile[],
    tools: ModelTool[],
    currentTag: InputTag | null,
  ): SendMessageResult {
    if (this.modelState() !== "idle" || userMessage === "") return { ok: false };
    return { ok: true, promise: this.sendMessageImpl(selectedModel, userMessage, fileUploads, tools, currentTag) };
  }

  public async abort() {
    if (this.ollamaResponse) this.ollamaResponse.abort();
  }

  private async sendMessageImpl(
    selectedModel: string,
    userMessage: string,
    fileUploads: UserFile[],
    tools: ModelTool[],
    currentTag: InputTag | null,
  ): Promise<void> {
    const assistantMessage = createChatMessage("assistant");
    const userChatMessage = createChatMessage("user", userMessage, fileUploads);

    const metadata = this.selectedModelMetadata();
    if (!metadata) throw new Error("metadata not loaded");

    const { capabilities } = metadata;
    const promptTools = capabilities.tools ? undefined : tools;
    const modelSystemRole = "system";

    if (this.nativeMessages().length === 0) {
      this.addNativeMessage({
        role: modelSystemRole,
        content: buildSystemPrompt({ tools: promptTools }),
      });
    }

    this.changeSystemMessage({ role: modelSystemRole, content: buildSystemPrompt({ tools: promptTools }) });

    await this.processDocumentUploads(fileUploads);

    let userImages: string[] = [];

    for (const file of fileUploads) {
      if (file.kind === "image") {
        userImages.push(file.encoded);
      }
    }

    let taggedUserMessage = "";

    if (currentTag && currentTag.prompt) {
      taggedUserMessage += currentTag.prompt + "\n\n";
    }

    taggedUserMessage += userMessage;

    this.addNativeMessage({
      role: "user",
      content: taggedUserMessage,
      images: userImages.length > 0 ? userImages : undefined,
    });

    this.setModelState("loading");

    this.addDisplayMessage(userChatMessage);
    this.addDisplayMessage(assistantMessage);

    let newTurn = false;

    let errored = false;
    let error: unknown = null;

    turnLoop: do {
      newTurn = false;

      const runningModels = await ollama.ps();

      if (!runningModels.models.find((model) => model.model === selectedModel)) {
        this.setModelState("loading");
        assistantMessage.setState("loading");
      }

      let useThinking: boolean | "low" | "medium" | "high" = false;

      if (capabilities.thinking) {
        useThinking = true;

        // TODO: improve gpt-oss detection, probably family field in metadata?
        if (selectedModel.includes("gpt-oss")) {
          useThinking = "medium";

          if (currentTag && currentTag.id === "think") {
            useThinking = "high";
          }
        }
      }

      this.ollamaResponse = await ollama.chat({
        messages: this.nativeMessages(),
        model: selectedModel,
        options: {
          num_ctx: 16_000,
        },
        tools: capabilities.tools
          ? tools.map((tool) => ({
              type: "function",
              function: tool,
            }))
          : undefined,
        stream: true,
        think: useThinking,
      });

      let isToolCall = false;

      let textContent = "";
      let thinkingContent = "";

      let currentTextSubmessage: TextSubChatMessage | null = null;

      try {
        for await (const part of this.ollamaResponse) {
          if (part.message.tool_calls) {
            this.addNativeMessage({
              role: "assistant",
              content: textContent,
              thinking: thinkingContent,
              tool_calls: part.message.tool_calls,
            });

            assistantMessage.setState("toolcall");

            for (const tool of part.message.tool_calls) {
              const summary = tools.find((mtool) => mtool.name === tool.function.name)?.summary;
              assistantMessage.push({ kind: "toolcall", summary: summary ?? "", toolName: tool.function.name });

              const result = await this.runModelTool(
                selectedModel,
                assistantMessage,
                tools,
                userMessage,
                tool.function.name,
                tool.function.arguments,
              );

              this.addNativeMessage({
                role: "tool",
                tool_name: tool.function.name,
                content: JSON.stringify(result.data, null, 2),
              });
            }

            newTurn = true;

            continue turnLoop;
          }

          if (part.message.thinking && (currentTextSubmessage === null || !currentTextSubmessage.thinking)) {
            this.setModelState("busy");
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
            this.setModelState("busy");
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
          if (capabilities.tools || !isToolCall) currentTextSubmessage.stream(part.message.content);

          if (part.message.thinking) {
            thinkingContent += part.message.thinking;
            currentTextSubmessage.stream(part.message.thinking);
          }

          if (!capabilities.tools) {
            if (textContent.includes("<tool>") && !isToolCall) {
              isToolCall = true;
              assistantMessage.setState("toolcall");
              currentTextSubmessage.removeToolCall();
            }
          }
        }
      } catch (e) {
        error = e;
        errored = true;
        newTurn = false;
        console.error(e);
      }

      if (!capabilities.tools && !errored && isToolCall) {
        try {
          assistantMessage.setState("toolcall");

          const toolStart = textContent.indexOf("<tool>");
          const toolContent = textContent.substring(toolStart, textContent.lastIndexOf("</tool>") + "</tool>".length);

          textContent = textContent.substring(0, toolStart);

          while (textContent[textContent.length - 1] === "\n")
            textContent = textContent.substring(0, textContent.length - 1);
          if (textContent.endsWith("```xml")) textContent = textContent.substring(0, textContent.length - 6);

          currentTextSubmessage?.replace(textContent);
          this.addNativeMessage({ role: "assistant", content: textContent, thinking: thinkingContent });

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

          const result = await this.runModelTool(
            selectedModel,
            assistantMessage,
            tools,
            userMessage,
            toolName,
            toolParams,
          );

          this.addNativeMessage({ role: "assistant", content: `\`\`\`xml\n${toolContent}\n\`\`\`` });
          this.addNativeMessage({
            role: "user",
            content: `The output of tool '${toolName}'. The user cannot see this message.

\`\`\`json
${JSON.stringify(result.data, null, 2)}
\`\`\``,
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

      this.addNativeMessage({ role: "assistant", content: textContent, thinking: thinkingContent });
    } while (newTurn);

    if (errored && !(error instanceof DOMException && error.name === "AbortError")) {
      assistantMessage.push({ kind: "error", title: "Internal Error", message: error });
    }

    assistantMessage.setState("finished");
    this.setModelState("idle");
    this.ollamaResponse = null;
  }

  private async loadChat(): Promise<void> {
    if (this.loaded) return;

    try {
      const loaded = await serializeChat.loadChat(this.id);

      if (loaded.exists) {
        this.setDisplayMessages(loaded.displayMessages);
        this.setNativeMessages(loaded.nativeMessages);
      }
    } catch (error) {
      console.warn(`failed to load chat '${this.name}' (${this.id})`);
      console.error(error);
    }

    this.loaded = true;
  }

  saveChat(): void {
    if (this.id !== "" && this.shouldSave()) {
      serializeChat.saveChat(this.id, this.displayMessages(), this.nativeMessages(), this.ragDocuments);
    }
  }
}

class ChatManagerNewChat extends ChatManagerChat {
  private created: boolean;

  public onCreate: (() => void) | null;

  constructor(model: string, setDefaultModel: (model: string) => void) {
    super("", "", model);

    this.created = false;
    this.onCreate = null;

    createEffect(() => {
      if (!this.created) {
        setDefaultModel(this.selectedModel());
      }
    });
  }

  private createNew(userMessage: string) {
    this.id = crypto.randomUUID();
    this.setName(userMessage.substring(0, 40));

    this.onCreate?.();
    this.created = true;
  }

  override sendMessage(
    selectedModel: string,
    userMessage: string,
    fileUploads: UserFile[],
    tools: ModelTool[],
    currentTag: InputTag | null,
  ): SendMessageResult {
    if (!this.created) this.createNew(userMessage);
    return super.sendMessage(selectedModel, userMessage, fileUploads, tools, currentTag);
  }
}

export class ChatManager {
  public chatId: Accessor<string | null>;
  private setChatId: Setter<string | null>;

  public chats: Accessor<ChatManagerChat[]>;
  private setChats: Setter<ChatManagerChat[]>;

  public availableModels: Accessor<string[]>;
  private setAvailableModels: Setter<string[]>;

  public currentChat: Accessor<ChatManagerChat>;

  private preferences: Accessor<UserPreferences>;
  private setPreferences: Setter<UserPreferences>;

  private static instance: ChatManager | null = null;

  private constructor(preferences: Accessor<UserPreferences>, setPreferences: Setter<UserPreferences>) {
    this.preferences = preferences;
    this.setPreferences = setPreferences;

    [this.chats, this.setChats] = createSignal<ChatManagerChat[]>([]);
    [this.chatId, this.setChatId] = createSignal<string | null>(null);
    [this.availableModels, this.setAvailableModels] = createSignal<string[]>([]);

    this.currentChat = createMemo(() => {
      const chatId = this.chatId();
      return untrack(() => this.getChat(chatId));
    });

    createEffect(() => {
      const current = this.currentChat();

      if (current.id !== "") {
        document.title = current.name();
      } else {
        document.title = "Open Ollama UI";
      }
    });

    this.loadChats();
    this.autoSave();
    this.loadModels();
  }

  public static getInstance(
    preferences: Accessor<UserPreferences>,
    setPreferences: Setter<UserPreferences>,
  ): ChatManager {
    if (this.instance === null) this.instance = new ChatManager(preferences, setPreferences);
    return this.instance;
  }

  private async loadModels() {
    const result = await ollama.list();
    this.setAvailableModels(result.models.map((model) => model.name).sort());
  }

  private loadChats() {
    try {
      const chats = serializeChatList.loadChats();
      const loaded: ChatManagerChat[] = [];

      for (const chat of chats) {
        loaded.push(runWithOwner(null, () => new ChatManagerChat(chat.id, chat.name, chat.model))!);
      }

      this.setChats(loaded);

      if (window.location.hash) {
        this.setOpenChat(window.location.hash.substring(1));
      }
    } catch (error) {
      console.error(error);
      console.warn("failed to load chats");
    }
  }

  private autoSave() {
    globalEffect(() => {
      const chats = this.chats();
      untrack(() => this.saveChats(chats));
    });
  }

  private saveChats(chats: ChatManagerChat[]) {
    const chatData: ChatData[] = [];

    for (const chat of chats) {
      chat.saveChat();
      chatData.push({ name: chat.name(), id: chat.id, model: chat.selectedModel() });
    }

    serializeChatList.saveChats(chatData);
  }

  deleteChat(chatId: string) {
    const existing = this.chats().find((chat) => chat.id === chatId);

    if (existing) {
      if (this.chatId() === chatId) {
        this.createNewChat();
      }

      existing.delete();
      this.setChats(this.chats().filter((chat) => chat.id !== chatId));
    }
  }

  createNewChat() {
    this.setChatId(null);

    window.location.hash = "";
  }

  setOpenChat(chatId: string) {
    this.setChatId(chatId);
    this.currentChat().onOpen();

    window.location.hash = chatId;
  }

  addChat(chat: ChatManagerChat) {
    this.setChats([...this.chats(), chat]);
  }

  getChat(id: string | null): ChatManagerChat {
    const found = this.chats().find((chat) => chat.id === id);

    if (id === null || found === undefined) {
      const temporary = runWithOwner(
        null,
        () =>
          new ChatManagerNewChat(this.preferences().defaultModel, (newModel) =>
            this.setPreferences((current) => ({ ...current, defaultModel: newModel })),
          ),
      )!;

      temporary.onCreate = () => {
        this.addChat(temporary);

        runWithOwner(null, () => this.setOpenChat(temporary.id));
      };

      return temporary;
    }

    return found;
  }
}
