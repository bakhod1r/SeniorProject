# Goroutine Best Practices — Senior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Code Review Checklist for Goroutines](#code-review-checklist-for-goroutines)
3. [Style Guides Compared: Effective Go, Uber, Google](#style-guides-compared-effective-go-uber-google)
4. [Establishing Team Conventions](#establishing-team-conventions)
5. [Linters and Automated Enforcement](#linters-and-automated-enforcement)
6. [Concurrency Architecture Reviews](#concurrency-architecture-reviews)
7. [Postmortem Patterns That Drove These Rules](#postmortem-patterns-that-drove-these-rules)
8. [Onboarding New Engineers](#onboarding-new-engineers)
9. [Library Authoring vs Application Authoring](#library-authoring-vs-application-authoring)
10. [Migration: Cleaning Up a Legacy Codebase](#migration-cleaning-up-a-legacy-codebase)
11. [When to Break the Rules](#when-to-break-the-rules)
12. [Self-Assessment](#self-assessment)
13. [Summary](#summary)

---

## Introduction

At senior level, the question shifts from "which rule applies here" to "how do I scale this discipline across a team, a codebase, and a release pipeline?" The same twelve rules from junior level become a code review checklist, a linter ruleset, a postmortem template, an onboarding curriculum, and an architectural review framework. The depth comes from knowing *why* each rule exists historically — which production failure drove it — and from running the review machinery that catches the violation before it ships.

After this you will:

- Lead a code review where concurrency bugs are caught by checklist, not by luck.
- Map your codebase's conventions to (and from) the major published style guides.
- Choose linters that catch the rules you actually care about.
- Lead the cleanup of an existing codebase that grew without these disciplines.

---

## Code Review Checklist for Goroutines

This is the checklist a reviewer runs every time they see `go`, `errgroup.Group`, `sync.WaitGroup`, `chan`, `sync.Mutex`, or `context.Context` in a diff. Each item is a yes/no question. If any answer is "no" or "unclear," the diff is not ready.

### 1. Exit story

- [ ] Can I describe in one sentence how this goroutine returns?
- [ ] Is that exit guaranteed by code, or does it depend on an assumption ("this channel is always closed")?
- [ ] Is there a path where the exit never happens (deadlock, infinite loop without `select { case <-ctx.Done(): }`)?

### 2. `WaitGroup` discipline

- [ ] Is `wg.Add` called in the parent, before `go`?
- [ ] Is `wg.Done()` deferred as the first line of the goroutine body?
- [ ] Is `wg.Wait` called on the same `wg` from a single point?
- [ ] If `wg.Add` is called in a loop, is there a `continue` path that skips it?

### 3. Loop variables

- [ ] Is every loop variable used inside a goroutine closure either shadowed (`x := x`) or passed as a function parameter?
- [ ] What Go version does this module target (check `go.mod`)? If < 1.22, the rule is mandatory; if >= 1.22, it's still preferred for clarity.

### 4. Context

- [ ] Does every long-running goroutine accept `ctx context.Context`?
- [ ] Does it check `ctx.Done()` in any `select` that waits on a channel?
- [ ] Does it check `ctx.Err()` before expensive work?
- [ ] Is `context.Background()` used outside `main` or tests? (If yes, justify.)
- [ ] Is `cancel` from `WithCancel`/`WithTimeout`/`WithDeadline` always `defer`-ed?

### 5. Panic recovery

- [ ] Is there a `defer recover` at the boundary of every goroutine that processes external input?
- [ ] Does the recovery log AND increment a metric? (Silent recovery hides bugs.)
- [ ] Does the recovery let the goroutine *exit*, not loop on the bad state?

### 6. Coordination primitive

- [ ] Is `errgroup` used instead of hand-rolled `WaitGroup` + error channel?
- [ ] If `errgroup` was rejected, is there a comment explaining why?
- [ ] Is `g.SetLimit(n)` used wherever concurrency must be bounded?

### 7. Channels vs mutex

- [ ] Is shared state protected by either a mutex/atomic OR owned by a single goroutine (channel-based actor)?
- [ ] Is there a channel where a mutex would be simpler? (Reverse smell.)
- [ ] Is there a mutex held across a channel send/recv? (Lock-order risk.)

### 8. `time.Sleep`

- [ ] Is `time.Sleep` used anywhere as "wait for goroutine to finish"?
- [ ] If `time.Sleep` appears, is it (a) a ticker, (b) a backoff, or (c) explicitly justified?

### 9. Race detector

- [ ] Does CI run `go test -race`?
- [ ] Has this code been run under `-race`?
- [ ] If new test code is concurrent, does it pass `-race -count=10` locally?

### 10. Concurrency bound

- [ ] Is every "for input in stream, go handle(input)" pattern bounded?
- [ ] Is the bound a constant, a configuration value, or computed from `GOMAXPROCS`/resource limits?
- [ ] Is there a comment explaining why the chosen bound is right?

### 11. Documentation

- [ ] If a new exported type or function uses goroutines internally or holds shared state, is its concurrency policy in the doc comment?
- [ ] If a method has different concurrency rules from its type, are they called out?

### 12. Leak detection

- [ ] Does the test for this code use `goleak`?
- [ ] If not, is there another way the test would catch a leak?

### Universal smells

- [ ] Is there a `go func() { ... }()` literal longer than 20 lines? Extract a function.
- [ ] Is there a goroutine that captures the receiver `c` of a method? Document its lifetime relative to `c`.
- [ ] Is there a "main" goroutine in a non-`main` package? Why?

Print the checklist. Hand it to junior reviewers. Use it on your own code.

---

## Style Guides Compared: Effective Go, Uber, Google

The four publicly available style references for Go concurrency are:

- **Effective Go** (official, foundational).
- **Uber Go style guide** (detailed, opinionated, widely adopted).
- **Google Go style guide** (Google-internal, since published).
- **Go Code Review Comments** (the closest thing to an official review checklist).

They agree on most things and differ on a few. Senior engineers know where.

### Universal agreements

| Topic | All four say |
|---|---|
| `context.Context` first parameter | Yes; `ctx context.Context`. |
| Don't store `Context` in structs | Yes. |
| Don't use `Context.Value` for required parameters | Yes. |
| Run race detector in CI | Yes. |
| Document concurrency safety on exported types | Yes. |
| `go f()` arguments evaluated in caller | Yes (this is spec, not style). |

### Where they diverge

| Topic | Effective Go | Uber | Google |
|---|---|---|---|
| Prefer channels or mutex? | Channels for ownership transfer, mutex for state. | Same; explicitly says "synchronisation primitives are NOT inherently worse." | Same. |
| Channel direction in function signatures | Use directional types when relevant. | Same; says always make channel direction part of the type when possible. | Same. |
| `sync.WaitGroup` patterns | Light coverage. | Detailed: `wg.Add` in parent, `defer wg.Done`, exact pattern enforced. | Same as Uber. |
| Panic vs error | Use errors; panic for "impossible" cases. | Strong: never panic for expected errors, recover at goroutine boundaries. | Same. |
| `errgroup` | Not mentioned (predates `errgroup`). | Recommended for error-aggregating fan-out. | Recommended. |
| Naming concurrency primitives | Light. | `Done` channels are `chan struct{}`; result channels named for content. | Same. |
| Method receivers and goroutines | Light. | "Make the zero value useful" applies to mutex-containing types. | Same. |
| `sync.Once.Do` for lazy init | Light. | Yes; prefer `sync.Once` over hand-rolled. | Yes. |

### The Uber rules that are most worth adopting

From `uber-go/guide` — these are the ones most teams formalise:

- **Don't copy a `sync.Mutex` or `sync.WaitGroup`.** Use pointer fields or pass by pointer.
- **Defer `Unlock`** immediately after `Lock`. Reads cleaner than carefully managing exit paths.
- **Channels' size is one or none.** Either an unbuffered channel for synchronisation, or a buffer of 1 for "send-and-go." Larger buffers should have a comment justifying the size.
- **Goroutine lifetime must be obvious.** If it's not obvious, it's a leak.
- **Start goroutines with a clear plan to stop them.** Echoing Cheney.

The Google guide adds:

- **`context.Background()` only at `main`'s top.**
- **`context.TODO()` is allowed temporarily but should be flagged.**
- **Don't use a bare `chan struct{}` as a "lock"; use `sync.Mutex`.**

### Picking what to adopt

A team doesn't need to follow one guide exclusively. A practical approach: take Effective Go as the floor, add the Uber rules around `WaitGroup` and goroutine lifetime, add Google's rules around `context`, and document the team-specific overlay.

---

## Establishing Team Conventions

Style guides cover the language. Team conventions cover the gap between "what the language allows" and "what we expect in this codebase." Examples:

- **Naming.** `Goroutine` helpers are in package `safego`. Worker pools in `pool`. Cancellable workers expose `Run(ctx)`.
- **Error policy.** Worker errors that don't represent failure (e.g., expected `context.Canceled`) are filtered before propagation.
- **Logging.** Recovered panics log at `ERROR` with the goroutine name and a stack.
- **Metrics.** Every long-running goroutine increments `goroutine_alive{name="..."}` on start and decrements on exit. The metric tells you on a dashboard exactly which goroutines are running.
- **Tests.** Every package uses `goleak.VerifyTestMain`. Tests that legitimately leave background goroutines (HTTP/2 transport) declare it.
- **Code review.** The checklist above is in `CONTRIBUTING.md`. New reviewers walk through it.

Document the conventions in one place. Reference them in PR templates. The discipline is enforceable only if it's written down.

---

## Linters and Automated Enforcement

A linter that catches a rule violation before review is worth ten checklist items. Useful ones for goroutine discipline:

| Linter | What it catches |
|---|---|
| `staticcheck` | SA1029 (context keys), SA1019 (deprecated `Sleep` patterns), SA4006 (unused values), and many concurrency-relevant patterns. |
| `errcheck` | Unchecked errors — including those from goroutine bodies. |
| `contextcheck` | Functions that accept `Context` but don't pass it to callees. |
| `containedctx` | `Context` stored in struct fields. |
| `noctx` | HTTP requests without `context.Context`. |
| `bodyclose` | HTTP response bodies that aren't closed (often in goroutines). |
| `loopclosure` (go vet) | Loop variable captured by goroutine (pre-1.22). |
| `revive` | Style; can enforce "context first argument" and many other rules. |
| `gosec` | Some race-related smells. |
| `wsl` | Whitespace; helps make `defer wg.Done()` immediately follow `go func() {`. |

Build them into the CI pipeline as a separate stage. Failing the lint stage should fail the PR check.

For deeper analysis:

- `go vet` with stdlib analysers catches a baseline of obvious bugs (printf format, lock copy, etc).
- `golangci-lint` aggregates many of the above with one configuration.
- Custom analysers can be written with `golang.org/x/tools/go/analysis` for team-specific rules (e.g., "every `go` statement must be a call to one of our helper functions").

---

## Concurrency Architecture Reviews

A senior engineer reviewing a new service's design asks the concurrency questions before code is written:

1. **What is the maximum number of goroutines this service will have under load?** "Unbounded" is unacceptable.
2. **What is the lifetime of each kind of goroutine?** Per-request? Service-lifetime? Per-job?
3. **What signals a goroutine to exit?** Context cancel, closed channel, both?
4. **Where does shared state live?** Per-request, per-worker, global?
5. **Where are the locks?** What's the lock order?
6. **What happens on SIGTERM?** Drain queue, cancel context, wait with deadline, force exit?
7. **What does the goroutine profile look like on a healthy node?** A baseline you can compare against during incidents.
8. **What's the leak-detection plan?** `goleak` in tests, `pprof` scraping in production?

Document the answers in a design doc. Re-read them six months later when you're debugging.

---

## Postmortem Patterns That Drove These Rules

Each rule has a history. Understanding the failure modes is what makes the rule stick.

### "The 4 AM page" — unbounded goroutines

A team launched a Kafka consumer that spawned one goroutine per message. Under normal load, fine. A backlog (from a partition rebalance) delivered 200 000 messages in 30 seconds. The service spawned 200 000 goroutines, allocated ~400 MB of stacks, OOMed, restarted, and re-spawned 200 000 more. Cascading restart loop, hours to recover. Rule 10 (bound concurrency) was born.

### "The 7-day leak"

A long-running gRPC client opened a stream goroutine per call but never closed it on error. Over a week, the goroutine count climbed from 1 000 to 50 000. Each goroutine held a small buffer; total memory crept from 200 MB to 4 GB. No alert until the node was at 95% memory. Rule 1 (clear exit story) and Rule 12 (leak detection) followed.

### "The Friday deploy"

A handler used `time.Sleep(100 * time.Millisecond)` to "give the background goroutine time to finish writing." Worked on developer laptops. CI passed. On a busy production node, the goroutine took 500 ms on its first run. The handler returned a 200 to the user with the database write not yet committed. The user re-submitted; double-write. Rule 8 (no `time.Sleep`) and Rule 9 (race detector) followed.

### "The panic that took down everything"

A worker pool processed JSON from a queue. One malformed message triggered a nil pointer dereference. The panic killed the *process*, not the worker. Every other worker died with it. The entire fleet (sharing the same poison message) crashed in lockstep. Rule 5 (recover at boundary) followed.

### "The mystery race"

A session token was stored in a goroutine-shared map. Two requests with similar timing caused one user to briefly see another's session. Discovered by a user; not by tests. Rule 9 (race detector in CI) was now non-negotiable.

Tell these stories during onboarding. The rules are not arbitrary; they are scars.

---

## Onboarding New Engineers

A new engineer joining a Go team needs:

1. **Read the team's concurrency conventions doc.** Time-boxed: 30 minutes.
2. **Walk through the checklist on a real PR.** With a senior engineer.
3. **Run the race detector and `goleak` locally.** See them flag real bugs.
4. **Pair-review a concurrent feature.** Be the second pair of eyes.
5. **Find a leak in the codebase.** Often this is a known one held back for training.

Roughly 1 week of dedicated time produces a engineer who can review goroutine code. Two weeks produces one who can write it confidently.

---

## Library Authoring vs Application Authoring

The rules apply differently in libraries versus applications.

### In application code

- You control `main`. You spawn goroutines yourself.
- You enforce conventions via your codebase's helpers.
- You decide when to `os.Exit`.

### In library code

- You do not control `main`. You may or may not be allowed to spawn goroutines.
- You must **never** spawn a goroutine the caller doesn't know about. Exception: documented background goroutines (e.g., a `Client` with a connection pool). Document them.
- You must **never** panic on bad inputs in a goroutine. Recover and return an error to the caller via a channel or callback.
- You must document every exported type's concurrency policy.
- You must not assume the caller passes `context.Background()`. Always thread the context.

A library that spawns surprise goroutines is unusable in production. A library that returns the goroutines via channels and accepts `Context` is reusable.

---

## Migration: Cleaning Up a Legacy Codebase

When you inherit a codebase that grew without these disciplines, the cleanup follows a sequence:

### Phase 1: Visibility

- Add `goleak.VerifyTestMain` to every test package. Most will fail. Don't fix; record.
- Enable `-race` in CI. Most tests will fail. Don't fix; record.
- Add a goroutine count metric to production. Watch it.

### Phase 2: Stop the bleeding

- Add a `safeGo` helper.
- Forbid bare `go` in new code (via review + lint).
- Forbid `time.Sleep` in tests (via review + lint).

### Phase 3: Fix systematically

- Pick the worst leak from `pprof`. Fix it. Verify by re-running.
- Pick the worst race from `-race`. Fix it. Verify.
- Repeat. Track progress on a dashboard: `go_goroutines_leaked` and `race_failures_per_week`.

### Phase 4: Convention

- Write the team's conventions doc.
- Add the code review checklist to `CONTRIBUTING.md`.
- Onboard the team.

### Phase 5: Bound

- For each unbounded `go f()` pattern, replace with a worker pool.
- Add `errgroup.SetLimit` wherever fan-out exists.

A realistic cleanup takes months, not days. The order matters: visibility before fixes, fixes before conventions, conventions before scaling.

---

## When to Break the Rules

Every rule has a "but" case. The senior judgement is knowing when.

| Rule | Acceptable exception |
|---|---|
| Clear exit story (1) | The goroutine genuinely runs for the lifetime of the process (e.g., metrics flusher). Document it. |
| `wg.Add` in parent (2) | Inside a self-spawning closure that adds to itself recursively (rare; consider `errgroup` instead). |
| Pass loop variables (3) | Single-iteration cases where there's no ambiguity. Still safer to pass. |
| Thread context (4) | Trivial helpers that complete synchronously. The threshold is "could this ever block on I/O." |
| Recover at boundary (5) | Trusted code that handles all its own errors (e.g., pure computation on validated input). |
| Prefer errgroup (6) | When the parent wants partial results regardless of errors, hand-roll. |
| Channels for flow (7) | Performance: a contended `sync.Mutex` may outperform a channel and vice versa. Benchmark. |
| No `time.Sleep` (8) | Tickers, backoffs. Never as "wait until done." |
| Race detector in CI (9) | Code that intentionally races and uses `sync/atomic` to define the semantics — but flag those packages explicitly. |
| Bound concurrency (10) | When input is known finite and small. Still safer to bound. |
| Document safety (11) | Internal/unexported types with one user. Still helpful to document. |
| `goleak`/pprof (12) | A test that legitimately leaves background goroutines. Use `goleak.Ignore*`. |

Break a rule with a comment explaining why. The comment is the rule.

---

## Self-Assessment

- [ ] I have run a code review using a goroutine checklist.
- [ ] I can recite the major differences between Effective Go, Uber, and Google style guides on concurrency.
- [ ] I have set up `golangci-lint` with concurrency-relevant linters.
- [ ] I have written a `CONTRIBUTING.md` section on goroutine conventions.
- [ ] I have led the cleanup of at least one leaky service.
- [ ] I can tell at least one production-postmortem story for each major rule.
- [ ] I know which Uber rules my team adopted and which it didn't.
- [ ] I have onboarded an engineer onto goroutine conventions.
- [ ] I have written a library that respects "no surprise goroutines."
- [ ] I have made a defensible decision to *break* one of the rules in a real codebase.

---

## Summary

At senior level the goroutine rules become a system: a code review checklist, a linter ruleset, a team convention document, a postmortem-driven curriculum. The depth comes from knowing why each rule exists, where the major published style guides agree and disagree, and how to migrate a legacy codebase toward discipline without breaking it. The rules are not arbitrary; each one is the scar of a real outage. The next step — professional — is about how the rules map to runtime invariants and what each violation costs in observable terms.
