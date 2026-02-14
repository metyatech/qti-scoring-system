import { test, expect } from '@playwright/test';

const THEMES: Array<'light' | 'dark'> = ['light', 'dark'];

test('contrast and boundary visibility checks pass on top page', async ({ browser }) => {
  test.setTimeout(180000);
  const issues: string[] = [];

  for (const theme of THEMES) {
    const context = await browser.newContext({
      baseURL: 'http://127.0.0.1:3000',
      colorScheme: theme
    });

    try {
      const page = await context.newPage();
      await page.goto('/', { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('body');

      const pageIssues = await page.evaluate(() => {
        const toLinear = (value: number) => {
          const normalized = value / 255;
          return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
        };

        const parseColor = (text: string) => {
          const match = text.match(/rgba?\(([^)]+)\)/);
          if (!match) {
            return null;
          }
          const parts = match[1].split(',').map((part) => Number(part.trim()));
          if (parts.length < 3 || parts.some(Number.isNaN)) {
            return null;
          }
          return {
            red: parts[0],
            green: parts[1],
            blue: parts[2],
            alpha: parts.length >= 4 && !Number.isNaN(parts[3]) ? parts[3] : 1
          };
        };

        const blend = (
          fg: { red: number; green: number; blue: number; alpha: number },
          bg: { red: number; green: number; blue: number; alpha: number }
        ) => {
          const alpha = fg.alpha + bg.alpha * (1 - fg.alpha);
          if (alpha <= 0) {
            return { red: 0, green: 0, blue: 0, alpha: 0 };
          }
          return {
            red: (fg.red * fg.alpha + bg.red * bg.alpha * (1 - fg.alpha)) / alpha,
            green: (fg.green * fg.alpha + bg.green * bg.alpha * (1 - fg.alpha)) / alpha,
            blue: (fg.blue * fg.alpha + bg.blue * bg.alpha * (1 - fg.alpha)) / alpha,
            alpha
          };
        };

        const luminance = (color: { red: number; green: number; blue: number }) => (
          0.2126 * toLinear(color.red) + 0.7152 * toLinear(color.green) + 0.0722 * toLinear(color.blue)
        );

        const contrast = (
          first: { red: number; green: number; blue: number },
          second: { red: number; green: number; blue: number }
        ) => {
          const l1 = luminance(first);
          const l2 = luminance(second);
          const [bright, dark] = l1 >= l2 ? [l1, l2] : [l2, l1];
          return (bright + 0.05) / (dark + 0.05);
        };

        const rootBackground = (() => {
          const root = parseColor(window.getComputedStyle(document.documentElement).backgroundColor);
          if (root && root.alpha > 0) {
            return root;
          }
          const body = parseColor(window.getComputedStyle(document.body).backgroundColor);
          if (body && body.alpha > 0) {
            return body;
          }
          return document.documentElement.classList.contains('dark')
            ? { red: 9, green: 17, blue: 32, alpha: 1 }
            : { red: 255, green: 255, blue: 255, alpha: 1 };
        })();

        const resolveBackground = (node: HTMLElement) => {
          let current: HTMLElement | null = node;
          let out = rootBackground;
          const chain: HTMLElement[] = [];
          while (current) {
            chain.unshift(current);
            current = current.parentElement;
          }
          for (const element of chain) {
            const bg = parseColor(window.getComputedStyle(element).backgroundColor);
            if (bg) {
              out = blend(bg, out);
            }
          }
          return out;
        };

        const textIssues: string[] = [];
        const boundaryIssues: string[] = [];
        const elements = [...document.querySelectorAll<HTMLElement>('body *')].slice(0, 450);

        for (const element of elements) {
          const style = window.getComputedStyle(element);
          if (
            style.display === 'none' ||
            style.visibility !== 'visible' ||
            Number.parseFloat(style.opacity || '1') < 0.05
          ) {
            continue;
          }

          const rect = element.getBoundingClientRect();
          if (rect.width < 2 || rect.height < 2) {
            continue;
          }

          const text = (element.innerText || '').trim();
          if (text.length > 0) {
            const fg = parseColor(style.color);
            if (fg) {
              const bg = resolveBackground(element);
              const fgBlended = blend(fg, bg);
              const ratio = contrast(fgBlended, bg);
              const fontSize = Number.parseFloat(style.fontSize || '16');
              const fontWeight = Number.parseInt(style.fontWeight || '400', 10);
              const largeText = fontSize >= 18 || (fontSize >= 14 && fontWeight >= 700);
              const minRatio = largeText ? 3 : 4.5;
              if (ratio < minRatio) {
                textIssues.push(`text ratio=${ratio.toFixed(2)} class=${String(element.className || '')}`);
              }
            }
          }

          const borderWidth = Math.max(
            Number.parseFloat(style.borderTopWidth || '0'),
            Number.parseFloat(style.borderRightWidth || '0'),
            Number.parseFloat(style.borderBottomWidth || '0'),
            Number.parseFloat(style.borderLeftWidth || '0')
          );
          const outlineWidth = Number.parseFloat(style.outlineWidth || '0');
          const hasBoundary = borderWidth > 0 || (outlineWidth > 0 && style.outlineStyle !== 'none');
          if (hasBoundary && rect.width * rect.height >= 600) {
            const boundaryColor = borderWidth > 0
              ? parseColor(style.borderTopColor)
              : parseColor(style.outlineColor);
            if (boundaryColor) {
              const parentBg = resolveBackground(element.parentElement ?? element);
              const blendedBoundary = blend(boundaryColor, parentBg);
              const ratio = contrast(blendedBoundary, parentBg);
              if (ratio < 3) {
                boundaryIssues.push(`boundary ratio=${ratio.toFixed(2)} class=${String(element.className || '')}`);
              }
            }
          }
        }

        return [...textIssues.slice(0, 30), ...boundaryIssues.slice(0, 30)];
      });

      for (const issue of pageIssues) {
        issues.push(`${theme}: ${issue}`);
      }

      await page.close();
    } finally {
      await context.close();
    }
  }

  expect(issues.join('\n')).toBe('');
});
