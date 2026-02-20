import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
    build: {
        rollupOptions: {
            input: {
                main: resolve(__dirname, 'index.html'),
                book: resolve(__dirname, 'book.html'),
                dashboard: resolve(__dirname, 'dashboard.html'),
                login: resolve(__dirname, 'login.html'),
                consent: resolve(__dirname, 'consent.html'),
            },
        },
        outDir: 'dist',
    },
    server: {
        port: 5174,
    },
});
