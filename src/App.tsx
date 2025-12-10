import { createEffect, createSignal, For, Show, type JSX } from "solid-js";
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
import { loadPreference, savePreference } from "./serialization/preferences";
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

function SidebarExpanded(props: { chatManager: ChatManager; preferences: UserPreferences }) {
  return (
    <div class="border-background-higher bg-background absolute top-0 left-0 z-20 flex h-dvh w-[255px] flex-col gap-4 border-r p-2 pr-3 sm:static">
      <div class="flex justify-between">
        <Button variant="ghost" icon={true} onClick={() => props.chatManager.createNewChat()}>
          <img src="open-ollama-ui.svg" />
        </Button>

        <Button variant="ghost" icon={true} onClick={() => (props.preferences.sidebarExpanded = false)}>
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
          onClick={() => (props.preferences.chatsExpanded = !props.preferences.chatsExpanded)}
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

function SidebarCollapsed(props: { chatManager: ChatManager; preferences: UserPreferences }) {
  return (
    <div class="flex flex-col gap-4 px-2 py-2">
      <div class="flex flex-col gap-2">
        <Button
          variant="ghost"
          icon={true}
          onClick={() => (props.preferences.sidebarExpanded = true)}
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

function usePreferences(): UserPreferences {
  const reactivePreferences: Record<string, unknown> = {};
  let loaded = false;

  for (const key in basePreferences) {
    const [getSignal, setSignal] = createSignal<unknown>((basePreferences as unknown as Record<string, unknown>)[key]);

    Object.defineProperty(reactivePreferences, key, {
      enumerable: true,

      get: () => getSignal(),
      set: (v) => setSignal(v),
    });

    createEffect(() => {
      const value = getSignal();

      if (!loaded) return;
      savePreference(key as keyof UserPreferences, value as UserPreferences[keyof UserPreferences]);
    });
  }

  async function loadPreferences() {
    for (const key in reactivePreferences) {
      const saved = await loadPreference(key as keyof UserPreferences);

      if (saved !== null) {
        reactivePreferences[key] = saved;
      } else {
        await savePreference(
          key as keyof UserPreferences,
          reactivePreferences[key] as UserPreferences[keyof UserPreferences],
        );
      }
    }

    loaded = true;
  }

  loadPreferences();

  return reactivePreferences as unknown as UserPreferences;
}

export default function App() {
  const preferences = usePreferences();
  const chatManager = ChatManager.getInstance(preferences);

  // @ts-expect-error
  window.database = database;

  return (
    <div class={cn("relative flex", preferences.sidebarExpanded && "pl-[48px]")}>
      <Show when={preferences.sidebarExpanded}>
        <SidebarExpanded chatManager={chatManager} preferences={preferences} />
      </Show>

      <Show when={!preferences.sidebarExpanded}>
        <SidebarCollapsed chatManager={chatManager} preferences={preferences} />
      </Show>

      <div class="flex h-dvh max-h-dvh flex-1 flex-col">
        <div class="flex h-12 justify-between gap-2 px-3 py-2 text-sm">
          <Combobox>
            <Combobox.Trigger>
              <Button variant="ghost">
                {chatManager.currentChat().currentModel().identifier}
                <ChevronDownIcon class="text-foreground-muted size-4" />
              </Button>
            </Combobox.Trigger>
            <Combobox.Content class="top-full mt-2">
              <For each={chatManager.availableModels()}>
                {(model) => (
                  <Combobox.Item
                    value={`${model.identifier}@${model.provider}`}
                    onSelect={() => chatManager.currentChat().setCurrentModel(model)}
                  >
                    {model.identifier}
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
          <ChatView manager={chatManager} chat={chatManager.currentChat()} />
        </div>
      </div>
    </div>
  );
}
