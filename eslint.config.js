import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import stylistic from '@stylistic/eslint-plugin';
import prettier from 'eslint-config-prettier';

const MULTILINE = [
  'multiline-block-like',
  'multiline-const',
  'multiline-let',
  'multiline-var',
  'multiline-expression',
];

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'coverage/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      globals: globals.node,
      parserOptions: {
        projectService: {
          allowDefaultProject: ['vitest.config.ts', 'drizzle.config.ts'],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: { '@stylistic': stylistic },
    rules: {
      '@stylistic/padding-line-between-statements': [
        'error',
        { blankLine: 'always', prev: MULTILINE, next: '*' },
        { blankLine: 'always', prev: '*', next: MULTILINE },
      ],
      '@typescript-eslint/consistent-type-imports': 'error',
      'no-use-before-define': 'off',
      '@typescript-eslint/no-use-before-define': [
        'error',
        {
          functions: true,
          classes: true,
          variables: true,
          enums: true,
          typedefs: true,
          ignoreTypeReferences: true,
          allowNamedExports: false,
        },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: 'Literal[value=/^https?:\\/\\/pub-.*\\.r2\\.dev/]',
          message: 'Public R2 URLs are forbidden. Use pre-signed URLs with TTL <= 15 minutes.',
        },
      ],
    },
  },
  {
    files: ['src/core/**/*.ts'],
    ignores: ['src/core/llm/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['grammy', 'grammy/*', '@grammyjs/*'],
              message: 'Telegram types stop at src/bot/. Core sees ports such as FileSource.',
            },
            {
              group: ['ai', 'ai/*', '@ai-sdk/*'],
              message:
                'Model SDKs stay in src/core/llm/. Everyone else uses the router and embeddings ports.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/core/llm/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['grammy', 'grammy/*', '@grammyjs/*'],
              message: 'Telegram types stop at src/bot/. Core sees ports such as FileSource.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/bot/**/*.ts', 'src/mcp/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/bot/**', '**/mcp/**'],
              message: 'Transport layers must not depend on each other. Share logic via src/core/.',
            },
            {
              group: ['@qdrant/*', '@aws-sdk/*', '@langchain/*'],
              message:
                'Storage and RAG clients belong in src/core/. Transports consume core services.',
            },
            {
              group: ['ai', 'ai/*', '@ai-sdk/*'],
              message:
                'Model SDKs stay in src/core/llm/. Transports consume the router and embeddings ports.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['eslint.config.js'],
    extends: [tseslint.configs.disableTypeChecked],
  },
  prettier,
  {
    rules: {
      curly: ['error', 'all'],
    },
  },
  {
    files: ['src/**/*.test.ts'],
    rules: {
      '@typescript-eslint/require-await': 'off',
    },
  },
);
