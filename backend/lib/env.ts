export function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value || /your_|placeholder|REMOVED_|CONFIGURE_/i.test(value)) throw new Error(`Missing required server environment variable: ${name}`);
  return value;
}
