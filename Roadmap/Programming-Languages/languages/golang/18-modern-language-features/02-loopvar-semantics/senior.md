# Loop Variable Semantics (Go 1.22) — Senior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Why This Broke the Go 1 Compatibility Mold](#why-this-broke-the-go-1-compatibility-mold)
3. [The Data Behind the Decision](#the-data-behind-the-decision)
4. [The Gating Design as a Migration Mechanism](#the-gating-design-as-a-migration-mechanism)
5. [Migrating a Large Codebase](#migrating-a-large-codebase)
6. [The Rare Programs That Broke](#the-rare-programs-that-broke)
7. [Retiring the `v := v` Idiom and Loop-Capture Linters](#retiring-the-v-v-idiom-and-loop-capture-linters)
8. [Performance as a Design Constraint](#performance-as-a-design-constraint)
9. [API and Library Design Implications](#api-and-library-design-implications)
10. [Teaching and Code-Review Implications](#teaching-and-code-review-implications)
11. [Anti-Patterns](#anti-patterns)
12. [Senior-Level Checklist](#senior-level-checklist)
13. [Summary](#summary)

---

## Introduction

A senior engineer's interest in the Go 1.22 loopvar change is not "what does it do" but "why was a *language semantics change* acceptable in a language whose central promise is backward compatibility, how was it validated, how does the gating mechanism let an ecosystem migrate without a flag day, and what does it mean for how I write, review, and teach loops." The mechanical content is in [junior.md](junior.md) and [middle.md](middle.md). This file is about the engineering judgment around it.

The change is unusual in Go's history: it altered the observable behavior of existing syntax. The Go team's willingness to do it — and the careful machinery that made it safe — is itself a case study in how to evolve a language with a strong compatibility guarantee.

After reading this you will:
- Understand why this change was deemed compatible despite changing behavior
- Know the evidence the team gathered before shipping it
- Be able to plan and execute a fleet-wide migration
- Recognize the rare code that genuinely breaks, and how to find it
- Reason about the performance contract and its design constraints
- Adjust your library design, review practices, and teaching accordingly

---

## Why This Broke the Go 1 Compatibility Mold

Go's compatibility promise (the "Go 1 guarantee") says programs that work today keep working with future Go 1.x toolchains. A change that makes `for i := range xs { go f(i) }` print different output is, on its face, a violation. So how was it justified?

Three arguments, in order of weight:

1. **The "intent" argument.** The promise is about *not breaking working programs*. The overwhelming majority of programs affected by this change were **already broken** — they exhibited a bug the author did not intend. Fixing a bug that nobody wanted is not "breaking" in spirit, even if output changes. The promise protects intended behavior, and almost nobody intended `3 3 3`.

2. **The gating argument.** The change is opt-in via the `go` directive. A program that does nothing keeps its old behavior forever. Behavior only changes when the author *raises the directive* — a deliberate act equivalent to adopting a new language version. This converts a global breaking change into a per-module, author-controlled migration. The compatibility promise is preserved at the level it actually operates: a given source + a given directive always behaves the same.

3. **The precedent argument.** The Go team had already established (in the compatibility doc revisions accompanying Go 1.21) that the `go` directive could gate language semantics, not just enable new syntax. Loopvar is the flagship use of that mechanism. The directive became a true "language version selector," and behavior changes are legitimate *when gated by it*.

The senior insight: Go's compatibility promise was *refined*, not violated. It now reads, in effect, "a program built with a given `go` directive behaves consistently across toolchains." The directive is the unit of compatibility, and changing behavior across directive bumps is permitted — even encouraged when it fixes a pervasive bug.

---

## The Data Behind the Decision

The Go team did not change loop semantics on intuition. They ran experiments at scale, and the numbers are the reason the change shipped.

Key findings (from the design doc and the loopvar blog post):

- **The change is a no-op for most code.** The vast majority of loops do not capture the loop variable; they read it and move on. For these, old and new semantics are observationally identical, and the compiler emits identical code.
- **Among code that *does* capture**, the change fixed far more programs than it broke. When the team applied the new semantics across Google's enormous Go codebase and the public module ecosystem, the test failures that appeared were dominated by tests that had been *silently passing while testing the wrong thing* (the parallel-subtest pattern) — i.e., the change exposed latent bugs.
- **Genuine breakage was rare and shallow.** The cases where the new behavior produced a *wrong* result for a program that was previously *correct* were a tiny fraction, and were almost always easy to spot and fix once identified.
- **A preview rollout (`GOEXPERIMENT=loopvar` in Go 1.21) let the community validate** the change on their own code before it became the default, surfacing edge cases ahead of the 1.22 release.

The methodology matters as much as the result: the team treated a language change like a large-scale refactor, measured its blast radius empirically, and shipped only after the data showed the benefit dwarfed the cost. This is the bar for evolving a widely-used language responsibly.

---

## The Gating Design as a Migration Mechanism

The `go`-directive gate is more than a compatibility shim; it is a *migration architecture* for the whole ecosystem.

### Independent, incremental adoption

Because the gate is per-module, every module migrates on its own schedule. There is no coordinated flag day, no requirement that all dependencies move together. Your service can adopt 1.22 semantics while depending on libraries still on 1.21 — and those libraries keep their old, tested behavior until *their* maintainers choose to bump.

### Behavior is a function of (source, directive)

The gate makes loop behavior a pure function of the source and the module's directive. This is a strong, reasoning-friendly property: given a file and its module's `go.mod`, you can determine the loop semantics deterministically, without knowing the toolchain version. CI, code review, and debugging all benefit.

### The cost: a versioned mental model

The price is that engineers must now hold a versioned model of the language. "What does this loop do?" requires "what's the directive?" For most, this is a small tax paid once. But it does mean onboarding material, internal docs, and code-review checklists must reference the directive, not just the syntax.

### Forward compatibility per file

Go 1.21+ also added per-file language-version constraints (`//go:build go1.22`), letting a single file *require* a minimum language version. This composes with the module directive: a file can demand at least 1.22 semantics. In practice the module directive is the primary lever for loopvar; the per-file mechanism is for libraries that need to guarantee a feature's availability.

---

## Migrating a Large Codebase

Migrating a fleet to `go 1.22` is mostly mechanical, but the senior job is to de-risk it.

### Phase 1 — Inventory and preview

- Enumerate modules and their current `go` directives.
- For each, run the test suite under the previewed behavior (historically `GOEXPERIMENT=loopvar` on 1.21, or simply build with a 1.22 toolchain and a bumped directive on a branch). Capture diffs in test results.

### Phase 2 — Triage failures

Test failures after the bump fall into three buckets:

1. **Tests that now pass correctly** (previously masked bugs) — celebrate, keep.
2. **Tests that now fail because the *test* relied on the old behavior** — fix the test.
3. **Production code that relied on the shared variable** — the rare, real breakage. Fix the code explicitly (see [The Rare Programs That Broke](#the-rare-programs-that-broke)).

### Phase 3 — Bump directives, isolated

Bump the `go` directive in its own commit/PR per module. Keep it separate from cleanup so the *behavior change* is reviewable on its own and bisectable if something regresses.

### Phase 4 — Cleanup, separately

In follow-up PRs, remove redundant `v := v` shadows and loop-capture-only argument passing, and retire obsolete linters. Cosmetic, reviewable, low-risk.

### Phase 5 — Guardrails

- Set a minimum directive policy (e.g. "all new modules target ≥ 1.22").
- Add a CI check that flags modules below the policy floor.
- Update onboarding docs to teach the new semantics as the default.

The migration is usually low-drama. The discipline is in *isolating the behavior change*, *triaging failures correctly*, and *not conflating the bump with cleanup*.

---

## The Rare Programs That Broke

Most "breakage" is actually bug-fixing. But a genuine minority of programs depended on the shared variable. Knowing the shapes helps you find them.

### Shape 1 — Accumulating into a single captured variable on purpose

Code that *intended* all closures to observe the final value — e.g. building a closure that should reflect "the last item processed." Under the old semantics this worked by accident of the shared variable. Under 1.22 each closure gets its own value, so the "all see the last" behavior is lost.

Fix: hoist an explicit variable outside the loop and assign to it, making the intent obvious:

```go
var last Item
for _, v := range items {
    last = v
}
use(func() { handle(last) }) // explicit: capture the outer 'last'
```

### Shape 2 — Relying on address stability of `&v`

Code that took `&v` and expected the *same* address every iteration (e.g. to detect "this is still the loop's variable"). Under 1.22 `&v` differs each iteration. This is exotic and usually wrong, but it exists.

Fix: use an explicit single variable outside the loop if you genuinely need a stable address.

### Shape 3 — Subtle goroutine timing assumptions

Code that captured the loop variable in a goroutine and *relied* on the race to read the final value as a cheap "latest" signal. Fragile and racy already; 1.22 removes the accidental behavior.

Fix: use a proper synchronization primitive (channel, atomic) for "latest value," not a captured loop variable.

The common thread: these programs were exploiting an accident. The fix is always to make the intent explicit with a variable whose scope and identity you control directly.

---

## Retiring the `v := v` Idiom and Loop-Capture Linters

For a decade, Go code and Go tooling carried defenses against the loopvar bug. In a fully-migrated codebase, those defenses are dead weight.

### The `v := v` shadow

In `go 1.22+` modules it is redundant. Removing it is a cosmetic cleanup with identical runtime behavior. But:

- **Do not remove it in code that must also build under an older directive.** If a file might be compiled with a 1.21 directive (a shared library targeting old consumers), the shadow is load-bearing.
- **Remove it in a dedicated pass**, reviewed separately from the directive bump, so the diff is obviously behavior-preserving.

### Loop-capture linters

`go vet`'s `loopclosure` became directive-aware: it no longer flags the pattern in 1.22+ packages. Third-party linters built solely for this bug — `exportloopref`, `scopelint`, and parts of others — are obsolete in a fully-1.22 codebase. Running them:

- Wastes CI time.
- Can produce false positives if they are not themselves directive-aware.

Audit your linter config after migration and drop the loop-capture-specific ones. Keep general-purpose suites (`staticcheck`, `golangci-lint`) but disable the now-redundant checks.

The principle: a language fix should retire its workarounds. Carrying them forward is technical debt that confuses new contributors ("why is this `tc := tc` here?").

---

## Performance as a Design Constraint

The Go team would not have shipped this if it slowed down idiomatic code. The performance contract was a *design constraint*, not an afterthought, and understanding it informs how you write loops.

### The contract

- **Non-capturing loops pay nothing.** Escape analysis keeps the per-iteration variable in reused stack/register storage; the generated code is identical to pre-1.22. This is the common case and it is free.
- **Capturing loops pay exactly what `v := v` paid.** When the variable escapes, each iteration's variable is separately allocated. The change did not introduce a new cost; it automated an existing one.

### Why this matters for design

Because the cost is *only* incurred on capture, the change does **not** push you to restructure hot loops defensively. The pre-1.22 advice for hot paths — don't allocate per iteration, don't capture in tight loops — is unchanged. If a loop was allocation-free before, it is allocation-free after, *unless it captures*, in which case it was already paying (or buggy).

### Verifying

`go build -gcflags=-m` reports escape decisions. In a migrated codebase, a loop that newly allocates per iteration is signaling that it captures the variable — which is a correctness-relevant fact worth seeing in review, not a regression to fear.

The senior framing: the change is *performance-neutral by construction* for the code that matters, and *performance-honest* for capturing code (it surfaces the real cost instead of hiding a bug). This is the right trade-off.

---

## API and Library Design Implications

The change ripples into how you design APIs that interact with loops.

### Iterators and range-over-func

With range-over-func (1.23), library authors expose iterators consumed by `for v := range seq`. The per-iteration guarantee means consumers can capture yielded values in closures safely. Design your iterators knowing that callers *will* capture; the language now makes that ergonomic and correct.

### Callback-collecting APIs

APIs that accept callbacks built in a loop (event registration, route handlers, deferred cleanups) are now safer to use idiomatically. You can document the simple pattern instead of warning users to shadow the loop variable. Update your docs and examples to drop the obsolete workaround.

### Library `go` directive choice

A library's `go` directive determines *its own* loop semantics, not its consumers'. Setting it to 1.22 means your library's internal loops are per-iteration — usually a fix. But it also raises your minimum supported toolchain. Balance the safety win against the support-window cost for libraries with conservative consumers.

### Backward-compatible examples

If you publish examples meant to compile under a range of Go versions, prefer the **argument-passing** form (`go func(x){...}(v)`) — it is correct under every directive and teaches a version-independent habit.

---

## Teaching and Code-Review Implications

### Teaching

The single most-taught Go gotcha is now obsolete *for current code*. Update curricula:

- Teach the per-iteration behavior as the default.
- Teach the bug *historically* — learners will encounter old code, old tutorials, and pre-1.22 modules — but frame it as "what to recognize, not what to fear."
- Always tie loop behavior to the `go` directive; make "check the directive" a reflex.

### Code review

- A `v := v` in a 1.22+ module is a smell to clean up, not a correctness requirement.
- A `go vet` loopclosure warning means the package's directive is below 1.22 — investigate the directive, not just the loop.
- Reviewing a directive bump from 1.21 to 1.22: ask "were the tests re-run, especially parallel and table-driven ones?" and "did anyone search for intentional shared-variable reliance?"
- A loop that newly allocates per iteration after a bump is *capturing* — confirm the capture is intended.

---

## Anti-Patterns

- **Bumping the `go` directive without re-running concurrency and table-driven tests.** The bump can fix *and* (rarely) break; you need the signal.
- **Conflating the directive bump with `v := v` cleanup in one PR.** Mixes a behavior change with cosmetics; hard to review and bisect.
- **Removing `v := v` from code that still builds under a 1.21 directive.** Reintroduces the bug for those builds.
- **Assuming the toolchain version fixes dependencies.** Each module follows its own directive; a 1.21 dependency keeps the bug.
- **Keeping loop-capture linters in CI after full migration.** Wasted time, possible false positives.
- **Relying on the shared variable on purpose by pinning the directive to 1.21.** Fragile and confusing; make the intent explicit with an outer variable instead.
- **Teaching `v := v` as still-required in 2026.** It misleads learners and propagates obsolete habits.
- **Treating a new per-iteration allocation as a regression to revert.** It is correctness surfacing a real cost; address it by not capturing, not by reverting the directive.
- **Setting a library's directive to 1.22 without considering its consumers' minimum toolchain.** Raises the support floor; weigh it deliberately.

---

## Senior-Level Checklist

- [ ] Articulate why the change is compatible *because* it is gated by the `go` directive
- [ ] Explain the empirical methodology that justified shipping it
- [ ] Plan a fleet migration that isolates the directive bump from cleanup
- [ ] Triage post-bump test failures into "fixed bug / fix the test / real breakage"
- [ ] Recognize the three shapes of genuine shared-variable reliance and fix them explicitly
- [ ] Retire `v := v` and loop-capture linters — except where old directives are still in play
- [ ] State the performance contract: free when not captured, `v := v`-cost when captured
- [ ] Adjust library docs/examples to drop the obsolete workaround
- [ ] Choose a library's `go` directive deliberately, weighing the support window
- [ ] Update teaching and code-review practice to be directive-aware
- [ ] Avoid pinning to 1.21 to exploit the old behavior; make intent explicit instead

---

## Summary

The Go 1.22 loopvar change is a rare and instructive event: a deliberate change to the observable behavior of existing syntax, in a language built on backward compatibility. It was justified on three grounds — most affected programs were already buggy, the change is gated per module by the `go` directive so behavior is a function of (source, directive), and the directive had already been established as a legitimate language-version selector. The decision rested on empirical data: the change is a no-op for most loops, fixes far more programs than it breaks, and was validated via a preview experiment before shipping.

The gating design is a migration architecture: every module adopts the new semantics on its own schedule, with no flag day, and a 1.22 module can safely depend on 1.21 libraries that keep their tested behavior. A senior migration isolates the directive bump from cleanup, triages failures correctly, and finds the rare code that genuinely relied on the shared variable — always fixing it by making intent explicit with a variable whose scope you control. The performance contract is neutral by construction (free when not captured, the old `v := v` cost when captured), so it imposes no defensive restructuring of hot loops. The downstream work is mostly retirement: drop `v := v`, drop loop-capture linters, update docs and curricula, and make "check the `go` directive" a reflex in review. The change closed the most famous gotcha in Go — the senior responsibility is to migrate to it cleanly and to stop teaching the workaround.
