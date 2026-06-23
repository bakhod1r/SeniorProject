---
layout: default
title: Find Bug
parent: When to Use a Pool
grand_parent: Goroutine Pools (3rd-party)
ancestor: Go
nav_order: 9
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/17-goroutine-pools-3rd-party/04-when-to-use/find-bug/
---

# When to Use a Pool — Find the Bug

12 snippets where the *pool choice* (or a closely related concurrency choice) is the bug. Read each, find the bug, propose a fix.

Each has a hidden answer; scroll past the code before reading.

---

## Bug 1: The over-engineered CLI

A CLI tool that resizes 50 JPEG files.

```go
package main

import (
	"context"
	"fmt"
	"os"

	"github.com/panjf2000/ants/v2"
)

func main() {
	files, _ := filepath.Glob("*.jpg")

	pool, err := ants.NewPool(100,
		ants.WithMaxBlockingTasks(1000),
		ants.WithPanicHandler(func(p any) {
			fmt.Println("panic:", p)
		}),
		ants.WithNonblocking(true),
		ants.WithExpiryDuration(time.Hour),
	)
	if err != nil { os.Exit(1) }
	defer pool.Release()

	var wg sync.WaitGroup
	for _, f := range files {
		f := f
		wg.Add(1)
		pool.Submit(func() {
			defer wg.Done()
			resize(f)
		})
	}
	wg.Wait()
}
```

What's the bug?

---

<details><summary>Answer 1</summary>

The bug is **using ants for 50 one-shot tasks**. This is a CLI tool that runs once, processes 50 files, and exits. There is:

- No warm state to reuse.
- No high spawn rate (50 is trivial).
- No need for the elaborate options (`WithMaxBlockingTasks=1000` for 50 tasks?).
- No need for panic handler (a CLI can crash gracefully).
- No need for hour-long expiry on a CLI.

This is cargo-cult adoption. The right answer is `errgroup.SetLimit(runtime.NumCPU())`:

```go
g, _ := errgroup.WithContext(context.Background())
g.SetLimit(runtime.NumCPU())
for _, f := range files {
	f := f
	g.Go(func() error { return resize(f) })
}
return g.Wait()
```

Half the code, no dependency, propagates errors, idiomatic.

</details>

---

## Bug 2: The wrong K for HTTP

```go
pool, _ := ants.NewPool(runtime.NumCPU())
defer pool.Release()

for _, url := range urls { // 1000 URLs
	url := url
	pool.Submit(func() {
		resp, _ := http.Get(url)
		// ...
	})
}
```

What's the bug?

---

<details><summary>Answer 2</summary>

K = `runtime.NumCPU()` is wrong for **I/O-bound work**. HTTP calls are mostly waiting on network, not CPU. With 8 cores and 1000 URLs, K=8 means at most 8 in-flight HTTP calls — the rest queue.

If each URL takes 100ms and you have 1000 URLs, total time = 1000/8 × 0.1 = 12.5 seconds. With K=100, total = 1000/100 × 0.1 = 1 second.

Fix: K = throughput × latency. Or just K = 100 (or some reasonable number for HTTP).

```go
g, _ := errgroup.WithContext(ctx)
g.SetLimit(100)  // bounded by downstream concurrency limit
for _, url := range urls {
	url := url
	g.Go(func() error { return fetch(ctx, url) })
}
return g.Wait()
```

Also note: original code ignores `Submit` error and `http.Get` error. Both should be handled.

</details>

---

## Bug 3: The blocking pool for non-blocking work

```go
pool, _ := tunny.NewFunc(100, func(payload any) any {
	url := payload.(string)
	resp, _ := http.Get(url)
	return resp.StatusCode
})
defer pool.Close()

statuses := make([]int, len(urls))
for i, url := range urls {
	statuses[i] = pool.Process(url).(int)  // !
}
```

What's the bug?

---

<details><summary>Answer 3</summary>

`pool.Process` is **synchronous** — it blocks the caller until the worker returns. The loop processes URLs one at a time, sequentially. The 100-worker pool is never parallelised.

Fix: spawn each Process in its own goroutine, or use ants:

```go
var wg sync.WaitGroup
for i, url := range urls {
	i, url := i, url
	wg.Add(1)
	go func() {
		defer wg.Done()
		statuses[i] = pool.Process(url).(int)
	}()
}
wg.Wait()
```

But also: tunny is the wrong tool here. `http.Get` has no warm state per worker. Use errgroup.

</details>

---

## Bug 4: The unbounded queue

```go
pool, _ := ants.NewPool(50)
defer pool.Release()

for msg := range incomingMessages { // unbounded stream
	msg := msg
	pool.Submit(func() { handle(msg) })
}
```

What's the bug?

---

<details><summary>Answer 4</summary>

The default `ants.NewPool` has **no MaxBlockingTasks**. When the pool is at K=50 and submission keeps coming, the queue (internally) blocks submitters. But if you also configure Nonblocking without MaxBlockingTasks, you have an unbounded queue.

With this code, Submit blocks under heavy load. The producer (the consumer of incomingMessages) backs up. That may be what you want — but document it.

Alternative bug: if you set Nonblocking without MaxBlockingTasks, the queue grows unboundedly, eventually OOMing.

Fix:

```go
pool, _ := ants.NewPool(50,
	ants.WithMaxBlockingTasks(5000),  // cap the queue
)
```

Or use non-blocking with explicit drop handling.

</details>

---

## Bug 5: The pool per request

```go
func handler(w http.ResponseWriter, r *http.Request) {
	pool, _ := ants.NewPool(10)
	defer pool.Release()

	for _, x := range items {
		x := x
		pool.Submit(func() { process(x) })
	}
}
```

What's the bug?

---

<details><summary>Answer 5</summary>

Pool is **constructed per request**. Each handler call creates 10 workers, then releases them. The setup/teardown cost is paid every request. The whole point of a pool — worker reuse — is defeated.

Fix: long-lived pool at package or struct level:

```go
var workerPool *ants.Pool

func init() {
	workerPool, _ = ants.NewPool(10)
}

func handler(w http.ResponseWriter, r *http.Request) {
	for _, x := range items {
		x := x
		workerPool.Submit(func() { process(x) })
	}
}
```

Or: don't use a pool here at all. If items is a small fixed slice, errgroup or raw goroutines suffice.

</details>

---

## Bug 6: The serialised pool

```go
pool, _ := ants.NewPool(100)
defer pool.Release()

var mu sync.Mutex
for _, x := range items {
	x := x
	pool.Submit(func() {
		mu.Lock()
		defer mu.Unlock()
		// ... non-trivial work
	})
}
```

What's the bug?

---

<details><summary>Answer 6</summary>

100 workers, but every task holds the **same mutex**. Effective concurrency is 1. The pool is wasted.

Fix: refactor so the work doesn't require the lock. Possible options:
- Per-worker state (instead of shared).
- Sharded state with per-shard locks.
- Lock-free data structures.
- Or: just one goroutine, no pool.

The pool is a symptom, not the disease. The disease is the shared mutex.

</details>

---

## Bug 7: The lifecycle leak

```go
func processItems(items []Item) {
	pool, _ := ants.NewPool(10)
	// no defer Release!

	for _, x := range items {
		x := x
		pool.Submit(func() { work(x) })
	}
}
```

What's the bug?

---

<details><summary>Answer 7</summary>

No `defer pool.Release()`. The pool's 10 workers run forever, even after the function returns. Goroutine leak.

If `processItems` is called many times, you accumulate stuck goroutines.

Fix:

```go
pool, _ := ants.NewPool(10)
defer pool.Release()
```

Or even better, make the pool long-lived (at struct level) rather than per-call.

Also missing: WaitGroup or similar to wait for tasks before returning. As written, the function returns before tasks complete.

</details>

---

## Bug 8: The errgroup without SetLimit

```go
g, _ := errgroup.WithContext(ctx)
for _, url := range urls {  // 10,000 URLs
	url := url
	g.Go(func() error {
		return fetch(ctx, url)
	})
}
return g.Wait()
```

What's the bug?

---

<details><summary>Answer 8</summary>

No `g.SetLimit(K)`. The errgroup is **unbounded**. All 10,000 URLs are fetched at once. Memory blow-up, downstream rejection (429s), file-descriptor exhaustion.

Fix:

```go
g, _ := errgroup.WithContext(ctx)
g.SetLimit(100)  // bounded
```

The classic mistake: thinking `errgroup` bounds by default. It does not — `SetLimit` is opt-in.

</details>

---

## Bug 9: The submit error ignored

```go
pool, _ := ants.NewPool(100, ants.WithNonblocking(true))
defer pool.Release()

for msg := range messages {
	msg := msg
	pool.Submit(func() { process(msg) })  // !
}
```

What's the bug?

---

<details><summary>Answer 9</summary>

`pool.Submit` returns an error. With `WithNonblocking(true)`, the pool returns `ErrPoolOverload` when full. The code ignores it: messages are **silently dropped** under load.

Fix:

```go
for msg := range messages {
	msg := msg
	if err := pool.Submit(func() { process(msg) }); err != nil {
		metrics.Dropped.Inc()
		log.Warn("dropped message", "err", err)
		// or: retry, fall back, etc.
	}
}
```

Always handle the Submit error in non-blocking mode.

</details>

---

## Bug 10: The pool for one item

```go
pool, _ := ants.NewPool(50)
defer pool.Release()
pool.Submit(func() { processOne(item) })
// continues immediately, no wait
```

What's the bug?

---

<details><summary>Answer 10</summary>

A pool for **one task**? And no wait? Submitting and not waiting means processOne runs in the background after the function returns. If processOne writes to a shared state the caller reads, race.

The function `pool.Submit + return` is fire-and-forget. Bizarre for a single task.

Fix: just call `processOne(item)` directly. No pool needed.

Or, if you need fire-and-forget background, `go processOne(item)` (raw goroutine).

</details>

---

## Bug 11: The pool with a captured ctx

```go
func handler(w http.ResponseWriter, r *http.Request) {
	for _, item := range items {
		item := item
		pool.Submit(func() {
			// uses r.Context() — but it's already closed when handler returns!
			fetch(r.Context(), item)
		})
	}
	w.WriteHeader(200)
	return
}
```

What's the bug?

---

<details><summary>Answer 11</summary>

`r.Context()` is the **request context**. It's cancelled when the handler returns. The pool's tasks (which run asynchronously) see a cancelled ctx as soon as the handler returns.

If tasks are intended to outlive the handler, use a separate context:

```go
ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
defer cancel()  // or no cancel, depending on lifecycle

for _, item := range items {
	item := item
	pool.Submit(func() { fetch(ctx, item) })
}
```

Or: if the tasks should match the request lifecycle, wait for them before returning. Use a WaitGroup or sync.

</details>

---

## Bug 12: The errgroup deadlock

```go
g, _ := errgroup.WithContext(ctx)
g.SetLimit(2)

g.Go(func() error {
	g.Go(func() error {  // !
		return doSomething(ctx)
	})
	return waitForInner(ctx)
})

return g.Wait()
```

What's the bug?

---

<details><summary>Answer 12</summary>

**Deadlock from recursive Go**. SetLimit(2) means at most 2 goroutines. The outer Go takes one slot. The inner Go waits for a slot. If the outer Go's body needs the inner to finish (which it does via `waitForInner`), and the inner can't start until the outer frees its slot, we have a deadlock.

Fix: don't recursively submit to the same errgroup. Either:

- Run the inner task inline (no g.Go).
- Use a separate errgroup.
- Use a separate pool.

```go
g, _ := errgroup.WithContext(ctx)
g.SetLimit(2)

g.Go(func() error {
	err := doSomething(ctx)  // inline
	if err != nil { return err }
	return doMore(ctx)
})
```

---

End of `find-bug.md`.
