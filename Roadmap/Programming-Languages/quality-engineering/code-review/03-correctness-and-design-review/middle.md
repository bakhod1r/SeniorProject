# Correctness & Design Review — Middle Level

> **Roadmap:** [Code Review](../README.md) → Correctness & Design Review
> *The junior page taught you to ask "does it work?" and "does it fit?" This page turns those instincts into a systematic hunt: a bug-pattern catalog you sweep against every diff, an edge-case matrix you apply on reflex, and the single most important habit in design review — surfacing the wrong-shape concern early, before it has cost a week.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — The Bug-Pattern Catalog: a Systematic Hunt](#core-concept-1--the-bug-pattern-catalog-a-systematic-hunt)
5. [Core Concept 2 — The Edge-Case Matrix](#core-concept-2--the-edge-case-matrix)
6. [Core Concept 3 — Design Review: Is the PR the Right Shape?](#core-concept-3--design-review-is-the-pr-the-right-shape)
7. [Core Concept 4 — API & Interface Review](#core-concept-4--api--interface-review)
8. [Core Concept 5 — Invariants: What Must Always Hold](#core-concept-5--invariants-what-must-always-hold)
9. [Core Concept 6 — The Timing Principle](#core-concept-6--the-timing-principle)
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

> Focus: **How do I systematically find the correctness bugs and the design mistakes a casual read misses?**

At the junior level, correctness review is reactive: you read the code, and if something looks wrong, you flag it. That finds the obvious bugs and misses the expensive ones, because the expensive ones don't *look* wrong — a swallowed error reads like clean code, a check-then-act race reads like two correct lines, an off-by-one reads like a loop. They hide precisely because nothing on the surface is alarming.

This page replaces *reaction* with *a sweep*. It gives you a **bug-pattern catalog** — the recurring failure shapes, each with what to look for and a concrete before/after — that you run against every diff like a checklist, and an **edge-case matrix** you apply on reflex to every function that takes input. Then it raises the altitude to **design review**: is the change the right *shape* — does it fit the existing boundaries, is the abstraction right, does it respect the system's invariants? It closes with the **timing principle**, the single highest-leverage habit in this whole topic: the most expensive feedback is "this is the wrong approach" delivered on a finished PR, so structural concerns must be raised *first and early*, ideally before the code is written.

---

## Prerequisites

- **Required:** You've read [junior.md](junior.md) and can run the correctness-then-design-then-tests pass.
- **Required:** You've reviewed enough PRs to have approved one that later broke — the experience this page is designed to prevent.
- **Helpful:** You've debugged a concurrency bug, a nil dereference, or a resource leak in production, so the patterns below map onto scars you already have.
- **Helpful:** Familiarity with your language's failure modes — Go's `error` returns and goroutines, or another language's exceptions and `null`.

---

## Glossary

| Term | Meaning |
|---|---|
| **Bug pattern** | A recurring *shape* of defect (e.g. check-then-act race) that appears across languages and codebases; learnable and huntable. |
| **Edge case** | An input or state at the boundary of valid — empty, zero, max, negative, duplicate — where naive code breaks. |
| **Invariant** | A condition that must hold at all times (e.g. "balance ≥ 0", "list is sorted"); the change must preserve it. |
| **Contract** | An interface's promises: preconditions (what callers must guarantee), postconditions (what it guarantees back), and error semantics. |
| **Idempotency** | An operation is idempotent if running it twice has the same effect as once — the precondition for safe retries. |
| **Happy path** | The successful, no-error execution route. The *off*-happy-path (errors, partial failure) is where most bugs live. |
| **ABI/API compatibility** | Whether a change breaks existing callers. *Backward-compatible* means old callers keep working unchanged. |
| **Leaky abstraction** | An abstraction that forces callers to know its internals, defeating the point of having it. |

---

## Core Concept 1 — The Bug-Pattern Catalog: a Systematic Hunt

The difference between a junior and a senior correctness review is not raw intelligence — it's that the senior carries a **catalog of failure shapes** and sweeps the diff against it. You stop reading "is this right?" line by line and start asking "does this diff contain a *known pattern*?" Pattern recognition is faster and far more complete than fresh reasoning. Here is the working catalog.

### Concurrency hazards

The richest source of production bugs that pass every test. Look for **shared mutable state touched without synchronization**, **check-then-act races** (you check a condition, then act on it, but the state changed in between), **missing locks**, and **goroutine/thread leaks** (a goroutine that blocks forever because nobody reads its channel).

```go
// BUG: check-then-act race. Two goroutines can both pass the check.
if _, ok := cache[key]; !ok {
    cache[key] = expensiveLoad(key) // map write under concurrency → data race / panic
}
```
```go
// FIX: hold the lock across the whole check-then-act, or use sync.Map / singleflight.
mu.Lock()
if _, ok := cache[key]; !ok {
    cache[key] = expensiveLoad(key)
}
mu.Unlock()
```

> **Key insight:** Concurrency bugs are invisible in a diff because each line is correct in isolation — the bug lives in the *interleaving*, which the diff doesn't show. When you see shared state and concurrency in the same change, stop reading and start asking "what if two of these run at once?" Then push it to the [dynamic-analysis](../../dynamic-analysis-and-sanitizers/) tools (Go's `-race`, ThreadSanitizer) — review *finds the suspect*; the sanitizer *convicts*.

### Error handling

The off-happy-path is the least-reviewed and most-broken region of every codebase. Hunt for **swallowed errors** (caught and discarded), **ignored return values**, **lost context** (an error wrapped without enough detail to debug), **partial failure with no cleanup**, and **panics/exceptions crossing a boundary** they shouldn't.

```go
// BUG: error swallowed. The write may have failed; the caller never knows.
data, _ := json.Marshal(payload)   // ignored error
_ = os.WriteFile(path, data, 0644) // ignored error → silent data loss
```
```go
// FIX: check, wrap with context, return.
data, err := json.Marshal(payload)
if err != nil {
    return fmt.Errorf("marshal payload for %s: %w", path, err)
}
if err := os.WriteFile(path, data, 0644); err != nil {
    return fmt.Errorf("write config %s: %w", path, err)
}
```

### Nil/null & optionals

The most common runtime crash. Look for **dereferences of values that can be nil** — function returns, map lookups, type assertions, interface values, optionals unwrapped without a check.

```go
// BUG: a nil map read is fine, but a nil map WRITE panics.
func (s *Store) Set(k, v string) { s.data[k] = v } // panics if s.data was never made
```
```go
// FIX: initialize in the constructor, or guard.
func NewStore() *Store { return &Store{data: make(map[string]string)} }
```

### Off-by-one & boundaries

Loop bounds, slice ranges, index arithmetic. `<` vs `<=`, `len` vs `len-1`, inclusive vs exclusive ranges.

```python
# BUG: drops the last element. range(len-1) stops one short.
for i in range(len(items) - 1):
    process(items[i])
```
```python
# FIX
for item in items:        # iterate directly; avoids the index entirely
    process(item)
```

### Resource lifecycle

**Leaks** (opened, never closed), **double-close**, **`defer` in a loop** (resources pile up until the function returns, not each iteration), **missing `finally`/`with`** on the error path.

```go
// BUG: defer in a loop — every file stays open until the function returns.
for _, name := range names {
    f, _ := os.Open(name)
    defer f.Close()          // 10,000 files → 10,000 open descriptors at once
    process(f)
}
```
```go
// FIX: scope the lifecycle to the iteration.
for _, name := range names {
    func() {
        f, err := os.Open(name)
        if err != nil { return }
        defer f.Close()      // closes at the end of THIS iteration
        process(f)
    }()
}
```

### Integer overflow & numeric

**Float equality** (`==` on floats is almost always wrong), **division** (by zero, integer truncation), **overflow** on sums/multiplies, **signed/unsigned** confusion.

```go
total := price * quantity // both int32; large order overflows silently to negative
```

### Input validation gaps

Data crossing a trust boundary used without validation — length, format, range, type. (Covered in depth in [04 — Security & Performance Review](../04-security-and-performance-review/middle.md); here the concern is *correctness*, e.g. an unvalidated index that crashes.)

### Time & timezone

**Naive datetimes** (no zone), **DST** transitions, **wall-clock vs monotonic** (using wall time to measure a duration — it can jump backward on an NTP correction).

```go
start := time.Now()
// ... work ...
elapsed := time.Now().Sub(start) // OK in Go: time.Now carries a monotonic reading.
// In languages without monotonic clocks, subtracting wall times can go NEGATIVE.
```

### Mutation of shared/aliased data

**Accidental aliasing** — two variables point at the same underlying array/object, and a write through one corrupts the other. Classic in Go with slice sub-slicing, in Python with mutable default arguments.

```python
# BUG: the default list is shared across ALL calls (created once, at def time).
def add(item, bucket=[]):
    bucket.append(item)
    return bucket
```
```python
# FIX
def add(item, bucket=None):
    bucket = [] if bucket is None else bucket
    bucket.append(item)
    return bucket
```

### Idempotency & retries

For any operation that can be retried (network call, queue handler, webhook): **is it safe to run twice?** A non-idempotent charge or insert, retried after a timeout, double-charges or double-inserts.

```go
// BUG: retry-unsafe. A network timeout that actually succeeded → double charge.
func Charge(userID string, cents int) error { return gateway.Charge(userID, cents) }
```
```go
// FIX: idempotency key — the gateway dedupes retries of the same logical operation.
func Charge(userID, idempotencyKey string, cents int) error {
    return gateway.Charge(userID, cents, WithIdempotencyKey(idempotencyKey))
}
```

### Cache invalidation & ordering assumptions

**Stale cache** (data updated, cache not invalidated), **ordering** (code assumes map iteration order, or that events arrive in order, when neither is guaranteed).

> **Key insight:** You will not memorize this catalog by reading it once — you internalize it by *mapping each pattern onto a bug you've actually shipped*. Concurrency, error handling, and nil are the three with the worst bug-to-test-coverage ratio: they pass the tests and break in production. Spend your scarcest attention there.

---

## Core Concept 2 — The Edge-Case Matrix

For any function that takes input, the bugs cluster at the *boundaries* of valid. The matrix is a fixed set of inputs you apply on reflex — you don't invent edge cases per function, you run down the same list every time.

| Dimension | The hostile input | What it tends to break |
|---|---|---|
| **Empty** | `""`, `[]`, `{}`, zero rows | Loops that assume ≥1 element; `first()`/`max()` on empty |
| **Zero** | `0`, `0.0` | Division; "if count" treating 0 as falsy |
| **One** | single element | Code that assumes pairs; "join with comma" producing a trailing comma |
| **Max** | `MAX_INT`, max length, huge payload | Overflow; buffer/timeout limits |
| **Negative** | `-1`, negative duration | Unsigned assumptions; `len`-relative indexing |
| **Duplicate** | repeated keys/IDs | "Insert" that should be "upsert"; set vs list confusion |
| **Unicode** | emoji, combining chars, RTL | `len` ≠ rune count; byte-vs-char slicing splits a codepoint |
| **Concurrent** | two callers at once | Every pattern in Concept 1 |
| **Failure-injected** | the dependency returns an error | The unreviewed off-happy-path |

In review, you apply the matrix as a question: *"What does this do when the input is empty? When the dependency fails?"* If the diff doesn't answer — and the tests don't cover it — that's your comment.

```go
// Apply "empty": what does Average return for an empty slice?
func Average(xs []float64) float64 {
    sum := 0.0
    for _, x := range xs { sum += x }
    return sum / float64(len(xs)) // empty → 0/0 → NaN, silently
}
```

> **Key insight:** The matrix is most powerful as a *review comment generator*. You don't have to find the bug yourself — you ask the author the matrix question. "What happens here when `xs` is empty?" either surfaces a bug or earns a test. Both outcomes are wins, and the question costs you ten seconds.

---

## Core Concept 3 — Design Review: Is the PR the Right Shape?

Correctness asks "does this code do what it intends?" Design asks the higher-altitude question: **is this the right code to have written at all?** A change can be flawlessly correct and still be a mistake — wrong layer, wrong abstraction, a duplicate of something that already exists. Design review is where the expensive feedback lives, which is exactly why the [timing principle](#core-concept-6--the-timing-principle) below matters so much.

Run the change against these questions:

- **Does it fit the existing boundaries?** Does the new code live in the right layer (does business logic leak into the HTTP handler? does a SQL query appear in the domain model?)? Does it respect module responsibilities, or does it reach across a boundary it shouldn't?
- **Is the abstraction right?** Three failure modes: **premature** (an interface with one implementation, "for flexibility" nobody needs yet), **leaky** (callers must know the internals anyway), and **missing** (the same five lines copy-pasted that should be one function).
- **Is it over- or under-engineered?** Over: a plugin system for a problem with two cases. Under: a hard-coded constant where the requirement clearly varies.
- **Does it duplicate something?** The single most valuable thing a reviewer with codebase context provides: "we already have `parseTimeout` in `internal/config` — use that." The author *cannot* catch this; they don't know what they don't know.
- **Does it respect invariants?** (Concept 5.)

```diff
// Design comment, not a correctness comment — the code below WORKS:
  func (h *OrderHandler) Create(w http.ResponseWriter, r *http.Request) {
      var o Order
      json.NewDecoder(r.Body).Decode(&o)
-     row := h.db.QueryRow("INSERT INTO orders ...") // SQL in the HTTP handler
-     // ... 40 lines of business logic inline ...
+     // Suggestion: this couples transport to persistence. Move the insert +
+     // the validation into OrderService so it's testable without HTTP and
+     // reusable from the queue consumer that's coming next sprint.
  }
```

> **Key insight:** "It works" is the *floor* for merging, not the bar. Most regrettable code is correct on the day it merges — the regret is structural: it's in the wrong place, duplicates logic, or invents an abstraction that becomes a maintenance tax. Design review is the only gate that catches this, and unlike a bug, a bad shape gets *more* expensive to fix every week it sits in `main`.

---

## Core Concept 4 — API & Interface Review

When a PR adds or changes a public interface — an exported function, an HTTP endpoint, a library signature — the review bar rises sharply, because an API is a *promise to every future caller* and promises are expensive to break.

**Naming.** Does the name say what it does and *only* what it does? `getUser` that also writes a cache entry is lying. `processData` says nothing. Names are the most-read documentation.

**The contract.** Make the implicit explicit: what are the **preconditions** (must the input be non-nil? sorted? validated?), the **postconditions** (what does it guarantee on success?), and the **error semantics** (does it return an error or panic? is a not-found an error or a `(nil, false)`?). An undocumented contract is a contract everyone will guess at differently.

**Backward compatibility — will this break callers?** This is the question that separates an additive change from an incident.

```go
// BEFORE — existing public API, callers depend on it:
func Fetch(id string) (*User, error)

// BREAKING — adds a required parameter. Every call site fails to compile;
// for an RPC/HTTP API, every existing client breaks at runtime.
func Fetch(ctx context.Context, id string, opts Options) (*User, error)

// COMPATIBLE — new behavior via a NEW function, or variadic options:
func Fetch(id string) (*User, error)                 // keep the old one
func FetchWithContext(ctx context.Context, id string, opts ...Option) (*User, error)
```

The compatibility rules worth knowing on sight: **adding** an optional field/method is usually safe; **removing or renaming** anything public breaks callers; **changing a type, a parameter, or the meaning of a return value** breaks callers even when it still compiles (a *semantic* break — the worst kind, because nothing flags it). For wire formats (JSON, protobuf), renaming a field or changing its type breaks every deployed client that you don't control. (This connects to ABI/API compatibility in the build sense — see [Build Systems](../../build-systems/).)

**Surface-area minimalism.** Every exported symbol is a maintenance commitment you can't easily withdraw. "Does this need to be public?" is a free win — an unexported helper can be changed freely tomorrow; an exported one cannot.

**Consistency with siblings.** If every other method in the package returns `(T, error)` and orders arguments `(ctx, id, opts)`, the new one must too. Inconsistency is a permanent papercut for every future caller.

> **Key insight:** You can fix a bug in a patch release; you cannot un-ship a public API. A bad signature is forever, or it's a breaking change with a migration cost paid by everyone downstream. This asymmetry is *why* API review deserves disproportionate scrutiny — it's the one kind of mistake that's genuinely hard to walk back.

---

## Core Concept 5 — Invariants: What Must Always Hold

An **invariant** is a property the system guarantees at all times: an account balance never goes negative; a doubly-linked list's `next`/`prev` pointers always agree; a state machine only follows legal transitions; a sorted index stays sorted. Bugs are, very often, *an invariant temporarily violated*.

The review skill is two-step: **name the invariant**, then **check the change preserves it on every path — including the error path.**

```go
// Invariant: reserved <= total (you can't reserve more seats than exist).
func (e *Event) Reserve(n int) error {
    e.reserved += n // BUG: nothing enforces the invariant; reserved can exceed total
    return nil
}
```
```go
// FIX: enforce the invariant at the mutation point.
func (e *Event) Reserve(n int) error {
    if e.reserved+n > e.total {
        return fmt.Errorf("only %d seats left", e.total-e.reserved)
    }
    e.reserved += n
    return nil
}
```

The subtle failures are on the **error path**: a function that mutates two fields, then returns an error between them, leaving the object **half-updated** — invariant broken, and the caller has no idea. This is where "cleanup on error" from Concept 1 meets invariants: a mutation that can fail partway must either complete fully or roll back fully.

> **Key insight:** Most data-corruption bugs are an invariant that held on the happy path and broke on an error path or a concurrent path. So the review move is mechanical: name the invariant out loud, then ask "what if this errors halfway? what if two callers run at once?" The invariant you can *name* is the one you can *defend*.

---

## Core Concept 6 — The Timing Principle

This is the highest-leverage idea in the entire topic, so it gets the strongest statement: **the cost of feedback rises with how late it arrives, and "this is the wrong approach" is the most expensive feedback there is.**

A nitpick on line 40 costs the author thirty seconds. "This whole module belongs behind the existing `PaymentService` interface" costs them a week — *if it arrives on a finished PR*. The exact same insight, delivered on a one-paragraph design doc or a draft PR, costs them an hour. The feedback didn't change; the *timing* changed its price by two orders of magnitude.

Three rules follow directly:

1. **Surface design/approach concerns upstream.** The cheapest place to redirect an approach is *before the code exists* — in a design doc, an RFC, an issue discussion, or a draft PR opened deliberately to get early eyes. A team that reviews approaches before implementation almost never has to reject finished work.
2. **Within a PR, raise the big structural thing first.** Lead your review with the one comment that could change the whole diff, *before* you spend the author's attention (or your own) on line-level nitpicks. Nothing is more demoralizing — or more wasteful — than a thread of style suggestions on code that your last comment asks them to delete.
3. **Don't let nitpicks crowd out the structural concern.** If you have one architectural worry and twelve nits, the author can drown in the nits and miss the one that matters. State the big thing plainly, label it as blocking, and consider dropping the trivia.

### Block vs suggest, calibrated for correctness vs design

| Situation | Calibration | Why |
|---|---|---|
| **Correctness bug** (race, swallowed error, nil deref) | **Block.** | It's wrong. Wrongness is the one thing review must not pass. |
| **Missing edge case** with no test | **Block** (or block the missing test). | Untested boundary = a latent bug with no guard. |
| **Wrong shape, raised on a finished PR** | **Judgment call.** | Blocking a week of work is a real cost; weigh it against the maintenance tax. Sometimes "merge, file a fast-follow." This is *exactly* the cost you avoid by reviewing the approach earlier. |
| **Premature/leaky abstraction** | Usually **suggest**, escalate if it spreads. | One bad abstraction is fixable; one that other code starts depending on is not. |
| **Style/naming preference** | **Suggest** (or let the linter own it). | Never block merge on taste. |

> **Key insight:** Every design problem is cheap to fix in inverse proportion to how far it's progressed. The reviewer's real job isn't to catch the wrong approach on the finished PR — it's to build a team culture where the wrong approach gets caught *before it's built*, in the design doc. Catching it on the PR is the failure mode you're trying to make rare; catching it after merge is the failure mode you're trying to make impossible.

---

## Real-World Examples

**1. The race that passed every test.** A `metrics` package incremented a shared counter from many goroutines without a lock. Every unit test passed (single-threaded). Under production load, `go test -race` would have screamed — but it was never run with `-race`. The reviewer's catch: "shared `c.count++` from concurrent handlers — needs `atomic.AddInt64` or a mutex, and let's add `-race` to CI." One comment, one prevented class of incident.

**2. The breaking change that compiled.** A team changed an HTTP handler to require a new `tenant_id` JSON field and validated it as mandatory. The Go code compiled; the *deployed mobile clients* didn't send the field and broke on the next deploy. The reviewer who caught it asked the one API question: "is this backward-compatible for clients we don't control?" The fix: accept the field optionally, default it, deprecate over a release.

**3. The right code in the wrong place.** A PR added a 60-line CSV export — correct, tested, clean — directly inside an HTTP handler. The reviewer's design comment: "this exact export logic is also needed by the nightly job; pull it into a `report` package so both call it." Because the comment came on the *first* review pass and led with the structural point, the author refactored in twenty minutes instead of arguing about it after polishing the handler version.

**4. The half-updated object.** A `transfer` function debited the source account, then called the (fallible) `credit` on the destination, then saved. When `credit` returned an error, the source was already debited in memory and — in one code path — already persisted. Money vanished. The reviewer named the invariant ("sum of balances is conserved") and asked "what if `credit` fails after the debit?" — surfacing the missing transaction boundary.

---

## Mental Models

- **A diff is a crime scene; the catalog is your list of usual suspects.** You don't re-derive how every bug works from first principles — you walk in, scan for the known patterns (race, swallowed error, nil, off-by-one, leak), and follow the ones that fit. Experienced reviewers are fast because they're *matching*, not *reasoning from scratch*.

- **The happy path is the lit street; bugs live in the dark alleys.** Authors write and test the success case because it's what they're picturing. Your job as reviewer is to walk the routes they didn't: empty input, the dependency failing, two callers at once, the retry. That's where the value is, because that's where they didn't look.

- **"It works" is a floor, not a ceiling.** Correctness gets you to mergeable. Design — right shape, right place, right abstraction — gets you to *maintainable*. A reviewer who only checks correctness is doing half the job and passing the expensive half.

- **An invariant you can name is an invariant you can defend.** Saying "balance must stay ≥ 0" out loud turns a vague unease into a concrete check you can verify against every path. The unnamed invariant is the one that silently breaks.

- **Feedback is a perishable good — its value decays the later it ships.** The same insight is worth a week if it lands in a design doc and a footnote if it lands after merge. Spend your timing, not just your insight.

---

## Common Mistakes

1. **Reviewing only the happy path.** You read what the code does when everything works and approve. The bug was in what it does when the dependency returns an error — the path you didn't trace. Apply the failure-injection row of the matrix every time.

2. **Reading concurrent code line by line.** Each line is correct, so you approve. The bug is in the interleaving, which the diff can't show. When you see shared state + concurrency, stop reading lines and start reasoning about simultaneity — then reach for the sanitizer.

3. **Treating a swallowed error as clean code.** `result, _ := doThing()` looks tidy. It's a silent failure waiting to happen. An ignored error is a bug until proven a deliberate, commented choice.

4. **Nitpicking before raising the structural concern.** You leave twelve style comments, then in comment thirteen suggest the whole approach is wrong. You've wasted everyone's attention and buried the one comment that mattered. Lead with the big thing.

5. **Blocking a finished PR on a design opinion you could have raised earlier.** If the right shape was reviewable in a design doc and you didn't look until the PR was done, blocking it now imposes a cost the *process* created, not the author. Fix the process: review approaches earlier.

6. **Missing the breaking change because it compiled.** A semantic break — changed return meaning, a new required wire field, a renamed JSON key — compiles fine and breaks callers at runtime. Ask the compatibility question explicitly; the compiler won't ask it for you.

7. **Approving a new abstraction you don't yet need.** An interface with one implementation "for flexibility" is speculative complexity. Until there's a second implementation, it's overhead pretending to be design. Suggest the concrete type now, the interface when the second case is real.

---

## Test Yourself

1. You see `if !exists(key) { set(key, load()) }` running across multiple goroutines. Name the bug pattern and the fix.
2. A function takes `[]float64` and returns their average. Which two rows of the edge-case matrix do you apply, and what do they reveal?
3. A PR changes `Fetch(id string)` to `Fetch(ctx, id, opts)`. It compiles. Why might it still be a breaking change, and for whom?
4. What three failure modes can an *abstraction* have, and what does each look like in a diff?
5. A `transfer` debits, then credits, then saves. Where is the most likely correctness bug, and what invariant frames it?
6. You have one architectural concern and ten style nits on a finished PR. What order do you raise them in, and what's the deeper process fix?

<details>
<summary>Answers</summary>

1. **Check-then-act race.** Two goroutines can both evaluate `!exists(key)` as true before either calls `set`, so both load (wasted work) and both write the map concurrently (a data race / panic in Go). Fix: hold a lock across the whole check-and-act, or use a concurrency-safe primitive (`sync.Map`, `singleflight`, an atomic).

2. **Empty** and **zero**. Empty: `len(xs) == 0` makes the divisor zero → `0/0` → `NaN` returned silently. (Zero overlaps here — the count is zero.) The reveal: the function has no defined behavior for empty input and no test covering it. Comment: "what should this return for an empty slice, and where's the test?"

3. It's a **semantic / source-compatibility break**. Every existing call site `Fetch("x")` now fails to compile because the signature changed — so it breaks every *caller in the codebase*. If `Fetch` is also exposed over RPC/HTTP, it breaks deployed *clients you don't control* at runtime. Compatible alternative: keep `Fetch`, add `FetchWithContext`, or use variadic options.

4. **Premature** — an interface with a single implementation, added "for flexibility" no requirement asks for. **Leaky** — callers still have to know the internals (e.g. must call methods in a specific order), so the abstraction buys nothing. **Missing** — the same logic copy-pasted in several places that should be one function. In a diff: a one-impl interface; a "use it like this, in this exact sequence" comment; or duplicated blocks.

5. On the **error path between debit and credit**: if `credit` fails after the debit (especially if the debit was already persisted), the source loses money and the destination never gains it. The framing invariant is **conservation** — the sum of all balances is unchanged by a transfer. The fix is a transaction boundary so the operation completes fully or rolls back fully.

6. Raise the **architectural concern first**, plainly and labeled as blocking, *before* the nits (and consider dropping most of the nits to a single "minor stylistic notes below, non-blocking"). The deeper fix is **timing**: a structural concern reaching a finished PR means the approach wasn't reviewed early — move that review upstream to a design doc or draft PR so the next one is caught before it's built.

</details>

---

## Cheat Sheet

```
BUG-PATTERN CATALOG (sweep every diff)
  concurrency    shared mutable state? check-then-act? missing lock? goroutine leak?  → run -race / TSan
  errors         swallowed? ignored return? lost context? cleanup on partial failure?
  nil / null     can this be nil? nil-map WRITE? unchecked type assertion / optional?
  off-by-one     < vs <=  ?  len vs len-1 ?  inclusive vs exclusive range?
  resources      leak? double-close? defer-in-loop? missing finally/with on error path?
  numeric        float == ? divide-by-zero? overflow? int truncation? signed/unsigned?
  time           naive datetime? DST? wall-clock used to measure a duration?
  aliasing       shared/aliased mutation? Python mutable default arg? slice sub-slicing?
  idempotency    safe to retry twice? needs an idempotency key?
  cache/order    stale after update? relies on map / event ordering that isn't guaranteed?

EDGE-CASE MATRIX (apply to every input)
  empty · zero · one · max · negative · duplicate · unicode · concurrent · failure-injected

DESIGN REVIEW (is it the RIGHT SHAPE?)
  right layer/boundary? · abstraction premature/leaky/missing? · over/under-engineered?
  duplicates existing code? · respects invariants?

API REVIEW
  naming honest? · contract (pre/post/errors) stated? · BACKWARD-COMPATIBLE for callers?
  minimal surface (does it need to be public?) · consistent with siblings?

INVARIANTS
  name it → check every path (incl. error path + concurrent path) preserves it

TIMING (most important)
  cheapest redirect = BEFORE the code (design doc / draft PR)
  within a PR: big structural comment FIRST, nits last (or dropped)
  BLOCK: correctness bugs, missing-edge-case tests
  SUGGEST: style, naming, premature abstraction (escalate if it spreads)
```

---

## Summary

- A senior correctness review is a **systematic hunt**, not a reactive read: you sweep the diff against a **bug-pattern catalog** (concurrency, errors, nil, off-by-one, resources, numeric, time, aliasing, idempotency, caching/ordering) and apply an **edge-case matrix** (empty/zero/one/max/negative/duplicate/unicode/concurrent/failure-injected) to every input.
- The three patterns with the worst bug-to-test ratio — **concurrency, error handling, nil** — pass tests and break in production; spend your scarcest attention there, and push concurrency suspects to the sanitizer.
- **Design review** asks the higher question: is the change the *right shape*? Right layer, right abstraction (not premature/leaky/missing), not a duplicate, respecting invariants. "It works" is the floor, not the bar.
- **API review** carries a higher bar because a public interface is a promise you can't un-ship: check naming, the contract, **backward compatibility** for callers, minimal surface, and consistency with siblings. Watch for *semantic* breaks that compile but break callers.
- **Invariants** are properties that must always hold; name them, then verify the change preserves them on every path — especially the error path and the concurrent path, where most corruption hides.
- The **timing principle** dominates everything: feedback's cost rises the later it lands, so surface design/approach concerns *first and early* — ideally before the code exists — and within a PR, raise the structural thing before the nitpicks.

---

## Further Reading

- *Google's Code Review Developer Guide* — **"What to look for in a code review."** The canonical checklist; this page is its correctness-and-design rows expanded with patterns and examples.
- *Software Engineering at Google* — **Chapter 9, "Code Review."** The process and culture context: why early, small, design-first review scales.
- *The Pragmatic Programmer* (Hunt & Thomas) — the sections on **assertions and Design by Contract**: preconditions, postconditions, and invariants as a discipline, which underpins the API and invariant concepts here.
- [senior.md](senior.md) — reviewing distributed-systems correctness, designing for evolvability, and leading design review upstream of the PR.

---

## Related Topics

- [01 — What to Look For & In What Order](../01-what-to-look-for-and-order/middle.md) — where correctness and design sit in the review order, and why correctness comes first.
- [04 — Security & Performance Review](../04-security-and-performance-review/middle.md) — the input-validation and resource concerns from this page, taken to their security and performance conclusions.
- [Testing](../../testing/) — the edge-case matrix is also a test-design tool; the boundaries you review for are the boundaries you should test.
- [Dynamic Analysis & Sanitizers](../../dynamic-analysis-and-sanitizers/) — the race detector and sanitizers that *convict* the concurrency bugs this page teaches you to *suspect*.
- [Code Quality Metrics](../../code-quality-metrics/) — complexity and coupling signals that flag the design-shape problems before review.
