require('@expo/env').load(process.cwd());
const fs = require('node:fs');
const { EXPO_PUBLIC_SUPABASE_URL: supabaseUrl, EXPO_PUBLIC_SUPABASE_ANON_KEY: supabaseAnonKey } = process.env;
if (!supabaseUrl || !supabaseAnonKey) throw new Error('Missing public Supabase configuration');
fs.writeFileSync('public/runtime-config.js', 'window.__PUBLIC_CONFIG__ = ' + JSON.stringify({supabaseUrl,supabaseAnonKey}) + ';\n');
