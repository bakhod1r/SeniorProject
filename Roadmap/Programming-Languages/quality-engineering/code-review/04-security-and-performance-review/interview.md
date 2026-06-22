# Security & Performance Review — Interview Level

> **Roadmap:** [Code Review](../README.md) → Security & Performance Review
> *A security-and-performance interview rarely asks "what is SQL injection." It asks "review this endpoint," and then watches whether you trace untrusted input to a dangerous sink, whether you check authorization separately from authentication, and whether you know the difference between a bug you can read off the diff and one you have to measure. This page is the question bank, with model answers and a note on what each question is really probing.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [How to Use This Page](#how-to-use-this-page)
4. [Security Fundamentals](#security-fundamentals)
5. [Security Depth](#security-depth)
6. [Performance Review](#performance-review)
7. [Scale & Paved Roads](#scale--paved-roads)
8. [Scenarios](#scenarios)
9. [Rapid-Fire](#rapid-fire)
10. [Red Flags / Green Flags](#red-flags--green-flags)
11. [Cheat Sheet](#cheat-sheet)
12. [Summary](#summary)
13. [Further Reading](#further-reading)
14. [Related Topics](#related-topics)

---

## Introduction

Security and performance are the two review dimensions where being *fluent in the language* and *correct on the happy path* isn't enough. A function can be readable, well-tested, and obviously correct — and still hand an attacker another user's data, or quietly turn a 50 ms request into a 5 s one at 10× the data. These are the bugs that don't show up in the diff's logic; they show up in the *space between the code and the world it runs in* — the trust boundaries it crosses and the scale it has to survive.

This page is structured the way a real interview loop probes the topic: junior questions check whether you have a checklist; mid-level questions check whether you can *apply* it to a concrete diff; senior and staff questions check whether you understand the *limits* of human review and how to make safety the default instead of a thing you hope a reviewer catches. The recurring move across all of them is the same one the [build-fundamentals interview](../../build-systems/01-build-fundamentals/interview.md) leans on: **name the principle before you reach for a finding.**

---

## Prerequisites

You'll get the most out of this page if you're comfortable with:

- **The review fundamentals** — what to look for and in what order ([01](../01-what-to-look-for-and-order/interview.md)), and correctness/design review ([03](../03-correctness-and-design-review/interview.md)). Security and performance are *passes*, not a replacement for reading the code.
- **Authn vs authz** as distinct concepts (we'll sharpen this, but you should know they're different).
- **Big-O at a reading level** — enough to spot a nested loop over the same collection or a query inside a loop.
- **Where the trust boundary is** in a typical web app: the network, the request body, headers, query params, anything from another service or a file. If it didn't originate in your own trusted code, it's untrusted.

If those are shaky, read [junior.md](junior.md) first — it builds the checklist this page assumes you already hold.

---

## How to Use This Page

Each question carries three things: **Q** (the prompt), **what the interviewer is really testing**, and **A** (a model answer at the depth a strong candidate gives). Don't memorize answers — internalize the *reasoning patterns* they keep returning to:

- **Follow the untrusted input** (source → sink): every injection and access-control bug is "data crossed a boundary and reached something dangerous without being checked."
- **Authentication vs authorization** (who are you vs are you allowed): the #1 vulnerability category lives entirely in the second one.
- **Read vs measure** (structural cost you can see vs constant-factor cost you must benchmark): the dividing line for performance findings.
- **Review as a control vs review as a backstop** (a human pass vs an automated gate): why "the reviewer should catch it" is the wrong answer at scale.

Nearly every question below is one of those four wearing a costume. Candidates who do well *name the pattern* before reaching for a specific vulnerability or optimization.

---

## Security Fundamentals

### Q: What's on your security checklist when you review a diff?

> **Testing:** Do you have a *structured* pass, or do you eyeball it and hope?

**A.** I run a fixed mental checklist anchored on the OWASP Top 10, in roughly the order they bite:

1. **Broken access control / IDOR** — does this endpoint check that *this user* may touch *this object*, not just that they're logged in?
2. **Injection** — does untrusted input reach a SQL query, shell, template, or `eval` without parameterization/escaping?
3. **XSS** — is user-controlled data rendered into HTML/JS/attributes without contextual encoding?
4. **Secrets** — are keys, tokens, or passwords hard-coded, logged, or returned in responses?
5. **Insecure deserialization** — are we deserializing untrusted bytes into objects (pickle, Java native, unsafe YAML)?
6. **SSRF** — does the server fetch a URL the user controls?
7. **Input validation / output encoding** — is every external input validated at the boundary, and encoded for the context it lands in?

The unifying idea is **follow the untrusted input**. I'm not pattern-matching keywords; I'm asking, for each piece of external data, *where does it go and what does it touch?* That single habit catches most of the list.

### Q: Explain authentication versus authorization, and why the distinction matters in review.

> **Testing:** The distinction that the #1 vulnerability category lives inside.

**A.** **Authentication** answers *who are you* — verifying identity (a session, a JWT, an API key). **Authorization** answers *are you allowed to do this* — checking that the authenticated identity may perform *this action* on *this resource*. They're different layers and they fail differently.

In review the trap is that authentication is usually centralized — middleware on every route — so it's easy to see and hard to forget. Authorization is **per-object and per-action**, so it has to be re-checked in the handler, and it's the thing people forget. A route can be perfectly authenticated (you're definitely logged in) and completely unauthorized (you can read anyone's invoice). When I review an endpoint, "is it behind auth middleware?" is the *easy* question; "does it verify this user owns the object it's about to return or mutate?" is the one that finds bugs.

### Q: Why is broken access control the #1 category in the OWASP Top 10?

> **Testing:** Whether you understand *why* this class dominates, not just that it does.

**A.** Three reasons compound. First, **it can't be centralized** — unlike injection (which a parameterized-query library or ORM largely kills framework-wide) or XSS (which auto-escaping templates largely kill), authorization is inherently *contextual*: it depends on this user, this object, this action, this moment. There's no single chokepoint that fixes it everywhere, so every new endpoint is a fresh opportunity to forget it.

Second, **it's invisible to functional tests** written by the author. The developer tests with their own account, sees their own data, and everything passes. The bug only appears when a *different* user supplies an ID they shouldn't have access to — which the author rarely tests.

Third, **the happy path looks identical to the vulnerable path**. `getOrder(id)` that returns any order and `getOrder(id)` that returns only *your* order are the same line of code minus one check. So it slips through review unless the reviewer is specifically asking "ownership check?" That's why it tops the list and why I treat it as the first thing I look for on any endpoint touching user data.

### Q: A code change adds `os.system("ping " + user_host)`. Walk me through the problem and the fix.

> **Testing:** Source-to-sink reasoning on a classic injection.

**A.** Classic **command injection**. Follow the input: `user_host` is untrusted (it came from a request), and it flows directly into a **shell** sink (`os.system` invokes `/bin/sh -c`). Because it's string-concatenated into a shell command, an attacker sends `user_host = "x; rm -rf / #"` and the shell happily runs the second command. The boundary was crossed and the data reached a dangerous sink with no neutralization.

The fix is *not* to "sanitize" by blacklisting characters — that's a losing game against shell metacharacters. The fix is to **avoid the shell entirely**: use the argument-vector form (`subprocess.run(["ping", "-c", "1", user_host], shell=False)`) so the OS treats `user_host` as a single literal argument, never as shell syntax. And separately, **validate** `user_host` against an allowlist (is it a valid hostname/IP?) at the boundary, because even as a literal argument you don't want arbitrary values reaching `ping`. Parameterize first, validate second — never blacklist.

### Q: How do you reason about input validation in review? Where should it live?

> **Testing:** Boundary thinking, and the validate-vs-encode distinction.

**A.** Two principles. First, **validate at the trust boundary**, once, as data enters the system — not scattered defensively across the codebase. The handler that receives the request should reject malformed/illegal input immediately (type, range, length, format, allowlist where possible) so the rest of the code can assume it's working with well-formed data. Validation deep in the call stack is a smell: it means the boundary leaked.

Second, **validation and output encoding are different jobs** and I check for both. Validation is "is this input acceptable *as input*?" (reject a 10 MB username). Encoding is "is this data safe *in the context I'm about to put it in*?" — and it's *context-dependent*: the same string needs HTML-encoding in HTML, JS-encoding in a script block, URL-encoding in a query string. A common bug is validating input but then concatenating it into a SQL string or an HTML page — validation passed, but the *sink* wasn't protected. So I trace each input to where it lands and ask: validated on the way in, *and* encoded for where it lands?

### Q: A PR hard-codes an API key as `API_KEY = "sk_live_..."`. What do you say, and is removing it enough?

> **Testing:** Whether you know a committed secret is already compromised.

**A.** Two separate problems, and the second is the one juniors miss. First, the obvious one: secrets don't belong in source — move it to an environment variable or a secrets manager. But second, and more important: **once a secret is committed, it's compromised, full stop** — it lives in git history forever and in every clone, fork, and CI cache. Deleting the line in a follow-up commit does *nothing*; the key is still in history.

So the correct response is: (1) **rotate the key immediately** — assume it's leaked, revoke and reissue it; (2) remove it from the code and load it from config/secrets-manager; (3) optionally scrub history, but treat that as cleanup, not remediation. And then the systemic fix: **secret-scanning in CI and a pre-commit hook** so the next one is blocked before it ever lands, because relying on a reviewer to spot a 40-character string is not a control. "Just delete the line" is the red-flag answer; "rotate, then prevent" is the right one.

---

## Security Depth

### Q: What does a *threat-model-driven* review look like, versus a checklist pass?

> **Testing:** The differentiator — do you review against *this system's* risks or a generic list?

**A.** A checklist pass asks "does this code contain any item from the OWASP list?" A threat-model-driven review asks "given *what this code does* and *who would want to attack it*, what could go wrong here?" The checklist is necessary but generic; the threat model is specific and finds the bugs the checklist's phrasing doesn't anticipate.

Concretely: before reading the diff I ask what the **trust boundaries** are (where does data cross from untrusted to trusted?), what the **assets** are (what's worth stealing or corrupting — PII, money, credentials?), and who the **adversary** is (an external attacker, a malicious authenticated user, a compromised dependency?). Then I review the diff *against that model*. A payment endpoint and a public health-check endpoint get very different scrutiny even if the code looks similar, because their threat models differ. STRIDE (Spoofing, Tampering, Repudiation, Information disclosure, Denial of service, Elevation of privilege) is a useful prompt to make sure I've considered each category for the change. The point is to spend review attention proportional to risk, not uniformly.

### Q: Explain taint / data-flow reasoning. How do you do it by hand in a review?

> **Testing:** The mental model behind both human review and SAST.

**A.** **Taint analysis** tracks untrusted data from where it enters (a **source** — request param, header, file, message-queue payload) to where it could do harm (a **sink** — a SQL executor, a shell, an HTML renderer, a file path, a deserializer). Data is "tainted" until it passes through a **sanitizer** appropriate to the sink (parameterization for SQL, contextual encoding for HTML, an allowlist for a redirect URL). A vulnerability is *tainted data reaching a sink without the right sanitizer in between*.

By hand, I do exactly that walk: I find the sources in the diff, then trace each one forward — through assignments, function calls, and transformations — asking at each hop "is it still tainted, and where does it end up?" If a tainted value reaches a sink and I can't point to the sanitizer, that's a finding. This is *also* exactly what static analyzers do mechanically, which is why I lean on SAST to do the tedious cross-function tracing at scale and reserve my human attention for the cases the tool can't reason about — taint that flows through a database round-trip, a cache, or a queue (second-order injection), where the source and sink are in different requests entirely.

### Q: What *can't* human security review catch, and what do you pair it with?

> **Testing:** Senior humility — knowing review is one control among several.

**A.** Human review is good at *intent and context* bugs — missing authorization, a dangerous design, business-logic flaws a tool can't understand. It's bad, and unreliable, at anything that requires exhaustively tracing state or exploring inputs:

- **Memory-safety bugs** (use-after-free, buffer overflow, data races) — you cannot reliably eyeball these. They need **sanitizers** (ASan/UBSan/TSan) and **fuzzing**.
- **Deep cross-function taint** — a tool follows it across the whole codebase; a human reading one PR sees only the diff.
- **Dependency vulnerabilities** — a CVE in a transitive dep isn't in the diff at all; that's **dependency scanning / SCA**.
- **Runtime-only issues** — auth bypasses that only manifest against a running system; that's **DAST** and **pentest**.

So review *composes* with automation rather than replacing it: **SAST** for taint at scale, **secret-scanning** for credentials, **SCA/dep-scan** for known-vulnerable libraries, **DAST/pentest** for runtime behavior, **fuzzing + sanitizers** for memory safety. A mature answer states this explicitly — review is the layer that catches *contextual* bugs and the gate that ensures the *automated* layers ran, not a substitute for them.

### Q: When do you escalate a review to AppSec instead of resolving it yourself?

> **Testing:** Knowing the limits of your own authority and expertise.

**A.** I escalate when the change touches a domain where being slightly wrong is catastrophic and where deep specialist knowledge matters more than general review skill. Concretely: anything that **rolls its own cryptography** or touches key management; changes to **authentication or session handling** (token issuance, password flows, SSO); changes to the **authorization model itself** (not just one missing check, but how permissions are computed); anything handling **regulated data** (PCI, PHI) in a new way; and anything where I find a vulnerability whose *blast radius* I can't bound.

The judgment is: a missing ownership check on one endpoint, I'll flag and the author fixes it — that's normal review. A new bespoke "sign this token with our own scheme," I escalate, because crypto and auth-protocol design have failure modes that don't look like bugs to a generalist and that AppSec is specifically equipped to catch. Knowing *when you're out of your depth* is itself a senior security skill; the failure mode is a confident reviewer approving subtly-broken crypto.

### Q: What is a ReDoS / algorithmic-complexity attack, and how do you spot the risk in review?

> **Testing:** DoS as a code-level concern, not just an infra one.

**A.** A **ReDoS** (Regular-expression Denial of Service) attack exploits a regex whose backtracking is exponential in the input length. A pattern like `(a+)+$` against a long string of `a`s followed by a non-match makes the engine try exponentially many ways to match — a few dozen characters can hang a CPU core for seconds. More broadly, an **algorithmic-complexity attack** is any case where attacker-controlled input drives a worst-case code path: a hash table with predictable collisions degrading to O(n²), an unbounded recursion, a JSON parser with quadratic behavior on nested input.

In review I spot it by asking, for any regex or algorithm fed untrusted input: **what's the worst case, and can the attacker reach it?** For regexes specifically, I look for nested quantifiers and overlapping alternations on user input — and I prefer a linear-time engine (RE2) or an input-length cap over a hand-audited pattern. The mindset is that DoS is a *code-review* concern: the diff can introduce a complexity bomb that no amount of horizontal scaling fixes, because the attacker just sends a slightly longer string.

### Q: Why does comparing secrets need a constant-time comparison?

> **Testing:** Timing side-channels — a depth signal.

**A.** A normal string/byte comparison (`==`, `memcmp`) **short-circuits on the first mismatching byte**. That means the time it takes to reject a wrong value *depends on how many leading bytes were correct* — a timing side-channel. An attacker comparing against a secret (an API token, an HMAC signature, a password hash) can, with enough timing samples, recover it byte by byte: try all first bytes, keep the one that takes marginally longer, repeat. It's slow and noisy but real, especially for HMAC/signature verification.

The fix is a **constant-time comparison** that always examines every byte regardless of where the first mismatch is — `hmac.compare_digest` in Python, `crypto.timingSafeEqual` in Node, `subtle.ConstantTimeCompare` in Go. In review, any time I see a raw `==` comparing a user-supplied value against a secret or a signature, I flag it. It's a small, specific tell that separates someone who's thought about side-channels from someone who only knows the OWASP headline list.

---

## Performance Review

### Q: What's your performance checklist when reading a diff?

> **Testing:** Whether you can read structural cost off the page.

**A.** I look for the costs that are **visible in the code structure** — the ones I don't need a profiler to suspect:

- **N+1 queries** — a database/RPC call *inside a loop*, where one batched call would do. The single highest-yield thing to look for.
- **Accidental O(n²)** — a nested loop over the same collection, or an `array.includes`/linear search inside a loop that should be a set/map lookup.
- **Unbounded queries / results** — a `SELECT` with no `LIMIT`, loading an entire table into memory, pagination that fetches everything then slices.
- **Hot-loop allocation** — allocating, compiling a regex, or opening a connection *inside* a tight loop instead of hoisting it out.
- **Missing indexes** — a query filtering/joining on a column with no index (this needs schema knowledge, but the query shape flags it).
- **Blocking I/O** on a latency-sensitive path — synchronous calls where the surrounding code is async, or I/O holding a lock.

The unifying question is **"how does this grow as the data grows?"** Constant-factor stuff I leave alone unless it's measured; *growth* stuff I flag from the diff.

### Q: Explain the "read versus measure" rule for performance findings.

> **Testing:** The single most important judgment call in perf review.

**A.** Some performance problems are **readable** from the code; others must be **measured**. The rule is: **flag algorithmic and structural problems from reading; require a measurement for constant-factor claims.**

- **Readable (flag it):** complexity that gets *worse with scale* — N+1, O(n²), unbounded results, a query inside a loop. These I can reason about with certainty: at 10× the data they're 100× the cost. I don't need a benchmark to know a nested loop over a user-controlled collection is a problem.
- **Measure (don't assert):** constant-factor differences — "a `for` loop is faster than `.map`," "this string builder beats concatenation," "switching JSON libraries will help." I have no basis to claim these without numbers, and I'm usually wrong about where the time actually goes. Demanding a micro-optimization without a profile is how reviewers waste authors' time on the 99% of code that isn't hot.

So my findings split cleanly: "this is O(n²) on user input, here's why that's a problem" (assertion) versus "if you think this is hot, can you show me a benchmark?" (request). Knowing which bucket a concern is in is the whole skill.

### Q: Why is premature optimization itself an anti-pattern you'd flag in review?

> **Testing:** That you optimize *judiciously*, not reflexively.

**A.** Because optimization has costs — it usually trades **clarity for speed**, adds complexity, and introduces bugs — and most code isn't on a hot path, so that trade buys nothing. A diff that replaces a clear, obvious loop with a hand-unrolled, cache-tuned, hard-to-read version "for performance" on a request that runs once a day is a *net negative*: I now have less maintainable code and zero measurable benefit. So I flag unjustified optimization the same way I flag a missing index — both are misallocations of cost.

The discipline is **optimize what's measured to be hot, leave everything else clear**. In review, when an author optimizes something, I ask "is this on a hot path, and do you have a number?" If the answer is "no, but it felt slow," that's premature optimization and I'd push back toward the simpler version. The flip side: when something *is* demonstrably hot, I expect the optimization *and* a comment/benchmark justifying the complexity. Clarity is the default; speed is the exception you have to earn with evidence.

### Q: You see a database call inside a loop. What do you say in the review?

> **Testing:** N+1 recognition and how you communicate the fix.

**A.** This is the **N+1 query** pattern and I'd flag it as a likely blocker if the loop iterates over anything that grows. My comment names the problem, explains the cost, and proposes the fix:

> *"This issues one query per item in the loop — N+1. For a user with 500 orders, that's 500 round-trips, and it gets linearly worse as orders grow. Can we batch this into a single query with a `WHERE id IN (...)` (or a join / a dataloader)? That turns N+1 into 1."*

Two things make this a good review comment rather than a nitpick. First, I quantify the growth ("500 round-trips," "linearly worse") so it's clearly structural, not a micro-optimization — this is firmly in the *read-and-flag* bucket. Second, I give a concrete alternative (batch query, join, dataloader) rather than just "this is slow," so the author has a path forward. I'd also check *where* this runs: N+1 on an admin script that runs nightly is lower-severity than N+1 on a per-request hot path, and I'd calibrate "blocker vs suggestion" accordingly.

### Q: When do you *block* a PR on a performance concern versus just ask for a benchmark?

> **Testing:** Calibration — severity tied to certainty and blast radius.

**A.** I **block** when the cost is *structural and certain* and the path is *hot or scales with attacker/user-controlled input*: an N+1 or O(n²) on a per-request endpoint, an unbounded query that loads a whole table, a complexity bomb on untrusted input. I can reason about these with certainty, the failure mode is real (latency cliff, OOM, DoS), and waiting for production to prove it is reckless. No benchmark needed — the growth curve is the argument.

I **ask for a benchmark** (and don't block) when the concern is *constant-factor* or I'm *unsure it's hot*: "I think this allocation might matter, but I can't prove it from reading — is this on a hot path, and can you measure it?" Here blocking would be asserting something I can't support. The general rule: **block on growth, measure on constants.** And there's a third bucket — a *require-a-benchmark policy* for code in known-hot modules, where the team agrees that changes to that module *must* come with before/after numbers, so the burden is set by policy rather than negotiated per-PR. Severity should track certainty and blast radius, not how strongly I feel about it.

---

## Scale & Paved Roads

### Q: Why doesn't code review scale as a primary security or performance control?

> **Testing:** The staff-level realization that humans are a backstop, not a gate.

**A.** Because human review is **inconsistent, unmeasurable, and doesn't compose with growth**. A reviewer's attention is finite and variable — they catch the IDOR on Tuesday and miss the identical one on Friday when they're tired. As the team and PR volume grow, you can't scale "everyone reviews carefully" — you'd need review quality to stay perfect across hundreds of PRs a week, which no organization achieves. And review gives you no *guarantee*: "a human looked at it" is not a control you can audit or prove.

So at scale, review is the layer that catches **contextual** bugs (missing authorization, bad design) — things only a human understands — while the **mechanical** classes get automated gates: **SAST** and **secret-scanning** in CI block injection patterns and committed keys deterministically; **dependency scanning** blocks known-vulnerable libraries; **performance gates / load tests** catch regressions on hot paths. The reframe is: review is a *backstop for judgment*, not a *gate for the mechanical stuff*. Anything a tool can check reliably, a tool should check, every time — because the tool doesn't get tired and you can prove it ran.

### Q: Explain the "paved road" philosophy and how it changes what reviewers look for.

> **Testing:** Making the safe/fast way the *default*, not the reviewed-for way.

**A.** The **paved road** (Netflix's term; "golden path" elsewhere) is the idea that the *easiest, default* way to do something should also be the *safe and fast* way — so developers fall into the pit of success without having to know the security or performance pitfalls. Instead of relying on every developer to remember to parameterize queries, you provide a data-access layer where parameterization is the only option. Instead of hoping they remember authorization, you provide a framework where endpoints declare their access policy and it's enforced centrally. Instead of auto-escaping being opt-in, the template engine escapes by default.

This *changes what reviewers look for*: on the paved road, the review question shifts from "did they do the dangerous thing safely?" to "**are they on the road, or did they leave it?**" Hand-rolled SQL when there's a query builder, a raw `innerHTML` when there's a safe component, a bespoke auth check when there's a policy framework — *leaving the paved road* is the finding, because off-road is where the unaudited danger lives. The deepest version of this: the best security/performance work isn't catching bugs in review, it's building the road so the bug *can't be written* in the first place. Review then enforces "stay on the road," which is a far more scalable thing for a human to check.

### Q: How do you handle ownership and review triggers for security-sensitive code?

> **Testing:** Routing scrutiny to where it matters, automatically.

**A.** Not all code deserves equal review attention, so I make the *routing* automatic rather than relying on reviewers to notice. Concretely: define **security-sensitive paths** — auth, crypto, payment, the access-control layer, anything handling secrets or PII — and put them under **CODEOWNERS** so a change there *automatically requires* a review from the team or specialists who own that risk. The version-control system enforces the trigger; nobody has to remember to loop in AppSec.

Layered on that: **path-based CI rules** so touching, say, the crypto module runs extra checks (stricter SAST, mandatory AppSec sign-off), and **labels/automation** that flag PRs touching sensitive areas for heightened review. The principle mirrors the performance one — spend scrutiny proportional to blast radius — but the staff move is to *encode* that proportionality in tooling (CODEOWNERS, required reviewers, path-triggered gates) so it happens deterministically, instead of depending on whichever reviewer happens to recognize that this innocuous-looking diff touches the token-signing code.

### Q: A team keeps merging slow code "because it passed review." How do you fix the system?

> **Testing:** Systemic thinking — fixing the process, not blaming reviewers.

**A.** The diagnosis is that performance is being treated as a *review opinion* when it should be a *measurable gate*, so I'd add the missing mechanical layer rather than asking reviewers to try harder. Steps:

1. **Identify the hot paths** that actually matter (the endpoints in the latency SLO) — most code genuinely doesn't need this.
2. **Add performance gates in CI** for those paths: a load/benchmark test that fails the build if p99 latency or a key benchmark regresses past a threshold. Now a regression is *blocked*, not *hoped against*.
3. **Adopt a require-a-benchmark policy** for changes to known-hot modules — the PR must include before/after numbers, set by policy not negotiation.
4. **Make the fast way the default** (paved road) — connection pooling, pagination, batched data access built into the framework so slow patterns are harder to write.

The throughline matches the security answer: **don't ask humans to be the gate for something a tool can measure.** "It passed review" failing to prevent slow code isn't a reviewer failure — it's a missing automated control, and the fix is to build the control.

---

## Scenarios

### Q: "Review this endpoint for security." Walk me through your reasoning.

> **Testing:** Whether you have a repeatable method, applied live.

**A.** I'd narrate three passes in order:

**1. Authorization first.** Who can call this, and does it check that *this* user may touch *this* object? I look past the auth *middleware* (is it logged in?) to the *handler* (does it verify ownership/permission on the specific resource?). If it takes an `id` and returns or mutates that object without an ownership check, that's an IDOR and likely my top finding.

**2. Follow the untrusted input.** I enumerate every input — path/query params, body, headers — and trace each to its sink. Does any reach a SQL query (injection?), an HTML response (XSS?), a shell/file path/URL fetch (command injection / path traversal / SSRF?), or a deserializer? For each, I ask: parameterized/encoded/allowlisted, or raw?

**3. Validation, secrets, and error handling.** Is input validated at the boundary (type, range, length)? Are any secrets logged or returned? Do error responses leak stack traces or internal detail? Is anything sensitive (tokens, PII) over-returned in the response body?

The structure is the point: **authz, then taint, then hygiene.** I name what I'm checking as I go, so even if this specific endpoint is clean, I've demonstrated the method that *would* catch the bug.

### Q: "An API returns another user's data if you change the ID in the URL." What is this, and how serious?

> **Testing:** Naming the #1 vulnerability and calibrating its severity.

**A.** That's **IDOR — Insecure Direct Object Reference**, a form of **broken access control**, the #1 OWASP category. The endpoint authenticates you (you're logged in) but fails to **authorize** the specific object — it trusts the `id` in the request and returns whatever it points to, without checking *you own it*. Change `/orders/123` to `/orders/124` and you read someone else's order.

**Severity: critical, usually a hard blocker.** It's a direct confidentiality breach (and if the same pattern is on a write/delete endpoint, an integrity breach too); it's trivially exploitable — just increment an integer, no skill required; it scales — a script enumerates *every* user's data in minutes; and it's often a reportable data breach with regulatory weight (GDPR/HIPAA). The fix is to enforce authorization at the data layer: the query itself must be scoped to the caller (`WHERE id = :id AND owner_id = :current_user`), not "fetch by id, then maybe check." Using **unguessable IDs (UUIDs)** raises the bar but is *not* a fix — that's security-by-obscurity; the authorization check is mandatory regardless.

### Q: "You see a DB call inside a loop." What do you say?

> **Testing:** N+1 recognition under a terse prompt (the perf mirror of the IDOR question).

**A.** "That's an **N+1 query**." Then: it does one round-trip per iteration, so it's *linear in the collection size* — fine for 3 items, a latency disaster for 5,000, and it degrades as the data grows. This is a *structural* cost I can flag straight from the diff (read-and-flag, no benchmark needed). I'd ask for it to be **batched** — a single `WHERE id IN (...)`, a join, or a dataloader — turning N calls into one. I'd also check the blast radius: per-request hot path makes it a blocker; a nightly batch job makes it a lower-severity suggestion. The shape of the answer mirrors the IDOR one: *name the pattern, state the growth, propose the batched fix, calibrate by where it runs.*

### Q: "A PR adds a regex that runs on user input." What's the risk and what do you check?

> **Testing:** ReDoS awareness applied to a concrete diff.

**A.** The risk is **ReDoS** — if the pattern can backtrack catastrophically, an attacker sends a crafted string that pins a CPU core for seconds, a denial-of-service from a few dozen bytes. So I check the *pattern's structure*: nested quantifiers (`(a+)+`), overlapping alternations (`(a|a)*`), or `.*` combined with backtracking-prone constructs are the danger signs, especially against unbounded input. I'd ask three things: (1) **Can the input be capped?** A length limit before the regex bounds the worst case cheaply. (2) **Does the pattern have catastrophic backtracking?** If unsure, test it with a pathological input or run it through a ReDoS linter. (3) **Can we use a linear-time engine** (RE2) so backtracking is structurally impossible? The mindset I'm signaling: a regex on untrusted input is *attacker-controlled compute*, and "does it match correctly" isn't the only question — "what's its worst case and can the attacker reach it" is the security one.

### Q: A PR replaces a readable loop with a clever one-liner "for performance," on code that runs once per request. How do you respond?

> **Testing:** Premature optimization plus the read/measure rule, in a judgment call.

**A.** I'd push back, but with a question rather than a verdict: **"Is this on a hot path, and do you have a benchmark showing the difference?"** If the honest answer is "no, it just felt faster," this is premature optimization — we've traded readability (a real, ongoing cost) for an unmeasured, probably-negligible speedup (no benefit), which is a net loss on per-request code that isn't the bottleneck. I'd ask to revert to the clear version unless there's evidence it matters.

If, instead, it turns out this *is* hot and the benchmark shows a meaningful win, I'd accept the complexity — *and* ask for a comment and the benchmark numbers in the PR, so the next reader knows why the clever version exists and can re-verify it. This is the **read/measure** rule in action: a constant-factor optimization needs *measurement* to justify it, and "clever" is a cost you only pay when the numbers earn it. The wrong reviewer responses are rubber-stamping it (optimization theater) or rejecting it dogmatically — both skip the question that decides it.

---

## Rapid-Fire

> Short questions to check breadth. One or two sentences each.

- **Q: IDOR in one line?** A: Authenticated but not authorized for the specific object — change the ID, get someone else's data; a form of broken access control.
- **Q: Authn vs authz?** A: Authn = who are you (identity); authz = are you allowed (permission on this action/object). The #1 bug class lives in authz.
- **Q: How do you stop SQL injection?** A: Parameterized queries / prepared statements — never string-concatenate input into SQL. Validation is secondary, not the fix.
- **Q: How do you stop XSS?** A: Contextual output encoding (auto-escaping templates), plus a Content-Security-Policy as defense in depth.
- **Q: What's an N+1 query?** A: One DB/RPC call per item in a loop instead of one batched call — linear round-trips that worsen with data size.
- **Q: Read-vs-measure rule?** A: Flag algorithmic/structural cost from reading (N+1, O(n²)); require a benchmark for constant-factor claims.
- **Q: Source and sink?** A: Source = where untrusted input enters; sink = where it could do harm; a vuln is tainted source reaching a sink without sanitization.
- **Q: Why constant-time compare for secrets?** A: A short-circuiting `==` leaks how many leading bytes matched — a timing side-channel that recovers the secret.
- **Q: What is SSRF?** A: The server fetches a URL the user controls, letting an attacker reach internal services (e.g., cloud metadata endpoints).
- **Q: Is a committed secret fixed by deleting the line?** A: No — it's in git history forever; you must *rotate* it. Deleting is cleanup, not remediation.
- **Q: What can't human review catch?** A: Memory-safety bugs, deep cross-function taint, dependency CVEs, runtime-only auth bypasses — pair review with sanitizers/fuzzing, SAST, SCA, DAST.
- **Q: Paved road in one line?** A: Make the default way the safe/fast way, so the dangerous thing is hard to write; review enforces "stay on the road."
- **Q: When block on perf vs ask for a benchmark?** A: Block on structural growth (N+1, O(n²), unbounded); ask for a benchmark on constant-factor or "is this even hot?"
- **Q: ReDoS?** A: A regex with catastrophic backtracking; crafted input hangs a CPU — cap input length or use a linear-time engine (RE2).
- **Q: Why is broken access control #1?** A: It can't be centralized, it's invisible to the author's own tests, and the vulnerable path looks identical to the happy path.
- **Q: Do UUIDs fix IDOR?** A: No — unguessable IDs raise the bar but the authorization check is still mandatory; UUID-only is security by obscurity.

---

## Red Flags / Green Flags

> What interviewers infer from *how* you answer, not just whether you're right.

**Red flags:**
- Conflating authentication and authorization — or only checking "is it behind auth middleware?"
- "Sanitize the input" as the fix for injection, via blacklisting characters, instead of parameterizing.
- Treating a committed secret as fixed by deleting the line — not knowing to rotate.
- Asserting micro-optimizations ("a `for` loop is faster") with no benchmark, while ignoring the N+1 next to it.
- Optimizing cold code "for performance" and trading away clarity for nothing.
- "The reviewer should catch it" as the scaling answer for injection/secrets — instead of an automated gate.
- Thinking human review catches memory-safety or dependency CVEs.
- Calling UUIDs a fix for IDOR.

**Green flags:**
- Naming the *pattern* (follow-the-input, authz-not-authn, read-vs-measure, paved-road) before the specific finding.
- Tracing source → sink explicitly when reasoning about a vulnerability.
- Stating that review *composes* with SAST/SCA/DAST/fuzzing rather than replacing them.
- Splitting perf findings cleanly into "block on growth" vs "ask for a benchmark on constants."
- Reaching for the paved road — "make the safe way the default" — unprompted.
- Calibrating severity by blast radius and hot-path-ness, not gut feeling.
- Knowing when to escalate to AppSec (bespoke crypto, auth-protocol changes).
- Caveating tradeoffs ("optimize it *if* it's measured hot, and leave a benchmark").

---

## Cheat Sheet

| Concern | Read-from-diff tell | The principle | The fix / response |
|---|---|---|---|
| **IDOR / broken access control** | endpoint takes an `id`, returns/mutates the object, no ownership check | authz ≠ authn | scope the query: `WHERE id = :id AND owner_id = :user` |
| **SQL injection** | input concatenated into a query string | follow input → SQL sink | parameterized query / prepared statement |
| **XSS** | user data rendered into HTML/JS without encoding | follow input → render sink | contextual output encoding + CSP |
| **Command injection / SSRF** | input in `os.system`, a file path, or a fetched URL | follow input → shell/URL sink | arg-vector (no shell) / allowlist the URL |
| **Committed secret** | a key/token literal in source | secrets never in code/history | **rotate**, then move to secrets manager + scan in CI |
| **ReDoS** | regex with nested quantifiers on user input | attacker-controlled compute | cap input length / linear-time engine (RE2) |
| **Timing side-channel** | `==` comparing a secret/signature | non-constant compare leaks bytes | `compare_digest` / `timingSafeEqual` |
| **N+1 query** | DB/RPC call inside a loop | grows linearly with data | batch: `WHERE id IN (...)` / join / dataloader |
| **Accidental O(n²)** | nested loop / linear search in a loop | grows quadratically | set/map lookup; reconsider the algorithm |
| **Unbounded query** | `SELECT` with no `LIMIT` | unbounded memory/latency | paginate; bound the result set |
| **Premature optimization** | clever code on cold path, no benchmark | clarity is the default | revert to clear version unless measured hot |

**The two governing rules:**
- **Security:** *follow the untrusted input from source to sink; check authorization separately on every object.*
- **Performance:** *flag structural growth from reading (block); require a benchmark for constant-factor claims (ask).*

---

## Summary

- The bank reduces to four reasoning patterns in costumes: **follow-the-input (source→sink)**, **authn vs authz**, **read vs measure**, and **review-as-backstop vs automated-gate**. Name the pattern first; the specific finding follows.
- **Security fundamentals:** a structured checklist (broken access control/IDOR, injection, XSS, secrets, deserialization, SSRF, validation), anchored on *following untrusted input* and on *authorization checked per-object* — which is why broken access control is #1: uncentralizable, invisible to the author's tests, and identical-looking to the happy path.
- **Security depth:** threat-model-driven review (assets, boundaries, adversary) over a generic checklist; taint/data-flow by hand; the *limits* of human review (no memory-safety, no deep taint, no CVEs, no runtime bypass) and its composition with SAST/SCA/DAST/fuzzing; escalate bespoke crypto and auth-protocol changes to AppSec; ReDoS and constant-time comparison as depth tells.
- **Performance:** read structural cost off the diff (N+1, O(n²), unbounded queries, hot-loop allocation, missing indexes, blocking I/O); the **read-vs-measure** rule — block on growth, benchmark on constants; premature optimization is itself a flaggable anti-pattern.
- **Scale & paved roads:** review doesn't scale as a *primary* control — automate the mechanical classes (SAST, secret-scan, dep-scan, perf gates) and reserve humans for contextual judgment; **make the safe/fast way the default** so the bug can't be written; encode scrutiny in CODEOWNERS and path-triggered gates.
- **Scenarios:** "review this endpoint" → authz, then taint, then hygiene; "another user's data by changing the ID" → IDOR, critical; "DB call in a loop" → N+1, batch it; "regex on user input" → ReDoS, cap or RE2; "clever code for perf on cold path" → ask for a benchmark, revert if none.

---

## Further Reading

- **OWASP Top 10** — the canonical web-app risk list; know the categories and *why broken access control leads*. The reference for the fundamentals pass.
- **OWASP ASVS** (Application Security Verification Standard) — a structured, levelled checklist of verifiable security requirements; what a thorough review measures against.
- **OWASP Cheat Sheet Series** — concrete, per-topic guidance (injection prevention, authorization, ReDoS) for turning a finding into a fix.
- *Systems Performance* (Brendan Gregg) — the reference for measuring rather than guessing; grounds the read-vs-measure discipline and the methodologies behind perf gates.
- The [junior.md](junior.md) and [senior.md](senior.md) pages of this topic — junior builds the checklist this page applies; senior covers the paved-road and program-level controls in depth.

---

## Related Topics

- [03 — Correctness & Design Review](../03-correctness-and-design-review/interview.md) — the review pass this one builds on; correct-but-insecure and correct-but-slow are still bugs.
- [01 — What to Look For & In What Order](../01-what-to-look-for-and-order/interview.md) — where the security and performance passes sit in the overall review order.
- [Security](../../../../Security/) — the dedicated security track: threat modeling, the vulnerability classes, and crypto in depth.
- [Performance](../../performance/) — profiling, benchmarking, and the measurement methodology behind perf-review judgment.
- [Static Analysis & Linting](../../static-analysis/) — the SAST/secret-scan/dep-scan tooling that automates the mechanical classes review shouldn't gate alone.
