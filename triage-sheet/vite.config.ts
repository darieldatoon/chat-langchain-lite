import { defineConfig } from "vite-plus";

// A LangSmith custom app: the sandbox evaluates one dependency-free CommonJS file that exports
// `render(data, root, metadata)`, so this is a library build with everything inlined.
export default defineConfig({
  // Library mode leaves `process.env.NODE_ENV` in React's source, and the sandbox has no
  // `process`. Not under Vitest: React's production build has no `act`.
  define: process.env.VITEST ? {} : { "process.env.NODE_ENV": '"production"' },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    lib: {
      entry: "src/entry.tsx",
      formats: ["cjs"],
      fileName: () => "bundle.js",
    },
    // One file: the sandbox can't load chunks.
    rolldownOptions: { output: { codeSplitting: false, exports: "named" } },
  },
  lint: { options: { typeAware: true, typeCheck: true } },
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.{ts,tsx}"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/**/*.d.ts"],
      // `langsmith apps push` uploads this directory without reading .gitignore.
      reportsDirectory: "../node_modules/.coverage/triage-sheet",
      thresholds: { lines: 100, functions: 100, branches: 100, statements: 100 },
      reporter: ["text"],
    },
  },
});
