# Mutex — Middle Level

> **Topic:** [Mutex](README.md)
> **Focus:** RWMutex, TryLock, fairness, recursive locks

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Real-World Analogies](#real-world-analogies)
6. [Mental Models](#mental-models)
7. [Code Examples](#code-examples)
8. [Pros & Cons](#pros--cons)
9. [Use Cases](#use-cases)
10. [Coding Patterns](#coding-patterns)
11. [Clean Code](#clean-code)
12. [Best Practices](#best-practices)
13. [Edge Cases & Pitfalls](#edge-cases--pitfalls)
14. [Common Mistakes](#common-mistakes)
15. [Tricky Points](#tricky-points)
16. [Test Yourself](#test-yourself)
17. [Tricky Questions](#tricky-questions)
18. [Cheat Sheet](#cheat-sheet)
19. [Summary](#summary)
20. [What You Can Build](#what-you-can-build)
21. [Further Reading](#further-reading)
22. [Related Topics](#related-topics)
23. [Diagrams & Visual Aids](#diagrams--visual-aids)

---

## Introduction

At the junior level you learned the basic shape of a mutex: one lock, one
critical section, lots of bugs avoided. That model gets you surprisingly far,
but the moment you put real load on it you discover something uncomfortable —
a single mutex is the easiest way to turn an eight-core machine into a
one-core machine. Threads queue up, throughput plateaus, and a profiler shows
most of your CPU time is spent waiting.

The middle-level view of mutexes is about all the knobs people invented to
get around that ceiling. You will meet **reader-writer locks**, which let
many readers share access at the same time. You will meet **TryLock**, which
lets you decline to wait. You will meet **fair** versus **unfair** mutexes
and learn why "fair" is not automatically better. You will meet **reentrant**
mutexes, **adaptive** mutexes, and the dreaded **lock convoy**, where a few
slow threads can drag down an entire process.

Most importantly, you will start thinking about **lock granularity** — the
art of splitting one big lock into many small locks without introducing new
bugs. Almost every performance story in high-concurrency systems is, at some
level, a lock-granularity story.

The goal of this guide is not to memorize every API. It is to give you a
mental model strong enough that when you read someone else's code and see
`sync.RWMutex`, `std::shared_mutex`, or `ReentrantReadWriteLock`, you
immediately know what trade-offs are on the table.

---

## Prerequisites

Before reading this guide you should already be comfortable with:

- The junior-level mutex material: critical sections, `Lock()` /
  `Unlock()`, `defer Unlock()` in Go, RAII guards in C++, race conditions,
  and basic deadlocks.
- The difference between a goroutine and an OS thread (or the equivalent
  abstraction in your language).
- Atomic operations and `compare-and-swap` at least at the conceptual level —
  you do not need to implement them, but you should know what they do.
- Memory visibility basics: that without synchronization, a write on one
  core might not be seen on another, and that mutexes establish a
  happens-before relationship.
- Reading concurrent code: being able to look at a function and identify
  what is shared state and what is local.

If any of those feel shaky, revisit `junior.md` and the topic on memory
models before continuing.

---

## Glossary

- **Critical section** — a region of code that must be executed by only one
  thread at a time to preserve invariants.
- **RWMutex / shared_mutex** — a lock with two modes: shared (many readers)
  and exclusive (one writer).
- **TryLock** — non-blocking attempt to acquire a lock; returns immediately
  with success or failure.
- **Timed lock** — blocking attempt with a deadline, e.g. `tryLock(timeout)`.
- **Fair lock** — grants the lock to waiters in FIFO order.
- **Unfair lock** — allows new arrivals to "barge in" ahead of waiters; can
  improve throughput at the cost of latency variance.
- **Reentrant lock** — the same thread can acquire the same lock multiple
  times without deadlocking.
- **Lock ordering** — a global rule that defines the order in which locks
  must be acquired to avoid deadlocks.
- **Lock granularity** — how much state is protected by one lock; coarse
  means a lot, fine means little.
- **Spinlock** — a lock that busy-waits in a tight loop instead of sleeping.
- **Adaptive mutex** — spins briefly, then sleeps if the lock is still held;
  typical of modern `pthread_mutex_t`.
- **Futex** — Linux primitive (Fast Userspace Mutex) that allows fast
  uncontended locking in user space and only enters the kernel on contention.
- **Lock convoy** — pathological situation where many threads end up
  serialized behind one slow lock holder, even after that holder is done.
- **Starvation** — a thread is repeatedly denied progress because others keep
  winning the lock.
- **Write starvation** — a writer cannot make progress because readers keep
  arriving in an RWMutex.

---

## Core Concepts

### Reader-writer locks (RWMutex / shared_mutex / pthread_rwlock_t)

A plain mutex treats every access the same: read or write, you wait. But
many real workloads are read-heavy — caches, config tables, routing maps.
For those, blocking all readers behind each other is wasteful.

A **reader-writer lock** has two modes:

- **Shared (read) mode** — many threads can hold the lock simultaneously,
  as long as nobody holds it in write mode.
- **Exclusive (write) mode** — only one thread can hold the lock, and no
  readers may be active.

```
| Goroutine A: RLock |---read---|
| Goroutine B: RLock     |---read---|
| Goroutine C: RLock         |---read---|
| Goroutine D: Lock                          |---WRITE---|
```

All three readers run concurrently; the writer waits until they all release.

The languages:

- **Go**: `sync.RWMutex` with `RLock()`, `RUnlock()`, `Lock()`, `Unlock()`.
- **C++17**: `std::shared_mutex` with `lock_shared()` /
  `unlock_shared()` for readers and `lock()` / `unlock()` for writers.
- **Java**: `java.util.concurrent.locks.ReentrantReadWriteLock` with
  `.readLock()` and `.writeLock()` views.
- **C / POSIX**: `pthread_rwlock_t` with `pthread_rwlock_rdlock` and
  `pthread_rwlock_wrlock`.

When does an RWMutex actually win? When reads are common, writes are rare,
and the critical section is long enough that the extra bookkeeping pays for
itself. For very short critical sections, the overhead of an RWMutex can
make it slower than a plain mutex.

### Try-lock and timed lock

A plain `Lock()` says "I will wait as long as necessary." Sometimes that is
the wrong promise. You might want to:

- Skip work if it is already in progress.
- Try a different shard if this one is busy.
- Give up after a deadline.

For this, languages provide:

- `TryLock()` — returns `true` if it got the lock, `false` if not.
- `TryLockTimeout(d)` / `try_lock_for(d)` — blocks up to a duration, then
  gives up.

```go
if mu.TryLock() {
    defer mu.Unlock()
    doWork()
} else {
    // do something else, retry later, etc.
}
```

TryLock is also a useful debugging tool. If you suspect a deadlock, you can
replace `Lock()` with a TryLock plus a timeout, log the failure, and the
code will tell you exactly which lock is being held too long.

Warning: `TryLock` is easy to abuse. A spin loop of TryLock with no backoff
is just a hand-rolled, very inefficient spinlock. Always pair it with a
sensible fallback strategy.

### Fair vs unfair mutex

A **fair** mutex grants the lock to waiters in the order they arrived (FIFO).
An **unfair** mutex lets a thread that happens to be running take the lock
even if other threads are queued, in the name of throughput.

Examples:

- Java's `ReentrantLock` can be constructed as fair (`new ReentrantLock(true)`)
  or unfair (default).
- Go's `sync.Mutex` is mostly unfair for performance but has a **starvation
  mode** (introduced in 1.9) that kicks in if a waiter has been waiting more
  than 1ms: while in starvation mode, the lock is handed directly to the
  next waiter to prevent indefinite starvation.
- `pthread_mutex_t` is typically unfair (implementation-defined).

Fair locks have higher latency under contention because every handoff
involves waking a parked thread, which costs a context switch. Unfair locks
have higher throughput because the currently-running thread can re-acquire a
just-released lock without context-switching, but a slow or unlucky thread
can be starved.

Choose fairness when you genuinely need bounded waiting (e.g. a request
queue where every request must eventually be served). Choose unfairness for
most performance-critical code.

### Recursive / reentrant mutex

A **reentrant mutex** lets the *same* thread acquire the lock multiple
times without deadlocking. The lock internally tracks a count and the owner;
only when the count returns to zero is the lock released.

```java
ReentrantLock lock = new ReentrantLock();
lock.lock();
lock.lock();   // OK, count = 2
lock.unlock(); // count = 1
lock.unlock(); // count = 0, released
```

In Go, `sync.Mutex` is **not** reentrant. Calling `Lock()` twice on the
same goroutine deadlocks immediately. This is a deliberate design choice:
the Go authors view reentrant locks as a code smell that hides design
problems.

Where reentrancy helps: you have a public method that locks, and it calls
another public method that also wants to lock. With a non-reentrant mutex
you must refactor so the inner method has a non-locking variant. With a
reentrant mutex, it Just Works — but at the price of making lock holding
much less explicit.

### Lock ordering rule and deadlocks

When code acquires more than one lock, deadlock becomes possible. The
canonical example:

```
Thread 1: Lock(A) -> Lock(B) -> ...
Thread 2: Lock(B) -> Lock(A) -> ...
```

If Thread 1 has A and Thread 2 has B, both wait forever. The standard
solution is the **lock ordering rule**: assign a global total order to all
locks (e.g. by address, by name, by ID), and require that every code path
acquires them in that order.

```go
// Pick the lower-id account first.
first, second := from, to
if first.ID > second.ID {
    first, second = second, first
}
first.mu.Lock()
second.mu.Lock()
// ...
second.mu.Unlock()
first.mu.Unlock()
```

This is mechanical, but it works. The hard part in real systems is keeping
the rule documented and enforced as the code evolves.

### Lock granularity

**Coarse-grained** locking protects a lot of state with one lock. It is
easy to reason about and rarely deadlocks, but it is a bottleneck.

**Fine-grained** locking gives each piece of state its own lock. It can
scale wonderfully but introduces more lock ordering work and more
opportunities for bugs.

A typical evolution path:

1. One global mutex around the whole structure.
2. One mutex per shard / bucket / chunk.
3. Per-node locks plus careful lock-coupling for traversals.
4. Lock-free with atomics where possible.

Each step gives you more concurrency and more pain. Stop at the level where
your performance goals are met.

### Spinlock vs blocking mutex

A **spinlock** busy-waits: it loops, checking an atomic flag until the lock
becomes free. A **blocking mutex** parks the thread in the kernel until the
lock is released.

Spinlocks win when:

- The critical section is very short (a few dozen instructions).
- Context switch cost dominates wait time.
- You are running on the same number of cores as threads (kernels, drivers).

Blocking mutexes win when:

- Critical sections might be long.
- You have more threads than cores (typical for user-space programs).
- Energy efficiency matters; spinning burns CPU.

Most modern mutexes are **hybrid**: they spin briefly (assuming a short
critical section), then fall back to sleeping if the lock is still held.
This is the adaptive mutex pattern.

### Mutex vs semaphore vs binary semaphore

- A **mutex** is owned: only the thread that locked it may unlock it. It
  is used for mutual exclusion.
- A **counting semaphore** is a counter: any thread may acquire or release,
  and the counter limits how many simultaneous holders there can be.
- A **binary semaphore** is a counting semaphore with max=1. It *looks*
  like a mutex but lacks ownership semantics — one thread can `wait` and a
  different thread can `signal`. This is useful for signaling but is a
  footgun if you want mutual exclusion.

Rule of thumb: if a single thread acquires and releases for protection, use
a mutex. If you are signaling between threads, use a semaphore or condition
variable.

### Adaptive mutex (futex on Linux)

On Linux, `pthread_mutex_t` and Go's `sync.Mutex` are both built on the
**futex** (Fast Userspace muTEX) syscall. The trick: in the uncontended
case, lock/unlock is a single atomic compare-and-swap entirely in user
space — no syscall, no context switch. Only when contention is detected
does the code enter the kernel to park or wake a waiter.

The "adaptive" part adds a brief spin before parking. The reasoning is that
the lock holder is often about to release, and spinning for a few
microseconds is cheaper than the full park/wake round trip.

This is why a mutex on Linux feels nearly free when uncontended and gets
gradually more expensive as contention rises.

### Lock convoy phenomenon

A **lock convoy** is a pathological state where a frequently-acquired lock
serializes many threads behind one slow holder. After the holder releases,
all the waiters wake up one by one, each takes the lock, does a tiny bit of
work, then releases. Because they are all woken in roughly the same time
window, they end up forming a "convoy" that travels through the lock
together, and throughput collapses to the rate of one acquisition at a
time.

Symptoms:

- CPU utilization is low but threads are blocked.
- Latency spikes correlate with a particular lock.
- Removing the lock or sharding it dramatically improves throughput.

Fixes include sharding the lock, using lock-free structures, or using a
queue with a single owning thread.

---

## Real-World Analogies

- **RWMutex** — a museum painting. Many people may look at the same time
  (readers), but when a curator wants to take it down for cleaning (writer),
  the room is closed and everyone else has to leave first.
- **TryLock** — knocking on a meeting-room door. If it is locked, you do
  not stand in the hallway waiting; you go book a different room.
- **Fair vs unfair** — a queue at a coffee shop. A fair barista serves
  strictly FIFO. An unfair barista hands the next coffee to whoever happens
  to be standing closest, which is faster overall but means quiet customers
  may wait a long time.
- **Reentrant lock** — a hotel room key card that lets the owner come back
  in repeatedly without needing a new card each time.
- **Lock ordering** — agreeing that in every recipe, you measure flour
  before sugar. Two cooks never collide if they share the rule.
- **Lock granularity** — a single big bathroom vs many small ones. One big
  door is easier to manage but creates queues; many small ones allow more
  parallelism but require more cleaning.
- **Spinlock** — pacing right outside the door, ready to walk in the
  instant it opens. Fine for a 5-second wait, miserable for an hour.
- **Adaptive mutex** — pacing for a minute, then if the door is still shut
  going to sit in the waiting area and being called when ready.
- **Lock convoy** — at a busy elevator, everyone keeps just missing the
  doors and ending up on the next trip, so the whole crowd travels together
  instead of spreading out.

---

## Mental Models

### Locks as serialization

Every lock is a chokepoint that converts parallel work into serial work
for the time the lock is held. If you draw your program as a graph of
goroutines and lock holds, the time spent inside locks is your serial
fraction. Amdahl's law then tells you the maximum speedup you can ever
get from more cores. This is why granularity matters so much — splitting
one lock into N usually divides your serial fraction by close to N.

### Readers and writers as priorities

An RWMutex is a tiny priority scheduler: when only readers want it, they
all pass; when a writer wants it, somebody has to decide whether to favor
the writer (which can starve readers) or the readers (which can starve
writers). Different implementations make different choices. Go's
`sync.RWMutex` prevents new readers from acquiring once a writer is
waiting, which avoids writer starvation at the cost of slightly increased
reader latency.

### Lock-as-token

Think of holding a lock as holding a physical token. Only one token per
mutex. You may not duplicate it, you may not give it to a friend, you
must return it before leaving the building. This model rules out a lot of
bad patterns: locking on goroutine A and unlocking on goroutine B feels
obviously wrong when you imagine someone else returning your wallet.

### The two-axes diagram of locks

Plot locks on two axes: **fairness** (unfair to fair) and **granularity**
(coarse to fine). Most performance-critical systems live in the
"unfair + fine" quadrant. Most teaching examples live in "fair + coarse"
because it is simpler to reason about. Knowing where you are on this map
helps you predict the failure modes.

---

## Code Examples

### Example 1 — Bank account with deposit/withdraw

```go
package main

import (
	"errors"
	"fmt"
	"sync"
)

type Account struct {
	mu      sync.Mutex
	id      int
	balance int
}

func NewAccount(id, balance int) *Account {
	return &Account{id: id, balance: balance}
}

func (a *Account) Deposit(amount int) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.balance += amount
}

func (a *Account) Withdraw(amount int) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.balance < amount {
		return errors.New("insufficient funds")
	}
	a.balance -= amount
	return nil
}

func (a *Account) Balance() int {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.balance
}

// Transfer demonstrates lock ordering: always lock the lower id first.
func Transfer(from, to *Account, amount int) error {
	first, second := from, to
	if first.id > second.id {
		first, second = second, first
	}
	first.mu.Lock()
	defer first.mu.Unlock()
	second.mu.Lock()
	defer second.mu.Unlock()

	if from.balance < amount {
		return errors.New("insufficient funds")
	}
	from.balance -= amount
	to.balance += amount
	return nil
}

func main() {
	a := NewAccount(1, 1000)
	b := NewAccount(2, 500)

	var wg sync.WaitGroup
	for i := 0; i < 100; i++ {
		wg.Add(2)
		go func() {
			defer wg.Done()
			_ = Transfer(a, b, 1)
		}()
		go func() {
			defer wg.Done()
			_ = Transfer(b, a, 1)
		}()
	}
	wg.Wait()
	fmt.Println("a:", a.Balance(), "b:", b.Balance())
}
```

Why this is interesting: without the `first.id < second.id` rule, two
concurrent transfers in opposite directions could deadlock. With the
rule, every transfer locks accounts in the same global order, so no
cycle can form.

### Example 2 — Dining philosophers with lock ordering

```go
package main

import (
	"fmt"
	"math/rand"
	"sync"
	"time"
)

type Fork struct {
	id int
	mu sync.Mutex
}

func philosopher(id int, left, right *Fork, wg *sync.WaitGroup) {
	defer wg.Done()
	first, second := left, right
	if first.id > second.id {
		first, second = second, first
	}
	for meal := 0; meal < 3; meal++ {
		time.Sleep(time.Duration(rand.Intn(50)) * time.Millisecond)
		first.mu.Lock()
		second.mu.Lock()
		fmt.Printf("philosopher %d eats meal %d\n", id, meal)
		time.Sleep(time.Duration(rand.Intn(20)) * time.Millisecond)
		second.mu.Unlock()
		first.mu.Unlock()
	}
}

func main() {
	const n = 5
	forks := make([]*Fork, n)
	for i := range forks {
		forks[i] = &Fork{id: i}
	}
	var wg sync.WaitGroup
	for i := 0; i < n; i++ {
		wg.Add(1)
		go philosopher(i, forks[i], forks[(i+1)%n], &wg)
	}
	wg.Wait()
}
```

Without the swap, philosopher `i` would always grab fork `i` first and
philosopher 0 in particular would create a cycle with philosopher 4. With
the swap, the global "lower id first" rule eliminates the cycle.

### Example 3 — RWMutex read-heavy cache

```go
package main

import (
	"fmt"
	"sync"
	"time"
)

type Cache struct {
	mu    sync.RWMutex
	store map[string]string
}

func NewCache() *Cache {
	return &Cache{store: make(map[string]string)}
}

func (c *Cache) Get(key string) (string, bool) {
	c.mu.RLock()
	defer c.mu.RUnlock()
	v, ok := c.store[key]
	return v, ok
}

func (c *Cache) Set(key, value string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.store[key] = value
}

func main() {
	c := NewCache()
	c.Set("hello", "world")

	var wg sync.WaitGroup
	for i := 0; i < 10; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			if v, ok := c.Get("hello"); ok {
				fmt.Printf("reader %d sees %s\n", i, v)
			}
		}(i)
	}
	// One writer racing with readers.
	wg.Add(1)
	go func() {
		defer wg.Done()
		time.Sleep(time.Microsecond)
		c.Set("hello", "world v2")
	}()
	wg.Wait()
}
```

All readers may run concurrently. The writer momentarily blocks new
readers and waits for current ones to finish. If reads dominate, this
beats a plain `sync.Mutex` for throughput.

### Example 4 — TryLock with backoff

```go
package main

import (
	"fmt"
	"math/rand"
	"sync"
	"time"
)

type Job struct {
	mu sync.Mutex
	id int
}

func process(j *Job, workerID int) {
	backoff := 1 * time.Millisecond
	for attempts := 0; attempts < 5; attempts++ {
		if j.mu.TryLock() {
			defer j.mu.Unlock()
			fmt.Printf("worker %d got job %d\n", workerID, j.id)
			time.Sleep(10 * time.Millisecond) // simulate work
			return
		}
		fmt.Printf("worker %d backing off %v\n", workerID, backoff)
		time.Sleep(backoff + time.Duration(rand.Intn(int(backoff))))
		backoff *= 2
	}
	fmt.Printf("worker %d gives up on job %d\n", workerID, j.id)
}

func main() {
	j := &Job{id: 42}
	var wg sync.WaitGroup
	for i := 0; i < 4; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			process(j, i)
		}(i)
	}
	wg.Wait()
}
```

This is the rough shape of an optimistic worker: try to claim the job, and
if you can't, back off exponentially with jitter so workers do not
synchronize their retries.

---

## Pros & Cons

### Pros of RWMutex over plain mutex
- Parallel readers can improve throughput dramatically for read-heavy
  workloads.
- Conceptually models the read/write distinction directly.

### Cons of RWMutex
- Higher overhead per operation than a plain mutex.
- Risk of writer starvation if implementation favors readers.
- More complex to reason about.
- Reentrancy and upgrade (read -> write) semantics differ between
  languages; getting them wrong causes deadlocks.

### Pros of TryLock
- Lets callers express "do this if I can, otherwise skip."
- Useful for soft locks, debouncing, and avoiding pile-up.
- Helpful diagnostic tool.

### Cons of TryLock
- Tempting to abuse as a hand-rolled spinlock.
- Can hide bugs by silently doing nothing when a lock is contended.

### Pros of fair locks
- Bounded waiting; no starvation.
- Predictable latency.

### Cons of fair locks
- Lower throughput due to enforced context switches.
- Slower in low-contention cases.

### Pros of reentrant locks
- Simpler API for recursive call chains.
- Eases refactoring of code that calls between locked methods.

### Cons of reentrant locks
- Encourages large, sprawling locked regions.
- Hides lock structure; harder to audit.
- Slightly higher overhead per acquisition.

---

## Use Cases

- **In-memory caches** — RWMutex is the textbook fit.
- **Configuration objects** — rarely written, read by many goroutines.
- **Connection pools** — `TryLock` for "give me a connection if one is
  free" semantics, fall back to opening a new one if not.
- **Resource throttling** — fair locks when you must serve clients in
  arrival order.
- **Background workers** — `TryLock` to ensure only one instance of a job
  runs at a time even if scheduled twice.
- **Graph traversals** — fine-grained per-node locks acquired in a fixed
  order to avoid deadlocks.
- **Bank-style transfers** — pair of locks acquired in canonical order.
- **Plugin systems with re-entry** — reentrant locks when a plugin may
  call back into the host.

---

## Coding Patterns

### Pattern: Always lock-order
When two or more locks may be taken together, pick a canonical order and
document it at the top of the file. The most common scheme is "by ID
ascending."

### Pattern: Short critical sections
Do as little as possible while holding the lock. Compute outside; copy in,
do the minimal mutation, copy out, release.

### Pattern: RAII / `defer Unlock`
Acquire and immediately set up the release. In Go: `defer mu.Unlock()`. In
C++: a `std::lock_guard` or `std::scoped_lock`. In Java: a `try`/`finally`
around the body. This guarantees release even on panics or exceptions.

### Pattern: Copy-then-process
Inside the critical section, copy the data you need to a local variable;
release the lock; do the slow processing on the copy. This drastically
shortens the critical section.

```go
mu.Lock()
snapshot := append([]int(nil), data...)
mu.Unlock()
result := processExpensive(snapshot)
```

### Pattern: Snapshot publication
For very read-heavy structures, store the data behind an `atomic.Pointer`
and replace the whole snapshot on write. Readers never block. Writers pay
a copy cost but are rare. This is sometimes called "copy-on-write."

### Pattern: Sharded locks
Instead of one lock for a map, split the keyspace into N shards, each with
its own lock. Contention drops by roughly a factor of N.

### Pattern: TryLock + fallback queue
If `TryLock` fails, push the work into a queue handled by the current
holder, rather than waiting. Avoids convoys.

---

## Clean Code

- Name the mutex after what it protects: `usersMu`, not `mu`.
- Place the mutex field directly above the fields it protects, and add a
  comment: `// usersMu protects users below.`
- One method, one critical section. If a method needs to do unrelated
  work, split it.
- Never hold a lock across a function call you do not control (callback,
  channel send, I/O). The user-supplied code might re-enter or block
  forever.
- Do not return values that share state with the locked region without
  copying.
- Lock fields, not whole structures, when the locking story is per-field.

---

## Best Practices

1. **Profile before adding locks.** Many "concurrency bugs" are really
   single-threaded bugs, and many "scalability issues" are really
   algorithmic ones.
2. **Use RWMutex only when reads dominate.** A useful heuristic: at least
   5:1 read:write ratio and critical sections longer than ~100ns.
3. **Avoid upgrading a read lock to a write lock.** Most APIs do not
   support it; the safe pattern is "release read, take write, re-check."
4. **Always use defer / RAII to release.** Manual `Unlock()` at the end of
   a function is a bug waiting to happen.
5. **Keep critical sections free of I/O.** Disk and network calls inside
   a lock are how you get production incidents.
6. **Document the lock order.** A single comment at the top of the file
   can prevent hours of debugging later.
7. **Prefer fine-grained over coarse-grained when you can measure the
   benefit** — but do not jump to fine-grained without data.
8. **Use a single lock per logical resource.** Two locks for the same
   data is double the bug surface.
9. **Make zero-value mutexes work.** In Go, `sync.Mutex{}` is usable
   immediately. Do not require an initializer.
10. **Run with the race detector in CI.** `go test -race` catches data
    races that no amount of code review will.

---

## Edge Cases & Pitfalls

- **Forgetting to RUnlock.** A read lock leak is just as deadly as a write
  lock leak; writers will eventually block forever.
- **Upgrading a read lock.** In Go, `RLock` then `Lock` from the same
  goroutine deadlocks because `Lock` waits for all readers, including you.
- **Copying a mutex.** A `sync.Mutex` is not safe to copy after first use.
  Passing a struct by value copies its mutex and breaks its protection.
- **Locking on a method receiver that is itself a value.** Method `func
  (a Account) Deposit()` operates on a copy; its mutex protects nothing.
- **Locking inside callbacks.** If you call user code while holding a lock,
  the user code might call back into your code and try to take the same
  lock; with non-reentrant locks that is an instant deadlock.
- **TryLock loop without backoff.** That is a spinlock. On a busy core, it
  burns CPU without making progress.
- **Long critical sections.** Anything more than tens of microseconds is
  suspicious; anything that does I/O is almost certainly wrong.
- **Mixing lock-free reads with locked writes** without proper memory
  fences — you may see torn or stale values.
- **Returning pointers from inside a critical section** to data still
  protected by that lock — caller dereferences without holding the lock.

---

## Common Mistakes

- Treating an RWMutex as "the better mutex." For short critical sections
  it can be slower than `sync.Mutex` because of extra bookkeeping.
- Forgetting that Go's `sync.Mutex` is not reentrant and recursing into a
  locked method.
- Using `TryLock` and ignoring the false return value, silently dropping
  work.
- Holding a lock while sending on an unbuffered channel — the goroutine
  reading the channel might need the same lock.
- Acquiring locks in different orders in different code paths.
- Using `defer mu.Unlock()` at the top of a long function whose critical
  section should be smaller — `defer` makes the lock last until the
  function returns.
- Forgetting that mutexes contribute to memory ordering. People sometimes
  remove a mutex thinking "it's just one int", losing memory visibility
  guarantees.
- Adding `runtime.Gosched()` after `Lock()` in the hope of being "fair."
  It just hurts performance.
- Using a binary semaphore as a "mutex" between threads, then accidentally
  unlocking from a different thread.

---

## Tricky Points

- **Go's RWMutex prevents new readers when a writer is waiting.** This
  means a thundering herd of readers cannot starve a writer indefinitely,
  but it also means that during high write activity, RWMutex behaves more
  like a Mutex.
- **`std::shared_mutex` in C++ does not guarantee writer preference.**
  The standard leaves it implementation-defined. Different platforms may
  behave differently.
- **Lock upgrades and downgrades.** Downgrading (write -> read) is
  usually safe and supported. Upgrading (read -> write) is usually not
  supported and tends to deadlock — for upgrade scenarios, release and
  re-acquire and double-check invariants.
- **Recursive locks have hidden costs.** Each acquisition does extra
  bookkeeping (owner thread, count), and they make it harder to reason
  about lock scope.
- **Spinning vs sleeping on a single-core machine.** Spinning is
  pointless because the holder cannot make progress while you spin.
  Adaptive mutexes detect this on some platforms.
- **Go's mutex starvation mode** changes behavior under load. Code that
  benchmarks fine in low contention can behave quite differently when a
  waiter has been stuck for 1ms.
- **Fairness has subtle consequences for memory ordering** because waking
  a thread is itself a synchronization point.

---

## Test Yourself

1. Two threads run `Lock(A); Lock(B)` and `Lock(B); Lock(A)`. Why is this
   a deadlock, and how does lock ordering fix it?
2. When does an RWMutex underperform a plain Mutex?
3. What is the difference between `TryLock` and `Lock` with a zero
   timeout?
4. In Go, what happens if you call `Lock()` twice from the same goroutine
   on a `sync.Mutex`?
5. Describe the lock convoy phenomenon in your own words. How can you
   detect one in production?
6. Why is `sync.Mutex` not safe to copy after first use?
7. Suppose you want at most one instance of a background job to run at a
   time, but you do not want to queue. Which lock primitive fits?
8. What is the difference between fair and unfair locks, and when would
   you choose each?
9. Why is a binary semaphore not a substitute for a mutex?
10. What does "adaptive" mean for a mutex, and why is it beneficial on
    Linux?

---

## Tricky Questions

1. **Q:** You have an in-memory cache and want both `Get` and `GetOrLoad`,
   where `GetOrLoad` may take a long time to load if the key is missing.
   Should the load happen while holding the write lock?
   **A:** No. Hold the read lock, check, release, then either return or
   transition to "loading." A common pattern is to keep a per-key
   `sync.Once` so concurrent loads of the same key share a single load.

2. **Q:** A profiler shows your `sync.Mutex` is the top hot spot. Should
   you switch to `sync.RWMutex`?
   **A:** Only if the workload is read-heavy and your critical sections
   are non-trivial. Sometimes the right answer is sharding the lock, not
   switching to RWMutex.

3. **Q:** You use `TryLock` inside a loop with no sleep. Performance is
   poor. Why?
   **A:** You wrote a spinlock with cache-line contention; the loop hammers
   the lock variable across cores, evicting cache lines. Add a backoff or
   restructure.

4. **Q:** Your code locks accounts in transfer like `from.Lock();
   to.Lock();`. It works in tests. Why does it deadlock in production?
   **A:** Two concurrent transfers `A -> B` and `B -> A` produce opposite
   acquisition orders. Tests with one direction never hit this. Add lock
   ordering by account ID.

5. **Q:** You have a Go RWMutex and a writer is waiting. New readers keep
   arriving. Are they blocked or do they proceed?
   **A:** New readers block. Go's implementation prevents new readers from
   acquiring while a writer is waiting, to avoid writer starvation.

6. **Q:** A reentrant lock has an internal "count + owner." Two threads
   share a reentrant lock. Why does this still serialize them?
   **A:** Reentrancy only helps the same owner. If a different thread
   wants the lock, it still waits. Reentrancy is not about parallelism;
   it is about recursion.

7. **Q:** You see `pthread_mutex_lock` return EOWNERDEAD. What does it
   mean?
   **A:** The previous owner died while holding the lock. You acquired it,
   but the state it protected may be inconsistent. You can mark it
   consistent or unrecoverable.

8. **Q:** Your service exposes per-request latency p99 spikes correlated
   with a particular `sync.Mutex`. What likely diagnoses fit?
   **A:** Lock convoy, GC pause, long I/O while locked, or starvation mode
   kicking in. Look at lock-hold duration histograms.

---

## Cheat Sheet

```
PRIMITIVE                  WHEN TO USE
sync.Mutex                 Default. Short, exclusive critical sections.
sync.RWMutex               Read-heavy data, longer critical sections.
TryLock                    Opportunistic claim; skip work if busy.
TryLockTimeout             Bounded wait; soft deadline for a section.
Reentrant lock             Recursive call chains, public methods that
                           call other locked methods. Avoid if possible.
Fair lock                  Strict FIFO; bounded waiting required.
Unfair lock                Throughput-first; default everywhere else.

LOCK ORDER                 Always acquire by canonical order (e.g. ID).
DEFER UNLOCK               Pair Lock with defer Unlock immediately.
COPY-THEN-PROCESS          Snapshot under lock; process outside.
SHARDED LOCKS              Reduce contention by splitting keyspace.
NO I/O UNDER LOCK          Network and disk inside a lock = incident.
NO CALLBACK UNDER LOCK     User-supplied code may re-enter.
```

---

## Summary

At the middle level, mutexes stop being a single concept and become a
family of trade-offs. Reader-writer locks buy parallelism for read-heavy
workloads but charge overhead. TryLock and timed locks let callers
control how patient they are. Fairness lets you choose between
predictable latency and raw throughput. Reentrant locks reduce friction
for recursive call chains but hide structure. Spinlocks and adaptive
mutexes exploit the difference between short and long waits. Lock
granularity decides whether your program can scale or not.

The thing that ties all this together is **discipline**: short critical
sections, clear lock ordering, careful naming, defer/RAII for release,
and constant attention to what you do inside the lock. The juniors
learn the syntax. The middles learn the trade-offs. The seniors learn
when not to use a mutex at all — but we will get to that.

---

## What You Can Build

- A read-heavy in-memory cache with `RWMutex` and per-key `sync.Once`
  to deduplicate loads.
- A bank-style transfer system with deadlock-free pair locking.
- A worker pool that uses `TryLock` to claim jobs and exponential
  backoff to avoid convoys.
- A sharded hash map that splits a global map into 32 mutex-protected
  buckets.
- A connection pool that uses timed locks to bound checkout latency.
- A configuration hot-reload system using `atomic.Pointer` for
  copy-on-write reads.
- A graph traversal library that uses fixed-order per-node locks.

---

## Further Reading

- Russ Cox, "Go memory model" — the foundational reference for what
  Go's mutexes guarantee.
- Dmitry Vyukov, "Mutex design in Go 1.9" — explains the starvation
  mode.
- Maurice Herlihy and Nir Shavit, *The Art of Multiprocessor
  Programming* — chapters on spin locks and queue locks.
- Linux man pages: `pthread_mutex_init`, `futex`,
  `pthread_rwlock_init`.
- Java documentation: `ReentrantLock`, `ReentrantReadWriteLock`,
  `StampedLock`.
- C++ reference: `std::shared_mutex`, `std::lock_guard`,
  `std::scoped_lock`.
- Sutter / Alexandrescu, *C++ Coding Standards*, items on locking.
- Brendan Gregg's blog posts on lock profiling with perf and
  off-cpu analysis.

---

## Related Topics

- [Atomics and memory ordering](../02-atomics/README.md)
- [Condition variables](../03-condition-variables/README.md)
- [Semaphores](../04-semaphores/README.md)
- [Channels vs locks](../../03-models/README.md)
- [Lock-free data structures](../../04-lock-free/README.md)
- [Race detection and tooling](../../05-tooling/README.md)
- [Memory model fundamentals](../../../memory-model/README.md)

---

## Diagrams & Visual Aids

### Reader-writer lock state machine

```
              +--------------------+
              |                    |
              v                    |
   +------------------+   RUnlock  |
   |  Shared (R..R)   |------------+
   +------------------+
            |  ^
   writer   |  | all readers done
   arrives  v  |
   +------------------+
   |  Writer waiting  |
   +------------------+
            |
            v
   +------------------+
   |   Exclusive      |
   +------------------+
            |
            v   Unlock
        +-------+
        | Free  |
        +-------+
```

### Lock-ordering eliminates deadlock

```
Without ordering:
    T1: Lock(A) ----+
                    |---> Lock(B)  blocks (T2 holds B)
    T2: Lock(B) ----+
                    |---> Lock(A)  blocks (T1 holds A)
    => DEADLOCK

With "lower id first":
    T1: Lock(A) -> Lock(B)
    T2: Lock(A) -> Lock(B)   (waits for T1 to release A)
    => No cycle, eventually progresses.
```

### Adaptive mutex timeline

```
time --->
| try CAS | spin spin spin spin | park (kernel) | woken | own lock |
   ^         ^                       ^                    ^
   |         | hopes holder releases | full syscall       | resume
   | uncontended path                | cost only on real contention
```

### Lock convoy

```
Holder:    |---work---|release|
Waiter 1:           wakes->lock->|tiny work|release|
Waiter 2:                              wakes->lock->|tiny work|release|
Waiter 3:                                                  wakes->lock->|...
Effective throughput = 1 / (wake + lock + work)
```

### Coarse vs fine granularity throughput

```
Throughput
   ^
   |                 *  fine-grained (8 shards)
   |             *
   |         *
   |       *  *
   |    *           *  coarse (single mutex saturates)
   |  *
   +------------------------>  cores
```

---

