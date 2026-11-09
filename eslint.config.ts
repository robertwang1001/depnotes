import antfu from '@antfu/eslint-config'

const config: ReturnType<typeof antfu> = antfu({
  isInEditor: false,
  ignores: ['dist/**'],
  markdown: false,
  test: {
    overrides: { 'test/no-import-node-test': 'off', 'test/consistent-test-it': 'off' },
  },
  rules: {
    'antfu/no-top-level-await': 'off',
    'node/prefer-global/process': ['error', 'always'],
    'node/prefer-global/buffer': ['error', 'always'],
    'no-console': 'off',
    'no-alert': 'off',
    'unused-imports/no-unused-imports': 'warn',
    'unused-imports/no-unused-vars': [
      'warn',
      {
        vars: 'all',
        varsIgnorePattern: '^_',
        args: 'after-used',
        argsIgnorePattern: '^_',
      },
    ],
  },
  typescript: {
    overrides: {
      'ts/no-unused-expressions': [
        'error',
        {
          allowShortCircuit: true,
          allowTernary: true,
          allowTaggedTemplates: true,
        },
      ],
    },
  },
})
export default config
