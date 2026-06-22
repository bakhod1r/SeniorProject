# SAST & Security Scanners — Middle Level

> **Roadmap:** [Static Analysis](../README.md) → SAST & Security Scanners

*Sources, sinks, rule packs, SARIF, and the signal-to-noise war that makes or breaks SAST.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — Sources, Sinks, and Tainted Paths](#core-concept-1--sources-sinks-and-tainted-paths)
5. [Core Concept 2 — Pattern Matching vs Dataflow](#core-concept-2--pattern-matching-vs-dataflow)
6. [Core Concept 3 — Writing and Reading Semgrep Rules](#core-concept-3--writing-and-reading-semgrep-rules)
7. [Core Concept 4 — Rule Packs and Severity](#core-concept-4--rule-packs-and-severity)
8. [Core Concept 5 — Signal-to-Noise: The Make-or-Break](#core-concept-5--signal-to-noise-the-make-or-break)
9. [Core Concept 6 — SARIF and Code Scanning](#core-concept-6--sarif-and-code-scanning)
10. [Real-World Examples](#real-world-examples)
11. [Mental Models](#mental-models)
12. [Common Mistakes](#common-mistakes)
13. [Test Yourself](#test-yourself)
14. [Cheat Sheet](#cheat-sheet)
15. [Summary](#summary)
16. [Further Reading](#further-reading)
17. [Related Topics](#related-topics)

---

## Introduction

> Focus: **how findings are actually computed (source→sink), how to author and tune rules, and how to keep a SAST tool from becoming a wall of noise nobody reads.**

At the junior tier you ran a scanner and read its output. Now you need to understand *why* it fired — the source/sink model — and the harder problem that separates teams who get value from SAST from teams who quietly disable it: **noise**. SAST is famously noisy. A tool that reports 4,000 findings on a legacy repo, 95% of them false or irrelevant, will be ignored within a week. Managing signal-to-noise *is* the job.

## Prerequisites

- You've completed the junior tier: you know SAST vs DAST vs SCA, and the bug classes SAST catches.
- You can read YAML and edit a CI configuration file.
- You understand pull requests and diffs.
- Helpful: basic taint-analysis intuition (deep version in [`../08-taint-and-dataflow-analysis/`](../08-taint-and-dataflow-analysis/)).

## Glossary

| Term | Meaning |
|------|---------|
| **Source** | A point where untrusted/attacker-controlled data enters the program. |
| **Sink** | A sensitive operation where untrusted data causes harm. |
| **Taint** | The "untrusted" mark that flows from a source toward sinks. |
| **Sanitizer** | Code that neutralizes taint (escaping, parameterization, validation). |
| **Rule pack / ruleset** | A curated collection of rules (e.g. `p/owasp-top-ten`). |
| **Baseline** | A snapshot of *existing* findings, used to suppress old noise and surface only new issues. |
| **SARIF** | Static Analysis Results Interchange Format — a JSON standard for scanner output. |
| **Triage** | Deciding, per finding: real bug, false positive, or accepted risk. |
| **Diff-aware scan** | Scanning only the changed lines in a PR, not the whole repo. |

## Core Concept 1 — Sources, Sinks, and Tainted Paths

Nearly every injection-class finding is the same story told three ways:

```
SOURCE ───── data flows ─────► SINK
(untrusted input)              (dangerous operation)
        with no SANITIZER in between
```

- **Source**: `request.args.get(...)`, `os.environ` (sometimes), reading a file, a message off a queue, `argv`. Anything an attacker can influence.
- **Sink**: `cursor.execute(sql)`, `os.system(cmd)`, `subprocess(..., shell=True)`, `render_template_string(html)`, `open(path)`, `pickle.loads(data)`.
- **Sanitizer**: parameterized query binding, HTML-escaping, `shlex.quote`, an allow-list validator.

A **finding** is a *tainted path*: data reaches a sink from a source with no sanitizer on the way.

```python
name = request.args.get("name")            # SOURCE: taint enters
greeting = "Hello " + name                 # taint propagates through concat
return render_template_string(greeting)    # SINK: server-side template injection
```

Add a sanitizer and the path is broken:

```python
name = escape(request.args.get("name"))    # SANITIZER neutralizes taint
return render_template(greeting=name)       # no longer tainted at the sink
```

This source→sink→sanitizer vocabulary is the heart of taint analysis. The full theory — interprocedural flow, field sensitivity, taint propagators — is the subject of [`../08-taint-and-dataflow-analysis/`](../08-taint-and-dataflow-analysis/). Here you only need the model well enough to read a finding and judge it.

## Core Concept 2 — Pattern Matching vs Dataflow

SAST tools span a spectrum of how hard they "think":

| Approach | What it does | Example tool | Trade-off |
|----------|--------------|--------------|-----------|
| **Pure pattern** | Matches syntactic shapes | Bandit, gosec | Fast, simple; more false positives, no flow |
| **Pattern + light dataflow** | Patterns plus local taint within a function | Semgrep (`taint` mode) | Good balance, custom rules easy |
| **Deep dataflow** | Whole-program interprocedural taint | CodeQL | Most precise; slower, steeper learning curve |

A **pattern** rule says "flag `md5(`". A **dataflow** rule says "flag a SQL `execute()` *only when* its argument is tainted by a request parameter and not sanitized." The second produces far less noise because it understands flow, not just shape. CodeQL (deep dataflow) is covered in [`../08-taint-and-dataflow-analysis/`](../08-taint-and-dataflow-analysis/); here we'll use Semgrep, which sits in the productive middle.

## Core Concept 3 — Writing and Reading Semgrep Rules

A Semgrep rule is YAML. The simplest is a syntactic pattern:

```yaml
rules:
  - id: python-md5-usage
    languages: [python]
    severity: WARNING
    message: >
      MD5 is cryptographically broken. Use SHA-256, or bcrypt/argon2 for passwords.
    pattern: hashlib.md5(...)
```

`...` is the Semgrep "ellipsis" — it matches any arguments. More powerful is a **taint-mode** rule that tracks source→sink:

```yaml
rules:
  - id: tainted-sql-execute
    languages: [python]
    severity: ERROR
    message: User input flows into a SQL query without parameterization (SQL injection).
    mode: taint
    pattern-sources:
      - pattern: flask.request.args.get(...)
      - pattern: flask.request.form.get(...)
    pattern-sanitizers:
      - pattern: sqlalchemy.text(...)
    pattern-sinks:
      - pattern: $CURSOR.execute(...)
```

This fires only when data from `request.args/form` reaches `cursor.execute()` *without* passing through a sanitizer — dramatically fewer false positives than "flag every `execute()`."

Run a single rule against code:

```bash
semgrep --config ./rules/tainted-sql.yaml ./app
```

```
app/views.py
  tainted-sql-execute
     User input flows into a SQL query without parameterization (SQL injection).
       22┆ cur.execute("SELECT * FROM t WHERE id = '" + request.args.get("id") + "'")
```

Reading this is now mechanical: the **source** is `request.args.get`, the **sink** is `cur.execute`, no sanitizer fired, so the path is tainted.

## Core Concept 4 — Rule Packs and Severity

You don't hand-write every rule. You pull curated **rule packs** and add a handful of your own. Semgrep ships registry packs:

```bash
semgrep --config p/owasp-top-ten ./app   # OWASP-aligned rules
semgrep --config p/security-audit ./app  # broad security pass
semgrep --config p/secrets ./app         # hardcoded-secret detection
```

Findings carry a **severity** — typically `ERROR` / `WARNING` / `INFO`, mappable to Critical/High/Medium/Low. Severity drives policy: you might **block** the build on `ERROR`-level injection findings but only **advise** on `INFO`-level hygiene notes. A single-language tool exposes the same idea:

```bash
gosec -severity high -confidence medium ./...
```

```
[/app/db.go:31] - G201 (CWE-89): SQL string formatting (Confidence: HIGH, Severity: MEDIUM)
  > fmt.Sprintf("SELECT * FROM users WHERE name = '%s'", name)
```

Note **confidence** alongside severity: a high-severity, low-confidence finding deserves a human look, not an automatic block.

## Core Concept 5 — Signal-to-Noise: The Make-or-Break

This is where most SAST programs die. A tool that produces a "wall of 4,000 findings nobody reads" is worse than no tool: it trains the team to ignore security output. Your levers:

**1. Baseline the legacy code.** Don't try to fix everything that exists today. Snapshot current findings as a **baseline**; from now on, only *new* findings are flagged.

```bash
# Establish the baseline once on the main branch
semgrep --config p/security-audit --baseline-commit $(git rev-parse main) ./app
```

**2. Scan only the diff in PRs.** Block on findings *introduced by this change*, not on the whole repo's history.

**3. Tune the rule packs.** Disable rules that don't fit your stack; keep the high-signal ones. A rule that fires 200 times and is always a false positive should be turned off, not endured.

**4. Suppress with justification — never silently.** When a finding is genuinely a false positive, suppress it *inline with a reason*, so the next reader knows it was reviewed:

```python
# nosemgrep: tainted-sql-execute  — query is a constant; `name` is a column allow-list value
cur.execute(f"SELECT * FROM {TABLE} ORDER BY {validated_col}")
```

```python
query = "..."  # nosec B608  — bandit: parameterized below, false match
```

A blanket "ignore all of rule X" is sometimes right; an *unexplained* per-line suppress is a smell. Suppression is a documented engineering decision, not a mute button.

**Key distinction for secrets:** suppression is the *wrong* response to a real leaked secret. See SARIF/secrets below — a leaked credential must be **rotated**, because suppressing it leaves the live secret in git history for anyone to find.

## Core Concept 6 — SARIF and Code Scanning

Raw scanner text doesn't scale across tools and platforms. **SARIF** (Static Analysis Results Interchange Format) is the JSON lingua franca: every serious scanner can emit it, and GitHub/GitLab can ingest it to render findings *inline on the diff*.

```bash
semgrep --config p/security-audit --sarif --output results.sarif ./app
```

A SARIF result, trimmed:

```json
{
  "ruleId": "tainted-sql-execute",
  "level": "error",
  "message": { "text": "User input flows into a SQL query without parameterization." },
  "locations": [{
    "physicalLocation": {
      "artifactLocation": { "uri": "app/views.py" },
      "region": { "startLine": 22, "startColumn": 9 }
    }
  }]
}
```

Upload it to GitHub code scanning and the finding appears as an annotation on the exact line of the PR:

```yaml
# .github/workflows/sast.yml
- run: semgrep --config p/security-audit --sarif -o results.sarif .
- uses: github/codeql-action/upload-sarif@v3
  with: { sarif_file: results.sarif }
```

**Secret scanning is a special case.** A hardcoded secret is not "fix the line" — once committed, it lives in **git history** forever. So secret scanners (`gitleaks`, `trufflehog`, GitHub secret scanning) scan *history*, not just the current tree, and the remediation is always: **rotate the credential first**, then remove it from code, then (if needed) scrub history. See the `secrets-management` skill for the full rotation discipline.

## Real-World Examples

- **The 4,000-finding graveyard.** A team enables `p/security-audit` on a 10-year-old monorepo with no baseline. CI turns red with thousands of findings. Engineers add `# nosemgrep` everywhere to get green, learning to ignore the tool. The fix that should have shipped on day one: baseline + diff-only scanning.
- **The taint-mode rescue.** A pattern rule "flag all `execute()`" produced 600 hits, mostly safe parameterized calls. Rewriting it in taint mode (source = request, sink = execute, sanitizer = bound params) dropped it to 11 — all real.
- **The rotated key.** Gitleaks flags an API token in a commit from six months ago. The team doesn't just delete it — they rotate the token at the provider, *then* clean it up. Deleting alone would have left an attacker a working key.

## Mental Models

- **A finding is a sentence: source → (no sanitizer) → sink.** If you can't name the source and sink, you can't judge the finding.
- **Noise is a security risk.** Every false positive erodes trust in the tool until real findings get ignored too. Tuning is not optional polish; it's load-bearing.
- **Baseline = "stop the bleeding."** You can't boil the legacy ocean. Freeze the past; gate the future.
- **SARIF is the USB-C of scanners.** One format, every tool, every platform's UI.

## Common Mistakes

- **Enabling everything on legacy code with no baseline** → instant wall of findings → tool dies.
- **Blocking the build on low-confidence/INFO findings** → developers route around security.
- **Silent suppression** (`# nosec` with no reason) → the next reader can't tell a reviewed false positive from a hidden bug.
- **Treating a leaked secret as a suppress-able finding** → the live credential stays exploitable in git history.
- **Writing pattern rules where taint rules belong** → high false-positive rates that you then blame on "SAST being noisy."
- **Not emitting SARIF** → findings live in CI logs nobody opens instead of inline on the PR.

## Test Yourself

1. Describe a SQL-injection finding using the words source, sink, and sanitizer.
2. Why does a taint-mode rule usually produce fewer false positives than a pure pattern rule?
3. What problem does a baseline solve, and what problem does diff-aware scanning solve?
4. Write a one-line inline suppression for a genuine false positive — what must it include?
5. Why is suppression the wrong remediation for a hardcoded secret?
6. What is SARIF and why would you emit it instead of reading CI logs?
7. You have a high-severity, low-confidence finding. Block the build, or not? Why?

## Cheat Sheet

```text
FINDING = source ──(no sanitizer)──► sink

Semgrep:
  semgrep --config p/owasp-top-ten .        # OWASP pack
  semgrep --config ./my-rule.yaml .         # custom rule
  semgrep --baseline-commit <sha> .         # only NEW findings
  semgrep --sarif -o out.sarif .            # SARIF for code scanning
  # nosemgrep: rule-id  — REASON              (justified suppression)

Taint rule = mode: taint + pattern-sources / -sinks / -sanitizers  → low noise
Severity drives policy: ERROR = block, WARNING/INFO = advise
Confidence ≠ severity: low-confidence high-severity → human review

Signal-to-noise levers: baseline · diff-only · tune packs · justified suppress
Secrets ≠ suppress → ROTATE (scan git HISTORY, not just HEAD)
```

## Summary

A SAST finding is a tainted path from a **source** (untrusted input) to a **sink** (dangerous operation) with no **sanitizer** between. Tools range from pure pattern matchers (Bandit, gosec) through pattern-plus-dataflow (Semgrep) to deep dataflow (CodeQL). You consume curated rule packs and write a few taint-mode rules of your own; severity and confidence drive whether a finding blocks or advises. The decisive skill is managing signal-to-noise: baseline legacy code, scan only the diff in PRs, tune rule packs, and suppress false positives *with justification* — never silently. Emit SARIF so findings render inline on the PR. Secrets are the exception to suppression: a leaked credential must be rotated, because it lives in git history forever.

## Further Reading

- Semgrep taint-mode and rule-writing documentation; the Semgrep registry.
- SARIF specification (OASIS) and GitHub/GitLab code-scanning guides.
- `gitleaks` and `trufflehog` for git-history secret scanning.
- The `sql-injection-prevention`, `xss-prevention`, `secrets-management`, and `input-validation` skills.

## Related Topics

- [Taint & Dataflow Analysis](../08-taint-and-dataflow-analysis/) — the full theory of source/sink/sanitizer
- [Custom Lint Rules & AST](../07-custom-lint-rules-and-ast/) — authoring rules beyond security packs
- [Static Analysis in CI](../09-static-analysis-in-ci/) — diff scanning, gating, SARIF upload
- [Dependency & License Scanning](../06-dependency-and-license-scanning/) — SCA, the dependency side
- [Static Analysis (section overview)](../README.md)
