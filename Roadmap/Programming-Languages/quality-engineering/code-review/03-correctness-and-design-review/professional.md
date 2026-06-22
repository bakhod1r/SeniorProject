# Correctness & Design Review — Professional Level

> **Roadmap:** [Code Review](../README.md) → Correctness & Design Review
> *The senior page taught you to hunt bugs and read for the wrong shape. This page is about a harder truth: humans are terrible bug-grep machines and they don't scale. The staff engineer's job is to push every mechanical correctness check into tooling so human review is spent only on what tools can't see — design, intent, system-fit, and the bug that is wrong-but-valid — and to move the expensive "wrong approach" conversation upstream of the code entirely.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — The Leverage Question: Humans Don't Scale as Bug-Grep](#core-concept-1--the-leverage-question-humans-dont-scale-as-bug-grep)
5. [Core Concept 2 — Make Illegal States Unrepresentable as an Org Strategy](#core-concept-2--make-illegal-states-unrepresentable-as-an-org-strategy)
6. [Core Concept 3 — Moving Design Review Upstream](#core-concept-3--moving-design-review-upstream)
7. [Core Concept 4 — Catching Architectural Drift Across PRs](#core-concept-4--catching-architectural-drift-across-prs)
8. [Core Concept 5 — API & Compatibility Governance](#core-concept-5--api--compatibility-governance)
9. [Core Concept 6 — Calibration: A Consistent Correctness & Design Bar](#core-concept-6--calibration-a-consistent-correctness--design-bar)
10. [Core Concept 7 — Teaching the Bug-Hunt and the Design Eye](#core-concept-7--teaching-the-bug-hunt-and-the-design-eye)
11. [Core Concept 8 — Knowing the Limits of Review](#core-concept-8--knowing-the-limits-of-review)
12. [War Stories](#war-stories)
13. [Decision Frameworks](#decision-frameworks)
14. [Mental Models](#mental-models)
15. [Common Mistakes](#common-mistakes)
16. [Test Yourself](#test-yourself)
17. [Cheat Sheet](#cheat-sheet)
18. [Summary](#summary)
19. [Further Reading](#further-reading)
20. [Related Topics](#related-topics)

---

## Introduction

> Focus: **Scaling correctness and design judgement across an org — pushing mechanical checks to tooling, moving design feedback upstream of code, governing API evolution, and calibrating the bar so it's the same regardless of who reviews.**

The senior page made you a good correctness reviewer: you hunt concurrency hazards, off-by-ones, swallowed errors, nil derefs, and resource leaks, and you can see when a change is the wrong *shape* before weeks are sunk into it. That skill does not stop being valuable. But at the professional level it stops being the *point*, because a single excellent reviewer reading every diff is the most expensive and least reliable defect filter an org can build. Humans miss bugs at a stubborn rate no matter how senior — the inspection literature has put manual review's defect-detection effectiveness somewhere in the 30–60% range for decades, and staring harder does not move that number much.

So the leverage question for a staff engineer is not "how do I catch more bugs in review?" It is "what should *never reach* human review because a type, a lint, a test, or a sanitizer should have caught it first — and what can *only* a human catch, so that's where I spend the scarce attention?" The answer reshapes the whole activity. Mechanical correctness (formatting, unused imports, nil-deref classes a type system can forbid, data races a sanitizer can find, the off-by-one a property test would surface) gets pushed *down* into tooling. Design correctness — wrong-but-valid behavior, missing requirements, an API that will be impossible to evolve, an architecture eroding one reasonable PR at a time — gets pushed *up* into design docs and forums so the expensive feedback lands before the code exists. What's left in the PR review is the irreducible human core. This page is about engineering that split, and defending it.

---

## Prerequisites

- **Required:** [senior.md](senior.md) — the bug-pattern hunt, reading for the wrong shape, API and invariant review at the level of an individual change.
- **Required:** You've owned a service or library long enough to have lived with a design decision you'd reverse, and to have shipped a bug that passed review.
- **Helpful:** You've set up or tuned a CI pipeline — linters, type-checkers, sanitizers, a test gate — and seen what it does and doesn't catch.
- **Helpful:** You've made or reviewed a breaking change to an API that other teams depend on, and watched what happened downstream.

---

## Glossary

| Term | Meaning |
|---|---|
| **Mechanical correctness** | Defects a machine can detect deterministically — type errors, races, leaks, format, dead code, many off-by-ones. The opposite of judgement. |
| **Wrong-but-valid** | Code that compiles, passes tests, and satisfies every tool, yet does the wrong thing — the requirement was misunderstood. Only a human who knows intent catches it. |
| **Make illegal states unrepresentable** | Designing types/APIs so a whole class of bug cannot be written, removing it from the set of things review must check. |
| **Architectural drift** | Slow erosion of a system's design where no single PR is wrong but the sum degrades coherence. |
| **Hyrum's Law** | "With enough users, every observable behavior of your system will be depended on by somebody" — so any change is potentially a breaking change. |
| **Calibration** | Aligning reviewers so the same change gets the same correctness/design verdict regardless of who reviews it. |
| **Block vs suggest** | The binary distinction between feedback that must be addressed before merge (a real defect, broken invariant, incompatible API) and feedback that is advisory (taste). |
| **Upstream design review** | Reviewing the *approach* — via RFC/ADR/design doc — before code is written, so "wrong direction" feedback is cheap. |

---

## Core Concept 1 — The Leverage Question: Humans Don't Scale as Bug-Grep

The single most important reframe at this tier: **a human reviewer is a slow, expensive, unreliable detector for any defect a machine can catch — and a uniquely irreplaceable one for defects no machine can.** A staff engineer who spends review attention pointing out an unhandled error a linter would have flagged is burning the org's scarcest resource on a job a CPU does better, cheaper, and every time.

The discipline is to triage every class of correctness defect into one of two buckets:

- **Tool-catchable** — deterministic, mechanical, pattern-matchable. *Push it down.* The reviewer should never see it, because the type system, linter, sanitizer, test, or fuzzer caught it before the PR opened.
- **Human-only** — requires knowing what the code is *supposed* to do, how the system is *supposed* to evolve, or judgement about a tradeoff. *This is what review is for.*

```
            DETECTABILITY                          CATCH IT WITH
  ─────────────────────────────────────────────────────────────────────
  unused var, format, dead code      ────►  linter / formatter
  null/nil deref (forbiddable)       ────►  type system (Option, non-null)
  data race, use-after-free          ────►  sanitizer (TSan/ASan), Rust borrow ck
  off-by-one, boundary, round-trip   ────►  property-based test / fuzz
  unhandled error path               ────►  errcheck-style lint, exhaustive match
  ─────────────────────────────────────────────────────────────────────
  wrong-but-valid (misread req)      ────►  HUMAN — knows intent
  missing requirement / case         ────►  HUMAN — knows the spec
  subtle concurrency design          ────►  HUMAN (design) + TSan (mechanics)
  API that can't be evolved          ────►  HUMAN — knows the future
  architectural fit / drift          ────►  HUMAN — knows the system
```

The right-hand column of the *top* half is where a staff engineer invests **engineering effort**, not review effort: standing up the linter, adopting the stricter type, wiring the sanitizer into CI, writing the fuzz harness. Every defect class you move from "a human might catch it" to "a tool always catches it" is permanent leverage — it pays out on every future PR, by every reviewer, forever. Review attention, by contrast, is spent once and forgotten.

> **The principle:** the highest-leverage correctness review a staff engineer does is often *not in a PR at all* — it's the lint rule, the type, or the sanitizer gate that makes a whole bug class unreviewable because it's now impossible or auto-caught. See [Static Analysis & Linting](../../static-analysis/), [Dynamic Analysis & Sanitizers](../../dynamic-analysis-and-sanitizers/), and [Testing](../../testing/) for the machinery this concept leans on.

---

## Core Concept 2 — Make Illegal States Unrepresentable as an Org Strategy

The deepest version of "push it to tooling" isn't adding a check — it's changing the design so the bug *cannot be written*, and therefore cannot be reviewed-for, because it won't compile. This is the organizational application of *make illegal states unrepresentable*, and it is the highest form of leverage in this topic.

Consider the difference between two API shapes:

```go
// Reviewable-bug shape: every caller is a place review must check.
type Connection struct {
    addr   string
    socket *net.Conn   // nil until Open(); using it before Open() panics
    closed bool        // using it after Close() corrupts
}
// Reviewer must now verify, at EVERY call site, that Open() was called,
// Close() wasn't, and the order is right. This is unbounded human work.
```

```go
// Unrepresentable shape: the type system enforces the lifecycle.
type Dialer struct{ addr string }
type OpenConn struct{ socket net.Conn }      // can ONLY exist after a successful dial
func (d Dialer) Open() (OpenConn, error) { ... }
func (c OpenConn) Send(b []byte) error  { ... } // no "is it open?" check needed
func (c OpenConn) Close() error         { ... } // consumes c; can't be reused
// There is no "use before open" or "use after close" to review for.
// The bug class is gone, not caught.
```

The same move shows up everywhere: a parsed-and-validated `Email` type instead of passing `string` around and re-validating; non-empty list types so "what if it's empty?" stops being a review question; sum types / sealed hierarchies so an unhandled case is a *compile error*, not a missed branch; units in the type (`Meters` vs `Feet`) so a category of arithmetic bug can't be written. Parse, don't validate — turn unstructured input into a structured type *once*, at the boundary, and the downstream code is correct by construction.

At org scale this is a *strategy*, not a one-off. The staff engineer's job is to notice when a recurring review comment ("did you handle the empty case?", "is this validated?", "is this the open or closed connection?") signals a *missing type or API*, and to invest in the better shape so the comment never needs to be written again. **Better types and APIs are a force multiplier on review: they shrink the set of reviewable bugs.** A team that designs illegal states out of existence reviews faster and ships fewer defects than a team that reviews harder.

> **The leverage:** every "the type/API now makes that impossible" is worth more than a thousand caught instances of the bug, because it protects every author who hasn't joined yet and every reviewer who is too tired to catch it. This is correctness review applied to the *design of the things being reviewed*.

---

## Core Concept 3 — Moving Design Review Upstream

The most expensive feedback in code review is "this is the wrong approach." It arrives after the author has spent days writing the code, lands as a wall of comments, and forces a choice between throwing the work away and rationalizing it. By the time wrong-shape feedback shows up *in a PR*, the cost is already sunk. The professional fix is structural: **move the design conversation upstream of the code, where changing direction is cheap.**

The mechanisms, in increasing weight:

- **Draft PR / prototype culture.** For anything non-trivial, the first artifact is a draft PR or a throwaway prototype that sketches the *approach* — interfaces, data flow, the key decision — not the finished implementation. Reviewers engage with the shape before the author has invested in polish. "Send me the interface and one call site before you build it out" is a staff engineer's most-used sentence.
- **Design docs / RFCs / ADRs.** For changes that cross a module boundary, touch a public API, or pick between viable architectures, the design is written down *before* implementation and reviewed as prose: what problem, what options, what tradeoffs, what we chose and why. The reviewers debate the *decision*, cheaply, in a doc — not the code, expensively, in a diff. An ADR captures the decision so the next person doesn't relitigate it.
- **Design review forums.** A standing venue (a weekly design review, an RFC mailing list, an architecture channel) where larger changes get cross-team eyes *before* code. This is where the person who knows the change will collide with another team's plans speaks up while it's still a paragraph.

The cost curve is the whole argument:

```
  Cost to change direction
  │                                              ┌──────  in a merged PR (rework + risk)
  │                                       ┌──────┘
  │                                ┌──────┘  in an open PR (throw away the diff)
  │                         ┌──────┘
  │                  ┌──────┘  in a draft / prototype (throw away a sketch)
  │           ┌──────┘
  │    ┌──────┘  in a design doc (edit a paragraph)
  └────┴───────────────────────────────────────────────────►  time / investment
       RFC        draft        open PR        merged
```

The staff engineer's role is to *route* changes to the right altitude: trivial changes go straight to a PR; anything where "wrong approach" would be costly gets an upstream design pass first. The art is not turning everything into a heavyweight RFC — that's its own failure mode (design-by-committee, latency, ceremony). It's recognizing the small set of changes where upstream review pays for itself, and protecting the fast path for everything else.

> **The reframe:** in-PR design feedback is a *symptom of a missing upstream step*. When you find yourself writing "I'd have built this completely differently" on a finished PR, the lesson isn't "review harder" — it's "this change needed a design doc, and we skipped it." Fix the process, not just the PR.

---

## Core Concept 4 — Catching Architectural Drift Across PRs

Here is the failure mode that no single-PR reviewer can see, and that a staff engineer is uniquely positioned to catch: **the system erodes one reasonable-looking PR at a time.** Each change, reviewed in isolation, is fine. The new field added to the god-object is fine. The one more call that reaches across the layer boundary is fine. The fifth slightly-different way to fetch a user is fine. No reviewer blocks any of them, because none of them is *wrong* — and yet the sum is a system drifting away from its design.

Single-PR review is structurally blind to this. The reviewer sees the diff, not the trajectory. A perfectly competent reviewer approves each step of the erosion because each step, locally, is the path of least resistance and breaks nothing. Drift is a *derivative* — it's invisible in any one frame; you only see it across time.

What a staff engineer does that point reviewers can't:

- **Reviews the trend, not the diff.** "This is the third PR this month adding a field to `User`; that object is now 40 fields and three responsibilities. We're not blocking this PR, but we are splitting that type." The judgement spans PRs.
- **Names the invariant the drift violates.** "Our rule is the domain layer doesn't import the transport layer. This PR is the fourth small exception. The exceptions are the problem." Making the eroding invariant *explicit* turns an invisible derivative into a reviewable line.
- **Installs a tripwire so the tool catches future drift.** Once the invariant is named, encode it: an architecture-fitness test (`ArchUnit`, `import-linter`, a dependency-cruiser rule, a `go vet`-style check) that *fails CI* when the transport layer is imported from the domain layer. Now drift is mechanical to catch — pushed down to tooling per Concept 1 — and no longer relies on one staff engineer happening to notice.
- **Schedules the paydown.** Drift caught is drift to be reversed. The staff engineer turns "the system is eroding" into a concrete refactor with an owner, not a lament.

> **The professional discipline:** correctness review at scale includes reviewing the *system's trajectory*, not just each change. No single PR is wrong, but the system is getting worse — that sentence is the staff engineer's beat. The durable fix is to name the eroding invariant and then *encode it as a fitness function* so the architecture defends itself in CI, not in the memory of one busy person.

---

## Core Concept 5 — API & Compatibility Governance

When a change touches a public or cross-team API, the review is no longer about the diff — it's about every caller you can't see. This is **Hyrum's Law** in operation: *with enough consumers, every observable behavior of your API — not just its documented contract, but its exact error messages, its iteration order, its timing, its undocumented quirks — is depended on by somebody.* So a change that is "obviously safe" by the documented contract can still break a dozen callers who depended on something you never promised.

This makes API review a distinct, higher-stakes activity with its own gates:

- **A public/cross-team API change is reviewed for *evolvability*, not just correctness.** The questions are: can this be extended later without another breaking change? Are we exposing more than we must (every exposed field is a future compatibility obligation)? Is the contract narrow enough that we *can* change the implementation? A staff engineer reviews the API for the changes it forecloses, not just the change at hand.
- **Backward-compat is a gate, not a preference.** For a versioned or widely-consumed API, "this is a breaking change" is a *block*, full stop — it goes through the deprecation process or it doesn't merge. The reviewer's job is to *detect* the break, which Hyrum's Law makes hard: the break may be in behavior, not signature. This is where tooling earns its keep — contract tests against real consumers, recorded-response (golden) tests, schema-compatibility checks (e.g. buf/Protobuf backward-compat lint, API-diff tools) that mechanically flag a wire-incompatible change. Push the *detection* down to tooling; reserve human judgement for whether the break is justified.
- **Deprecation is a managed process, not a delete.** You don't remove a public API; you deprecate it, announce it, instrument it to find the remaining callers, migrate them (ideally with tooling), and *then* remove it. The review of a removal asks: "who still calls this, and is there a migration?" — answered with data, not assumption.

```
  API change review gate
  ┌──────────────────────────────────────────────────────────┐
  │ Is this API public / cross-team / versioned?              │
  │     no  → review as normal correctness/design             │
  │     yes ↓                                                 │
  │ Does it change OBSERVABLE behavior (sig, wire, error,     │
  │   ordering, timing, semantics)?                           │
  │     no  → proceed                                         │
  │     yes ↓                                                 │
  │ Backward-compatible?  ── no ──► BLOCK → deprecation path  │
  │     │                            (announce, migrate, then │
  │     yes                           remove)                 │
  │     ↓                                                     │
  │ Verified by contract/golden/schema-compat tooling? ──────►│
  │     if not, add it before this lands                      │
  └──────────────────────────────────────────────────────────┘
```

> **The hard-won rule:** for a public API, *assume* something undocumented is depended upon — that's Hyrum's Law, not paranoia. The review question is never "did I break the documented contract?" but "what observable behavior changed, who might depend on it, and is the break worth it?" Make compatibility a gate with tooling behind it, and make deprecation a process with data behind it.

---

## Core Concept 6 — Calibration: A Consistent Correctness & Design Bar

If two reviewers would give the same change different correctness/design verdicts, the bar isn't a bar — it's a lottery, and authors learn to shop for the lenient reviewer. The professional move is **calibration**: making the correctness and design bar explicit and consistent so the verdict doesn't depend on *who* picked up the PR.

The sharpest tool here is a crisp line between what we **always block on** and what we **never block on**:

| Always block (correctness/design) | Never block (taste) |
|---|---|
| A real defect — a concrete bug you can describe and reproduce | "I'd have named it differently" |
| A broken invariant the system relies on | "I'd have structured it this way" |
| An incompatible change to a governed API | A style choice a linter doesn't flag |
| A missing requirement / unhandled case the spec demands | A preference between two correct designs |
| Absent tests for genuinely risky logic (per the team's bar) | A micro-optimization with no measured need |

The discipline is twofold. First, **everything on the right is a *suggestion*, explicitly labeled, and the author may decline it** — a staff engineer who blocks a PR on personal preference is corroding the bar more than any lenient reviewer. Second, **the line itself is calibrated as a team**, because individuals draw it differently. The mechanisms:

- **A written correctness/design bar** — a short doc: here's what we always block on, here's what's always a suggestion, here are worked examples. Not a style guide (the linter owns style); a *judgement* guide.
- **Review-the-reviews** — periodically, the team reads a sample of past reviews together and asks "would we all have blocked / not blocked here?" Disagreements surface the uncalibrated edges and get resolved into the bar.
- **A tie-breaker for genuine design disagreement** — when two senior people disagree on a *design* question (not a defect), there's a path: escalate to a tech lead, take it to the design forum, or default to the author's call. The point is the disagreement doesn't deadlock the PR or get decided by stamina.

> **The calibration test:** if you can't write down, in one sentence, *why* a comment is blocking — "this is a real bug because X", "this breaks invariant Y", "this is an incompatible API change" — then it's a suggestion, not a block. Blocking requires a nameable correctness or design reason; taste does not qualify. Make that line explicit and calibrate it across the team, or your bar is whatever mood the reviewer is in.

---

## Core Concept 7 — Teaching the Bug-Hunt and the Design Eye

Correctness and design judgement do not scale by one staff engineer reviewing everything — they scale by *transferring the eye* to everyone else. The leverage move is to turn your own catches into the team's reflexes.

The mechanisms that actually work:

- **Postmortem-driven checklists.** This is the highest-yield practice in this whole topic. When an incident's root cause is traced to a *reviewable bug class* — a swallowed error, a missing nil check, an unbounded query, a race — the postmortem's action item is not "review more carefully." It is one of two concrete things: (1) *tool it away* — add the lint/type/test that makes this class auto-caught (Concept 1), or (2) if it genuinely can't be tooled, *add it to the review guide* with the incident as the worked example. The review guide becomes a living record of "bugs that hurt us, here's the shape to look for," each entry earned by a real outage. A checklist with provenance gets used; a generic one rots.
- **Review-the-reviews / pairing.** New reviewers pair with experienced ones, or have their reviews sampled and discussed. The senior person narrates *why* they flagged what they flagged and *why they ignored* the rest — the ignoring is half the skill. This transfers the order-of-operations and the bug-pattern instinct that no document fully captures.
- **Make the catch teach.** When a staff engineer catches a subtle bug in review, the comment explains the *class*, not just the instance: "this is a TOCTOU race — the check and the use aren't atomic; here's the general pattern and how to recognize it." The author and every future reader learns a category, not a one-off fix.

The throughline with Concept 1: **the *first* choice for any recurring bug class is to tool it away; teaching is for what's left.** Don't teach humans to be a linter for a thing a linter can do. Teach them the judgement a linter can't — the design eye, the wrong-but-valid sense, the system-fit instinct — and tool away the mechanical.

> **The multiplier:** a bug you catch in one PR is worth one bug. A bug *class* you turn into a lint rule is worth every future instance, caught automatically. A bug class you teach the team to see is worth every future instance the tool can't catch. Rank your effort in exactly that order: tool it, then teach it, then — only as a last resort — keep catching it by hand.

---

## Core Concept 8 — Knowing the Limits of Review

The final piece of professional judgement is knowing what review *cannot* reliably do, and refusing to lean on it for those things. Review is a genuinely good defect filter for *some* classes and a genuinely bad one for others, and pretending otherwise is how teams ship the bug everyone "reviewed."

What review is *bad* at, and must be paired with the right tool:

- **Concurrency correctness.** Eyes do not reliably catch data races, deadlocks, or memory-ordering bugs — they're nondeterministic and the buggy interleaving is rarely the one you imagine while reading. *This is a sanitizer's job* (`-race`/TSan, ASan), plus stress tests and, for the hardest cases, model checking. "It looks thread-safe to me" is not evidence.
- **Memory safety in unsafe languages.** Use-after-free, buffer overruns, uninitialized reads — review catches a fraction; ASan/Valgrind/MSan and fuzzing catch them systematically. Don't rely on review to catch what a sanitizer should.
- **Boundary and input-space bugs.** The off-by-one in the case you didn't think to read, the input that overflows, the round-trip that loses data — *property-based tests and fuzzing* explore the space a human reader can't.
- **Performance regressions.** Review can flag an obvious N+1 or a hot-loop allocation, but it cannot reliably predict a regression — that needs a benchmark and a profiler (see [04 — Security & Performance Review](../04-security-and-performance-review/professional.md)).

The corollary is the staff engineer's allocation rule: **never spend human review as the primary defense for a defect class a tool defends better.** If a change introduces concurrency, the gate is "does this run under the race detector in CI?", not "did three people read it and feel okay?" If it parses untrusted input, the gate is a fuzz harness, not careful reading. Review is the *complement* to types/tests/sanitizers/fuzzing, not a substitute — and a mature org sizes each gate to what it's actually good at.

> **The limit, stated plainly:** review is a reliable filter for *design, intent, and human-only correctness* and an unreliable filter for *concurrency, memory safety, boundary, and performance* defects. Match the gate to the defect class. A team that relies on review to catch races will ship races; a team that runs TSan in CI and reviews for design will catch both.

---

## War Stories

**The race that passed review four times.** A queue implementation had a subtle data race — a check-then-act on a shared counter without a lock. It passed review repeatedly; three senior engineers read it and the code *looked* correct, because the buggy interleaving never occurs to a human reading top-to-bottom. It surfaced in production as rare, unreproducible corruption. The fix was small. The *real* fix was a rule: **concurrency correctness is not a review deliverable — it's a sanitizer deliverable.** The team wired `-race` into CI, made it a required gate for any package touching shared state, and added "if it's concurrent, it runs under TSan; eyes are not enough" to the review guide. The race detector caught two more latent races in the existing codebase within a week — bugs that had also "passed review." The lesson generalized: when review keeps missing a defect class because the defect is nondeterministic, stop reviewing harder and reach for the tool that detects it deterministically.

**The "safe" API change that broke a dozen callers.** A team owned an internal library and tightened a function: it had silently lowercased an input; the new version returned an error for mixed-case input instead, which was "more correct." The PR was reviewed as obviously fine — the documented contract said nothing about case. Within a day, a dozen downstream services broke, because they had all (unknowingly) relied on the silent-lowercasing behavior that was never promised. Pure Hyrum's Law: an *observable* behavior, depended upon, even though it was undocumented. The change was reverted, then re-landed behind a new explicit parameter with the old behavior as default. The durable fix was governance: the library adopted **contract tests recorded against its top real consumers** and a rule that any change altering observable behavior — not just the signature — is a breaking change requiring the deprecation path. The reviewer's eye couldn't see the dozen invisible callers; the contract tests could.

**The architecture that eroded one PR at a time.** A service started with a clean separation: a domain layer that knew nothing about HTTP, a transport layer on top. Over a year, PR by PR, the boundary dissolved — a `*http.Request` passed "just this once" into a domain function to read a header, then a domain type that imported the JSON tags from the transport package, then business logic reaching into request context. *Every one of these PRs was approved*, because each, in isolation, was a small reasonable change that broke nothing. No point reviewer was wrong. A staff engineer reviewing a feature finally saw the trajectory — the domain layer now had eleven transport imports — and named the invariant nobody had been enforcing: *the domain layer does not import transport.* The fix had two parts: a refactor to reverse the drift, and an **`import-linter` rule that fails CI** if the domain package imports transport. The invisible derivative became a mechanical gate. The instituting move that prevented the *next* erosion was requiring a one-page design doc for any change that touched the layer boundary, so the "just this once" conversation happened in prose, upstream, where saying no was cheap.

**The bug class that got typed away.** A payments codebase kept shipping a specific bug: amounts handled as bare `int64` cents in some places and `float64` dollars in others, with conversions scattered and occasionally wrong. It produced a steady trickle of off-by-100 and rounding incidents, each caught in review *sometimes* and missed *sometimes* — exactly the unreliable-filter signature. The team's instinct was to add it to the review checklist ("watch for money unit confusion"). A staff engineer made the better call: **type it away.** They introduced a single `Money` type with an explicit currency and unit, no implicit conversions, arithmetic only between same-currency values, and parsing only at the boundary — *make illegal states unrepresentable*. The mixed-unit bug became a compile error. The review comment that had been written dozens of times never needed writing again. The migration cost real effort; it paid for itself the first quarter, and protected every engineer who joined afterward and every reviewer too tired to catch the conversion.

---

## Decision Frameworks

**Catch it with: types vs lint vs tests vs sanitizer vs human review.** Choose the *cheapest reliable* detector for the defect class.

| Defect class | Best primary detector | Human review's role |
|---|---|---|
| Format, dead code, unused, simple smells | Linter / formatter | None — should never reach review |
| Null/nil deref, missing case, illegal state | **Type system** (Option, sum types, non-null) | None if typed away; else design feedback |
| Data race, deadlock, memory-order | **Sanitizer** (TSan), stress, model check | Review the *design*; trust the tool for mechanics |
| Use-after-free, overflow, uninit (unsafe langs) | **ASan/MSan/Valgrind + fuzz** | Spot-check; do not rely on eyes |
| Off-by-one, boundary, round-trip, invariants | **Property-based test / fuzz** | Sanity check; tool explores the space |
| Unhandled error paths | errcheck-style lint / exhaustive match | None if linted |
| Wrong-but-valid (misread requirement) | **Human review** (knows intent) | Primary — this is the job |
| Missing requirement / spec case | **Human review** + spec/test review | Primary |
| API evolvability / compatibility | Contract/schema-compat tooling **+ human** | Primary for judgement; tool detects the break |
| Architectural fit / drift | **Human (trend) + fitness function** | Primary for naming the invariant; tool enforces it |

**Block vs suggest — correctness vs design.**

| Situation | Verdict | Why |
|---|---|---|
| A real, describable defect | **Block** | Correctness is non-negotiable |
| A broken system invariant | **Block** | Names a concrete failure |
| Incompatible change to a governed API | **Block** | Goes through deprecation or not at all |
| Missing test for genuinely risky logic | **Block** (per team bar) | Risk-proportionate |
| A wrong-but-valid behavior vs the spec | **Block** | The change does the wrong thing |
| A clearly-better design, no correctness issue | **Suggest** | Author's call; offer the reasoning |
| Naming / structure / style preference | **Suggest** (or let the linter own it) | Taste is not a gate |
| A micro-optimization with no measured need | **Suggest** | Speculative |

**Design review: upstream RFC vs in-PR.**

| Change shape | Where to review the design | Rationale |
|---|---|---|
| Trivial / localized, no new API | In-PR, normal | Upstream ceremony would be pure overhead |
| New cross-module interface or data model | **Draft PR / prototype first** | Get the shape right before polish |
| Crosses team boundaries / picks an architecture | **Design doc / RFC + forum** | Cheap to change direction; cross-team eyes |
| Public or versioned API change | **RFC + compat review** | Evolvability and Hyrum's Law need upstream thought |
| Touches a known-eroding invariant | **One-page design doc** | Make the "just this once" conversation explicit |

**When a recurring bug class should be tooled away vs reviewed.**

| Signal | Action |
|---|---|
| The bug is deterministic / pattern-matchable | **Tool it** (lint/type) — never review for it again |
| The bug class can be made unrepresentable by a type/API | **Type it away** — highest leverage |
| The bug is nondeterministic (race, memory) | **Sanitizer/fuzz gate** — eyes are unreliable here |
| The same review comment recurs across many PRs | The comment is a missing tool/type — **invest in the tool** |
| An incident root-caused to this class | **Tool it; if truly un-toolable, add to the review guide** with the incident |
| Genuinely needs human judgement (intent/design) | **Keep in review** — and *teach* the eye |

---

## Mental Models

- **A human is the wrong detector for any bug a machine can catch, and the only detector for the bugs that matter most.** Push the mechanical down to tooling; spend the scarce human attention on design, intent, and system-fit. The split *is* the job.

- **The best correctness review is the one that makes a bug class unreviewable.** A type that forbids the bug, or a lint that auto-catches it, beats a thousand careful catches — it protects every future author and every tired reviewer. Make illegal states unrepresentable; then there's nothing to review.

- **In-PR "wrong approach" feedback is a symptom of a missing upstream step.** The expensive design conversation belongs in a draft, a doc, or a forum — *before* the code exists, where changing direction is free. Route changes to the right altitude.

- **No single PR is wrong, but the system is eroding.** Architectural drift is a derivative — invisible per-frame, ruinous across time. The staff engineer reviews the trajectory, names the eroding invariant, and encodes it as a fitness function so the architecture defends itself.

- **With enough users, every observable behavior is depended upon.** Hyrum's Law means any change can be a breaking change. Review public APIs for evolvability, gate on backward-compat with tooling, and treat deprecation as a managed process with data — not a delete.

- **Blocking requires a nameable correctness or design reason; taste does not qualify.** If you can't say in one sentence why it's a block — real bug, broken invariant, incompatible API — it's a suggestion. Calibrate that line across the team or the bar is a lottery.

- **Review is a complement to tests, types, and sanitizers — never a substitute.** It's a reliable filter for human-only defects and an unreliable one for concurrency, memory, boundary, and performance. Match the gate to the defect class.

---

## Common Mistakes

1. **Spending human review on machine-catchable defects.** A staff engineer pointing out a format issue or an unhandled error a linter would flag is burning the org's scarcest resource on a job a CPU does better and forever. Tool it; don't review it.

2. **Reviewing harder instead of typing the bug away.** When the same correctness comment recurs across PRs, the comment is a *missing type or API*. Adding it to a checklist is the weak fix; making the bug unrepresentable is the leverage.

3. **Letting "wrong approach" feedback land in the PR.** If you're rewriting the architecture in comments on a finished diff, the upstream step was skipped. The cost is already sunk. Route non-trivial changes through a draft/doc/forum first.

4. **Being blind to drift because each PR is fine.** Approving every reasonable-looking step of an erosion is how a clean architecture dies. Review the *trend*, name the eroding invariant, and encode it as a fitness function in CI.

5. **Reviewing a public API change against only the documented contract.** Hyrum's Law guarantees something undocumented is depended upon. Detect *observable* behavior changes (with contract/schema-compat tooling), gate on backward-compat, and run deprecation as a process.

6. **Blocking on taste.** A staff engineer who blocks a PR on a naming or structure preference corrodes the bar more than any lenient reviewer. If you can't name the correctness/design reason in a sentence, it's a suggestion the author may decline.

7. **Relying on review to catch races, memory bugs, or boundary errors.** Eyes are an unreliable filter for nondeterministic and input-space defects. "It looks thread-safe" is not evidence. Gate on TSan/ASan/fuzz; review for design.

8. **Letting an incident's lesson be "review more carefully."** That action item does nothing. When a postmortem root-causes a reviewable bug class, *tool it away*, or — only if truly un-toolable — add it to the review guide with the incident as the worked example.

---

## Test Yourself

1. A subtle data race passes review three times because the code "looks correct," then corrupts data in production. What's the wrong lesson, the right lesson, and the concrete fix?
2. Explain "make illegal states unrepresentable" as an *org strategy*, with one example of a recurring review comment that signals a missing type — and what you'd build instead.
3. Why is in-PR "this is the wrong approach" feedback a symptom rather than the problem? What upstream mechanisms make that feedback cheap, and how do you decide which changes need them?
4. A clean layered architecture eroded one approved PR at a time. Why can't a single-PR reviewer catch this, and what are the four things a staff engineer does about it?
5. A function is tightened to be "more correct" and a dozen internal callers break, though the documented contract was unchanged. Name the law, explain the mechanism, and give the governance fix.
6. Write the one-sentence test that distinguishes a *block* from a *suggestion* for correctness/design, and list three things that always block and three that never do.
7. A specific bug class keeps recurring and is caught in review only *sometimes*. Walk through how you decide between tooling it away, typing it away, and adding it to the review guide.
8. Which defect classes is human review a *bad* filter for, and what gate should defend each instead?

<details>
<summary>Answers</summary>

1. **Wrong lesson:** "review more carefully." Humans don't reliably catch races — the buggy interleaving isn't the one you imagine while reading top-to-bottom, so staring harder won't help. **Right lesson:** concurrency correctness is a *sanitizer* deliverable, not a review deliverable. **Fix:** wire `-race`/TSan into CI as a required gate for any package touching shared state, add "if it's concurrent, it runs under TSan; eyes aren't enough" to the review guide, and refocus human review on the concurrency *design*.

2. It's the strategy of designing types/APIs so a whole bug class *cannot be written* — removing it from the set of things review must check, which shrinks the reviewable-bug surface for every future author. **Example:** a recurring "did you handle the empty case?" comment signals a missing *non-empty list* type; build that type so emptiness isn't representable and the comment is never needed again. (Same for `Money`/units, `Email` instead of `string`, sum types for exhaustive cases, a connection type whose lifecycle the type system enforces.)

3. Because by the time wrong-shape feedback lands in a PR, the author has already invested days — the cost is sunk and you're choosing between throwing work away and rationalizing it. **Upstream mechanisms** (cheapest first): draft PR / prototype of the *approach*, design doc / RFC / ADR for the decision, a design-review forum for cross-team eyes — all *before* implementation. **Deciding:** trivial/localized changes go straight to a PR; anything where "wrong approach" would be costly (new cross-module interface, crosses teams, picks an architecture, public API) gets an upstream pass. Don't RFC everything — protect the fast path.

4. A single-PR reviewer sees the diff, not the trajectory; drift is a *derivative* — each step is locally reasonable and breaks nothing, so it's invisible in any one frame. The staff engineer (a) reviews the *trend* across PRs, (b) *names the eroding invariant* explicitly ("domain doesn't import transport"), (c) *encodes it as a fitness function* (`import-linter`/`ArchUnit`) that fails CI, and (d) *schedules the paydown* refactor with an owner.

5. **Hyrum's Law:** with enough consumers, every *observable* behavior — including undocumented quirks like silent lowercasing — is depended upon, so a change "safe" by the documented contract still breaks callers. **Fix:** revert; re-land the new behavior behind an explicit opt-in with the old behavior as default; adopt **contract tests recorded against top real consumers** plus schema-compat tooling; and make "any change to observable behavior is a breaking change requiring the deprecation path" a gate.

6. **Test:** *if you can't state in one sentence why a comment is blocking — "real bug because X," "breaks invariant Y," "incompatible API change" — it's a suggestion, not a block.* **Always block:** a real describable defect; a broken invariant; an incompatible governed-API change (also: missing test for genuinely risky logic; wrong-but-valid vs the spec). **Never block:** naming/structure preference; style a linter doesn't flag; a preference between two correct designs (or a speculative micro-optimization).

7. First ask: **is it deterministic/pattern-matchable?** → *tool it* (lint), never review for it again. **Can a type/API make it unrepresentable?** → *type it away* (highest leverage; e.g. the `Money` type for unit confusion). **Is it nondeterministic?** → *sanitizer/fuzz gate*, not eyes. Only if it's *genuinely un-toolable and needs human judgement* (intent/design) do you add it to the review guide — and if an incident root-caused it, attach the incident as the worked example so the entry gets used.

8. Human review is a **bad** filter for: **concurrency** (races/deadlocks/memory-order → TSan + stress/model checking); **memory safety** in unsafe languages (use-after-free/overflow/uninit → ASan/MSan/Valgrind + fuzz); **boundary/input-space** bugs (off-by-one/overflow/round-trip → property-based tests + fuzz); **performance regressions** (→ benchmark + profiler). Match the gate to the defect class; review for design.

</details>

---

## Cheat Sheet

```
THE LEVERAGE SPLIT (the whole topic in one rule)
  mechanical / machine-catchable  → PUSH DOWN to tooling (lint/type/sanitizer/test/fuzz)
  design / intent / system-fit    → KEEP in human review (the only thing eyes do best)
  rank effort: TOOL it ▸ then TYPE it away ▸ then TEACH it ▸ then (last) catch by hand

CATCH IT WITH
  format, dead code, unused        → linter
  null/nil, missing case           → TYPE system (Option, sum types)
  data race, deadlock              → SANITIZER (-race/TSan)   [not eyes]
  use-after-free, overflow         → ASan/MSan + FUZZ          [not eyes]
  off-by-one, boundary, round-trip → property test / fuzz
  unhandled errors                 → errcheck-style lint
  wrong-but-valid, missing req     → HUMAN (knows intent)
  API compat / evolvability        → contract/schema tooling + HUMAN
  architectural drift              → HUMAN (trend) + fitness function in CI

MAKE ILLEGAL STATES UNREPRESENTABLE
  recurring review comment  = a missing type/API → build it, kill the comment forever
  parse don't validate; sum types for cases; units in the type; lifecycle in the type

DESIGN REVIEW ALTITUDE (cheapest direction-change first)
  doc/RFC ▸ draft/prototype ▸ open PR ▸ merged   (cost rises left→right)
  in-PR "wrong approach" = a SKIPPED upstream step

API / HYRUM'S LAW
  "every observable behavior is depended on by someone"
  observable change (sig/wire/error/order/timing) + not backward-compat = BLOCK
  deprecate (announce ▸ instrument ▸ migrate ▸ remove), never just delete
  detect breaks with contract/golden/schema-compat tooling

BLOCK vs SUGGEST
  block  = nameable correctness/design reason (real bug / broken invariant / incompat API)
  suggest = taste (naming, structure, style, preference) — author may decline
  can't name why it's blocking in one sentence? → it's a suggestion

DRIFT
  no single PR is wrong, system is eroding → name the invariant → encode as fitness fn

LIMITS OF REVIEW
  bad filter for: concurrency, memory safety, boundary, performance
  → gate those on TSan/ASan/fuzz/benchmark, NOT on "looks fine to me"
```

---

## Summary

- **The leverage question reshapes the whole activity:** humans are slow, expensive, unreliable detectors for any defect a machine can catch — and the only detector for design, intent, and wrong-but-valid. Push mechanical correctness *down* to tooling ([static analysis](../../static-analysis/), [sanitizers](../../dynamic-analysis-and-sanitizers/), [tests](../../testing/), fuzzing); spend the scarce human attention *up* on what only humans see.
- **The highest-leverage correctness review is often not in a PR at all** — it's the type, lint, or sanitizer gate that makes a bug class unreviewable. *Make illegal states unrepresentable* as an org strategy: when a review comment recurs, build the type/API that kills it forever.
- **Move design review upstream.** In-PR "wrong approach" feedback is a symptom of a missing step — the expensive conversation belongs in a draft, doc, RFC, or forum *before* the code exists. Route each change to the right altitude; protect the fast path for trivial ones.
- **Catch architectural drift across PRs.** No single PR is wrong, but the system erodes one reasonable change at a time. The staff engineer reviews the trajectory, names the eroding invariant, and encodes it as a fitness function so the architecture defends itself in CI.
- **Govern APIs against Hyrum's Law.** Every observable behavior is depended upon, so any change can be breaking. Review public APIs for evolvability, gate on backward-compat with contract/schema tooling, and run deprecation as a managed, data-driven process.
- **Calibrate the bar.** Block only on a nameable correctness/design reason — real bug, broken invariant, incompatible API; never on taste. Make the line explicit and align it across the team with a written bar and review-the-reviews.
- **Teach the eye and know the limits.** Turn catches into the team's reflexes via postmortem-driven checklists and pairing — but tool the mechanical away first. Review is a *complement* to types/tests/sanitizers, never a substitute, and an unreliable filter for concurrency, memory, boundary, and performance defects.

You can now operate correctness and design review as an org-scale system: tooling for the mechanical, human judgement for the irreducible, upstream forums for the expensive, governance for the API surface, and calibration so the bar holds regardless of who reviews. The final tier — [interview.md](interview.md) — consolidates the topic into the questions that probe whether someone actually understands all of this.

---

## Further Reading

- **Winters, Manshreck & Wright — *Software Engineering at Google*** — the canonical treatment of Hyrum's Law, deprecation as a managed process, and review at scale (the "what reviewers actually look for" and API-change chapters).
- **John Ousterhout — *A Philosophy of Software Design*** — deep modules, narrow interfaces, designing-it-twice, and the design-review eye that this page operationalizes for review.
- **The Google Engineering Practices "Code Review Developer Guide"** — public and definitive on what to look for and how to keep design feedback proportionate.
- **Scott Wlaschin — *Domain Modeling Made Functional* / "Designing with types"** — the practical playbook for *make illegal states unrepresentable* and *parse, don't validate*.
- **Google SRE / postmortem-culture references** (the SRE books, the blameless-postmortem literature) — the discipline of turning an incident's reviewable-bug root cause into a tool or a checklist entry, not "be more careful."
- For the language-specific bug-pattern hunt and the order of operations at the level of a single change, return to [senior.md](senior.md); for the consolidated question set, see [interview.md](interview.md).

---

## Related Topics

- [01 — What to Look For & In What Order](../01-what-to-look-for-and-order/professional.md) — the order-of-operations this page builds on; correctness and design are its first two passes, here scaled across an org.
- [04 — Security & Performance Review](../04-security-and-performance-review/professional.md) — the same "what to read for vs what needs a tool/benchmark" split, applied to the security and performance dimensions.
- [Static Analysis & Linting](../../static-analysis/) — where mechanical correctness checks live so human review stays on design and intent.
- [Dynamic Analysis & Sanitizers](../../dynamic-analysis-and-sanitizers/) — the deterministic gate for concurrency and memory bugs that review is an unreliable filter for.
- [Testing](../../testing/) — property-based tests and fuzzing as the gate for boundary and input-space defects that eyes miss.
