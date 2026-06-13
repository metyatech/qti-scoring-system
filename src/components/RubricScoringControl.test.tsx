import React, { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot, Root } from 'react-dom/client';
import RubricScoringControl from '@/components/RubricScoringControl';
import type { QtiItem, QtiRubricCriterion } from '@/utils/qtiParsing';

const baseCriterion: QtiRubricCriterion = { index: 1, points: 1, text: 'Provides any answer' };

const makeItem = (type: QtiItem['type']): QtiItem => ({
  identifier: 'item-1',
  title: 'Item 1',
  type,
  promptHtml: '<p>prompt</p>',
  choices: type === 'choice' ? [{ identifier: 'A', text: 'A' }] : [],
  rubric: [baseCriterion],
  candidateExplanationHtml: null,
});

const setupContainer = () => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  return { container, root };
};

describe('RubricScoringControl', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const setup = setupContainer();
    container = setup.container;
    root = setup.root;
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
    vi.restoreAllMocks();
  });

  it('renders a read-only auto-score badge for choice items and no toggle buttons', () => {
    const onChange = vi.fn();
    act(() => {
      root.render(
        <RubricScoringControl item={makeItem('choice')} criterion={baseCriterion} value={true} onChange={onChange} />
      );
    });

    const buttons = Array.from(container.querySelectorAll('button')).filter((button) => {
      const text = (button.textContent ?? '').trim();
      return text === '〇' || text === '×';
    });
    expect(buttons).toHaveLength(0);

    const badge = container.querySelector('[data-testid="rubric-choice-badge"]');
    expect(badge).not.toBeNull();
    expect(badge?.textContent).toContain('自動採点結果');
    expect(badge?.textContent).toContain('○');
    expect(container.textContent).toContain('編集不可');
  });

  it('renders the "正答に変更" button for cloze items that are still false', () => {
    const onChange = vi.fn();
    act(() => {
      root.render(
        <RubricScoringControl item={makeItem('cloze')} criterion={baseCriterion} value={false} onChange={onChange} />
      );
    });

    const upgradeButton = container.querySelector('button');
    expect(upgradeButton).not.toBeNull();
    expect(upgradeButton?.textContent).toContain('正答に変更');
    expect(container.textContent).not.toContain('正答から誤答には変更できません');

    const crossButton = Array.from(container.querySelectorAll('button')).find(
      (button) => (button.textContent ?? '').trim() === '×'
    );
    expect(crossButton).toBeUndefined();

    act(() => {
      upgradeButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(true);
    expect(onChange).not.toHaveBeenCalledWith(false);
  });

  it('locks the cloze control once the value is true', () => {
    const onChange = vi.fn();
    act(() => {
      root.render(
        <RubricScoringControl item={makeItem('cloze')} criterion={baseCriterion} value={true} onChange={onChange} />
      );
    });

    const buttons = Array.from(container.querySelectorAll('button'));
    expect(buttons).toHaveLength(0);
    expect(container.textContent).toContain('正答から誤答には変更できません');
    expect(container.textContent).not.toContain('正答に変更');
  });

  it('keeps the 〇 / × toggle for descriptive items', () => {
    const onChange = vi.fn();
    act(() => {
      root.render(
        <RubricScoringControl
          item={makeItem('descriptive')}
          criterion={baseCriterion}
          value={undefined}
          onChange={onChange}
        />
      );
    });

    const circleButton = Array.from(container.querySelectorAll('button')).find(
      (button) => (button.textContent ?? '').trim() === '〇'
    );
    const crossButton = Array.from(container.querySelectorAll('button')).find(
      (button) => (button.textContent ?? '').trim() === '×'
    );
    expect(circleButton).toBeDefined();
    expect(crossButton).toBeDefined();

    act(() => {
      circleButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onChange).toHaveBeenCalledWith(true);

    onChange.mockClear();
    act(() => {
      crossButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onChange).toHaveBeenCalledWith(false);
  });

  it('renders undefined as "未判定" for cloze items (never as ×)', () => {
    // Fix #3: an undefined outcome on a cloze rubric is a SCORE-only "undetermined"
    // state, not a wrong answer. The control must show "現在: 未判定" (neutral
    // gray) and an "正答に変更" upgrade button, and must NOT render the
    // "現在: ×" / "誤答" red badge used for explicitly false outcomes.
    const onChange = vi.fn();
    act(() => {
      root.render(
        <RubricScoringControl
          item={makeItem('cloze')}
          criterion={baseCriterion}
          value={undefined}
          onChange={onChange}
        />
      );
    });

    // The undetermined badge is rendered, the upgradeable (×) badge is not.
    expect(container.querySelector('[data-testid="rubric-cloze-undetermined"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="rubric-cloze-upgradeable"]')).toBeNull();

    // Label semantics: "未判定" present, "現在: ×" absent, "誤答" absent.
    expect(container.textContent).toContain('現在: 未判定');
    expect(container.textContent).not.toContain('現在: ×');
    expect(container.textContent).not.toContain('誤答');

    // The one-way "正答に変更" upgrade button is still exposed for undefined.
    const upgradeButton = container.querySelector('button');
    expect(upgradeButton).not.toBeNull();
    expect(upgradeButton?.textContent).toContain('正答に変更');

    act(() => {
      upgradeButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(true);
  });
});
