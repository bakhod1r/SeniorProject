# Taint & Data-Flow Analysis — Junior Level

> **Roadmap:** [Static Analysis](../README.md) → Taint & Data-Flow Analysis

*Following untrusted data through your program until it hits something dangerous.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — Source, Sanitizer, Sink](#core-concept-1--source-sanitizer-sink)
5. [Core Concept 2 — What "Tainted" Means](#core-concept-2--what-tainted-means)
6. [Core Concept 3 — Following the Flow: A Worked Trace](#core-concept-3--following-the-flow-a-worked-trace)
7. [Core Concept 4 — The Three Big Findings: SQLi, XSS, Command Injection](#core-concept-4--the-three-big-findings-sqli-xss-command-injection)
8. [Core Concept 5 — Why a Tool Can Do This Better Than `grep`](#core-concept-5--why-a-tool-can-do-this-better-than-grep)
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

> Focus: **the one idea that makes data-flow security analysis click — dangerous data flows from a SOURCE, and the bug is when it reaches a SINK without first being cleaned by a SANITIZER.**

Most security bugs are not exotic. They are the same shape over and over: **some data the attacker controls travels through your program and ends up somewhere it can do damage.** A search box value ends up inside a SQL query. A username ends up inside an HTML page. A filename from a URL ends up inside a shell command.

A SAST tool that does *taint analysis* automates the question a careful reviewer asks: *"Where did this value come from, and where is it going?"* It tracks **tainted** (untrusted) values as they move from variable to variable, function to function, and raises an alarm the moment a tainted value arrives at a dangerous operation without being made safe along the way.

This page teaches the intuition with no math. The lattices, fixpoints, and formal frameworks live in [senior.md](senior.md) and [professional.md](professional.md). For now, learn to *see* the flow.

## Prerequisites

- You can read code in at least one language (Python, JavaScript, Go, or Java).
- You know roughly what a **SQL query** and an **HTTP request** are.
- You have heard of **SQL injection** even if you couldn't define it precisely.
- Helpful: you have run a linter or SAST tool once (see [SAST & Security Scanners](../04-sast-security-scanners/)).

## Glossary

| Term | Meaning |
|------|---------|
| **Taint** | A label meaning "this value came from an untrusted source and hasn't been cleaned." |
| **Source** | Where untrusted data *enters* the program (a request parameter, form field, file upload, header). |
| **Sink** | A *dangerous operation* a value flows into (a SQL query, `exec()`, writing to an HTML page). |
| **Sanitizer** | A function that *removes the danger* from a value (escaping, parameterizing, validating). |
| **Propagation** | How taint spreads — if `b = a` and `a` is tainted, `b` becomes tainted too. |
| **Finding** | One reported issue: a tainted value reached a sink without a sanitizer. |
| **Data-flow** | The path a value takes through the program, variable by variable. |
| **False positive** | A reported finding that isn't actually exploitable. |
| **False negative** | A real bug the tool *missed*. |

## Core Concept 1 — Source, Sanitizer, Sink

Three words explain almost all of injection security. Memorize them.

```
  SOURCE  ───────────►  (your code)  ───────────►  SINK
  attacker-controlled                              dangerous operation
  data enters here                                 happens here

                         SANITIZER
                         makes the data safe;
                         if data passes through one,
                         it is no longer tainted
```

- A **source** is a doorway for untrusted data. `request.args["q"]`, `os.Args`, `req.body.name`, an HTTP header, a message off a queue, a row from a database that *another* user wrote.
- A **sink** is a place where data, if attacker-controlled, becomes a weapon. A SQL query string, `os/exec` command, `eval()`, `innerHTML`, a file path, a redirect URL.
- A **sanitizer** is the fix. It transforms the value so it can no longer break out of its intended meaning: a parameterized query placeholder, an HTML escaper, an allow-list validator.

**The rule, in one sentence:** *Tainted data reaching a sink without passing a sanitizer is a vulnerability.* Everything else in this topic is making that rule precise, automatic, and scalable.

## Core Concept 2 — What "Tainted" Means

"Tainted" is just a **sticky label**. Think of untrusted data as wet paint. The moment it enters your program it is wet (tainted). Touch it, copy it, concatenate it — your hands (the new variables) get paint on them too. The paint only dries (becomes safe) when it passes through a sanitizer.

```python
name = request.args["name"]      # tainted  (source)
greeting = "Hello " + name       # tainted  (paint spread by concatenation)
upper = greeting.upper()         # tainted  (still wet — upper() doesn't clean)
safe = html.escape(upper)        # CLEAN    (sanitizer dried the paint)
```

Notice that `upper()` does *not* clean the value — it just changes the letters. Only a function that addresses the *specific danger* counts as a sanitizer. For HTML, that's HTML-escaping. For SQL, it's a parameterized query. Using the wrong sanitizer (e.g. HTML-escaping a value that goes into SQL) leaves the bug wide open.

## Core Concept 3 — Following the Flow: A Worked Trace

Here is the exact reasoning a taint tool performs. A request parameter travels through **two functions** and lands in a SQL query with **no sanitizer**.

```python
# --- web layer ---
@app.route("/user")
def get_user():
    uid = request.args["id"]        # [1] SOURCE: tainted enters here
    return render(lookup(uid))      # [2] tainted passed as argument

# --- service layer ---
def lookup(user_id):
    query = build_query(user_id)    # [3] tainted passed deeper
    return db.execute(query)        # [6] SINK: tainted reaches db.execute  ← BUG

# --- helper ---
def build_query(uid):
    return "SELECT * FROM users WHERE id = " + uid   # [4][5] tainted woven into SQL
```

The tool's trace, step by step:

```
[1] request.args["id"]              tainted    (source matched)
[2] uid → lookup(uid)               tainted    (flows into parameter user_id)
[3] user_id → build_query(user_id)  tainted    (flows into parameter uid)
[4] "SELECT ... = " + uid           tainted    (concatenation propagates taint)
[5] return value of build_query     tainted    (returned tainted string)
[6] db.execute(query)               tainted reaches SINK, no sanitizer → FINDING
```

No sanitizer ever ran. An attacker passing `?id=1 OR 1=1--` reads every user. The fix is a sanitizer between source and sink — here, a parameterized query:

```python
def build_query(uid):
    return ("SELECT * FROM users WHERE id = ?", [uid])   # ? placeholder = sanitizer
```

Now `uid` is passed as a *bound parameter*, not woven into the SQL text. The database treats it as data, never as code. The taint tool sees the value go through the parameterized-query API — a known sanitizer — and the finding disappears.

> If you can do this trace by hand on the example above, you understand the core of every SAST data-flow engine.

## Core Concept 4 — The Three Big Findings: SQLi, XSS, Command Injection

The same source→sink shape produces the three most common injection bugs. Only the sink and the correct sanitizer change.

| Vulnerability | Source (example) | Sink | Correct sanitizer |
|---|---|---|---|
| **SQL injection** | `request.args["id"]` | `db.execute(sql_string)` | Parameterized query / bound params |
| **Cross-site scripting (XSS)** | `request.form["bio"]` | `innerHTML = …` / HTML template without escaping | HTML-context escaping / safe templating |
| **Command injection** | `request.args["file"]` | `os.system(cmd)` / `exec(shell=True)` | Argument arrays (no shell) / strict allow-list |

These map directly to the **`sql-injection-prevention`**, **`xss-prevention`**, and **`input-validation`** skills — read those for the *defensive* side. Taint analysis is the *detective* side: it finds the places where you forgot the defense.

## Core Concept 5 — Why a Tool Can Do This Better Than `grep`

You could `grep` for `db.execute`. But `grep` finds *every* call, including the safe parameterized ones, and tells you nothing about *where the argument came from*. A taint tool is smarter because it tracks the **flow**:

- It knows `db.execute(parameterized_query)` is safe and `db.execute(tainted_string)` is not — same function, different verdict.
- It follows the value *across function calls*, so a sink in `build_query` three calls deep from the source still gets connected.
- It knows a sanitizer in the middle clears the alarm, so it doesn't cry wolf on code you already fixed.

That is the whole value proposition: **`grep` matches text; data-flow analysis matches *journeys*.**

## Real-World Examples

- **The classic SQLi breach.** A login form concatenates the username into a SQL string. Attacker submits `admin'--`, bypasses the password check, owns the account. A taint tool flags `request.form["username"]` → SQL sink on the first scan.
- **Stored XSS in a profile bio.** A user saves `<script>steal()</script>` as their bio; another user views the profile and the script runs in *their* browser. The source (`form["bio"]`) is stored, retrieved later, and rendered without escaping — taint analysis that models the database as a tainted source catches it.
- **Command injection in a "convert file" feature.** A web tool passes a user-supplied filename into `os.system("convert " + name)`. Attacker sends `name=x.png; rm -rf /`. The taint tool connects the URL parameter to the shell sink.
- **The false positive.** A tool flags `db.execute(query)` but a reviewer sees the value was actually validated against a hard-coded allow-list two lines up. The tool didn't recognize that validation as a sanitizer — a *model* problem you'll learn to fix at higher tiers.

## Mental Models

- **Wet paint.** Untrusted data is wet paint; it smears onto everything it touches and only dries at a sanitizer.
- **Airport security.** Sources are the entrances, sinks are the boarding gates, sanitizers are the security checkpoint. The finding is a passenger who reached the gate without going through screening.
- **Follow the money.** Taint analysis is forensic accounting for data: where did this value come from, who handled it, and did it ever get laundered (sanitized) before doing something risky?
- **The verdict depends on the journey, not the destination.** The same sink is safe or dangerous depending on what flowed into it.

## Common Mistakes

- **Thinking the sink is the bug.** `db.execute` is not dangerous — *tainted data reaching it* is. Don't ban the sink; sanitize the source.
- **Mistaking transformation for sanitization.** `.upper()`, `.strip()`, `.trim()` change the text but don't remove the danger. Only a context-appropriate sanitizer counts.
- **Using the wrong sanitizer.** HTML-escaping does nothing against SQL injection. Match the sanitizer to the sink's context.
- **Assuming "it's internal, so it's safe."** Data from your own database can be tainted if another user wrote it (stored XSS). The trust boundary, not the source code boundary, is what matters.
- **Trusting `grep`-style scanning.** Text matching can't tell a safe sink from a dangerous one. Use a tool that follows data flow.

## Test Yourself

1. Define **source**, **sink**, and **sanitizer** in one sentence each.
2. In the worked trace, *which line* is the source and which is the sink? Why is there no sanitizer?
3. Is `name.upper()` a sanitizer? Why or why not?
4. Why is the *same* `db.execute` call sometimes a finding and sometimes safe?
5. A username is saved to a database, then later displayed on a page without escaping. Name the source, the sink, and the vulnerability.
6. Why can a data-flow tool find bugs that `grep` cannot?

## Cheat Sheet

```
THE ONE RULE
  tainted value → reaches sink → no sanitizer in between → VULNERABILITY

THE THREE WORDS
  SOURCE     untrusted data enters   (request param, header, upload, other-user DB row)
  SINK       dangerous operation     (SQL exec, shell, innerHTML, file path, eval)
  SANITIZER  makes data safe         (parameterized query, HTML escape, allow-list)

THE BIG THREE BUGS (same shape, different sink/sanitizer)
  SQL injection      → sink: SQL query   → fix: parameterized query
  XSS                → sink: HTML output → fix: context escaping
  Command injection  → sink: shell call  → fix: arg arrays / allow-list

PAINT METAPHOR
  untrusted = wet paint; it smears on copy/concat; dries only at a sanitizer
```

## Summary

Taint analysis automates one question: *did attacker-controlled data reach a dangerous operation without being cleaned?* Untrusted values enter at **sources**, spread as they're copied and passed around (**propagation**), and become a **finding** if they reach a **sink** without crossing a **sanitizer**. The three classic injection bugs — SQLi, XSS, command injection — are all this same shape with different sinks and different correct fixes. A data-flow tool beats `grep` because it tracks the *journey* of a value, not just where text appears. The rigorous machinery behind this — control-flow graphs, lattices, fixpoints, interprocedural summaries — is what the higher tiers build out.

## Further Reading

- OWASP — *SQL Injection*, *Cross-Site Scripting (XSS)*, and *Command Injection* cheat sheets (the canonical source/sink/sanitizer catalogue).
- The **`sql-injection-prevention`**, **`xss-prevention`**, and **`input-validation`** skills in this repository — the defensive counterparts to detection.
- Semgrep — *Taint mode* tutorial (the gentlest hands-on introduction to source/sink/sanitizer in a real tool).
- [SAST & Security Scanners](../04-sast-security-scanners/) — `junior.md` for the tool-running basics this topic sits underneath.

## Related Topics

- [SAST & Security Scanners](../04-sast-security-scanners/) — taint analysis is the *engine* underneath serious SAST.
- [Custom Lint Rules & AST](../07-custom-lint-rules-and-ast/) — how patterns over code are written, the layer below data-flow.
- [Dynamic Analysis & Sanitizers](../../dynamic-analysis-and-sanitizers/) — the *runtime* counterpart that observes real tainted flows during execution.
- [SQL Injection Prevention, XSS Prevention, Input Validation](../04-sast-security-scanners/) — the defensive skills referenced above.
