import { useEffect, useRef } from "react";
import { autoResizeTextarea } from "@/utils/textarea";

interface AutoResizeTextareaProps {
  value: string;
  onChange: (value: string) => void;
  onBlur?: (value: string) => void;
  className?: string;
  rows?: number;
}

export default function AutoResizeTextarea({
  value,
  onChange,
  onBlur,
  className,
  rows = 2,
}: AutoResizeTextareaProps) {
  const ref = useRef<HTMLTextAreaElement | null>(null);

  // External `value` changes (e.g. candidate switch) are coalesced into a
  // single paint-block-free resize via requestAnimationFrame. useLayoutEffect
  // is intentionally avoided here: switching candidates would otherwise force
  // the browser to lay out many off-screen textareas synchronously on the
  // critical path and block the main thread.
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      autoResizeTextarea(ref.current);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [value]);

  return (
    <textarea
      ref={ref}
      className={className}
      rows={rows}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      onInput={() => autoResizeTextarea(ref.current)}
      onBlur={onBlur ? (event) => onBlur(event.target.value) : undefined}
      style={{ overflow: "hidden", resize: "none" }}
    />
  );
}
