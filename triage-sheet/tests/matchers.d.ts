// jest-dom's own vitest augmentation resolves `vitest` from its pnpm sandbox, where the peer is
// not linked, so the matchers never reach our `expect`. Re-declare the augmentation here.
// oxlint-disable-next-line vite-plus/prefer-vite-plus-imports
import "vitest";
import type { TestingLibraryMatchers } from "@testing-library/jest-dom/matchers";

// The augmented module has to be `vitest` itself: `vite-plus/test` only re-exports it. This only
// reaches our `expect` while `vite` is aliased to vite-plus-core in package.json, so both resolve
// the same `vitest`. Vitest 5's Assertion takes <R, T>; merging needs the same parameters.
declare module "vitest" {
  interface Assertion<R, T> extends TestingLibraryMatchers<unknown, R> {}
  interface AsymmetricMatchersContaining extends TestingLibraryMatchers<unknown, unknown> {}
}
