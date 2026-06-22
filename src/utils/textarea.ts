export const autoResizeTextarea = (element: HTMLTextAreaElement | null): void => {
  if (!element) return;
  element.style.height = "auto";
  const nextHeight = `${element.scrollHeight}px`;
  if (element.style.height !== nextHeight) {
    element.style.height = nextHeight;
  }
};
