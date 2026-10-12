import type { MiddlewareFn } from 'grammy';

export function adminOnly(adminId: number): MiddlewareFn {
  return async (ctx, next) => {
    if (ctx.from?.id !== adminId) {
      return;
    }

    await next();
  };
}
