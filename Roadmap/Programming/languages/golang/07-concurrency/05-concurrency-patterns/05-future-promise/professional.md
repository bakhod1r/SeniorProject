# Future / Promise Pattern — Professional Level

## Table of Contents
1. [Introduction](#introduction)
2. [API Aggregator: Edge Service Fan-Out](#api-aggregator-edge-service-fan-out)
3. [RPC Fan-Out with Cancellation](#rpc-fan-out-with-cancellation)
4. [Request Coalescing in a Cache Tier](#request-coalescing-in-a-cache-tier)
5. [Speculative Reads from Replicas](#speculative-reads-from-replicas)
6. [Batch Build Systems](#batch-build-systems)
7. [Cross-Process Futures: Promises Over RPC](#cross-process-futures-promises-over-rpc)
8. [Operational Playbook](#operational-playbook)
9. [Cheat Sheet](#cheat-sheet)
10. [Summary](#summary)

---

## Introduction

This file is a tour of real production patterns built on futures. Each case study is drawn from systems that exist in industry (with names removed). The goal is not new theory but applied judgement — knowing which combinator to reach for, where to put the timeout, when to memoize, when to hedge.

Prerequisites: solid grasp of `Future[T]`, `errgroup`, `singleflight`, ctx propagation, and hedging.

---

## API Aggregator: Edge Service Fan-Out

The classic GraphQL-or-BFF use case: a single client request expands into 5–15 downstream calls. The aggregator must fan out concurrently, gather results, and assemble a response.

Skeleton:

```go
type ProfileResponse struct {
    User      User
    Orders    []Order
    Friends   []Friend
    Loyalty   Loyalty
    Inventory []Item
}

func (h *Handler) GetProfile(ctx context.Context, id string) (ProfileResponse, error) {
    ctx, cancel := context.WithTimeout(ctx, 800*time.Millisecond)
    defer cancel()

    g, ctx := errgroup.WithContext(ctx)
    var resp ProfileResponse

    g.Go(func() error {
        u, err := h.users.Get(ctx, id)
        resp.User = u
        return err
    })
    g.Go(func() error {
        o, err := h.orders.Recent(ctx, id, 10)
        resp.Orders = o
        return err
    })
    g.Go(func() error {
        f, err := h.social.Friends(ctx, id, 50)
        resp.Friends = f
        return err
    })
    g.Go(func() error {
        l, err := h.loyalty.Get(ctx, id)
        resp.Loyalty = l
        return err
    })
    g.Go(func() error {
        i, err := h.inv.Recommend(ctx, id, 5)
        resp.Inventory = i
        return err
    })

    if err := g.Wait(); err != nil {
        return resp, err
    }
    return resp, nil
}
```

Five concurrent backends. Wall time = max latency of any of them. Total p99 budget: 800ms.

### Decisions

**Partial failure.** The above fails the whole response on any sub-call error. That is often wrong: maybe the inventory recommender being down should not block the profile. Two adjustments:

1. **Optional fields.** Wrap each non-critical call so its error degrades to a zero value:

   ```go
   g.Go(func() error {
       i, err := h.inv.Recommend(ctx, id, 5)
       if err != nil {
           log.Warn("inv.Recommend failed", "err", err)
           resp.Inventory = nil // graceful default
           return nil           // don't fail the group
       }
       resp.Inventory = i
       return nil
   })
   ```

2. **Per-call timeouts inside the larger group timeout.** Each sub-call should not be allowed to consume the entire budget:

   ```go
   g.Go(func() error {
       subCtx, subCancel := context.WithTimeout(ctx, 200*time.Millisecond)
       defer subCancel()
       i, err := h.inv.Recommend(subCtx, id, 5)
       // ...
   })
   ```

**Ordering of `g.Go` calls.** Does not matter — all are concurrent. But it matters for *readability*: order them by importance (mandatory first, optional last) and the reader scanning the code understands the contract.

**Race-condition on `resp`.** Each goroutine writes a different field. Go's memory model says: `g.Wait()` synchronizes with the goroutines' returns, so the reads after `Wait()` see the writes. No data race. (The race detector confirms this. Run `go test -race`.)

---

## RPC Fan-Out with Cancellation

Suppose your service must fan out to 20 backend shards and collect partial results. If any shard fails, you log it and continue. If the client cancels, all 20 must stop immediately.

```go
func (h *Handler) QueryAll(ctx context.Context, q Query) (map[string]Result, error) {
    shards := h.discovery.Shards()
    results := make(map[string]Result)
    var mu sync.Mutex

    g, ctx := errgroup.WithContext(ctx)
    g.SetLimit(8) // bounded concurrency

    for _, s := range shards {
        s := s
        g.Go(func() error {
            r, err := s.Query(ctx, q)
            if err != nil {
                metrics.ShardError.WithLabelValues(s.Name).Inc()
                return nil // don't fail the group; just skip
            }
            mu.Lock()
            results[s.Name] = r
            mu.Unlock()
            return nil
        })
    }

    if err := g.Wait(); err != nil {
        return nil, err
    }
    return results, nil
}
```

Highlights:

- `errgroup.SetLimit(8)` (Go 1.20+) bounds concurrency. 20 shards, but only 8 in flight at once. Without this, large fan-outs can saturate file descriptors or downstream connection pools.
- The mutex around the result map. `sync.Map` would also work; for a small constant N, plain mutex is faster and clearer.
- We never return errors from `g.Go`. If a shard fails, we log a metric and move on. The errgroup is here only for *cancellation propagation*: if the client cancels `ctx`, `errgroup.WithContext` propagates that to every shard's `s.Query(ctx, q)` immediately.
- `ctx` is the *shared cancellation signal*. Every blocking call inside the goroutines takes the same `ctx`.

### Why not a `Future[Result]` per shard?

You could. The code would be:

```go
futs := make([]*Future[Result], len(shards))
for i, s := range shards {
    futs[i] = future.New(ctx, func(ctx context.Context) (Result, error) {
        return s.Query(ctx, q)
    })
}
for i, fu := range futs {
    r, err := fu.Await(ctx)
    // ...
}
```

It works, but `errgroup` is two fewer types and standard library. Reach for `Future[T]` only when you need the *handle* (to pass across boundaries, store in a map, compose).

---

## Request Coalescing in a Cache Tier

A read-through cache. On a miss, fetch from origin. Many concurrent misses for the same key should result in *one* origin fetch.

```go
type CachingClient struct {
    cache cache.Cache
    sf    singleflight.Group
    db    *DB
}

func (c *CachingClient) Get(ctx context.Context, key string) (Value, error) {
    if v, ok := c.cache.Get(key); ok {
        return v.(Value), nil
    }

    v, err, _ := c.sf.Do(key, func() (interface{}, error) {
        v, err := c.db.Load(ctx, key)
        if err != nil {
            return nil, err
        }
        c.cache.Set(key, v, ttl)
        return v, nil
    })
    if err != nil {
        return Value{}, err
    }
    return v.(Value), nil
}
```

Behaviour:

1. First miss: `sf.Do` enters, calls origin, populates cache.
2. Concurrent misses for the same key: `sf.Do` returns the result from (1) without re-calling origin.
3. After cache TTL: another origin call, again singleflighted.

Production note: `sf.Do`'s ctx is *the first caller's ctx*. If the first caller cancels, the work continues (the goroutine is detached from the caller). Subsequent callers do not benefit from each other's longer deadlines. If your origin loads are *long* and you want shared cancellation, that needs custom code (refcounted memo from the senior level).

`singleflight` also has the well-known "thundering herd at expiry" problem: when the cache entry expires, every concurrent miss singleflights once, then the next batch waits behind the first, etc. Mitigation: probabilistic early refresh (`p_refresh = (now - inserted_at) / ttl` triggers a background refresh before expiry).

---

## Speculative Reads from Replicas

You have three read replicas. A read can go to any of them. You want low p99.

Hedge with a delay near the p50:

```go
func (c *Reader) Read(ctx context.Context, key string) (Value, error) {
    return hedge(ctx, c.replicas, 10*time.Millisecond, func(ctx context.Context, r *Replica) (Value, error) {
        return r.Read(ctx, key)
    })
}

func hedge[T any](
    parent context.Context,
    replicas []*Replica,
    delay time.Duration,
    fn func(context.Context, *Replica) (T, error),
) (T, error) {
    ctx, cancel := context.WithCancel(parent)
    defer cancel()

    type r struct {
        v   T
        err error
    }
    out := make(chan r, len(replicas))

    fire := func(rep *Replica) {
        go func() {
            v, err := fn(ctx, rep)
            select {
            case out <- r{v, err}:
            case <-ctx.Done():
            }
        }()
    }

    fire(replicas[0])

    for i := 1; i < len(replicas); i++ {
        select {
        case x := <-out:
            if x.err == nil {
                return x.v, nil
            }
            // failure — fall through to fire next replica
        case <-time.After(delay):
            fire(replicas[i])
        case <-ctx.Done():
            var zero T
            return zero, ctx.Err()
        }
    }

    // wait for any remaining
    for i := 0; i < len(replicas); i++ {
        select {
        case x := <-out:
            if x.err == nil {
                return x.v, nil
            }
        case <-ctx.Done():
            var zero T
            return zero, ctx.Err()
        }
    }

    var zero T
    return zero, errors.New("all replicas failed")
}
```

Highlights:

- First request fires immediately.
- After each `delay`, if no answer yet, fire another replica.
- First success wins; ctx cancellation kills the rest.
- `out` has buffer `len(replicas)` so late arrivals don't block on a vanished receiver.

Tuning `delay`: too short and you double load constantly; too long and you don't help p99. Start at p50 latency, measure, adjust.

Production warning: hedging amplifies load on downstreams. Coordinate with the team running the replicas. A 5% hedge rate is usually safe; 50% is a forecast for a downstream incident.

---

## Batch Build Systems

A build system computes a graph: each node depends on its inputs. Each node's compute is a future. The build is `AwaitAll` over the leaf futures, with topological dependencies.

```go
type Node struct {
    Key      string
    Deps     []*Node
    Compute  func(ctx context.Context, depResults map[string]Result) (Result, error)

    once sync.Once
    fut  *Future[Result]
}

func (n *Node) Build(ctx context.Context) *Future[Result] {
    n.once.Do(func() {
        n.fut = future.New(ctx, func(ctx context.Context) (Result, error) {
            depResults := make(map[string]Result, len(n.Deps))
            g, ctx := errgroup.WithContext(ctx)
            var mu sync.Mutex
            for _, d := range n.Deps {
                d := d
                g.Go(func() error {
                    r, err := d.Build(ctx).Await(ctx)
                    if err != nil {
                        return err
                    }
                    mu.Lock()
                    depResults[d.Key] = r
                    mu.Unlock()
                    return nil
                })
            }
            if err := g.Wait(); err != nil {
                return Result{}, err
            }
            return n.Compute(ctx, depResults)
        })
    })
    return n.fut
}
```

Each node is memoized — `n.once` ensures we build it at most once even if many parents request it. `Build` is safe to call concurrently from multiple parents; only the first triggers work.

This is essentially how Bazel, Buck, and other modern build systems think about computation graphs. The future is the unit of cached, dependency-aware work.

For very large graphs, you replace `errgroup` for dep-fetching with a global semaphore: only K nodes evaluating their `Compute` at once across the whole graph. That prevents the "diamond fan-out" from blowing the process up.

---

## Cross-Process Futures: Promises Over RPC

Futures normally stay within a process. But the abstraction generalises: a *promise pipelining* RPC lets the client send a request whose result is the input to another request, without round-tripping.

Cap'n Proto and Sandstorm popularised this. Example shape:

```
client: result_fut = server.GetUser(42)
client: name_fut = server.GetName(result_fut.future_id)
client: <-name_fut
```

The server pipelines the two calls: it computes `GetUser(42)`, then immediately uses the result as input to `GetName(...)`. The client never blocks for the intermediate value.

In gRPC, this maps to *bidirectional streaming* plus careful framing. In practice, Go programmers more often use a single coarse RPC that takes a `request graph` and returns the final result.

The takeaway for a Go service author: when you find yourself doing N round trips with each result feeding the next, consider a single batched RPC instead. The future abstraction extends, but the network is not free, and "N futures over N round trips" is rarely the right shape across a process boundary.

---

## Operational Playbook

When a future-heavy system misbehaves, run through this checklist.

**Symptom: goroutine count growing.**
1. Take a goroutine dump (`SIGQUIT` or `pprof goroutine`).
2. Group by creation site (stack trace).
3. Common culprits: futures whose work does not honour ctx; abandoned hedging losers without `cancel()`.

**Symptom: high CPU during fan-out.**
1. Check `errgroup.SetLimit` is set.
2. Profile with `pprof cpu` for 30 seconds during the spike.
3. Often the GC is busy with small short-lived allocations — pool the `Result[T]` structs if necessary.

**Symptom: downstream service overloaded.**
1. Is hedging firing too aggressively? Check the metric "hedge_fire_rate" vs target (~5%).
2. Is the cache TTL too short, causing constant origin reloads? Layer singleflight + cache.
3. Are timeouts mismatched (downstream timeout > caller timeout)? Use ctx propagation to make downstream stop when caller stops.

**Symptom: client request latency p99 spike but no individual downstream is slow.**
1. Suspect a per-request goroutine pile-up: every request fans out 10 futures, request rate doubles, total goroutines x20, scheduler thrashes.
2. Bound concurrency at the *request* level with a semaphore. The fan-out is fine; the *number of fan-outs in flight* needs a ceiling.

**Symptom: memory creeping.**
1. Memo cache without eviction? Replace with an LRU.
2. Goroutines leaked? `goleak` in tests, `pprof goroutine` in prod.
3. Result structs holding large values forever? Make sure futures are dropped after await.

---

## Cheat Sheet

```
EDGE AGGREGATOR
    errgroup with shared ctx
    per-call sub-timeouts
    optional fields degrade to zero values
    log + metric on partial failure, don't fail group

RPC FAN-OUT
    errgroup.SetLimit(K)
    sync.Mutex around result map
    derive ctx for cancellation
    metric per shard-error

CACHE TIER
    singleflight in front of origin
    probabilistic early refresh to avoid expiry herd
    long TTL for stable data, short for rapidly changing

REPLICA HEDGING
    delay near p50
    cancel losers on first success
    bound at len(replicas)
    coordinate with downstream team on load

BUILD GRAPH
    one memoized Future[T] per node
    errgroup for deps, global semaphore for total parallelism
    memoization via sync.Once

ACROSS RPC BOUNDARY
    avoid N-round-trip future chains
    prefer one batched RPC or streaming
```

---

## Summary

Production future systems are simple individually and complicated in aggregate. Each pattern — edge fan-out, RPC fan-out, cache coalescing, hedging, build graphs — is five to fifty lines of code. The complexity comes from running them together under load with cancellation, partial failure, and budget enforcement.

The standard library gives you the right toolkit: `errgroup` for fan-shaped work, `singleflight` for coalescing, `context.Context` for cancellation, plain channels for everything else. A typed `Future[T]` wrapper is occasionally useful at API boundaries; most of the time you do not need it.

The operational playbook is the same across all these patterns: bound concurrency, propagate cancellation, instrument with counters and histograms, run `goleak` in tests. Production future systems live in dashboards.
