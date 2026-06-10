import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**'] },
  ...tseslint.configs.recommended,
  {
    // SPEC §How import-boundary rule: core/ imports nothing outside core/.
    // (tests/boundaries.test.ts enforces the same invariant headlessly by
    // scanning resolved relative paths, which ESLint patterns can't do.)
    files: ['src/core/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['three', 'three/*'], message: 'core/ must stay free of Three.js' },
            { group: ['*../app/*', '*../scene/*', '*../ui/*', '*../input/*', '*../audio/*', '*../persist/*'],
              message: 'core/ imports nothing outside core/' },
          ],
        },
      ],
    },
  },
  {
    files: ['**/*.ts'],
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  }
);
