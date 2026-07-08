const fs = require('fs');
const path = require('path');

const filePath = path.join(
  process.cwd(),
  'node_modules',
  'expo',
  'src',
  'async-require',
  'messageSocket.native.ts'
);

if (!fs.existsSync(filePath)) {
  console.log('[patch-expo-message-socket] target file not found, skipping');
  process.exit(0);
}

const original = fs.readFileSync(filePath, 'utf8');

if (original.includes('Embedded environments do not expose a Metro message socket; skip devtools channel.')) {
  console.log('[patch-expo-message-socket] already patched');
  process.exit(0);
}

const before = "    if (!devServer.bundleLoadedFromServer) {\n      throw new Error('Cannot create devtools websocket connections in embedded environments.');\n    }";

const after = "    if (!devServer.bundleLoadedFromServer) {\n      // Embedded environments do not expose a Metro message socket; skip devtools channel.\n      return { onmessage: null } as unknown as WebSocket;\n    }";

if (!original.includes(before)) {
  console.error('[patch-expo-message-socket] expected code block not found');
  process.exit(1);
}

const updated = original.replace(before, after);
fs.writeFileSync(filePath, updated, 'utf8');
console.log('[patch-expo-message-socket] patched Expo message socket for embedded runtime');
