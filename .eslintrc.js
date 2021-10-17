module.exports = {
  root: true,
  env: {
    browser: true,
    es2020: true,
    node: true,
  },
  globals: {
    NodeJS: true,
  },
  extends: [
    'eslint:recommended',
    'plugin:react/recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:prettier/recommended',
    'prettier',
  ],
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaFeatures: {
      jsx: true,
    },
    ecmaVersion: 11,
    sourceType: 'module',
  },
  plugins: ['react', '@typescript-eslint', 'import', 'tsdoc', 'prettier'],
  rules: {
    '@typescript-eslint/no-shadow': 'error',
    'arrow-body-style': ['error', 'as-needed'],
    'import/no-duplicates': 'error',
    'indent-legacy': 'off',
    indent: 'off',
    'jsx-quotes': ['error', 'prefer-single'],
    'linebreak-style': ['error', 'unix'],
    'max-len': ['error', { code: 100, ignoreUrls: true, ignoreComments: true }],
    'no-undef': 'error',
    'no-unused-vars': 'off',
    '@typescript-eslint/no-unused-vars': ['error'],
    'no-var': ['error'],
    'object-shorthand': 'error',
    'prefer-const': ['error', { destructuring: 'any' }],
    quotes: 'off',
    semi: ['error', 'never'],
    'no-param-reassign': ['error'],
    'tsdoc/syntax': 'warn',
  },
}
