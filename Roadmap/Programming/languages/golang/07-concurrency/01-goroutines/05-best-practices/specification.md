# Goroutine Best Practices — Specification

## Table of Contents
1. [What "Specification" Means Here](#what-specification-means-here)
2. [Language-Level References](#language-level-references)
3. [Standard Library References](#standard-library-references)
4. [`golang.org/x/sync/errgroup`](#golangorgxsyncerrgroup)
5. [Race Detector](#race-detector)
6. [`pprof` and Goroutine Profile](#pprof-and-goroutine-profile)
7. [`goleak`](#goleak)
8. [Style Guide Sources](#style-guide-sources)
9. [Talks, Posts, Postmortems](#talks-posts-postmortems)
10. [Version History](#version-history)

---

## What "Specification" Means Here

Best practices are not in the Go language specification — they live in a constellation of documents, packages, blog posts, and talks. This file is the index. For each rule introduced in junior, this file pins the authoritative source so you can quote it in a design review.

Where multiple sources cover a topic, the most authoritative one is listed first.

---

## Language-Level References

### The `go` statement

- **Go Programming Language Specification, "Go statements":** <https://go.dev/ref/spec#Go_statements>
- Defines that the function value and parameters are evaluated as usual *in the calling goroutine*, but the function's execution is *in a new goroutine*.
- Establishes that termination of `main` terminates the program regardless of other goroutines.

### The Go memory model

- **The Go Memory Model:** <https://go.dev/ref/mem>
- Defines happens-before, the synchronisation guarantees of channel operations, `sync.Mutex.Lock`/`Unlock`, `sync.Once.Do`, and `sync/atomic`.
- The race detector implements verification against this model.

### `for` loop semantics

- **Go 1.22 release notes, "Language changes":** <https://go.dev/doc/go1.22#language>
- "Each iteration of the loop creates new variables, to avoid accidental sharing in closures."
- Pre-1.22 behaviour is in the older spec versions; tagged as "loop variable scoping" change.

---

## Standard Library References

### `sync.WaitGroup`

- **Package docs:** <https://pkg.go.dev/sync#WaitGroup>
- "A WaitGroup waits for a collection of goroutines to finish."
- "Note that calls with a positive delta that occur when the counter is zero must happen before a Wait."
- This is the authoritative source for Rule 2 (`Add` in parent before `Wait`).

### `sync.Mutex`, `sync.RWMutex`

- **Package docs:** <https://pkg.go.dev/sync>
- "A Mutex must not be copied after first use."
- "If a goroutine holds a RWMutex for reading and another goroutine might call Lock, no goroutine should expect to be able to acquire a read lock until the initial read lock is released."

### `sync.Once`

- **Package docs:** <https://pkg.go.dev/sync#Once>
- "Once is an object that will perform exactly one action."
- Authoritative for one-shot initialisation.

### `sync.Map`

- **Package docs:** <https://pkg.go.dev/sync#Map>
- Documents the two sweet spots: (1) write-once, read-many; (2) disjoint sets of keys per goroutine.
- Explicitly says "Most code should use a plain Go map instead, with separate locking or coordination, for better type safety and to make it easier to maintain other invariants along with the map content."

### `sync/atomic`

- **Package docs:** <https://pkg.go.dev/sync/atomic>
- The Go 1.19+ typed atomics (`atomic.Int64`, `atomic.Pointer[T]`) are preferred to the legacy `AddInt64`, `LoadInt64` functions.

### `context`

- **Package docs:** <https://pkg.go.dev/context>
- "Programs that use Contexts should follow these rules to keep interfaces consistent across packages and enable static analysis tools to check context propagation."
  - Do not store Contexts inside a struct type.
  - Pass Context as the first argument.
  - The Context returned from WithCancel/WithDeadline/WithTimeout must have its cancel function called.
  - Do not pass a nil Context.
  - Use context Values only for request-scoped data that transits processes and APIs.

### `runtime/pprof`

- **Package docs:** <https://pkg.go.dev/runtime/pprof>
- `Lookup("goroutine")` returns a profile of all active goroutines.
- `SetGoroutineLabels(ctx)` attaches labels from the context.
- `WithLabels(ctx, labels)` returns a context with labels.

### `runtime`

- **Package docs:** <https://pkg.go.dev/runtime>
- `NumGoroutine()` returns the current count.
- `Gosched()` yields the CPU.
- `GOMAXPROCS(n)` sets and returns the previous value.

### `runtime/debug`

- **Package docs:** <https://pkg.go.dev/runtime/debug>
- `Stack()` returns a formatted stack trace.
- `SetGCPercent`, `SetMemoryLimit` for GC tuning relevant to concurrent throughput.

---

## `golang.org/x/sync/errgroup`

- **Package docs:** <https://pkg.go.dev/golang.org/x/sync/errgroup>
- Three methods: `Go`, `Wait`, `SetLimit`.
- `WithContext(ctx)` returns a derived context that is cancelled when any `Go` callback returns an error or `Wait` returns.
- `SetLimit(n)` was added in `x/sync v0.1.0` (corresponds roughly to Go 1.20 era).
- Source: <https://cs.opensource.google/go/x/sync/+/refs/heads/master:errgroup/errgroup.go>

Key quote from the source:

```go
// Go calls the given function in a new goroutine.
// It blocks until the new goroutine can be added without the number of
// active goroutines in the group exceeding the configured limit.
```

This is the authoritative spec of how `SetLimit` interacts with `Go`.

---

## Race Detector

- **Reference page:** <https://go.dev/doc/articles/race_detector>
- Activation: `-race` flag to `go build`, `go run`, `go test`, `go install`.
- Cost: roughly 5-10x CPU, 5-10x memory.
- Limitations:
  - Does not detect races in C code reached via cgo.
  - Reports a race when it observes one at runtime — does not prove absence of races.
- Underlying implementation: ThreadSanitizer (TSan).

---

## `pprof` and Goroutine Profile

- **`pprof` documentation:** <https://pkg.go.dev/net/http/pprof>
- Activation: import `_ "net/http/pprof"` and serve `http.DefaultServeMux`.
- Endpoints:
  - `/debug/pprof/goroutine` — goroutine profile (live goroutines and their stacks).
  - `/debug/pprof/heap` — heap profile.
  - `/debug/pprof/profile?seconds=N` — CPU profile.
  - `/debug/pprof/trace?seconds=N` — execution trace.
- Use:
  ```bash
  go tool pprof http://localhost:6060/debug/pprof/goroutine
  (pprof) top 20
  (pprof) traces
  ```

---

## `goleak`

- **Package docs:** <https://pkg.go.dev/go.uber.org/goleak>
- **Source:** <https://github.com/uber-go/goleak>
- Two entry points:
  - `goleak.VerifyNone(t)` — fail a test if extra goroutines remain.
  - `goleak.VerifyTestMain(m)` — call from `TestMain` to verify the package as a whole.
- Options:
  - `goleak.IgnoreTopFunction(name)` — accept goroutines whose top frame matches.
  - `goleak.IgnoreCurrent()` — snapshot the existing set as a baseline.

---

## Style Guide Sources

### Effective Go

- **URL:** <https://go.dev/doc/effective_go>
- Sections directly relevant:
  - "Goroutines": <https://go.dev/doc/effective_go#goroutines>
  - "Channels": <https://go.dev/doc/effective_go#channels>
  - "Parallelization": <https://go.dev/doc/effective_go#parallel>

### Go Code Review Comments

- **URL:** <https://go.dev/wiki/CodeReviewComments>
- Maintained by the Go team. Contains:
  - "Context": pass as first param.
  - "Variable Names": short, idiomatic.
  - "Synchronous Functions": prefer synchronous APIs over async-by-default.
  - "Goroutine Lifetimes": "Don't fire-and-forget goroutines. Make sure they exit."

### Uber Go Style Guide

- **URL:** <https://github.com/uber-go/guide/blob/master/style.md>
- Sections relevant:
  - "Concurrency": full chapter.
  - "Don't fire-and-forget goroutines."
  - "Channel Size is One or None."
  - "Don't copy mutexes."

### Google Go Style Guide

- **URL:** <https://google.github.io/styleguide/go/>
- The "Google Go Style Decisions" page covers concurrency conventions.
- Companion: "Google Go Style Guide" main page.

### Dave Cheney

- **"Never start a goroutine without knowing how it will stop":** <https://dave.cheney.net/2016/12/22/never-start-a-goroutine-without-knowing-how-it-will-stop>
- The canonical source for Rule 1, phrased exactly that way.

---

## Talks, Posts, Postmortems

### Talks

- **Rob Pike, "Concurrency is not parallelism":** <https://go.dev/blog/waza-talk>
- **Rob Pike, "Go Concurrency Patterns":** <https://www.youtube.com/watch?v=f6kdp27TYZs>
- **Sameer Ajmani, "Advanced Go Concurrency Patterns":** <https://www.youtube.com/watch?v=QDDwwePbDtw>
- **Bryan C. Mills, "Rethinking Classical Concurrency Patterns" (GopherCon 2018):** <https://www.youtube.com/watch?v=5zXAHh5tJqQ>

### Blog posts

- **Go Blog, "Go Concurrency Patterns: Context":** <https://go.dev/blog/context>
- **Go Blog, "Pipelines and cancellation":** <https://go.dev/blog/pipelines>
- **Go Blog, "Share Memory By Communicating":** <https://go.dev/blog/codelab-share>
- **Go Blog, "Goroutine Leaks":** assorted; search the Go blog index.

### Postmortems and case studies

- **Cloudflare, "Going to Go":** publicly discussed goroutine leaks in production.
- **Uber Engineering, "Profiling Go Programs":** real-world `pprof` flow.
- **Discord, "Why Discord is switching from Go to Rust":** discusses Go's GC + concurrency at scale.

---

## Version History

| Go version | Concurrency-relevant change |
|---|---|
| 1.0 | Goroutines, channels, `sync.Mutex`, `sync.WaitGroup` shipped. |
| 1.5 | `GOMAXPROCS` defaults to number of CPUs (was 1). |
| 1.7 | `context.Context` moved from `x/net/context` to standard library. |
| 1.14 | Asynchronous preemption (goroutines preemptible at non-call sites). |
| 1.19 | Typed atomics (`atomic.Int64`, `atomic.Pointer[T]`). |
| 1.20 | `errors.Join` for aggregating errors. `errgroup.SetLimit` was already in `x/sync`. |
| 1.21 | `slog` package (structured logging useful in panic recoveries). `context.WithoutCancel`, `context.AfterFunc`. |
| 1.22 | For-loop variables are per-iteration. `runtime.AddCleanup` previews finalizers. |
| 1.23 | Range-over-func iterators (potential alternative to channel-based pipelines for some cases). |
| 1.24 | `testing/synctest` for deterministic concurrent tests. |

Each version's release notes are at `https://go.dev/doc/goN.M` (substitute N.M).

---

## Authoritative quotes you can paste into reviews

> "If they're going to keep running, you have a bug." — Bryan C. Mills, on long-running goroutines without exit conditions.

> "Don't communicate by sharing memory; share memory by communicating." — Go Proverbs, Rob Pike.

> "A goroutine has a simple model: it is a function executing concurrently with other goroutines in the same address space." — Effective Go.

> "Use context Values only for request-scoped data that transits processes and APIs, not for passing optional parameters to functions." — `context` package docs.

> "A Mutex must not be copied after first use." — `sync` package docs.

> "Never start a goroutine without knowing how it will stop." — Dave Cheney.

> "Each iteration of the loop creates new variables." — Go 1.22 release notes.

Use these in PR comments to ground a critique in the official position.
