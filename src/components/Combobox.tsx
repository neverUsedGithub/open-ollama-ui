import {
  children,
  createContext,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
  Show,
  useContext,
  type Accessor,
  type JSX,
  type Setter,
} from "solid-js";
import { cn } from "../util/cn";
import SearchXIcon from "lucide-solid/icons/search-x";

interface IComboboxContext {
  open: () => void;
  close: () => void;
  isOpen: () => boolean;

  searchTerm: Accessor<string>;
  setSearchTerm: Setter<string>;

  inputElement: HTMLInputElement | null;
  contentElement: HTMLElement | null;
}

const ComboboxContext = createContext<IComboboxContext>();

export function Combobox(props: { children: JSX.Element }) {
  const [isOpen, setIsOpen] = createSignal(false);
  const [searchTerm, setSearchTerm] = createSignal("");

  const context: IComboboxContext = {
    open() {
      setIsOpen(true);

      if (this.inputElement) this.inputElement.focus();
    },
    close() {
      setSearchTerm("");
      setIsOpen(false);

      if (this.inputElement) this.inputElement.value = "";
    },
    isOpen,

    searchTerm,
    setSearchTerm,

    inputElement: null,
    contentElement: null,
  };

  return (
    <ComboboxContext.Provider value={context}>
      <div class="relative flex">{props.children}</div>
    </ComboboxContext.Provider>
  );
}

Combobox.Trigger = function ComboboxTrigger(props: { children: JSX.Element }) {
  const ctx = useContext(ComboboxContext)!;
  const resolved = children(() => props.children);

  createEffect(() => {
    const childrenJSX = resolved();
    const children = Array.isArray(childrenJSX) ? childrenJSX : [childrenJSX];

    for (const child of children) {
      if (child instanceof HTMLElement) child.addEventListener("click", dropdownInteract);
    }
  });

  onMount(() => {
    window.addEventListener("click", clickOut);
  });

  onCleanup(() => {
    window.removeEventListener("click", clickOut);
  });

  function clickOut(ev: MouseEvent) {
    if (!ctx.isOpen()) return;

    const childrenJSX = resolved();
    const children = Array.isArray(childrenJSX) ? childrenJSX : [childrenJSX];

    let contains = ctx.contentElement?.contains(ev.target as Node) ?? false;

    if (!contains) {
      for (const child of children) {
        if (child instanceof HTMLElement) {
          if (child.contains(ev.target! as Node)) {
            contains = true;
            break;
          }
        }
      }
    }

    if (!contains) {
      ctx.close();
    }
  }

  function dropdownInteract() {
    if (ctx.isOpen()) ctx.close();
    else ctx.open();
  }

  return <>{resolved()}</>;
};

Combobox.Content = function ComboboxContent(props: { children: JSX.Element; class?: string }) {
  const ctx = useContext(ComboboxContext)!;

  ctx.inputElement = (
    <input type="text" onInput={(ev) => ctx.setSearchTerm(ev.target.value)} class="px-3 py-1 outline-none" />
  ) as HTMLInputElement;

  ctx.contentElement = (
    <div
      class={cn(
        "bg-background-default border-background-higher absolute z-30 flex max-h-128 w-64 flex-col overflow-y-auto rounded-2xl border-1 px-1.5 py-1.5",
        props.class,
      )}
    >
      {ctx.inputElement}
      <Combobox.Separator />
      {props.children}
    </div>
  ) as HTMLElement;

  return <Show when={ctx.isOpen()}>{ctx.contentElement}</Show>;
};

type DropdownVariant = "default" | "destructive" | "warn";

const dropdownVariants: Record<DropdownVariant, string> = {
  default: "not-disabled:hover:bg-background-higher disabled:text-foreground-muted",
  destructive: "not-disabled:hover:bg-red-800/25 disabled:text-red-600 text-red-300",
  warn: "not-disabled:hover:bg-yellow-800/25 disabled:text-yellow-600 text-yellow-300",
};

Combobox.Item = function ComboboxItem(props: {
  value: string;
  children: JSX.Element;
  disabled?: boolean;
  class?: string;
  variant?: DropdownVariant;
  onSelect?: () => void;
}) {
  const ctx = useContext(ComboboxContext)!;
  const hidden = createMemo(() => !props.value.includes(ctx.searchTerm()));

  function selectItem() {
    props.onSelect?.();
    ctx.close();
  }

  return (
    <Show when={!hidden()}>
      <button
        onClick={selectItem}
        class={cn(
          "flex items-center gap-3 rounded-xl px-3 py-1.5 text-left not-disabled:cursor-pointer",
          dropdownVariants[props.variant ?? "default"],
          props.class,
        )}
        disabled={props.disabled}
      >
        {props.children}
      </button>
    </Show>
  );
};

Combobox.Separator = function ComboboxSeparator() {
  return <div class="border-background-highest my-2 w-full border-b"></div>;
};

Combobox.Empty = function ComboboxEmpty(props: { children: JSX.Element; class?: string }) {
  return (
    <div class={cn("text-foreground-muted hidden items-center justify-center gap-2 py-2 nth-[3]:flex", props.class)}>
      <SearchXIcon class="size-4 translate-y-0.25" />
      {props.children}
    </div>
  );
};
