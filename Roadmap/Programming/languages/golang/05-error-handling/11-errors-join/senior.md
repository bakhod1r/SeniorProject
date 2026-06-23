# errors.Join — Senior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Multi-Error as a System Property](#multi-error-as-a-system-property)
3. [Concurrent Error Collection](#concurrent-error-collection)
4. [Goroutine Pools and Batched Work](#goroutine-pools-and-batched-work)
5. [API Design with Multi-Errors](#api-design-with-multi-errors)
6. [Stable Public Errors and `Join`](#stable-public-errors-and-join)
7. [Logging and Observability](#logging-and-observability)
8. [Multi-Errors Across the RPC Boundary](#multi-errors-across-the-rpc-boundary)
9. [Architectural Patterns](#architectural-patterns)
10. [Trade-offs at Scale](#trade-offs-at-scale)
11. [Anti-Patterns at Scale](#anti-patterns-at-scale)
12. [Summary](#summary)
13. [Further Reading](#further-reading)

---

## Introduction
> Focus: "How to optimize?" and "How to architect?"

Multi-errors are not just a syntactic convenience. At senior level, they are a design choice that shapes APIs, logs, retry semantics, and how information moves across services. The decision "should this function collect or short-circuit?" is sometimes the single most consequential one in a request pipeline. Get it wrong and you either swallow failures (collect-and-ignore) or deliver a frustrating "fix one, try again" UX (short-circuit-everywhere).

This file is about deploying `errors.Join` in real systems: concurrent code, public APIs, log indexes, and across service boundaries. It assumes you already know the mechanics; it focuses on the architectural consequences.

---

## Multi-Error as a System Property

Three properties to evaluate when you decide whether `Join` belongs in your design:

1. **Independence.** If errors A and B can occur for unrelated reasons in the same call, they probably belong in a join. If A *causes* B, they belong in a chain (`%w`).
2. **Actionability.** If the consumer (user or operator) can act on each error individually, returning them as siblings helps. If only the first matters, return the first and stop.
3. **Cardinality.** If the number of children is bounded by structure (e.g., one per validated field), `Join` is comfortable. If it is bounded by traffic (one per item in a million-item batch), unbounded `Join` will explode logs and memory — bound it.

A service that runs 10,000-item ETL batches and joins every per-item error produces a multi-megabyte error per failed batch. The right design might be: bound to the first 100 errors plus a count, ship them in structured form, and *not* return a joined `error` at all (use a typed report).

---

## Concurrent Error Collection

The classical pattern for collecting errors from N goroutines:

```go
func runAll(ctx context.Context, jobs []func(context.Context) error) error {
    var (
        mu   sync.Mutex
        errs []error
        wg   sync.WaitGroup
    )
    for _, job := range jobs {
        wg.Add(1)
        go func(j func(context.Context) error) {
            defer wg.Done()
            if err := j(ctx); err != nil {
                mu.Lock()
                errs = append(errs, err)
                mu.Unlock()
            }
        }(job)
    }
    wg.Wait()
    return errors.Join(errs...)
}
```

Notes for production:
- `mu` protects `errs`. Without it, concurrent appends race.
- `errors.Join(errs...)` after `wg.Wait()` — never inside the goroutine.
- The first error does not cancel the rest. If you want fail-fast semantics, use `golang.org/x/sync/errgroup` (which short-circuits on the first error and cancels the context).
- The job order is preserved by the *append* order, which is *non-deterministic*. If callers care about order, pass an index:

```go
results := make([]error, len(jobs))
for i, job := range jobs {
    wg.Add(1)
    go func(i int, j func(context.Context) error) {
        defer wg.Done()
        results[i] = j(ctx)
    }(i, job)
}
wg.Wait()
return errors.Join(results...) // nils filtered
```

No mutex needed (each goroutine writes a distinct index), order preserved.

---

## Goroutine Pools and Batched Work

`x/sync/errgroup` short-circuits on first error. For *collect-all* semantics you have two options:

### Option 1: collect-and-Join

```go
func batched[T any](ctx context.Context, items []T, work func(context.Context, T) error) error {
    errs := make([]error, len(items))
    var wg sync.WaitGroup
    sem := make(chan struct{}, runtime.NumCPU())
    for i, it := range items {
        wg.Add(1)
        sem <- struct{}{}
        go func(i int, it T) {
            defer wg.Done()
            defer func() { <-sem }()
            errs[i] = work(ctx, it)
        }(i, it)
    }
    wg.Wait()
    return errors.Join(errs...)
}
```

`sem` bounds parallelism. `errs` indexed by item position. `Join` filters nils. The function returns `nil` on a clean run.

### Option 2: bounded multi-error report

For batch jobs where a million items can fail, do *not* return a join of a million errors:

```go
type BatchReport struct {
    Total      int
    Succeeded  int
    FirstErrs  []error // up to N
    Truncated  int
}

func (r *BatchReport) Error() string {
    return fmt.Sprintf("batch %d/%d succeeded; %d errors (showing %d)",
        r.Succeeded, r.Total, r.Succeeded+len(r.FirstErrs)+r.Truncated, len(r.FirstErrs))
}

func (r *BatchReport) Unwrap() []error { return r.FirstErrs }
```

This is multi-error semantics on top of a *typed* report. `errors.Is` still works against the first N. The report itself carries summary statistics that the operator can act on.

---

## API Design with Multi-Errors

When you publish a function that returns a multi-error, decide:

### 1. Is the error type part of your contract?

If you return `*ValidationErrors` (concrete type), callers can type-assert and access `.Errs`. That is a contract you must preserve.

If you return `error` and the underlying type is `*errors.joinError` (unexported), callers can only use `errors.Is`/`As` and `Unwrap() []error`. That is a *smaller* contract — usually preferable.

### 2. Are children identifiable?

If the operation has named steps and a child error tells you "step X failed", wrap each child:

```go
errs = append(errs, fmt.Errorf("step %s: %w", stepName, err))
```

The wrap survives `errors.Is`. The label survives the `Error()` text.

### 3. Should the empty case be `nil` or a zero-value?

`errors.Join(nil, nil) == nil` is the natural design. If you return `*ValidationErrors`, write a constructor that returns `nil error` for the empty case (`AsError()` from middle.md).

A good API never makes the caller write `if err != nil && err.Some() == 0`.

### 4. Is the order significant?

Document it. Callers who depend on order will be surprised by concurrent collection that does not preserve it. Index-by-position (Option 1 above) preserves order; mutex-and-append does not.

---

## Stable Public Errors and `Join`

Sentinel errors (`var ErrFoo = errors.New("...")`) survive a round-trip through `Join`. `errors.Is(joined, ErrFoo)` works as long as `ErrFoo` is somewhere in the tree.

Two consequences for public APIs:

1. **You can return a join of sentinels and callers can branch on each.** A validator that returns `errors.Join(ErrEmailRequired, ErrTooYoung)` lets the caller test `errors.Is(err, ErrTooYoung)` and branch.

2. **Adding a sentinel inside a join is a breaking change *only if callers depend on the absence*.** Adding `ErrPhoneFormat` to the join means existing `errors.Is(err, ErrTooYoung)` calls still work. But code that asserts "the error is a 1-element join" or "the only sentinel is ErrEmailRequired" breaks.

The lesson: document the *interface* (sentinels you can match) and not the *cardinality* (how many children there are).

---

## Logging and Observability

A joined error is a wall of newlines by default. Some treatments to make it useful in logs:

### Treatment 1: Structured field per child

```go
slog.Error("validation failed",
    "errors", asStrings(errs),
    "request_id", reqID,
)

func asStrings(err error) []string {
    if err == nil { return nil }
    if u, ok := err.(interface{ Unwrap() []error }); ok {
        out := make([]string, 0, len(u.Unwrap()))
        for _, c := range u.Unwrap() {
            out = append(out, c.Error())
        }
        return out
    }
    return []string{err.Error()}
}
```

The log backend now indexes each child as a separate entry in a list — easier to query than a multi-line blob.

### Treatment 2: Fingerprint by sentinel set

```go
func fingerprint(err error) string {
    var seen []string
    walk(err, func(e error) {
        for _, s := range knownSentinels {
            if errors.Is(e, s) {
                seen = append(seen, sentinelName(s))
                return
            }
        }
    })
    sort.Strings(seen)
    return strings.Join(seen, "+")
}
```

A cardinality-friendly tag. `fingerprint(joinedErr) == "ErrEmailRequired+ErrTooYoung"` becomes a metric label that does not explode under traffic.

### Treatment 3: Aggregate counts

For batch errors, a structured count of error kinds is more useful than the full join:

```go
counts := map[string]int{}
walk(err, func(e error) {
    counts[kindOf(e)]++
})
slog.Error("batch failed",
    "request_id", reqID,
    "counts", counts,
)
```

The log entry is small; the operator sees the distribution of failures.

---

## Multi-Errors Across the RPC Boundary

`errors.Join` is in-process only. The moment you cross a network — gRPC, JSON, message queue — the `Unwrap() []error` method is gone. Two options:

### Option A: Flatten to a single message

```go
return status.Errorf(codes.InvalidArgument, "%s", err.Error())
```

The receiver gets a string. Useful for logs, useless for `errors.Is`.

### Option B: Encode the structure

For gRPC, attach a structured `BadRequest` detail:

```go
import "google.golang.org/genproto/googleapis/rpc/errdetails"

br := &errdetails.BadRequest{}
walk(err, func(e error) {
    br.FieldViolations = append(br.FieldViolations,
        &errdetails.BadRequest_FieldViolation{
            Field:       fieldOf(e),
            Description: e.Error(),
        })
})
st, _ := status.New(codes.InvalidArgument, "validation failed").WithDetails(br)
return st.Err()
```

The receiver can decode and reconstruct a multi-error. Lots more work but preserves the structure.

The general rule: **`Join` lives inside one process**. Across boundaries, encode explicitly.

---

## Architectural Patterns

### Pattern: Validator hierarchy

A request-level validator calls field-level validators. Each returns a join; the request-level joins them.

```go
func (r *Request) Validate() error {
    return errors.Join(
        r.Header.Validate(),
        r.Body.Validate(),
        r.Trailer.Validate(),
    )
}
```

Joins of joins. The walker handles it; printed text shows it nested. If you want flat output, flatten on print:

```go
func flatten(err error) []error {
    var out []error
    walk(err, func(e error) {
        if _, ok := e.(interface{ Unwrap() []error }); !ok {
            out = append(out, e)
        }
    })
    return out
}
```

### Pattern: Scatter-gather with fail-fast option

```go
type Scatter struct {
    FailFast bool
}

func (s *Scatter) Run(ctx context.Context, jobs []Job) error {
    if s.FailFast {
        g, ctx := errgroup.WithContext(ctx)
        for _, j := range jobs {
            j := j
            g.Go(func() error { return j.Run(ctx) })
        }
        return g.Wait()
    }
    // collect-all
    errs := make([]error, len(jobs))
    var wg sync.WaitGroup
    for i, j := range jobs {
        wg.Add(1)
        go func(i int, j Job) {
            defer wg.Done()
            errs[i] = j.Run(ctx)
        }(i, j)
    }
    wg.Wait()
    return errors.Join(errs...)
}
```

The same call site exposes both semantics behind a flag. Useful when you have both "user-initiated multi-validation" (collect-all) and "server-initiated parallel calls" (fail-fast).

### Pattern: Best-effort cleanup

```go
type Closer struct {
    closers []io.Closer
}

func (c *Closer) Close() error {
    var errs []error
    for _, x := range c.closers {
        if e := x.Close(); e != nil {
            errs = append(errs, e)
        }
    }
    return errors.Join(errs...)
}
```

A composable closer that reports every failure. Drop-in replacement for ad-hoc cleanup code.

### Pattern: Saga partial-failure report

For distributed sagas — multi-step operations with compensation — return one big multi-error from the orchestrator:

```go
type SagaReport struct {
    Step    string
    OrigErr error
    CompErr error
}

func runSaga(ctx context.Context, steps []SagaStep) error {
    var failures []error
    for i, s := range steps {
        if err := s.Forward(ctx); err != nil {
            // compensate previous steps
            var compErrs []error
            for j := i - 1; j >= 0; j-- {
                if cerr := steps[j].Compensate(ctx); cerr != nil {
                    compErrs = append(compErrs,
                        fmt.Errorf("compensate step %d: %w", j, cerr))
                }
            }
            failures = append(failures,
                fmt.Errorf("step %d forward: %w", i, err))
            failures = append(failures, compErrs...)
            return errors.Join(failures...)
        }
    }
    return nil
}
```

Forward-failure plus every compensation-failure end up in one error. The operator gets one log line that tells the whole story.

---

## Trade-offs at Scale

### Trade-off 1: Memory

`errors.Join(N errs)` allocates an N-element slice plus a small struct. Children themselves are independent allocations. For a 10,000-element join, expect tens of kilobytes per error value, multiplied by however many such errors are alive.

If your service handles a million failed validations a second, each allocating a 10-element join… you can saturate the GC. Profile under load.

### Trade-off 2: Log volume

Multi-line `Error()` text inflates logs. Some backends charge per byte; some have line-length limits (truncation). Either truncate at the source (limit children) or use structured logging (one field per child).

### Trade-off 3: Caller cognitive load

A function that returns a *single* error is simple — caller checks one thing. A function that returns a multi-error forces every caller to decide: do I `errors.Is` for one specific case, walk all children, or just log the lot? Document what callers should do.

### Trade-off 4: Test brittleness

```go
if err.Error() != "name required\nemail required" { t.Fail() }
```

That assertion breaks the moment the validator order changes or a third rule is added. Robust tests use `errors.Is` for sentinel matching:

```go
if !errors.Is(err, ErrNameRequired) { t.Fail() }
if !errors.Is(err, ErrEmailRequired) { t.Fail() }
```

…and avoid asserting on the full string.

### Trade-off 5: Flatness vs structure

Joins of joins are easy to write but hard to print well. If your design has many layers of joins, consider flattening at the boundary. The tree structure carries no semantic meaning *unless* you make it so.

---

## Backpressure and Multi-Errors

A subtle issue in long-running batch jobs: the multi-error grows in memory while the job runs. If the job processes a stream and one in ten items fails, after a million items you have 100,000 errors in memory — possibly hundreds of megabytes.

Two strategies:

### Strategy 1: Flush periodically

```go
func process(items <-chan Item) error {
    var errs []error
    for it := range items {
        if err := work(it); err != nil {
            errs = append(errs, err)
        }
        if len(errs) >= 1000 {
            // log & reset
            log.Printf("batch milestone: %d errors so far", len(errs))
            for _, e := range errs {
                logErr(e)
            }
            errs = errs[:0]
        }
    }
    return errors.Join(errs...)
}
```

The buffer never grows beyond 1000. Earlier errors land in logs as the job runs. The final return is a manageable `Join` of the last batch.

### Strategy 2: Sample and summarize

For very high-rate streams, do not collect at all — keep counters and a sample:

```go
type Stats struct {
    Total    int
    Failed   int
    SampleN  int
    Samples  []error // bounded
}

func (s *Stats) Add(err error) {
    s.Total++
    if err != nil {
        s.Failed++
        if len(s.Samples) < s.SampleN {
            s.Samples = append(s.Samples, err)
        }
    }
}
```

The result is structured statistics plus a few example errors — enough for diagnosis, bounded in memory.

The general lesson: `errors.Join` is for *bounded* multi-errors. For unbounded streams, use a different shape.

---

## Anti-Patterns at Scale

- **Unbounded joins** in batch jobs — millions of errors in one value.
- **Logging the full `Error()` text** instead of structured fields when a multi-error has 100+ children.
- **Mutating the slice from `Unwrap() []error`** in any code that the standard library will see — `Is` and `As` rely on stable iteration.
- **Returning multi-errors across an RPC boundary** without explicit encoding — the structure is lost.
- **Asserting on cardinality** in callers (`if len(...) == 2`) — adding a third rule breaks every test.
- **Using `errors.Join` as a chain** (`m = errors.Join(m, err)` at every layer) when `%w` would be more accurate.
- **Mixing `errors.Join` and a custom multi-error type** in the same package — pick one.
- **Generating sentinel sets dynamically** so `errors.Is` checks become unstable. Sentinels should be package-level and stable.
- **No metric labels** for multi-error kinds; only an opaque `errors_total` counter that does not tell you *which* validation rule fires most.

---

## Summary

At senior level, `errors.Join` is a design tool, not just a function. It changes how you collect failures from concurrent work, how validators report problems, how cleanup paths handle partial success, and how RPC layers deal (or fail to deal) with structured error trees. The mechanics are easy; the architecture is where the work is. Bound your joins, encode them when crossing process boundaries, log them as structured fields, and pick your contract carefully — the type you return is part of your API surface. A service that uses multi-errors well exposes more diagnostic value with less per-error cost; one that uses them carelessly buries the operator in a wall of newline-separated text.

---

## Further Reading

- [Package errors — Join](https://pkg.go.dev/errors#Join)
- [Package errgroup — golang.org/x/sync/errgroup](https://pkg.go.dev/golang.org/x/sync/errgroup)
- [gRPC — Error Details](https://grpc.io/docs/guides/error/) — how to encode multi-errors across the wire
- [Saga Pattern](https://microservices.io/patterns/data/saga.html) — context for the saga example above
- [Designing for Failure — Resilience Engineering](https://sre.google/sre-book/embracing-risk/) — broader context on partial failure
- `$GOROOT/src/errors/wrap.go` — how `Is`/`As` walk multi-errors
- [Go 1.20 release notes](https://go.dev/doc/go1.20#errors)
