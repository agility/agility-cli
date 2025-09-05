import js from '@eslint/js';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import prettierPlugin from 'eslint-plugin-prettier';
import prettierConfig from 'eslint-config-prettier';

export default [
  js.configs.recommended,
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2020,
        sourceType: 'module',
        project: './tsconfig.json',
      },
      globals: {
        console: 'readonly',
        process: 'readonly',
        Buffer: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        global: 'readonly',
        require: 'readonly',
        module: 'readonly',
        exports: 'readonly',
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
      prettier: prettierPlugin,
    },
    rules: {
      // Prettier rules
      'prettier/prettier': 'error',

      // TypeScript specific rules - lenient for existing codebase
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      '@typescript-eslint/no-explicit-any': 'off', // Too many existing uses
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/no-non-null-assertion': 'warn',
      '@typescript-eslint/no-require-imports': 'warn', // Legacy require() usage

      // General rules - lenient for existing codebase
      'no-console': 'off', // CLI tool needs console output
      'no-process-exit': 'off', // CLI tool needs process.exit
      'no-undef': 'off', // TypeScript handles this
      'no-unused-vars': 'off', // Let TypeScript handle this
      'no-debugger': 'warn',
      'no-empty': 'warn',
      'no-useless-escape': 'warn',
      'no-useless-catch': 'warn',
      'no-dupe-else-if': 'warn',
      'no-case-declarations': 'warn',
      'no-control-regex': 'warn',
      'no-empty-pattern': 'warn',
    },
  },
  {
    files: ['src/tests/**/*.ts'],
    languageOptions: {
      globals: {
        jest: 'readonly',
        describe: 'readonly',
        it: 'readonly',
        test: 'readonly',
        expect: 'readonly',
        beforeAll: 'readonly',
        beforeEach: 'readonly',
        afterAll: 'readonly',
        afterEach: 'readonly',
      },
    },
  },
  {
    ignores: ['dist/', 'node_modules/', '*.js', '!eslint.config.js'],
  },
];
