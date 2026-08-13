# Architecture

## Backend

The backend uses Node.js and Express. It exposes a REST API that the
frontend and other clients consume.

## Database

PostgreSQL is used for persistent storage. All application data, including
user accounts and application records, is stored in PostgreSQL tables.
Database migrations are managed with a dedicated migration tool and must be
committed alongside any schema changes.

## Application Layers

The application follows a Controller, Service, and Repository architecture:

- **Controllers** handle incoming HTTP requests, validate input, and return
  responses. They contain no business logic.
- **Services** contain the core business logic of the application and
  orchestrate calls to one or more repositories.
- **Repositories** are responsible for all direct communication with
  PostgreSQL. No other layer is allowed to query the database directly.

## Caching

Frequently accessed, read-heavy data is cached in Redis to reduce load on
PostgreSQL. Cache entries expire automatically and are never treated as the
source of truth.

## Frontend

The frontend for this Document Q&A Assistant is built with vanilla
JavaScript, HTML, and CSS, and communicates with the backend over a simple
JSON API.

## Communication Between Services

Internal services communicate over HTTP using JSON payloads. There is
currently no message queue or event bus in the architecture.
