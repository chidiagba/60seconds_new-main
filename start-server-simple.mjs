import 'dotenv/config';
import { serve } from '@hono/node-server';

const appModule = await import('./backend/hono.ts');
const app = appModule.default;

const port = 3001;
console.log(`🚀 Starting server on port ${port}...`);

serve({
  fetch: app.fetch,
  port: port,
}, (info) => {
  console.log(`✅ Server running on http://localhost:${info.port}`);
  console.log(`📡 TRPC: http://localhost:${info.port}/api/trpc`);
});
