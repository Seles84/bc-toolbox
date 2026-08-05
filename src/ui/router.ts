import { createRouter, createWebHashHistory } from 'vue-router';

export const router = createRouter({
    history: createWebHashHistory(),
    routes: [
        { path: '/', name: 'home', component: () => import('./pages/Home.vue') },
        { path: '/settings', name: 'settings', component: () => import('./pages/Settings.vue') },
        {
            path: '/c/:viewer(\\d+)',
            children: [
                { path: '', name: 'dashboard', component: () => import('./pages/Dashboard.vue') },
                { path: 'members', name: 'members', component: () => import('./pages/Members.vue') },
                {
                    path: 'members/:member(\\d+)',
                    name: 'member',
                    component: () => import('./pages/Member.vue'),
                },
                { path: 'chats', name: 'chats', component: () => import('./pages/Chats.vue') },
                { path: 'wardrobe', name: 'wardrobe', component: () => import('./pages/Wardrobe.vue') },
                { path: 'friends', name: 'friends', component: () => import('./pages/Friends.vue') },
                { path: 'beeps', name: 'beeps', component: () => import('./pages/Beeps.vue') },
                { path: 'search', name: 'search', component: () => import('./pages/Search.vue') },
                {
                    path: 'chats/:channel(\\d+)',
                    name: 'chatroom',
                    component: () => import('./pages/ChatRoom.vue'),
                },
            ],
        },
    ],
});
