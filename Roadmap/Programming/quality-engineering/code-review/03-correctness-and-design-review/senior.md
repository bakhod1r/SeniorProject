# Correctness & Design Review — Senior Level

> **Roadmap:** [Code Review](../README.md) → Correctness & Design Review
> *The middle page taught you the bug patterns to scan for. This page is about the level above pattern-matching: reasoning from invariants and valid-state sets to whether every path preserves them, naming the deep bug classes with the rigor they need, and judging not "does it work" but "what will this shape cost in two years" — and saying so as the first comment, with a concrete alternative, while it's still cheap to change.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — Reasoning About Correctness: Invariants and the Valid-State Set](#core-concept-1--reasoning-about-correctness-invariants-and-the-valid-state-set)
5. [Core Concept 2 — Make Illegal States Unrepresentable, as a Review Lens](#core-concept-2--make-illegal-states-unrepresentable-as-a-review-lens)
6. [Core Concept 3 — Concurrency Bug Classes, Named Precisely](#core-concept-3--concurrency-bug-classes-named-precisely)
7. [Core Concept 4 — Error and Failure Paths: the Least-Tested, Most-Buggy Code](#core-concept-4--error-and-failure-paths-the-least-tested-most-buggy-code)
8. [Core Concept 5 — Boundary, Numeric, Aliasing, and Time](#core-concept-5--boundary-numeric-aliasing-and-time)
9. [Core Concept 6 — Reviewing What Is *Not* in the Diff](#core-concept-6--reviewing-what-is-not-in-the-diff)
10. [Core Concept 7 — Design Review as Evolvability](#core-concept-7--design-review-as-evolvability)
11. [Core Concept 8 — API and Contract Review: Hyrum's Law and Reversibility](#core-concept-8--api-and-contract-review-hyrums-law-and-reversibility)
12. [Core Concept 9 — The Timing and Leverage of Design Feedback](#core-concept-9--the-timing-and-leverage-of-design-feedback)
13. [Core Concept 10 — When a Concern Needs a Test, Not a Code Change](#core-concept-10--when-a-concern-needs-a-test-not-a-code-change)
14. [Real-World Examples](#real-world-examples)
15. [Mental Models](#mental-models)
16. [Common Mistakes](#common-mistakes)
17. [Test Yourself](#test-yourself)
18. [Cheat Sheet](#cheat-sheet)
19. [Summary](#summary)
20. [Further Reading](#further-reading)
21. [Related Topics](#related-topics)

---

## Introduction

> Focus: **Reasoning about correctness from invariants and valid states rather than pattern-matching, the deep bug classes a senior reviewer holds in working memory, and design feedback judged on evolvability and delivered while it is still cheap.**

By the middle level you scan for a known set of hazards: off-by-one, swallowed errors, nil dereferences, resource leaks, the obvious data race. That checklist catches the bugs that look like bugs. The bugs that reach production rarely look like bugs in the diff — they look like reasonable code that quietly breaks something true elsewhere. The senior jump is to stop matching patterns and start *reasoning*: what must always hold for this code to be correct, what are the legal states, and does every path — including the error path, the concurrent path, the boundary path — preserve them?

That reframing turns review from a syntax-level scan into a semantic argument. You no longer ask "is there a known anti-pattern on this line"; you ask "what is the invariant this function relies on, and is there *any* interleaving, *any* error, *any* input at the edge that violates it." Held that way, the deep bug classes stop being a list to memorize and become a set of *questions* you ask of state: can two goroutines observe this between the check and the act; what is left half-mutated if this call returns an error; what happens at `MaxInt`, at the empty slice, at the daylight-saving boundary.

The other half of senior review is **design judgment**, and its defining property is *time*. Correctness asks "does it work now." Design asks "what will this shape cost the next twenty engineers who touch it." A new coupling, a leaky abstraction, an interface that can't grow without breaking callers — these don't fail CI; they fail slowly, over quarters, as the code calcifies around a decision nobody can now reverse. The senior skill is recognizing the wrong shape fast, knowing whether the decision is a one-way or two-way door, and giving that feedback *first* and *early* — with a concrete alternative — because design feedback is nearly free upstream and ruinous on a finished PR. This page is that layer.

---

## Prerequisites

- **Required:** You've internalized [middle.md](middle.md) — the bug-pattern checklist (off-by-one, swallowed errors, nil derefs, leaks, edge cases) and how to flag a correctness concern with a severity label.
- **Required:** You've approved a change that was individually correct and still broke production — and traced it to an invariant the diff silently violated.
- **Helpful:** You've owned an abstraction long enough to regret its shape, and felt the cost of a design comment that arrived after the PR was "done."
- **Helpful:** A working memory of your language's concurrency and memory model — what is and isn't atomic, what `happens-before` means, what your race detector actually checks.

---

## Glossary

- **Invariant** — a property that must hold at every observable point in a program's execution (e.g. "balance is never negative", "the cache and the DB agree", "len(keys) == len(values)"). Correctness *is* the set of invariants and the proof that every path preserves them.
- **Valid-state set** — the subset of all representable states that the program is allowed to be in. Bugs are paths that move the program into a representable-but-invalid state.
- **Illegal state** — a representable state outside the valid-state set. "Make illegal states unrepresentable" means using types so the invalid state cannot be constructed at all.
- **Data race** — two threads access the same memory concurrently, at least one writes, with no synchronization. Undefined behavior in most memory models. Detected by TSan.
- **Race condition** — a correctness bug arising from the *timing* of operations, even when each operation is individually synchronized (e.g. a TOCTOU gap). A superset of, and distinct from, data races.
- **Atomicity violation** — a sequence that must be indivisible (check-then-act, read-modify-write) is interrupted, leaving the invariant broken even though each step locked correctly.
- **Idempotency** — `f(f(x)) == f(x)`; an operation safe to apply more than once. The property that makes at-least-once delivery and retries survivable.
- **Hyrum's Law** — "with a sufficient number of users, every observable behavior of your system will be depended on by somebody," regardless of your documented contract.
- **One-way / two-way door** — a decision that is expensive to reverse (data format, public API, schema) vs one that is cheap to reverse (an internal helper, a private field). Sets how much review scrutiny it deserves.
- **Leaky abstraction** — an abstraction that forces callers to understand the implementation it claims to hide (a "thread-safe" map whose iteration isn't, an ORM that needs hand-tuned SQL to perform).

---

## Core Concept 1 — Reasoning About Correctness: Invariants and the Valid-State Set

Pattern-matching asks "have I seen this bug before." Reasoning asks "what must be true here, and is it." The unit of that reasoning is the **invariant**: a property the code assumes holds, written down or not. A function is correct when, given its preconditions, every path through it re-establishes its postconditions and preserves the data structure's invariants. Review at the senior level is the search for the *one path* that doesn't.

Make this concrete. Here is a withdrawal:

```go
func (a *Account) Withdraw(amount int64) error {
    if a.balance < amount {
        return ErrInsufficientFunds
    }
    a.balance -= amount
    a.ledger = append(a.ledger, Entry{Debit: amount})
    return nil
}
```

The invariants are: (1) `balance >= 0` always; (2) `balance == initial - sum(ledger debits) + sum(credits)` — the balance and the ledger never disagree. Now reason path by path. Single-threaded, the guard holds invariant (1) and the two mutations keep (2) consistent. But ask the question that pattern-matching skips: *is this the only caller, and is it ever called concurrently?* If two goroutines call `Withdraw` on the same account, both can pass the `balance < amount` check before either subtracts — and invariant (1) is gone. The code has no syntactic bug. It has an **atomicity violation**: the check-then-act is not indivisible. You cannot see this by reading the line; you see it by asking what must hold and whether the timing can break it.

> **Key insight:** A correctness review is not "find the bad line." It is "state the invariant, then hunt for the path — the input, the interleaving, the error — that violates it." If you can't articulate the invariant, you can't review the correctness; you're only checking syntax. The first question on any non-trivial change is *"what must always be true here?"*

The second move is to enumerate the **valid-state set** and look for paths into the representable-but-invalid region. A connection that is `{open, closed}` has two valid states; a bug is the path that produces "closed but still in the active pool." Most deep bugs are not crashes — crashes are loud. They are silent transitions into an invalid state that *looks* fine until a later operation trusts the broken invariant and corrupts data, double-charges a card, or serves a stale read.

---

## Core Concept 2 — Make Illegal States Unrepresentable, as a Review Lens

The strongest correctness review sometimes ends in "the type system should have caught this." When you find a bug that is a transition into an illegal state, the senior follow-up question is: *could the code have been shaped so that state was impossible to construct?* This is the **make-illegal-states-unrepresentable** lens, and it converts a runtime bug into a compile error for everyone who ever touches the code again.

Consider a config that arrives in a review:

```go
type Connection struct {
    IsConnected bool
    Socket      *net.Conn   // valid only when IsConnected
    RetryCount  int         // meaningful only when !IsConnected
}
```

Pattern-matching sees nothing wrong. Reasoning sees four representable combinations of `IsConnected` and `Socket`, but only two are *valid*: connected-with-socket and disconnected-without. The other two — "connected but nil socket", "disconnected but live socket" — are illegal states the type permits. Every consumer must now defensively check `IsConnected` before touching `Socket`, and the first one that forgets is a nil deref. The review comment is not "add a nil check"; it's "this models two illegal states — make them unrepresentable":

```go
type Connection struct {
    State connState   // a sum type / sealed interface
}
type Connected    struct{ Socket net.Conn }   // socket exists by construction
type Disconnected struct{ RetryCount int }     // no socket field exists at all
```

Now "connected with a nil socket" cannot be written down. The whole class of nil-deref bugs is gone, not patched. In Go you reach for a sealed interface or distinct types; in Rust an `enum`; in TypeScript a discriminated union; in any language, "parse, don't validate" — push the invariant into a type at the boundary so the interior can assume it.

> **Key insight:** The highest-leverage correctness comment is often a *design* comment: not "guard this state" but "make this state impossible." A nil check protects one call site; an illegal state made unrepresentable protects every call site, forever, including the ones not written yet. When you spot a defensive check, ask whether the defense could be a type.

Use the lens with judgment — not every boolean needs to become a sum type, and over-modeling is its own smell. But when a bug *is* an illegal-state transition, "could the types have prevented this" is the question that turns a one-line fix into a permanent one.

---

## Core Concept 3 — Concurrency Bug Classes, Named Precisely

Concurrency is where pattern-matching fails hardest, because the bug is in the *interleaving*, which the diff never shows. The senior reviewer carries a precise taxonomy, because the fix differs by class. Conflating them — "just add a lock" — produces code that looks locked and isn't.

| Class | What it is | Why a lock may not fix it |
|---|---|---|
| **Data race** | Concurrent access, ≥1 write, no synchronization | A lock *does* fix it — if every access takes the *same* lock |
| **Race condition** | Wrong result due to timing, even with locks | The locked region is too small; the *sequence* isn't atomic |
| **Atomicity violation** | Check-then-act / read-modify-write interrupted | Each step locked, but not as one critical section |
| **Deadlock** | Threads wait on each other's locks forever | Adding locks *causes* it; lock *ordering* is the fix |
| **Livelock** | Threads keep retrying, never progress | Backoff/jitter, not more locking |

The two hazards to hunt for by name are **check-then-act** and **read-modify-write**. The `Withdraw` example in Concept 1 is check-then-act. Here is read-modify-write:

```go
// reviewer's question: is `counter` touched by more than one goroutine?
counter = counter + 1     // load, add, store — three steps, not one
```

If yes, this is a data race *and* a lost-update bug. The fix is `atomic.AddInt64` or a mutex around the whole load-add-store — not around the `+` alone. The reviewer's discipline is to find every piece of shared mutable state, identify which mutations are compound (check-then-act, RMW), and verify each compound op is a single critical section.

Two subtler classes round out the hunt. **Visibility / memory-model** bugs: a write on one thread is not guaranteed to be *seen* by another without a synchronizing operation — a `done bool` polled in a loop without a fence can spin forever even after the writer set it. **Reentrancy**: a function that holds a lock and then calls back into code that takes the *same* lock self-deadlocks (or, with a recursive mutex, silently re-enters a half-updated structure). And the one that defeats reading entirely — the "looks locked but isn't": the field is guarded by `mu` on three paths and accessed without it on the fourth, or guarded by *different* mutexes on different paths.

> **Key insight:** You cannot reliably find a data race by reading, because the bug is an interleaving, not a line. The correct senior move is to (a) reason explicitly about shared state and critical-section boundaries, and (b) **demand the dynamic evidence** — require the change to run under the race detector (TSan / `go test -race`) in CI. Reading establishes *suspicion*; the sanitizer establishes *proof*. See [Dynamic Analysis & Sanitizers](../../dynamic-analysis-and-sanitizers/).

---

## Core Concept 4 — Error and Failure Paths: the Least-Tested, Most-Buggy Code

The happy path is read, tested, and demoed. The error path is none of those — which is exactly why it harbors the most bugs and deserves the most review attention per line. The senior reviewer reads the *failure* paths first, because that's where the invariants quietly break.

The deepest class is **partial failure**: an operation that mutates several things and fails partway, leaving the system in an invalid intermediate state.

```go
func (s *Service) Transfer(from, to *Account, amt int64) error {
    from.Withdraw(amt)            // succeeds, mutates `from`
    if err := s.persist(from); err != nil {
        return err               // BUG: `to` never credited, `from` debited and saved
    }
    to.Deposit(amt)
    return s.persist(to)         // if THIS fails: `from` saved, `to` not — money vanished
}
```

The invariant "money is conserved" breaks on the error path. The review questions are: *what is left half-done if this returns an error? Is cleanup ordered correctly? Is the operation atomic, or compensatable?* The fix is a transaction, a saga with compensation, or at minimum idempotency so a retry converges.

That leads to the **exactly-once illusion**. Distributed systems deliver at-least-once or at-most-once; "exactly-once" processing is achieved only by making the operation **idempotent** so duplicates are harmless. A reviewer who sees a retry must ask: *is the retried operation idempotent?* If `Transfer` is retried after a timeout that actually succeeded, does the money move twice? The companion hazard is the **retry storm**: every client retrying a struggling service in lockstep amplifies the load that caused the failure — the review asks for exponential backoff *with jitter* and a circuit breaker, not a bare `for` loop.

Three more failure-path checks belong in working memory:

- **Cancellation / context propagation.** Is the `context` (or `CancellationToken`) threaded through every blocking call, so a cancelled request actually stops work instead of orphaning a goroutine that mutates state after the caller gave up?
- **Resource lifetime under error.** The `defer Close()` / `try-with-resources` / RAII question: is every resource released on *every* path, including the early-return error path and the panic path? A `Close()` after the error return is a leak.
- **Error-path correctness, not just presence.** `if err != nil { return err }` is necessary, not sufficient. Does it return *before* the mutation or after? Does it leave the lock held? Does it wrap context so the caller can act? The error path has its own invariants.

> **Key insight:** Review the error paths with *more* scrutiny than the happy path, in inverse proportion to how well-tested they are. The bug that reaches production is rarely "the feature doesn't work" — it's "the feature half-works when its third dependency times out, and leaves the data wrong." Ask of every multi-step operation: *what's the state if it dies right here?*

---

## Core Concept 5 — Boundary, Numeric, Aliasing, and Time

Four bug classes share a trait: they live at the *edges* of value ranges and lifetimes, where the happy path's assumptions silently stop holding.

**Boundary & numeric.** Integer overflow is undefined or wrapping depending on language, and either is a bug when the value crosses `MaxInt`. The classic is the midpoint: `mid = (low + high) / 2` overflows when `low + high` exceeds the int range — the bug that sat in `binarySearch` in the JDK for years; `low + (high-low)/2` is the fix. Watch for **truncation** (`int64` → `int32`, `int` → `byte`), **signedness** (a `len()` compared against a signed counter that went negative), and **float** (using `==` on floats, accumulating money in `float64`, `NaN` propagating silently through a comparison that returns false for everything).

**Aliasing & shared mutable state.** Two references to the same underlying data, where mutating through one surprises the other:

```go
func process(data []int) []int {
    result := data[:0]          // ALIASES data's backing array
    for _, v := range data {
        if keep(v) { result = append(result, v) }  // overwrites data as it reads it
    }
    return result               // caller's slice is now corrupted
}
```

The reviewer's question: *does this function retain or mutate a reference the caller still owns?* Returning a sub-slice, storing a passed-in pointer in a struct, or sharing a map all create aliasing hazards.

**Time.** Three recurring bugs. **Monotonic vs wall clock**: measuring a duration with wall-clock time gives negative or huge durations when NTP steps or DST shifts — use a monotonic clock for elapsed time. **Ordering**: assuming two events with wall-clock timestamps from different machines can be ordered (clock skew makes this false; you need logical clocks or a sequence). **TOCTOU** (time-of-check-to-time-of-use): checking a file's permissions then opening it, or checking a quota then consuming it — the world can change in the gap, which is a race condition expressed in time.

> **Key insight:** These classes are invisible on the happy path *by construction* — they only trigger at the boundary, under aliasing, or in the timing gap. So you don't find them by reading the common case; you find them by deliberately asking, at each operation, "what is the value at the maximum? the empty case? who else holds this reference? what changes between the check and the use?"

There is also **API misuse the change enables**: not a bug in the diff, but a footgun the diff *creates* for the next caller — a function that must be called in a specific order, a returned object that must be closed, a slice that must not be retained. If the change adds a contract that's easy to violate, the review flags the *shape*, per Concept 2.

---

## Core Concept 6 — Reviewing What Is *Not* in the Diff

The most dangerous defects leave no mark on the changed lines. The diff shows what changed; correctness depends on the whole system, including the parts that *didn't* change but now run in a new world. (This is the diff-vs-change distinction from [01 — What to Look For & In What Order](../01-what-to-look-for-and-order/senior.md), applied to correctness.) Four absences to hunt for:

1. **The missing error handling.** A new call that can fail, whose error is dropped or whose `_` swallows it. The bug is the line that *isn't* there.
2. **The unhandled case.** A new variant added to an enum, a new status code, a new input shape — and the `switch`/`match` somewhere else that still has the old cases and silently falls through `default`. The compiler catches this only if your `switch` is exhaustive (another argument for the type lens in Concept 2).
3. **The absent test for the risky path.** The diff adds a retry, a lock, a boundary condition — and no test exercises it. The most under-tested code is the code most likely to be wrong; the missing test *is* a review finding.
4. **The caller that wasn't updated.** A function's contract changed — it now returns an error, takes an extra argument, may return nil, or no longer holds a lock on return — and one of its five callers still assumes the old behavior. You find this by *searching for callers*, not by reading the diff.

> **Key insight:** Train yourself to ask "what's missing?" as deliberately as "what's wrong?" The present code is reviewed by everyone; the *absent* code — the unhandled error, the un-updated caller, the test that should exist — is reviewed by almost no one, which is exactly why bugs hide there. Pull the branch and grep for callers when the contract moved.

---

## Core Concept 7 — Design Review as Evolvability

Correctness asks "does it work." Design asks "what will this cost in two years." A change can be flawlessly correct and still be a design defect — because it makes the *next* change harder. The senior lens is **evolvability**: the question is not the local quality of the code but its effect on the system's capacity to change.

The concrete things to evaluate:

- **Coupling introduced.** Does this change make two previously independent modules depend on each other? Does it reach across a boundary it shouldn't — a handler touching the database directly, a domain object importing the HTTP layer? New coupling is the tax that compounds; it's the difference between a future change touching one module and touching five.
- **Abstraction quality.** Are the seams in the right places? An abstraction is good when it lets you change the implementation without changing callers, and *bad* when it's **leaky** (forces callers to know the implementation) or **premature** (generalizes for a flexibility no one needs). Watch for the wrong cut: an interface with one implementation and a comment "for future flexibility" is usually speculative generality.
- **The DRY vs WET/AHA judgment.** Two pieces of code look the same — should they be unified? Only if they are the same *concept*, not coincidentally the same *text*. The senior call is **AHA** ("Avoid Hasty Abstractions") / "a little copying is better than a little dependency": premature deduplication couples two things that will need to evolve apart, and is harder to undo than duplication. The review question is "do these change together for the *same reason*?" If yes, DRY them; if they're coincidentally identical, leave them WET.
- **Effect on the system's shape.** Does the change deepen a module (more functionality behind a simple interface — good, per Ousterhout) or widen its interface (more surface for the same value — a complexity cost)? Deep modules are the goal; shallow modules that just pass calls through add interface without hiding anything.

> **Key insight:** The best design code is *deletable and changeable*, not clever. Before approving, ask "when the requirement changes — and it will — how many files does this shape force the next person to touch, and can they even find them all?" Code is read and changed far more than written; optimize the review for the reader two years out, not the author today.

The hardest design discipline is **reversibility**. Some decisions are two-way doors — an internal helper, a private method, a name — cheap to change later, so don't over-scrutinize them; "good enough" is genuinely good enough and holding for "perfect" is waste. Others are one-way doors — a persisted data format, a public API, a database schema, a wire protocol — expensive or impossible to reverse. *That* is where design review earns its cost, because the mistake you don't catch there is permanent.

---

## Core Concept 8 — API and Contract Review: Hyrum's Law and Reversibility

A public interface is the most one-way of doors, because of **Hyrum's Law**: *with a sufficient number of users, every observable behavior of your system will be depended on by somebody* — not the documented contract, the *observable* behavior. The order results happen to come back in, the exact error string, the timing, the fact that a field is never null in practice: someone is depending on all of it. So API review is the review where "what is observable" matters as much as "what is correct."

The checklist for any change to an interface others consume:

- **Backward compatibility.** Does this break existing callers? Adding a required parameter, removing a field, narrowing an accepted input, changing a return type — all break callers. Adding an *optional* parameter, a new field, a new method usually don't.
- **The error contract.** Errors are part of the API. Changing an error type, message, or code breaks callers who match on it (and by Hyrum's Law, some do). A function that "now also returns `ErrTimeout`" is an API change even though the signature didn't move.
- **Default-value and enum-extension hazards.** Adding an enum value breaks every consumer with a non-exhaustive switch and no default; changing a default value silently changes behavior for every caller who relied on the old one without specifying it. Both are stealth breaking changes that pass code review precisely because the signature looks unchanged.
- **Evolvability of the interface.** *Can this grow without breaking callers?* An endpoint that returns a bare array can never add metadata; one that returns `{ "items": [...] }` can. A function taking five positional booleans can't add a sixth cleanly; one taking an options struct can. The review pushes for shapes that have room to grow — which connects directly to [API versioning](../../../code-craft/) and deprecation strategy.

> **Key insight:** You cannot un-ship an API. By Hyrum's Law, the moment it has users, *every* observable property is a contract you must now preserve or version. So API review is the highest-leverage review there is — a design comment here saves a versioning migration, a deprecation cycle, or a permanent wart later. Treat every public signature, error, and default as a promise you're making to people you'll never meet.

---

## Core Concept 9 — The Timing and Leverage of Design Feedback

Design feedback has a brutal cost curve: it is nearly free upstream and ruinous on a finished PR. Telling someone "the shape is wrong" before they've written code costs a five-minute conversation. Telling them on a 1,200-line PR they spent a week on costs the week, plus the social weight of asking them to throw it away — which is exactly why so much design feedback gets swallowed and the wrong shape ships. The senior skill is to *move the feedback left* and, when it must come at review time, to deliver it with maximum leverage.

Moving it left means catching the shape *before* the code exists:

- **Design docs / RFCs** for anything that's a one-way door — a schema, a public API, a new service boundary. The shape gets reviewed when changing it is free.
- **Draft PRs and early prototypes.** A 50-line skeleton that shows the *shape* invites "is this the right structure?" before the 1,200 lines are written on top of it.
- **The first comment.** When design feedback does arrive at review, it must be the *first* thing said, not buried under nits. A reviewer who leaves twelve style comments and then, at the bottom, "also I think this whole approach is wrong" has wasted the author's time on code that may not survive.

And it must be **concrete**. "I'd do it differently" is not feedback; it's a veto with no path forward. The senior version names the problem, the cost, and a specific alternative:

> *"This couples the `Order` domain object to the HTTP request — `Order` now imports the web layer, so it can't be used from the batch job or tested without a request. Suggest taking the three fields you need as plain parameters: `func NewOrder(userID, sku string, qty int)`. Then the domain stays independent of transport. Happy to pair on it if useful."*

That comment is reusable, actionable, and acknowledges the cost. Compare it to "this is too coupled" — which is true, unhelpful, and adversarial.

> **Key insight:** The senior reviewer recognizes the wrong shape *fast* and says it *first*, with a concrete alternative — because design feedback's value decays to near-zero once the code is finished and the author is invested. The job is not to be right at the bottom of the thread; it's to be right early enough that being right is cheap.

The other half of timing judgment is knowing when to **stop**. Perfect is the enemy of shipped. If the decision is a two-way door — reversible, internal, low-blast-radius — and the code is *good enough*, approve it; holding for "right" on a reversible decision is its own anti-pattern. Save the hard line for one-way doors, where "good enough" isn't, because you can't fix it later. The reversibility test *is* the calibration: scrutiny should scale with the cost of being wrong.

---

## Core Concept 10 — When a Concern Needs a Test, Not a Code Change

Not every correctness concern resolves into a code change. Sometimes the code is probably right, but the *risk* is high and the *coverage* is zero — and the correct review outcome is to demand a test, not a rewrite. The senior reviewer distinguishes the two and pushes for whichever actually reduces risk.

The decision:

- **Push for a code change** when the code is *wrong* — the invariant is violated on a path, the illegal state is reachable, the error path corrupts data. Reasoning found a defect; fix the defect.
- **Push for a test** when the code is *plausibly right* but the path is risky, subtle, or regression-prone — the off-by-one boundary, the concurrent path (under `-race`), the error path that's never exercised, the parser on malformed input. A test pins the behavior so the *next* change can't silently break it, and it forces the author to actually run the risky path.

The under-appreciated case is the **regression test as the review deliverable**. When a change fixes a bug, the most valuable review comment is often "add a test that fails without this fix" — because the fix without the test will rot, and the bug will return the next time someone refactors. A property-based test earns its place where examples can't cover the space: serialization round-trips, invariants over generated inputs, "the output is always sorted." (See [Testing](../../testing/).)

> **Key insight:** "Is this right?" and "is this *proven* right and *protected* from regressing?" are different questions, and the senior reviewer asks both. When reasoning can't fully settle a correctness concern — and for concurrency and boundaries it often can't — the right move is to convert the concern into an executing test, not to argue it to a standstill in the thread. A test is a correctness argument that keeps running.

---

## Real-World Examples

**1. A concurrency review with the reasoning.** A PR adds a per-user rate limiter:

```go
func (l *Limiter) Allow(user string) bool {
    count := l.counts[user]        // read
    if count >= l.limit {
        return false
    }
    l.counts[user] = count + 1     // modify-write
    return true
}
```

The senior review, reasoning not pattern-matching: *Is `l.counts` shared across goroutines? Yes — it's a rate limiter, called from concurrent request handlers.* That makes this **both** a data race (concurrent map access in Go is an immediate crash) **and** an atomicity violation (the read-check-write is three steps; two goroutines can both read `count = limit-1`, both pass, both write — the limit is exceeded). The comment: *"`counts` is accessed concurrently — this is a data race (Go map, will panic under load) and a read-modify-write that lets the limit be exceeded. Guard the whole read-check-write with a mutex, or use a sharded/atomic counter. Please add a `go test -race` test that hammers one key from N goroutines — that'll prove both the fix and protect against regression."* Note the structure: named the exact bug classes, gave a concrete fix, demanded the dynamic evidence.

**2. An invariant / illegal-states review.** A PR models a payment:

```go
type Payment struct {
    Status   string   // "pending" | "captured" | "refunded"
    Captured int64
    Refunded int64
}
```

Reasoning about invariants: the valid states are pending (`Captured==0, Refunded==0`), captured (`Captured>0, Refunded==0`), refunded (`Refunded>0 && Refunded<=Captured`). The type permits "status=pending but Captured=500", "Refunded > Captured", "Status='captrued'" (a typo the compiler can't catch). The comment moves from bug to shape: *"This permits several illegal states — refunded-more-than-captured, captured-amount-on-a-pending-payment, and a stringly-typed status that won't catch typos. Suggest a sum type: `Pending`, `Captured{Amount}`, `Refunded{Original, Amount}` with `Amount <= Original` enforced at construction. Then 'refund exceeds capture' is unrepresentable rather than a runtime check we'll forget somewhere."*

**3. A design-shape review with a concrete alternative.** A draft PR adds caching by passing a `*redis.Client` into every domain method:

```go
func (s *OrderService) GetOrder(id string, cache *redis.Client) (*Order, error)
```

The senior catches the shape *on the draft*, as the first comment: *"Before this grows — threading `*redis.Client` through the domain couples every method to Redis specifically and to caching as a concern. In two years, swapping Redis or testing without it means touching every signature. Suggest a `Cache` interface (`Get/Set`) injected once at construction, or better, a caching *decorator* that wraps the service so `GetOrder` doesn't know caching exists at all. The second keeps the domain pure. Want to sketch the decorator together?"* It arrived early (draft), named the cost (coupling, testability), and offered two concrete alternatives ranked.

---

## Mental Models

- **Correctness is a set of invariants and a proof every path preserves them.** Review is the search for the one path — input, interleaving, or error — that doesn't. If you can't state the invariant, you're checking syntax, not correctness.

- **A bug is a path into a representable-but-invalid state.** The strongest fix isn't guarding the state; it's making the state unrepresentable, so the bug can't recur for anyone. Ask "could the types have prevented this?"

- **The error path is where the invariants break.** It's the least-read, least-tested, least-demoed code, so it's the most-buggy. Review it first and ask of every multi-step op: "what's the state if it dies right here?"

- **The dangerous defect has no diff.** The unhandled new case, the un-updated caller, the absent test, the swallowed error — review what's *missing* as hard as what's present.

- **Design feedback decays to zero on a finished PR.** Recognize the wrong shape fast, say it first, make it concrete, and move it left (RFC, draft, prototype) so being right is cheap instead of ruinous.

- **Scrutiny scales with reversibility.** Two-way doors deserve "good enough"; one-way doors (API, schema, format) deserve the hard line. Hyrum's Law makes every observable behavior a one-way door once you have users.

---

## Common Mistakes

1. **Pattern-matching instead of reasoning.** Scanning for known anti-patterns catches the bugs that look like bugs and misses the ones that look like reasonable code violating an unstated invariant. Always start from "what must be true here?"

2. **"Just add a lock."** Conflating data races, atomicity violations, and deadlocks produces code that looks locked and isn't — a lock around the `+` of a read-modify-write fixes nothing. Name the class; the fix follows from it.

3. **Reviewing only the happy path.** The error and failure paths carry the most bugs and the least test coverage. Approving because the feature works skips exactly where partial-failure and resource-leak defects live.

4. **Trusting reasoning alone for concurrency.** You cannot reliably find a data race by reading. Demand the race detector (`-race` / TSan) in CI; reading establishes suspicion, the sanitizer establishes proof.

5. **Guarding an illegal state instead of eliminating it.** A nil check protects one call site; the next caller forgets. When a bug is an illegal-state transition, push the invariant into a type so it's impossible everywhere.

6. **Premature abstraction sold as "flexibility."** An interface with one implementation "for the future" is speculative generality — it adds coupling and indirection for flexibility no one needs. Apply AHA: a little duplication beats the wrong abstraction, which is harder to undo.

7. **Design feedback arriving last and vague.** Twelve nits followed by "also the approach is wrong" wastes the author's week. Say the shape concern *first*, with a concrete alternative, and move it left so it lands before the code is written.

8. **Holding a two-way door to "perfect."** Blocking a reversible, internal, low-risk change for stylistic perfection is its own anti-pattern. Save the hard line for one-way doors where being wrong is permanent.

---

## Test Yourself

1. State the difference between a data race, a race condition, and an atomicity violation. Why does "add a lock" fix one but potentially cause or miss the others?
2. A function passes the `balance < amount` check then subtracts. It has no syntactic bug. What's the invariant, what's the bug class, and how would you prove the fix?
3. A struct has `IsConnected bool` and `Socket *net.Conn`. What's the design smell, and what review comment turns the runtime risk into a compile-time guarantee?
4. A multi-step `Transfer` returns an error after debiting `from` but before crediting `to`. Name the bug class and two correct fixes.
5. Give three examples of a correctness defect that leaves *no mark* in the diff's changed lines. How do you find each?
6. What is Hyrum's Law, and why does it make adding an enum value or changing a default a breaking change even when the signature is unchanged?
7. When should a correctness concern resolve into a *test* rather than a *code change*? Give the rule and an example.
8. Distinguish a one-way door from a two-way door in design review, and explain how the distinction calibrates how hard you push.

<details>
<summary>Answers</summary>

1. A **data race** is concurrent access (≥1 write) with no synchronization — UB, fixed by taking the *same* lock on every access. A **race condition** is a wrong result due to timing even *with* locks — the critical section is too small. An **atomicity violation** is a compound op (check-then-act, read-modify-write) interrupted because its steps were locked individually, not as one section. "Add a lock" fixes the data race; if the lock doesn't cover the *whole* compound sequence, the atomicity violation survives; and adding locks in inconsistent order *causes* deadlock.
2. Invariant: `balance >= 0` (and balance/ledger agree). Bug class: **atomicity violation** — the check-then-act isn't indivisible, so two concurrent callers both pass the check before either subtracts. Fix: make the check-and-subtract a single critical section (mutex or a conditional atomic). Prove it with a `go test -race` test that runs many concurrent `Withdraw`s and asserts `balance` never goes negative.
3. The type permits illegal states: "connected with nil socket" and "disconnected with live socket". Every caller must defensively check `IsConnected` first, and the one that forgets nil-derefs. Comment: replace with a sum type / sealed interface (`Connected{Socket}` / `Disconnected{RetryCount}`) so the socket exists by construction only when connected — the illegal states become unrepresentable, eliminating the bug class rather than patching one site.
4. **Partial failure** — the "money conserved" invariant breaks on the error path, leaving `from` debited and `to` not credited. Fixes: (a) wrap both mutations in a transaction that rolls back atomically; (b) make the operation a saga with a compensating action (credit `from` back on failure) *and* make it idempotent so a retry converges. At minimum, idempotency so the retried `Transfer` doesn't double-move.
5. (a) **Missing error handling** — a new fallible call whose error is dropped (`_`); find by checking every new call's failure mode. (b) **Un-updated caller** — a changed contract (now returns an error / may be nil) with a caller still on the old assumption; find by *grepping for callers*, not reading the diff. (c) **Absent test** — a new risky path (retry, boundary, lock) with no test; find by asking "what new behavior here is unverified?" Also: a new enum value with a non-exhaustive `switch` elsewhere.
6. Hyrum's Law: with enough users, every *observable* behavior — not just the documented contract — is depended on by someone. Adding an enum value breaks consumers whose `switch` is non-exhaustive (they relied on the closed set); changing a default silently alters behavior for everyone who relied on the old default without specifying it. Both change observable behavior while the signature is untouched, so they pass a signature-only review but break real callers.
7. Rule: push a **code change** when reasoning finds the code *wrong* (invariant violated, illegal state reachable); push a **test** when the code is *plausibly right* but the path is risky/subtle/regression-prone and unverified. Example: a fixed off-by-one at a boundary, or a concurrent path — demand a `-race` test (or a regression test that fails without the fix) to pin the behavior and force the risky path to actually run.
8. A **one-way door** is expensive/impossible to reverse — a persisted format, public API, schema, wire protocol. A **two-way door** is cheap to reverse — an internal helper, private field, a name. Scrutiny scales with reversibility: hold the hard line on one-way doors (the mistake is permanent), accept "good enough" on two-way doors (you can fix it later, and blocking is waste). Hyrum's Law turns every public, observable behavior into a one-way door.

</details>

---

## Cheat Sheet

```
REASON, DON'T PATTERN-MATCH
  1. State the invariant: what must ALWAYS be true here?
  2. Enumerate valid states; hunt the path into a representable-but-INVALID one
  3. Can the TYPE make the illegal state unrepresentable? (sum type, parse-don't-validate)

CONCURRENCY (the fix differs by class — name it)
  data race          concurrent access, ≥1 write, no sync   → same lock everywhere; PROVE with -race/TSan
  race condition     wrong result from timing, even locked  → widen the critical section
  atomicity violation check-then-act / read-modify-write    → make the SEQUENCE one critical section
  deadlock           circular lock wait                     → consistent lock ORDER
  visibility         write not seen without a fence         → synchronizing op / atomic

ERROR & FAILURE PATHS (most-buggy, least-tested — review FIRST)
  partial failure    half-mutated on error    → transaction / saga+compensation / idempotency
  retry              duplicate effects?        → idempotent op; backoff + JITTER; circuit breaker
  cancellation       context threaded through every blocking call?
  resource           released on EVERY path (error, panic)?

WHAT'S NOT IN THE DIFF
  missing error handling · unhandled new case · absent test for risky path · un-updated caller (grep!)

BOUNDARY/NUMERIC/TIME
  (low+high)/2 overflow → low+(high-low)/2 · truncation · signedness · float == · NaN
  monotonic vs wall clock · clock skew ordering · TOCTOU

DESIGN = EVOLVABILITY ("what will this cost in 2 years?")
  coupling introduced · leaky/premature abstraction · DRY vs AHA (same reason to change?)
  deep module > shallow · scrutiny scales with REVERSIBILITY (1-way door = hard line)

API / CONTRACT (Hyrum's Law: every observable behavior is depended on)
  back-compat · error contract · enum-extension & default-value stealth breaks · can it GROW?

TIMING OF FEEDBACK
  move it LEFT (RFC / draft PR / prototype) · wrong shape = FIRST comment, CONCRETE alternative
  test vs code change: wrong→fix; plausibly-right-but-risky→demand a test (regression/property)
```

---

## Summary

- Senior correctness review is **reasoning, not pattern-matching**: state the invariant, enumerate the valid-state set, and hunt for the one path — input, interleaving, or error — that violates it. If you can't articulate the invariant, you're only checking syntax.
- The highest-leverage correctness comment is often a **design** one: not "guard this state" but **make the illegal state unrepresentable** via the type system, fixing the bug class for every caller forever.
- **Concurrency** demands a precise taxonomy — data race vs race condition vs atomicity violation vs deadlock/livelock — because the fix differs by class; reading establishes suspicion, the **race detector establishes proof**.
- **Error and failure paths** are the least-tested and most-buggy code: review them first, hunt partial failure / cleanup ordering / idempotency / cancellation / resource lifetime, and ask "what's the state if it dies right here?"
- The dangerous defect has **no diff** — the missing error handling, unhandled new case, absent test, un-updated caller — so review what's *missing* as hard as what's present, and grep for callers when a contract moves.
- **Design review is evolvability**: coupling, abstraction quality (leaky / premature, DRY-vs-AHA), module shape, and above all **reversibility** — Hyrum's Law makes every observable behavior a one-way door once you have users, and scrutiny should scale with the cost of being wrong.
- Design feedback is **cheap upstream, ruinous on a finished PR**: move it left (RFCs, draft PRs, prototypes), say the wrong shape *first* and *concretely* with an alternative, and convert unresolvable correctness concerns into **tests**, not endless threads.

The next layer — [professional.md](professional.md) — is about operating this judgment across a team and a codebase over time: setting the review bar, building the invariants into types and tests organization-wide, and knowing when "good enough" is the right call under real delivery pressure.

---

## Further Reading

- *Software Engineering at Google* (Winters, Manshreck & Wright) — Hyrum's Law, the deprecation and large-scale-change chapters, and why every observable behavior becomes a contract.
- *A Philosophy of Software Design* (John Ousterhout) — deep vs shallow modules, information hiding, and "design it twice"; the sharpest available framing of abstraction quality and the wrong shape.
- *The Pragmatic Programmer* (Hunt & Thomas) — DRY (and the discipline of *why* two things are the same), orthogonality/coupling, and reversibility ("there are no final decisions").
- *Java Concurrency in Practice* (Goetz) — the canonical treatment of data races, atomicity, visibility, and the happens-before model; the vocabulary transfers across languages.
- *The Go Memory Model* / *C++ Concurrency in Action* (Williams) — what your language actually guarantees about visibility and ordering, and what the race detector checks.
- *Working Effectively with Legacy Code* (Feathers) — for the "add a regression test before you change it" discipline that Concept 10 leans on.
- Pointer onward: [professional.md](professional.md) — operating these judgments across a team and codebase over time.

---

## Related Topics

- [01 — What to Look For & In What Order](../01-what-to-look-for-and-order/senior.md) — the attention budget, the order of operations, and the diff-vs-change reading this page applies to correctness.
- [04 — Security & Performance Review](../04-security-and-performance-review/senior.md) — the security and performance bug classes you flag by reading vs what must wait for a tool or benchmark.
- [Testing](../../testing/) — turning a correctness concern into a regression or property-based test that keeps the argument running.
- [Dynamic Analysis & Sanitizers](../../dynamic-analysis-and-sanitizers/) — the race detector (TSan), ASan, and UBSan that turn a concurrency *suspicion* into *proof*.
- [Code Quality Metrics](../../code-quality-metrics/) — measuring the coupling and complexity that design review reasons about qualitatively.
