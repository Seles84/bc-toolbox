import { createRouter, createWebHashHistory } from 'vue-router';

export const router = createRouter({
    history: createWebHashHistory(),
    routes: [
        { path: '/', name: 'home', component: () => import('./pages/Home.vue') },
        { path: '/settings', name: 'settings', component: () => import('./pages/Settings.vue') },
        {
            path: '/c/:viewer(\\d+)',
            children: [
                { path: '', redirect: (to) => ({ name: 'members', params: to.params }) },
                { path: 'members', name: 'members', component: () => import('./pages/Members.vue') },
                {
                    path: 'members/:member(\\d+)',
                    name: 'member',
                    component: () => import('./pages/Member.vue'),
                },
                { path: 'chats', name: 'chats', component: () => import('./pages/Chats.vue') },
                { path: 'wardrobe', name: 'wardrobe', component: () => import('./pages/Wardrobe.vue') },
                { path: 'friends', name: 'friends', component: () => import('./pages/Friends.vue') },
                {
                    path: 'chats/:channel(\\d+)',
                    name: 'chatroom',
                    component: () => import('./pages/ChatRoom.vue'),
                },
            ],
        },
    ],
});
