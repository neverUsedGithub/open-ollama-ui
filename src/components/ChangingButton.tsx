import { Button, type ButtonProps } from "./Button";
import { createSignal, Show, type JSX } from "solid-js";

export interface ChangingButtonProps extends ButtonProps {
  defaultIcon: JSX.Element;
  activeIcon: JSX.Element;

  activeDuration?: number;
  onClick?(event: MouseEvent): void;
}

export function ChangingButton(props: ChangingButtonProps) {
  const [showActiveIcon, setShowActiveIcon] = createSignal(false);
  let clickId = 0;

  function buttonClicked(event: MouseEvent) {
    const currentId = ++clickId;

    setShowActiveIcon(true);
    setTimeout(() => {
      if (currentId !== clickId) return;
      setShowActiveIcon(false);
    }, props.activeDuration ?? 2000);

    if (props.onClick) props.onClick(event);
  }

  return (
    <Button {...props} onClick={buttonClicked} class={props.class}>
      <Show when={!showActiveIcon()}>{props.defaultIcon}</Show>
      <Show when={showActiveIcon()}>{props.activeIcon}</Show>
      {props.children}
    </Button>
  );
}
