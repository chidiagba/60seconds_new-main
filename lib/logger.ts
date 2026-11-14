// Do not pass credentials, tokens, OTPs or personal data to logs.
const development = typeof __DEV__ !== 'undefined' ? __DEV__ : process.env.NODE_ENV === 'development';
export const logger = {
  debug: (...args: unknown[]) => { if (development) console.debug(...args); },
  info: (...args: unknown[]) => { if (development) console.info(...args); },
  warn: (...args: unknown[]) => { if (development) console.warn(...args); },
  error: (...args: unknown[]) => { if (development) console.error(...args); },
};
