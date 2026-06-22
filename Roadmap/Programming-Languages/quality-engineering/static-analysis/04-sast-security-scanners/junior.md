# SAST & Security Scanners — Junior Level

> **Roadmap:** [Static Analysis](../README.md) → SAST & Security Scanners

*Finding security bugs in source code before it ever runs.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — What SAST Is](#core-concept-1--what-sast-is)
5. [Core Concept 2 — What SAST Catches Well](#core-concept-2--what-sast-catches-well)
6. [Core Concept 3 — What SAST Cannot Catch](#core-concept-3--what-sast-cannot-catch)
7. [Core Concept 4 — The Tools You'll Meet](#core-concept-4--the-tools-youll-meet)
8. [Core Concept 5 — Running Your First Scan](#core-concept-5--running-your-first-scan)
9. [Real-World Examples](#real-world-examples)
10. [Mental Models](#mental-models)
11. [Common Mistakes](#common-mistakes)
12. [Test Yourself](#test-yourself)
13. [Cheat Sheet](#cheat-sheet)
14. [Summary](#summary)
15. [Further Reading](#further-reading)
16. [Related Topics](#related-topics)

---

## Introduction

> Focus: **understanding what a security scanner reads, what kinds of bugs it can and cannot find, and how to run one on your own code.**

A linter tells you your code is ugly. A type checker tells you your code is inconsistent. A **SAST** tool — Static Application Security Testing — tells you your code is *dangerous*: that an attacker could use it to read your database, steal secrets, or run commands on your server.

"Static" means it reads the source code (or compiled bytecode) **without running it**. That is the opposite of **DAST** (Dynamic Application Security Testing), which pokes a running application from the outside. SAST sees your code; DAST sees your behavior. They find different bugs, and a serious team uses both.

SAST lives early in the development lifecycle — this is called **shift-left**. The idea: a vulnerability caught on your laptop or in a pull request costs minutes to fix; the same vulnerability caught in production after a breach costs your weekend, your customers' data, and possibly your company.

## Prerequisites

- You can read code in at least one language (Python, JavaScript, Go, or Java).
- You have run a command-line tool before (`npm`, `pip`, `go`, `git`).
- You know roughly what a **SQL query** and an **HTTP request** are.
- Helpful: a passing familiarity with the idea that "user input is dangerous."

## Glossary

| Term | Meaning |
|------|---------|
| **SAST** | Static Application Security Testing — scans source/bytecode for security bugs without running it. |
| **DAST** | Dynamic Application Security Testing — tests a *running* app from the outside. |
| **SCA** | Software Composition Analysis — scans your *dependencies* for known vulnerabilities (see topic 06). |
| **Vulnerability** | A flaw an attacker can exploit (e.g. SQL injection). |
| **Finding** | One result a scanner reports — a location plus a rule it matched. |
| **Rule** | A pattern the scanner looks for (e.g. "string concatenation into a SQL query"). |
| **Source** | Where untrusted data enters (a request parameter, a form field). |
| **Sink** | A dangerous operation that data flows into (a SQL query, `exec()`). |
| **False positive** | A finding the scanner reports that is not actually a real bug. |
| **Secret** | A credential — API key, password, token — that must never be in source code. |

## Core Concept 1 — What SAST Is

SAST is a program that reads your code looking for patterns that are known to be dangerous. It never executes your code; it reads it the way a compiler does — as text and structure — and matches it against a library of security rules.

Three categories of automated security tooling exist, and juniors mix them up constantly:

| Tool type | What it scans | Example bug it finds |
|-----------|---------------|----------------------|
| **SAST** | Your own source code | You built a SQL query by gluing strings together |
| **DAST** | Your running application | A login page that accepts `' OR 1=1 --` |
| **SCA** | Your third-party dependencies | You use `log4j 2.14`, which has a known CVE |

This topic is about **SAST**. Dependencies (SCA) get their own treatment in [`../06-dependency-and-license-scanning/`](../06-dependency-and-license-scanning/).

The "shift-left" placement looks like this across the lifecycle:

```
Write code  →  PR / code review  →  CI build  →  Deploy  →  Production
   ▲                ▲                  ▲
   SAST in IDE      SAST on the diff   SAST gate
   (instant)        (blocks merge)     (full repo scan)
```

The further left you catch a bug, the cheaper it is. A SAST finding in your editor costs you 30 seconds. The same flaw exploited in production is an incident.

## Core Concept 2 — What SAST Catches Well

SAST is excellent at **local, code-shaped bugs** — flaws that are visible in the structure of the code itself. The classics:

**SQL injection** — building a query from untrusted input by string concatenation:

```python
# VULNERABLE — user input glued straight into SQL
def get_user(username):
    query = "SELECT * FROM users WHERE name = '" + username + "'"
    return db.execute(query)
```

```python
# FIXED — parameterized query; the driver keeps data and code separate
def get_user(username):
    return db.execute("SELECT * FROM users WHERE name = %s", (username,))
```

**Command injection** — passing input to a shell:

```python
# VULNERABLE
os.system("ping " + host)        # host = "8.8.8.8; rm -rf /"
# FIXED
subprocess.run(["ping", host])   # no shell; host is one argument
```

**Hardcoded secrets** — a credential committed into the repo:

```python
# VULNERABLE — this key is now in git history forever
AWS_SECRET = "AKIAIOSFODNN7EXAMPLE"
# FIXED — read from the environment / a secret manager
AWS_SECRET = os.environ["AWS_SECRET"]
```

**Weak cryptography** — using a broken hash or cipher:

```python
import hashlib
hashlib.md5(password.encode())     # VULNERABLE — MD5 is broken
hashlib.sha256(password.encode())  # better, but for passwords use bcrypt/argon2
```

**Path traversal** — letting input choose a file path so an attacker reads `../../etc/passwd`. **Unsafe deserialization** — calling `pickle.loads()` or Java's `readObject()` on attacker data. These all share one trait: the danger is *right there in the code*.

## Core Concept 3 — What SAST Cannot Catch

This is the most important thing a junior can learn about SAST, and it is the thing tool vendors downplay. **SAST is blind to meaning.** It sees shapes, not intent.

SAST is **bad at**, or completely blind to:

- **Authorization / authentication logic.** "This endpoint lets any logged-in user delete *any* account, not just their own." SAST cannot know that `account_id` should belong to the current user — that is business meaning, not a code pattern.
- **Business-logic flaws.** "You can apply the same discount coupon a thousand times." Perfectly valid-looking code; a logic hole.
- **Anything needing runtime context.** Whether a value is *actually* reachable by an attacker, what a config file holds in production, whether a check upstream already sanitized the data.

```python
# SAST sees nothing wrong here. It is a critical IDOR vulnerability.
@app.route("/account/<account_id>/delete")
def delete_account(account_id):
    db.delete_account(account_id)   # never checks the account is YOURS
```

That code is a textbook **IDOR** (Insecure Direct Object Reference) — and a pure-pattern SAST scanner walks right past it. Rule of thumb: SAST catches *dangerous operations*; it does not catch *missing checks*.

Here's another the scanner can't see — a logic flaw hiding in correct-looking code:

```python
# Looks fine. Lets a user apply the SAME coupon unlimited times. SAST: silent.
def apply_coupon(cart, code):
    discount = lookup_coupon(code)
    cart.total -= discount         # never records that this user already used it
```

Nothing here is a "dangerous pattern" — it's a *missing business rule*. The only tools that catch these are human code review, careful testing, and threat modeling. When someone says "we run SAST, so we're secure," this is the gap they're ignoring.

## Core Concept 4 — The Tools You'll Meet

You don't need to learn all of these. Recognize the names and what *class* each belongs to:

| Tool | Language(s) | Class |
|------|-------------|-------|
| **Semgrep** | Many (polyglot) | Pattern matching + light dataflow; custom rules |
| **CodeQL** | Many | Query-based, deep dataflow (see [`../08-taint-and-dataflow-analysis/`](../08-taint-and-dataflow-analysis/)) |
| **Bandit** | Python | Pattern-based, Python-specific |
| **gosec** | Go | Pattern-based, Go-specific |
| **Brakeman** | Ruby on Rails | Rails-aware |
| **SpotBugs + FindSecBugs** | Java/JVM (bytecode) | Bytecode analysis |
| **Snyk Code** | Many | Commercial, ML-assisted |

As a junior, **Semgrep** is the friendliest to start with: it is free, fast, works on dozens of languages, and its rules are readable. The single-language tools (`bandit`, `gosec`) are great because they come with sensible security rules out of the box for that one language.

## Core Concept 5 — Running Your First Scan

Let's scan a Python project with **Bandit**:

```bash
pip install bandit
bandit -r ./myapp
```

Typical output:

```
>> Issue: [B608:hardcoded_sql_expressions] Possible SQL injection
   vector through string-based query construction.
   Severity: Medium   Confidence: Low
   Location: ./myapp/db.py:14:12
13          username = request.args.get("name")
14          query = "SELECT * FROM users WHERE name = '" + username + "'"
15          return db.execute(query)
```

The same project with **Semgrep** using a community ruleset:

```bash
pip install semgrep
semgrep --config=auto ./myapp
```

```
db.py
   python.lang.security.audit.formatted-sql-query
   Detected SQL string concatenation with a non-literal variable.
        14┆ query = "SELECT * FROM users WHERE name = '" + username + "'"
```

Read every finding as three things: **what rule fired**, **where**, and **why it's dangerous**. Then decide: is it a real bug (fix it), or a false positive (we'll learn to handle those at the next tier)?

A Go project uses **gosec** the same way:

```bash
go install github.com/securego/gosec/v2/cmd/gosec@latest
gosec ./...
```

```
[/app/handler.go:42] - G204 (CWE-78): Subprocess launched with a potential tainted input
  > exec.Command("sh", "-c", "echo "+userInput)
  Severity: HIGH   Confidence: HIGH
```

Notice the parts every scanner shares: a **rule ID** (`G204`), a **CWE** number (a standard catalog of weakness types — `CWE-78` is OS command injection), a **severity**, a **confidence**, and the offending line. Learn to read those five fields and you can read the output of any SAST tool, regardless of vendor.

## Real-World Examples

- **The GitHub secret leak.** A developer commits an AWS key "just to test." Within minutes, bots scanning public GitHub find it and spin up crypto-mining servers on the company's account — a five-figure bill by morning. Secret scanning catches this *before* the push.
- **The Equifax-shaped lesson.** Many famous breaches start with one of the bugs SAST catches: a string-concatenated query, an unpatched dependency, an old deserialization call. None were exotic; all were *boring* bugs that a scanner flags in seconds.
- **The 30-second fix.** A teammate's PR concatenates a filename from a query parameter into `open(path)`. Semgrep flags path traversal on the diff. They change one line. Caught left, cost nothing.

## Mental Models

- **SAST is a spell-checker for security.** It catches misspelled "words" (dangerous patterns) but not bad arguments (logic flaws). A spell-checker won't tell you your essay is wrong, only that "recieve" is misspelled.
- **Source → Sink.** Almost every SAST finding is a story: untrusted data enters somewhere (**source**) and flows into something dangerous (**sink**). SQL injection = (request param) → (SQL query).
- **Shift-left = cheaper.** The cost of a bug grows the further right it escapes. SAST's whole job is to push detection left.

## Common Mistakes

- **Confusing SAST, DAST, and SCA.** They scan different things and find different bugs. SAST = your code; DAST = your running app; SCA = your dependencies.
- **Believing a clean SAST report means "secure."** It means no *known patterns* fired. Authz and logic flaws are invisible to it.
- **Ignoring secret findings as "just a test key."** Once a secret is in git history, deleting the line doesn't help — it's still in history. It must be **rotated**.
- **Drowning in the first run.** A first scan on an old codebase can report thousands of findings. That's normal. Don't panic; triage (next tier).
- **Fixing the scanner instead of the bug** — e.g. renaming a variable to dodge the rule. You silenced the alarm, not the fire.

## Test Yourself

1. In one sentence each, what's the difference between SAST, DAST, and SCA?
2. Why can't SAST catch an authorization bug like "any user can delete any account"?
3. Name three vulnerability classes SAST catches well.
4. A SAST tool flags a hardcoded API key. You delete the line. Are you safe? Why or why not?
5. What do "source" and "sink" mean, and how do they relate to a SQL-injection finding?
6. Why is catching a bug in a pull request cheaper than catching it in production?

## Cheat Sheet

```text
SAST  = scans YOUR CODE, statically (no run)     → injection, secrets, weak crypto
DAST  = scans RUNNING APP from outside           → runtime behavior
SCA   = scans DEPENDENCIES for known CVEs        → topic 06

Catches well : SQLi, command injection, XSS, hardcoded secrets, weak crypto, path traversal
Blind to     : authz/authn logic, business-logic flaws, runtime-only context

Quick scans:
  bandit -r ./app             # Python
  gosec ./...                 # Go
  semgrep --config=auto .     # polyglot

Read a finding as: WHAT rule + WHERE + WHY dangerous → fix or false positive
Secrets: rotate, don't just delete the line.
```

## Summary

SAST reads your source code without running it and matches it against security rules to find dangerous patterns: SQL injection, command injection, XSS, hardcoded secrets, weak crypto, path traversal, unsafe deserialization. It sits early in the lifecycle (shift-left) so bugs are caught cheaply. It is distinct from DAST (runtime) and SCA (dependencies). Its great strength is local, code-shaped bugs; its fundamental blind spot is anything requiring *meaning* — authorization, business logic, runtime context. Start with friendly tools like Semgrep, Bandit, or gosec, read each finding as *what/where/why*, and remember that secrets must be rotated, not just deleted.

## Further Reading

- OWASP Top 10 — the canonical list of the bugs SAST targets.
- Semgrep documentation and the public rule registry.
- Bandit and gosec README files — they list every rule they ship with.
- The `sql-injection-prevention`, `xss-prevention`, `secrets-management`, and `input-validation` skills for the *defensive* side of these bug classes.

## Related Topics

- [Static Analysis (section overview)](../README.md)
- [Taint & Dataflow Analysis](../08-taint-and-dataflow-analysis/) — the source→sink theory behind findings
- [Dependency & License Scanning](../06-dependency-and-license-scanning/) — SCA, the dependency side
- [Custom Lint Rules & AST](../07-custom-lint-rules-and-ast/) — writing your own rules
- [Static Analysis in CI](../09-static-analysis-in-ci/) — running scanners automatically
