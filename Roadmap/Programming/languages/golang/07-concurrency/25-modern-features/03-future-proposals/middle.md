---
layout: default
title: Future Proposals — Middle
parent: Future Concurrency Proposals
grand_parent: Modern Concurrency Features
ancestor: Go
nav_order: 3
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/25-modern-features/03-future-proposals/middle/
---

# Future Proposals — Middle

[← Back](../)

> Forward-looking content ages. Issue numbers and statuses below were accurate at the time of writing; verify against `github.com/golang/go/issues` before relying on anything marked experimental or proposed.

## Table of Contents
1. [What this file assumes](#what-this-file-assumes)
2. [Landed: range-over-func iterators (1.23)](#landed-range-over-func-iterators-123)
3. [Landed: testing/synctest (1.24 experiment → 1.25)](#landed-testingsynctest-124-experiment--125)
4. [Reading code that uses iterators concurrently](#reading-code-that-uses-iterators-concurrently)
5. [Proposed/discussed: structured concurrency](#proposeddiscussed-structured-concurrency)
6. [Proposed/discussed: goroutine-leak detection](#proposeddiscussed-goroutine-leak-detection)
7. [How to evaluate a proposal](#how-to-evaluate-a-proposal)
8. [Common middle-level mistakes](#common-middle-level-mistakes)
9. [Cheat sheet](#cheat-sheet)
10. [Self-assessment checklist](#self-assessment-checklist)
11. [Summary](#summary)
12. [Further reading](#further-reading)

---

## What this file assumes
You're comfortable with goroutines, channels, `context`, and the modern `sync` helpers. This file surveys concurrency-relevant features that recently landed or are under discussion, so you can recognize them in code review and reason about them — not so you can ship experimental APIs to production.

---

## Landed: range-over-func iterators (1.23)
Go 1.23 made `for x := range f` work when `f` is an iterator function (`func(yield func(V) bool)`). This is mostly a sequential feature, but it interacts with concurrency in two ways you must understand:

```go
func Lines(r io.Reader) func(func(string) bool) {
    return func(yield func(string) bool) {
        sc := bufio.NewScanner(r)
        for sc.Scan() {
            if !yield(sc.Text()) {
                return // consumer broke out; clean up here
            }
        }
    }
}

for line := range Lines(file) {
    if strings.HasPrefix(line, "#") {
        break // triggers yield returning false → iterator cleans up
    }
}
```

**Concurrency implications:**
- An iterator is **not** safe to drive from multiple goroutines simultaneously — it's a single sequential loop.
- If your iterator launches goroutines, you own their lifecycle: a `break` in the consumer makes `yield` return `false`, and you must stop and join any goroutines you started before returning.

---

## Landed: testing/synctest (1.24 experiment → 1.25)
`testing/synctest` (GOEXPERIMENT in 1.24, stabilized later) lets you test concurrent code with a **fake clock** inside a "bubble." Goroutines that sleep or wait on timers advance virtual time deterministically once all goroutines in the bubble are blocked.

```go
//go:build goexperiment.synctest
func TestTimeout(t *testing.T) {
    synctest.Run(func() {
        done := make(chan struct{})
        go func() {
            time.Sleep(time.Hour) // virtual: returns instantly when all blocked
            close(done)
        }()
        <-done // test completes in microseconds, not an hour
    })
}
```

This solves the perennial pain of testing timeouts and tickers without real sleeps and without flakiness. Recognize it when you see `synctest.Run` — the time inside is fake and deterministic.

---

## Reading code that uses iterators concurrently
A common pattern is wrapping a channel as an iterator:

```go
func Stream[T any](ch <-chan T) func(func(T) bool) {
    return func(yield func(T) bool) {
        for v := range ch {
            if !yield(v) {
                return // consumer stopped; we stop reading
            }
        }
    }
}
```

The subtlety: when the consumer `break`s, the iterator returns, but the *producer* still sending to `ch` may now block forever (goroutine leak) unless cancellation is wired in. The iterator sugar hides the channel but not the leak. Always check that the producer has a `ctx`/`done` path.

---

## Proposed/discussed: structured concurrency
There is long-running discussion (see the `02-structured-concurrency` page and various golang/go issues) about first-class structured concurrency — a construct that guarantees child goroutines cannot outlive their parent scope. Today the closest real tools are `errgroup` and `context`. Proposals aim to make "no goroutine escapes this block" a language- or library-enforced property. Status: discussed, nothing accepted into the language as of writing. The practical takeaway: use `errgroup` for scoped goroutine lifetimes now; watch the space.

---

## Proposed/discussed: goroutine-leak detection
Tooling and proposals exist around detecting leaked goroutines (e.g., `go.uber.org/goleak` in userland; runtime-level ideas under discussion). These help catch the exact bug the iterator/channel example above produces. Recognize `goleak.VerifyNone(t)` in test files — it fails a test that leaves goroutines running.

---

## How to evaluate a proposal
When you encounter a feature flagged experimental or "proposed":
1. **Find the canonical issue** on `github.com/golang/go/issues` and read its current status.
2. **Check the Go version** it targets and whether it's behind a `GOEXPERIMENT`.
3. **Never depend on experimental APIs in production** — they can change or vanish between releases.
4. **Understand the problem it solves**, so you can choose the stable equivalent (`errgroup`, `context`, `synctest`) today.

---

## Common middle-level mistakes
1. **Driving a range-over-func iterator from multiple goroutines** — it's sequential.
2. **Letting a producer leak** when a consumer `break`s out of a channel-backed iterator.
3. **Using `GOEXPERIMENT` features in production builds** — they're unstable by definition.
4. **Assuming structured concurrency exists in the language** — it doesn't yet; use `errgroup`.
5. **Real `time.Sleep` in tests** when `testing/synctest` would make them fast and deterministic.

---

## Cheat sheet

| Feature | Status (at writing) | Use today via |
|---|---|---|
| range-over-func | landed 1.23 | use directly; mind goroutine cleanup |
| testing/synctest | experiment 1.24 → stable later | fake-clock concurrency tests |
| structured concurrency | discussed | `errgroup` + `context` |
| goroutine-leak detection | userland + proposed | `go.uber.org/goleak` |

---

## Self-assessment checklist
- [ ] I can read a range-over-func iterator and spot a producer leak.
- [ ] I know an iterator is sequential, not concurrent.
- [ ] I can recognize `synctest.Run` and explain its fake clock.
- [ ] I know structured concurrency isn't in the language yet and use `errgroup`.
- [ ] I never ship `GOEXPERIMENT` features to production.
- [ ] I verify a proposal's current status before relying on it.

---

## Summary
The recent concurrency-adjacent additions are range-over-func iterators (1.23) and `testing/synctest`'s deterministic fake clock. Iterators are sequential and can hide goroutine leaks behind their sugar — always check the producer's cancellation path. `synctest` finally makes timeout/ticker tests fast and non-flaky. Structured concurrency and leak detection remain discussion-stage; use `errgroup`, `context`, and `goleak` as today's stable equivalents, and never depend on `GOEXPERIMENT` APIs in production.

In `senior.md` we'll look at how to adopt these features behind build tags, how to keep production code insulated from experimental churn, and how to migrate when a proposal lands.

---

## Further reading
- "Range over function types" — https://go.dev/blog/range-functions
- `testing/synctest` proposal — https://github.com/golang/go/issues/67434
- Go release notes index — https://go.dev/doc/devel/release
- `go.uber.org/goleak` — https://pkg.go.dev/go.uber.org/goleak

---

[← Back](../)
