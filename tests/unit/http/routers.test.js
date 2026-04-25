'use strict';

const { ROUTERS, openRouters, guardedRouters } = require('../../../src/http/routers');

describe('what the desk mounts', () => {
  it('builds a router for every entry', () => {
    for (const router of ROUTERS) {
      expect(typeof router.build).toBe('function');
      expect(router.path.startsWith('/')).toBe(true);
      expect(typeof router.open).toBe('boolean');
    }
  });

  it('keeps only health, metrics and auth open', () => {
    expect(openRouters().map((router) => router.path)).toEqual(['/health', '/metrics', '/auth']);
  });

  it('guards everything else', () => {
    const guarded = guardedRouters().map((router) => router.path);

    expect(guarded).toContain('/bookings');
    expect(guarded).toContain('/royalty-statements');
    expect(guarded).not.toContain('/health');
  });

  it('mounts the open ones before the guarded ones', () => {
    const firstGuarded = ROUTERS.findIndex((router) => !router.open);
    const lastOpen = ROUTERS.map((router) => router.open).lastIndexOf(true);

    expect(lastOpen).toBeLessThan(firstGuarded);
  });

  it('mounts the two that answer on more than one prefix at the root', () => {
    const atRoot = ROUTERS.filter((router) => router.path === '/');

    expect(atRoot).toHaveLength(2);
    expect(atRoot.every((router) => router.open === false)).toBe(true);
  });

  it('does not mount the same prefix twice by accident', () => {
    const prefixes = ROUTERS.map((router) => router.path).filter((path) => path !== '/');

    expect(new Set(prefixes).size).toBe(prefixes.length);
  });
});
