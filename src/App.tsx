import { createEffect, createSignal, For, Show, type Accessor, type JSX, type Setter } from "solid-js";
import { ChatView } from "./Chat";

import ChevronRightIcon from "lucide-solid/icons/chevron-right";
import ChevronDownIcon from "lucide-solid/icons/chevron-down";
import SquarePenIcon from "lucide-solid/icons/square-pen";
import PanelLeftIcon from "lucide-solid/icons/panel-left";
import EllipsisIcon from "lucide-solid/icons/ellipsis";
import TrashIcon from "lucide-solid/icons/trash-2";

import { ChatManager } from "./chatmanager/ChatManager";
import { Dropdown } from "./components/Dropdown";
import { cn } from "./util/cn";
import { Combobox } from "./components/Combobox";
import { Button } from "./components/Button";
import { loadPreferences, savePreferences } from "./serialization/preferences";
import type { UserPreferences } from "./types";
import { database } from "./indexeddb";
import { basePreferences } from "./util/constant";

function ChatItem(props: { children: JSX.Element; onClick: () => void; class?: string }) {
  let chatItemElement!: HTMLButtonElement;

  function chatItemClick(ev: Event) {
    if (ev.target === chatItemElement || Array.from(chatItemElement.childNodes).includes(ev.target! as ChildNode)) {
      props.onClick();
    }
  }

  return (
    <Button
      class={cn("py-1.5 pl-2 text-sm hover:bg-zinc-800", props.class)}
      variant="ghost"
      onClick={chatItemClick}
      ref={chatItemElement}
    >
      {props.children}
    </Button>
  );
}

function SidebarExpanded(props: {
  chatManager: ChatManager;
  preferences: UserPreferences;
  setPreferences: Setter<UserPreferences>;
}) {
  return (
    <div class="border-background-higher flex w-[255px] flex-col gap-4 border-r p-2 pr-3">
      <div class="flex justify-between">
        <Button variant="ghost" icon={true} onClick={() => props.chatManager.createNewChat()}>
          <img src="open-ollama-ui.svg" />
        </Button>

        <Button
          variant="ghost"
          icon={true}
          onClick={() => props.setPreferences((current) => ({ ...current, sidebarExpanded: false }))}
        >
          <PanelLeftIcon />
        </Button>
      </div>
      <div class="flex flex-col gap-2">
        <ChatItem onClick={() => props.chatManager.createNewChat()}>
          <SquarePenIcon class="size-4" />
          New chat
        </ChatItem>
      </div>
      <div class="flex flex-col gap-2">
        <button
          class="text-foreground-muted ml-2 flex cursor-pointer items-center gap-1 text-sm"
          onClick={() => props.setPreferences((current) => ({ ...current, chatsExpanded: !current.chatsExpanded }))}
        >
          Your chats
          <Show when={props.preferences.chatsExpanded}>
            <ChevronDownIcon class="size-4" />
          </Show>
          <Show when={!props.preferences.chatsExpanded}>
            <ChevronRightIcon class="size-4" />
          </Show>
        </button>
        <Show when={props.preferences.chatsExpanded}>
          <div class="flex flex-col">
            <For each={props.chatManager.chats()}>
              {(chat) => (
                <ChatItem
                  class="justify-between not-hover:[&>:nth-child(2)>:nth-child(1)]:opacity-0"
                  onClick={() => props.chatManager.setOpenChat(chat.id)}
                >
                  <span class="line-clamp-1 text-left">{chat.name()}</span>
                  <Dropdown>
                    <Dropdown.Trigger>
                      <button class="cursor-pointer">
                        <EllipsisIcon class="size-4" />
                      </button>
                    </Dropdown.Trigger>
                    <Dropdown.Content>
                      <Dropdown.Item variant="destructive" onSelect={() => props.chatManager.deleteChat(chat.id)}>
                        <TrashIcon class="size-4" />
                        Delete
                      </Dropdown.Item>
                    </Dropdown.Content>
                  </Dropdown>
                </ChatItem>
              )}
            </For>
          </div>
        </Show>
      </div>
    </div>
  );
}

function SidebarCollapsed(props: {
  chatManager: ChatManager;
  preferences: UserPreferences;
  setPreferences: Setter<UserPreferences>;
}) {
  return (
    <div class="flex flex-col gap-4 px-2 py-2">
      <div class="flex flex-col gap-2">
        <Button
          variant="ghost"
          icon={true}
          onClick={() => props.setPreferences((current) => ({ ...current, sidebarExpanded: true }))}
          class="hover:[&>:nth-child(1)]:hidden hover:[&>:nth-child(2)]:block"
        >
          <img src="open-ollama-ui.svg" />
          <PanelLeftIcon class="hidden" />
        </Button>
      </div>
      <div class="flex flex-col gap-2">
        <Button variant="ghost" onClick={() => props.chatManager.createNewChat()} class="size-8 rounded-full px-2">
          <SquarePenIcon class="h-full w-full" />
        </Button>
      </div>
    </div>
  );
}

function promiseSignal<T>(promise: Promise<T>, defaultValue: T): [Accessor<T>, Setter<T>] {
  const [get, set] = createSignal(defaultValue);

  // @ts-expect-error
  promise.then((value) => set(value));

  return [get, set];
}

export default function App() {
  const [preferences, setPreferences] = promiseSignal(loadPreferences(), basePreferences);
  const chatManager = ChatManager.getInstance(preferences, setPreferences);

  // @ts-expect-error
  window.database = database;

  createEffect(() => savePreferences(preferences()));

  return (
    <div class="flex">
      <Show when={preferences().sidebarExpanded}>
        <SidebarExpanded chatManager={chatManager} preferences={preferences()} setPreferences={setPreferences} />
      </Show>

      <Show when={!preferences().sidebarExpanded}>
        <SidebarCollapsed chatManager={chatManager} preferences={preferences()} setPreferences={setPreferences} />
      </Show>

      <div class="flex h-screen max-h-screen flex-1 flex-col">
        <div class="flex h-12 justify-between gap-2 px-3 py-2 text-sm">
          <Combobox>
            <Combobox.Trigger>
              <Button variant="ghost">
                {chatManager.currentChat().currentModel()}
                <ChevronDownIcon class="text-foreground-muted size-4" />
              </Button>
            </Combobox.Trigger>
            <Combobox.Content class="top-full mt-2">
              <For each={chatManager.availableModels()}>
                {(model) => (
                  <Combobox.Item value={model} onSelect={() => chatManager.currentChat().setCurrentModel(model)}>
                    {model}
                  </Combobox.Item>
                )}
              </For>
              <Combobox.Empty>No matches.</Combobox.Empty>
            </Combobox.Content>
          </Combobox>
          <Show when={!chatManager.currentChat().isTemporary()}>
            <Dropdown>
              <Dropdown.Trigger>
                <Button icon={true} variant="ghost">
                  <EllipsisIcon class="size-4" />
                </Button>
              </Dropdown.Trigger>
              <Dropdown.Content class="top-full right-0 mt-2">
                <Dropdown.Item
                  onSelect={() => chatManager.deleteChat(chatManager.currentChat().id)}
                  variant="destructive"
                >
                  Delete
                </Dropdown.Item>
              </Dropdown.Content>
            </Dropdown>
          </Show>
        </div>
        <div class="flex-1 overflow-y-auto">
          <ChatView chat={chatManager.currentChat()} />
        </div>
      </div>
    </div>
  );
}
