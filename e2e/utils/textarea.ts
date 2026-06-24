import { expect, type Locator } from '@playwright/test';

export type TextareaMetrics = {
  value: string;
  clientHeight: number;
  scrollHeight: number;
  styleHeightPx: number;
  borderY: number;
  fitsContent: boolean;
};

const parseCssPixels = (value: string): number => Number.parseFloat(value) || 0;

export const getTextareaMetrics = async (textarea: Locator): Promise<TextareaMetrics> =>
  textarea.evaluate((node) => {
    const el = node as HTMLTextAreaElement;
    const style = window.getComputedStyle(el);
    const parsePx = (value: string): number => Number.parseFloat(value) || 0;
    const borderY =
      style.boxSizing === 'border-box'
        ? parsePx(style.borderTopWidth) + parsePx(style.borderBottomWidth)
        : 0;
    const styleHeightPx = parsePx(el.style.height);

    return {
      value: el.value,
      clientHeight: el.clientHeight,
      scrollHeight: el.scrollHeight,
      styleHeightPx,
      borderY,
      // The auto-resize util sets `style.height = scrollHeight + borderY`.
      // We allow a 1px slack to absorb sub-pixel rounding in the browser.
      fitsContent: styleHeightPx >= el.scrollHeight + borderY - 1,
    };
  });

export const waitForTextareaToFitContent = async (
  textarea: Locator,
  options?: { timeout?: number }
): Promise<void> => {
  await expect
    .poll(async () => (await getTextareaMetrics(textarea)).fitsContent, {
      timeout: options?.timeout ?? 5000,
    })
    .toBe(true);
};
