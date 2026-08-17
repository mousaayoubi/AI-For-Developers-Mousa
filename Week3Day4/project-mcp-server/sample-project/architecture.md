# Architecture

The application follows a Controller, Service, Repository structure.

- **Routes** (`src/routes`) receive HTTP requests and delegate to services.
  They contain no business logic of their own.
- **Services** (`src/services`) implement the application's business logic —
  password hashing, credential verification, and JWT issuing for
  authentication.
- **Repositories** (`src/repositories`) are the only layer that touches data
  storage. `userRepository.js` currently uses an in-memory store as a stand-in
  for a real database table.
- **Middleware** (`src/middleware`) verifies the JWT on protected routes
  before a request reaches its handler.
- **Config** (`src/config`) reads connection settings (such as the database
  URL) from the environment. Actual secret values live in `.env`, which is
  never read or returned by tooling.

## Data storage

PostgreSQL is used for persistent storage in the deployed version of this
service. The connection string is read from `DATABASE_URL` in `.env`
(`src/config/database.js`). The sample project ships with an in-memory
repository so it can be explored without a running database.

## Authentication

Authentication is handled through JWT middleware:

1. `POST /register` and `POST /login` (`src/routes/authRoutes.js`) call into
   `authService.js` to create a user or verify credentials and issue a signed
   JWT.
2. The JWT is returned to the client and expected on subsequent requests.
3. `authMiddleware.js` verifies the JWT's signature and expiry on protected
   routes and attaches the authenticated user to the request.

## Testing

`tests/auth.test.js` covers registration, login, and middleware behavior.

## Security notes

- `.env` holds real secret values (JWT signing key, database URL, session
  cookie secret) for local development. It must never be committed, printed,
  or read by tooling that isn't the running server — including this MCP
  server, which blocks it explicitly (see `src/security/permissions.js` in
  the MCP server, not in this sample project).
