import { For, type JSX } from "solid-js";
import { ChatView } from "./Chat";

import NotebookPen from "lucide-solid/icons/notebook-pen";
import { ChatManager } from "./chatmanager/ChatManager";

function ChatItem(props: { children: JSX.Element; onClick: () => void }) {
  return (
    <button
      class="flex cursor-pointer items-center gap-2 rounded-xl px-3 py-2 text-sm hover:bg-zinc-800"
      onClick={props.onClick}
    >
      {props.children}
    </button>
  );
}

export default function App() {
  const chatManager = ChatManager.getInstance();

  return (
    <div class="flex">
      <div class="flex w-[255px] flex-col gap-2 border-r border-zinc-800 p-2">
        <div class="flex flex-col gap-2">
          <ChatItem onClick={() => chatManager.createNewChat()}>
            <NotebookPen size={18} />
            New chat
          </ChatItem>
        </div>
        <div class="flex flex-col gap-2">
          <For each={chatManager.chats()}>
            {(chat) => (
              <ChatItem
                onClick={() => {
                  console.log("SWITCH", chat.id);
                  chatManager.setOpenChat(chat.id);
                }}
              >
                {chat.name()}
              </ChatItem>
            )}
          </For>
        </div>
      </div>
      <ChatView chat={chatManager.currentChat()} selectedModel="qwen3:14b" />
    </div>
  );
}
