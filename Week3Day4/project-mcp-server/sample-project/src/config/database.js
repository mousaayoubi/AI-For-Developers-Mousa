/**
 * Reads database connection settings from the environment. The real
 * connection string lives in `.env` (never committed, never read by the
 * repository agent) and is only accessed here, at process start.
 */
const config = {
  url: process.env.DATABASE_URL || "postgres://localhost:5432/sample_app",
  poolSize: Number(process.env.DB_POOL_SIZE || 10),
};

function getConnectionConfig() {
  return { ...config };
}

module.exports = { getConnectionConfig };
