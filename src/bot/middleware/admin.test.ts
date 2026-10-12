import type { Context } from 'grammy';
import { describe, expect, it, vi } from 'vitest';
import { adminOnly } from './admin.ts';

function ctx(id?: number): Context {
  return { from: id === undefined ? undefined : { id } } as Context;
}

describe('adminOnly', () => {
  it('drops every update that is not from the configured user, with no reply', async () => {
    const next = vi.fn();

    await adminOnly(42)(ctx(7), next);
    await adminOnly(42)(ctx(), next);

    expect(next).not.toHaveBeenCalled();
  });

  it('lets the admin through', async () => {
    const next = vi.fn();

    await adminOnly(42)(ctx(42), next);

    expect(next).toHaveBeenCalledOnce();
  });
});
