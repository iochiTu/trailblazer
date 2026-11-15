/**
 * The test database for the packages whose tests need Postgres (db, core, api). The defaults match
 * docker-compose.yml; set TEST_DATABASE_URL and TEST_DATABASE_APP_URL when Postgres is elsewhere
 * (another port, CI). turbo.json passes both through to `pnpm test`.
 */
export const testDatabaseEnv = {
  TEST_DATABASE_URL:
    process.env.TEST_DATABASE_URL ?? "postgres://traiblazer:traiblazer@localhost:5433/traiblazer_test",
  TEST_DATABASE_APP_URL:
    process.env.TEST_DATABASE_APP_URL ??
    "postgres://traiblazer_app:traiblazer_app@localhost:5433/traiblazer_test",
};
