import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Button } from "./Button";

interface Props {
  label: string;
  hint: string;
  onConfirm(): void;
  disabled?: boolean;
  /** How long the finger must stay down. The default is comfortably deliberate on a phone. */
  holdMs?: number;
}

/**
 * A deliberate approval: press and keep holding until the bar fills.
 * A plain tap (or a short key press) does nothing, so a pocket tap cannot approve money.
 */
export function HoldToConfirm({ label, hint, onConfirm, disabled = false, holdMs = 700 }: Props) {
  const [holding, setHolding] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const stop = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = undefined;
    setHolding(false);
  }, []);

  const start = useCallback(() => {
    if (disabled || timer.current) return;
    setHolding(true);
    timer.current = setTimeout(() => {
      timer.current = undefined;
      setHolding(false);
      onConfirm();
    }, holdMs);
  }, [disabled, holdMs, onConfirm]);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const keyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key !== " " && e.key !== "Enter") return;
    e.preventDefault();
    start();
  };
  const keyUp = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === " " || e.key === "Enter") stop();
  };

  return (
    <div>
      <Button
        variant="primary"
        disabled={disabled}
        className="relative w-full overflow-hidden"
        aria-describedby="hold-hint"
        onPointerDown={start}
        onPointerUp={stop}
        onPointerLeave={stop}
        onPointerCancel={stop}
        onContextMenu={(e) => e.preventDefault()}
        onKeyDown={keyDown}
        onKeyUp={keyUp}
      >
        <span
          aria-hidden="true"
          className="absolute inset-y-0 left-0 origin-left bg-primary-hover"
          style={{ width: "100%", transform: `scaleX(${holding ? 1 : 0})`, transition: `transform ${holdMs}ms linear` }}
        />
        <span className="relative">{label}</span>
      </Button>
      <p id="hold-hint" className="mt-1 text-text-muted">{hint}</p>
    </div>
  );
}
