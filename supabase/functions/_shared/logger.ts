export const logger = {
  debug: (...args: unknown[]) => { if (Deno.env.get('ENVIRONMENT') === 'development') console.debug(...args); },
};
