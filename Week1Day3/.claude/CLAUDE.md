# Project Overview

This is a web-based notification system built with  React, TailwindCSS, Node and PostgreSQL.

# Architecture

- Controllers handle HTTP requests and responses.

- Services contain business logic.

- Repositories contain database queries.

- Middleware handles authentication and validation.

# Architecture rules

- Users must be authenticated before making a follow request.

- Notification is web-based only and not email.

# Repository Structure 

/src
- Controllers
- Services
- Middleware
- Repositories
- routes
- tests
/public

# Development Commands

- Install dependencies: npm install

- Start development server: npm run dev

- Run linting: npm run lint

- Run type checking: npm run typecheck

- Run tests: npm test

# Coding Rules

- Follow existing naming and folder conventions.

- Do not use `any` without an explanation.

- Do not add new dependencies without approval.

- Prefer small changes over broad refactoring.

# Testing Rules

- Add tests for every new behaviour.

- Bug fixes must include a regression test.

- Include successful and failure scenarios.

- Do not change existing tests unless the requirement changes.

# Security Rules

- Validate all user-controlled input.

- Never expose stack traces to clients.

- Never store secrets in source code.

- Confirm authorisation before protected actions.

# Workflow

Before modifying code:

1. Inspect the relevant files.

2. Explain the current implementation.

3. Propose a plan.

4. List risks and assumptions.

5. Wait for approval.

Before completing a task:

1. Run linting.

2. Run type checking.

3. Run tests.

4. Review the final diff.

5. Confirm all acceptance criteria.

# Git workflow

- Add untracked files to git

- Commit using meanigful message

- Push to branch before master after human approval

# Definition of done

A feature is complete when:

- Acceptance criteria are satisfied

- Linting passes

- Type checking passes

- Required tests pass

- Security risks have been reviewed

- Documentation is updated

- The final Git diff contains no unrelated changes