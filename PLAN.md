# Implementation Plan: `/security-review` Feature for Gemini CLI

## Research Summary: How Claude Code Security Review Works

### Architecture Overview

Claude Code's security review operates at two levels:

1. **`/security-review` Slash Command** (interactive CLI) — A markdown-based command at `.claude/commands/security-review.md` that submits a security-focused prompt to the model. It uses git diff to gather changes, asks the model to analyze them through a 3-phase methodology, and outputs a markdown report.

2. **GitHub Action** (`claude-code-security-review`) — A Python-based CI pipeline (`github_action_audit.py`) that orchestrates: PR data fetching → prompt assembly (`prompts.py`) → Claude Code invocation → false positive filtering (`findings_filter.py` + `claude_api_client.py`) → PR comment posting.

### Key Technical Details

**The 3-Phase Analysis Methodology:**
- **Phase 1 — Repository Context Research**: Identifies existing security frameworks, secure coding patterns, sanitization approaches, and the project's security model.
- **Phase 2 — Comparative Analysis**: Compares new code against existing patterns, identifies deviations from secure practices, flags new attack surfaces.
- **Phase 3 — Vulnerability Assessment**: Examines modified files for security implications, traces data flow from user inputs to sensitive operations, identifies injection points.

**Multi-Stage False Positive Filtering:**
1. Hard exclusions (DoS, rate limiting, resource exhaustion, etc.)
2. AI-powered re-examination of each finding via parallel sub-tasks
3. Confidence scoring (1-10 scale, only findings ≥ 8 pass)
4. Custom organization-specific filtering rules

**Output Format:**
- Slash command → Markdown report with severity, category, description, exploit scenario, recommendation
- GitHub Action → Structured JSON with `findings[]` array and `analysis_summary`

**Vulnerability Categories Covered:**
- Input Validation (SQL/command/XXE/template/NoSQL injection, path traversal)
- Authentication & Authorization (bypass, privilege escalation, session flaws, JWT)
- Crypto & Secrets (hardcoded keys, weak algorithms, key management)
- Injection & Code Execution (deserialization RCE, pickle/YAML/eval injection, XSS)
- Data Exposure (sensitive logging, PII violations, API leakage)

---

## Implementation Plan for Gemini CLI

### Approach: Two-Tier Implementation

We will implement the `/security-review` feature as:

1. **A built-in TOML slash command** (`.gemini/commands/security-review.toml`) — The quick, interactive `/security-review` command that users invoke in the CLI. This is the primary user-facing feature.

2. **A built-in skill** (`packages/core/src/skills/builtin/security-review/SKILL.md`) — A more comprehensive security review capability that the model can activate when deeper analysis is needed, with bundled scripts for structured output.

### Step 1: Create the `/security-review` Slash Command

**File**: `.gemini/commands/security-review.toml`

This TOML file defines a slash command that:
- Accepts `{{args}}` for optional target specification (e.g., `staged`, a PR number, a file path, or empty for all pending changes)
- Gathers context via git commands (`git diff`, `git status`, `git log`)
- Submits a comprehensive security-focused prompt to the Gemini model
- The prompt instructs the model to follow the 3-phase analysis methodology

**Prompt Template Design:**

```toml
description = "Performs a focused security review of code changes, identifying HIGH-CONFIDENCE vulnerabilities with real exploitation potential."
prompt = """
You are a senior security engineer conducting a focused security review.

## Target
{{args}}

## Step 1: Gather Changes

Based on the target:
- If target is empty or 'staged': Run `git diff --staged` and `git status`
- If target is a number: Run `gh pr diff {{args}}` and `gh pr view {{args}}`
- Otherwise: Run `git diff {{args}}`

## Step 2: Security Analysis

Perform a 3-phase security analysis:

### Phase 1 — Repository Context Research
- Identify existing security frameworks and patterns in the codebase
- Look for established sanitization and validation patterns
- Understand the project's security model and trust boundaries

### Phase 2 — Comparative Analysis
- Compare new code against existing secure coding patterns
- Identify deviations from established security practices
- Flag new attack surfaces introduced by the changes

### Phase 3 — Vulnerability Assessment
Examine all changed files for these vulnerability categories:

**Input Validation**: SQL injection, command injection, XXE, template injection, NoSQL injection, path traversal
**Authentication & Authorization**: Bypass logic, privilege escalation, session flaws, JWT vulnerabilities
**Crypto & Secrets**: Hardcoded API keys/passwords/tokens, weak algorithms, improper key storage
**Injection & Code Execution**: Deserialization RCE, pickle/YAML injection, eval injection, XSS (reflected/stored/DOM)
**Data Exposure**: Sensitive data logging, PII violations, API endpoint leakage, debug info exposure

For each file, trace data flow from user inputs to sensitive operations.

## Step 3: False Positive Filtering

For each potential finding, critically evaluate:
- Is this >80% likely to be actually exploitable?
- Does the codebase already have mitigations in place?
- Is this a real security risk, not just a code quality issue?

**DO NOT report:**
- Denial of Service (DoS) vulnerabilities
- Rate limiting concerns
- Memory/CPU exhaustion
- Generic input validation without proven security impact
- Environment variables and CLI flags (treated as trusted)
- Client-side permission checks (server responsibility)
- Regex injection / ReDoS
- Test-only files
- Log spoofing
- Documentation files

## Step 4: Report Findings

For each validated finding (confidence ≥ 8/10), output:

### Finding N: [CATEGORY]: [file_path]:[line_number]

- **Severity**: HIGH | MEDIUM
- **Confidence**: [8-10]/10
- **Description**: [What the vulnerability is]
- **Exploit Scenario**: [How an attacker could exploit this]
- **Recommendation**: [Specific remediation steps]

## Step 5: Summary

After all findings (or if none found), provide:

### Security Review Summary
- Files reviewed: [count]
- HIGH severity: [count]
- MEDIUM severity: [count]
- Status: [PASS - No security issues found | FINDINGS - N issues require attention]

If no security vulnerabilities were found, state: "No high-confidence security vulnerabilities identified in the reviewed changes."

**CRITICAL**: Minimize false positives. It is better to miss theoretical issues than to flood the report with noise. Only report findings a senior security engineer would confidently raise in a PR review.
"""
```

### Step 2: Create the Built-in Security Review Skill

**Directory**: `packages/core/src/skills/builtin/security-review/`

**File**: `packages/core/src/skills/builtin/security-review/SKILL.md`

This skill provides the model with deep security review capabilities that can be activated automatically when relevant. It includes:
- The same 3-phase methodology
- Additional context about common vulnerability patterns
- Instructions for using tools (grep, glob, read-file) to trace data flows
- A bundled reference file with vulnerability pattern examples

**File**: `packages/core/src/skills/builtin/security-review/references/vulnerability-patterns.md`

A reference document containing:
- Common vulnerability patterns by language (TypeScript/JavaScript, Python, Go, etc.)
- Known-safe patterns that should not be flagged
- Example exploit scenarios for each vulnerability category

### Step 3: Create Security Review Scripts (Optional Enhancement)

**File**: `packages/core/src/skills/builtin/security-review/scripts/parse-diff.sh`

A helper script that:
- Parses git diff output into a structured format
- Extracts changed file paths and line ranges
- Identifies which files are new vs modified
- Filters out non-code files (images, generated files, lockfiles)

### Step 4: Integration Testing

**File**: `packages/core/src/skills/builtin/security-review/SKILL.test.ts` (or appropriate test location)

- Test that the skill loads correctly via SkillManager
- Test that the TOML command parses correctly via FileCommandLoader
- Test prompt generation with various `{{args}}` values

---

## Detailed File Changes

### New Files

| File | Purpose |
|------|---------|
| `.gemini/commands/security-review.toml` | User-facing `/security-review` slash command |
| `packages/core/src/skills/builtin/security-review/SKILL.md` | Built-in skill for deep security analysis |
| `packages/core/src/skills/builtin/security-review/references/vulnerability-patterns.md` | Reference patterns for vulnerability detection |
| `packages/core/src/skills/builtin/security-review/scripts/parse-diff.sh` | Helper script for diff parsing |

### No Existing Files Modified

The implementation leverages existing infrastructure:
- **FileCommandLoader** already discovers `.toml` commands from `.gemini/commands/`
- **SkillManager.discoverBuiltinSkills()** already loads from `packages/core/src/skills/builtin/`
- **ActivateSkillTool** already handles skill activation and resource loading
- No changes to core TypeScript source code required

---

## Architecture Decision: Why TOML Command + Built-in Skill

1. **Zero code changes to core**: Both mechanisms (TOML commands and built-in skills) are fully supported by existing infrastructure. The `/security-review` TOML command is discovered by `FileCommandLoader`, and the built-in skill is discovered by `SkillManager.discoverBuiltinSkills()`.

2. **Consistent with existing patterns**: The project already has `.gemini/commands/*.toml` files (e.g., `review-and-fix.toml`, `review-frontend.toml`) and `.gemini/skills/` (e.g., `code-reviewer/`). We follow the exact same patterns.

3. **Customizable**: Users can override the built-in behavior by creating their own `.gemini/commands/security-review.toml` in their project or user directory (higher precedence overrides lower).

4. **Separation of concerns**: The TOML command provides the quick interactive entry point, while the skill provides deeper capabilities the model can leverage during extended conversations.

---

## Implementation Order

1. **`.gemini/commands/security-review.toml`** — The primary deliverable. Immediately usable as `/security-review` in the CLI.
2. **`packages/core/src/skills/builtin/security-review/SKILL.md`** — The built-in skill for deeper analysis.
3. **`packages/core/src/skills/builtin/security-review/references/vulnerability-patterns.md`** — Reference material.
4. **`packages/core/src/skills/builtin/security-review/scripts/parse-diff.sh`** — Helper script.
5. **Tests** — Verify everything loads and works correctly.
