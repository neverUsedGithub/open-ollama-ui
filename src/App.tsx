import { For, Show, type JSX } from "solid-js";
import { ChatView } from "./Chat";

import ChevronDownIcon from "lucide-solid/icons/chevron-down";
import NotebookPen from "lucide-solid/icons/notebook-pen";
import EllipsisIcon from "lucide-solid/icons/ellipsis";
import TrashIcon from "lucide-solid/icons/trash-2";

import { ChatManager } from "./chatmanager/ChatManager";
import { Dropdown } from "./components/Dropdown";
import { cn } from "./util/cn";
import { Combobox } from "./components/Combobox";
import { Button } from "./components/Button";

function ChatItem(props: { children: JSX.Element; onClick: () => void; class?: string }) {
  let chatItemElement!: HTMLButtonElement;

  function chatItemClick(ev: Event) {
    if (ev.target === chatItemElement || Array.from(chatItemElement.childNodes).includes(ev.target! as ChildNode)) {
      props.onClick();
    }
  }

  return (
    <button
      class={cn("flex cursor-pointer items-center gap-2 rounded-xl px-3 py-2 text-sm hover:bg-zinc-800", props.class)}
      onClick={chatItemClick}
      ref={chatItemElement}
    >
      {props.children}
    </button>
  );
}

export default function App() {
  // const chatManager = ChatManager.getInstance("gemma3:12b");
  // const chatManager = ChatManager.getInstance("granite4:32b-a9b-h");
  // const chatManager = ChatManager.getInstance("qwen3:14b");
  const chatManager = ChatManager.getInstance("qwen3:30b-a3b-instruct-2507-q4_K_M");

  return (
    <div class="flex">
      <div class="flex w-[255px] flex-col gap-2 border-r border-zinc-800 p-2">
        <div class="flex flex-col">
          <ChatItem onClick={() => chatManager.createNewChat()}>
            <NotebookPen size={18} />
            New chat
          </ChatItem>
        </div>
        <div class="flex flex-col">
          <For each={chatManager.chats()}>
            {(chat) => (
              <ChatItem
                class="justify-between not-hover:[&>:nth-child(2)>:nth-child(1)]:opacity-0"
                onClick={() => chatManager.setOpenChat(chat.id)}
              >
                <span class="line-clamp-1 text-left">{chat.name()}</span>
                <Dropdown>
                  <Dropdown.Trigger>
                    <button class="cursor-pointer">
                      <EllipsisIcon class="size-4" />
                    </button>
                  </Dropdown.Trigger>
                  <Dropdown.Content>
                    <Dropdown.Item variant="destructive" onSelect={() => chatManager.deleteChat(chat.id)}>
                      <TrashIcon class="size-4" />
                      Delete
                    </Dropdown.Item>
                  </Dropdown.Content>
                </Dropdown>
              </ChatItem>
            )}
          </For>
        </div>
      </div>
      <div class="flex h-screen max-h-screen flex-1 flex-col">
        <div class="flex justify-between gap-2 px-3.5 py-2 text-sm h-12">
          <Combobox>
            <Combobox.Trigger>
              <Button variant="ghost">
                {chatManager.currentChat().selectedModel()}
                <ChevronDownIcon class="text-foreground-muted size-4" />
              </Button>
            </Combobox.Trigger>
            <Combobox.Content class="top-full mt-2">
              <For each={chatManager.availableModels()}>
                {(model) => (
                  <Combobox.Item value={model} onSelect={() => chatManager.currentChat().setSelectedModel(model)}>
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
