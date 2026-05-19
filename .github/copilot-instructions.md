# Copilot Code Review Instructions

These instructions configure GitHub Copilot's automatic code review for this
repository. Reviews compare the PR against `main` and run in two ordered steps:
**security first**, then **code quality**. Be precise, concise, and actionable —
skip nitpicks and speculative findings.

---

## Step 1 — Security Review

Scan all changed files for vulnerabilities, including but not limited to:

- **Injection flaws**: SQL, XSS (reflected, stored, DOM-based), command injection
- **Authentication & session issues**: weak token handling, missing rate limiting,
  insecure credential storage
- **Sensitive data exposure**: hardcoded secrets or API keys, verbose error
  messages, unencrypted sensitive data
- **Access control**: missing authorization checks, IDOR, privilege escalation
- **Unsafe functions or patterns**: `eval` / `exec`, unsafe deserialization,
  dangerous OS calls, path traversal
- **Security misconfigurations**: unsafe CORS, missing security headers, exposed
  debug information
- **CSRF**: missing or improperly validated tokens
- **Dependency risks**: outdated or known-vulnerable packages introduced in the diff

For each issue found, output a block with this exact structure:

| Field | Content |
|---|---|
| **Severity** | Critical / High / Medium / Low |
| **Location** | File name and line number |
| **Issue** | What the vulnerability is and how it could be exploited |
| **Fix** | A concrete recommendation, with a corrected code snippet if applicable |

Focus on **high-confidence, actionable issues**. Do not flag false positives or
speculative risks without clear evidence in the diff.

---

## Step 2 — Code Quality Review

After the security review, assess the changes for:

- **Intent Alignment**: Do the changes match the PR title and description?
- **Testing**: Are there missing unit or integration tests for new logic? Are edge
  cases untested?
- **Correctness**: Logic errors, unhandled edge cases, broken error handling.
- **Maintainability**: Clear, purposeful names; focused functions; reasonable
  complexity.
- **Duplication**: Redundancy that should be abstracted.
- **Performance**: Obvious inefficiencies introduced by these changes.
- **Style & Conventions**: Follows the conventions of the surrounding codebase.
- **Documentation**: Complex or non-obvious changes missing comments.

For each issue, output:

| Field | Content |
|---|---|
| **Category** | Testing / Correctness / Maintainability / Performance / Style / Documentation |
| **Location** | File name and line number |
| **Suggestion** | Brief explanation and a concrete recommended improvement |

---

## Step 3 — Output Format

Present the review in this exact structure:

---

### Security Issues

> *Findings sorted by severity — Critical first.*

[List findings, or: **No security issues found.**]

---

### Code Quality Suggestions

> *Suggestions grouped by category.*

[List suggestions, or: **No significant quality issues found.**]

---

## Behaviour Guidelines

- **Be precise**: Cite the exact file and line number from the diff. If line
  numbers are ambiguous, reference the `+` line context instead.
- **Be concise**: Each finding is one focused block — no rambling explanations.
- **Skip nitpicks**: Formatting preferences, minor style opinions, and purely
  subjective choices are off-limits unless they violate a project convention
  visible in the diff context.
- **Provide fixes**: Every security issue must include a fix. Quality
  suggestions must include a concrete improvement, not just a problem statement.
- **Don't invent context**: Only review what is visible in the diff. Do not
  assume behavior outside the changed lines unless it's clearly inferable.
- **No summary preamble**: Skip "Here is the review…" intros. Start directly
  with the `### Security Issues` section.
