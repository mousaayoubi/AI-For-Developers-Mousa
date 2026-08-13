# Testing

## Unit Tests

Unit tests are written using Vitest. Every Service and Repository module
should have a corresponding unit test file. Unit tests should not make real
network or database calls; external dependencies must be mocked.

## Integration Tests

Integration tests must pass before a Pull Request can be merged. Integration
tests run against a temporary PostgreSQL database created specifically for
the test run, and they verify that Controllers, Services, and Repositories
work correctly together.

## Regression Tests

Every bug fix should include a regression test. The regression test must
fail on the old code and pass once the fix is applied, so that the same bug
cannot silently reappear in the future.

## Continuous Integration

All tests (unit and integration) run automatically in the continuous
integration pipeline on every push and on every Pull Request. A Pull Request
cannot be merged if any test in the pipeline fails.

## Coverage Expectations

New code should be covered by tests wherever practical. Reviewers may
request additional tests during code review if coverage looks insufficient
for the change being made.

## Manual Testing

For UI-facing changes, a short manual test in a local environment is
recommended in addition to automated tests, especially for the Document Q&A
Assistant frontend.
