
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';

export default defineConfig({
   base: '/StupidCaloriesTracker/',
    plugins: [
        react(),
        tailwindcss()
    ],
    server: {
        host: '0.0.0.0' // This line is required to open the app on your phone
    }
});