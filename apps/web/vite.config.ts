import { defineConfig } from 'vite-plus';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
export default defineConfig({
  plugins: [react(), tailwindcss(), VitePWA({
    strategies: 'injectManifest', srcDir: 'src', filename: 'sw.ts',
    injectRegister: 'script',
    injectManifest: { globPatterns: ['**/*.{js,css,html,png,woff2}'] },
    manifest: {
      id: '/', name: 'অফিস সেবা · Office Service', short_name: 'অফিস সেবা', lang: 'bn-BD',
      start_url: '/', scope: '/', display: 'standalone', background_color: '#f5f7f6', theme_color: '#086347',
      icons: [
        { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
        { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
    },
  })],
  server: { port: 5173, strictPort: true, proxy: { '/api': process.env.API_ORIGIN ?? 'http://localhost:3000' } },
});
