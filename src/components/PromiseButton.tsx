import { Button, type ButtonProps } from "./Button";
import { createSignal, Show, type JSX } from "solid-js";

export interface PromiseButtonProps extends ButtonProps {
  defaultIcon: JSX.Element;
  activeIcon: JSX.Element;

  onClick(event: MouseEvent): Promise<void>;
}

export function PromiseButton(props: PromiseButtonProps) {
  const [isActive, setIsActive] = createSignal(false);

  function buttonClicked(event: MouseEvent) {
    if (isActive()) return;

    setIsActive(true);
    props.onClick(event).finally(() => setIsActive(false));
  }

  return (
    <Button {...props} onClick={buttonClicked} class={props.class}>
      <Show when={!isActive()}>{props.defaultIcon}</Show>
      <Show when={isActive()}>{props.activeIcon}</Show>
      {props.children}
    </Button>
  );
}
