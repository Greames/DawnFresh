// Minimal typing for the test-only pg client. @types/pg is deliberately not installed:
// pnpm would then resolve drizzle-orm with it and change the type of the production db client.
declare module 'pg' {
  const pg: { Pool: new (config: { connectionString?: string; max?: number }) => any }
  export default pg
}
