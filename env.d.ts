/// <reference types="vite/client" />

/** Injected at build time by scripts/build.mjs */
declare const __BCT_VERSION__: string;
declare const __BCT_BUILD__: string;
declare const __DEV__: boolean;

declare module '*.vue' {
    import type { DefineComponent } from 'vue';
    const component: DefineComponent<object, object, unknown>;
    export default component;
}
