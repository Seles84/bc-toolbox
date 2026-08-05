import { createApp } from 'vue';
import PopupApp from './PopupApp.vue';
import '../ui/style.css';

window.addEventListener('unhandledrejection', (event) => {
    console.error('[BCT] unhandled rejection:', event.reason);
    event.preventDefault();
});

createApp(PopupApp).mount('#app');
