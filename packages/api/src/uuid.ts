// Every primary key in the schema is a Postgres uuid. A non-uuid path param
// (a truncated share link, a bot probing /api/<route>/<junk>) makes the driver
// throw "invalid input syntax for type uuid", which surfaces as a 500. Routes
// test params against this and return a clean 404 instead.
export const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}
