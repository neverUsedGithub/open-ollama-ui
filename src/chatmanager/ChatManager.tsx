import { extractPDF } from "@/documents/pdf";
import * as embedding from "@/embedding";
import { ProviderManager } from "@/providers";
import { v4 as uuidv4 } from "uuid";
import * as serializeChat from "@/serialization/chat";
import * as serializeChatList from "@/serialization/chatList";
import type {
  AssistantChatMessage,
  ChatMessageState,
  DisplayChatMessage,
  InputTag,
  ListedModel,
  MockOutputField,
  ModelMetadata,
  ModelState,
  ModelTool,
  NativeChatMessage,
  RAGDocument,
  StreamChunk,
  SubChatMessage,
  SubChatMessageData,
  TextSubChatMessage,
  ToolContext,
  ToolOutput,
  UserChatMessage,
  UserDocumentFile,
  UserFile,
  UserPreferences,
} from "@/types";
import { buildSystemPrompt } from "@/util/prompt";
import * as vectordb from "@/vectordb";
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

  private selectedModel: Accessor<ListedModel | null>;
  private setSelectedModel: Setter<ListedModel | null>;

  public currentModel: Accessor<ListedModel>;

  public selectedModelMetadata: Accessor<ModelMetadata | null>;
  private setSelectedModelMetadadata: Setter<ModelMetadata | null>;

  private providerController: AbortController | null;
  private toolController: AbortController | null;

  private chatManager: ChatManager;

  public id: string;
  public loaded: boolean;
  public ragDocuments: RAGDocument[];

  constructor(
    chatManager: ChatManager,
    id: string,
    name: string,
    model: ListedModel | null,
    preferences: UserPreferences,
  ) {
    this.id = id;
    this.loaded = false;
    this.ragDocuments = [];
    this.chatManager = chatManager;

    this.toolController = null;
    this.providerController = null;

    [this.name, this.setName] = createSignal(name);
    [this.modelState, this.setModelState] = createSignal<ModelState>("idle");
    [this.selectedModel, this.setSelectedModel] = createSignal<ListedModel | null>(model);
    [this.selectedModelMetadata, this.setSelectedModelMetadadata] = createSignal<ModelMetadata | null>(null);

    [this.nativeMessages, this.setNativeMessages] = createSignal<NativeChatMessage[]>([]);
    [this.displayMessages, this.setDisplayMessages] = createSignal<DisplayChatMessage[]>([]);

    this.currentModel = createMemo(() => {
      const selectedModel = this.selectedModel();

      const defaultModel: ListedModel = {
        identifier: preferences.defaultModel,
        provider: preferences.defaultProvider,
      };

      return selectedModel ?? defaultModel;
    });

    this.autoSave();

    createEffect(() => {
      this.setSelectedModelMetadadata(null);
      this.loadModelMetadata(this.currentModel());
    });
  }

  public setCurrentModel(model: ListedModel) {
    this.setSelectedModel(model);
  }

  private async loadModelMetadata(model: ListedModel) {
    const provider = await this.chatManager.providerManager.getProvider(model.provider);

    if (provider) {
      const queryResult = await provider.queryModel(model.identifier);

      if (this.currentModel().identifier !== model.identifier || this.currentModel().provider !== model.provider) {
        // Stale data.
        return;
      }

      this.setSelectedModelMetadadata(queryResult);
    } else {
      console.warn("failed to load model metadata, provider is null", model);
    }
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
    model: ListedModel,
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

    this.toolController = new AbortController();

    const toolContext: ToolContext = {
      model,
      documents: this.ragDocuments,
      lastMessage: lastMessage,
      signal: this.toolController.signal,

      freeModel: async (model) => {
        const provider = await this.chatManager.providerManager.getProvider(model.provider);
        if (provider) await provider.freeModel(model.identifier);
      },
    };

    const result = await foundTool.execute(toolParams, toolContext);

    this.toolController = null;

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
    const partialDocuments: { file: UserDocumentFile; chunks: string[] }[] = [];

    for (const file of fileUploads) {
      if (file.kind !== "document") continue;

      console.group(`[DOC] ${file.fileName}`);

      if (file.fileName.endsWith(".pdf")) {
        // Add progress for extraction too? Right now it is fast, because no OCR is involved,
        // but later it would be valuable.
        const pages = await extractPDF(file);
        partialDocuments.push({ file, chunks: pages });
      } else {
        throw new Error(`cannot parse document '${file.fileName}'`);
      }

      console.groupEnd();
    }

    for (const doc of partialDocuments) {
      const db = await vectordb.createDatabase();

      doc.file.setProgress(0);

      for (let i = 0; i < doc.chunks.length; i++) {
        console.log(`[EMBED] processing chunk`);
        const vector = await embedding.generateEmbedding(doc.chunks[i]);

        console.log(`[RAG] appending chunk`);
        db.add(i, [vector]);

        doc.file.setProgress((i + 1) / doc.chunks.length);
      }

      doc.file.setProgress(1);

      this.addNativeMessage({
        role: "user",
        content: `[user uploaded document '${doc.file.fileName}', document id ${this.ragDocuments.length}]`,
      });

      this.ragDocuments.push({
        name: doc.file.fileName,
        chunks: doc.chunks,
        vectors: db,
      });
    }
  }

  public delete() {
    this.abort();

    serializeChat.deleteChat(this.id);
    serializeChatList.deleteChat(this.id);
  }

  public sendMessage(
    selectedModel: ListedModel,
    userMessage: string,
    fileUploads: UserFile[],
    tools: ModelTool[],
    currentTag: InputTag | null,
  ): SendMessageResult {
    if (this.modelState() !== "idle" || userMessage === "") return { ok: false };
    return { ok: true, promise: this.sendMessageImpl(selectedModel, userMessage, fileUploads, tools, currentTag) };
  }

  public async abort() {
    this.providerController?.abort();
    this.toolController?.abort();
  }

  private async sendMessageImpl(
    selectedModel: ListedModel,
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

    await this.processDocumentUploads(fileUploads);

    let newTurn = false;

    let errored = false;
    let error: unknown = null;
    let useThinking: boolean | "low" | "medium" | "high" | undefined = undefined;

    if (capabilities.thinking) {
      console.log("model can think.", capabilities);
      useThinking = true;

      // TODO: improve gpt-oss detection, probably family field in metadata?
      if (selectedModel.identifier.includes("gpt-oss")) {
        useThinking = "medium";

        if (currentTag && currentTag.id === "think") {
          useThinking = "high";
        }
      }
    }

    do {
      newTurn = false;

      this.setModelState("loading");
      assistantMessage.setState("loading");

      const controller = new AbortController();
      this.providerController = controller;

      const self = this;

      let isToolCall = false;

      let textContent = "";
      let thinkingContent = "";

      let currentTextSubmessage: TextSubChatMessage | null = null as TextSubChatMessage | null;

      async function streamChunk(chunk: StreamChunk) {
        if (chunk.type === "toolCalls") {
          self.addNativeMessage({
            role: "assistant",
            content: textContent,
            thinking: thinkingContent,
            tool_calls: chunk.toolCalls,
          });

          assistantMessage.setState("toolcall");

          for (const tool of chunk.toolCalls) {
            const summary = tools.find((mtool) => mtool.name === tool.function.name)?.summary;
            assistantMessage.push({ kind: "toolcall", summary: summary ?? "", toolName: tool.function.name });

            const result = await self.runModelTool(
              selectedModel,
              assistantMessage,
              tools,
              userMessage,
              tool.function.name,
              tool.function.arguments,
            );

            self.addNativeMessage({
              role: "tool",
              tool_name: tool.function.name,
              content: JSON.stringify(result.data, null, 2),
            });
          }

          newTurn = true;
          controller.abort();

          return;
        }

        if (chunk.type === "thinking" && (currentTextSubmessage === null || !currentTextSubmessage.thinking)) {
          self.setModelState("busy");
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

        if (chunk.type === "text" && (!currentTextSubmessage || currentTextSubmessage.thinking)) {
          self.setModelState("busy");
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

        switch (chunk.type) {
          case "text":
            textContent += chunk.content;
            if (capabilities.tools || !isToolCall) currentTextSubmessage.stream(chunk.content);
            break;

          case "thinking":
            thinkingContent += chunk.content;
            currentTextSubmessage.stream(chunk.content);
            break;
        }

        if (!capabilities.tools) {
          if (textContent.includes("<tool>") && !isToolCall) {
            isToolCall = true;
            assistantMessage.setState("toolcall");
            currentTextSubmessage.removeToolCall();
          }
        }
      }

      const provider = await this.chatManager.providerManager.getProvider(selectedModel.provider);

      if (!provider) {
        throw new Error("invalid model");
      }

      try {
        await provider.generate(
          selectedModel.identifier,
          this.nativeMessages(),
          !capabilities.tools ? null : tools,
          streamChunk,
          this.providerController.signal,
          useThinking,
        );
      } catch (e) {
        if (!(e instanceof DOMException) || e.name !== "AbortError") {
          error = e;
          errored = true;
          newTurn = false;
          console.error(e);
        }
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
    this.toolController = null;
    this.providerController = null;
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

  constructor(chatManager: ChatManager, preferences: UserPreferences) {
    super(chatManager, "", "", null, preferences);

    this.created = false;
    this.onCreate = null;

    createEffect(() => {
      if (!this.created) {
        preferences.defaultModel = this.currentModel().identifier;
        preferences.defaultProvider = this.currentModel().provider;
      }
    });
  }

  private createNew(userMessage: string) {
    this.id = uuidv4();
    this.setName(userMessage.substring(0, 40));

    this.onCreate?.();
    this.created = true;
  }

  override sendMessage(
    selectedModel: ListedModel,
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

  public availableModels: Accessor<ListedModel[]>;
  private setAvailableModels: Setter<ListedModel[]>;

  private preferences: UserPreferences;

  public currentChat: Accessor<ChatManagerChat>;
  public providerManager: ProviderManager;

  private static instance: ChatManager | null = null;

  private constructor(preferences: UserPreferences) {
    this.preferences = preferences;

    [this.chats, this.setChats] = createSignal<ChatManagerChat[]>([]);
    [this.chatId, this.setChatId] = createSignal<string | null>(null);
    [this.availableModels, this.setAvailableModels] = createSignal<ListedModel[]>([]);

    this.providerManager = ProviderManager.getInstance();

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
    this.loadModels();
  }

  public static getInstance(preferences: UserPreferences): ChatManager {
    if (this.instance === null) this.instance = new ChatManager(preferences);
    return this.instance;
  }

  private async loadModels() {
    const modelList = await this.providerManager.listModels();

    this.setAvailableModels(modelList.sort((a, b) => a.identifier.localeCompare(b.identifier)));
  }

  private async loadChats() {
    try {
      const chats = await serializeChatList.loadChats();
      const loaded: ChatManagerChat[] = [];

      for (const chat of chats) {
        loaded.push(
          runWithOwner(
            null,
            () =>
              new ChatManagerChat(
                this,
                chat.id,
                chat.name,
                { identifier: chat.model, provider: chat.provider },
                this.preferences,
              ),
          )!,
        );
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

    document.title = this.currentChat().name();
    window.location.hash = chatId;
  }

  addChat(chat: ChatManagerChat) {
    serializeChatList.addChat({
      id: chat.id,
      model: chat.currentModel().identifier,
      provider: chat.currentModel().provider,
      name: chat.name(),
    });
    this.setChats([...this.chats(), chat]);
  }

  getChat(id: string | null): ChatManagerChat {
    const found = this.chats().find((chat) => chat.id === id);

    if (id === null || found === undefined) {
      const temporary = runWithOwner(null, () => new ChatManagerNewChat(this, this.preferences))!;

      temporary.onCreate = () => {
        this.addChat(temporary);

        runWithOwner(null, () => this.setOpenChat(temporary.id));
      };

      return temporary;
    }

    return found;
  }
}
