import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/node_modules/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['packages/game/src/**/*.ts'],
    languageOptions: { globals: { ...globals.browser } },
  },
  {
    files: [
      'packages/sim/cli/**/*.ts',
      'packages/*/tools/**/*.mjs',
      '**/vite.config.ts',
      '**/vitest.config.ts',
    ],
    languageOptions: { globals: { ...globals.node } },
  },

  // ── The determinism firewall ─────────────────────────────────────────────
  // The sim must produce bit-identical results on every machine and JS engine
  // (lockstep networking + replays depend on it), so: integers only, no
  // wall-clock, no environment, no floats. See docs/TECH_STRATEGY.md.
  {
    files: ['packages/sim/src/**/*.ts', 'packages/data/src/**/*.ts'],
    rules: {
      'no-restricted-globals': [
        'error',
        'Date',
        'performance',
        'crypto',
        'fetch',
        'window',
        'document',
        'navigator',
        'requestAnimationFrame',
        'setTimeout',
        'setInterval',
        'queueMicrotask',
      ],
      'no-restricted-properties': [
        'error',
        { object: 'Math', property: 'random', message: 'Use prng.ts (mulberry32).' },
        { object: 'Math', property: 'sqrt', message: 'Use isqrt() from fp.ts.' },
        { object: 'Math', property: 'sin', message: 'Use fpSin() from fp.ts.' },
        { object: 'Math', property: 'cos', message: 'Use fpCos() from fp.ts.' },
        { object: 'Math', property: 'tan', message: 'Not deterministic cross-engine.' },
        { object: 'Math', property: 'atan2', message: 'Not deterministic cross-engine.' },
        { object: 'Math', property: 'pow', message: 'Not deterministic cross-engine.' },
        { object: 'Math', property: 'exp', message: 'Not deterministic cross-engine.' },
        { object: 'Math', property: 'log', message: 'Not deterministic cross-engine.' },
        { object: 'Math', property: 'hypot', message: 'Not deterministic cross-engine.' },
        { object: 'Math', property: 'cbrt', message: 'Not deterministic cross-engine.' },
        { object: 'Math', property: 'fround', message: 'No floats in sim.' },
        { object: 'Number', property: 'parseFloat', message: 'No floats in sim.' },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: 'Literal[value=type(number)][raw=/\\./]',
          message: 'No float literals in sim — use fixed-point (FP = 1024).',
        },
        {
          selector: 'Literal[value=type(number)][raw=/[eE]/]',
          message: 'No exponent literals in sim.',
        },
        {
          selector: "BinaryExpression[operator='/']",
          message: 'No / in sim — use idiv() from fp.ts.',
        },
        {
          selector: "AssignmentExpression[operator='/=']",
          message: 'No /= in sim — use idiv() from fp.ts.',
        },
        {
          selector:
            "NewExpression[callee.name='Float32Array'], NewExpression[callee.name='Float64Array']",
          message: 'No float arrays in sim.',
        },
      ],
      'no-restricted-imports': [
        'error',
        { patterns: ['@babylonjs/*', '*.css'] },
      ],
    },
  },
);
