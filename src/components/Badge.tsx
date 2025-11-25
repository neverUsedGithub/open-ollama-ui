import { cn } from "@/util/cn";
import type { JSXElement } from "solid-js";

export type BadgeVariant = "default" | "destructive" | "warn" | "info";

const badgeVariants: Record<BadgeVariant, string> = {
  default: "outline-background-higher bg-background-default",
  destructive: "outline-red-800 bg-yellow-800/25 text-red-100",
  warn: "outline-yellow-800 bg-yellow-800/25 text-yellow-100",
  info: "outline-blue-800 bg-blue-800/25 text-blue-100",
};

export function Badge(props: { variant?: BadgeVariant; class?: string; children?: JSXElement }) {
  return (
    <div class={cn("rounded-lg px-3 py-1 outline", badgeVariants[props.variant ?? "default"], props.class)}>
      {props.children}
    </div>
  );
}
