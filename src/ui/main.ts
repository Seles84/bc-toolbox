import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import { router } from './router';
import './style.css';

/** Render non-Error rejection reasons readably instead of "[object Object]". */
function describe(error: unknown): string {
    if (error instanceof Error) return error.stack ?? error.message;
    try {
        return JSON.stringify(error);
    } catch {
        return String(error);
    }
}

const app = createApp(App);

app.config.errorHandler = (error, _instance, info) => {
    console.error(`[BCT] vue error (${info}):`, describe(error), error);
};
window.addEventListener('unhandledrejection', (event) => {
    console.error('[BCT] unhandled rejection:', describe(event.reason), event.reason);
    event.preventDefault();
});

app.use(createPinia()).use(router).mount('#app');
