const { createClient } = require('@supabase/supabase-js');
const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const key = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const supabase = createClient(url, key);
const email = `sgtest+${Date.now()}@example.com`;

(async () => {
  const { data, error } = await supabase.auth.signUp({
    email,
    password: 'StrongPass123!'
  });

  console.log(JSON.stringify({
    hasUrl: Boolean(url),
    hasKey: Boolean(key),
    email,
    error: error ? error.message : null,
    userId: data?.user?.id || null,
    confirmed: data?.user?.email_confirmed_at || null
  }, null, 2));
})();
