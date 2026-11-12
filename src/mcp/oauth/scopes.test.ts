import { describe, expect, it } from 'vitest';
import { missingScopes, requiredScopes, TOOL_SCOPES } from './scopes.ts';

describe('requiredScopes', () => {
  it('maps each tool behind tools/call to its scope', () => {
    for (const [name, scope] of Object.entries(TOOL_SCOPES)) {
      expect(requiredScopes([{ method: 'tools/call', name }])).toEqual([scope]);
    }
  });

  it('needs nothing for an unknown tool, a missing name, or another method', () => {
    expect(requiredScopes([{ method: 'tools/call', name: 'drop_database' }])).toEqual([]);
    expect(requiredScopes([{ method: 'tools/call', name: 'toString' }])).toEqual([]);
    expect(requiredScopes([{ method: 'tools/call' }])).toEqual([]);
    expect(requiredScopes([{ method: 'tools/list', name: 'forget_memory' }])).toEqual([]);
    expect(requiredScopes([])).toEqual([]);
  });

  it('lists each scope once, in the declared order', () => {
    const calls = [
      { method: 'tools/call', name: 'forget_memory' },
      { method: 'tools/call', name: 'search_memory' },
      { method: 'tools/call', name: 'get_memory' },
    ];

    expect(requiredScopes(calls)).toEqual(['memory:read', 'memory:delete']);
  });
});

describe('missingScopes', () => {
  it('returns only the scopes the grant lacks', () => {
    expect(missingScopes(['memory:read'], ['memory:read', 'memory:delete'])).toEqual([
      'memory:delete',
    ]);

    expect(missingScopes(['memory:read', 'memory:delete'], ['memory:delete'])).toEqual([]);
    expect(missingScopes([], [])).toEqual([]);
  });
});
