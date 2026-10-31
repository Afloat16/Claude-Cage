import { defineConfig } from 'astro/config';
export default defineConfig({
  site: process.env.SITE_URL || 'https://claude-cage.aedanheryford981685.chatgpt.site',
  trailingSlash: 'always',
  server: { port: 4822 },
  build: { inlineStylesheets: 'auto' },
});
