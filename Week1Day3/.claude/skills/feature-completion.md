---

name: feature-completion

description: Validate that a feature is complete and ready for a Pull Request.

---

# Feature Completion

## Instructions

1. Read the feature requirements.

2. Review the acceptance criteria.

3. Inspect the files changed.

4. Confirm the implementation follows project rules.

5. Run linting.

6. Run type checking.

7. Run unit and integration tests.

8. Review the final Git diff.

9. Identify unrelated changes.

10. Document risks and limitations.

## Output Format

### Acceptance Criteria

For each criterion, mark:

- Passed

- Failed

- Not verified

### Validation Results

- Linting:

- Type checking:

- Unit tests:

- Integration tests:

### Risks

List remaining technical, security, or operational risks.

### Missing Work

List anything required before the feature is ready.

### Pull Request Summary

Prepare a short summary of the completed change.

## Boundaries

- Do not hide failing checks.

- Do not remove tests to make the build pass.

- Do not merge or push without approval.