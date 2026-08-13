# Security

## Authentication

Protected routes require JWT authentication. Clients must send a valid JSON
Web Token in the `Authorization` header of every request to a protected
route. Tokens are short-lived and must be refreshed periodically using a
refresh token.

## Password Storage

Passwords are hashed before being stored. The application never stores or
logs plaintext passwords at any point, including during account creation or
password reset.

## Environment Variables

Environment variables must never be committed to Git. Secrets such as
database credentials, JWT signing keys, and third-party API keys must be
supplied through environment variables and kept out of version control using
`.gitignore`.

## Authorization

Beyond authentication, certain routes also enforce role-based authorization.
A valid JWT alone does not guarantee access; the user's role is checked
against the permissions required by the route.

## Input Validation

All user input received by Controllers must be validated before being
passed to a Service. This helps prevent injection attacks and malformed data
from reaching the database layer.

## Dependency Security

Project dependencies are scanned regularly for known vulnerabilities, and
security patches should be applied promptly once identified.
