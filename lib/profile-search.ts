// Quote PostgREST values and treat SQL pattern characters as literal input.
export function profileSearchFilter(query: string): string {
  const term = query.trim().replace(/^@+/, '').trim();
  const pattern = (value: string) => JSON.stringify(`%${value.replace(/[\\%_]/g, '\\$&')}%`);
  const username = term.replace(/\s+/g, '_');
  return [
    `username.ilike.${pattern(username)}`,
    `full_name.ilike.${pattern(term)}`,
    `business_name.ilike.${pattern(term)}`,
  ].join(',');
}
