import config from '@losant/eslint-config-losant/env/node.js';
export default [
  { ignores: ['**/dist/**'] },
  ...config,
  {
    rules: {
      'camelcase': 0,
      'no-console': 0,
      'no-continue': 0
    }
  }
];
