const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
    { ignores: ['node_modules/**'] },
    {
        files: ['*.js', '*.cjs'],
        languageOptions: { ecmaVersion: 2022, sourceType: 'script', globals: { ...globals.browser, ...globals.node } },
        rules: {
            ...js.configs.recommended.rules,
            'no-empty': ['error', { allowEmptyCatch: true }],
            'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none', varsIgnorePattern: '^_' }],
            'eqeqeq': 'error',
            'no-eval': 'error',
            'no-new-func': 'error',
        },
    },
];
