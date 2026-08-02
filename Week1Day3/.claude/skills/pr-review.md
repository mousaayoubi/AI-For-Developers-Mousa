---

name: pre-review

description: Review the current Pull Request for correctness, security, architecture, maintainability, and tests.

---

# Pull Request Review

## Instructions

1. Read the feature requirements and acceptance criteria.

2. Review the complete Git diff.

3. Identify all files changed.

4. Check whether the implementation satisfies the requirements.

5. Identify unrelated changes.

6. Review input validation and authorisation.

7. Check whether the project architecture has been followed.

8. Review test coverage.

9. Identify unnecessary dependencies or complexity.

10. Produce a structured review.

## Output Format

### Summary

Briefly explain what the change does.

### Critical Issues

List problems that may cause security risks, data loss, incorrect behaviour, or production failure.

### Important Issues

List architecture, maintainability, or testing problems that should be resolved.

### Optional Improvements

List non-blocking improvements.

### Missing Tests

List behaviours that are not adequately tested.

### Final Recommendation

Choose one:

- Ready for human review

- Changes required

- High-risk change requiring senior review

## Boundaries

- Do not modify files.

- Do not approve or merge the Pull Request.

- Do not assume passing tests prove the implementation is correct.