---
layout: default
title: Junior
parent: Copy-on-Write
grand_parent: Concurrent Data Structures
ancestor: Go
nav_order: 2
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/21-concurrent-data-structures/05-copy-on-write/junior/
---

# Copy-on-Write — Junior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Real-World Analogies](#real-world-analogies)
6. [Mental Models](#mental-models)
7. [Pros and Cons](#pros-and-cons)
8. [Use Cases](#use-cases)
9. [Code Examples](#code-examples)
10. [Coding Patterns](#coding-patterns)
11. [Clean Code](#clean-code)
12. [Product Use / Feature](#product-use--feature)
13. [Error Handling](#error-handling)
14. [Security Considerations](#security-considerations)
15. [Performance Tips](#performance-tips)
16. [Best Practices](#best-practices)
17. [Edge Cases and Pitfalls](#edge-cases-and-pitfalls)
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
29. [Diagrams and Visual Aids](#diagrams-and-visual-aids)

---

## Introduction
> Focus: "What does *copy-on-write* mean? How do I read a value safely without a lock? What is `atomic.Value` and what is `atomic.Pointer`?"

A **copy-on-write data structure** is a way of sharing data between many goroutines where readers never wait and writers never mutate the data the readers can see. Instead, a writer that wants to change the data **copies it**, modifies the copy, and then **atomically swaps a single pointer** so future readers see the new version. Any reader already mid-flight on the old version simply keeps going — its memory is still there and still consistent.

That is the entire idea in one sentence: *don't change what others can see; build a new version and swap the pointer*.

```go
// The whole pattern in 12 lines:
var cfg atomic.Pointer[Config]

cfg.Store(loadInitial())          // publish the first snapshot

// Reader (any number, no lock):
c := cfg.Load()
useConfig(c)

// Writer (one at a time, possibly with a mutex):
newC := *cfg.Load()               // copy
newC.LogLevel = "debug"           // mutate the copy
cfg.Store(&newC)                  // publish
```

Two things make this pattern special and worth learning carefully:

1. **Reads cost almost nothing.** A reader executes exactly one atomic load — about 1–2 ns on modern x86, plus a non-atomic traversal of an immutable structure. No mutex, no contention, no waiting for a writer.
2. **Writers do not block readers, ever.** No reader can ever observe a "torn" or "half-written" state because no reader ever sees mutable memory.

After reading this file you will:

- Know the difference between *mutating in place* and *copying-then-publishing*
- Know what an immutable snapshot is and why it makes locking unnecessary
- Be able to use `sync/atomic.Value` and `sync/atomic.Pointer[T]`
- Recognise the most common first-time bug — mutating a snapshot after publishing it
- Know why a single writer (or a writer mutex) is still required
- Have a feel for the simplest COW use cases: configuration, feature flags, routing tables
- Be able to read a basic COW implementation and explain what each line does

You do not need to know about RCU, persistent data structures, structural sharing, or the Go memory model in formal detail yet. Those come at the middle, senior, and professional levels. This file is about the moment you write `atomic.Pointer[T]`, store a snapshot, and a thousand readers race to load it safely.

---

## Prerequisites

- **Required:** A Go installation, version 1.19 or newer (1.21+ recommended), because `atomic.Pointer[T]` is the modern API. Check with `go version`.
- **Required:** Comfort with goroutines and the `go` keyword. You should already know that `go f()` runs concurrently and that the main goroutine exiting kills the program.
- **Required:** A working understanding of pointers in Go — `*T`, `&x`, and the difference between value semantics and pointer semantics.
- **Helpful:** Some prior experience with `sync.Mutex` and `sync.RWMutex`. Not required, but you will appreciate COW more if you have written code that locks reads.
- **Helpful:** Awareness that struct assignment in Go (`a = b`) copies the struct by value. We rely on this for snapshotting.

If you can write a struct, take its address, pass `*T` to a function, and spawn a goroutine, you have everything you need.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Copy-on-write (COW)** | A concurrency strategy where any modification to a shared structure produces a new copy; the old copy is left untouched for in-flight readers. |
| **Snapshot** | A single immutable version of the data, identified by a pointer. Once published, a snapshot is never mutated. |
| **Atomic pointer swap** | Replacing the current snapshot pointer with a new one using a single hardware-level atomic operation, so no reader can ever see a half-written pointer. |
| **`sync/atomic.Value`** | Pre-generics container (Go 1.4+) for atomically storing and loading any single value. Type-checked at runtime: all `Store` calls must use the same concrete dynamic type. |
| **`sync/atomic.Pointer[T]`** | Typed atomic pointer container (Go 1.19+). Compile-time type-safe, no `interface{}` boxing, the modern recommendation. |
| **`Load`** | Atomic read of the current snapshot pointer. Cheap (1–2 ns), wait-free, lock-free. |
| **`Store`** | Atomic write of a new snapshot pointer, replacing the previous one. |
| **`CompareAndSwap` (CAS)** | Atomic "swap if still equal to expected" operation. The foundation of writer coordination without a mutex. |
| **Immutable** | A property of a value: once published, no field of it (transitively) is ever written. |
| **Wait-free read** | A read operation that completes in a bounded number of steps regardless of what any other goroutine is doing. COW reads are wait-free. |
| **Writer lock** | A `sync.Mutex` held only by writers, never by readers. Serializes the read-copy-publish dance to prevent lost updates. |
| **RCU (read-copy-update)** | A discipline pioneered by the Linux kernel: read with no lock, copy on update, defer freeing until all readers are gone. COW is the Go-flavoured cousin. |
| **Persistent data structure** | A data structure that preserves previous versions of itself when modified. The "functional" or "immutable" cousin of COW. |
| **Structural sharing** | Persisting only the changed branches of a tree-like structure and sharing the rest with the previous version. The trick that makes persistent structures cheap. |
| **Lost update** | A bug where two writers each copy the snapshot, each modify their copy, and the later publish overwrites the earlier one. |
| **Snapshot leak** | A bug where a reader keeps a long-lived reference to an old snapshot, preventing the GC from reclaiming it. |

---

## Core Concepts

### Concept 1: A snapshot is just a pointer to immutable data

The unit of currency in COW is a **snapshot**. A snapshot is a pointer to a fully-formed, never-again-mutated piece of data. Everyone agrees: *if you have this pointer, you can read the data without any locking, because nobody will ever change it*.

```go
type Config struct {
    LogLevel string
    Timeout  time.Duration
    Hosts    []string
}

var current atomic.Pointer[Config]

// publish the first snapshot
current.Store(&Config{
    LogLevel: "info",
    Timeout:  5 * time.Second,
    Hosts:    []string{"a.example.com", "b.example.com"},
})
```

After `Store`, any goroutine that calls `current.Load()` will get back a `*Config` it can dereference and use freely. There is no mutex. There is no waiting. There is nothing to "release" when the reader is done. The reader simply uses the pointer and lets it go out of scope.

The hard constraint is this: **once a `*Config` has been passed to `Store`, no goroutine ever writes to `*c` for that `c`**. Not the field `LogLevel`, not the slice `Hosts`, nothing. If you want to "change the configuration", you build a *new* `Config`, copy whatever is unchanged, modify what is changed, and `Store` the new one.

### Concept 2: The writer copies, mutates, and publishes

Updating a COW structure is a three-step ritual:

1. **Load** the current snapshot pointer.
2. **Copy** the snapshot into a fresh value you own exclusively.
3. **Mutate** the copy, then **Store** the new pointer.

```go
old := current.Load()      // step 1: get a pointer to the current snapshot
next := *old               // step 2: copy the struct by value
next.LogLevel = "debug"    // step 3a: mutate the copy
current.Store(&next)       // step 3b: publish
```

Notice that step 2 does a *shallow* copy. The new `next.Hosts` and `old.Hosts` are the same backing array. That is fine as long as we never modify `next.Hosts[i]`. If we want to change the host list, we must allocate a new slice — *we must not append in place*.

```go
old := current.Load()
next := *old
next.Hosts = append([]string{}, old.Hosts...)  // fresh backing array
next.Hosts = append(next.Hosts, "c.example.com")
current.Store(&next)
```

This is the second hard constraint: **shallow copy is only safe if every field is either a primitive or never mutated downstream**. Slices, maps, and pointers inside the struct need explicit copying if you intend to change them.

### Concept 3: Readers never wait

The whole point of COW is that the reader path is:

```go
c := current.Load()       // ~1.5 ns
useTimeout(c.Timeout)
for _, h := range c.Hosts {
    dial(h)
}
```

There is no `RLock`. There is no waiting for a writer. There is no risk of being starved by a writer that holds the lock for a long time. Even if a writer is in the middle of building a 100 MB snapshot, the reader proceeds at full speed on the old snapshot.

Compare to `sync.RWMutex`:

```go
mu.RLock()                // 5–20 ns, plus contention with writers
useTimeout(cfg.Timeout)
mu.RUnlock()              // 5–20 ns
```

The RWMutex version is more familiar but pays an atomic cost on every read *and* may block if a writer is currently waiting (Go's RWMutex is writer-preferring to avoid writer starvation). COW pays one atomic load and that is it.

### Concept 4: Writers must coordinate with each other

Two writers, no coordination, both trying to add a host to the config:

```go
// goroutine A
oldA := current.Load()
nextA := *oldA
nextA.Hosts = append([]string{}, oldA.Hosts..., "a.com")
current.Store(&nextA)

// goroutine B, interleaved
oldB := current.Load()         // might load *oldA*, missing nextA
nextB := *oldB
nextB.Hosts = append([]string{}, oldB.Hosts..., "b.com")
current.Store(&nextB)          // overwrites A's snapshot!
```

If A and B run concurrently and both see the same `current`, B will overwrite A's change. This is a **lost update**. The fix is one of:

- **Writer mutex.** Hold a `sync.Mutex` for the duration of the load-copy-publish dance. Readers do not touch this mutex.
- **CAS loop.** Use `CompareAndSwap`; retry if another writer interleaved.

The mutex is the simpler default. The CAS loop is appropriate when writers may starve each other or when no writer is allowed to block on another writer.

```go
var writeMu sync.Mutex

func AddHost(h string) {
    writeMu.Lock()
    defer writeMu.Unlock()
    old := current.Load()
    next := *old
    next.Hosts = append([]string{}, old.Hosts...)
    next.Hosts = append(next.Hosts, h)
    current.Store(&next)
}
```

Readers never touch `writeMu`. Reads remain wait-free.

### Concept 5: Old snapshots are reclaimed by the garbage collector

In C or C++, the hard part of COW is reclaiming the old snapshot — you cannot free it while readers are still walking it. The Linux kernel's RCU machinery exists almost entirely to solve this problem.

In Go, the garbage collector solves it for free. The moment the last reader's local variable holding the old `*Config` goes out of scope, no reachable pointer points to the old snapshot, and the GC reclaims it on the next cycle. You do not call `free`. You do not maintain a generation counter. You simply let Go's reachability analysis do its job.

This is the single biggest reason COW is so easy in Go and so hard in C.

### Concept 6: `atomic.Value` vs `atomic.Pointer[T]`

Go has two tools for atomic pointer swap:

| Tool | Since | Type-safe? | Boxing? | Use when |
|------|-------|------------|---------|----------|
| `sync/atomic.Value` | Go 1.4 | Runtime only | Yes (interface) | Pre-1.19 codebases; rarely a good choice today |
| `sync/atomic.Pointer[T]` | Go 1.19 | Compile-time | No | Everything new |

`atomic.Value` stores an `interface{}` and enforces "the dynamic type of every `Store` must match the first one" at runtime. If you mix types, it panics:

```go
var v atomic.Value
v.Store(&Config{...})       // OK
v.Store("hello")            // panic: store of inconsistently typed value
```

`atomic.Pointer[T]` is generic and stores `*T` directly with no boxing:

```go
var p atomic.Pointer[Config]
p.Store(&Config{...})       // OK
// p.Store("hello")          // does not compile
```

For new code on Go 1.19+, prefer `atomic.Pointer[T]`. The remainder of this file uses it. We will show `atomic.Value` once, in passing, so you can read older codebases.

---

## Real-World Analogies

### Analogy 1: A printed magazine

A magazine publisher prints an issue every month. Once an issue is printed, no word in it ever changes. Subscribers read whichever issue they have on their coffee table. When a new issue arrives, they switch to it on their own schedule — nobody yanks the old magazine out of their hands.

The "current issue" pointer is at the publisher's front desk; updating it is a single act ("now we ship issue 42, not issue 41"). The previous issue still exists on every reader's coffee table; it is reclaimed when they choose to throw it away.

This is COW. The magazine is the snapshot. The publisher is the writer. The front-desk pointer is `atomic.Pointer[Issue]`. The reader's coffee table is their stack-local copy of the pointer.

### Analogy 2: A live-streamed sports scoreboard

A stadium has a giant scoreboard. The scoreboard never displays a "torn" score — you never see "1-" with the second digit missing. Behind the scenes, a technician prepares the next display in a hidden buffer, then flips a single switch that swaps the buffer with the live one.

Spectators (readers) just look at the board. The technician (writer) prepares off-screen and publishes atomically.

### Analogy 3: A Git branch and `git checkout`

In Git, the file `.git/HEAD` is a single line of text containing the name of the current branch. To "change the state of your working tree", Git builds the new state in `.git/objects/...`, computes a new commit hash, and rewrites `HEAD` to point at it. No one is ever looking at a half-built commit because commits become reachable only when `HEAD` is updated.

That last update — overwriting `HEAD` — is the atomic pointer swap. The old commit is still reachable via reflog and is garbage-collected later.

### Analogy 4: Hotel room key cards

When you check into a hotel, the room's lock is reprogrammed with a new key code. The old code is invalidated, but anyone already inside the room is not magically locked out — they simply cannot re-enter once they leave. New guests get the new key.

The "valid code" is the atomic pointer. Reprogramming is the `Store`. Current occupants are in-flight readers on the old snapshot.

### Analogy 5: An online menu

A restaurant publishes its menu as a PDF on its website. Customers download the PDF and order from it. When the chef changes a price, the website is updated with a new PDF; the URL is the same but the content is different. A customer holding yesterday's PDF can still read it — the file on their device has not been altered.

If the chef updates the menu while you are reading, you do not see flickering prices. You see your snapshot until you refresh.

---

## Mental Models

### Model 1: "Read the pointer; trust the data"

Every reader's job is:

1. Load the pointer.
2. Use the data.
3. Forget.

There is no "I'm done, please release". The reader's local variable goes out of scope and the GC takes care of the rest.

### Model 2: "Build it; publish it; forget the old one"

Every writer's job is:

1. Build a complete new snapshot.
2. Atomically install it.
3. Forget the old one.

The "build" step may be expensive. The "publish" step is always one atomic instruction. The "forget" step is automatic — the moment you overwrite the pointer, nobody can reach the old snapshot through the pointer, and the GC eventually reclaims it.

### Model 3: "The pointer is the only mutable thing"

Imagine drawing a circle around the `atomic.Pointer[T]`. Everything inside the circle is mutable (one word, atomically). Everything outside the circle — the snapshot it points to — is forever immutable. This division is the cognitive heart of COW. Once you internalize it, every bug becomes "I broke the outside-the-circle rule" — I mutated a snapshot after publishing, I shared a slice header by accident, I forgot to copy the inner map.

### Model 4: "Versions march forward; readers walk at their own pace"

Think of time as a line. The pointer always advances to the latest version. Each reader, the moment it loads, attaches itself to whatever version is current. It walks that version at its own pace. Later versions exist; the reader does not care. Earlier versions still exist as long as someone is walking them; the GC sweeps them up later.

### Model 5: "COW is the inverse of a lock"

A lock says: "only one of you may touch the data; the rest of you wait." COW says: "all of you may touch the data; only one of you may touch the pointer." The locked region moves from the data itself to a single word of memory.

---

## Pros and Cons

### Pros

- **Wait-free reads.** One atomic load per read. No contention, no spinning, no priority inversion.
- **Reads scale linearly with cores.** A 64-core machine can do 64 reads in parallel with zero coordination cost — the cache line is in shared mode and never invalidated by readers.
- **No reader-writer interference.** Even a 1-second writer cannot stall any reader by even a single nanosecond.
- **Snapshot consistency for free.** Any reader sees a complete, consistent snapshot for the entire duration of its work. Multi-key reads do not need a transaction.
- **GC handles cleanup.** No manual memory management. No epoch-based reclamation. No hazard pointers. Just let go of the pointer.
- **Implementation simplicity.** Three lines of code: load, copy, store. Compared to a fine-grained-locked structure, COW is trivially correct.

### Cons

- **Writes are expensive.** Every write copies the entire structure (or, with structural sharing, a path of it). For a 10 MB map, every write is a 10 MB allocation.
- **GC pressure.** Each write produces garbage. High write rates can stall the GC.
- **Worse cache behavior on writes.** A 10 MB rebuild blows the L2 cache.
- **Read-after-write latency.** A reader that loads just *before* a `Store` sees the old snapshot. There is no "fresh read" — by definition you are reading a snapshot, not the live state.
- **Lost updates without writer coordination.** Two concurrent writers race; one loses unless you have a mutex or CAS loop.
- **Memory amplification.** During a long-running read, the old snapshot is pinned in memory. If many readers each pin a different snapshot, you can hold N versions simultaneously.
- **Not suitable for fine-grained mutation.** Incrementing a counter via COW is absurd — copy a struct to flip one int? Use `atomic.Int64` or a mutex.

### Trade-off summary

> COW trades **write cost** and **memory pressure** for **wait-free reads** and **simplicity**. It is the right trade when read traffic dominates and the per-write cost is acceptable.

---

## Use Cases

### Use case 1: Application configuration

You load a config from a YAML or JSON file at startup. Operators may issue a `SIGHUP` to reload it. Reads happen on every request — thousands per second. Reloads happen once an hour.

This is the textbook COW use case. The config is small (kilobytes), reads dominate (millions per write), and snapshot consistency is essential — you do not want a request to see "new timeout, old logging level."

### Use case 2: Feature flags

A web server consults a feature-flag table on every request. The flags are updated by an operator dashboard a few times per day. Reads are wait-free; writes are infrequent and tolerable.

### Use case 3: DNS / service discovery cache

A microservice client caches the result of a service-discovery lookup. The result is consulted before every outbound request. A background goroutine refreshes the cache every 30 seconds by publishing a new snapshot.

### Use case 4: Routing tables

A reverse proxy maps URL prefixes to backends. Routes change with new deployments; matches happen on every request. The route table is built off-line and atomically published.

### Use case 5: Static reference data

Lookup tables, country codes, currency conversion rates, IP geolocation databases. Loaded once, possibly refreshed periodically, read constantly.

### Use case 6: `crypto/tls.Config` and `http.ServeMux`

These standard-library types use a snapshot pattern internally so that a server can reload its TLS certs or re-register routes without taking the server down.

### Use case 7: Metric registries (`expvar`, Prometheus)

Adding a new metric is rare; reading the registry to scrape values is constant. COW gives lock-free scrapes.

### Anti-use case: a counter

```go
// Don't do this:
var counter atomic.Pointer[int]
for {
    old := counter.Load()
    n := *old + 1
    counter.Store(&n)         // allocates an int per increment!
}
```

Use `atomic.Int64` or `atomic.AddInt64`. COW pays a heap allocation per write; for a single integer that is hilariously wasteful.

### Anti-use case: a high-throughput write cache

A cache that ingests 10 000 puts per second is the opposite of read-mostly. Use `sync.Map` or a sharded mutex map.

---

## Code Examples

### Example 1: A minimal COW config with `atomic.Pointer[T]`

```go
package main

import (
	"fmt"
	"sync"
	"sync/atomic"
	"time"
)

type Config struct {
	LogLevel string
	Timeout  time.Duration
	Hosts    []string
}

var (
	cfg     atomic.Pointer[Config]
	writeMu sync.Mutex // serialises writers; readers never touch it
)

func init() {
	cfg.Store(&Config{
		LogLevel: "info",
		Timeout:  5 * time.Second,
		Hosts:    []string{"a.example.com"},
	})
}

// Reader: wait-free, no lock.
func CurrentConfig() *Config {
	return cfg.Load()
}

// Writer: under writeMu. Builds a new snapshot, publishes it.
func SetLogLevel(level string) {
	writeMu.Lock()
	defer writeMu.Unlock()
	old := cfg.Load()
	next := *old // shallow copy of the struct
	next.LogLevel = level
	cfg.Store(&next)
}

// Writer that touches a slice: must copy the slice too.
func AddHost(h string) {
	writeMu.Lock()
	defer writeMu.Unlock()
	old := cfg.Load()
	next := *old
	next.Hosts = append([]string{}, old.Hosts...) // fresh backing array
	next.Hosts = append(next.Hosts, h)
	cfg.Store(&next)
}

func main() {
	go func() {
		for i := 0; i < 5; i++ {
			AddHost(fmt.Sprintf("host-%d.example.com", i))
			time.Sleep(10 * time.Millisecond)
		}
	}()
	for i := 0; i < 8; i++ {
		go func(id int) {
			for j := 0; j < 5; j++ {
				c := CurrentConfig()
				fmt.Printf("reader %d sees %d hosts\n", id, len(c.Hosts))
				time.Sleep(5 * time.Millisecond)
			}
		}(i)
	}
	time.Sleep(200 * time.Millisecond)
}
```

Key points:

- One `writeMu` for writers, no lock for readers.
- Each writer does the load-copy-mutate-store dance.
- `Hosts` slice is explicitly copied to a fresh backing array before mutation.

### Example 2: The same with `atomic.Value` (legacy / pre-1.19)

```go
package main

import (
	"sync/atomic"
)

type Config struct {
	Timeout int
}

var cfg atomic.Value // dynamic type must be *Config every time

func init() {
	cfg.Store(&Config{Timeout: 5})
}

func CurrentConfig() *Config {
	return cfg.Load().(*Config)
}

func SetTimeout(t int) {
	old := cfg.Load().(*Config)
	next := *old
	next.Timeout = t
	cfg.Store(&next)
}
```

Differences from `atomic.Pointer[T]`:

- Every `Load` requires a type assertion.
- Every `Store` is checked at runtime; storing a different concrete type panics.
- One interface allocation per `Load`, none per `Store` (since Go 1.4+; the boxing happens at `Store`).

Stick with `atomic.Pointer[T]` for new code.

### Example 3: Reading the same snapshot twice gives the same value

```go
func ConsistentRead() (string, time.Duration) {
	c := CurrentConfig()           // ONE Load
	return c.LogLevel, c.Timeout   // both reads use the same snapshot
}
```

Compare to a buggy version that loads twice:

```go
func InconsistentRead() (string, time.Duration) {
	return CurrentConfig().LogLevel, CurrentConfig().Timeout
	// Two Loads. If a writer publishes between them, you mix old and new.
}
```

The fix is the rule: **one `Load` per logical operation; capture the pointer in a local variable**.

### Example 4: Why `append` in place is wrong

```go
// BUG: this mutates the published snapshot's slice header.
func BadAddHost(h string) {
	writeMu.Lock()
	defer writeMu.Unlock()
	old := cfg.Load()
	next := *old
	next.Hosts = append(next.Hosts, h) // may share backing array with old.Hosts
	cfg.Store(&next)
}
```

If `old.Hosts` has spare capacity, `append` writes into the same backing array that any reader holding `old` is iterating. The reader sees a torn or out-of-bounds slice. Race detector flags it instantly.

### Example 5: A goroutine that triggers a reload on `SIGHUP`

```go
package main

import (
	"os"
	"os/signal"
	"sync/atomic"
	"syscall"
)

type Config struct{ /* ... */ }

var current atomic.Pointer[Config]

func StartReloader(loader func() *Config) {
	current.Store(loader()) // initial load
	go func() {
		sigs := make(chan os.Signal, 1)
		signal.Notify(sigs, syscall.SIGHUP)
		for range sigs {
			current.Store(loader())
		}
	}()
}

func Cfg() *Config { return current.Load() }
```

The reloader goroutine is the only writer, so no mutex is needed. Every reader pays one atomic load.

### Example 6: First, second, third — observing snapshot identity

```go
func main() {
	var p atomic.Pointer[int]
	a := 1
	p.Store(&a)
	x := p.Load()
	y := p.Load()
	fmt.Println(x == y) // true — both Loads return the same pointer

	b := 2
	p.Store(&b)
	z := p.Load()
	fmt.Println(x == z) // false — different snapshots
	fmt.Println(*x, *z) // 1 2 — the old snapshot's value is still readable
}
```

This little program is the entire core of COW. Multiple `Load`s before a `Store` return identical pointers. A `Store` advances the version. Old versions remain valid.

### Example 7: Writer that builds a fully-fresh snapshot

For a map-shaped configuration, deep-copy the map:

```go
type ServiceConfig struct {
	Endpoints map[string]string // service name -> URL
}

func SetEndpoint(name, url string) {
	writeMu.Lock()
	defer writeMu.Unlock()
	old := svcCfg.Load()
	next := &ServiceConfig{
		Endpoints: make(map[string]string, len(old.Endpoints)+1),
	}
	for k, v := range old.Endpoints {
		next.Endpoints[k] = v
	}
	next.Endpoints[name] = url
	svcCfg.Store(next)
}
```

Every write reallocates the entire map. For 1000 entries this costs perhaps 50 µs and 30 KB. For 100 000 entries it costs ~5 ms and 3 MB. Past some scale, you switch to a persistent map (see senior.md).

---

## Coding Patterns

### Pattern 1: Load once, use many times

Always cache the pointer in a local variable at the start of a function:

```go
func handle(req *Request) {
	c := cfg.Load()                  // one atomic load
	if c.LogLevel == "debug" { ... } // free
	dial(c.Hosts[0])                 // free
	return c.Timeout                 // free
}
```

Versus the antipattern:

```go
func handle(req *Request) {
	if cfg.Load().LogLevel == "debug" { ... } // load 1
	dial(cfg.Load().Hosts[0])                 // load 2 — different snapshot!
	return cfg.Load().Timeout                 // load 3 — different again!
}
```

This is both slower (three loads instead of one) and incorrect (a `Store` between any two loads gives you a mixed-version view).

### Pattern 2: Writer mutex + atomic pointer

The canonical structure:

```go
type Store[T any] struct {
	value   atomic.Pointer[T]
	writeMu sync.Mutex
}

func (s *Store[T]) Load() *T { return s.value.Load() }

func (s *Store[T]) Update(fn func(old T) T) {
	s.writeMu.Lock()
	defer s.writeMu.Unlock()
	old := s.value.Load()
	next := fn(*old)
	s.value.Store(&next)
}
```

The `Update(fn)` form makes the load-copy-publish dance a single API.

### Pattern 3: Builder closure

Pass the update as a function operating on a deep-copied builder:

```go
func (s *Store[T]) Mutate(fn func(*T)) {
	s.writeMu.Lock()
	defer s.writeMu.Unlock()
	old := s.value.Load()
	next := *old
	fn(&next)
	s.value.Store(&next)
}
```

Caller writes:

```go
store.Mutate(func(c *Config) {
	c.LogLevel = "debug"
	c.Hosts = append([]string{}, c.Hosts...)
	c.Hosts = append(c.Hosts, "new.example.com")
})
```

It is the responsibility of `fn` to deep-copy any aliased fields. The library cannot enforce it.

### Pattern 4: Initial snapshot in `init` or constructor

Always publish *some* snapshot before any reader runs. A reader that calls `Load` on an empty pointer gets `nil` and the next dereference panics.

```go
func New() *Store[Config] {
	s := &Store[Config]{}
	s.value.Store(&Config{}) // never let Load return nil
	return s
}
```

### Pattern 5: Read-only methods on the snapshot type

Make the snapshot type's methods take a value or a `*const` (Go has no const; use convention):

```go
func (c *Config) Endpoint(name string) string {
	// no mutation, no return of mutable slice/map references that would
	// allow callers to mutate
	return c.Endpoints[name]
}
```

If you must return a slice, return a defensive copy so the caller cannot break immutability:

```go
func (c *Config) HostsCopy() []string {
	out := make([]string, len(c.Hosts))
	copy(out, c.Hosts)
	return out
}
```

Or trust the caller not to mutate it (documented contract).

---

## Clean Code

- **One package owns the COW state.** Centralise the writer mutex, the atomic pointer, and the API. Do not expose the `atomic.Pointer` directly.
- **Name the type "Snapshot" or "Config", not "MutableConfig".** The name signals immutability.
- **Methods on the snapshot type are pure.** They read fields and return values; they never write.
- **The writer API is small.** Prefer one `Update(fn func(old T) T) T` method to a dozen ad-hoc setters that each repeat the load-copy-publish dance.
- **Snapshots are deeply immutable, even when the type system cannot enforce it.** Document this in a comment on the type:

```go
// Config is an immutable configuration snapshot.
// Fields and any slice/map elements MUST NOT be mutated after the
// snapshot has been published via store.Store(c).
type Config struct { ... }
```

- **Loaders return `*T`, never `T`.** Pointers are cheap to copy and signal "this is a shared snapshot".
- **Never expose mutable inner state.** A method `func (c *Config) GetEndpoints() map[string]string` invites the caller to mutate the map. Either copy or return a `func (key string) (string, bool)` accessor.
- **Write a constructor that builds the initial snapshot.** Avoid `init` for testability.
- **Document the write-frequency assumption.** Place a comment near the type explaining "this is COW because reads vastly outnumber writes; if that changes, reconsider the design."

---

## Product Use / Feature

### Feature 1: Hot-reloadable feature flags

A web service has 50 feature flags. The flags are edited via an admin UI. When an operator clicks "save", the backend POSTs the new flags to all server instances, which call:

```go
flags.Update(func(old FlagSet) FlagSet {
	return parseNewFlags(body)
})
```

Every HTTP handler calls `flags.Load()` at the top to get a consistent snapshot for the entire request. Read latency: 1 ns. Write latency: a few hundred microseconds (rebuilding the FlagSet map). Operators see no read latency increase even at deploy time.

### Feature 2: TLS certificate rotation

Production servers must rotate TLS certificates without dropping connections. The standard pattern:

```go
type tlsConfigStore struct {
	cur atomic.Pointer[tls.Config]
}

func (s *tlsConfigStore) GetCertificate(hello *tls.ClientHelloInfo) (*tls.Certificate, error) {
	return s.cur.Load().Certificates[0], nil
}

func (s *tlsConfigStore) Rotate(certPath, keyPath string) error {
	cert, err := tls.LoadX509KeyPair(certPath, keyPath)
	if err != nil {
		return err
	}
	next := &tls.Config{Certificates: []tls.Certificate{cert}}
	s.cur.Store(next)
	return nil
}
```

New connections after `Rotate` see the new cert. Existing TLS handshakes (which capture the cert at handshake time) finish on the old one.

### Feature 3: Routing table for a reverse proxy

```go
type Route struct {
	Prefix  string
	Backend string
}

type RouteTable struct {
	routes []Route // sorted by prefix length, longest first
}

var rt atomic.Pointer[RouteTable]

func RouteFor(path string) string {
	for _, r := range rt.Load().routes {
		if strings.HasPrefix(path, r.Prefix) {
			return r.Backend
		}
	}
	return ""
}
```

Every incoming request calls `RouteFor` once. Deploys swap the table atomically.

### Feature 4: A/B test bucket assignment

A service maps user IDs to experiment buckets. The mapping is recomputed nightly from a database. Reads happen millions of times per second; updates once per night.

```go
type Buckets struct {
	m map[uint64]string
}

var b atomic.Pointer[Buckets]

func Bucket(userID uint64) string { return b.Load().m[userID] }
```

The nightly job builds a new `Buckets` and `Store`s it.

### Feature 5: Trusted-IPs allowlist

A firewall service maintains an allowlist of IPs. The list changes a few times an hour as new IPs are added. Reads happen on every packet.

```go
type Allow struct {
	ips map[string]struct{}
}

var allow atomic.Pointer[Allow]

func IsAllowed(ip string) bool {
	_, ok := allow.Load().ips[ip]
	return ok
}
```

---

## Error Handling

COW itself does not introduce error-handling surface — `Load` cannot fail, and `Store` cannot fail. The error-handling concerns sit around the edges:

### 1. The writer's "build a new snapshot" step may fail

```go
func Reload() error {
	writeMu.Lock()
	defer writeMu.Unlock()
	next, err := buildSnapshot()
	if err != nil {
		return err  // do NOT Store; old snapshot remains current
	}
	cfg.Store(next)
	return nil
}
```

The rule: **never publish a partially-constructed snapshot**. Either you build the whole thing successfully and publish it, or you publish nothing and the previous snapshot remains in service.

### 2. The reader gets a `nil` from `Load`

If you never `Store`d an initial snapshot, `Load` returns `nil` and the first dereference panics. Defensive readers can check:

```go
c := cfg.Load()
if c == nil {
	return ErrNotInitialized
}
```

But the better pattern is to initialize the store in its constructor and never expose a path that allows `nil` to leak.

### 3. The writer panics mid-build

```go
writeMu.Lock()
defer writeMu.Unlock()
next := buildSnapshotThatMayPanic()
cfg.Store(next) // never reached
// mutex is released by defer; readers continue on the old snapshot
```

If the build panics, the mutex is released by the `defer`, no new snapshot is published, and readers keep seeing the previous version. This is excellent fault isolation — a buggy writer cannot corrupt the data readers see.

### 4. Validation belongs inside the writer

```go
func SetTimeout(d time.Duration) error {
	if d < 0 {
		return errors.New("negative timeout")
	}
	if d > time.Hour {
		return errors.New("absurd timeout")
	}
	writeMu.Lock()
	defer writeMu.Unlock()
	old := cfg.Load()
	next := *old
	next.Timeout = d
	cfg.Store(&next)
	return nil
}
```

Validate before you mutate. A snapshot that fails validation should never be published.

### 5. The writer returns the new snapshot for callers that need to confirm

```go
func (s *Store[T]) Set(v *T) *T {
	s.writeMu.Lock()
	defer s.writeMu.Unlock()
	s.value.Store(v)
	return v
}
```

This makes test assertions trivial.

---

## Security Considerations

COW is mostly a performance pattern, not a security pattern, but a few security-relevant points exist.

### 1. Snapshot tampering by reference

If you hand a `*Config` to user code that includes a `map[string]string` field, that user code can mutate the map. Now the snapshot is no longer immutable — and another reader holding the same `*Config` will see surprising changes (or a race-detector panic). Defensive copying or accessor methods are necessary if the snapshot must cross trust boundaries.

### 2. TLS / secrets in snapshots

If your `*Config` snapshot contains secrets (API keys, certificates), the old snapshot lingers in memory until GC. An attacker with memory-read capability might find a recently-rotated secret. For high-security contexts, zero the secret in the old snapshot — but doing so violates the immutability rule and breaks any reader still using the snapshot. The pragmatic answer is: do not store live secrets as plain bytes; store handles to a secret service.

### 3. Race between policy update and request

Suppose a snapshot contains a security policy ("disallow user X"). A request loads the snapshot at time T1; the operator updates the snapshot to ban user X at T2 > T1. The in-flight request, holding the old snapshot, still allows X for the duration of its work. This is the *intended* behaviour of COW — readers see a consistent snapshot — but security teams sometimes expect "instant" revocation. Document this clearly.

### 4. DoS via writer load

If writers can be triggered by an authenticated user (e.g., an admin endpoint), an attacker who compromises credentials could rebuild a 1 GB snapshot once per millisecond, exhausting memory. Rate-limit writes.

### 5. Time-of-check / time-of-use is not a COW issue

TOCTOU bugs across COW snapshots are simpler than across mutexes — the reader has a stable snapshot for its entire operation. If you load once and use that pointer throughout, you have implicit consistency.

---

## Performance Tips

- **One `Load` per logical operation.** A million `Load`s in a hot loop is fine on a single goroutine (~1 ns each), but if you can load once and use a local, do so.
- **Keep snapshots small enough for L2.** A 100 KB snapshot stays warm in cache; a 100 MB snapshot blows it on each write.
- **Pool the builder.** If the writer rebuilds the same shape repeatedly, you can reuse a builder map and copy into a fresh snapshot at the end. (Be careful: the builder must not be observable by readers.)
- **Pre-size slices and maps.** `make(map[K]V, len(old.m)+1)` saves a rehash. `append([]T(nil), old.s...)` with known length saves a copy.
- **Defer expensive work to the writer.** Pre-sort, pre-index, pre-compute hashes in the snapshot. Readers pay zero for what writers paid once.
- **Avoid `atomic.Value`-on-`interface{}` boxing.** Use `atomic.Pointer[T]` to skip the interface allocation.
- **Don't COW per byte.** If you find yourself COW-ing a single primitive, use the primitive's atomic type (`atomic.Int64`, `atomic.Bool`).

A rough mental model of cost on modern hardware:

| Operation | Cost |
|-----------|------|
| `atomic.Pointer[T].Load` | ~1–2 ns |
| `sync.RWMutex.RLock` + RUnlock | ~10–30 ns uncontended, much more under contention |
| `sync.Mutex.Lock` + Unlock | ~15–25 ns uncontended |
| `sync.Map.Load` | ~20–60 ns |
| Full snapshot copy of 1000-entry map | ~50–100 µs |
| Full snapshot copy of 100 000-entry map | ~5–20 ms |

---

## Best Practices

1. **Use `atomic.Pointer[T]` on Go 1.19+; use `atomic.Value` only when you cannot.**
2. **Always store an initial snapshot in the constructor.** Never let `Load` return `nil`.
3. **Serialize writers with a single mutex, or use CAS.** Pick one and stick with it.
4. **Make snapshot types deeply immutable.** Document this in a comment on the type.
5. **Deep-copy inner slices and maps before mutation.** Shallow copy is a footgun.
6. **One `Load` per logical operation.** Cache the pointer in a local variable.
7. **Validate before you `Store`.** A snapshot that fails validation should never be published.
8. **Don't expose the `atomic.Pointer` directly.** Hide it behind a `Load` / `Update` API.
9. **Measure the write rate.** If it climbs above a few per second on a large snapshot, COW is the wrong tool.
10. **Test with the race detector enabled.** It catches mutation-after-publish bugs the moment they happen.

---

## Edge Cases and Pitfalls

### Pitfall 1: Mutating a snapshot after `Store`

```go
old := cfg.Load()
next := *old
next.Hosts = append(next.Hosts, "h") // may alias old.Hosts!
cfg.Store(&next)
// later, in a reader:
for _, h := range old.Hosts { ... } // may panic or read garbage
```

The slice header of `next.Hosts` may share a backing array with `old.Hosts`. The fix: explicit deep copy.

### Pitfall 2: Map mutation

```go
old := cfg.Load()
next := *old
next.Endpoints["k"] = "v" // mutates the SAME map that old.Endpoints points to
```

Maps are reference types. Shallow-copying the struct does not give you a new map. You must `make` a new one and copy keys.

### Pitfall 3: Two writers without coordination

Lost updates. Use a mutex or a CAS loop.

### Pitfall 4: Reading `Load` twice without caching

```go
return cfg.Load().A + cfg.Load().B // two different snapshots possible
```

Cache once: `c := cfg.Load(); return c.A + c.B`.

### Pitfall 5: `atomic.Value.Store` with mixed dynamic types

```go
var v atomic.Value
v.Store(&Config{})
v.Store(Config{}) // panic: store of inconsistently typed value
```

`atomic.Value` requires the *concrete dynamic type* to match. `*Config` and `Config` are different. So is `*ConfigA` vs `*ConfigB`.

### Pitfall 6: Storing `nil` into `atomic.Value`

`atomic.Value.Store(nil)` panics in older Go versions; in 1.18+ it stores a `nil` interface, and subsequent `Load` returns a `nil` interface. Be deliberate.

### Pitfall 7: `nil` initial state

```go
var cfg atomic.Pointer[Config]
c := cfg.Load() // nil
c.Timeout       // panic
```

Always `Store` an initial snapshot before any reader runs.

### Pitfall 8: Snapshot pinned by a long-lived reader

```go
go func() {
	c := cfg.Load()
	for {
		work(c) // never re-loads
	}
}()
```

This reader holds the snapshot it loaded forever. Any newer snapshots become reachable when published, but this reader never sees them. If the snapshot is 100 MB, you now hold the old version plus every version published since.

### Pitfall 9: Trying to "modify" a snapshot in place

```go
c := cfg.Load()
c.Timeout = 10 * time.Second // race! other readers see this change
```

The snapshot is shared. Any mutation is a race.

### Pitfall 10: `for range` on a snapshot field that includes a map

The map is shared. If another writer publishes a snapshot whose map shares storage (it shouldn't, but bugs happen), iteration can panic with "concurrent map iteration and map write."

---

## Common Mistakes

1. **Forgetting to deep-copy slices.** `append(s, x)` may write in place.
2. **Forgetting to deep-copy maps.** Maps are reference types.
3. **Two writers, no mutex.** Lost updates.
4. **Loading inside a hot loop.** Cache the pointer once.
5. **Calling `Load` twice in one expression.** Mixed snapshots.
6. **Storing inconsistent types into `atomic.Value`.** Runtime panic.
7. **Skipping the initial `Store`.** First `Load` returns nil; first dereference panics.
8. **Returning the snapshot's inner map by reference.** Caller mutates it.
9. **Using COW for a counter.** Use `atomic.Int64` instead.
10. **Recovering from a writer panic by re-publishing a half-built snapshot.** Just let the old snapshot remain current.

---

## Common Misconceptions

> "COW is wait-free for everyone."

No — only readers are wait-free. Writers may block on the writer mutex.

> "After `Store`, the old snapshot is freed."

No — the GC frees it whenever the last reachable reference goes away. In some cases this is much later.

> "COW is faster than `sync.Map` for everything."

No — `sync.Map` is faster for high-write workloads. COW shines when writes are rare.

> "`atomic.Value` and `atomic.Pointer[T]` have the same performance."

`atomic.Pointer[T]` is faster: no interface boxing on `Store`, no type assertion on `Load`.

> "I can avoid the writer mutex with `CompareAndSwap`."

You can — but you have to write a retry loop and reason about ABA. The mutex is usually cleaner.

> "Readers will always see the latest version."

No — they see whatever was current at the moment of `Load`. Anything published later is invisible until the next `Load`.

> "COW makes my code thread-safe automatically."

Only if the snapshot type is deeply immutable. If the snapshot contains a mutable `*log.Logger`, readers and writers can still race on its internal state.

---

## Tricky Points

### Tricky point 1: The snapshot includes pointers

If your `Config` has a `*Database` field, the snapshot pointer is immutable but the `*Database` it points to is not. Readers and writers can race on the database connection's internal state. COW does not magically make pointed-to objects safe — it only makes the snapshot pointer atomic.

### Tricky point 2: Reading a snapshot while a write is in progress

That is the whole point: a writer that takes 500 ms to build a new snapshot does not stall any reader for any time. The old snapshot is fully readable throughout.

### Tricky point 3: `atomic.Pointer[T]` zero value

The zero value of `atomic.Pointer[T]` is a usable pointer holding `nil`. You do not need to initialize it explicitly — but you should `Store` a real value before any reader runs.

### Tricky point 4: Stored pointer is sometimes leaked through escape analysis

```go
old := cfg.Load()
next := *old           // copies the struct
cfg.Store(&next)       // `next` escapes to the heap
```

`next` necessarily escapes because its address is stored in a heap-reachable location. This is expected.

### Tricky point 5: `unsafe.Pointer` vs `atomic.Pointer[T]`

Old code uses `atomic.LoadPointer` and `atomic.StorePointer` on `unsafe.Pointer`. Modern Go provides `atomic.Pointer[T]` which is equivalent at the machine level but type-safe and idiomatic.

---

## Test

A small test suite that exercises the basic COW patterns. Save as `cow_test.go`.

```go
package cowdemo

import (
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

type Config struct {
	N int
}

func TestBasicLoadStore(t *testing.T) {
	var p atomic.Pointer[Config]
	p.Store(&Config{N: 1})
	if p.Load().N != 1 {
		t.Fatal("expected 1")
	}
	p.Store(&Config{N: 2})
	if p.Load().N != 2 {
		t.Fatal("expected 2")
	}
}

func TestSnapshotIdentityAcrossLoads(t *testing.T) {
	var p atomic.Pointer[Config]
	p.Store(&Config{N: 1})
	a, b := p.Load(), p.Load()
	if a != b {
		t.Fatal("expected same pointer between Stores")
	}
}

func TestOldSnapshotStillReadable(t *testing.T) {
	var p atomic.Pointer[Config]
	p.Store(&Config{N: 1})
	old := p.Load()
	p.Store(&Config{N: 2})
	if old.N != 1 {
		t.Fatal("old snapshot must remain 1")
	}
	if p.Load().N != 2 {
		t.Fatal("current must be 2")
	}
}

func TestConcurrentReadersDontBlockWriter(t *testing.T) {
	var p atomic.Pointer[Config]
	p.Store(&Config{N: 0})
	var wg sync.WaitGroup
	stop := make(chan struct{})
	for i := 0; i < 100; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for {
				select {
				case <-stop:
					return
				default:
					_ = p.Load().N
				}
			}
		}()
	}
	start := time.Now()
	for i := 1; i <= 1000; i++ {
		p.Store(&Config{N: i})
	}
	elapsed := time.Since(start)
	close(stop)
	wg.Wait()
	if elapsed > 100*time.Millisecond {
		t.Fatalf("1000 stores took %v, too slow", elapsed)
	}
}
```

Run with `go test -race ./...` to verify no races.

---

## Tricky Questions

**Q1.** Why is a `sync.RWMutex` not the right answer for a 1 000 000-read-per-second config?

*Hint:* It works correctly, but it pays an atomic operation on every `RLock` and `RUnlock` and serializes against a writer that has been waiting. The 100% read-only case still costs ~20 ns per read instead of ~1 ns.

**Q2.** What happens if a reader holds a snapshot pointer forever?

*Hint:* The snapshot is pinned in memory. The GC cannot reclaim it. If many readers each pin different snapshots, memory grows. Long-running goroutines should periodically re-`Load`.

**Q3.** Can two writers running concurrently both `Store` and have both updates preserved?

*Hint:* No, not without coordination. Whichever `Store` happens last wins; the other writer's update is lost. Use a mutex or CAS loop.

**Q4.** What does `atomic.Pointer[T]` cost on a modern x86?

*Hint:* A `Load` is a plain MOV (the x86 memory model gives acquire semantics for free). About 1.5 ns plus cache-line cost. A `Store` is also a plain MOV in most cases (sequential consistency requires an `MFENCE` or `XCHG`, which the Go compiler emits when needed).

**Q5.** What is the difference between `Store(&v)` and `Store(*&v)`?

*Hint:* `*&v` is `v` (a copy of the struct). You cannot `Store` a non-pointer type into `atomic.Pointer[T]` directly — you must take the address. The lifetime of `v` matters: it must escape to the heap (taking its address is enough to make it escape).

**Q6.** Is COW *always* safer than `sync.RWMutex`?

*Hint:* No. COW is safer with respect to reader-writer races on the pointer swap, but if the snapshot is not actually immutable (e.g., it contains a mutable inner field) you still have races. RWMutex is safer if you are sure to lock around every access.

**Q7.** What is the memory cost of a 100 000-entry COW map under 10 writes per second?

*Hint:* Each write allocates a fresh 100 000-entry map (~5 MB). With 10 writes per second, the allocator handles 50 MB/sec of map allocations. GC must keep up. With realistic GC pause goals, this is right on the edge of acceptable.

**Q8.** Why is `atomic.Value` slower than `atomic.Pointer[T]`?

*Hint:* `atomic.Value` stores a 16-byte `interface{}` header (type word + data word) rather than a single pointer. `Store` may require an interface allocation (Go 1.13+ allocates if the type word differs). The type assertion on `Load` is also non-zero cost.

**Q9.** Can you do COW on a value type (not behind a pointer)?

*Hint:* No, not with `atomic.Pointer[T]` — you need a pointer. For small primitives, use `atomic.Int64` etc. For structs, you must wrap in `*T`.

**Q10.** What happens if your writer mutex is held during the `Store`?

*Hint:* Nothing bad. Readers do not touch the mutex, so they are unaffected. Other writers wait. This is the intended pattern.

---

## Cheat Sheet

```go
// Declare:
var cfg atomic.Pointer[Config]

// Initialize (before any reader):
cfg.Store(&Config{...})

// Read (anywhere, no lock):
c := cfg.Load()
use(c)

// Write (under a writer mutex):
writeMu.Lock()
old := cfg.Load()
next := *old
next.Field = newValue
// deep-copy slices: next.Slice = append([]T(nil), old.Slice...)
// deep-copy maps:   next.Map = copyMap(old.Map)
cfg.Store(&next)
writeMu.Unlock()
```

| Need | Use |
|------|-----|
| New code, Go 1.19+ | `atomic.Pointer[T]` |
| Pre-1.19 codebase | `atomic.Value` |
| Single integer COW | Don't — use `atomic.Int64` |
| High write rate | Don't — use `sync.Map` or sharded mutex map |
| Snapshot consistency for many fields | COW |
| Single field, frequent writes | `sync.Mutex` |

---

## Self-Assessment Checklist

- [ ] I can explain "copy-on-write" in one sentence without saying "lock".
- [ ] I can write a COW config with `atomic.Pointer[Config]`, a writer mutex, and an `Update` API.
- [ ] I know why `append(slice, x)` can break immutability.
- [ ] I know why two writers without a mutex lose updates.
- [ ] I can name two use cases where COW shines and two where it does not.
- [ ] I know the difference between `atomic.Value` and `atomic.Pointer[T]` and when to pick each.
- [ ] I know what the GC's role is in a COW system.
- [ ] I can spot a "mixed-snapshot" bug caused by two `Load` calls in one expression.

---

## Summary

Copy-on-write is the simplest, most reliable way to share read-mostly data between goroutines in Go. The pattern is small enough to fit in a paragraph: store a `*T` in an `atomic.Pointer[T]`; let any reader load it; let writers (one at a time) copy, mutate, and re-store. The garbage collector cleans up old snapshots automatically.

The two rules that make it work — never mutate a published snapshot, serialize writers — are easy to state and easy to break. The most common failures are aliased slices and maps that share storage with the previous snapshot, and lost updates from concurrent writers. The race detector catches the first; a writer mutex prevents the second.

For the right workload (1000:1 reads vs writes, kilobyte- to megabyte-sized snapshots), COW gives you wait-free reads that scale linearly with cores and architecturally pleasing code that is hard to get wrong. For the wrong workload — high write rates, gigabyte snapshots, single-counter updates — it is a clear loser, and `sync.RWMutex`, `sync.Map`, or atomic primitives are the right tools.

The middle, senior, and professional levels of this section deepen the picture: structural sharing for cheap writes, persistent data structures, RCU and quiescence, memory ordering, and GC interaction. The junior level is enough to use COW well in 90% of real production cases.

---

## What You Can Build

- A reloadable configuration package for a server (load YAML, watch `SIGHUP`, publish snapshot).
- A feature-flag client that fetches flags from a control plane every minute.
- A DNS / service-discovery cache.
- A reverse-proxy routing table.
- A read-only static content registry (e.g., country codes, currency rates).
- A TLS certificate rotator.
- A per-process metrics registry.
- A read-mostly allowlist or blocklist.

---

## Further Reading

- Go documentation: `sync/atomic` — `Value`, `Pointer[T]`, `Load`, `Store`, `CompareAndSwap`.
- Go blog: "Go memory model" — happens-before edges established by atomic operations.
- Russ Cox, "Hardware Memory Models" (research.swtch.com) — background on why atomic loads are cheap.
- Linux kernel docs on RCU — the C cousin of COW, with manual reclamation.
- Chris Okasaki, *Purely Functional Data Structures* — the persistent-data-structure foundation.
- Go source: `crypto/tls.Config`, `net/http.ServeMux`, `expvar.Map` — real uses of COW.

---

## Related Topics

- `sync.RWMutex` — the lock-based alternative.
- `sync.Map` — the standard library's concurrent map, which uses a different read-mostly pattern (atomic-load read map + dirty map under mutex).
- `sync/atomic.Int64`, `Bool`, etc. — the right primitive for single-value updates.
- `context.Context` — for deadline/cancellation propagation alongside snapshots.
- The Go memory model — the formal happens-before story behind atomic operations.
- Persistent data structures, HAMTs, immutable maps in Clojure / Scala.
- The Linux kernel's RCU.

---

## Diagrams and Visual Aids

### Diagram 1: Atomic pointer swap

```
Before Store:
  +-------------------+        +------------------+
  | atomic.Pointer    | -----> | Snapshot v1      |
  +-------------------+        | LogLevel=info    |
                               | Timeout=5s       |
                               | Hosts=[a]        |
                               +------------------+

After Store:
  +-------------------+        +------------------+
  | atomic.Pointer    | --+    | Snapshot v1      |  (still reachable from
  +-------------------+   |    | LogLevel=info    |   in-flight readers)
                          |    | Timeout=5s       |
                          |    | Hosts=[a]        |
                          |    +------------------+
                          |
                          |    +------------------+
                          +--> | Snapshot v2      |
                               | LogLevel=debug   |
                               | Timeout=5s       |
                               | Hosts=[a,b]      |
                               +------------------+
```

### Diagram 2: Reader and writer timeline

```
time ->
reader R1:   |--Load--|--use snapshot v1-------|
reader R2:                |--Load--|--use snapshot v2-------|
writer W1:        |---build snapshot v2---|Store|

R1 sees v1 throughout. R2 sees v2 throughout.
Neither reader blocks; the writer never blocks them.
```

### Diagram 3: Lost update without coordination

```
writer A:   Load(v1)|copy|mutate A|Store(v2_A)
writer B:           Load(v1)|copy|mutate B|Store(v2_B)
                                                 ^
                                                 |
                                       v2_B overwrites v2_A
                                       (A's changes lost)
```

### Diagram 4: The "outside the circle" mental model

```
   +--------------------------------------+
   |              IMMUTABLE               |
   |                                      |
   |   +------------------------------+   |
   |   |   atomic.Pointer (1 word)    |   |
   |   |   <--- the only mutable      |   |
   |   |        thing in this picture |   |
   |   +------------------------------+   |
   |                |                     |
   |                v                     |
   |   +------------------------------+   |
   |   | Snapshot (immutable struct,  |   |
   |   | immutable slices, immutable  |   |
   |   | maps, etc.)                  |   |
   |   +------------------------------+   |
   |                                      |
   +--------------------------------------+
```

### Diagram 5: GC reclaiming an old snapshot

```
t=0   pointer -> v1   (no other reference)
t=1   pointer -> v2   v1 has no more reachable references
t=2   GC runs; v1 is freed
```

If a reader at t=0.5 grabbed a local reference to v1, the GC cannot reclaim it until that reader's goroutine drops the reference (function returns, variable reassigned, etc).

---

## Deep Dive: A Step-by-Step Walkthrough

This section walks through the construction of a working COW configuration store from the absolute beginning, line by line, with explanations of *why* each choice is made and what could go wrong if you change it.

### Step 1: Decide what is in the snapshot

The first decision: what is one snapshot? The rule of thumb is "everything that must be consistent together". If your app reads `LogLevel`, `Timeout`, and `Hosts` independently, you can put them in three separate atomic pointers — but then a single request might read a `LogLevel` from one version and a `Timeout` from another. If you want them consistent, group them.

```go
// Group consistent fields together.
type Config struct {
	LogLevel string
	Timeout  time.Duration
	Hosts    []string
	// Don't put a *Database or *http.Client here — those have their own
	// concurrency models; mixing them into an immutable snapshot is a smell.
}
```

What *not* to put in the snapshot:

- Live, mutable resources (database handles, open file descriptors, HTTP clients).
- Anything with its own concurrency story.
- Anything whose value changes orders of magnitude more frequently than the rest.
- Anything that contains a `sync.Mutex` — `Mutex` is not copyable.

### Step 2: Choose the container

For Go 1.19+, `atomic.Pointer[Config]`. For older Go, `atomic.Value`. We will write both for completeness, but the rest of the walkthrough uses `atomic.Pointer[Config]`.

```go
type Store struct {
	cur     atomic.Pointer[Config]
	writeMu sync.Mutex
}
```

The store has two fields: an atomic pointer (read by everyone, written by one writer at a time) and a writer mutex (touched only by writers).

### Step 3: Constructor with a non-nil initial snapshot

```go
func NewStore(initial *Config) *Store {
	if initial == nil {
		initial = &Config{} // any default; never nil
	}
	s := &Store{}
	s.cur.Store(initial)
	return s
}
```

The constructor must publish *something* so the first `Load` returns non-nil. Passing the initial config as a parameter is better than reading from a file inside the constructor — easier to test.

### Step 4: The Load API

```go
// Load returns the current snapshot. Wait-free, lock-free, ~1.5 ns.
// The returned pointer is read-only; callers must not modify any field.
func (s *Store) Load() *Config { return s.cur.Load() }
```

That is the entire reader path. No mutex, no waiting, no error. The comment is the contract: "you may read; you may not write".

### Step 5: A simple write API

For a single-field write:

```go
func (s *Store) SetLogLevel(level string) {
	s.writeMu.Lock()
	defer s.writeMu.Unlock()
	old := s.cur.Load()
	next := *old
	next.LogLevel = level
	s.cur.Store(&next)
}
```

This is the canonical load-copy-mutate-store pattern. The mutex serializes writers; the atomic pointer publishes the result.

### Step 6: A write that touches a slice

```go
func (s *Store) AddHost(host string) {
	s.writeMu.Lock()
	defer s.writeMu.Unlock()
	old := s.cur.Load()
	next := *old
	// Critical: allocate a fresh backing array. Without this, append may
	// write into the old snapshot's slice, racing with any reader still
	// using it.
	next.Hosts = append([]string{}, old.Hosts...)
	next.Hosts = append(next.Hosts, host)
	s.cur.Store(&next)
}
```

Why the two `append`s instead of one? Pedagogical clarity. You could write `next.Hosts = append(append([]string(nil), old.Hosts...), host)` in one expression. The split form makes the deep-copy step visible.

### Step 7: A general-purpose Update API

The repetition is annoying. Generalise:

```go
// Update applies fn to a deep-copy of the current snapshot and publishes
// the result. fn must not retain a reference to its argument after returning.
// fn is responsible for deep-copying any slice or map fields it intends to mutate.
func (s *Store) Update(fn func(*Config)) {
	s.writeMu.Lock()
	defer s.writeMu.Unlock()
	old := s.cur.Load()
	next := *old
	fn(&next)
	s.cur.Store(&next)
}

// usage:
store.Update(func(c *Config) {
	c.LogLevel = "debug"
	c.Hosts = append([]string(nil), c.Hosts...)
	c.Hosts = append(c.Hosts, "new.example.com")
})
```

The cost of generality: the caller must still know to deep-copy slices and maps. The library cannot enforce this.

### Step 8: An UpdateE variant that returns errors

If the update may fail (validation, parsing, etc.), let `fn` return an error and skip the `Store`:

```go
func (s *Store) UpdateE(fn func(*Config) error) error {
	s.writeMu.Lock()
	defer s.writeMu.Unlock()
	old := s.cur.Load()
	next := *old
	if err := fn(&next); err != nil {
		return err // old snapshot remains current
	}
	s.cur.Store(&next)
	return nil
}
```

This is the canonical "validate before publish" pattern.

### Step 9: A Watch API for change notifications

```go
type Watcher func(old, new *Config)

type Store struct {
	cur      atomic.Pointer[Config]
	writeMu  sync.Mutex
	watchers []Watcher
}

func (s *Store) Watch(w Watcher) {
	s.writeMu.Lock()
	defer s.writeMu.Unlock()
	s.watchers = append(s.watchers, w)
}

func (s *Store) Update(fn func(*Config)) {
	s.writeMu.Lock()
	defer s.writeMu.Unlock()
	old := s.cur.Load()
	next := *old
	fn(&next)
	s.cur.Store(&next)
	for _, w := range s.watchers {
		w(old, &next)
	}
}
```

This synchronously fires every watcher while holding the writer mutex. For long-running watcher work, dispatch to goroutines:

```go
for _, w := range s.watchers {
	go w(old, &next)
}
```

### Step 10: Test the whole thing

```go
func TestStore(t *testing.T) {
	s := NewStore(&Config{LogLevel: "info", Timeout: time.Second})
	if s.Load().LogLevel != "info" {
		t.Fatal("initial load")
	}
	s.Update(func(c *Config) { c.LogLevel = "debug" })
	if s.Load().LogLevel != "debug" {
		t.Fatal("after update")
	}
}

func TestStoreConcurrent(t *testing.T) {
	s := NewStore(&Config{Hosts: []string{}})
	var wg sync.WaitGroup
	for i := 0; i < 100; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			s.Update(func(c *Config) {
				c.Hosts = append([]string(nil), c.Hosts...)
				c.Hosts = append(c.Hosts, fmt.Sprintf("h-%d", i))
			})
		}(i)
	}
	// Concurrent readers
	for i := 0; i < 100; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := 0; j < 100; j++ {
				_ = len(s.Load().Hosts)
			}
		}()
	}
	wg.Wait()
	if got := len(s.Load().Hosts); got != 100 {
		t.Fatalf("want 100 hosts, got %d", got)
	}
}
```

Run with `go test -race`. Pass.

---

## Twelve Worked Examples

### Worked example 1: A reloadable JSON config

```go
package config

import (
	"encoding/json"
	"os"
	"sync"
	"sync/atomic"
)

type Settings struct {
	APIKey     string   `json:"api_key"`
	MaxRetries int      `json:"max_retries"`
	Endpoints  []string `json:"endpoints"`
}

type Store struct {
	path string
	cur  atomic.Pointer[Settings]
	mu   sync.Mutex
}

func New(path string) (*Store, error) {
	s := &Store{path: path}
	if err := s.Reload(); err != nil {
		return nil, err
	}
	return s, nil
}

func (s *Store) Get() *Settings { return s.cur.Load() }

func (s *Store) Reload() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	b, err := os.ReadFile(s.path)
	if err != nil {
		return err
	}
	var next Settings
	if err := json.Unmarshal(b, &next); err != nil {
		return err
	}
	s.cur.Store(&next)
	return nil
}
```

Used in a handler:

```go
func handle(w http.ResponseWriter, r *http.Request) {
	s := store.Get()
	if r.Header.Get("X-API-Key") != s.APIKey {
		http.Error(w, "forbidden", 403)
		return
	}
	// ... rest of handler uses s freely
}
```

### Worked example 2: A SIGHUP-triggered reload

```go
func WatchSIGHUP(s *Store) {
	sigs := make(chan os.Signal, 1)
	signal.Notify(sigs, syscall.SIGHUP)
	go func() {
		for range sigs {
			if err := s.Reload(); err != nil {
				log.Printf("reload failed: %v", err)
				// old snapshot remains current; service continues
			}
		}
	}()
}
```

### Worked example 3: A periodic poll-and-publish

```go
func PollEvery(s *Store, interval time.Duration, stop <-chan struct{}) {
	t := time.NewTicker(interval)
	defer t.Stop()
	for {
		select {
		case <-t.C:
			_ = s.Reload()
		case <-stop:
			return
		}
	}
}
```

### Worked example 4: A counter-as-snapshot anti-pattern (do not do this)

```go
// Do NOT do this:
var counter atomic.Pointer[int64]

func init() { var z int64; counter.Store(&z) }

func Inc() {
	for {
		old := counter.Load()
		n := *old + 1
		if counter.CompareAndSwap(old, &n) {
			return
		}
	}
}
```

Every `Inc` allocates an `int64` on the heap. The garbage rate is insane. Use `atomic.AddInt64` or `atomic.Int64.Add` instead.

### Worked example 5: A struct counter that is fine to COW

If the counter is grouped with a few other fields that must update together:

```go
type Counters struct {
	Requests int64
	Errors   int64
	Bytes    int64
}

var c atomic.Pointer[Counters]
var mu sync.Mutex

func Add(req, err, bytes int64) {
	mu.Lock()
	defer mu.Unlock()
	old := c.Load()
	next := *old
	next.Requests += req
	next.Errors += err
	next.Bytes += bytes
	c.Store(&next)
}
```

Still suspicious — three `atomic.Int64`s would do — but at least the consistency story is real. If your snapshot exporter must report a triple `(req, err, bytes)` that summed before any of them was further mutated, COW gives you that consistency.

### Worked example 6: A snapshot that *contains* mutable references

Sometimes the snapshot is a map of name to `*log.Logger`. The loggers themselves are mutable, but the snapshot's *pointers* to them are not.

```go
type LoggerSet struct {
	loggers map[string]*log.Logger
}

var ls atomic.Pointer[LoggerSet]

func GetLogger(name string) *log.Logger {
	return ls.Load().loggers[name]
}

// Adding a logger publishes a new snapshot:
func AddLogger(name string, l *log.Logger) {
	mu.Lock()
	defer mu.Unlock()
	old := ls.Load()
	next := &LoggerSet{loggers: make(map[string]*log.Logger, len(old.loggers)+1)}
	for k, v := range old.loggers {
		next.loggers[k] = v
	}
	next.loggers[name] = l
	ls.Store(next)
}
```

Note: `*log.Logger` is thread-safe internally, so this is fine. Be cautious when the inner type is not thread-safe.

### Worked example 7: A read snapshot for an HTTP middleware

```go
func WithConfig(s *Store, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		cfg := s.Get() // ONE load per request
		ctx := context.WithValue(r.Context(), cfgKey{}, cfg)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func FromContext(ctx context.Context) *Settings {
	return ctx.Value(cfgKey{}).(*Settings)
}
```

Every downstream handler reads the cfg from context — guaranteed consistent for the entire request.

### Worked example 8: A feature-flag client

```go
type Flags struct {
	bits map[string]bool
}

func (f *Flags) Enabled(name string) bool { return f.bits[name] }

var flags atomic.Pointer[Flags]
var fmu sync.Mutex

func SetFlag(name string, on bool) {
	fmu.Lock()
	defer fmu.Unlock()
	old := flags.Load()
	next := &Flags{bits: make(map[string]bool, len(old.bits)+1)}
	for k, v := range old.bits {
		next.bits[k] = v
	}
	next.bits[name] = on
	flags.Store(next)
}

// In a handler:
if flags.Load().Enabled("new_checkout") { ... }
```

### Worked example 9: A versioned snapshot for diffing

```go
type Snapshot struct {
	Version int64
	Data    map[string]string
}

var snap atomic.Pointer[Snapshot]
var mu sync.Mutex

func Put(k, v string) {
	mu.Lock()
	defer mu.Unlock()
	old := snap.Load()
	next := &Snapshot{
		Version: old.Version + 1,
		Data:    make(map[string]string, len(old.Data)+1),
	}
	for kk, vv := range old.Data {
		next.Data[kk] = vv
	}
	next.Data[k] = v
	snap.Store(next)
}

// A consumer can check whether anything has changed since the last poll:
func DiffSince(lastVersion int64) (next int64, changed bool) {
	s := snap.Load()
	return s.Version, s.Version != lastVersion
}
```

### Worked example 10: A multi-key consistent read

```go
type Quota struct {
	Daily int
	Used  int
}
type Quotas struct {
	byUser map[string]Quota
}

var q atomic.Pointer[Quotas]

// One Load gives a consistent view across all users.
func RemainingFor(user string) int {
	qs := q.Load()
	v, ok := qs.byUser[user]
	if !ok {
		return 0
	}
	return v.Daily - v.Used
}
```

If you had loaded `qs.byUser[user].Daily` and `qs.byUser[user].Used` from two separate atomic structures, a writer between them could give you torn numbers. With COW you get a snapshot for free.

### Worked example 11: Coordinated cancellation on snapshot change

Sometimes a long-running goroutine should restart when the config changes:

```go
type Config struct{ /* ... */ }
type Cfg struct {
	cur atomic.Pointer[Config]
	ch  chan struct{} // closed and replaced on every Store
	mu  sync.Mutex
}

func (c *Cfg) Watch() <-chan struct{} {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.ch
}

func (c *Cfg) Set(v *Config) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.cur.Store(v)
	close(c.ch)
	c.ch = make(chan struct{})
}
```

A goroutine that wants to wake on changes:

```go
for {
	ch := cfg.Watch()
	cur := cfg.cur.Load()
	doWork(cur)
	select {
	case <-ch: // config changed
	case <-stop:
		return
	}
}
```

### Worked example 12: A snapshot with an embedded sync.Map (legal!)

A `sync.Map` is itself thread-safe, so you can put one inside a snapshot:

```go
type Cache struct {
	m sync.Map
}

var c atomic.Pointer[Cache]
```

But why would you? The whole point of COW is to make the *contents* immutable. If the contents are themselves mutable, COW just gives you an atomic pointer over a mutable object. Use `c.Load().m.Load(key)` and you have a working concurrent map — but you have two layers of complexity for the price of one.

Cases where this makes sense: when you want to swap the entire `sync.Map` out at once (e.g., to clear cache wholesale).

---

## Twenty Small Patterns and Idioms

### Pattern A: The store factory

```go
type Store[T any] struct {
	cur atomic.Pointer[T]
	mu  sync.Mutex
}

func New[T any](initial *T) *Store[T] {
	s := &Store[T]{}
	s.cur.Store(initial)
	return s
}
```

### Pattern B: The Get method

```go
func (s *Store[T]) Get() *T { return s.cur.Load() }
```

### Pattern C: The Replace method

```go
func (s *Store[T]) Replace(next *T) { s.mu.Lock(); defer s.mu.Unlock(); s.cur.Store(next) }
```

### Pattern D: The Update closure

```go
func (s *Store[T]) Update(fn func(*T)) {
	s.mu.Lock()
	defer s.mu.Unlock()
	cur := s.cur.Load()
	next := *cur
	fn(&next)
	s.cur.Store(&next)
}
```

### Pattern E: The CAS update

```go
func (s *Store[T]) CASUpdate(fn func(*T)) {
	for {
		cur := s.cur.Load()
		next := *cur
		fn(&next)
		if s.cur.CompareAndSwap(cur, &next) {
			return
		}
	}
}
```

CAS avoids the writer mutex but burns CPU on retries. Suitable when writers are very rare.

### Pattern F: The "swap and return previous"

```go
func (s *Store[T]) Swap(next *T) *T {
	s.mu.Lock()
	defer s.mu.Unlock()
	prev := s.cur.Load()
	s.cur.Store(next)
	return prev
}
```

### Pattern G: The "load and act"

```go
cur := store.Get()
do(cur)
```

Cache the pointer in a local. Never load twice.

### Pattern H: The "compare versions"

```go
prev := store.Get()
// ...
if store.Get() != prev {
	// snapshot changed; reprocess
}
```

Pointer equality on the snapshot. Cheap and reliable.

### Pattern I: The "publish under defer"

```go
func Reload() (err error) {
	mu.Lock()
	defer mu.Unlock()
	next, err := build()
	if err != nil {
		return err
	}
	defer cfg.Store(next) // last act before return
	return nil
}
```

Mild overengineering — the linear form is clearer — but it works.

### Pattern J: The "atomic switch with old snapshot cleanup"

```go
old := s.cur.Load()
s.cur.Store(next)
go old.cleanup() // run finalizers async, after all in-flight readers finish
```

Caveat: there is no general way to know when "all in-flight readers finish". This pattern only works for snapshots whose cleanup is safe to run while readers continue (e.g., closing a file the readers no longer use).

### Pattern K: The "shard COW"

Split your data into N shards, each with its own atomic pointer:

```go
const Shards = 16
var shards [Shards]atomic.Pointer[Shard]

func Get(key string) *Entry { return shards[hash(key)%Shards].Load().Get(key) }
```

Writers only block other writers on the same shard. Reduces write contention.

### Pattern L: The "snapshot per request"

```go
func Handle(req *Request) {
	cfg := globalCfg.Load()
	ctx := withCfg(req.Context(), cfg)
	handle(ctx, req)
}
```

Pin the snapshot at the request boundary. Every downstream call sees the same version.

### Pattern M: The "two-stage publish"

For correctness across a multi-store update (e.g., updating two related COW stores):

```go
mu.Lock()
defer mu.Unlock()
a.Store(newA)
b.Store(newB)
```

Single-writer for both stores serialises updates. Readers may still see a moment with newA + oldB unless they read both atomically — which they cannot. If you need cross-store snapshot consistency, group both pieces into one larger snapshot.

### Pattern N: The "version barrier"

```go
type Versioned[T any] struct {
	Version int64
	Value   T
}
```

Tag the snapshot with a monotonic version. Useful for cache invalidation downstream of a COW store.

### Pattern O: The "init guard"

```go
var (
	cfg     atomic.Pointer[Config]
	cfgOnce sync.Once
)

func MustGet() *Config {
	cfgOnce.Do(func() {
		cfg.Store(loadInitialOrPanic())
	})
	return cfg.Load()
}
```

Lazy initialisation. Useful in test scenarios.

### Pattern P: The "expvar publisher"

```go
expvar.Publish("config", expvar.Func(func() any { return cfg.Load() }))
```

Now `/debug/vars` shows the current snapshot. Cheap, useful.

### Pattern Q: The "snapshot-aware logger"

```go
type LogConfig struct {
	Level slog.Level
}

var lc atomic.Pointer[LogConfig]

func Log(msg string) {
	if !lc.Load().Level.LevelEnabled(slog.LevelDebug) {
		return
	}
	// ... log
}
```

Logger samples its level snapshot once per call. Operators can twiddle log levels without restarting.

### Pattern R: The "doc table"

```go
type Docs struct {
	byID map[int]Doc
}

var docs atomic.Pointer[Docs]

func GetDoc(id int) (Doc, bool) {
	d, ok := docs.Load().byID[id]
	return d, ok
}
```

Reference data loaded once at startup, occasionally hot-reloaded.

### Pattern S: The "graceful degradation on reload failure"

```go
func Reload() {
	next, err := build()
	if err != nil {
		metrics.ReloadFailure.Inc()
		return // old snapshot remains
	}
	cfg.Store(next)
	metrics.ReloadSuccess.Inc()
}
```

A failed reload should never bring down the service. Just emit a metric.

### Pattern T: The "smoke test in init"

```go
func init() {
	c := &Config{}
	cfg.Store(c)
	if got := cfg.Load(); got != c {
		panic("atomic.Pointer is broken") // sanity check
	}
}
```

Optional, but catches the case where someone wires up the wrong atomic primitive.

---

## More Code Examples (Long-Form)

### Example: A complete reloadable HTTP server with COW config

```go
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"sync"
	"sync/atomic"
	"syscall"
	"time"
)

type Config struct {
	ListenAddr    string        `json:"listen_addr"`
	ReadTimeout   time.Duration `json:"read_timeout"`
	AllowedHosts  []string      `json:"allowed_hosts"`
	MOTD          string        `json:"motd"`
}

type Store struct {
	path string
	cur  atomic.Pointer[Config]
	mu   sync.Mutex
}

func New(path string) (*Store, error) {
	s := &Store{path: path}
	if err := s.Reload(); err != nil {
		return nil, err
	}
	return s, nil
}

func (s *Store) Get() *Config { return s.cur.Load() }

func (s *Store) Reload() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	b, err := os.ReadFile(s.path)
	if err != nil {
		return err
	}
	var next Config
	if err := json.Unmarshal(b, &next); err != nil {
		return fmt.Errorf("parse config: %w", err)
	}
	if next.ListenAddr == "" {
		return fmt.Errorf("listen_addr required")
	}
	s.cur.Store(&next)
	return nil
}

func main() {
	store, err := New("config.json")
	if err != nil {
		panic(err)
	}
	go watchHUP(store)

	mux := http.NewServeMux()
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		c := store.Get()
		host := r.Host
		allowed := false
		for _, h := range c.AllowedHosts {
			if h == host {
				allowed = true
				break
			}
		}
		if !allowed {
			http.Error(w, "host not allowed", 403)
			return
		}
		fmt.Fprintln(w, c.MOTD)
	})

	srv := &http.Server{
		Addr:        store.Get().ListenAddr,
		Handler:     mux,
		ReadTimeout: store.Get().ReadTimeout,
	}
	if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		panic(err)
	}
	_ = context.Background()
}

func watchHUP(s *Store) {
	sigs := make(chan os.Signal, 1)
	signal.Notify(sigs, syscall.SIGHUP)
	for range sigs {
		if err := s.Reload(); err != nil {
			fmt.Fprintf(os.Stderr, "reload failed: %v\n", err)
		} else {
			fmt.Fprintln(os.Stderr, "config reloaded")
		}
	}
}
```

Observe: every request reads one snapshot, traverses it, and is done. Operators `kill -HUP <pid>` to apply config changes. A bad config file does not crash the server — the old snapshot stays in service.

### Example: A COW map with a tested Update API

```go
package cowmap

import (
	"sync"
	"sync/atomic"
)

type Map[K comparable, V any] struct {
	cur atomic.Pointer[map[K]V]
	mu  sync.Mutex
}

func New[K comparable, V any]() *Map[K, V] {
	m := make(map[K]V)
	out := &Map[K, V]{}
	out.cur.Store(&m)
	return out
}

func (m *Map[K, V]) Get(k K) (V, bool) {
	v, ok := (*m.cur.Load())[k]
	return v, ok
}

func (m *Map[K, V]) Set(k K, v V) {
	m.mu.Lock()
	defer m.mu.Unlock()
	old := *m.cur.Load()
	next := make(map[K]V, len(old)+1)
	for kk, vv := range old {
		next[kk] = vv
	}
	next[k] = v
	m.cur.Store(&next)
}

func (m *Map[K, V]) Delete(k K) {
	m.mu.Lock()
	defer m.mu.Unlock()
	old := *m.cur.Load()
	if _, ok := old[k]; !ok {
		return
	}
	next := make(map[K]V, len(old)-1)
	for kk, vv := range old {
		if kk == k {
			continue
		}
		next[kk] = vv
	}
	m.cur.Store(&next)
}

func (m *Map[K, V]) Len() int { return len(*m.cur.Load()) }
```

Test:

```go
func TestCOWMap(t *testing.T) {
	m := New[string, int]()
	m.Set("a", 1)
	if v, ok := m.Get("a"); !ok || v != 1 {
		t.Fatal("set+get")
	}
	m.Set("b", 2)
	if m.Len() != 2 {
		t.Fatal("len")
	}
	m.Delete("a")
	if _, ok := m.Get("a"); ok {
		t.Fatal("delete")
	}
}

func TestCOWMapConcurrent(t *testing.T) {
	m := New[int, int]()
	var wg sync.WaitGroup
	for i := 0; i < 100; i++ {
		wg.Add(1)
		go func(i int) { defer wg.Done(); m.Set(i, i) }(i)
	}
	for i := 0; i < 1000; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_ = m.Len()
		}()
	}
	wg.Wait()
	if m.Len() != 100 {
		t.Fatal("final len")
	}
}
```

Run with `-race`. Pass.

### Example: A COW slice append-only log

```go
type Log[T any] struct {
	cur atomic.Pointer[[]T]
	mu  sync.Mutex
}

func NewLog[T any]() *Log[T] {
	empty := []T{}
	l := &Log[T]{}
	l.cur.Store(&empty)
	return l
}

func (l *Log[T]) Snapshot() []T {
	return *l.cur.Load()
}

func (l *Log[T]) Append(v T) {
	l.mu.Lock()
	defer l.mu.Unlock()
	old := *l.cur.Load()
	next := make([]T, len(old)+1)
	copy(next, old)
	next[len(old)] = v
	l.cur.Store(&next)
}
```

This is `O(n)` per append — every write copies the entire slice. For an append-only log past 100 000 entries this is too expensive. For a small audit log, perfectly fine.

To remind ourselves of the trade: a single `append` on a 100 000-entry slice runs in microseconds (data fits in cache). At 1 write per second this is a non-issue. At 1000 writes per second this is a 100% CPU sink.

---

## Twenty More Pitfalls and How to Avoid Them

### Pitfall 11: Calling `Store` with a value that aliases the previous snapshot

```go
old := cfg.Load()
old.Hosts = append(old.Hosts, "x") // BUG: mutates published snapshot
cfg.Store(old)                     // re-publishes a mutated snapshot
```

This breaks immutability twice over. The `append` may write into a backing array readers hold; the `Store` re-publishes a pointer that was never copied.

### Pitfall 12: Forgetting to publish the result of a successful build

```go
mu.Lock()
defer mu.Unlock()
next := buildSnapshot()
// forgot cfg.Store(next)
```

Easy to miss in long writer functions. A canary: assert in tests that `Reload` is followed by `Get() == next`.

### Pitfall 13: Holding the writer mutex while sleeping

```go
mu.Lock()
defer mu.Unlock()
next := loadFromSlowAPI() // 5 seconds
cfg.Store(next)
```

Other writers block for 5 seconds. Readers are unaffected, but if writes are even occasionally important (e.g., a reload triggered by an alert), holding the mutex during I/O is a needless serialisation. Build outside the lock:

```go
next := loadFromSlowAPI()
mu.Lock()
cfg.Store(next)
mu.Unlock()
```

But now you have lost the "atomic compare-then-set" property: another writer may publish between your load-from-API and your store. For pure overwrite semantics this is fine; for read-modify-write it is wrong.

### Pitfall 14: Reading the slice header but using its element

```go
cur := cfg.Load()
hosts := cur.Hosts // slice header
// a writer publishes
go writer()
for _, h := range hosts { dial(h) } // safe: hosts pins the backing array
```

Reading `hosts` into a local *does* pin the backing array. As long as no writer mutates the backing array in place, you are safe. The COW writer rebuilds the slice into a fresh array, so the old one stays valid for in-flight readers.

### Pitfall 15: Using `for range cfg.Load().Hosts`

```go
for _, h := range cfg.Load().Hosts {
	dial(h)
}
```

This is fine — `for range` evaluates the operand once. But subtle:

```go
for i := 0; i < len(cfg.Load().Hosts); i++ {
	dial(cfg.Load().Hosts[i]) // two loads per iteration; may differ
}
```

Cache the pointer first.

### Pitfall 16: Storing into the wrong variable

```go
var cfg atomic.Pointer[Config]
var oldCfg atomic.Pointer[Config] // typo? scope confusion?

oldCfg.Store(next) // never visible to readers of cfg
```

Compiler can't help. Test that `cfg.Load() == next` after publish.

### Pitfall 17: Hot-loop snapshot capture in a watcher

```go
for {
	cur := cfg.Load() // ONE load
	for _, h := range cur.Hosts {
		ping(h) // each ping is a long operation
	}
	time.Sleep(time.Second)
}
```

After a long sleep, `cur` is stale. That may or may not matter — if the watcher is supposed to act on the latest config, it should re-load:

```go
for {
	cur := cfg.Load()
	for _, h := range cur.Hosts { ping(h) }
	time.Sleep(time.Second)
	// loop iteration re-loads
}
```

### Pitfall 18: Holding the snapshot pointer across a `context.Context` deadline

If your reader holds a snapshot pointer for an hour, you pin that snapshot for an hour. The newer snapshots become reachable when published, but the old one stays in memory.

### Pitfall 19: Logging the snapshot at trace level

`log.Printf("snapshot: %+v", cfg.Load())` is fine for a small snapshot, terrible for a 10 000-entry map (formatting cost dominates).

### Pitfall 20: Treating `atomic.Pointer[T]` as a value type

```go
type S struct {
	p atomic.Pointer[Config]
}

func use(s S) { ... } // copies the atomic.Pointer
```

`atomic.Pointer[T]` is not copyable in the safe sense. Copying it copies a single word, which is technically race-free, but you lose the "single canonical pointer" property. Always pass `*S`.

### Pitfall 21: Recursive locking

```go
mu.Lock()
defer mu.Unlock()
SetHost("x") // SetHost internally calls mu.Lock — deadlock
```

`sync.Mutex` is non-reentrant. Either factor out the no-lock variant or use an `sync.RWMutex` with reader-side calls (still not reentrant).

### Pitfall 22: Trying to roll back a `Store`

There is no rollback. Once you `Store(next)`, it is published. Readers may have already loaded it. The only "rollback" is to `Store(old)` — but in the meantime some reader may have seen `next` and acted on it.

### Pitfall 23: Returning the snapshot pointer from a public API

```go
// API surface:
func (s *Store) Snapshot() *Config { return s.cur.Load() }
```

External callers now hold a pointer to immutable state. If they mutate it (because the type system did not stop them), you have a bug.

Mitigations:
- Document the immutability contract in a doc comment.
- Return a defensive deep copy. Costly but safe.
- Use accessor methods instead of returning the snapshot directly.

### Pitfall 24: Forgetting to handle the case where `Store` happens between `Load` and a derived computation

```go
cur := cfg.Load()
hosts := cur.Hosts
// time passes
for _, h := range hosts { ... }
// is `cur` still current?
```

It may not be. But that is fine — you're reading a *snapshot*, not the live state. The whole pattern is built around accepting bounded staleness in exchange for wait-free reads.

### Pitfall 25: Misusing `CompareAndSwap` as a read-modify-write

```go
cur := cfg.Load()
next := *cur
next.X = something
cfg.CompareAndSwap(cur, &next) // OK if it returns true
```

If `CompareAndSwap` returns false, another writer interleaved. You must retry. A bare CAS without a loop loses updates silently.

### Pitfall 26: Storing an interface containing a pointer

`atomic.Value.Store(myInterface)` boxes the interface. Subsequent `Store` calls must use the *exact same dynamic type*. Easy to break by storing two implementations of the same interface.

### Pitfall 27: Treating "wait-free" as "instant"

Wait-free means bounded steps regardless of contention. A `Load` is one MOV — but if the cache line is being written by a different core, you may still pay 30+ ns due to MESI invalidation. Wait-free is not "free".

### Pitfall 28: Cold cache on first reader

The first reader after a `Store` pays the cost of fetching the new snapshot from the writer's cache (cross-core data transfer, maybe 50 ns). Subsequent readers get it from the shared cache. Most workloads do not notice.

### Pitfall 29: Holding writer mutex during `Store`

Always do `Store` *inside* the writer mutex. If you `Store` outside, two writers' `Store` operations can race; readers will still see consistent snapshots, but you have lost serialisation of writers.

### Pitfall 30: Wrong package for `atomic.Pointer`

There is no `runtime/atomic` or `internal/atomic` for application code. The correct import is `sync/atomic`. Generic `atomic.Pointer[T]` requires Go 1.19.

---

## A Larger Example: A Tiny In-Memory Database

To put the patterns together, here is a tiny key-value store using COW. Reads are concurrent and lock-free; writes are serialized.

```go
package kvstore

import (
	"sync"
	"sync/atomic"
)

type DB struct {
	cur atomic.Pointer[map[string]string]
	mu  sync.Mutex
}

func New() *DB {
	empty := map[string]string{}
	db := &DB{}
	db.cur.Store(&empty)
	return db
}

func (db *DB) Get(k string) (string, bool) {
	v, ok := (*db.cur.Load())[k]
	return v, ok
}

func (db *DB) Put(k, v string) {
	db.mu.Lock()
	defer db.mu.Unlock()
	old := *db.cur.Load()
	next := make(map[string]string, len(old)+1)
	for kk, vv := range old {
		next[kk] = vv
	}
	next[k] = v
	db.cur.Store(&next)
}

func (db *DB) Delete(k string) {
	db.mu.Lock()
	defer db.mu.Unlock()
	old := *db.cur.Load()
	if _, ok := old[k]; !ok {
		return
	}
	next := make(map[string]string, len(old))
	for kk, vv := range old {
		if kk == k {
			continue
		}
		next[kk] = vv
	}
	db.cur.Store(&next)
}

// Range over a consistent snapshot.
func (db *DB) Range(fn func(k, v string) bool) {
	for k, v := range *db.cur.Load() {
		if !fn(k, v) {
			return
		}
	}
}

// BatchPut amortizes the rebuild cost across many keys.
func (db *DB) BatchPut(pairs map[string]string) {
	db.mu.Lock()
	defer db.mu.Unlock()
	old := *db.cur.Load()
	next := make(map[string]string, len(old)+len(pairs))
	for kk, vv := range old {
		next[kk] = vv
	}
	for kk, vv := range pairs {
		next[kk] = vv
	}
	db.cur.Store(&next)
}
```

Use:

```go
db := New()
db.Put("alice", "engineer")
db.Put("bob", "manager")

if v, ok := db.Get("alice"); ok {
	fmt.Println(v) // engineer
}

db.Range(func(k, v string) bool {
	fmt.Printf("%s=%s\n", k, v)
	return true
})
```

For 1000 keys this is fine. For 1 000 000 keys with even a single write per second, each `Put` rebuilds a 1 M-entry map (~50 MB allocation, ~50 ms). Past that scale, switch to a persistent HAMT (see senior.md) or to `sync.Map`.

---

## Comparing COW Against the Alternatives

A pragmatic side-by-side. Numbers are approximate and machine-dependent.

| Pattern | Read latency | Write latency | Reader contention | Writer contention | Scalability of reads | When to use |
|---------|--------------|---------------|-------------------|-------------------|----------------------|-------------|
| `sync.Mutex` | 20 ns + wait | 20 ns + wait | High | High | Bad | Mixed read/write, simplicity |
| `sync.RWMutex` | 20 ns (uncontended) | 30 ns + wait | Medium (writer-preferring) | High | OK | Read-heavy, small structures |
| `sync.Map` | 30–80 ns | 100 ns – µs | Low | Medium | Good | Map-shaped, many writes |
| `atomic.Pointer[T]` COW | 1.5 ns | µs – ms | None | High (per writer) | Excellent | Read-mostly, immutable snapshot |
| Sharded mutex map | 30 ns | 30 ns | Low | Low (per shard) | Good | Many small writes |
| Persistent HAMT (COW with sharing) | 5–20 ns | 10–50 µs | None | High (per writer) | Excellent | Large read-mostly map with occasional writes |

The shape of the workload dictates the choice. For a config that updates once per hour and is read 100 000 times per second, COW is the clear winner. For a per-request counter, COW is the clear loser.

---

## Yet More Self-Assessment

Before moving to middle.md, you should be able to answer the following with no notes:

1. What is the *one rule* that makes COW correct? (Snapshots are not mutated after publish.)
2. What is the *one rule* that prevents lost updates? (Writers serialize via mutex or CAS.)
3. What is the cost of a `Load` on `atomic.Pointer[T]`? (One atomic load, ~1.5 ns.)
4. What is the cost of a `Store` on `atomic.Pointer[T]`? (One atomic store, ~2 ns, plus whatever the writer did to build the snapshot.)
5. Why does the GC make COW practical in Go but painful in C? (Automatic reachability-based reclamation.)
6. Name two structures in the standard library that use COW internally. (E.g., `http.ServeMux`, `crypto/tls.Config`, `expvar.Map`.)
7. When should you prefer `sync.RWMutex` over COW? (When writes are frequent or the structure is large; when readers need to enforce mutual exclusion against writers for some external resource.)
8. When should you prefer `sync.Map` over COW? (Map-shaped, mixed read/write, no need for multi-key snapshot consistency.)
9. What is a lost update? (Two writers that both load the same snapshot, build, and store; the second overwrites the first.)
10. How do you get multi-field consistency from `atomic.Pointer[T]`? (Group the fields into one snapshot struct.)

If any of these stumped you, re-read the corresponding section.

---

## Closing Notes for Junior Level

Copy-on-write is, by happy accident, one of the most beginner-friendly advanced concurrency patterns in Go. You can use it correctly with three primitives (`atomic.Pointer[T]`, `sync.Mutex`, struct assignment) and four rules:

1. Build the snapshot fully before publishing it.
2. Never mutate a published snapshot.
3. Deep-copy any inner slice or map you intend to change.
4. Serialise writers with a mutex (or a CAS loop).

The reader path is one line. The writer path is six lines. The architecture is one diagram. The bugs are catchable by the race detector and the type system.

What you give up — large or write-heavy data — is exactly the case where the lock-based alternatives shine. Pick the right tool for the workload. For everything else: COW.

---

## Appendix A: Reading Real Standard-Library Code

The Go standard library uses COW in several places. Skimming the source is the fastest way to internalise idioms.

### `crypto/tls.Config`

`tls.Config` is documented as "shareable across goroutines after configuration is complete". Internally, several methods clone the config before mutating. See `Config.Clone()`:

```go
// Clone returns a shallow clone of c or nil if c is nil. It is safe to
// clone a Config that is being used concurrently by a TLS client or server.
func (c *Config) Clone() *Config { ... }
```

This is COW in spirit: the producer clones, mutates the clone, and hands the clone to a server that may then continue to use it without further locking.

### `net/http.ServeMux`

`ServeMux` uses an `RWMutex` because routes are sometimes added during runtime, but the read-only matching path is a copy-on-publish lookup tree. The trade-off here is that route updates are rare enough to tolerate the RWMutex; pure-COW would have served just as well.

### `expvar`

`expvar.Map.Do` snapshots the underlying map under a brief lock and iterates the copy outside the lock. This is a hybrid: mutex for the snapshot, lock-free for the iteration. It is COW-flavoured.

### `runtime` internals

`pclntab` (the PC-to-line table) is built once and never modified. Loading is a non-atomic read because the table is published before any goroutine reads it. This is COW at the most extreme: one version, zero updates.

### `sync.Once`

`sync.Once` is a degenerate COW: a single "completed?" flag that flips from false to true atomically. The "snapshot" is just one bit.

---

## Appendix B: Idiomatic Go for COW APIs

A handful of small conventions that real Go libraries follow:

### Convention 1: Snapshot types are exported; the store is sometimes not

```go
type Config struct { ... } // exported, returned to callers

type configStore struct { ... } // unexported, lives inside the package
```

This makes the snapshot the public surface and the store an implementation detail.

### Convention 2: Use `Get` for read, `Update` for write, `Replace` for full swap

```go
func (s *Store) Get() *Config
func (s *Store) Update(fn func(*Config))
func (s *Store) Replace(c *Config)
```

Three verbs cover almost every API. Avoid overloading `Set` for both single-field and whole-snapshot updates.

### Convention 3: Document the immutability contract explicitly

```go
// Config is a configuration snapshot. After being returned from Store.Get
// or stored via Store.Update, it must not be modified.
type Config struct { ... }
```

### Convention 4: Provide a `Clone` method on the snapshot

```go
func (c *Config) Clone() *Config {
	cp := *c
	cp.Hosts = append([]string(nil), c.Hosts...)
	return &cp
}
```

Callers who want a writable copy use `Clone`. The store's `Update` can use `Clone` internally too.

### Convention 5: Constructors accept the initial snapshot

```go
func NewStore(initial *Config) *Store
```

Better than `NewStore()` followed by `store.Replace(initial)`. The constructor cannot leave the store in an unusable state.

### Convention 6: Watchers are unsubscribable

```go
func (s *Store) Watch(fn func(old, new *Config)) (unsubscribe func())
```

Returning an unsubscribe function lets callers tidy up; otherwise watchers leak on test setup/teardown.

### Convention 7: Tests use the race detector

Every COW package's test suite should be run with `go test -race`. Without it, the most pernicious bugs (aliased slices, mutated published snapshots) go undetected.

---

## Appendix C: Quick FAQ

**Q.** Do I need `atomic.Pointer[T]` or is plain `*T` enough?

**A.** Plain `*T` is unsafe across goroutines. Even a single-word assignment is, on some hardware, not atomic — and the Go memory model does not promise that one goroutine's `*T = next` is visible to another goroutine without a synchronisation event. `atomic.Pointer[T].Store` and `Load` provide the synchronisation.

**Q.** Why does `atomic.Pointer[T]` need a `Store` and a `Load` instead of just `var p *T` with a mutex?

**A.** It works with a mutex too. `atomic.Pointer[T]` is faster — `Load` is one machine instruction. A mutex `Lock`/`Unlock` is dozens of instructions and may contend.

**Q.** Can I use COW from `init`?

**A.** Yes. `init` runs in the main goroutine before any others, so a single `Store` in `init` is safely visible to all subsequent readers.

**Q.** How big can a snapshot be?

**A.** As big as you can afford to copy on each write and as big as fits in your live heap. Real systems run COW with snapshots up to ~1 GB at very low write rates. Past that, persistent structures are essential.

**Q.** Does COW work across processes?

**A.** No. The atomic pointer is a single word in one address space. Cross-process snapshot publishing requires mmap, shared memory, and your own atomic primitives — beyond junior scope.

**Q.** Does the GC pause during a `Store`?

**A.** No. `Store` is a single atomic write. The GC may pause for other reasons (mark/sweep cycle), but `Store` itself does not interact with the GC's pause mechanism.

**Q.** What if I want a "transaction" over multiple COW stores?

**A.** Either combine them into one snapshot, or accept that readers may see a momentary mixed state. There is no general distributed-transaction primitive over COW.

**Q.** What if two writers run at the same nanosecond?

**A.** The writer mutex serialises them. With CAS, one succeeds and the other retries. Either way, both updates eventually land, in some order.

**Q.** Do I need `runtime.KeepAlive` to prevent the GC from freeing my snapshot mid-read?

**A.** No. As long as you hold a normal Go pointer to the snapshot (e.g., a local variable), the GC will not free it. `runtime.KeepAlive` is for `unsafe.Pointer` arithmetic, not for COW.

**Q.** Is `atomic.Pointer[T]` blocking under any circumstance?

**A.** No. Both `Load` and `Store` are wait-free at the machine level (on supported architectures). `CompareAndSwap` is wait-free per attempt but a CAS loop may retry indefinitely under high contention.

---

This concludes the junior level. You now have the vocabulary, the patterns, and the working examples to use copy-on-write correctly in most real Go services. The middle, senior, and professional levels build on this foundation with deeper engineering, persistent structures, RCU, and the formal memory-model story.

