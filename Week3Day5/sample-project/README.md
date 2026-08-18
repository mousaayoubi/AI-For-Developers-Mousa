# Sample Project

A small demo Node.js/Express service used as the investigation target for the
Read-Only Repository Agent. It is intentionally tiny: a handful of files
implementing email/password login, JWT-based session verification, and a
mock user data layer.

## Structure

```
src/
  routes/authRoutes.js        HTTP routes: POST /register, /login, /logout, GET /me
  services/authService.js     Password hashing, credential verification, JWT issuing
  middleware/authMiddleware.js Verifies the JWT on protected routes
  repositories/userRepository.js In-memory user storage (find/create)
  config/database.js          Reads DB connection settings from the environment
tests/
  auth.test.js                 Tests covering registration, login, and middleware
```

## Notes

- `.env` holds real secret values for local development and must never be
  committed, printed, or read by tooling that isn't the running server.
