# Security & Performance Review — Senior Level

> **Roadmap:** [Code Review](../README.md) → Security & Performance Review
> *The middle page gave you the categories — SQLi, N+1, the OWASP list. This page is about the reasoning underneath them: how to model the attacker for a specific diff, how to trace untrusted data to a dangerous sink, how to spot an asymptotic regression by reading control flow, and — just as important — where human review stops being reliable and a fuzzer, sanitizer, or benchmark has to take over.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — Threat-Model-Driven Review: Attacker, Boundary, Surface](#core-concept-1--threat-model-driven-review-attacker-boundary-surface)
5. [Core Concept 2 — Data-Flow and Taint Reasoning](#core-concept-2--data-flow-and-taint-reasoning)
6. [Core Concept 3 — Broken Access Control: Authenticated ≠ Authorized](#core-concept-3--broken-access-control-authenticated--authorized)
7. [Core Concept 4 — Injection Beyond SQLi](#core-concept-4--injection-beyond-sqli)
8. [Core Concept 5 — SSRF and Cloud-Metadata Escalation](#core-concept-5--ssrf-and-cloud-metadata-escalation)
9. [Core Concept 6 — Secrets, Crypto, and Authentication Weaknesses](#core-concept-6--secrets-crypto-and-authentication-weaknesses)
10. [Core Concept 7 — Supply Chain: A New Dependency Is New Trust](#core-concept-7--supply-chain-a-new-dependency-is-new-trust)
11. [Core Concept 8 — DoS and Algorithmic-Complexity Attacks](#core-concept-8--dos-and-algorithmic-complexity-attacks)
12. [Core Concept 9 — The Limits of Human Security Review](#core-concept-9--the-limits-of-human-security-review)
13. [Core Concept 10 — Performance: Complexity and the Cost Model](#core-concept-10--performance-complexity-and-the-cost-model)
14. [Core Concept 11 — The Read-vs-Measure Boundary](#core-concept-11--the-read-vs-measure-boundary)
15. [Real-World Examples](#real-world-examples)
16. [Mental Models](#mental-models)
17. [Common Mistakes](#common-mistakes)
18. [Test Yourself](#test-yourself)
19. [Cheat Sheet](#cheat-sheet)
20. [Summary](#summary)
21. [Further Reading](#further-reading)
22. [Related Topics](#related-topics)

---

## Introduction

> Focus: **The reasoning a senior reviewer applies when a diff touches a trust boundary or a hot path — and the discipline of knowing what review can and cannot prove.**

By the middle level you can name the vulnerability classes and recognize the obvious shapes: string-concatenated SQL, an N+1 query, a missing authorization check. That pattern-matching catches the easy 60%. The senior jump is twofold. First, you stop reviewing against a checklist and start reviewing against a **threat model** — for *this specific change*, who is the attacker, what can they already do, what do they want, and which trust boundary does the diff move? The checklist tells you to look for SSRF; the threat model tells you *this* image-fetch endpoint now lets an unauthenticated user make the server issue arbitrary outbound requests, and that the server runs in a VPC with an IAM-bearing metadata endpoint one hop away.

Second, you develop calibrated humility about the medium. A human reading a diff reliably catches **asymptotic and structural** problems — an O(n²) loop, a missing authorization gate, untrusted data reaching `exec`. A human does *not* reliably catch a use-after-free, a constant-factor regression, or whether a path is actually hot. Those need sanitizers, fuzzers, and profilers. The senior reviewer's job is to flag the *risk* they can see by reading, and to *ask for the measurement or the tool* for everything else — rather than guessing, rather than waving it through, and rather than blocking a PR on a micro-optimization that no profile justifies. This page is that reasoning, made explicit.

---

## Prerequisites

- **Required:** You've internalized [middle.md](middle.md) — the OWASP Top 10 by name, what an N+1 query is, parameterized queries, and the basic mechanics of XSS/CSRF.
- **Required:** You can read code in at least one language well enough to trace a value from a request handler through several function calls to where it's used.
- **Helpful:** You've debugged a production incident that was a security or performance failure, and felt the gap between "the code looked fine in review" and what actually happened.
- **Helpful:** A working mental model of Big-O, the memory hierarchy (cache vs RAM vs disk vs network), and roughly how many nanoseconds each costs.

---

## Glossary

| Term | Meaning |
|---|---|
| **Trust boundary** | A line in the system where data or control crosses from a less-trusted zone to a more-trusted one (network→app, app→DB, tenant→tenant). Bugs cluster here. |
| **Attack surface** | The set of inputs, endpoints, and capabilities an attacker can reach. A change *adds* surface when it adds a new reachable input or capability. |
| **Source / Sink** | In taint analysis, a **source** is where untrusted data enters (request body, header, file); a **sink** is a dangerous operation (`exec`, SQL, HTML render, file path). |
| **Sanitizer (taint sense)** | Code that neutralizes tainted data for a *specific* sink (parameterization for SQL, context-aware escaping for HTML). Sanitizing for one sink does not sanitize for another. |
| **IDOR** | Insecure Direct Object Reference — using a client-supplied identifier to access an object without checking the caller owns/may-access it. A broken-access-control subtype. |
| **Confused deputy** | A privileged component tricked into misusing its authority on behalf of a less-privileged caller (the classic SSRF and CSRF shape). |
| **ReDoS** | Regular-expression Denial of Service — a regex whose backtracking is super-linear on crafted input, letting small inputs burn CPU. |
| **Constant-time comparison** | A comparison whose duration doesn't depend on *where* two byte strings first differ, defeating timing side channels on secrets. |
| **Sanitizer (tooling sense)** | A compiler/runtime instrument — ASan, UBSan, TSan, MSan — that detects memory and concurrency errors at run time. (Distinct from the taint sense above.) |
| **Hot path** | Code that runs often enough or on large enough data that its cost dominates. Only profiling proves a path is hot. |

---

## Core Concept 1 — Threat-Model-Driven Review: Attacker, Boundary, Surface

A checklist review asks "does this diff contain a known bad pattern?" A threat-model review asks three questions *of the change itself*:

1. **Who is the attacker, and what can they already do?** An anonymous internet user, an authenticated free-tier customer, a malicious tenant admin, and a compromised internal service are four different threat actors with four different starting capabilities. The same code is safe against one and catastrophic against another.
2. **What trust boundary does this change move or cross?** Does it accept new input from the network? Does it let one tenant's request influence another tenant's data? Does it let user input reach the filesystem, the shell, an internal HTTP client, the database, or a deserializer?
3. **What new attack surface does it introduce?** A new endpoint, a new parameter, a new file upload, a new dependency, a new outbound call — each is a new place an attacker can push.

You don't need a formal STRIDE session per PR. You need the *reflex* to run those three questions against the diff. The discipline is to anchor on the boundary the diff touches and reason outward from the attacker, not inward from a list.

> **Key insight:** A vulnerability is rarely a single bad line — it's an *untrusted input reaching a dangerous operation across a trust boundary with no check in between*. If you train your eye to first locate the boundary the diff moves and then ask "who is on the other side of it," you will find the class of bug that checklists miss: the one nobody had a checklist item for.

Concretely, when a diff adds `GET /api/reports/:id`, the senior reviewer's internal monologue is: *the boundary is network→app; the attacker is any authenticated user; the surface is a new object reference (`:id`); therefore the load-bearing question is "does the handler verify this user may read this report, or does it trust the id?"* That single line of reasoning subsumes IDOR, broken object-level authorization, and the "authenticated ≠ authorized" trap — without any of those words appearing on a checklist.

---

## Core Concept 2 — Data-Flow and Taint Reasoning

Most injection and memory bugs are the same shape: **untrusted source → (no sanitizer) → dangerous sink.** Taint reasoning is the practice of tracing that flow by reading. You mark every value that originates from outside the trust boundary as *tainted*, follow it through assignments and function calls, and ask whether it reaches a sink still tainted.

```python
# Trace the taint. Source is request.args; sink is the os.system shell.
def export(request):
    fmt = request.args["format"]            # ← SOURCE: tainted (attacker-controlled)
    name = sanitize_filename(fmt)           # does this sanitize for THIS sink? (no — wrong sink)
    cmd = f"convert report.pdf out.{name}"  # taint flows into a shell string
    os.system(cmd)                          # ← SINK: shell. Tainted → RCE.
```

The senior move here is not "I see `os.system`, flag it." It's checking whether the *specific* sanitizer on the path neutralizes the *specific* sink. `sanitize_filename` might strip slashes — useless against `; rm -rf /`. **Sanitizing for one sink does not sanitize for another.** Escaping HTML does nothing for SQL; parameterizing SQL does nothing for a shell; validating a filename does nothing for a URL fed to an HTTP client.

Three sub-rules make taint review reliable:

- **Taint is sticky and transitive.** It flows through string concatenation, struct fields, collections, and return values. A function that takes a tainted argument and returns a value derived from it returns tainted data.
- **Sanitization is sink-specific.** Ask "neutralized *for what*?" A value can be clean for the filesystem and filthy for the shell.
- **Validation is not always sanitization.** An allowlist (`format in {"pdf","csv"}`) is a real boundary; a denylist or a "looks reasonable" regex usually is not.

> **Key insight:** The bug is in the *path*, not the source and not the sink alone. A request parameter is fine; `os.system` is fine; the defect is that one reaches the other unsanitized-for-shell. Reviewing means following the data, and the single most common false sense of safety is a sanitizer that's real but aimed at the wrong sink.

This is also exactly where human review hits its first hard limit: taint tracing by eye works for paths a few hops long within a diff, but it does *not* scale to whole-program flows across modules and async boundaries. That is the job of static taint analysis (SAST) — see [Core Concept 9](#core-concept-9--the-limits-of-human-security-review) and the [Static Analysis](../../static-analysis/) section.

---

## Core Concept 3 — Broken Access Control: Authenticated ≠ Authorized

Broken access control sits at the top of the OWASP Top 10 because it's the failure that pattern-matching reviewers miss most: the code *looks* correct, it has a login check, it returns the right shape — and it hands tenant A tenant B's data. The root confusion is treating **authentication** (who are you) as if it were **authorization** (may you do *this* to *this object*).

```python
@require_login                              # authentication ✓  — you are SOMEONE
@app.route("/api/invoices/<invoice_id>")
def get_invoice(invoice_id):
    inv = db.invoices.get(invoice_id)       # authorization ✗ — no check that
    return jsonify(inv)                     #   THIS user owns THIS invoice → IDOR
```

The fix is a **server-side, object-level** check on every access:

```python
@require_login
@app.route("/api/invoices/<invoice_id>")
def get_invoice(invoice_id):
    inv = db.invoices.get(invoice_id)
    if inv is None or inv.org_id != current_user.org_id:   # object-level authz
        abort(404)                                          # 404, not 403 (don't leak existence)
    return jsonify(inv)
```

The senior reviewer carries a small set of access-control failure shapes and checks the diff against each:

| Shape | What to look for in review |
|---|---|
| **Object-level (IDOR)** | A client-supplied id used to fetch an object with no ownership/tenant check. |
| **Function-level** | An admin/privileged endpoint protected only by *not being linked in the UI*. Hidden ≠ secured. |
| **Vertical escalation** | A role check that's missing, client-side only, or checks the wrong role (`is_authenticated` where it needed `is_admin`). |
| **Confused deputy** | The server performs an action using *its* privileges on behalf of a caller who shouldn't have them. |
| **Mass assignment** | A request body bound directly to a model, letting the client set fields it shouldn't (`role`, `is_admin`, `org_id`). |
| **Insecure defaults** | New resource defaults to public/world-readable; new role defaults to over-privileged. |

> **Key insight:** "Authenticated" answers *who*; "authorized" answers *may you, on this object*. Every endpoint that takes an object identifier from the client is an authorization decision waiting to be forgotten. The review reflex: for each object reference in the diff, find the line that proves the caller may touch *that* object — and if it isn't there, that's the finding.

Two traps worth naming because they survive otherwise-careful review. **The hidden-UI trap:** a privileged action is "protected" only because the button isn't rendered for normal users — but the endpoint is live and anyone can `curl` it. UI is not an authorization boundary; the server is. **Client-side checks:** an authorization check enforced in the frontend is a usability feature, not a control; the reviewer must find the *server-side* enforcement or treat it as missing.

---

## Core Concept 4 — Injection Beyond SQLi

SQL injection is the famous one, so it's the one juniors check for. The senior reviewer knows injection is a *family* defined by the taint shape "untrusted data interpreted as code/structure by an interpreter," and that family has many members — each with its own correct defense.

| Injection type | The interpreter | Correct defense (review for this, not for escaping) |
|---|---|---|
| **SQL** | The DB query planner | Parameterized queries / bound parameters. Never string interpolation. |
| **Command** | The OS shell | Avoid the shell; pass `argv` arrays to `exec*`, never a constructed shell string. |
| **NoSQL** | Mongo/etc. query engine | Reject object-typed values where scalars are expected; don't pass raw JSON into query operators (`$where`, `$gt`). |
| **LDAP** | The directory server | Context-aware LDAP escaping of DNs and filters. |
| **SSTI** (template injection) | The template engine | Never compile user input as a template; pass it as *data* into a fixed template. |
| **Deserialization → RCE** | The object deserializer | Don't deserialize untrusted bytes with formats that can instantiate arbitrary types (Java/Python pickle/PHP). Use data-only formats with schemas. |
| **Prototype pollution** | JS object model | Reject/skip `__proto__`, `constructor`, `prototype` keys in recursive merges; use null-prototype objects or `Map`. |

Two of these deserve a senior's special attention because they're invisible to people thinking only "SQLi":

**Deserialization-RCE.** `pickle.loads`, Java native deserialization, and similar give an attacker who controls the bytes the ability to construct objects whose construction *runs code*. There is no "escape the input" defense — the only review-approved answers are "don't deserialize untrusted input with this mechanism" or "use a data-only format (JSON/Protobuf) with explicit schema validation." If a diff adds `pickle.loads(request.body)`, that is a finding regardless of any surrounding validation.

**Prototype pollution.** A deep-merge of attacker JSON into a JS object can, via a `__proto__` key, mutate `Object.prototype` and change the behavior of *unrelated* code across the process — escalating to auth bypass or RCE depending on what reads those polluted properties. The review reflex on any recursive merge / `set(obj, path, value)` helper is: *are dangerous keys filtered?*

> **Key insight:** Injection is not a SQL problem; it's a *mixing-code-with-data* problem that recurs at every interpreter boundary. The universal cure is the same shape everywhere — **separate the structure (fixed, trusted) from the data (variable, untrusted)** so the interpreter never parses attacker input as instructions. When you see untrusted data being *concatenated into anything an interpreter will parse* — SQL, a shell line, a template, a path, an LDAP filter — that's the smell, whichever interpreter it is.

---

## Core Concept 5 — SSRF and Cloud-Metadata Escalation

Server-Side Request Forgery is the confused-deputy attack of the cloud era, and it's worth its own concept because the *blast radius* in a typical cloud deployment is far larger than its mild-sounding name suggests. SSRF happens when an attacker controls (in whole or part) the destination of a request *the server* makes. The server is the deputy; it has network position and credentials the attacker lacks.

```python
# A "fetch this image for me" endpoint — a textbook SSRF source.
@app.route("/api/preview")
def preview():
    url = request.args["url"]          # ← attacker controls the DESTINATION
    return requests.get(url).content   # server fetches it FROM the server's network
```

The reason this is severe and not merely "the server downloads a file": in a cloud VM, `http://169.254.169.254/` (the link-local metadata endpoint) hands out **IAM credentials** to anything that asks from on the instance. An attacker who can make the server fetch an arbitrary URL points it there and harvests the instance's role credentials — escalating from "I can read a URL" to "I have your cloud account's keys." SSRF also reaches internal-only services (`http://10.0.0.5/admin`), `localhost` admin ports, and `file://` and `gopher://` schemes on naive clients.

What the senior reviewer requires for any server-side fetch of a user-influenced URL — and why a denylist is *not* enough:

- **Allowlist destinations, don't denylist them.** Blocking `169.254.169.254` is defeated by DNS names that resolve to it, decimal/octal IP encodings, IPv6 forms, and redirects. Allow only the schemes and hosts you actually intend.
- **Resolve-then-validate, and pin.** Validate the resolved IP (reject link-local, loopback, RFC-1918 private ranges), then connect to *that* IP — otherwise DNS rebinding lets the name resolve to a safe IP at check time and a private IP at fetch time (a TOCTOU on DNS).
- **Disable or bound redirects.** A safe initial URL can 302 to `169.254.169.254`. Don't blindly follow.
- **Defense in depth:** require IMDSv2 (which needs a session token and blocks the naive SSRF fetch), and apply egress network policy so the workload simply *cannot* reach the metadata IP.

> **Key insight:** SSRF turns your server's *network position and credentials* into the attacker's. The damage isn't bounded by what the attacker can reach directly — it's bounded by what your *server* can reach, which in a cloud VPC includes the metadata service, internal admin panels, and everything behind the firewall. That's why a "harmless image fetcher" is an account-takeover primitive, and why the only robust review answer is a destination allowlist plus IMDSv2 plus egress policy — never a denylist alone.

---

## Core Concept 6 — Secrets, Crypto, and Authentication Weaknesses

Reviewers are not expected to invent cryptography — quite the opposite; the senior reflex is *"don't roll your own."* But you are expected to spot the recurring *misuse* patterns, because they're subtle, they pass tests (the happy path "works"), and they're invisible to anyone matching on keywords.

**Non-constant-time comparison of secrets.** Comparing a user-supplied token to the real one with `==` short-circuits at the first differing byte, so response time leaks how many leading bytes matched — a timing oracle that lets an attacker recover the secret byte by byte over many requests.

```python
if user_token == real_token:          # ✗ early-exit; timing leaks the prefix
if hmac.compare_digest(user_token, real_token):   # ✓ constant-time
```

**Predictable randomness for security values.** `random.random()` / `Math.random()` are fast PRNGs, not cryptographic — their output is predictable from observed values. Session ids, password-reset tokens, API keys, and nonces must come from a CSPRNG (`secrets`, `crypto.randomBytes`, `/dev/urandom`).

**Nonce/IV reuse.** Reusing a nonce with the same key in AES-GCM or ChaCha20-Poly1305 is catastrophic — it leaks the XOR of plaintexts and can break the authentication entirely. In review: any place a nonce is a constant, a counter that can repeat across restarts, or derived deterministically from data is a finding.

**Authentication-specific shapes** worth a dedicated pass when a diff touches login/session/JWT:

| Weakness | Review cue |
|---|---|
| **Session fixation** | The session id is *not* rotated on privilege change (login). Attacker plants an id pre-login, victim authenticates into it. |
| **JWT `alg` confusion** | Verification trusts the token's own `alg` header; `alg: none` or RS256→HS256 downgrade lets an attacker forge tokens. Pin the algorithm server-side. |
| **JWT as a session** | Long-lived, un-revocable JWTs used where revocation matters (logout, ban). You can't un-issue a stateless token. |
| **Missing rate limiting** | Login / OTP / reset endpoints with no throttling → credential stuffing and brute force. |
| **Password storage** | Anything other than a memory-hard KDF (argon2/scrypt/bcrypt) for passwords — never raw SHA-256, never reversible. |

> **Key insight:** Crypto bugs almost never look broken — the code computes a value, the test asserts it round-trips, and it ships. The defects live in *properties* the happy path never exercises: constant-time-ness, unpredictability, nonce-uniqueness, algorithm-pinning. Review crypto by asking which *property* protects against the *attacker*, not whether the function returns the right bytes. And when in doubt, the finding is "use the vetted primitive," and the escalation is "loop in AppSec." See [Cryptography](../../../../Security/) for the underlying guarantees.

---

## Core Concept 7 — Supply Chain: A New Dependency Is New Trust

A diff that adds one line to a manifest — `+ leftpad@1.2.3` — can add hundreds of thousands of lines of transitive code that will run with your application's full privileges. The senior reviewer treats **every new dependency as an extension of the trust boundary**: you are now trusting that package's author, their account security, and every one of *their* transitive dependencies, with your data and your production environment.

What a senior actually asks when a PR adds or bumps a dependency:

- **Do we need it?** A one-function utility (left-pad, is-odd) is not worth a supply-chain entry. The most secure dependency is the one you didn't add.
- **What's the provenance and health?** Maintained? Reputable? Recent suspicious ownership transfer? A typosquat of a popular name (`reqeusts`, `colour` vs `colorama`)?
- **What capability does it pull in?** Does it run install scripts (`postinstall`)? Does a *logging* library suddenly need network or filesystem access? Capability creep on update is a classic compromise signal.
- **Is it pinned and locked?** A floating range (`^1.2.0`) means a future publish runs in your build without review. Pin and commit a lockfile with hashes so the *exact* bytes are what was reviewed.
- **Is the bump just a version, or new behavior?** A "patch" bump that adds a network call deserves the same scrutiny as new application code.

> **Key insight:** Adding a dependency is the highest-leverage line of code in any diff — it imports an entire foreign codebase, and all of its dependencies, into your trust boundary with your privileges. Human review can ask the *should-we-and-from-whom* questions; it cannot read 100k lines of transitive code. So the review pairs judgment ("do we need this, from this author?") with automation that *can* scale: dependency scanning (SCA), lockfile-hash pinning, and provenance attestation. Review decides; tooling enforces.

This is the cleanest example of review composing with tooling rather than replacing it: the reviewer makes the trust decision; an automated scanner (Dependabot/Snyk/`osv-scanner`) watches the locked set for known CVEs over time.

---

## Core Concept 8 — DoS and Algorithmic-Complexity Attacks

Availability is a security property, and the cheapest way to take a service down is rarely a botnet — it's an input that makes the server do superlinear work, allocate unbounded memory, or hold a resource forever. These are *complexity attacks*, and they're a security review concern even though they look like performance bugs, because the attacker *chooses* the worst-case input deliberately.

The shapes a senior reviewer hunts for in a diff that accepts untrusted input:

- **Unbounded input.** A request body, array, or upload with no size limit; a pagination endpoint with no max page size. The fix is a hard cap *before* the work begins.
- **ReDoS.** A regex with nested quantifiers (`(a+)+$`, `(\d+)*`) applied to attacker input backtracks exponentially. A 30-character string can pin a CPU core for minutes.

```javascript
// Catastrophic backtracking: (x+)+ on a non-matching tail is exponential.
const re = /^(\w+\s?)+$/;          // ← attacker sends "aaaa…aaaa!" → CPU pinned
// Fix: a linear-time engine (RE2), an anchored non-backtracking pattern,
//      or simple bounded parsing instead of a clever regex.
```

- **Zip/XML bombs.** A 1 KB archive that decompresses to 10 GB; a billion-laughs XML entity expansion. Review for decompression/entity-expansion limits and resolved-size caps.
- **Algorithmic complexity on data structures.** Hash-collision floods (crafted keys all hashing to one bucket → O(n) per insert) and worst-case sort inputs. The attacker turns your average-case data structure into its worst case.
- **Resource holding.** Unbounded concurrency, no timeout on outbound calls, connection-pool exhaustion, a per-request goroutine/thread with no limit. One slow dependency plus no timeout cascades into total unavailability.

> **Key insight:** A complexity attack is the place where security and performance reasoning *fuse*: it's a performance cliff that an attacker reaches *on purpose* with a chosen input. The review question is not "what's the average cost?" — it's "what's the *worst-case* cost on the most hostile input an attacker can send, and is the input bounded *before* that cost is paid?" Anything attacker-sized and superlinear is a DoS finding.

---

## Core Concept 9 — The Limits of Human Security Review

The most important thing a senior knows about security review is *what it cannot do*. Over-trusting review — "two people read it, so it's secure" — is itself a vulnerability, because it substitutes for the controls that actually catch the bugs review can't.

**What human review reliably catches:** missing authorization checks, untrusted data reaching a sink across a few hops, obviously-wrong crypto usage, a dangerous new dependency, a clearly superlinear algorithm on untrusted input. These are *structural and visible by reading*.

**What human review does *not* reliably catch — and what does:**

| Class review misses | Why eyes fail | What catches it |
|---|---|---|
| Memory safety (UAF, OOB, double-free) | Requires reasoning about all interleavings of allocation/free across the whole program | **ASan/MSan** + **fuzzing** (run the code) |
| Data races / concurrency | Combinatorial interleavings; the buggy schedule rarely appears while reading | **TSan**, stress/race testing |
| Deep, cross-module taint flows | Too many hops across files/async boundaries for a human to hold | **SAST** taint analysis |
| Known-vulnerable dependencies | Nobody memorizes the CVE feed | **SCA** / dependency scanning |
| Runtime-only issues (config, TLS, headers) | Not visible in app code at all | **DAST**, config scanning, pentest |
| Anything you *didn't threat-model* | You can't review for a risk you never considered | Threat modeling *before* the diff; pentest after |

The last row is the deepest limit: **review cannot catch what you don't think to look for.** That is why threat modeling happens *before* code, why a pentest exercises the running system adversarially, and why a SAST/DAST/SCA pipeline runs on every change regardless of who reviewed it.

> **Key insight:** Human review is one layer of defense in depth, not the layer. It excels at *structural* and *intent* judgments — "this is the wrong design, this trusts the wrong actor, this needs an authz check" — and it is *unreliable* for memory safety, concurrency, whole-program flows, and known-CVE coverage. The senior reviewer's discipline is to do the part review is good at, and to *insist the other layers exist* — sanitizers and fuzzing in CI, SAST/DAST/SCA gating, and a pentest plus AppSec engagement for high-risk changes — rather than treating their own approval as the safety net. See [Static Analysis](../../static-analysis/) and [Dynamic Analysis & Sanitizers](../../dynamic-analysis-and-sanitizers/).

**When to pull in AppSec:** new authentication/authorization flows, cryptography, payment/PII handling, a new internet-facing service, deserialization of untrusted data, or anything where you can articulate a plausible high-impact attacker but can't confidently say the diff defends against them. Escalation is a senior skill, not a failure.

---

## Core Concept 10 — Performance: Complexity and the Cost Model

Switching to performance, the senior reviewer's primary tool is not a benchmark — it's the ability to read an *asymptotic and structural* cost out of the code and to carry an accurate **cost model** of what operations actually cost. Two lenses.

**The complexity lens — find the superlinear pattern.** The defects that matter at scale are almost always a growth-rate problem, and they have recognizable shapes:

```python
# Hidden quadratic: a linear library call inside a linear loop.
for user in users:                  # n
    if user.id in banned_ids_list:  # `in` on a LIST is O(n) → overall O(n²)
        ...
# Fix: banned = set(banned_ids); `in` on a set is O(1) → O(n) overall.
```

- **The library call in a loop.** `list.index`, `in` on a list, string concatenation in a loop, a `.contains` on the wrong structure — each turns an innocent loop into O(n²).
- **The N+1 across a boundary.** One query/RPC to get N rows, then one more *per row* — N+1 round trips. Devastating because each trip carries fixed latency, so cost scales with N × RTT regardless of how small each query is.

```python
orders = db.query("SELECT * FROM orders WHERE user_id = ?", uid)  # 1 query
for o in orders:
    o.items = db.query("SELECT * FROM items WHERE order_id = ?", o.id)  # +N queries (N+1)
# Fix: one JOIN, or a single WHERE order_id IN (...) batch (eager load).
```

- **The accidental full scan.** A query filtering on an unindexed column, or fetching a whole table to filter in app code. Works on the dev seed of 100 rows; table-scans 10M in prod.

**The cost-model lens — know the orders of magnitude.** A senior carries Jeff Dean's "latency numbers" calibration: L1 cache ≈ 1 ns, main memory ≈ 100 ns, SSD random read ≈ 100 µs, same-datacenter network round trip ≈ 500 µs, cross-region ≈ 100+ ms. This makes the review *automatic*: a call inside a loop that crosses the network is paying ~500 µs × N; the same loop touching only L1-resident data is a rounding error. The lens also covers:

- **Allocation in hot loops / GC pressure.** Allocating per-iteration (new slices, boxing, string building) creates garbage that the GC must later collect — often the real cost in managed languages. See [Performance](../../performance/).
- **Cache behavior and false sharing.** Pointer-chasing a linked structure misses cache; an array of structs streams. Two threads writing adjacent fields on one cache line ping-pong it (false sharing).
- **I/O and concurrency cost.** Blocking in an async handler stalls the event loop; lock contention serializes "parallel" work; chatty calls and missing batching/pagination multiply round trips; an unbounded fan-out exhausts the connection pool.

> **Key insight:** Read for *growth rate and boundary-crossings*, not for cleverness. The two questions that find 90% of real performance bugs in review are "**what does this do as N grows?**" and "**what's the most expensive thing in the loop body, in cost-model terms?**" An O(n²) on user-controlled N and a network call inside a loop are both visible from the diff and both matter; a five-instruction inner-loop tweak almost never does.

---

## Core Concept 11 — The Read-vs-Measure Boundary

This is the discipline that separates a senior performance reviewer from both extremes — the one who waves through an O(n²) and the one who blocks a PR demanding micro-optimizations no profile justifies. The rule is sharp:

- **Review reliably catches *asymptotic and structural* regressions.** Growth rate (O(n) → O(n²)), N+1 round trips, an unindexed scan, an unbounded allocation — these are *visible by reading* and you should flag them with confidence. You don't need to measure to know an O(n²) on 10M rows is a problem.
- **Review *cannot* answer "is this actually hot?" or "what's the constant factor?"** Whether a path runs often enough to matter, whether change A is faster than change B by a constant factor, whether a cache helps — these depend on real data distributions and hardware. **Only a benchmark or profiler answers them.** Reasoning about constant factors from the code is guessing.

So the senior reviewer does two things at once on a perf-relevant diff: **flag the algorithmic risk *and* ask for the measurement** — rather than guessing in either direction.

```
Reviewer comment (the right shape):

"This filters `events` with `.find()` inside the per-row loop — that's O(rows × events),
 quadratic in the batch size, and batches here reach ~50k. I'd expect this to dominate.
 Two asks:
   1) Restructure to a single pass with a lookup map (O(rows + events)).
   2) Add a benchmark over a realistic 50k batch to the PR so we can see the before/after
      and confirm this path is actually the hot one — I don't want to guess at the constant."
```

That comment is calibrated: it states the *structural* claim with confidence (quadratic, visible), and it defers the *magnitude* claim to measurement (is it hot, how much faster). It avoids **under-review** (it catches the O(n²)) and **over-review** (it doesn't demand hand-optimizing a path before confirming it's hot).

The two failure modes to avoid by name:

- **Under-review:** shipping an asymptotic regression because "we'll optimize later." The cliff is in the algorithm; later is an incident.
- **Over-review / premature optimization:** blocking on a constant-factor tweak in cold-path code with no profile. Knuth's "premature optimization is the root of all evil" is precisely the rule that constant-factor work needs measurement first. Complexity-of-code is a real cost too; don't trade readability for an unmeasured speedup.

> **Key insight:** Flag *complexity* by reading; defer *constant factors* to measurement. The senior reviewer is confident about growth rates and humble about magnitudes — and turns that humility into an action ("add a benchmark") rather than a guess. The corollary is a policy worth enforcing on the team: **hot-path changes ship with a benchmark in the PR, and there's a regression budget** so the gate is objective rather than a reviewer's hunch. See [Quality Gates](../../quality-gates/) for wiring perf gates into CI.

---

## Real-World Examples

**1 — Threat-model-driven review of an endpoint (authz + taint together).** A PR adds an admin-style report export:

```python
@require_login
@app.route("/api/orgs/<org_id>/export")
def export_org(org_id):
    org = db.orgs.get(org_id)
    rows = db.query(f"SELECT * FROM events WHERE org={org_id} AND type='{request.args['t']}'")
    path = f"/tmp/{request.args['name']}.csv"
    write_csv(path, rows)
    return send_file(path)
```

Reasoning, in order: *Attacker* = any logged-in free-tier user. *Boundary* = network→app and tenant→tenant. Now run the three failure families. **Authz/IDOR:** `org_id` comes from the URL with no check that `current_user` belongs to it → any user exports any org's events. **SQL injection:** both `org_id` and `request.args['t']` are interpolated into the query string → injection on two parameters. **Path traversal:** `request.args['name']` flows into a filesystem path → `../../etc/...` writes/reads outside `/tmp`. Three distinct findings, all from one walk of "untrusted input → sink across the boundary." The fix is object-level authz (`org.id in current_user.orgs`), parameterized query, and a validated/allow-listed filename (or a generated one). Note the checklist would have caught the SQLi and missed the IDOR — the *threat model* catches both.

**2 — ReDoS / algorithmic-complexity attack.** A diff adds input validation that *feels* like hardening:

```javascript
// "Validate that the input is a series of words" — looks safe, is a DoS primitive.
function validate(s) { return /^([a-zA-Z]+\s)+[a-zA-Z]+$/.test(s); }
```

The nested quantifier `([a-zA-Z]+\s)+` backtracks catastrophically on an input that *almost* matches — e.g., 40 letters followed by a digit. The engine tries every partition of the letters before failing: exponential time, one CPU core pinned, from a 41-byte request. The review finding: this validation is itself the vulnerability. The measurement to confirm is trivial and worth asking for — time `validate("a".repeat(40) + "!")` — but you don't need it to *flag* it; the structural shape (nested `+`/`*` on attacker input) is the tell. Fix: a linear engine (RE2), an anchored non-ambiguous pattern, or just iterate and check character classes.

**3 — N+1 / quadratic with the measurement ask.** A PR adds a dashboard:

```python
def dashboard(team_id):
    members = db.users.where(team_id=team_id)          # 1 query, returns ~M users
    return [{"name": u.name,
             "open_tasks": db.tasks.where(owner=u.id, done=False).count()}  # +1 query/user
            for u in members]                                                # → N+1
```

The structural read is unambiguous: M+1 queries, each a round trip; at M = 2,000 members and a 1 ms intra-DC RTT that's ~2 seconds of pure latency, and it grows linearly with team size. The senior comment states the structural fact with confidence and pairs it with a measurement ask and a concrete fix: *"This is N+1 — one count query per member, so cost is M × RTT and a 2k-member team will be ~2s. Replace with a single grouped query (`SELECT owner, count(*) ... WHERE done=false GROUP BY owner`) and add a benchmark/`EXPLAIN` over a realistic team size to the PR so we confirm the before/after and that this is the hot path."* Confident about the asymptote; defers the magnitude to a number.

---

## Mental Models

- **Find the boundary, then face the attacker across it.** Every diff that moves data across a trust boundary is a security decision. Locate the boundary the change touches, ask who's on the other side and what they can do, and reason outward. Checklists list symptoms; the boundary-plus-attacker model finds the disease.

- **The bug lives in the path, not the endpoints.** A request parameter is innocent; `exec`/SQL/HTML/`open` is innocent. The vulnerability is *one reaching the other unsanitized for that specific sink*. Review by following the data, and always ask "sanitized *for what*?"

- **Injection is mixing code with data.** At every interpreter boundary — SQL, shell, template, LDAP, deserializer — the cure is the same: keep the structure fixed and trusted, pass the data as data. Whenever untrusted input is concatenated into something an interpreter parses, that's the smell.

- **Availability is a security property, and a complexity attack is a perf cliff reached on purpose.** Ask not "average cost" but "worst-case cost on the most hostile input — and is that input bounded before the cost is paid?"

- **Review catches growth rates; benchmarks catch magnitudes.** Be confident about O(n²), N+1, and full scans (visible by reading). Be humble about "is it hot" and "how much faster" (only measurement knows). Turn the humility into "add a benchmark," not a guess.

- **Review is one layer, not the layer.** It's strong on structure and intent, weak on memory safety, concurrency, whole-program flows, and CVE coverage. Do the part eyes are good at; insist the sanitizers, fuzzers, SAST/DAST/SCA, and pentest exist for the rest.

---

## Common Mistakes

1. **Reviewing security against a checklist instead of a threat model.** Checklists catch known patterns and miss the bug nobody listed — most often broken access control. Anchor on the boundary the diff moves and the attacker across it; the checklist is a backstop, not the method.

2. **Trusting a sanitizer aimed at the wrong sink.** `escapeHtml` on data bound for SQL, a filename sanitizer on data bound for the shell. Sanitization is sink-specific; always ask "neutralized *for what*?"

3. **Confusing authentication with authorization.** A login check is not an ownership check. For every client-supplied object id in the diff, find the line that proves the caller may touch *that* object — or that's your finding.

4. **Treating a hidden UI or a client-side check as a control.** If the endpoint is live, "the button isn't shown" protects nothing, and frontend checks are usability, not security. The server is the only authorization boundary.

5. **Denylisting SSRF/injection inputs instead of allowlisting.** Denylists are bypassed by encodings, DNS tricks, and redirects. Allow only intended schemes/hosts/values; for SSRF, resolve-then-pin and require IMDSv2 + egress policy.

6. **Approving a dependency add as if it were one line.** It imports an entire foreign codebase with your privileges. Ask need/provenance/capability/pinning; pair the judgment with SCA scanning and lockfile hashes.

7. **Guessing at constant factors from the code.** "This looks slow / this looks fast" without a profile. Flag *asymptotic* risk by reading; for magnitude and "is it hot," ask for a benchmark — don't assert.

8. **Over-reviewing performance — blocking on cold-path micro-opts.** Premature optimization trades readability for unmeasured speed. If there's no profile showing the path is hot, the algorithmic structure is the only thing worth a block.

9. **Treating your approval as the safety net for memory/concurrency bugs.** Human review can't reliably see UAFs or races. If those classes are possible, the finding is "this needs ASan/TSan/fuzzing in CI," not "looks fine."

---

## Test Yourself

1. A diff adds `GET /api/documents/:id` behind a login requirement. Walk the threat-model questions and name the most likely high-impact vulnerability and the exact line that would fix it.
2. Define source, sink, and sanitizer in taint terms. Why does "this input is validated" not guarantee a given sink is safe?
3. An endpoint fetches a user-supplied URL server-side. Explain why this is more dangerous in a cloud VM than "the server downloads a file," and give three review requirements that aren't a denylist.
4. Give three injection types other than SQL, and for each name the *correct* defense (not "escape it").
5. A token check uses `if supplied == secret`. What's the vulnerability, and what's the one-line fix?
6. Name three vulnerability classes that human review does *not* reliably catch, and what catches each.
7. You see `for u in users: if u.id in big_list:` in a hot handler. State the complexity, the fix, and whether you need a benchmark to flag it.
8. A PR optimizes a string-building loop in code that runs once at startup, hurting readability, with no profile attached. What's the calibrated reviewer response?

<details>
<summary>Answers</summary>

1. *Attacker* = any authenticated user; *boundary* = tenant→tenant; *surface* = a client-supplied object id (`:id`). The likely bug is **IDOR / broken object-level authorization** — the handler loads the document by id without checking ownership. Fix: after loading, `if doc is None or doc.owner_id != current_user.id: abort(404)` (404, not 403, to avoid leaking existence).

2. A **source** is where untrusted data enters; a **sink** is a dangerous operation that interprets data (SQL, shell, HTML, path). A **sanitizer** neutralizes tainted data *for a specific sink*. "Validated" is not enough because sanitization is **sink-specific** — a filename validator does nothing for a shell sink, HTML escaping does nothing for SQL. You must neutralize for the *exact* interpreter the data reaches.

3. In a cloud VM the server can reach the link-local **metadata endpoint** (`169.254.169.254`) that hands out IAM credentials, plus internal-only services and admin ports — so SSRF escalates from "download a file" to **credential/account takeover** and internal pivot. Requirements: (a) **allowlist** schemes/hosts, don't denylist; (b) **resolve-then-validate-then-pin** to the resolved IP (reject loopback/link-local/RFC-1918) to defeat DNS rebinding; (c) **disable/bound redirects**; plus IMDSv2 and egress network policy as defense in depth.

4. Examples: **Command injection** → don't use a shell; pass an `argv` array to `exec*`. **Template injection (SSTI)** → never compile user input as a template; pass it as data into a fixed template. **Deserialization-RCE** → don't deserialize untrusted bytes with type-instantiating formats (pickle/Java native); use a data-only format with a schema. (Also acceptable: NoSQL → reject object-typed values; LDAP → context-aware escaping; prototype pollution → filter `__proto__`/`constructor`.)

5. `==` short-circuits at the first differing byte, so response *timing* leaks the matched prefix — a **timing side channel** that recovers the secret byte by byte. Fix: a **constant-time comparison** (`hmac.compare_digest` / `crypto.timingSafeEqual`).

6. Any three: **memory safety** (UAF/OOB) → ASan + fuzzing; **data races/concurrency** → TSan + stress testing; **deep cross-module taint flows** → SAST; **known-vulnerable dependencies** → SCA/dependency scanning; **runtime/config issues** (TLS, headers) → DAST/pentest; **anything not threat-modeled** → threat modeling before code + pentest.

7. `in` on a **list** is O(n), inside an O(n) loop → **O(n²)**. Fix: build a `set` once (`s = set(big_list)`), then `in` is O(1) → O(n) overall. You do **not** need a benchmark to flag it — the regression is *asymptotic and visible by reading*; a benchmark only confirms magnitude/hotness, which you can additionally ask for.

8. This is **over-review / premature optimization** on a cold path. Calibrated response: don't accept the readability regression — startup-once code isn't hot, and there's no profile justifying the trade. If the author believes it matters, the burden is a profile showing it's hot; absent that, prefer the readable version. (Reserve perf blocks for asymptotic issues or measured hot paths.)

</details>

---

## Cheat Sheet

```
THREAT-MODEL A DIFF (security)
  1. Attacker?   who, what can they already do, what do they want
  2. Boundary?   does this move data across network→app / tenant→tenant / app→sink
  3. Surface?    new endpoint / param / upload / dependency / outbound call
  → for each object id from client: find the line proving caller may touch THAT object

TAINT TRACE
  SOURCE (request, header, file)  →  ...hops...  →  SINK (SQL/shell/HTML/path/exec)
  finding = tainted reaches sink unsanitized FOR THAT SINK
  sanitization is sink-specific; validation(allowlist) > denylist/regex

INJECTION → DEFENSE (separate structure from data)
  SQL→params  Shell→argv array  SSTI→data-into-fixed-template
  Deserialize→data-only+schema  NoSQL→reject objects  LDAP→escape  ProtoPollution→filter __proto__

SSRF                  allowlist hosts + resolve-then-pin (anti-rebind) + no blind redirects
                      + IMDSv2 + egress policy   (metadata 169.254.169.254 = IAM creds)
CRYPTO/AUTHN          constant-time compare (compare_digest) · CSPRNG for tokens/nonces ·
                      no nonce reuse · pin JWT alg · rotate session on login · argon2/bcrypt
DEPENDENCY            need? provenance? capability creep? pinned+lockfile-hash? + SCA scan
DoS/COMPLEXITY        bound input BEFORE work · ReDoS=nested quantifiers · zip/xml bombs ·
                      hash-flood · timeouts + bounded concurrency

REVIEW CAN'T CATCH → USE
  memory safety→ASan+fuzz · races→TSan · deep flows→SAST · CVEs→SCA · runtime→DAST/pentest
  what you didn't threat-model → threat model BEFORE code; loop in AppSec for high-risk

PERFORMANCE
  read for: growth rate (O(n²)?) · N+1 across boundary · unindexed full scan ·
            alloc in hot loop · network call in loop · lock contention · pool exhaustion
  ask "what does this do as N grows?"  and  "costliest thing in the loop body?"
  READ catches: asymptotic/structural (confident)   MEASURE needed: hot? constant factor?
  → flag the complexity AND ask for a benchmark; hot-path PR ⇒ benchmark + regression budget
  avoid: under-review (ship O(n²)) and over-review (block cold-path micro-opt, no profile)
```

---

## Summary

- **Threat-model the diff, don't checklist it.** For the specific change, ask who the attacker is and what they can do, which trust boundary it moves, and what surface it adds. This reflex finds broken access control and the bugs no checklist item names.
- **The vulnerability lives in the path** — untrusted source reaching a dangerous sink unsanitized *for that sink*. Trace the taint; sanitization is sink-specific; injection is mixing code with data, cured by separating fixed structure from variable data at every interpreter boundary.
- **Authenticated ≠ authorized.** Every client-supplied object id is an authorization decision; the hidden UI and the client-side check are not controls. **SSRF** turns the server's network position and cloud credentials into the attacker's — allowlist and pin, never denylist.
- **A new dependency is new trust** at full privilege; judge need/provenance/capability and pair it with SCA + lockfile hashes. **Availability is security** — bound untrusted input before doing superlinear work; ReDoS, zip bombs, and hash floods are complexity attacks chosen on purpose.
- **Know review's limits.** It's strong on structure and intent, unreliable on memory safety, concurrency, whole-program flows, and CVEs. Do the part eyes are good at and insist sanitizers, fuzzing, SAST/DAST/SCA, and pentest exist for the rest; escalate high-risk changes to AppSec.
- **For performance, read for growth rate and boundary-crossings** — O(n²), N+1, full scans, allocation and network calls in loops — and carry a real cost model. **Flag asymptotic risk confidently; defer constant factors and "is it hot" to a benchmark.** Avoid both under-review (shipping an O(n²)) and over-review (blocking a cold-path micro-opt); require a benchmark and a regression budget on hot-path changes.

You now review security by reasoning about attackers and trust boundaries, and performance by reasoning about complexity and cost — while knowing precisely where your eyes stop and a sanitizer, fuzzer, scanner, or profiler must take over. The next layer — [professional.md](professional.md) — is about operating this across a team: security-review SLAs, threat-modeling rituals, perf budgets in CI, and when to bring in AppSec.

---

## Further Reading

- *The Web Application Hacker's Handbook* — Stuttard & Pinto. The attacker's-eye reference for access control, injection, and SSRF; reading it makes you a better defensive reviewer.
- **OWASP Application Security Verification Standard (ASVS)** — a structured, leveled list of verifiable security requirements; excellent as the backstop checklist behind threat-model-driven review.
- **OWASP Code Review Guide** and the **OWASP Top 10** — the canonical taxonomy of what to look for and why each class matters.
- *Systems Performance* — Brendan Gregg. The definitive treatment of the cost model, methodology (USE/RED), and why you measure rather than guess on magnitudes.
- *Threat Modeling: Designing for Security* — Adam Shostack. STRIDE and the discipline of reasoning about attackers before the code exists.
- **Knuth, "Structured Programming with go to Statements"** — the source of "premature optimization is the root of all evil," in its actual, measurement-first context.
- The next tier: [professional.md](professional.md) — operating security and performance review at organizational scale.

---

## Related Topics

- [03 — Correctness & Design Review](../03-correctness-and-design-review/senior.md) — the design and correctness reasoning that sits alongside the security/perf lens in the same review.
- [01 — What to Look For & In What Order](../01-what-to-look-for-and-order/senior.md) — where security and performance fit in the priority order of a review pass.
- [Security](../../../../Security/) — the underlying attacks, defenses, and cryptographic guarantees this review reasoning draws on.
- [Performance](../../performance/) — profiling, the memory hierarchy, allocation/GC, and the benchmarking that answers the magnitude questions review defers.
- [Dynamic Analysis & Sanitizers](../../dynamic-analysis-and-sanitizers/) — ASan/TSan/MSan and fuzzing: the tools that catch the memory-safety and concurrency bugs human review cannot.
