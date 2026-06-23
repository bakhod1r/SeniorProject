---
layout: default
title: Future Proposals — Senior
parent: Future Concurrency Proposals
grand_parent: Modern Concurrency Features
ancestor: Go
nav_order: 4
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/25-modern-features/03-future-proposals/senior/
---

# Future Proposals — Senior

[← Back](../)

> Forward-looking content ages. Verify statuses against `github.com/golang/go/issues` before acting on anything below.

## Table of Contents
1. [What this file is](#what-this-file-is)
2. [A policy for experimental features in production](#a-policy-for-experimental-features-in-production)
3. [Isolating experimental code behind build tags](#isolating-experimental-code-behind-build-tags)
4. [Adopting synctest in a real test suite](#adopting-synctest-in-a-real-test-suite)
5. [Migrating to range-over-func without breaking APIs](#migrating-to-range-over-func-without-breaking-apis)
6. [Designing for a structured-concurrency future](#designing-for-a-structured-concurrency-future)
7. [Influencing and tracking proposals](#influencing-and-tracking-proposals)
8. [Anti-patterns at scale](#anti-patterns-at-scale)
9. [Cheat sheet](#cheat-sheet)
10. [Self-assessment checklist](#self-assessment-checklist)
11. [Summary](#summary)
12. [Further reading](#further-reading)

---

## What this file is
Middle surveyed the features; this file is about governing their adoption in a real codebase. The senior responsibility is to capture the value of new concurrency features without exposing production to experimental churn, and to position today's code so that landing proposals are an easy migration rather than a rewrite.

---

## A policy for experimental features in production
Adopt a written rule for the team:

- **Stable, released features** (range-over-func since 1.23): adopt freely once the minimum supported Go version allows it.
- **`GOEXPERIMENT`-gated features** (`synctest` early on): allowed in **tests only**, never in shipped binaries; CI builds production with the experiment off.
- **Proposed/unaccepted designs:** do not depend on them; instead, use the stable equivalent (`errgroup`, `context`) and keep the code shaped so a future migration is local.

This policy turns "should we use this?" from a per-PR debate into a checkbox.

---

## Isolating experimental code behind build tags
When you must touch an experimental API (almost always in tests), fence it so the main build never sees it.

```go
//go:build goexperiment.synctest

package mypkg_test

import "testing/synctest"
// experimental-only test helpers here
```

Production code and CI release builds compile without the tag and are unaffected. The experimental surface is contained to files that literally cannot enter the release binary. Apply the same discipline to any vendored experimental package: keep the import behind a tag and provide a stable fallback for the default build.

---

## Adopting synctest in a real test suite
`testing/synctest` is the highest-leverage recent feature for senior engineers because it kills an entire class of flaky, slow tests. Adoption strategy:

1. Identify tests that use real `time.Sleep`, tickers, or timeouts — these are your flake sources.
2. Wrap them in `synctest.Run` so virtual time advances deterministically when all goroutines block.
3. Gate them behind the experiment build tag until your minimum Go version ships it stable.
4. Measure CI wall-time improvement; timeout tests drop from seconds to microseconds.

The payoff is both speed and determinism: a test that asserts "this times out after 30s" runs instantly and never flakes on a loaded CI runner.

---

## Migrating to range-over-func without breaking APIs
Range-over-func lets you offer iterator-based APIs, but introducing one shouldn't break existing callers. Provide the iterator *alongside* the existing slice/channel API:

```go
// Existing API (keep it).
func (s *Store) All() []Item { ... }

// New iterator API (additive). Note the goroutine-cleanup contract.
func (s *Store) Iter() func(func(Item) bool) {
    return func(yield func(Item) bool) {
        // if this launches goroutines, stop+join them when yield returns false
        for _, it := range s.items {
            if !yield(it) {
                return
            }
        }
    }
}
```

The senior concern is the **cleanup contract**: any goroutines or resources an iterator owns must be released when the consumer breaks (yield returns `false`). Document it, test it with `goleak`, and never expose an iterator that leaks on early break.

---

## Designing for a structured-concurrency future
You can't use language-level structured concurrency yet, but you can write code that will migrate trivially when (if) it lands:

- **Scope goroutine lifetimes with `errgroup`** so every goroutine has an owner that waits for it. This is the same shape structured concurrency would enforce.
- **Thread `context` everywhere**, so cancellation is already plumbed.
- **Never spawn a bare `go func()` whose lifetime exceeds its caller** without an explicit owner and shutdown path.

Code written this way already has the "no goroutine outlives its scope" property by convention; a future construct would just make it enforced.

---

## Influencing and tracking proposals
- Watch the relevant golang/go issues and the proposal review minutes; status changes between releases.
- Prototype against experimental APIs in a throwaway branch to give feedback — that's how proposals improve — but keep it out of `main`.
- When a proposal lands, do the migration in one focused PR, behind tests, replacing the stable-equivalent shim you'd been using.

---

## Anti-patterns at scale
1. **Experimental APIs in release binaries** — they break between versions; gate them to tests.
2. **Iterators that leak goroutines on early break** — violate the cleanup contract.
3. **Removing a stable API** to push everyone onto a new iterator — make it additive.
4. **Betting architecture on an unaccepted proposal** — design with `errgroup`/`context` instead.
5. **Real-time sleeps in tests** when `synctest` is available — slow, flaky CI.
6. **No team policy** on experimental features — endless per-PR debate.

---

## Cheat sheet

| Feature class | Production rule |
|---|---|
| Released (range-over-func) | adopt when min Go version allows; keep additive |
| `GOEXPERIMENT` (synctest early) | tests only, behind build tag |
| Proposed/unaccepted | shim with `errgroup`/`context`; migrate when it lands |
| Iterator with goroutines | enforce cleanup-on-break; test with goleak |

---

## Self-assessment checklist
- [ ] My team has a written policy for experimental concurrency features.
- [ ] I gate experimental imports behind build tags so release builds are clean.
- [ ] I can adopt `synctest` to remove flaky timeout tests.
- [ ] I introduce iterator APIs additively and enforce their cleanup contract.
- [ ] I shape goroutine lifetimes with `errgroup`/`context` for a structured-concurrency-ready design.
- [ ] I track proposal status and migrate in one focused PR when features land.

---

## Summary
Senior adoption of future features is a governance problem: ship stable features additively, fence `GOEXPERIMENT` code behind build tags so it never enters release binaries, and model unaccepted proposals with today's stable tools (`errgroup`, `context`). `testing/synctest` is the standout near-term win — it eliminates flaky, slow timeout tests. When you expose range-over-func iterators, treat the goroutine-cleanup-on-break contract as mandatory and verify it with leak detection. Write goroutine lifetimes as if structured concurrency already existed, so that when it lands the migration is local.

---

## Further reading
- "Range over function types" — https://go.dev/blog/range-functions
- `testing/synctest` issue — https://github.com/golang/go/issues/67434
- Go proposal process — https://github.com/golang/proposal
- `golang.org/x/sync/errgroup` — https://pkg.go.dev/golang.org/x/sync/errgroup

---

[← Back](../)
