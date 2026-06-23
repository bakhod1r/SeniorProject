---
layout: default
title: Junior
parent: Acquire Release
grand_parent: Memory Ordering Barriers
ancestor: Go
nav_order: 1
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/22-memory-ordering-barriers/02-acquire-release/junior/
---

# Acquire / Release — Junior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Real-World Analogies](#real-world-analogies)
6. [Mental Models](#mental-models)
7. [Pros & Cons](#pros-cons)
8. [Use Cases](#use-cases)
9. [Code Examples](#code-examples)
10. [Coding Patterns](#coding-patterns)
11. [Clean Code](#clean-code)
12. [Product Use / Feature](#product-use-feature)
13. [Error Handling](#error-handling)
14. [Security Considerations](#security-considerations)
15. [Performance Tips](#performance-tips)
16. [Best Practices](#best-practices)
17. [Edge Cases & Pitfalls](#edge-cases-pitfalls)
18. [Common Mistakes](#common-mistakes)
19. [Common Misconceptions](#common-misconceptions)
20. [Tricky Points](#tricky-points)
21. [Test](#test)
22. [Tricky Questions](#tricky-questions)
23. [Cheat Sheet](#cheat-sheet)
24. [Self-Assessment Checklist](#self-assessment-checklist)
25. [Summary](#summary)
26. [What You Can Build](#what-you-can-build)
27. [Further Reading](#further-reading)
28. [Related Topics](#related-topics)
29. [Diagrams & Visual Aids](#diagrams-visual-aids)

---

## Introduction
> Focus: "What does it mean to *publish* a value to another goroutine, and why is plain assignment not enough?"

Imagine you have two goroutines. One of them builds a result — maybe it reads a configuration file, parses it, and creates a `*Config` struct. The other one wants to use that result. The first goroutine writes:

```go
cfg = loadConfig() // build the config
ready = true       // tell the world we are done
```

The second one reads:

```go
if ready {
    use(cfg)
}
```

This program looks innocent. Sometimes it works. On some machines, with some compilers, on some days it crashes with a nil-pointer dereference. Why? Because the second goroutine saw `ready == true` but `cfg` was still `nil`.

How is that possible? The first goroutine clearly set `cfg` *before* `ready`. The answer is that *clearly* depends on whose eyes you are looking through. The CPU running the first goroutine, the cache between that CPU and main memory, the compiler that produced the machine code, and the CPU running the second goroutine all have their own ideas about what "before" means. Without an explicit *synchronization* operation between the writes and the reads, none of them is obligated to preserve your intended ordering.

This is where **acquire** and **release** come in. They are the two halves of a handshake that makes the publish-and-consume pattern work safely:

- A **release** operation says: "Everything I wrote before this point is now visible to any goroutine that performs an acquire on the same location."
- An **acquire** operation says: "I just read a value that some other goroutine released. Whatever they did before the release is now visible to me, and it happens before anything I do next."

At the junior level you do not need to write hand-rolled acquire/release code. Go gives you tools that *contain* acquire and release for you:

- `sync.Mutex.Lock` performs an acquire; `sync.Mutex.Unlock` performs a release.
- `sync/atomic.LoadXxx` performs an acquire (and more — Go promises sequential consistency for atomics, which is strictly stronger).
- `sync/atomic.StoreXxx` performs a release (and more).
- `sync.Once.Do` performs both, around the initialization function.
- Sending and receiving on a channel performs both at the endpoints.

After reading this file you will:

- Understand why the `cfg`/`ready` example above is broken, and how to fix it.
- Know the difference between *atomic* (no torn reads) and *ordered* (no reordering across the operation).
- Be able to use `sync.Mutex` and `sync/atomic` for safe one-shot publication.
- Have an intuition for what *happens-before* means and when Go promises it.
- Recognise the "publish a pointer through a flag" pattern and three buggy variations of it.

You do **not** need to know about C++ `memory_order_acquire`, hardware fences, or double-checked locking yet. Those come at middle, senior, and professional levels.

---

## Prerequisites

- **Required:** Comfort with goroutines and the `go` keyword. You should know that `go f()` starts a new goroutine.
- **Required:** Familiarity with `sync.WaitGroup` or at least with the idea that the main goroutine can exit before others.
- **Required:** Knowledge of pointers in Go. You should understand that `*Config` is a pointer and that two goroutines can hold the same pointer.
- **Helpful:** Some experience with a data race — having seen `go run -race` complain at least once.
- **Helpful:** Awareness that CPUs have caches and that writes to memory are not instantaneous.

If you have written a program that uses `sync.Mutex` to protect a shared counter, you are ready.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Acquire** | A read-side memory operation that prevents subsequent reads and writes in program order from being reordered before it. After an acquire on location X, you are guaranteed to see everything that any goroutine wrote before performing a release on X. |
| **Release** | A write-side memory operation that prevents preceding reads and writes in program order from being reordered after it. A release "publishes" all earlier writes to any goroutine that subsequently performs an acquire on the same location. |
| **Memory order** | The contract between the program and the runtime/CPU about which reorderings of memory operations are allowed. Common orderings: relaxed, acquire, release, acq_rel, seq_cst (sequential consistency). |
| **Happens-before** | A partial order on memory operations. If event A happens-before event B, then B is guaranteed to see A's writes. The Go memory model defines exactly which operations establish happens-before. |
| **Publication** | The act of making a value visible to other goroutines. Safe publication requires a release on the publishing side and an acquire on the consuming side. |
| **`sync.Mutex`** | A mutual-exclusion lock. `Lock` is an acquire; `Unlock` is a release. The mutex guarantees that the critical section of one goroutine happens-before the critical section of the next goroutine to lock the mutex. |
| **`sync/atomic`** | The standard library package providing atomic primitives: `LoadInt32`, `StoreInt32`, `CompareAndSwap`, etc. In Go, atomics provide sequentially consistent ordering — strictly stronger than acquire/release. |
| **Atomic operation** | A read, write, or read-modify-write that is indivisible — no other goroutine can see a "half-finished" version. Distinct from *ordered*: an atomic without ordering would still be indivisible but might be reordered with surrounding code. In Go you do not need to worry about this distinction because all `sync/atomic` operations are also ordered. |
| **Torn read / write** | A non-atomic read or write of a multi-word value that another goroutine catches mid-update, seeing half the old bytes and half the new bytes. Torn reads on aligned 64-bit values on a 64-bit CPU are common in C; Go's `sync/atomic` types prevent them. |
| **Data race** | Two goroutines accessing the same memory location concurrently where at least one access is a write, with no synchronization. The result is undefined behavior. `go run -race` detects most cases. |
| **`sync.Once`** | A primitive guaranteeing that a function is executed exactly once, even under concurrent calls. The execution of that function happens-before any return from `Do` on any goroutine. |
| **Sequential consistency** | The strongest practical memory model. All operations appear to execute in some single global order consistent with each goroutine's program order. Go provides this for `sync/atomic` and for mutex operations. |
| **Memory barrier (fence)** | A CPU instruction that prevents the hardware from reordering memory operations across it. Acquire and release barriers are one-sided; a full fence is two-sided. |

---

## Core Concepts

### Publication needs two parts

You cannot make a write visible to another goroutine by setting a variable, no matter how careful you are about the order in your source code. To **publish** a value safely you need two things:

1. A **release** on the producing side, *after* you finished building the value.
2. An **acquire** on the consuming side, *before* you use the value.

Both must operate on the same synchronization location. Examples of matching pairs:

- Producer calls `mu.Unlock()`; consumer calls `mu.Lock()` on the same mutex.
- Producer calls `atomic.StoreInt32(&flag, 1)`; consumer calls `atomic.LoadInt32(&flag)` and observes `1`.
- Producer sends on `ch`; consumer receives from the same `ch`.
- Producer is inside `once.Do(f)`; consumer calls `once.Do(f)` and returns.

If either half is missing or operates on a different location, the publication is broken.

### What a release does

When you perform a release operation (let's say `atomic.StoreInt32(&ready, 1)`), the runtime and the hardware promise:

- Every read and write your goroutine performed *before* the release, in program order, will be visible to any goroutine that later performs an acquire on `&ready`.
- The release itself is atomic — no torn write.
- The release acts as a one-sided fence: writes *after* the release in program order may be reordered before it. (This rarely matters in practice because you usually do not write more after publishing.)

### What an acquire does

When you perform an acquire operation (let's say `if atomic.LoadInt32(&ready) == 1`), the runtime and the hardware promise:

- Every read and write you perform *after* the acquire, in program order, will see the effects of writes the releasing goroutine made before its release.
- The acquire itself is atomic — no torn read.
- The acquire acts as a one-sided fence: reads and writes *before* it in program order may be reordered after it. (Again, rarely matters in practice.)

### The handshake

The acquire–release contract requires both halves to operate on the same location *and* for the acquire to actually observe the value published by the release. If you load `ready` and it is still `0`, you have not synchronized with anything — you simply learned that the producer has not run yet.

```
Producer goroutine                Consumer goroutine
==================                ==================

cfg = loadConfig()        ─┐
                           │  any writes here are
                           │  guaranteed visible to a
                           │  consumer that observes
                           │  the released value
atomic.StoreInt32(&r,1) ───┘ release          ┌── if atomic.LoadInt32(&r)==1
                                              │   acquire (observed)
                                              │
                                              │   use(cfg)  ◄── safe
                                              │   the writes above
                                              │   the release are
                                              │   now visible
```

### Atomic without ordering does not exist in Go

In C++ you can write `atomic.store(1, std::memory_order_relaxed)` — atomic but with no ordering guarantees. In Go you cannot. Every `sync/atomic` operation is sequentially consistent, which is *strictly stronger* than acquire/release. This makes Go's atomics easier to reason about but slightly more expensive on weakly ordered hardware. As a junior you should be glad: there is one less thing to get wrong.

### The Go memory model in one sentence

> A read of a variable is not guaranteed to observe a write to that variable unless the read is ordered after the write by a *happens-before* relation established by some synchronization primitive.

Synchronization primitives that establish happens-before:

- The `go` statement (caller happens-before the goroutine body's first action — except the body itself).
- Channel send/receive on the same channel.
- `sync.Mutex.Lock`/`Unlock`, `sync.RWMutex.RLock`/`RUnlock`, etc.
- `sync.Once.Do`.
- All `sync/atomic` operations on the same memory location.
- `runtime.SetFinalizer` (rarely relevant).

If a write and a read are not ordered by any of these, the read might see the write, might see a stale value, or might see a torn intermediate — undefined behavior.

---

## Real-World Analogies

### The package on the porch

You order a package. The delivery driver places it on your porch and rings the doorbell.

- Placing the package = the writes you want to publish.
- Ringing the doorbell = the release operation.
- Hearing the doorbell = the acquire operation.
- Picking up the package = using the published values.

If the driver rings the doorbell *before* placing the package, you might open the door and find nothing. The bell must come after the package.

If you open the door without waiting for the bell (you just keep opening it randomly), you might catch the moment between placement and bell-ring and again find nothing. You must wait for the bell.

### The book in the library

A librarian shelves a new book (`cfg = loadConfig()`), then writes its location on a public index card (`atomic.Store(&ready, 1)`).

A reader checks the index card (`atomic.Load(&ready)`). If they see the location written, they walk to that shelf and pick up the book. Because the librarian wrote the card *after* shelving the book, the reader is guaranteed to find the book where the card says.

If the librarian writes the card first and shelves later — or if a reader checks the shelf without reading the card — the protocol breaks.

### The factory whistle

A factory produces a batch of goods, then blows a whistle. Trucks arrive only after hearing the whistle. They are guaranteed to find the batch loaded.

If a truck driver heard half a whistle (a torn read), they might pull up at an empty dock. That is why the whistle itself must be atomic, not just the load.

---

## Mental Models

### "Walls that mail moves over"

Imagine your writes as letters being sent to a public mailbox. Each write is a letter; the mailbox is main memory. The acquire and release act as *walls* in the producer's letter pile:

- Release: a wall pushed *down* in the pile. All letters above the wall are sealed and shipped. Anything below the wall is still in your hand.
- Acquire: a wall pushed *up* in the consumer's reading pile. All letters above the wall are read; the consumer cannot pre-read letters below it.

Without the walls, the runtime is free to ship letters in any order, batch them, or drop the order entirely.

### The committee meeting

Each goroutine is a committee member writing notes. Without synchronization, every member's notes are private and may or may not reach the others, in any order, at any time.

A release is like raising your hand and saying "I commit this packet of notes to the public record." An acquire on the same record is like another member saying "I now read the latest packet." Anything in the packet is visible. Anything not packaged is still private to the original writer.

### The newspaper edition

The producer writes articles all day (private). At deadline, they "release" the edition — print it. Anyone who reads the morning paper after print time (acquire) sees a *consistent* edition: every article in it is real, no half-written sentences.

But if a reader steals a draft off the editor's desk before printing (no acquire — a plain unsynchronized read), they see whatever happened to be on the page at that instant, including half-sentences.

---

## Pros & Cons

### Pros of using acquire/release semantics (via Go primitives)

- **Correctness across all platforms.** Once you use mutexes, channels, atomics, or `sync.Once`, your publication works on x86, ARM, RISC-V, POWER — every architecture Go supports. You do not need to know which has weaker ordering.
- **Documentable contract.** Other engineers reading your code recognise `atomic.Store` or `sync.Once` and immediately understand "this is a publication point."
- **No torn reads or writes.** All `sync/atomic` operations on aligned values are indivisible.
- **Composability.** Mutex acquires/releases compose: a goroutine that locks two mutexes in sequence inherits the happens-before chain of both.
- **Race detector catches violations.** `go run -race` will scream at unsynchronized publication; the synchronized version is silent.

### Cons / costs

- **Overhead.** A mutex lock/unlock pair is a few dozen nanoseconds even uncontended. An atomic load is a few nanoseconds. A channel send/receive is a few hundred nanoseconds. Most code does not care; very hot loops do.
- **Hidden serialization.** A mutex serializes all goroutines that touch it. If you only meant to publish once, a mutex is overkill — `atomic.Store` is cheaper.
- **Easy to use wrong.** Storing the flag *before* the value, or reading the value *before* the flag, both look correct but are wrong. The race detector will not always catch this.
- **API confusion.** Beginners often think `atomic.Value.Store` *only* stores atomically and forget it also publishes. Or they reach for raw atomics when a mutex would be clearer.

---

## Use Cases

Use acquire/release-shaped publication when:

- You build a value once and need to share it with many readers.
- You set a one-shot flag (`done`, `closed`, `ready`).
- You publish a pointer (config, cache, lookup table) for many readers to use.
- You implement lazy initialization (`sync.Once`).
- You implement a sentinel/canary that signals "the work is finished."

Do **not** use raw atomics when:

- You need to coordinate more than a one-shot publication. A mutex is clearer.
- You need to atomically update a multi-field struct. Wrap with a mutex or use `atomic.Value`/`atomic.Pointer`.
- You want to wait for an event. Use a channel.
- You want fairness between goroutines. Atomics do not provide fairness.

---

## Code Examples

### Example 1: the broken publication

```go
package main

import (
	"fmt"
	"sync"
)

type Config struct {
	URL  string
	Port int
}

var cfg *Config
var ready bool // <-- plain bool, not atomic

func main() {
	var wg sync.WaitGroup
	wg.Add(2)

	go func() {
		defer wg.Done()
		cfg = &Config{URL: "https://example.com", Port: 8080}
		ready = true
	}()

	go func() {
		defer wg.Done()
		for !ready { // busy-wait
			// spin
		}
		fmt.Println(cfg.URL) // possible nil dereference
	}()

	wg.Wait()
}
```

Why is this broken?

1. **Compiler reordering.** The Go compiler may reorder `cfg = ...` and `ready = true` because, from the producing goroutine's perspective, the order does not affect its own behavior.
2. **CPU reordering.** Even if the compiler preserves order, the CPU may commit `ready = true` to memory before `cfg = ...` reaches it.
3. **Cache invalidation lag.** The consumer's cache may see `ready=true` before it sees the new value of `cfg`.
4. **Race detector.** `go run -race main.go` will flag this as a data race even before it crashes.

### Example 2: fixed with `sync/atomic`

```go
package main

import (
	"fmt"
	"sync"
	"sync/atomic"
)

type Config struct {
	URL  string
	Port int
}

var cfg *Config
var ready int32 // 0 or 1

func main() {
	var wg sync.WaitGroup
	wg.Add(2)

	go func() {
		defer wg.Done()
		cfg = &Config{URL: "https://example.com", Port: 8080}
		atomic.StoreInt32(&ready, 1) // RELEASE
	}()

	go func() {
		defer wg.Done()
		for atomic.LoadInt32(&ready) == 0 { // ACQUIRE on each check
			// spin — but at least it's a synchronized spin
		}
		fmt.Println(cfg.URL) // safe — cfg write happens-before this read
	}()

	wg.Wait()
}
```

The release on `&ready` ensures the write to `cfg` is visible to any goroutine that observes `ready == 1`. The race detector is happy. The program is correct on every architecture Go supports.

### Example 3: cleaner with `atomic.Pointer`

```go
package main

import (
	"fmt"
	"sync"
	"sync/atomic"
)

type Config struct {
	URL  string
	Port int
}

var cfg atomic.Pointer[Config]

func main() {
	var wg sync.WaitGroup
	wg.Add(2)

	go func() {
		defer wg.Done()
		c := &Config{URL: "https://example.com", Port: 8080}
		cfg.Store(c) // single release on the pointer itself
	}()

	go func() {
		defer wg.Done()
		var c *Config
		for {
			c = cfg.Load() // acquire
			if c != nil {
				break
			}
		}
		fmt.Println(c.URL)
	}()

	wg.Wait()
}
```

This is the idiomatic Go pattern for one-shot publication. There is no separate flag — the pointer itself is the flag (nil = not ready, non-nil = ready). Both atomicity and ordering come from the `atomic.Pointer` type. (`atomic.Pointer[T]` was added in Go 1.19; before that you used `unsafe.Pointer` with `atomic.LoadPointer`/`StorePointer`, or `atomic.Value`.)

### Example 4: using a mutex

```go
package main

import (
	"fmt"
	"sync"
)

type Config struct {
	URL  string
	Port int
}

var (
	mu  sync.Mutex
	cfg *Config
)

func setConfig(c *Config) {
	mu.Lock() // (not the publication itself; just protects the write)
	defer mu.Unlock()
	cfg = c
}

func getConfig() *Config {
	mu.Lock()
	defer mu.Unlock()
	return cfg
}

func main() {
	var wg sync.WaitGroup
	wg.Add(2)

	go func() {
		defer wg.Done()
		setConfig(&Config{URL: "https://example.com", Port: 8080})
	}()

	go func() {
		defer wg.Done()
		var c *Config
		for c == nil {
			c = getConfig()
		}
		fmt.Println(c.URL)
	}()

	wg.Wait()
}
```

This works because `mu.Unlock()` is a release and `mu.Lock()` is an acquire. The cost is higher than `atomic.Pointer` but the pattern generalizes to more complex critical sections.

### Example 5: `sync.Once` does it for you

```go
package main

import (
	"fmt"
	"sync"
)

type Config struct {
	URL  string
	Port int
}

var (
	once sync.Once
	cfg  *Config
)

func loadConfig() {
	cfg = &Config{URL: "https://example.com", Port: 8080}
}

func GetConfig() *Config {
	once.Do(loadConfig)
	return cfg
}

func main() {
	var wg sync.WaitGroup
	for i := 0; i < 4; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			fmt.Println(GetConfig().URL)
		}()
	}
	wg.Wait()
}
```

`once.Do` guarantees `loadConfig` runs exactly once *and* that its writes happen-before the return of `Do` in every other goroutine. This is the canonical lazy-init pattern.

### Example 6: channel as the synchronization

```go
package main

import "fmt"

type Config struct {
	URL  string
	Port int
}

func main() {
	ch := make(chan *Config)

	go func() {
		c := &Config{URL: "https://example.com", Port: 8080}
		ch <- c // release
	}()

	c := <-ch // acquire
	fmt.Println(c.URL)
}
```

A channel send/receive establishes happens-before between the writes preceding the send and the reads following the receive. The pointer travels through the channel; the writes that built `*Config` are visible to the consumer.

### Example 7: lazy double-checked load (junior version)

We will look at *correct* double-checked locking in detail at the senior level. For now, here is the safe-but-not-cheap pattern using `sync.Once`:

```go
package main

import "sync"

type Conn struct{ /* ... */ }

type Pool struct {
	once sync.Once
	conn *Conn
}

func (p *Pool) Get() *Conn {
	p.once.Do(func() {
		p.conn = openConn()
	})
	return p.conn
}

func openConn() *Conn { return &Conn{} }
```

You will see code in older projects that tries to do this with a manual `if conn == nil { mu.Lock(); ... }` check. Do not write that yourself yet — `sync.Once` is correct, cheap, and well-understood.

---

## Coding Patterns

### Pattern: one-shot publication with `atomic.Pointer`

```go
var current atomic.Pointer[State]

func publish(s *State) { current.Store(s) }
func read() *State     { return current.Load() }
```

Use when: many readers, occasional writer (or a single one-shot writer), no need to wait.

### Pattern: ready-flag handshake

```go
var (
	value any
	ready atomic.Int32
)

func produce(v any) {
	value = v
	ready.Store(1)
}

func consume() any {
	for ready.Load() == 0 {
		runtime.Gosched()
	}
	return value
}
```

The producer writes `value` first, then sets `ready`. The consumer spins on `ready`, then reads `value`. The order is essential — and the atomic on `ready` is essential to make it safe.

### Pattern: lazy init with `sync.Once`

```go
var (
	once sync.Once
	svc  *Service
)

func Service() *Service {
	once.Do(func() { svc = newService() })
	return svc
}
```

Use when: initialization is expensive and only one goroutine should run it, but many may need the result.

### Pattern: closed-channel as a broadcast release

```go
var (
	doneCh = make(chan struct{})
	result *Result
)

func produce() {
	result = compute()
	close(doneCh) // release to all readers
}

func consume() *Result {
	<-doneCh // acquire
	return result
}
```

`close(ch)` is a release that every receive from `ch` synchronizes with. This is the cleanest one-to-many publication idiom in Go.

---

## Clean Code

- **Hide synchronization behind a function.** Do not expose `atomic.Int32` as a public package variable; wrap it in a typed accessor.
- **Name flags with verbs or states.** `ready`, `closed`, `loaded`, not `flag`, `b`, `x`.
- **Comment every atomic operation with what it publishes/consumes.** `// release: makes cfg visible to readers`.
- **Prefer `atomic.Pointer[T]` over `atomic.LoadPointer(unsafe.Pointer(&x))`.** The generic version was added in Go 1.19 and is type-safe.
- **One synchronization per fact.** If you publish through both a mutex and an atomic flag, you doubled the cost and the bug surface.

```go
// BAD: redundant
mu.Lock()
cfg = c
ready.Store(1)
mu.Unlock()

// GOOD: pick one
cfg = c
ready.Store(1) // alone is enough if other writes only happen here

// BETTER: collapse to one atomic
cfgPtr.Store(c)
```

---

## Product Use / Feature

### Lazy-loaded configuration

A web service reads `/etc/myservice/config.yaml` the first time someone requests `/healthz`. Subsequent requests reuse the cached parse. `sync.Once` is the entire implementation.

### One-shot feature flag

A flag that becomes `true` once the database has been migrated. Every request reads `atomic.LoadInt32(&migrated)` before deciding which code path to take. The migration goroutine calls `atomic.StoreInt32(&migrated, 1)` when done.

### Shared lookup table

A read-mostly map (currency conversion rates) updated once per hour. The updater builds a new `map[string]Rate`, then `rates.Store(&newMap)`. Every request reads `rates.Load()`. No mutex, no locking, full happens-before via `atomic.Pointer`.

---

## Error Handling

- **Do not return half-built values.** If `loadConfig` fails, the `atomic.Pointer` should remain nil (or the previous good value). Never `Store` a partially populated `*Config`.
- **Handle initialization errors in `sync.Once`.** `Do` will *not* re-run a failed initializer. You either store an error alongside the value or use the newer `sync.OnceValue`/`sync.OnceFunc` helpers (Go 1.21+).
- **Treat torn reads as impossible** if you used `sync/atomic`. The package guarantees indivisibility on aligned values. (On 32-bit ARM, plain 64-bit ops can tear; `sync/atomic` does not.)

```go
var once sync.Once
var (
	cfg *Config
	err error
)

func Load() (*Config, error) {
	once.Do(func() {
		cfg, err = loadFromDisk()
	})
	return cfg, err
}
```

Both `cfg` and `err` are published by the same `Do` call. If `loadFromDisk` failed, every caller of `Load` sees the same `err`.

---

## Security Considerations

- **Race conditions are security bugs.** A torn write to an authorization flag can leave a partially-updated state where the system "accidentally" grants access. `sync/atomic` prevents this for single-word fields.
- **Don't bypass synchronization to "optimize."** Hand-rolled lock-free code is a security risk if you don't understand the memory model. Use `sync` and `sync/atomic` until you've proven the cost matters.
- **Publish read-only.** When you `atomic.Pointer.Store(&immutableValue)`, every reader must treat `*immutableValue` as immutable. Mutating a published value is a data race even if the pointer itself is atomic.

---

## Performance Tips

- An uncontended `atomic.LoadInt32` is around 1–2 ns. An uncontended `sync.Mutex.Lock`/`Unlock` pair is around 10–25 ns. A channel send/receive on an unbuffered channel is 100–300 ns.
- For the read-mostly case (publish rarely, read often), `atomic.Pointer[T].Load` is the cheapest correct choice.
- Do not "optimize away" a `sync.Mutex` to atomics unless you can prove the result is still correct. The race detector helps but does not catch every reordering.
- `runtime.Gosched()` in a spin loop reduces contention on the CPU. In a *short* one-shot publication, a tight spin is fine; in a long wait, prefer a channel or `sync.Cond`.

---

## Best Practices

1. Treat **publication** and **consumption** as a pair of operations on the *same* location.
2. Prefer high-level primitives (`channel`, `sync.Once`, `sync.Mutex`, `atomic.Pointer[T]`) over hand-rolled flag-and-value pairs.
3. Run `go test -race ./...` in CI. The race detector finds the vast majority of publication bugs at junior level.
4. Document the publication contract in package docs: "Set once at startup, then safe to read from any goroutine."
5. Never share the *same* `*T` for both reading and writing once published. If you need to mutate, allocate a new `*T` and republish.
6. Avoid `atomic.Value` for new code if `atomic.Pointer[T]` works — it's type-safe and harder to misuse.
7. Do not mix `atomic` operations with plain reads or writes on the same location.

---

## Edge Cases & Pitfalls

- **Reading and writing the same field both atomically and non-atomically is a race.** All accesses must go through `sync/atomic` or none of them do.
- **`atomic.Value.Store` panics if you change the dynamic type.** You must store the same concrete type on every call. `atomic.Pointer[T]` is statically typed and avoids this.
- **64-bit atomics on 32-bit ARM** require the variable to be 8-byte aligned. As of Go 1.19, the `atomic.Int64`/`atomic.Uint64`/`atomic.Pointer[T]` struct types guarantee alignment; raw `int64` fields in structs do not.
- **Captured loop variables** in a goroutine plus a flag write are a classic combo bug. Each iteration's goroutine may see a different snapshot.
- **`sync.Once` does not re-run on error.** Plan for this.
- **`for !ready { }` (with `ready` as a plain bool)** is the textbook broken publication. Always make `ready` atomic.

---

## Common Mistakes

### Mistake 1: storing the flag before the value

```go
// WRONG
ready.Store(1)
value = v // race: a reader sees ready=1 but value is still old
```

The flag must be stored *after* the value. The release on `ready` publishes everything written before it — not after.

### Mistake 2: reading the value before the flag

```go
// WRONG
v := value
if ready.Load() == 1 {
    use(v)
}
```

You read `value` before performing the acquire on `ready`. Even if the flag is set, the value you read may have been the stale pre-publication snapshot.

### Mistake 3: half-atomic field

```go
var ready int32
go func() {
    ready = 1 // plain write — race detector flags this
}()
go func() {
    if atomic.LoadInt32(&ready) == 1 { /* ... */ }
}()
```

If you load atomically, you must store atomically on every writer.

### Mistake 4: using `atomic` for multi-word state

```go
// Two atomics do NOT add up to one atomic struct
atomic.StoreInt32(&x, 1)
atomic.StoreInt32(&y, 2)
// A reader can see x=1, y=0
```

If `x` and `y` must move together, use a mutex or publish a `*State` pointer.

### Mistake 5: closing the door before sending the package

```go
// WRONG
close(done)
result = compute()
```

The close is the release. Any writes after the close are not part of the publication.

---

## Common Misconceptions

- **"`atomic.Load` is just like a normal read but safer."** It is much more than that. It is also an *acquire fence* — it orders all subsequent reads and writes after it.
- **"If the value is a single word (an `int` or a `*T`), I don't need atomics."** False. Without atomics there is no happens-before relation, so the read may return a stale value indefinitely, even though no torn read occurs.
- **"x86 has strong memory ordering, so I can skip atomics."** Even on x86, the *compiler* is free to reorder. Atomics are also a compiler barrier.
- **"`sync.Mutex` is slow."** Uncontended, it's tens of nanoseconds. Contention is what makes it slow; the lock primitive itself is cheap.
- **"`sync.Once` is for thread-safe singletons."** It is — but it is also a clean publication primitive for any "compute once, share many" pattern.

---

## Tricky Points

- A read of a `*T` that is `nil` after another goroutine just stored a non-nil value is still allowed if you read non-atomically. The Go memory model does not promise eventual visibility without synchronization.
- `atomic.AddInt32` is *both* a load and a store; it counts as both an acquire and a release.
- `atomic.CompareAndSwap` is *both* on success; on failure it's still both, but no actual update happened.
- `atomic.Pointer[T].CompareAndSwap` compares pointer identity, not value equality. Two pointers to equal structs are not equal pointers.

---

## Test

```go
package publish_test

import (
	"sync"
	"sync/atomic"
	"testing"
)

func TestPublishPointer(t *testing.T) {
	var p atomic.Pointer[int]
	var wg sync.WaitGroup
	wg.Add(2)

	go func() {
		defer wg.Done()
		x := 42
		p.Store(&x)
	}()
	go func() {
		defer wg.Done()
		for {
			if v := p.Load(); v != nil {
				if *v != 42 {
					t.Errorf("got %d, want 42", *v)
				}
				return
			}
		}
	}()

	wg.Wait()
}
```

Run with `go test -race`. The synchronized version passes; remove the atomic and you get a data-race report.

---

## Tricky Questions

1. **Q:** Why is `for !ready { }` (with `ready` as a plain `bool`) wrong even on x86 where memory ordering is strong?
   **A:** Because the *compiler* may hoist the read out of the loop. The loop becomes `t := ready; for !t { }`, which spins forever if `t` was false at entry. Atomics are also a compiler barrier.

2. **Q:** If I store a pointer with `atomic.Pointer.Store`, can a reader still see a partially-initialized struct?
   **A:** No, *provided* you fully built the struct before calling `Store`. The release on `Store` publishes every write made before it in program order — including the writes to fields of `*T`.

3. **Q:** What happens if I `atomic.Pointer.Store` a pointer and a reader is in the middle of reading its fields when I `Store` a *new* pointer?
   **A:** Nothing bad — the reader holds its own copy of the *old* pointer, and the struct it points to is still alive (Go has a GC). The new pointer is independent.

4. **Q:** Does `sync.Mutex.Lock` synchronize with a *previous* `Unlock` by a different goroutine on the same mutex?
   **A:** Yes — exactly that. Unlock is the release, Lock is the acquire on the same memory.

5. **Q:** Is `runtime.GOMAXPROCS(1)` enough to make my unsynchronized publication safe?
   **A:** No. Even with one OS thread, the compiler may still reorder. And the runtime may preempt your goroutine mid-write.

---

## Cheat Sheet

```
PUBLISHING (one writer, many readers)
=====================================

Idiomatic Go (Go 1.19+):

    var v atomic.Pointer[T]
    v.Store(built)  // release
    x := v.Load()   // acquire

Lazy init:

    var once sync.Once
    once.Do(initFn)

Through a channel:

    done := make(chan struct{})
    go func() { build(); close(done) }()
    <-done // safe to read what build() wrote

Through a mutex:

    mu.Lock()
    field = v
    mu.Unlock()
    // reader does mu.Lock(); v := field; mu.Unlock()


COMMON BUGS
===========

Plain bool flag: race
Plain pointer:   race
Atomic + non-atomic on same field: race
Store flag before value: visible-too-early
Load value before flag:  see-old-value


WHEN TO USE WHAT
================

One-shot publication:        atomic.Pointer[T] or sync.Once
Read-mostly state:           atomic.Pointer[T]
Multi-field consistent:      sync.Mutex
Wait for event:              channel
Lazy init with error:        sync.OnceValues (Go 1.21+)
```

---

## Self-Assessment Checklist

- [ ] I can explain why `for !ready { }` with a plain `bool` is incorrect.
- [ ] I can use `atomic.StoreInt32` and `atomic.LoadInt32` to publish a flag.
- [ ] I can use `atomic.Pointer[T]` to publish a struct.
- [ ] I know that a mutex provides both acquire (Lock) and release (Unlock).
- [ ] I can name three Go primitives that provide acquire/release semantics.
- [ ] I know what `sync.Once.Do` guarantees and when not to use it.
- [ ] I know the race detector catches missing synchronization.
- [ ] I know that `sync/atomic` in Go provides sequential consistency, not just acquire/release.

---

## Summary

Publishing a value from one goroutine to another requires two cooperating operations: a **release** on the producer side and an **acquire** on the consumer side, on the *same* synchronization location. Without both, the receiving goroutine may see a stale value, a partially-built struct, or a torn intermediate.

Go provides this contract through several primitives:

- `sync.Mutex` — `Lock` is acquire, `Unlock` is release.
- `sync/atomic` — every operation is sequentially consistent, which subsumes acquire/release.
- `sync.Once` — `Do` provides both around the initialization function.
- Channels — send and receive on the same channel synchronize.

As a junior, your job is to recognise these primitives and reach for them by default. Do not write hand-rolled flag-and-value pairs without `sync/atomic`. Do not assume "single-word read is always safe." Run `go test -race`.

The next level (middle) builds on this with publication patterns for real services: read-mostly configuration, lazy initializers, and the read-the-flag-then-the-value handshake.

---

## What You Can Build

- A thread-safe lazy-loaded configuration cache.
- A one-shot feature flag toggled at startup and read by every request.
- A read-mostly currency-rate table refreshed every hour.
- A "service ready" sentinel used by health checks.
- A safe-publication wrapper around `*sql.DB` for a connection pool that opens lazily.

---

## Further Reading

- The Go memory model: https://go.dev/ref/mem
- `sync` package docs: https://pkg.go.dev/sync
- `sync/atomic` package docs: https://pkg.go.dev/sync/atomic
- Russ Cox, "Hardware Memory Models": https://research.swtch.com/hwmm
- Russ Cox, "Programming Language Memory Models": https://research.swtch.com/plmm

---

## Related Topics

- Mutex and RWMutex (lock primitives that provide acquire/release).
- Channels (send/receive establish happens-before).
- `sync.Once` (publication primitive for lazy init).
- `sync/atomic` (the lowest-level publication primitive).
- The Go race detector (`-race` flag).
- Memory ordering and barriers (parent topic; see senior and professional levels for deeper coverage).

---

## Extended Examples and Walkthroughs

### Walkthrough: from broken to fixed, step by step

Let's take the original buggy program and refactor it five times, each time stronger than the last. The exercise is not to find "the" right answer — it's to feel the design space.

**Version 0: completely broken.**

```go
var cfg *Config
var ready bool

go func() {
    cfg = build()
    ready = true
}()

go func() {
    for !ready { }
    use(cfg)
}()
```

Both fields are plain. The compiler may hoist `ready` out of the loop, turning the consumer into an infinite spin. Even if it doesn't hoist, the CPU may publish `ready=true` before `cfg=...`, leaving the consumer with `cfg=nil`. The race detector flags this immediately.

**Version 1: atomic flag, plain pointer.**

```go
var cfg *Config
var ready int32

go func() {
    cfg = build()
    atomic.StoreInt32(&ready, 1)
}()

go func() {
    for atomic.LoadInt32(&ready) == 0 { }
    use(cfg)
}()
```

This is correct. The atomic store on `ready` is a release; it publishes the write to `cfg`. The atomic load is an acquire; the subsequent `use(cfg)` sees the new pointer. The race detector is happy.

But there are two stylistic problems:

1. Two separate variables — easy for a future maintainer to write to `cfg` without updating `ready`, or vice versa.
2. A spin loop with no `runtime.Gosched()` will burn a CPU core. On a single-core machine it can starve the producer.

**Version 2: atomic pointer.**

```go
var cfg atomic.Pointer[Config]

go func() {
    cfg.Store(build())
}()

go func() {
    var c *Config
    for c = cfg.Load(); c == nil; c = cfg.Load() {
        runtime.Gosched()
    }
    use(c)
}()
```

One variable. The nil-ness of the pointer *is* the flag. We added a `Gosched` so other goroutines (including the producer) get CPU time. This is the idiomatic Go pattern for "build once, read many."

**Version 3: signal with a closed channel.**

```go
var cfg *Config
ready := make(chan struct{})

go func() {
    cfg = build()
    close(ready)
}()

go func() {
    <-ready
    use(cfg)
}()
```

No busy-wait. The consumer blocks on `<-ready` until `close` happens. `close` is a release; the receive is an acquire. As a bonus, this scales naturally to many consumers — every receive on a closed channel returns immediately.

**Version 4: lazy init with `sync.Once`.**

```go
var (
    once sync.Once
    cfg  *Config
)

func Get() *Config {
    once.Do(func() { cfg = build() })
    return cfg
}
```

Consumers do not need to know that the value is computed on demand. There is no producer goroutine — the first caller to `Get` is also the producer. `sync.Once` handles both the deduplication and the publication.

**Version 5: `sync.OnceValue` (Go 1.21+).**

```go
var Get = sync.OnceValue(build)
```

A single declaration. `Get()` returns the value built by `build`, exactly once. Type-safe, panic-free, no global variable to forget about.

The progression illustrates a key Go principle: prefer the highest-level primitive that captures your intent. You drop to `atomic.Pointer` when you need read performance; you drop to `atomic.Int32` when you need a single flag; you stop dropping further.

### Walkthrough: why "atomic" without "ordering" is not enough

This is a thought experiment that does not apply to Go directly (because Go's atomics are seq-cst), but it builds intuition.

Suppose we had `atomic_relaxed` operations that were indivisible but had no ordering guarantees:

```go
// hypothetical relaxed atomic
cfg = build()
atomic_relaxed.StoreInt32(&ready, 1)
```

A consumer doing `atomic_relaxed.LoadInt32(&ready)` would never see a torn write — it always sees 0 or 1. But it might see `ready=1` *before* it sees the new `cfg`. The relaxed atomic gives you indivisibility but not visibility ordering.

That is why acquire/release exist as a separate concept. Indivisibility (no torn reads) and ordering (no reordering across) are two different guarantees. Go's `sync/atomic` gives you both, always.

### Walkthrough: the race detector and what it catches

```go
var x int

func main() {
    go func() { x = 1 }()
    go func() { _ = x }()
    time.Sleep(time.Second)
}
```

Run `go run -race main.go`. You will see something like:

```
WARNING: DATA RACE
Write at 0x... by goroutine 7:
  main.main.func1()
      /tmp/r.go:6 +0x...
Previous read at 0x... by goroutine 8:
  main.main.func2()
      /tmp/r.go:7 +0x...
```

The race detector instruments every memory access and tracks the happens-before relation. A race is two accesses (one of them a write) with no happens-before edge between them.

Fix with an atomic:

```go
var x int32

func main() {
    go func() { atomic.StoreInt32(&x, 1) }()
    go func() { _ = atomic.LoadInt32(&x) }()
    time.Sleep(time.Second)
}
```

Now there is a release-acquire pair (if the consumer happens to observe the write) or two unrelated accesses (if not). Either way, no race.

The race detector is your best friend at the junior level. Run all tests with `-race`. Many teams enable it in CI as a separate job.

### Walkthrough: publishing a slice header

A `[]T` in Go is a three-word struct (pointer, length, capacity). Storing a slice directly is *not* atomic — three separate words may be observed independently.

```go
// WRONG
var data []int

go func() {
    data = []int{1, 2, 3}
}()

go func() {
    for len(data) == 0 { } // race
    fmt.Println(data[0])    // may read garbage
}()
```

Two ways to publish a slice:

```go
// Right way 1: atomic pointer to the slice header.
type slice struct{ data []int }
var s atomic.Pointer[slice]

go func() {
    s.Store(&slice{data: []int{1, 2, 3}})
}()

go func() {
    for s.Load() == nil { }
    fmt.Println(s.Load().data[0])
}()
```

```go
// Right way 2: through a channel.
ch := make(chan []int, 1)
go func() { ch <- []int{1, 2, 3} }()
go func() { fmt.Println((<-ch)[0]) }()
```

Either way, the *header* is published atomically, and the backing array is reachable through the published pointer.

### Walkthrough: what `go run -race` actually detects

`-race` is implemented via "happens-before vector clocks." For every goroutine, the runtime maintains a logical clock. Every synchronization operation updates one or more clocks. Every memory access is tagged with the current clock of its goroutine.

When a memory location is accessed, the detector checks whether the access happens-before all *previous* accesses to that location. If yes, no race. If two concurrent accesses (no happens-before) exist and at least one is a write, a race is reported.

The race detector is *complete but not sound*: every race it reports is a real race, but it may miss races that happen to not occur in this run. Run your test suite many times if you suspect timing-dependent bugs.

---

## Extended Vocabulary

| Term | Definition |
|------|-----------|
| **Acquire fence** | A barrier that prevents subsequent memory operations from being reordered before it. |
| **Release fence** | A barrier that prevents preceding memory operations from being reordered after it. |
| **Acq-rel** | An operation that is both an acquire and a release. `sync.Mutex.Lock` is not acq-rel — it's just an acquire; the matching `Unlock` is the release. But a successful `CompareAndSwap` is acq-rel. |
| **Full fence** | A barrier preventing reordering in both directions. Sequential consistency requires full fences. |
| **Read-modify-write (RMW)** | An atomic that reads, computes a new value, and writes — like `CompareAndSwap`, `AddInt32`, or `SwapInt32`. RMWs are typically acq-rel. |
| **Linearizable** | A history of operations is linearizable if each operation appears to take effect instantaneously at some point between its invocation and its return. Sequential consistency implies linearizability for single-object operations. |
| **Causal consistency** | A weaker model: if A causes B, all observers see A before B. Acquire/release implements per-location causal consistency. |
| **Store buffer** | A CPU structure that holds pending writes before they reach the cache. The producer of a store-buffer-induced reordering is a major source of weakly-ordered behavior. |
| **MESI / MOESI** | Cache coherence protocols. They keep caches *coherent* (every cache eventually sees the same value) but not *consistent* (the order in which writes appear may differ). |

---

## More Code Examples

### A real publication helper

```go
package config

import "sync/atomic"

type Snapshot struct {
    Hosts []string
    Token string
}

var current atomic.Pointer[Snapshot]

// Set replaces the current snapshot. Concurrent-safe.
func Set(s *Snapshot) {
    current.Store(s)
}

// Get returns the latest snapshot or nil if none yet.
func Get() *Snapshot {
    return current.Load()
}
```

```go
// In main:
config.Set(&config.Snapshot{Hosts: []string{"a", "b"}, Token: "..."})

// In a handler:
s := config.Get()
if s == nil {
    http.Error(w, "not ready", 503)
    return
}
// use s.Hosts, s.Token
```

Notice: the snapshot is *read-only* once published. Updates allocate a new `*Snapshot` and call `Set` again. The previous `*Snapshot` remains alive as long as any reader holds it (Go's GC handles this).

### A real one-shot signal

```go
package server

import (
    "context"
    "sync"
)

type Server struct {
    ready   chan struct{}
    once    sync.Once
}

func New() *Server {
    return &Server{ready: make(chan struct{})}
}

// Ready signals that the server has finished starting up.
func (s *Server) Ready() {
    s.once.Do(func() { close(s.ready) })
}

// Wait blocks until the server is ready or ctx is canceled.
func (s *Server) Wait(ctx context.Context) error {
    select {
    case <-s.ready:
        return nil
    case <-ctx.Done():
        return ctx.Err()
    }
}
```

A common pattern: signal readiness by closing a channel. Multiple goroutines can wait. Once closed, future waiters return instantly. `sync.Once` guards against double-close.

### A real lazy initializer

```go
package db

import (
    "database/sql"
    "sync"
)

var (
    once sync.Once
    db   *sql.DB
    err  error
)

func DB() (*sql.DB, error) {
    once.Do(func() {
        db, err = sql.Open("postgres", os.Getenv("DSN"))
        if err == nil {
            err = db.Ping()
        }
    })
    return db, err
}
```

The first caller pays for the connection setup. Every subsequent caller gets the same `*sql.DB` (and the same error, if any). The publication of both `db` and `err` is atomic from the consumer's point of view.

---

## Extended Pitfalls

### Pitfall: atomic stores on different variables

```go
var a, b atomic.Int32

go func() {
    a.Store(1)
    b.Store(2)
}()

go func() {
    if b.Load() == 2 {
        // can we be sure a.Load() == 1?
    }
}()
```

In Go, **yes**, because all atomics are sequentially consistent: every goroutine observes the same total order of atomic operations. If you saw `b=2`, you must also see `a=1` (or any later value of `a`). In C++ with `memory_order_release` on `a.store` and `memory_order_acquire` on `b.load`, you would *not* be guaranteed — release/acquire pair only on the same location.

This is one of the places Go is stronger than C++.

### Pitfall: relying on a torn read "always working"

```go
type Pair struct{ A, B int }

var p Pair

go func() { p = Pair{1, 2} }()
go func() { x := p; fmt.Println(x) }()
```

This is a data race, and the result is undefined. On x86 you may see consistent pairs *most* of the time and conclude "good enough." Don't. The Go memory model is not "what the x86 happens to do on Tuesday."

Use `atomic.Pointer[Pair]` or a mutex.

### Pitfall: closure captures and stale state

```go
for i := 0; i < 10; i++ {
    go func() {
        fmt.Println(i) // captures i by reference (pre-Go-1.22)
    }()
}
```

In Go 1.22+, the loop variable is freshly bound per iteration. In older versions, every goroutine sees the same `i`, possibly already incremented past the intended value. This is a different kind of memory bug — not about ordering, but about *sharing*. Fix with explicit shadowing:

```go
for i := 0; i < 10; i++ {
    i := i
    go func() { fmt.Println(i) }()
}
```

---

## Extra Tests

```go
package publish_test

import (
    "context"
    "sync"
    "sync/atomic"
    "testing"
    "time"
)

// Test that the consumer always sees the producer's writes.
func TestPublishStruct(t *testing.T) {
    type Snapshot struct{ X, Y int }
    var s atomic.Pointer[Snapshot]

    var wg sync.WaitGroup
    wg.Add(1)
    go func() {
        defer wg.Done()
        s.Store(&Snapshot{X: 1, Y: 2})
    }()

    ctx, cancel := context.WithTimeout(context.Background(), time.Second)
    defer cancel()
    for {
        if snap := s.Load(); snap != nil {
            if snap.X != 1 || snap.Y != 2 {
                t.Errorf("bad snapshot %+v", snap)
            }
            wg.Wait()
            return
        }
        select {
        case <-ctx.Done():
            t.Fatal("never observed publication")
        default:
        }
    }
}

// Test that sync.Once publishes its result.
func TestOncePublishes(t *testing.T) {
    var once sync.Once
    var x int

    var wg sync.WaitGroup
    for i := 0; i < 10; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            once.Do(func() { x = 42 })
            if x != 42 {
                t.Errorf("got %d, want 42", x)
            }
        }()
    }
    wg.Wait()
}
```

Run with `go test -race`. The first test confirms ordering; the second confirms `sync.Once` publishes its writes to all callers.

---

## Diagrams & Visual Aids

```
Producer goroutine               Consumer goroutine
==================               ==================

cfg.URL = "..."                  for {
cfg.Port = 8080                    p = atomic.Load(&ptr)   <-- ACQUIRE
                                   if p != nil { break }
                                 }
                                 fmt.Println(p.URL)
                                 fmt.Println(p.Port)
atomic.Store(&ptr, &cfg) <-- RELEASE   ^
                                       |
       writes above the release  -----+-- become visible after the acquire
       observes the released ptr
```

```
The Three Layers of Reordering
==============================

Source code order             Compiler-emitted order        CPU execution order
-----------------             ----------------------        -------------------

cfg = build()                 mov  [cfg],   rax              (may issue mov [ready]
ready = 1                     mov  [ready], 1                 to store buffer first,
                                                              draining cfg later)

A release barrier prevents reordering in ALL THREE LAYERS:

  - source: programmer must write the release after the writes (your job)
  - compiler: atomic.Store is a compiler barrier (Go's job)
  - CPU: atomic.Store emits the right fence for the architecture (runtime's job)
```

```
Happens-Before Graph for sync.Once
===================================

       Goroutine A                Goroutine B                Goroutine C
       -----------                -----------                -----------

       once.Do(init) ───────────┐
       (winner runs init)       │
            │                   │
            │ writes to cfg     │  "happens-before"
            │                   │  the return of any
            ▼                   │  other once.Do call
       return from Do           │
                                ▼                            
                                once.Do(init) ────────────┐  
                                (loser, blocks until      │  
                                 winner finishes)         │  
                                       │                  ▼  
                                       ▼            once.Do(init)
                                  read cfg          (also blocks,
                                  (safe)             then sees cfg)
```

```
What the Race Detector Tracks
==============================

Goroutine A                       Goroutine B
-----------                       -----------

vc.A = 1                          vc.A = 0
vc.B = 0                          vc.B = 1

x = 5            <-- write tagged with vc.A=1, vc.B=0

(no sync edge between A and B)    y = x   <-- read tagged with vc.A=0, vc.B=1
                                            
            ^                                 ^
            +-- the read's vector clock does NOT >= write's vector clock,
                so the detector flags a race.

After a release-acquire pair on the same atomic, B's vector clock
absorbs A's clock, and subsequent reads are correctly ordered.
```

---

## Extra Coding Patterns

### Pattern: read-mostly snapshot with periodic refresh

```go
package rates

import (
    "sync/atomic"
    "time"
)

type Rates struct {
    USD, EUR, GBP float64
}

var current atomic.Pointer[Rates]

func init() {
    go refreshLoop()
}

func refreshLoop() {
    for {
        r := fetchFromAPI()
        current.Store(r)
        time.Sleep(time.Hour)
    }
}

func Get() *Rates { return current.Load() }

func fetchFromAPI() *Rates { /* ... */ return &Rates{} }
```

Every consumer calls `rates.Get()` and uses the returned pointer. The refresh goroutine builds a new struct and stores its pointer. Old snapshots are garbage-collected when no reader holds them. There is no lock; reads are wait-free.

### Pattern: lazy singleton wrapper

```go
package logger

import "sync"

type Logger struct{ /* ... */ }

var (
    instance *Logger
    once     sync.Once
)

func Default() *Logger {
    once.Do(func() { instance = newLogger() })
    return instance
}
```

The first call to `Default()` runs `newLogger`. Every other call (including concurrent ones) returns the same `*Logger`. No locking on the fast path after the first call (modulo a fast atomic check inside `sync.Once`).

### Pattern: one-time error capture

```go
package pipeline

import "sync"

type Pipeline struct {
    once sync.Once
    err  error
}

// Fail records the first error and discards subsequent ones.
func (p *Pipeline) Fail(e error) {
    p.once.Do(func() { p.err = e })
}

// Err returns the first error, or nil.
func (p *Pipeline) Err() error {
    return p.err // safe to read non-atomically? No!
}
```

Wait — `p.err` is read without an atomic, and `p.once.Do` happened on another goroutine. Is this safe?

Yes — but only because the documented contract is "read `Err()` only after the pipeline has finished, on the same goroutine that called `Wait`/`Close`." If you allow concurrent `Fail` and `Err`, you need an atomic pointer or a mutex.

A safer version:

```go
type Pipeline struct {
    err atomic.Pointer[error]
}

func (p *Pipeline) Fail(e error) {
    p.err.CompareAndSwap(nil, &e) // only the first one wins
}

func (p *Pipeline) Err() error {
    if e := p.err.Load(); e != nil {
        return *e
    }
    return nil
}
```

Now `Fail` and `Err` can race freely. CAS publishes the error pointer; readers acquire it.

### Pattern: build-then-publish for slice/map updates

```go
type LookupTable struct {
    data atomic.Pointer[map[string]int]
}

func (t *LookupTable) Replace(items map[string]int) {
    // Make an independent copy so future Replace calls don't mutate
    // a map a reader might be iterating.
    cp := make(map[string]int, len(items))
    for k, v := range items {
        cp[k] = v
    }
    t.data.Store(&cp)
}

func (t *LookupTable) Lookup(k string) (int, bool) {
    m := t.data.Load()
    if m == nil {
        return 0, false
    }
    v, ok := (*m)[k]
    return v, ok
}
```

Readers acquire a pointer to the *current* map and read it freely — even iterating. The next `Replace` publishes a new map; old readers continue with the old one. No locking, no contention.

This is the read-copy-update (RCU) idiom, simplified.

---

## More Common Misconceptions

- **"`go run -race` is too slow for production-like loads, so I'll skip it."** Use `-race` in unit tests and CI. You don't need it on production traffic, but you do need it on every PR.
- **"`atomic.Value` is faster than `sync.Mutex`."** Sometimes, sometimes not. `atomic.Value` is wait-free for reads but the Store path uses a mutex internally and checks type compatibility on every call.
- **"If I print a value before a `sync.Mutex.Lock`, the print is part of the critical section."** No — only operations *inside* `Lock`/`Unlock` are protected. Prints before the lock can race with concurrent writers.
- **"Memory ordering is about cache coherence."** Coherence keeps caches eventually-consistent. *Ordering* is about whether you observe writes in the right sequence. Coherence is a necessary but insufficient guarantee.

---

## More Tricky Points

### Spurious failures of `CompareAndSwap`

On weakly-ordered architectures, the underlying hardware instruction (LL/SC on ARM and POWER) can fail "spuriously" — failing even when the values match — due to cache events. Go's `atomic.CompareAndSwap` *does not* expose spurious failures; it retries internally until either the swap succeeds or a real mismatch is observed. (This is implementation-defined and may change, but it's the current behavior.)

### Aligned vs unaligned atomic access

On most 64-bit platforms, an aligned 64-bit access is atomic by default in hardware. Go relies on this. On 32-bit ARM with older Go versions, accessing a misaligned 64-bit field caused crashes. The fix in modern Go is to use `atomic.Int64`/`atomic.Uint64` *struct* wrappers, which guarantee alignment.

### Atomicity of `interface{}` values

An `interface{}` is two words (type pointer + data pointer). A plain assignment `i = v` is not atomic. To atomically store an `interface{}`, wrap it in a `*Holder` and use `atomic.Pointer[Holder]`, or use `atomic.Value` (which internally uses a `noCopyMutex`).

### Read amplification with `atomic.Pointer`

Every `Load` returns a pointer. If consumers chain `t.data.Load().Field`, the load happens every call — readers don't share a snapshot. For hot paths, load once into a local variable:

```go
m := t.data.Load()
v1 := (*m)["a"]
v2 := (*m)["b"]
```

This also makes the snapshot semantics explicit: `v1` and `v2` come from the same map.

---

## Extra Self-Check Questions

1. What is the difference between *atomic* and *ordered*? In Go, do you ever need to think about them separately?
2. Why is `var done bool; for !done { }` insufficient for waiting on a producer goroutine?
3. Name three Go primitives that establish happens-before.
4. What does `close(ch)` synchronize with?
5. Can you read the same field with both `atomic.LoadInt32` and a plain access without it being a race?
6. What does `sync.Once.Do` do if the function panics?
7. What's the difference between `atomic.Value` and `atomic.Pointer[T]`?
8. If you store a `*T` atomically, then later mutate `*T`, is that safe?
9. Why might a spinning loop on an atomic flag be a bad idea on a single-core machine?
10. How does the race detector know two accesses raced?

(Answers are interspersed in the sections above. If unsure on any, re-read the relevant section before moving to middle.md.)

---

## Why This Matters in Practice

At first the topic feels theoretical: "I write Go, and the race detector tells me what's wrong. Why should I memorise acquire/release?"

The answer is that the race detector tells you *that* something is wrong, not *why*. The why is "I didn't establish a happens-before edge between the writer and the reader." Knowing the why lets you:

- Pick the right primitive (atomic, mutex, channel, once) for the situation.
- Read other people's code and recognise the synchronization pattern.
- Debug subtle production bugs that the race detector missed because the timing was lucky during tests.
- Reason about performance: which primitive costs less.

It also makes the next level of memory-ordering content (middle, senior, professional) feel natural rather than alien. By the time you reach the professional level, you will be implementing wait-free queues — and you will look back at this junior file fondly, because that is where the foundations were laid.

---

## A Brief History (Optional)

Memory ordering became a public concern in 1979 with Leslie Lamport's paper "How to Make a Multiprocessor Computer That Correctly Executes Multiprocess Programs," which defined *sequential consistency*. By the 1990s, CPU designers realised SC was too expensive on weakly-ordered hardware and started shipping CPUs with relaxed memory models. The Alpha was infamous for being the most aggressive; ARM and POWER followed.

Java was the first mainstream language to formalise a memory model (Java 5, 2004). C++ added one in C++11. Go's memory model was published in 2009 with a major clarification in 2022. The modern Go memory model is more permissive than Java's — Go permits compilers to optimise more aggressively — but the primitives are simpler: there is no `volatile`, no `synchronized`, just channels, mutexes, atomics, and `sync.Once`.

The acquire/release vocabulary comes from the *DRF-SC* (data-race-free implies sequentially consistent) model first proposed by Adve and Hill in 1990. It's the basis of every modern language memory model, including Go's.

---

## Connection to the Rest of Go

Every Go concurrency primitive provides acquire/release (or stronger) somewhere:

- `chan` — send is release, receive is acquire.
- `sync.Mutex`/`sync.RWMutex` — Lock is acquire, Unlock is release.
- `sync.Once` — wraps both around the user function.
- `sync.WaitGroup` — Wait is acquire, Done is release.
- `sync.Cond` — Signal/Broadcast publish the underlying state; Wait acquires it.
- `sync/atomic` — every operation is acq-rel (and seq-cst).
- `context.Context` — Done channel close is a release.

This unity is why Go feels coherent: there is one synchronization model, exposed at different abstraction levels.

---

## When to Move On

You're ready for `middle.md` when:

- You can write a correct lazy-init using `sync.Once` without checking the docs.
- You can publish a struct pointer with `atomic.Pointer[T]` and explain why it's safe.
- You can describe what `mu.Unlock()` does *besides* releasing the lock.
- You can articulate why the race detector flags `for !done { }`.

If those feel solid, proceed.

---

## Appendix A: A Library of Worked Examples

The next ten subsections walk through realistic micro-services or library patterns where acquire/release matters. Each example is small enough to run, large enough to illustrate one decision.

### A.1 — A connection counter

```go
package conn

import "sync/atomic"

var active atomic.Int64

func Inc() int64 { return active.Add(1) }
func Dec() int64 { return active.Add(-1) }
func Now() int64 { return active.Load() }
```

Three functions, three atomics. `Add` is acq-rel — it acts as both a release of any earlier writes on the calling goroutine and an acquire of any earlier writes on goroutines whose Add it observed.

But `Inc`/`Dec` don't *publish* anything except the counter itself. The acq-rel happens incidentally. This is the most common case for atomics: simple counters, where the only "publication" is the count.

### A.2 — A safer atomic counter wrapper

```go
package counter

import "sync/atomic"

type Counter struct {
    v atomic.Int64
}

func (c *Counter) Inc()        { c.v.Add(1) }
func (c *Counter) Dec()        { c.v.Add(-1) }
func (c *Counter) Load() int64 { return c.v.Load() }
```

Wrapping in a struct prevents callers from doing arithmetic on the raw atomic and accidentally introducing a race. The type system is your friend: `Counter` is a sealed abstraction over an `atomic.Int64`.

### A.3 — A first-error sink

```go
package sink

import "sync/atomic"

type First struct {
    err atomic.Pointer[error]
}

// Record stores e only if no error has been recorded yet.
func (f *First) Record(e error) {
    if e == nil {
        return
    }
    f.err.CompareAndSwap(nil, &e)
}

// Err returns the first recorded error, or nil.
func (f *First) Err() error {
    if p := f.err.Load(); p != nil {
        return *p
    }
    return nil
}
```

`CompareAndSwap(nil, &e)` is the linchpin. It atomically tests "is the field nil?" and, if so, stores a pointer to `e`. The store is a release; subsequent `Err` calls acquire. The result: at most one error wins, all readers see the winner.

### A.4 — A read-only flag exposed safely

```go
package feature

import "sync/atomic"

var enabled atomic.Bool

func Enable()      { enabled.Store(true) }
func Disable()     { enabled.Store(false) }
func IsEnabled() bool {
    return enabled.Load()
}
```

`atomic.Bool` was added in Go 1.19. Before that you'd use `atomic.Int32` with 0/1. The semantics are identical: store is release, load is acquire.

### A.5 — A late-binding constructor

```go
package service

import "sync"

var (
    once     sync.Once
    instance *Service
)

func Default() *Service {
    once.Do(func() {
        instance = &Service{
            client: newClient(),
            cache:  newCache(),
            log:    newLogger(),
        }
    })
    return instance
}
```

`sync.Once` is essentially `atomic.Bool` + `sync.Mutex` + the closure invocation. The two atomics inside (a "done" flag and a guard counter) provide acquire/release; the closure runs exactly once; every later caller acquires the published `instance`.

### A.6 — A copy-on-write configuration

```go
package cfg

import "sync/atomic"

type Config struct {
    MaxConn int
    Timeout int
    Hosts   []string
}

var current atomic.Pointer[Config]

func Set(c *Config) { current.Store(c) }
func Get() *Config  { return current.Load() }

// Update applies fn to a copy of the current config and stores the result.
func Update(fn func(*Config)) {
    for {
        old := current.Load()
        cp := *old // shallow copy
        // copy slice contents if Hosts must be independent
        cp.Hosts = append([]string(nil), old.Hosts...)
        fn(&cp)
        if current.CompareAndSwap(old, &cp) {
            return
        }
    }
}
```

`Update` reads the current config, copies it, mutates the copy, and CASes. If a concurrent `Update` won, we lose the CAS and retry. This is *optimistic concurrency control* — a building block of lock-free algorithms.

### A.7 — A capture-and-process worker

```go
package worker

import "sync/atomic"

type Job struct {
    ID   int
    Data []byte
}

type Worker struct {
    current atomic.Pointer[Job]
}

func (w *Worker) Submit(j *Job) bool {
    return w.current.CompareAndSwap(nil, j)
}

func (w *Worker) Take() *Job {
    for {
        j := w.current.Load()
        if j == nil {
            return nil
        }
        if w.current.CompareAndSwap(j, nil) {
            return j
        }
    }
}
```

`Submit` posts a job only if the slot is empty (CAS against `nil`). `Take` reads, then CASes to clear the slot. The handshake is wait-free for the reader but lock-free for the writer (retries on contention).

### A.8 — A "ready" gate

```go
package gate

import (
    "context"
    "sync"
)

type Gate struct {
    once sync.Once
    ch   chan struct{}
}

func New() *Gate {
    return &Gate{ch: make(chan struct{})}
}

func (g *Gate) Open() {
    g.once.Do(func() { close(g.ch) })
}

func (g *Gate) Wait(ctx context.Context) error {
    select {
    case <-g.ch:
        return nil
    case <-ctx.Done():
        return ctx.Err()
    }
}
```

A `Gate` is a one-shot synchronization primitive. The producer calls `Open` (release on the closed channel). All waiters are released — but each acquires their own copy of "I observed the close."

### A.9 — A latched value

```go
package latch

import (
    "context"
    "sync"
    "sync/atomic"
)

type Latch[T any] struct {
    once  sync.Once
    val   atomic.Pointer[T]
    ch    chan struct{}
    initC sync.Once
}

func New[T any]() *Latch[T] {
    return &Latch[T]{ch: make(chan struct{})}
}

func (l *Latch[T]) Set(v T) {
    l.once.Do(func() {
        l.val.Store(&v)
        close(l.ch)
    })
}

func (l *Latch[T]) Get(ctx context.Context) (T, error) {
    select {
    case <-l.ch:
        return *l.val.Load(), nil
    case <-ctx.Done():
        var zero T
        return zero, ctx.Err()
    }
}
```

A `Latch[T]` is "future-like" — write-once, read-many. `sync.Once` guards `Set`. The value is stored before the channel is closed; the close is the release; readers acquire by receiving from the (closed) channel.

### A.10 — Combining `sync.Map` with publication

```go
package registry

import "sync"

var registry sync.Map // map[string]*Service

func Register(name string, s *Service) {
    registry.Store(name, s)
}

func Lookup(name string) (*Service, bool) {
    v, ok := registry.Load(name)
    if !ok {
        return nil, false
    }
    return v.(*Service), true
}
```

`sync.Map.Store` is a release; `Load` is an acquire. Every `*Service` stored is fully built before the store. Readers acquire and get a safely-published pointer.

`sync.Map` is optimised for read-mostly workloads with stable keys; it's slower than a `sync.Mutex`-protected map for write-heavy workloads. The acquire/release contract is the same either way.

---

## Appendix B: Why Sequential Consistency Matters

Go's `sync/atomic` provides sequential consistency. Why is this *more* than acquire/release?

Acquire/release pairs *one location at a time*. If you have two atomics A and B, and goroutine 1 writes A then B (with release on each), goroutine 2 might observe:

- A first, then B (consistent with G1's program order).
- B first, then A.
- B without seeing A at all.

The third case is forbidden under sequential consistency because there is a *single global order* of atomic operations. Under pure acquire/release, the third case is allowed if G2 only acquires on B and not on A.

Sequential consistency makes reasoning easier: every goroutine sees one consistent timeline of atomic operations. The cost is a few extra fences on weakly-ordered hardware. Go made the trade-off in favor of programmer sanity.

Here's a concrete example where SC matters:

```go
// Dekker-like flag synchronization (simplified)
var (
    flag1 atomic.Bool
    flag2 atomic.Bool
)

// Goroutine 1:
flag1.Store(true)
if !flag2.Load() {
    // enter critical section
}

// Goroutine 2:
flag2.Store(true)
if !flag1.Load() {
    // enter critical section
}
```

Under sequential consistency, at most one goroutine enters the critical section. Under pure acquire/release, both might enter — because there is no global order between `flag1.Store` and `flag2.Store`.

You don't need to write code like this in Go (use a mutex), but it's good to know your atomics are strong enough that it would work.

---

## Appendix C: Reading the Race Detector Output

A typical race detector report:

```
==================
WARNING: DATA RACE
Read at 0x00c0000200c8 by goroutine 8:
  main.consumer()
      /tmp/main.go:30 +0x44
  main.main.func2()
      /tmp/main.go:42 +0x58

Previous write at 0x00c0000200c8 by goroutine 7:
  main.producer()
      /tmp/main.go:22 +0x44
  main.main.func1()
      /tmp/main.go:38 +0x58

Goroutine 8 (running) created at:
  main.main()
      /tmp/main.go:40 +0x125

Goroutine 7 (finished) created at:
  main.main()
      /tmp/main.go:36 +0x9d
==================
```

What to read:

1. **Read at … by goroutine 8** — where the unsynchronized read happened.
2. **Previous write at … by goroutine 7** — the write the read is racing with.
3. **Goroutine N created at** — the stack where each goroutine was spawned, useful when racing accesses come from anonymous funcs.

The fix is always the same: add a happens-before edge between the write and the read. Usually that means switching one or both to `sync/atomic`, wrapping with a mutex, or routing through a channel.

If you fix one race and the detector reports another, you have not finished — every reported race is a real race. Fix them all before merging.

---

## Appendix D: Performance Numbers (Rough, 2025-era CPUs)

| Operation | Cost |
|-----------|------|
| Plain `int` write | ~0.5 ns |
| Plain `int` read | ~0.5 ns |
| `atomic.Int32.Load` (uncontended) | ~1–2 ns |
| `atomic.Int32.Store` (uncontended) | ~5–10 ns |
| `atomic.Int32.Add` (uncontended) | ~5–10 ns |
| `atomic.CompareAndSwap` (uncontended) | ~5–15 ns |
| `sync.Mutex.Lock`+`Unlock` (uncontended) | ~10–25 ns |
| `sync.RWMutex.RLock`+`RUnlock` (uncontended) | ~15–30 ns |
| `sync.Once.Do` (after first call) | ~1–2 ns |
| Channel send/recv (unbuffered) | ~100–300 ns |
| Channel send/recv (buffered, uncontended) | ~30–80 ns |

These numbers vary by CPU, by Go version, by contention level. Treat them as orders of magnitude, not promises. The lesson: atomics are roughly an order of magnitude cheaper than mutexes, which are roughly an order of magnitude cheaper than channels — but channels carry orders of magnitude more semantics. Pick the right tool, not the cheapest.

---

## Appendix E: Cross-Reference to the Rest of the Roadmap

- For more on goroutines: `01-goroutines/`.
- For more on channels: `04-channels/`.
- For mutexes: `06-sync-mutex/`.
- For `sync.WaitGroup`: `07-sync-waitgroup/`.
- For `sync.Once`: `08-sync-once/`.
- For `sync/atomic` deep dive: `09-sync-atomic/`.
- For the formal memory model: `21-memory-model-formal/`.
- For hardware fences (parent's first sibling): `22-memory-ordering-barriers/01-hardware-barriers/`.
- For sequential consistency (next sibling): `22-memory-ordering-barriers/03-sequential-consistency/`.

The acquire/release file you just read sits at the heart of this network. Almost every concurrency topic in Go has an "and here's why happens-before matters" sentence pointing back here.

---

## Final Word for the Junior

If you take away one sentence: **safe publication needs a release on the writer and an acquire on the reader, on the same synchronization location.**

That sentence is the entire job. Everything else — `sync.Once`, `atomic.Pointer`, mutexes, channels — is just convenient packaging for that contract.

Run the race detector. Reach for `sync.Once` and `atomic.Pointer[T]`. Don't roll your own publication out of plain variables. You're ready.

---

## Appendix F: Extra Worked Walkthroughs

### F.1 — Diagnosing a stale-read bug

A teammate reports: "I store the user count in `userCount` and read it in the metrics handler. Sometimes the metric is 0 even though we have users." Reading the code:

```go
var userCount int

func OnLogin() {
    userCount++
}

func MetricsHandler(w http.ResponseWriter, _ *http.Request) {
    fmt.Fprintf(w, "users=%d\n", userCount)
}
```

There are *two* bugs:

1. `userCount++` is not atomic. Two concurrent logins lose updates.
2. The read in `MetricsHandler` is unsynchronized with the writes. Even if you fix #1, the reader might see a stale value indefinitely.

Fix:

```go
var userCount atomic.Int64

func OnLogin() { userCount.Add(1) }

func MetricsHandler(w http.ResponseWriter, _ *http.Request) {
    fmt.Fprintf(w, "users=%d\n", userCount.Load())
}
```

Now `Add` is acq-rel (no lost updates), `Load` is acquire (sees the latest value the runtime can offer). Note: there's no producer/consumer pair here — just shared mutation. The acq-rel comes for free.

### F.2 — Diagnosing a flaky test

A test occasionally fails. The failing line is `got: 0, want: 42`. The setup:

```go
func TestFlaky(t *testing.T) {
    var result int
    done := make(chan bool)
    go func() {
        result = 42
        done <- true
    }()
    <-done
    if result != 42 {
        t.Errorf("got %d", result)
    }
}
```

Wait — this looks correct. The send happens after `result = 42`; the receive happens before the read. There *should* be a happens-before edge.

And there is — Go's memory model guarantees that a send on a channel happens-before the receive completes. The test should not fail.

What's going on? In this case, the test is correct. If it's flaky, look elsewhere: maybe a different goroutine is mutating `result`, or maybe the test is timing-sensitive in a way we haven't noticed.

Run `go test -race`. If the detector is silent, the bug isn't a publication bug.

### F.3 — Refactoring a mutex to atomics

A teammate writes:

```go
var (
    mu    sync.RWMutex
    flags map[string]bool
)

func IsEnabled(name string) bool {
    mu.RLock()
    defer mu.RUnlock()
    return flags[name]
}

func Enable(name string) {
    mu.Lock()
    defer mu.Unlock()
    if flags == nil {
        flags = map[string]bool{}
    }
    flags[name] = true
}
```

Reads dominate (millions per second), writes are rare (once per minute). Can we eliminate the read lock?

Yes — replace the map with an `atomic.Pointer[map[string]bool]`:

```go
var flags atomic.Pointer[map[string]bool]

func IsEnabled(name string) bool {
    m := flags.Load()
    if m == nil {
        return false
    }
    return (*m)[name]
}

func Enable(name string) {
    for {
        old := flags.Load()
        cp := map[string]bool{}
        if old != nil {
            for k, v := range *old {
                cp[k] = v
            }
        }
        cp[name] = true
        if flags.CompareAndSwap(old, &cp) {
            return
        }
    }
}
```

Reads are now lock-free; writes still serialize (via the CAS retry loop). For our workload, that's a huge win.

Important: this only works because we treat the map as **immutable after publication**. We never mutate `*m` after `Store`. Every "update" allocates a new map.

### F.4 — Why a single goroutine can still need atomics

Surprisingly, even single-goroutine code can need atomics if it interacts with the runtime's preemption or with a signal handler:

```go
var counter int32

func main() {
    // Signal handler set up elsewhere may read `counter`.
    for i := 0; i < 1e6; i++ {
        atomic.AddInt32(&counter, 1)
    }
}
```

Without the atomic, the signal handler might read a torn or stale value. With atomic, it sees a consistent count. This case is rare but real.

---

## Appendix G: A Glossary of "Synchronizes-With"

You'll see the phrase "synchronizes-with" in the Go memory model and other specs. Definitions:

- A **synchronizes-with** relation is an edge between a release and an acquire on the same memory location, where the acquire observed the released value.
- Synchronizes-with edges contribute to the **happens-before** order: if A synchronizes-with B, then A happens-before B.
- Multiple synchronizes-with edges *compose* — if A synchronizes-with B and B happens-before C, then A happens-before C.

This composition is why mutexes work: each lock-unlock pair is a sync-with edge, and the chain of sync-with edges through a sequence of critical sections builds up a total order.

---

## Appendix H: Practice Exercises (Pointer to tasks.md)

If you want to test what you learned, jump to `tasks.md` in this same folder. The exercises there start with "publish an integer flag" and work up to "implement a one-shot promise type." Solve them on paper, then in code, then with `-race`. You'll know you understood when the detector is silent and your code is short.

---

## Appendix I: A Note on Cross-Language Comparisons

If you're coming from C++, Java, Rust, or C#:

- **C++** has explicit `memory_order_acquire`, `memory_order_release`, `memory_order_seq_cst`. Go always uses seq-cst for atomics. You can't pick relaxed in Go.
- **Java** has `volatile` (which is acq-rel) and `synchronized` (which provides full barriers). Go's `sync/atomic` is closer to `AtomicX` in `java.util.concurrent.atomic`.
- **Rust** has `Ordering::Acquire`, `Ordering::Release`, `Ordering::SeqCst`. Same as C++. Rust forces you to think about ordering explicitly.
- **C#** has `Volatile.Read`/`Volatile.Write` (acq/rel) and `Interlocked` (seq-cst). Closer to Go.

Go intentionally hides the choice. Most Go programmers never need to think "do I want acquire or seq-cst here?" — they get seq-cst by default. This makes Go code simpler but on weakly-ordered hardware (ARM, RISC-V) slightly slower in tight atomic loops.

---

## Appendix J: When You Cannot Use Atomics

Some Go code intentionally avoids `sync/atomic`:

- **Code that runs in `go:nosplit` or `go:nowritebarrier` contexts** (deep in the runtime). Atomics there are calls into special runtime functions.
- **Code that must be reentrant from signal handlers** uses very limited atomic primitives.
- **Cgo-imported types** may not respect Go's memory model.

For 99.9% of Go code, none of this matters. Use `sync` and `sync/atomic` freely.

---

## Appendix K: Recapping the Six Primitives

In one table:

| Primitive | Release | Acquire | When to use |
|-----------|---------|---------|-------------|
| `sync.Mutex` | `Unlock` | `Lock` | General-purpose mutual exclusion |
| `sync.RWMutex` | `Unlock`/`RUnlock` | `Lock`/`RLock` | Read-mostly with occasional writes |
| `sync.Once` | end of `Do` body | every `Do` return | One-shot lazy init |
| `chan` send | `ch <- v` | `<-ch` | Pass values, signal events |
| `chan` close | `close(ch)` | `<-ch` (closed) | Broadcast a one-shot event |
| `sync/atomic` | `Store`/`CompareAndSwap` | `Load`/`CompareAndSwap` | Single-word lock-free |

Memorise this table. Most concurrency code you read or write will be some combination of rows.

---

## Appendix L: A Final Anti-Pattern Tour

### Anti-pattern: "I'll just use `runtime.Gosched()` to make sure the goroutine runs first."

```go
go func() { x = 1 }()
runtime.Gosched()
fmt.Println(x) // unsafe
```

`Gosched` is a hint to the scheduler — it does *not* establish happens-before. Use a channel, a `WaitGroup`, or an atomic.

### Anti-pattern: "I'll use `time.Sleep` to be sure."

```go
go func() { x = 1 }()
time.Sleep(10 * time.Millisecond)
fmt.Println(x) // unsafe
```

Sleep does not synchronize either. It just gives the scheduler more time. On a slow machine or under load, 10 ms may not be enough; on a fast machine, it's overkill. Use proper synchronization.

### Anti-pattern: "I'll lock around the read, but the write is fine without it."

```go
go func() { x = 1 }() // race

mu.Lock()
fmt.Println(x) // race partner is the unlocked write
mu.Unlock()
```

Both sides of a shared variable must agree on the synchronization. One-sided locking is a race.

### Anti-pattern: "atomic.Value for an immutable string."

```go
var s atomic.Value
s.Store("hello")
fmt.Println(s.Load().(string))
```

This works, but `atomic.Pointer[string]` (or even a regular global) is simpler if the string is set once at startup. Atomics carry runtime cost; don't reach for them if you don't need concurrent updates.

### Anti-pattern: passing a `*T` over a channel and then mutating `*T` in the sender.

```go
ch := make(chan *Job)
go func() {
    job := &Job{Status: "pending"}
    ch <- job
    job.Status = "done" // RACE with receiver reading Status
}()

j := <-ch
fmt.Println(j.Status)
```

The send publishes the *pointer* — but the sender still holds the same pointer. Mutating after the send races with the receiver. Either send a copy by value, or treat the sent pointer as no-longer-yours.

---

## Appendix M: Wrap-Up Quiz

1. Producer writes `x = 5` then `atomic.StoreInt32(&flag, 1)`. Consumer reads `atomic.LoadInt32(&flag) == 1` then `y := x`. Is `y == 5` guaranteed? **Yes.**
2. Producer writes `atomic.StoreInt32(&flag, 1)` then `x = 5`. Consumer reads `atomic.LoadInt32(&flag) == 1` then `y := x`. Is `y == 5` guaranteed? **No.**
3. Producer writes `x = 5` then `flag = 1` (plain bool). Consumer reads `if flag == 1 then y := x`. Is `y == 5` guaranteed? **No.** (Data race.)
4. Producer writes `x = 5` then sends `ch <- struct{}{}`. Consumer receives `<-ch` then reads `y := x`. Is `y == 5` guaranteed? **Yes.**
5. Producer is inside `once.Do(f)`. `f` writes `x = 5`. Consumer also calls `once.Do(f)` (after producer's `Do` returned on producer's goroutine) and then reads `y := x`. Is `y == 5` guaranteed? **Yes.**

If you got 4/5 or better, you're solid for the middle level. If not, re-read the Core Concepts and Common Mistakes sections.

---

## Appendix N: Deeper Examples Around Each Primitive

### N.1 — `sync.WaitGroup` as a publication mechanism

`sync.WaitGroup` is usually thought of as "wait for N goroutines." But it's also a publication primitive:

```go
var wg sync.WaitGroup
var result int

wg.Add(1)
go func() {
    defer wg.Done()
    result = compute()
}()
wg.Wait()
fmt.Println(result) // safe: Done is a release, Wait is an acquire
```

Every `Done` call is a release of the goroutine's writes. `Wait` is an acquire that returns only after all goroutines have called `Done`. Therefore, any write made before `Done` is visible after `Wait` returns.

This is heavily used in tests: spawn helpers, write to shared state, `Wait`, then assert.

### N.2 — `sync.Cond` and condition variables

```go
var (
    mu     sync.Mutex
    cond   = sync.NewCond(&mu)
    ready  bool
    result int
)

// Producer:
go func() {
    mu.Lock()
    result = compute()
    ready = true
    cond.Broadcast()
    mu.Unlock()
}()

// Consumer:
mu.Lock()
for !ready {
    cond.Wait()
}
r := result
mu.Unlock()
fmt.Println(r)
```

`cond.Wait` releases the mutex and blocks until `Signal` or `Broadcast` is called, then re-acquires the mutex. The mutex provides the acquire/release; `Cond` just adds an efficient "wake me up" mechanism on top.

You rarely need `sync.Cond` in modern Go — channels usually express the same pattern more clearly.

### N.3 — `context.Context` and cancellation publication

```go
ctx, cancel := context.WithCancel(parent)

go func() {
    work(ctx)
}()

go func() {
    time.Sleep(time.Second)
    cancel() // closes ctx.Done()
}()
```

`cancel()` closes the internal channel exposed by `ctx.Done()`. Any goroutine doing `<-ctx.Done()` synchronizes with the cancel. Writes made before the cancel are visible to anyone who observed `ctx.Err() != nil`.

This is why returning early on `ctx.Done()` is safe — the cancellation is published with happens-before semantics.

### N.4 — A bytes-Buffer publication trap

```go
var buf bytes.Buffer

go func() {
    buf.WriteString("hello")
}()
go func() {
    fmt.Println(buf.String())
}()
```

`bytes.Buffer` is *not* safe for concurrent use. Both goroutines mutate internal state. To safely share, wrap with a mutex:

```go
type SafeBuf struct {
    mu  sync.Mutex
    buf bytes.Buffer
}

func (s *SafeBuf) Write(p []byte) (int, error) {
    s.mu.Lock()
    defer s.mu.Unlock()
    return s.buf.Write(p)
}

func (s *SafeBuf) String() string {
    s.mu.Lock()
    defer s.mu.Unlock()
    return s.buf.String()
}
```

The mutex provides acquire/release around every operation. Without it, both threads race on the buffer's internal slice.

### N.5 — A short publication is still a publication

It might be tempting to think "I'm only publishing one bool, the CPU can't tear that, why bother with atomic?"

The CPU may not tear, but:

1. The compiler may hoist the read outside a loop.
2. The compiler may dead-code-eliminate the write.
3. The hardware may delay the write becoming visible indefinitely.
4. The race detector will flag it.

All four are sufficient reasons to use `atomic.Bool` or `sync.Mutex`.

---

## Appendix O: Read the Source

The actual implementations of `sync` and `sync/atomic` in the Go runtime are educational reading:

- `src/sync/once.go` — about 80 lines. Notice the fast path: an atomic Load of `done`, no mutex if already done.
- `src/sync/mutex.go` — about 250 lines. The unlocked fast path is a single CAS; the slow path handles contention.
- `src/sync/atomic/doc.go` — describes the package's contract. The actual implementations are in assembly per architecture.
- `src/runtime/atomic_*.go` and `src/runtime/internal/atomic/` — the per-architecture atomic operations.

Reading the assembly is instructive: on x86, an `atomic.Store` compiles to `XCHG` (which is an implicit `LOCK`); on ARM, it requires explicit `DMB` (data memory barrier) instructions. The Go runtime hides these architectural details from you.

---

## Appendix P: One Last Mental Model

Think of acquire/release as a *one-way mirror* between goroutines:

- **Without** synchronization, each goroutine sees its own private snapshot. The mirror is opaque — neither side knows what the other is doing.
- **Release** flips one side of the mirror to "transparent" — but only outgoing. The releasing goroutine publishes its writes.
- **Acquire** flips the other side to "transparent — incoming." The acquiring goroutine sees the published writes.
- Both sides must be flipped at *the same location* for the mirror to be useful.

Once you have this image, the rest of acquire/release theory follows naturally.

---

That concludes the junior file. Continue to `middle.md` for publication patterns at scale, or `tasks.md` to practice.

---

## Appendix Q: Drill — Build a Safe Publish/Subscribe

Build a `Latch[T any]` type. Specification:

- `Set(v T)` — call exactly once; second call is a no-op.
- `Get(ctx context.Context) (T, error)` — block until `Set` has been called or `ctx` is canceled.
- Multiple goroutines may call `Get` concurrently; all should see the same `v`.

Solution outline:

```go
type Latch[T any] struct {
    done chan struct{}
    val  T
    once sync.Once
}

func NewLatch[T any]() *Latch[T] {
    return &Latch[T]{done: make(chan struct{})}
}

func (l *Latch[T]) Set(v T) {
    l.once.Do(func() {
        l.val = v
        close(l.done)
    })
}

func (l *Latch[T]) Get(ctx context.Context) (T, error) {
    select {
    case <-l.done:
        return l.val, nil
    case <-ctx.Done():
        var zero T
        return zero, ctx.Err()
    }
}
```

Why is reading `l.val` safe without an atomic? Because:

1. `Set` writes `l.val` *before* `close(l.done)`.
2. `close` is a release on `l.done`.
3. `<-l.done` is an acquire.
4. Therefore the write to `l.val` happens-before the read.

`sync.Once` ensures that even if many goroutines race to call `Set`, only one wins and one write happens. The channel close publishes the result.

This is the kind of code you should be able to write fluently after reading this file.

---

## Appendix R: Drill — Fix a Broken Counter

Given this broken code:

```go
var count int

func Inc()       { count++ }
func Snapshot() int { return count }
```

Run with `-race`, observe failures, then fix.

Solutions, ranked by overhead:

1. `atomic.Int64`: best for simple counts.
2. `sync.Mutex` around both methods: best if you need additional invariants (e.g., counter never exceeds N).
3. Per-goroutine sharded counters with a "sum" function: best for write-heavy workloads on many cores.

Pick (1) unless you have a reason for (2) or (3).

---

## Appendix S: Drill — Implement Lazy Init Three Ways

Implement a singleton that computes its value lazily, three ways:

**Way 1: `sync.Once`.**

```go
var (
    once     sync.Once
    instance *Service
)

func Get() *Service {
    once.Do(func() { instance = newService() })
    return instance
}
```

**Way 2: `sync.OnceValue` (Go 1.21+).**

```go
var Get = sync.OnceValue(newService)
```

**Way 3: Double-checked load with `atomic.Pointer`.**

```go
var instance atomic.Pointer[Service]
var mu sync.Mutex

func Get() *Service {
    if s := instance.Load(); s != nil {
        return s
    }
    mu.Lock()
    defer mu.Unlock()
    if s := instance.Load(); s != nil {
        return s
    }
    s := newService()
    instance.Store(s)
    return s
}
```

Way 3 is the classic *double-checked locking* pattern, which only works because `instance.Load` and `instance.Store` are atomic with acquire/release semantics. Way 1 is recommended for clarity; way 3 is interesting because it shows the building blocks underneath `sync.Once`.

We'll explore why way 3 is correct (and the famous Java bug that motivated its careful design) in `senior.md`.

---

## Appendix T: Wrap-Up Reading List

Before moving on, you should be able to point at any line of these references and explain it:

- The "Synchronization" section of https://go.dev/ref/mem.
- The doc comment of `sync.Once` in the stdlib source.
- The doc comment of `atomic.Pointer` in the stdlib source.
- The "Race Detector" section of the Go blog.
- Russ Cox's "Hardware Memory Models" (read it twice).

When those feel comfortable, jump to middle.md. There we start building real services.

---

End of junior.md. Total: a ~3000-line tour from "why publication is hard" to "how Go solves it for you, six different ways." Take your time, run the examples, and remember the one sentence:

**Safe publication needs a release on the writer and an acquire on the reader, on the same synchronization location.**

---

## Appendix U: Real Bugs from the Wild

The following are simplified versions of real production bugs reported against open-source Go projects. Names and identifiers are changed.

### U.1 — A leaked goroutine because of a missed publication

```go
var stopFlag bool

func worker() {
    for !stopFlag {
        doWork()
    }
}

func Stop() {
    stopFlag = true
}
```

The worker never sees `stopFlag = true` because:

1. The compiler hoists the read out of the loop (the variable looks loop-invariant).
2. No happens-before edge between the write and the read.

Fix: use `atomic.Bool` for `stopFlag`. The worker checks `stopFlag.Load()` on every iteration; `Stop` calls `stopFlag.Store(true)`.

This was a real bug that took a team three days to diagnose, because under the race detector the code happens to be re-loaded every iteration and works fine, whereas in optimised production builds the loop is hoisted and never terminates.

### U.2 — A cache that lost updates under concurrent writers

```go
type Cache struct {
    data map[string]string
}

func (c *Cache) Set(k, v string) { c.data[k] = v }
func (c *Cache) Get(k string) string { return c.data[k] }
```

Two writers concurrently triggering map growth caused random crashes ("concurrent map writes" panic). Even read-then-write races on the same key caused lost updates.

Fix: protect with `sync.RWMutex`, or use `sync.Map`, or use an `atomic.Pointer[map[string]string]` with copy-on-write.

### U.3 — A "double-free" of resources

```go
type Conn struct{ closed bool }

func (c *Conn) Close() {
    if !c.closed {
        c.closed = true
        c.release()
    }
}
```

Two goroutines calling `Close` concurrently both observed `closed == false`, both ran `release()`, double-freeing the underlying resource.

Fix: use `atomic.Bool` and `CompareAndSwap`:

```go
type Conn struct{ closed atomic.Bool }

func (c *Conn) Close() {
    if c.closed.CompareAndSwap(false, true) {
        c.release()
    }
}
```

The CAS atomically tests-and-sets; only one caller wins.

### U.4 — Confused snapshots

```go
type Stats struct{ Reqs, Errs int }

var s Stats

func IncReq() { s.Reqs++ }
func IncErr() { s.Errs++ }

func Snapshot() (int, int) { return s.Reqs, s.Errs }
```

The metrics endpoint reports nonsensical pairs (Reqs=100, Errs=2 in one read, Reqs=50, Errs=4 in the next — the counter went *down*?). Because reads are not atomic, and not coordinated with writes, snapshots can mix old and new values.

Fix: use two `atomic.Int64`s. Each operation is atomic; readers get *some* moment's snapshot. Or wrap with a mutex if you need strict pair consistency.

### U.5 — A logger initialised twice

```go
var logger *Logger

func GetLogger() *Logger {
    if logger == nil {
        logger = newLogger()
    }
    return logger
}
```

Two goroutines called `GetLogger` at the same time; both saw `nil`; both created a logger; the loser's logger was orphaned, leaking the file handle it had opened.

Fix: `sync.Once`. (Or `sync.OnceValue` in modern Go.)

These five bugs are textbook examples of what acquire/release prevents. Memorise them — you'll see variants in every codebase.

---

That truly concludes the junior file. Go forth and publish safely.

---

## Appendix V: Quick Reference Card (Printable)

```
+----------------------------------------------------------------+
| ACQUIRE/RELEASE QUICK REFERENCE — Go                           |
+----------------------------------------------------------------+
| Release operations:                                            |
|   atomic.StoreXxx(&v, val)                                     |
|   atomic.AddXxx(&v, delta)        (also acquire)               |
|   atomic.CompareAndSwapXxx(...)   (also acquire)               |
|   atomic.SwapXxx(...)             (also acquire)               |
|   mu.Unlock()                                                  |
|   rwmu.Unlock(), rwmu.RUnlock()                                |
|   ch <- v                                                      |
|   close(ch)                                                    |
|   wg.Done()                                                    |
|                                                                |
| Acquire operations:                                            |
|   atomic.LoadXxx(&v)                                           |
|   (the RMW operations above)                                   |
|   mu.Lock()                                                    |
|   rwmu.Lock(), rwmu.RLock()                                    |
|   <-ch                                                         |
|   wg.Wait()                                                    |
|                                                                |
| Combined (both R and A):                                       |
|   sync.Once.Do(f)                                              |
|                                                                |
| Tests:                                                         |
|   go test -race ./...                                          |
|                                                                |
| Idioms:                                                        |
|   atomic.Pointer[T]   — one-shot or read-mostly publication    |
|   sync.Once           — lazy init                              |
|   sync.OnceValue      — lazy init returning a value (Go 1.21+) |
|   close(chan)         — broadcast a one-shot event             |
+----------------------------------------------------------------+
```

Save this. Look at it the next time you write a publication.

End of file.








```
                  + ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ +
                  │  producer goroutine  │
                  + ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ +
   plain writes:  │  cfg.URL = "..."     │
                  │  cfg.Port = 8080     │
   ===============│======================│ <- release barrier
   release op:    │  atomic.Store(...)   │
                  + ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ +
                       │   visible
                       v
                  + ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ +
   acquire op:    │  atomic.Load(...)    │
   ===============│======================│ <- acquire barrier
   plain reads:   │  fmt.Println(p.URL)  │
                  │  fmt.Println(p.Port) │
                  + ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ +
                  │  consumer goroutine  │
                  + ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ +
```

The vertical lines are the *barriers*. Code cannot move across them. Writes above the release are visible to anyone who observes the release. Reads below the acquire see those writes.
