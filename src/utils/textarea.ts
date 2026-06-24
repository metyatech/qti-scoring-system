const parseCssPixels = (value: string): number => Number.parseFloat(value) || 0;

export const autoResizeTextarea = (element: HTMLTextAreaElement | null): void => {
  if (!element) return;

  element.style.height = "auto";

  const style = window.getComputedStyle(element);
  const borderY =
    style.boxSizing === "border-box"
      ? parseCssPixels(style.borderTopWidth) + parseCssPixels(style.borderBottomWidth)
      : 0;

  const nextHeight = `${element.scrollHeight + borderY}px`;

  if (element.style.height !== nextHeight) {
    element.style.height = nextHeight;
  }
};
