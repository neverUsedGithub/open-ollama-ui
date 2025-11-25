import { cn } from "@/util/cn";
import type { ComponentProps } from "solid-js";

export type ButtonVariant = "default" | "outline" | "ghost" | "primary";

const buttonVariants: Record<ButtonVariant, string> = {
  default: "bg-background-default hover:outline-bg-higher",
  outline: "outline-bg-default outline-1",
  ghost: "hover:bg-background-default",
  primary: "bg-foreground text-background",
};

export interface ButtonProps extends ComponentProps<"button"> {
  variant?: ButtonVariant;
  icon?: boolean;
}

export function Button(props: ButtonProps) {
  return (
    <button
      {...props}
      class={cn(
        "flex items-center gap-2 rounded-lg px-3 py-1 not-disabled:cursor-pointer",
        props.icon && "size-8 rounded-full p-2 [&>*]:h-full [&>*]:w-full",
        buttonVariants[props.variant ?? "default"],
        "disabled:text-foreground-muted disabled:bg-transparent",
        props.class,
      )}
    >
      {props.children}
    </button>
  );
}
