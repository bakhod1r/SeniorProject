# Security & Performance Review — Middle Level

> **Roadmap:** [Code Review](../README.md) → Security & Performance Review
> *The junior page taught you to be suspicious of user input and slow loops. This page gives you the two disciplines that make that suspicion systematic: trace every trust boundary for security, and separate what you can flag by reading from what only a profiler can prove for performance.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — Security Review Is Data-Flow Review Across Trust Boundaries](#core-concept-1--security-review-is-data-flow-review-across-trust-boundaries)
5. [Core Concept 2 — The OWASP-Aligned Review Checklist](#core-concept-2--the-owasp-aligned-review-checklist)
6. [Core Concept 3 — When to Escalate, and Threat-Modeling Lite for a PR](#core-concept-3--when-to-escalate-and-threat-modeling-lite-for-a-pr)
7. [Core Concept 4 — Performance Review Is the Read-vs-Measure Discipline](#core-concept-4--performance-review-is-the-read-vs-measure-discipline)
8. [Core Concept 5 — The Structural Perf Bugs You Can Flag by Reading](#core-concept-5--the-structural-perf-bugs-you-can-flag-by-reading)
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

> Focus: **Where does untrusted data enter, what does it touch, and which slowness can I see versus which must I measure?**

At the junior level you learned the instinct: distrust input, watch for obvious injection, notice a query inside a loop. Instinct catches the easy cases and misses the structured ones — the authorization check that's present on `GET` but absent on `DELETE`, the SSRF hiding behind a "fetch this URL" feature, the N+1 that only fires when a list has more than one element.

This page replaces instinct with two repeatable procedures. For **security**, you stop scanning for "scary-looking code" and instead trace **trust boundaries**: find every point where data you don't control enters the process, then follow that data to every place it lands. For **performance**, you adopt the **read-vs-measure** rule: flag the algorithmic and structural problems that are *visible in the diff and high-impact*, and refuse to guess about constant-factor micro-optimizations that only a benchmark or profiler can settle. Both disciplines turn a vague "this feels unsafe / slow" into a specific, defensible review comment.

---

## Prerequisites

- **Required:** You've read [junior.md](junior.md) and can name the basic categories (injection, missing authz, the query-in-a-loop smell).
- **Required:** You can read at least one server-side language (the examples use Python, SQL, and Go) and understand how an HTTP request reaches a handler.
- **Helpful:** A working sense of how an ORM issues queries, and what an index does for a `WHERE` clause.
- **Helpful:** You've at least once watched a request go slow in production and wondered why.

---

## Glossary

| Term | Meaning |
|---|---|
| **Trust boundary** | A line in the system where data crosses from a less-trusted zone (the internet, a file, another service) into a more-trusted one (your process). Every boundary is a place input must be validated and authorized. |
| **Data-flow review** | Reading code by following a piece of untrusted data from its entry point to every sink (DB, shell, HTML, log, filesystem) it reaches. |
| **Authorization (authz)** | Deciding whether an *authenticated* principal may perform *this action* on *this specific resource*. Distinct from authentication (who you are). |
| **IDOR** | Insecure Direct Object Reference — using a user-supplied identifier to access an object without checking the caller owns/may access it. Object-level authz failure. |
| **Sink** | A place where data leaves your control and does something dangerous: a SQL string, a shell command, an HTML response, an `open(path)`, an outbound HTTP call. |
| **N+1 query** | One query to fetch a list, then one more query *per element* — a DB/RPC call issued inside a loop. |
| **Hot path** | Code that runs frequently or on a latency-critical request. The only place constant-factor performance is worth arguing about. |
| **Premature optimization** | Restructuring code for speed before any measurement shows it matters — trading clarity for unverified gains. |

---

## Core Concept 1 — Security Review Is Data-Flow Review Across Trust Boundaries

A security review is not "stare at the code until something looks evil." It's a procedure with two steps you can run on any PR:

**Step 1 — Inventory the trust boundaries.** Untrusted data enters a process through a finite, knowable set of doors:

| Boundary | Concrete sources |
|---|---|
| HTTP request | path/query params, request body, headers, cookies, uploaded files |
| Storage | rows read from the DB (poisoned by an earlier write), files on disk |
| Messaging | message-queue payloads, webhook bodies, pub/sub events |
| Environment | env vars, CLI args, config files |
| Other services | responses from internal/external APIs you don't control |

A critical and frequently-missed door is **the database itself**. Data you stored earlier without sanitizing is *still untrusted on the way out* — this is how stored XSS works. "It came from our own DB" is not a trust guarantee.

**Step 2 — Follow the data to its sinks.** For each piece of untrusted input the PR introduces or touches, trace it to where it lands:

```python
@app.post("/reports/{report_id}/export")
def export_report(report_id: str, fmt: str = "csv"):
    # report_id  ← untrusted (URL path)
    # fmt        ← untrusted (query param)
    report = db.query(f"SELECT * FROM reports WHERE id = '{report_id}'")  # SINK: SQL  ← SQLi
    path = f"/tmp/exports/{report_id}.{fmt}"                              # SINK: filesystem ← path traversal
    return FileResponse(path)
```

Two untrusted values, three sinks, two vulnerabilities — and you found them by *following the data*, not by recognizing a pattern. `report_id` flows into a SQL string (injection) and a file path (`../../etc/passwd` traversal). `fmt` flows into the path too. The review comment writes itself: name the source, name the sink, name the fix.

> **Key insight:** Every vulnerability is a story about untrusted data reaching a dangerous sink without being neutralized in between. If you can name the source, the sink, and the missing defense, you've written a precise security comment. If you're just saying "this looks risky," you haven't found the bug yet — keep tracing.

---

## Core Concept 2 — The OWASP-Aligned Review Checklist

Trust-boundary tracing tells you *where* to look. The checklist below tells you *what* goes wrong there. It's ordered roughly by the OWASP Top 10's real-world prevalence — **broken access control is #1 for a reason.** For each item: the smell, a code example, and the flag.

### 1. Broken Access Control / Authorization (the #1 category)

The single most common serious finding. Authentication asks *who are you*; authorization asks *may you do THIS to THIS object*. The classic miss is checking the former and forgetting the latter.

```python
@app.get("/api/invoices/{invoice_id}")
def get_invoice(invoice_id: int, user=Depends(current_user)):  # authenticated ✓
    return db.invoices.get(invoice_id)   # ❌ never checks the invoice belongs to `user`
```

Any logged-in user can read *anyone's* invoice by changing the ID — an **IDOR** / object-level authz failure. The fix scopes the query to the principal:

```python
    inv = db.invoices.get(invoice_id)
    if inv is None or inv.owner_id != user.id:   # object-level authz ✓
        raise HTTPException(404)                  # 404, not 403 — don't leak existence
    return inv
```

**Flag whenever** a handler accepts a resource ID but never checks the caller may act on *that specific resource*; whenever authz lives only on the read path and not on write/delete; whenever a role check is missing on a privileged action (privilege escalation).

### 2. Injection (SQL, command, log, template)

Untrusted data interpreted as code. The fix is almost always the same shape: **separate code from data** so the input can never change the structure.

```python
# ❌ SQL injection — input becomes part of the query
db.execute(f"SELECT * FROM users WHERE email = '{email}'")
# ✓ parameterized — driver sends query and data separately
db.execute("SELECT * FROM users WHERE email = %s", (email,))
```

```python
# ❌ command injection — shell interprets the string
os.system(f"convert {filename} out.png")
# ✓ argument vector, no shell
subprocess.run(["convert", filename, "out.png"], shell=False)
```

The same principle covers **template injection (SSTI)** — never build a template from user input (`render_template_string(user_input)`) — and **log injection**, where a newline in input forges log lines; sanitize or structured-log untrusted fields.

**Flag whenever** input is concatenated into a query, a shell string, a template, or an `eval`. The presence of an f-string or `+` next to `execute`, `system`, `popen`, or `eval` is a near-automatic comment.

### 3. XSS / Output Encoding

Injection's output-side cousin: untrusted data rendered into a response without context-aware escaping, so the browser executes it.

```python
# ❌ reflected/stored XSS
return HTMLResponse(f"<div>Welcome {username}</div>")
# ✓ auto-escaping template encodes for HTML context
return templates.TemplateResponse("welcome.html", {"username": username})
```

Escaping is **context-dependent**: HTML body, HTML attribute, JavaScript, URL, and CSS each need different encoding. A value safe in an HTML body can still break out inside a `<script>` block or an `href`. **Flag** raw string interpolation into markup, `dangerouslySetInnerHTML` / `|safe` / `v-html` on user data, and any disabling of the framework's auto-escaping.

### 4. Input Validation & Canonicalization

Validate at the boundary: type, range, length, allowed set. And **canonicalize before you check** — `../`, URL-encoding (`%2e%2e`), and Unicode normalization let an attacker smuggle a value past a naive filter that runs before decoding. Reject-by-default (allowlist) beats trying to blocklist every bad input.

### 5. Secrets Management & PII

```python
logger.info(f"auth attempt user={email} password={password}")  # ❌ secret in logs
API_KEY = "sk_live_4eC39Hq..."                                  # ❌ hardcoded credential
```

**Flag** any hardcoded credential, key, or token; any secret or PII written to logs or returned in an error message; stack traces or internal details leaking to the client. Secrets belong in a vault/secret manager and config, never in source or logs.

### 6. The Rest of the Boundary Checklist

| Category | The smell | The fix |
|---|---|---|
| **Insecure deserialization** | `pickle.loads`, Java native deserialize, `yaml.load` on untrusted bytes | Use safe formats (JSON), `yaml.safe_load`, signed payloads |
| **SSRF** | server fetches a *user-supplied URL* | Allowlist hosts; block internal IP ranges & cloud metadata (`169.254.169.254`) |
| **Path traversal** | user input in a filesystem path | Canonicalize, then verify the resolved path stays under the base dir |
| **Mass assignment** | binding the whole request body to a model (`User(**body)`) | Bind an explicit allowlist of fields; never accept `is_admin` from the client |
| **Crypto misuse** | hand-rolled crypto, MD5/SHA1 for passwords, ECB mode, `random` for tokens | Vetted libraries; bcrypt/argon2 for passwords; `secrets`/CSPRNG for tokens |
| **Security misconfiguration** | debug mode on, permissive CORS (`*` with credentials), default creds | Secure defaults; least privilege; explicit, narrow config |
| **Missing rate limiting / DoS** | unauthenticated expensive endpoint, no pagination cap, unbounded upload | Rate-limit, cap sizes, paginate, time-out |

> **Key insight:** Most of this checklist reduces to two meta-rules — **separate code from data** (injection, XSS, deserialization, template) and **check the caller against the specific resource** (access control, IDOR, mass assignment). If you internalize those two, you can re-derive half the OWASP list at the review without memorizing it.

---

## Core Concept 3 — When to Escalate, and Threat-Modeling Lite for a PR

A code reviewer is a *defensive net*, not a penetration tester. Know the edge of your competence and route past it.

**Escalate to a security specialist when** the PR touches: authentication/session/token logic, password storage or reset flows, any cryptographic primitive or protocol, a new external trust boundary (a webhook, a public upload endpoint, an SSO integration), payment or PII handling, or a memory-safety-sensitive area in C/C++/unsafe code (buffer handling, raw pointers — that class is best caught with [dynamic analysis & sanitizers](../../dynamic-analysis-and-sanitizers/), not by eye). "I'm not sure this is safe and it's high-stakes" is a *complete* and professional reason to pull in security review. Guessing on auth crypto is how breaches happen.

**Threat-modeling lite** is a 60-second framing you can run on any non-trivial PR — a stripped-down STRIDE:

1. **What new data or capability does this expose?** (a new endpoint, field, file path, outbound call)
2. **Who can reach it, and at what trust level?** (anonymous internet / authenticated user / internal service)
3. **What's the worst thing a malicious caller could do with it?** (read others' data, escalate, exhaust resources)
4. **What stops them in this diff?** If the answer is "nothing visible," that's your comment.

This isn't a formal threat model — it's enough structure to catch the "we never thought about the abuse case" class of bug, which no line-by-line read will surface on its own.

---

## Core Concept 4 — Performance Review Is the Read-vs-Measure Discipline

Performance review has a discipline problem in the opposite direction from security: reviewers either ignore it entirely or over-reach into speculative tuning. The fix is one rule:

> **Flag algorithmic and structural problems you can see in the diff. Defer constant-factor and micro-optimizations to measurement.**

Why the split? Because the two kinds of performance issue have completely different evidence requirements.

**Structural issues are visible and high-impact.** An N+1 query, an accidental O(n²), an unbounded result set — you can *see* these in the code, and their cost scales with data size, so they get worse exactly when it hurts (production scale). You don't need a profiler to know a DB call inside a loop over user-controlled data is a problem; the structure tells you.

**Constant-factor issues are invisible and usually irrelevant.** "Use a `for` loop instead of a list comprehension," "this could avoid one allocation" — these are *guesses* about hotspots, and guesses about performance are almost always wrong. The only honest answer to "is this slow?" at the micro level is a **benchmark or profiler** (see the [performance](../../performance/) section). Two questions kill most bad perf comments before you write them:

- **"Is this actually on a hot path?"** A 10x speedup on code that runs once at startup is worth nothing.
- **"Do I have a measurement, or a hunch?"** If it's a hunch about constant factors, don't block the PR on it.

> **Key insight:** Premature optimization is itself an anti-pattern worth flagging *in the other direction* — if a PR sacrifices readability for an unmeasured micro-gain, the comment is "do you have a benchmark showing this matters? If not, prefer the clearer version." The reviewer's job is to protect against *structural* slowness and against *speculative* complexity — both, not just one.

---

## Core Concept 5 — The Structural Perf Bugs You Can Flag by Reading

These are the patterns that are visible in a diff, high-impact, and fair game for a blocking review comment.

**N+1 queries — a DB/RPC call inside a loop.** The signature bug of ORMs.

```python
# ❌ N+1: 1 query for orders, then 1 per order for its customer
orders = db.orders.all()
for o in orders:
    print(o.id, db.customers.get(o.customer_id).name)   # query inside the loop
```

The fix is to **batch or eager-load** — fetch the related data in one round trip:

```python
# ✓ eager-load: one query joins customers in
orders = db.orders.options(joinedload(Order.customer)).all()
for o in orders:
    print(o.id, o.customer.name)                          # no extra query
```

The same shape applies to microservice calls — an RPC per loop iteration is a *chatty* anti-pattern; batch the call or use a dataloader. **Flag** any `.get`/`.query`/`fetch`/HTTP call whose argument comes from a loop variable.

**Accidental O(n²) — nested iteration or repeated linear scans over the same data.**

```go
// ❌ O(n²): for each item, scan the whole slice to check membership
for _, id := range incoming {
    if contains(existing, id) {   // contains = linear scan; n*n total
        skip(id)
    }
}
```

```go
// ✓ O(n): hash set membership is O(1)
seen := make(map[string]struct{}, len(existing))
for _, id := range existing { seen[id] = struct{}{} }
for _, id := range incoming {
    if _, ok := seen[id]; ok { skip(id) }
}
```

A close relative is **building a string in a loop** with `+=` (O(n²) copying in many languages) — use a `StringBuilder`/`strings.Builder`/`"".join()`. **Flag** nested loops over the same collection, a `list.index`/`in`/`contains` inside a loop, and string concatenation in a loop.

**Unbounded / unpaginated queries.** `SELECT * FROM events` with no `LIMIT` works in dev with 100 rows and falls over with 10M. **Flag** any list endpoint or query with no pagination and no cap.

**Missing indexes.** A `WHERE` or `JOIN` on an unindexed column is a full table scan that degrades linearly with table growth.

```sql
-- ❌ filters on a column with no index → full scan as the table grows
SELECT * FROM orders WHERE customer_email = 'a@b.com';
-- ✓ add the index (and confirm with EXPLAIN)
CREATE INDEX idx_orders_customer_email ON orders (customer_email);
```

You can *flag* the likely missing index by reading, then **confirm with `EXPLAIN`** — that's the read-then-measure handoff in miniature.

**Blocking I/O in a hot path, loading whole datasets into memory, allocation in hot loops.** A synchronous network/disk call on a request thread, reading a multi-GB file into a list instead of streaming it, or allocating inside a tight loop are all structurally visible. The first two are nearly always worth flagging; the third (allocation) edges toward measurement — flag it only when it's plainly in a hot loop and obviously avoidable.

---

## Real-World Examples

**Example 1 — The IDOR that shipped (broken access control).** A SaaS app's "download invoice PDF" endpoint took `/invoices/{id}/pdf`, authenticated the session, and streamed the file. No ownership check. A customer noticed sequential IDs and scripted a download of every invoice in the system — every other customer's billing data. The PR had passed review because the reviewer saw `Depends(current_user)` and stopped: *authentication was present, authorization was absent.* The one-line fix (`if inv.org_id != user.org_id: 404`) would have been obvious to anyone tracing "what stops user A from reading user B's object?" This is why access control sits at #1 — it's easy to write, easy to forget, and catastrophic.

**Example 2 — The SQLi behind an ORM (injection).** A team used an ORM everywhere and assumed they were safe — until a "flexible search" feature needed a dynamic `ORDER BY`, which the ORM didn't parameterize, so a developer dropped to `db.execute(f"... ORDER BY {sort_col} {direction}")`. `sort_col` came straight from a query param. ORMs parameterize *values*, not *identifiers*, so this was a live injection point. The reviewer's lesson: "we use an ORM" is not a blanket defense; trace the one raw query, because that's where the bug always is.

**Example 3 — The N+1 that 100x'd a page (performance, structural).** A dashboard listing 200 projects rendered each project's owner name via `project.owner.name` — lazy-loaded, so one query became 201. P95 page load was 4 seconds. The fix was a single `joinedload`, dropping it to one query and ~40ms. The reviewer who later caught the pattern didn't profile anything — the DB-call-per-loop-iteration was visible in the template. Structural, visible, high-impact: a textbook read-time catch.

**Example 4 — The O(n²) dedup (performance, structural).** A nightly job reconciled two lists of ~50k records each with a nested loop and a linear `in` check — 2.5 billion comparisons, turning a should-be-seconds job into 40 minutes and occasionally timing out. Swapping the inner scan for a set lookup made it O(n) and sub-second. No benchmark needed to flag it: nested iteration over same-order-of-magnitude collections is a structural red flag on sight.

**Example 5 — The micro-optimization that wasn't (read-vs-measure, the other direction).** A reviewer asked an author to replace clear list comprehensions with manual loops "for speed" across a data-transform module, hurting readability. The author benchmarked: the code ran once per import on a 12-element list — total time, microseconds. The "optimization" was pure speculation on a cold path. The right review outcome was the reverse comment: *keep the readable version; there's no measurement showing this matters.* Premature optimization is a flaggable smell too.

---

## Mental Models

- **Untrusted data is a dye you trace through the pipes.** Inject dye at every boundary (HTTP, files, queues, the DB on read), then watch where it comes out — SQL, shell, HTML, filesystem, logs. A vulnerability is dye reaching a sink un-neutralized. You don't hunt for "bad code"; you follow the dye.

- **Authentication is the ID check at the door; authorization is the bouncer at every room.** Most access-control bugs are a valid ID accepted at the entrance with no one checking whether you're allowed in *this specific room* with *this specific object*. Ask, on every handler: "what stops user A from acting on user B's resource?"

- **Two meta-rules generate the OWASP list.** *Separate code from data* covers injection/XSS/SSTI/deserialization. *Check the caller against the specific resource* covers access control/IDOR/mass assignment. Memorize the two rules, re-derive the checklist.

- **Performance has two leagues, and they play by different rules.** Structural (algorithmic, visible, scales with data) you may flag by reading. Constant-factor (micro, invisible, fixed cost) you may only flag with a measurement. Mixing the leagues — blocking a PR on an unmeasured micro-tweak, or shrugging at an N+1 — is the core review error.

- **"Is it on a hot path?" is the performance equivalent of "what's the threat model?"** Both questions force you to check that the thing you're worried about can actually hurt before you spend the team's time on it.

---

## Common Mistakes

1. **Checking authentication and calling it authorization.** Seeing a logged-in user is not seeing that *this* user may touch *this* object. The IDOR class lives entirely in this gap. Always ask the object-level question.

2. **Trusting data because "it came from our database."** Stored data is still untrusted on read — that's the whole stored-XSS / second-order-injection class. Encode on output regardless of source.

3. **Assuming an ORM makes you injection-proof.** ORMs parameterize values but not identifiers, and every codebase has the one raw query for the case the ORM couldn't express. Find that query and check it.

4. **Returning 403 (or a detailed error) when 404 is safer.** Confirming a resource *exists* but you can't see it leaks information. For object-level authz failures, prefer 404. And never return stack traces or internal detail to the client.

5. **Blocklisting bad input instead of allowlisting good input, and validating before canonicalizing.** Blocklists are bypassable; `%2e%2e` and Unicode tricks defeat filters that run before decoding. Canonicalize, then allowlist.

6. **Blocking a PR on speculative micro-optimization.** "This could be faster" without a benchmark and without confirming it's on a hot path is noise — and it trades away readability for nothing. Demand a measurement or let it go.

7. **Ignoring performance entirely because "we'll optimize later."** The *structural* bugs (N+1, O(n²), unbounded queries) are cheap to fix in review and brutally expensive after they're load-bearing in production. These are not "later" problems.

8. **Reviewing crypto/auth by eye and approving it.** This is past most reviewers' competence and the stakes are highest. Escalate to a specialist; that's the senior move, not a failure.

---

## Test Yourself

1. You're reviewing an endpoint `GET /api/teams/{team_id}/members`. It uses `Depends(current_user)`. What single question must you ask before approving, and what's the bug if the answer is "nothing"?
2. A developer says "we use an ORM so we're safe from SQL injection." Why is this not a complete defense, and where do you look?
3. Data is read *from your own database* and rendered into an HTML page. Is encoding still required? Why or why not?
4. A reviewer asks an author to replace a list comprehension with a manual loop "for performance." What two questions should settle whether this comment is valid?
5. You see `for o in orders: db.customers.get(o.customer_id)`. Name the anti-pattern and the fix. Do you need a profiler to flag it?
6. A PR adds a server feature that fetches a user-supplied URL and returns the response. What vulnerability class is this, and what's the minimum defense?
7. When is "I'm not confident this is safe" a sufficient reason to *not* approve a PR yourself?

<details>
<summary>Answers</summary>

1. Ask: **"what stops user A from reading team B's members?"** If there's no check that `team_id` belongs to (or is visible to) `current_user`, it's a **broken access control / IDOR** bug — authentication is present, object-level authorization is absent.
2. ORMs parameterize *values* but not *identifiers* (column/table names, `ORDER BY`), and most codebases drop to a raw query for cases the ORM can't express. **Look for the one raw/`execute`/string-built query** — that's where injection lives.
3. **Yes, encoding is still required.** Data is untrusted regardless of source; an attacker may have stored a malicious value earlier (stored XSS / second-order injection). Encode for the output context every time.
4. **(a) Is this code on a hot path?** and **(b) Is there a benchmark showing the change matters?** If it runs rarely or there's no measurement, the comment is invalid — it's speculative micro-optimization trading away readability.
5. **N+1 query** — a DB call inside a loop. Fix: **batch/eager-load** (e.g. `joinedload`) so related data comes in one round trip. **No profiler needed** — it's structural and visible in the diff.
6. **SSRF (Server-Side Request Forgery).** Minimum defense: **allowlist permitted hosts/schemes and block internal IP ranges and cloud metadata endpoints** (e.g. `169.254.169.254`).
7. When the PR touches **high-stakes, specialist territory** — auth/session/token logic, cryptography, a new external trust boundary, payments/PII. Escalating to a security specialist is the professional move; guessing is not.

</details>

---

## Cheat Sheet

```
SECURITY — TRACE THE TRUST BOUNDARIES
  1. Inventory entry points:  HTTP params/body/headers/cookies/files,
                              queue/webhook payloads, env/args, the DB on read,
                              other services' responses
  2. Follow each untrusted value to its SINK:
        SQL  shell  HTML  filesystem  outbound-HTTP  log  deserialize
  3. At each sink ask: was the data neutralized in between?

OWASP CHECKLIST (by prevalence)
  #1 Access control   may THIS caller act on THIS object? (IDOR / privesc)
     Injection        separate code from data → parameterize / argv / safe template
     XSS              context-aware output encoding; no raw interpolation into markup
     Validation       canonicalize THEN allowlist (beware %2e%2e, unicode)
     Secrets/PII      no hardcoded creds; never log secrets; no detail in errors
     Deserialization  no pickle/yaml.load on untrusted bytes
     SSRF             allowlist hosts; block internal IPs + 169.254.169.254
     Path traversal   resolve path, verify it stays under base dir
     Mass assignment  bind explicit field allowlist; never trust is_admin from client
     Crypto           vetted libs; bcrypt/argon2; CSPRNG; no ECB/MD5/own-crypto
     Misconfig        secure defaults; narrow CORS; no debug in prod
     Rate limit/DoS   cap size, paginate, throttle, time-out

  ESCALATE to security: auth/session/tokens, crypto, new trust boundary,
                        payments/PII, memory-safety (use sanitizers)

PERFORMANCE — READ vs MEASURE
  FLAG by reading (structural, scales with data):
     N+1 query / RPC-in-loop      → batch / eager-load / dataloader
     accidental O(n²)             → hash set/map; nested-loop & in-loop scans
     string build in loop         → StringBuilder / join
     unbounded/unpaginated query  → add LIMIT + pagination
     missing index on WHERE/JOIN  → add index, confirm with EXPLAIN
     blocking I/O on hot path     → async / move off request thread
     whole dataset into memory    → stream / paginate
  DON'T flag without a measurement (constant-factor, micro):
     "this could avoid an allocation", "loop vs comprehension"
     → first ask: on a hot path? have a benchmark/profile?
  Premature optimization is ALSO a smell: clarity lost for unmeasured speed.
```

---

## Summary

- **Security review is data-flow review.** Inventory every trust boundary (HTTP, files, queues, env, other services, and the DB on read), then follow each untrusted value to its sink (SQL, shell, HTML, filesystem, log). A vulnerability is untrusted data reaching a dangerous sink un-neutralized — name the source, sink, and missing defense.
- **The OWASP checklist is led by broken access control** — authentication is not authorization; always ask whether *this* caller may act on *this specific object* (IDOR). The rest reduces to two meta-rules: separate code from data, and check the caller against the resource.
- **Know your edge and escalate.** Auth, crypto, new trust boundaries, payments/PII, and memory-safety code belong with a security specialist (or sanitizers/dynamic analysis). "I'm not sure and it's high-stakes" is a complete reason not to approve yourself. A 60-second threat-model-lite catches the abuse-case class.
- **Performance review is the read-vs-measure discipline.** Flag structural, visible, data-scaling problems by reading — N+1 queries, accidental O(n²), unbounded queries, missing indexes, blocking I/O. Refuse to block on constant-factor micro-optimizations without a benchmark, and treat premature optimization as its own smell.
- The unifying habit across both halves: **turn a vague feeling into a specific, evidence-backed comment** — a named source-to-sink path, or a structural pattern with a clear fix — and defer everything that genuinely requires measurement to measurement.

---

## Further Reading

- **OWASP Top 10** — the canonical list of web application risk categories, ordered by prevalence; the backbone of the security checklist above.
- **OWASP Code Review Guide** — a reviewer-focused companion that walks through finding each vulnerability class in source.
- **OWASP Application Security Verification Standard (ASVS)** — a graded, checkable requirements list for when "looks fine" needs to become "verified against L1/L2/L3."
- **OWASP Cheat Sheet Series** — concise, per-topic defenses (SQL injection, XSS, deserialization, SSRF, mass assignment) you can link directly in review comments.
- *Systems Performance* (Brendan Gregg) — the discipline of measuring rather than guessing; the source-of-truth for the read-vs-measure rule and profiling methodology.
- [senior.md](senior.md) — secure-by-design review, automating the checklist (SAST/DAST/dependency scanning in CI), and leading performance with profiles and load tests rather than reading alone.

---

## Related Topics

- [03 — Correctness & Design Review](../03-correctness-and-design-review/middle.md) — the correctness layer security and performance sit on top of; many vulns start as plain logic bugs.
- [01 — What to Look For & In What Order](../01-what-to-look-for-and-order/middle.md) — where security and performance fall in the review priority order.
- [Security](../../../../Security/) — the deep treatment of each vulnerability class the checklist names.
- [Performance](../../performance/) — benchmarking and profiling: the measurement half of the read-vs-measure rule.
- [Dynamic Analysis & Sanitizers](../../dynamic-analysis-and-sanitizers/) — catching memory-safety bug classes that reading-by-eye cannot.
