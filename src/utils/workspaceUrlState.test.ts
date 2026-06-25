import { describe, expect, it } from 'vitest';
import {
  buildWorkspaceUrlSearch,
  parseWorkspaceUrlState,
  resolveWorkspaceUrlState,
  type WorkspaceUrlStateInput,
} from '@/utils/workspaceUrlState';

describe('parseWorkspaceUrlState', () => {
  it('parses all valid fields', () => {
    expect(parseWorkspaceUrlState('?view=candidate&result=foo.xml&item=item-1&details=1')).toEqual({
      viewMode: 'candidate',
      resultFile: 'foo.xml',
      itemId: 'item-1',
      showBasicInfo: true,
    });
  });

  it('treats a leading "?" as optional', () => {
    expect(parseWorkspaceUrlState('view=item')).toEqual({
      viewMode: 'item',
      resultFile: undefined,
      itemId: undefined,
      showBasicInfo: undefined,
    });
  });

  it('rejects an unknown view mode', () => {
    expect(parseWorkspaceUrlState('view=foo').viewMode).toBeUndefined();
  });

  it('treats empty result/item values as missing', () => {
    const parsed = parseWorkspaceUrlState('view=item&result=&item=');
    expect(parsed.resultFile).toBeUndefined();
    expect(parsed.itemId).toBeUndefined();
  });

  it('only treats details=1 as the truthy value', () => {
    expect(parseWorkspaceUrlState('details=1').showBasicInfo).toBe(true);
    expect(parseWorkspaceUrlState('details=yes').showBasicInfo).toBeUndefined();
    expect(parseWorkspaceUrlState('details=true').showBasicInfo).toBeUndefined();
    expect(parseWorkspaceUrlState('details=').showBasicInfo).toBeUndefined();
  });
});

describe('resolveWorkspaceUrlState', () => {
  const results = [{ fileName: 'assessmentResult-1.xml' }, { fileName: 'assessmentResult-2.xml' }];
  const items = [{ identifier: 'item-1' }, { identifier: 'item-2' }];

  it('falls back to item view and index 0 when everything is missing', () => {
    expect(resolveWorkspaceUrlState({}, results, items)).toEqual({
      viewMode: 'item',
      currentResultIndex: 0,
      currentItemIndex: 0,
      showBasicInfo: false,
    });
  });

  it('resolves known result/item keys to their indices', () => {
    expect(
      resolveWorkspaceUrlState(
        {
          viewMode: 'candidate',
          resultFile: 'assessmentResult-2.xml',
          itemId: 'item-2',
          showBasicInfo: true,
        },
        results,
        items
      )
    ).toEqual({
      viewMode: 'candidate',
      currentResultIndex: 1,
      currentItemIndex: 1,
      showBasicInfo: true,
    });
  });

  it('falls back to index 0 when the result or item key no longer exists', () => {
    expect(
      resolveWorkspaceUrlState(
        { viewMode: 'item', resultFile: 'missing.xml', itemId: 'gone' },
        results,
        items
      )
    ).toEqual({
      viewMode: 'item',
      currentResultIndex: 0,
      currentItemIndex: 0,
      showBasicInfo: false,
    });
  });
});

describe('buildWorkspaceUrlSearch', () => {
  it('always emits view', () => {
    const search = buildWorkspaceUrlSearch({
      viewMode: 'item',
      showBasicInfo: false,
    });
    const params = new URLSearchParams(search);
    expect(params.get('view')).toBe('item');
    expect(params.has('result')).toBe(false);
    expect(params.has('item')).toBe(false);
    expect(params.has('details')).toBe(false);
  });

  it('emits result/item when present and details=1 when true', () => {
    const state: WorkspaceUrlStateInput = {
      viewMode: 'candidate',
      resultFile: 'assessmentResult-multi-02.xml',
      itemId: 'item-2',
      showBasicInfo: true,
    };
    const params = new URLSearchParams(buildWorkspaceUrlSearch(state));
    expect(params.get('view')).toBe('candidate');
    expect(params.get('result')).toBe('assessmentResult-multi-02.xml');
    expect(params.get('item')).toBe('item-2');
    expect(params.get('details')).toBe('1');
  });

  it('omits details when the details panel is hidden', () => {
    const search = buildWorkspaceUrlSearch({
      viewMode: 'item',
      resultFile: 'assessmentResult-1.xml',
      itemId: 'item-1',
      showBasicInfo: false,
    });
    expect(new URLSearchParams(search).has('details')).toBe(false);
  });

  it('does not prepend a leading "?"', () => {
    const search = buildWorkspaceUrlSearch({
      viewMode: 'item',
      showBasicInfo: false,
    });
    expect(search.startsWith('?')).toBe(false);
  });
});
