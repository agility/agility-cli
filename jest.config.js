module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  // Default: unit tests only (exclude integration tests)
  testMatch: ["**/src/**/tests/**/*.test.ts"],
  testPathIgnorePatterns: [
    "/node_modules/",
    "/dist/",
    "/src/index.ts",
    "integration\\.test\\.ts",
    "/\\.claude/worktrees/",
  ],
  // Map TypeScript path aliases to actual paths
  moduleNameMapper: {
    "^core/(.*)$": "<rootDir>/src/core/$1",
    "^core$": "<rootDir>/src/core",
    "^lib/(.*)$": "<rootDir>/src/lib/$1",
    "^types/(.*)$": "<rootDir>/src/types/$1",
  },
  // Transpile-only: skip type-checking in ts-jest (covered separately by `npm run type-check`).
  // Without this, every worker builds a full TS LanguageService whose AST cache is never
  // released for the life of the process, so memory grows unbounded across the run.
  transform: {
    "^.+\\.tsx?$": ["ts-jest", { isolatedModules: true }],
  },
  // Cap parallelism so we don't spawn (CPUs - 1) heavy worker processes at once.
  maxWorkers: "50%",
  // Recycle any worker that balloons instead of letting it grow for the whole run.
  workerIdleMemoryLimit: "512MB",
};
