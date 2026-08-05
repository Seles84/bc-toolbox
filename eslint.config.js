import js from '@eslint/js';
import ts from 'typescript-eslint';
import vue from 'eslint-plugin-vue';

export default ts.config(
    { ignores: ['dist/', 'node_modules/'] },
    js.configs.recommended,
    ...ts.configs.recommended,
    ...vue.configs['flat/recommended'],
    {
        files: ['**/*.vue'],
        languageOptions: {
            parserOptions: { parser: ts.parser },
        },
        rules: {
            // TypeScript (vue-tsc) already flags unknown identifiers; eslint's
            // no-undef doesn't know browser globals or TS types in SFCs.
            'no-undef': 'off',
            // Pages are naturally single-word (Members, Chats, Settings…).
            'vue/multi-word-component-names': 'off',
        },
    },
    {
        languageOptions: {
            globals: {
                chrome: 'readonly',
                __BCT_VERSION__: 'readonly',
                __BCT_BUILD__: 'readonly',
                __DEV__: 'readonly',
            },
        },
        rules: {
            // Formatting is handled by hand/editor; don't fight the templates.
            'vue/html-indent': 'off',
            'vue/max-attributes-per-line': 'off',
            'vue/singleline-html-element-content-newline': 'off',
            'vue/html-closing-bracket-newline': 'off',
            'vue/html-self-closing': 'off',
            'vue/first-attribute-linebreak': 'off',
            // Game globals (bc-stubs) and loose payload typing are inherent here.
            '@typescript-eslint/no-explicit-any': 'off',
            '@typescript-eslint/no-non-null-assertion': 'off',
            '@typescript-eslint/no-unused-vars': [
                'error',
                { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
            ],
        },
    },
    {
        files: ['src/injected/**/*.ts'],
        rules: {
            // Game globals are declared by bc-stubs, which eslint doesn't load.
            'no-undef': 'off',
        },
    },
    {
        files: ['scripts/**/*.mjs'],
        languageOptions: {
            globals: { process: 'readonly', console: 'readonly', URL: 'readonly' },
        },
    },
);
