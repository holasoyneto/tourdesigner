import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/static/v3/' : '/',
  experimental: {
    renderBuiltUrl(filename, { hostType }) {
      if (hostType === 'html') return `/static/v3/${filename}`;
      return {
        runtime: `((document.querySelector('meta[name="td-base"]')?.getAttribute('content')||'')+'/static/v3/'+${JSON.stringify(filename)})`,
      };
    },
  },
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:8080',
      '/mcp': 'http://127.0.0.1:8080',
    },
  },
  build: {
    outDir: '../backend/static/v3',
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('react-dom') || id.includes('/react/')) return 'vendor-react';
          if (id.includes('dexie')) return 'vendor-dexie';
          if (id.includes('lucide-react')) return 'vendor-icons';
          return 'vendor';
        },
      },
    },
  },
}));
