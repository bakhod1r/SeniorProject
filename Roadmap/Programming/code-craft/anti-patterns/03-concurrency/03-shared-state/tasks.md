# Shared State Anti-Patterns — Exercises

> **Category:** [Concurrency Anti-Patterns](../README.md) → **Shared State** — *hands-on practice making mutable state safe under parallelism.*
> **Covers (collectively):** Shared Mutable State Without Protection · Busy Waiting / Spin Loop · Thread-Per-Request Without Bounds

---

These are **fix-it** exercises, not recognition quizzes. Each gives you a problem statement, broken starting code (Go or Java — the language varies on purpose; Python notes appear where the GIL changes the story), acceptance criteria with hints, and a collapsible solution carrying *correct, idiomatic* concurrent code plus a "why it's correct/scalable" note.

> **How to use this file.** Read the problem, try it in your editor *before* opening the solution. For Go exercises, **always run with `-race`** (`go test -race`, `go run -race`) — it is the single most valuable tool in this chapter. A test that passes once proves nothing; a race detector that stays silent across thousands of iterations is real evidence. For Java, reason about the *happens-before* edges, not about "it worked on my laptop."
>
> The point is to *make the change*: protect a counter three different ways, confine state to one owner, replace a spin loop with a real wake-up, bound an unbounded server, and pad away false sharing. Refer back to [`junior.md`](junior.md) for the shapes and [`middle.md`](middle.md) for the countermoves.

---

## Table of Contents

| # | Exercise | Anti-pattern(s) | Lang | Difficulty |
|---|---|---|---|---|
| 1 | [Make the shared counter safe — three ways](#exercise-1--make-the-shared-counter-safe--three-ways) | Shared Mutable State | Go | ★ easy |
| 2 | [Protect the shared map](#exercise-2--protect-the-shared-map) | Shared Mutable State | Go | ★ easy |
| 3 | [Replace the spin loop with a wake-up](#exercise-3--replace-the-spin-loop-with-a-wake-up) | Busy Waiting | Go | ★ easy |
| 4 | [Wait for N workers without polling](#exercise-4--wait-for-n-workers-without-polling) | Busy Waiting | Go | ★ easy |
| 5 | [Confine the state to one owner](#exercise-5--confine-the-state-to-one-owner) | Shared Mutable State | Go | ★★ medium |
| 6 | [Fix the check-then-act on a shared map](#exercise-6--fix-the-check-then-act-on-a-shared-map) | Shared Mutable State | Java | ★★ medium |
| 7 | [Replace the busy-wait flag with a condition variable](#exercise-7--replace-the-busy-wait-flag-with-a-condition-variable) | Busy Waiting | Java | ★★ medium |
| 8 | [Bound the thread-per-request server](#exercise-8--bound-the-thread-per-request-server) | Thread-Per-Request | Go | ★★ medium |
| 9 | [Replace thread-per-task with a bounded executor](#exercise-9--replace-thread-per-task-with-a-bounded-executor) | Thread-Per-Request | Java | ★★ medium |
| 10 | [Add backpressure, don't drop or buffer forever](#exercise-10--add-backpressure-dont-drop-or-buffer-forever) | Thread-Per-Request + Shared State | Go | ★★★ hard |
| 11 | [Kill false sharing with padding](#exercise-11--kill-false-sharing-with-padding) | Shared Mutable State (cache line) | Go | ★★★ hard |
| 12 | [Pad the false-sharing hotspot in Java](#exercise-12--pad-the-false-sharing-hotspot-in-java) | Shared Mutable State (cache line) | Java | ★★★ hard |
| 13 | [Mini-project: the metrics aggregator](#exercise-13--mini-project-the-metrics-aggregator) | All three | Go | ★★★★ project |
| 14 | [Judgment: when is a bounded spin / small fan-out acceptable?](#exercise-14--judgment-when-is-a-bounded-spin--small-fan-out-acceptable) | meta | — | ★★★ hard |

---

## Exercise 1 — Make the shared counter safe — three ways

**Anti-pattern:** Shared Mutable State Without Protection · **Language:** Go · **Difficulty:** ★ easy

The classic. A thousand goroutines each increment a shared `int` a thousand times; the final total is almost never 1,000,000.

```go
func main() {
	counter := 0
	var wg sync.WaitGroup
	for i := 0; i < 1000; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := 0; j < 1000; j++ {
				counter++ // DATA RACE: read-modify-write is not atomic
			}
		}()
	}
	wg.Wait()
	fmt.Println(counter) // want 1000000, get e.g. 947213
}
```

**Acceptance criteria**
- Final value is *deterministically* 1,000,000.
- `go run -race main.go` reports **no** data race.
- Provide **three** correct variants: a `sync.Mutex`, a `sync/atomic` counter, and a confinement-by-channel approach. Note which you would ship.

**Hint:** `counter++` is three operations (load, add, store). Any two goroutines can interleave between them. A mutex serializes the whole read-modify-write; `atomic.AddInt64` makes it one indivisible instruction; confinement removes the sharing entirely.

<details>
<summary>Solution</summary>

**Variant A — `sync.Mutex` (serialize the read-modify-write):**

```go
var (
	mu      sync.Mutex
	counter int
)
// inside the loop:
mu.Lock()
counter++
mu.Unlock()
```

**Variant B — `sync/atomic` (one indivisible instruction — fastest here):**

```go
var counter int64
// inside the loop:
atomic.AddInt64(&counter, 1)
// read the final value with atomic.LoadInt64(&counter)
```

**Variant C — confinement (one owner goroutine; the count is never shared):**

```go
func main() {
	increments := make(chan int)
	done := make(chan int)

	// The ONLY goroutine that touches `counter`. No lock needed —
	// the value is confined to this goroutine's stack.
	go func() {
		counter := 0
		for n := range increments {
			counter += n
		}
		done <- counter
	}()

	var wg sync.WaitGroup
	for i := 0; i < 1000; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := 0; j < 1000; j++ {
				increments <- 1
			}
		}()
	}
	wg.Wait()
	close(increments)
	fmt.Println(<-done) // 1000000
}
```

**Why each is correct.**
- *Mutex* establishes a happens-before edge: one goroutine's unlock synchronizes-with the next lock, so every increment sees the previous one. Correct, but contended by 1,000 goroutines.
- *Atomic* compiles to a single `LOCK XADD`-style instruction the hardware guarantees is indivisible — lowest overhead, no critical section to forget to close.
- *Confinement* sidesteps the problem: if only one goroutine ever touches the variable, there is no shared state to protect. "Don't communicate by sharing memory; share memory by communicating." Most scalable when the per-item work is non-trivial, but for a bare `++` the channel hand-off costs far more than an atomic add.

**What I'd ship:** for a counter, **atomic**. Reach for the mutex when you update several fields together; reach for confinement when the owner does real work, not just `+1`.

</details>

---

## Exercise 2 — Protect the shared map

**Anti-pattern:** Shared Mutable State Without Protection · **Language:** Go · **Difficulty:** ★ easy

A `map` written from multiple goroutines is not merely racy — concurrent map writes make the Go runtime **panic and crash the process** (`fatal error: concurrent map writes`). This one counts word frequencies in parallel.

```go
func countWords(docs []string) map[string]int {
	counts := make(map[string]int)
	var wg sync.WaitGroup
	for _, doc := range docs {
		wg.Add(1)
		go func(d string) {
			defer wg.Done()
			for _, w := range strings.Fields(d) {
				counts[w]++ // concurrent map write -> runtime crash
			}
		}(doc)
	}
	wg.Wait()
	return counts
}
```

**Acceptance criteria**
- No `fatal error: concurrent map writes`; `-race` is clean.
- Result is correct for any input.
- Show the simple lock fix, then a *more scalable* shard/merge approach and say when it pays off.

**Hint:** the easy fix wraps each `counts[w]++` in a mutex. The scalable fix gives each goroutine its *own* map (confinement) and merges at the end, so the hot inner loop never contends.

<details>
<summary>Solution</summary>

**Fix A — guard the map with a mutex:**

```go
func countWords(docs []string) map[string]int {
	counts := make(map[string]int)
	var mu sync.Mutex
	var wg sync.WaitGroup
	for _, doc := range docs {
		wg.Add(1)
		go func(d string) {
			defer wg.Done()
			for _, w := range strings.Fields(d) {
				mu.Lock()
				counts[w]++
				mu.Unlock()
			}
		}(doc)
	}
	wg.Wait()
	return counts
}
```

Correct, but the goroutines now serialize on a single lock for *every word* — under heavy load this is barely faster than running on one core.

**Fix B — per-goroutine maps, merge once (confinement + reduce):**

```go
func countWords(docs []string) map[string]int {
	partials := make([]map[string]int, len(docs))
	var wg sync.WaitGroup
	for i, doc := range docs {
		wg.Add(1)
		go func(i int, d string) {
			defer wg.Done()
			local := make(map[string]int) // owned by this goroutine alone
			for _, w := range strings.Fields(d) {
				local[w]++ // no lock: not shared
			}
			partials[i] = local // distinct index per goroutine — no overlap
		}(i, doc)
	}
	wg.Wait()

	merged := make(map[string]int)
	for _, p := range partials { // single-threaded merge
		for w, n := range p {
			merged[w] += n
		}
	}
	return merged
}
```

**Why it's correct and scalable.** Fix A is correct because the mutex serializes every map mutation, but it makes the lock the bottleneck. Fix B removes the sharing from the hot path entirely: each goroutine mutates only its own `local` map, and each writes to a *distinct* slice index, so there is no shared mutable state during the parallel phase. The only coordination is the `wg.Wait()` barrier and a cheap single-threaded merge. This map-reduce shape is the one that actually scales with cores, and it is the default for parallel aggregation. (For a read-mostly map, `sync.Map` is another option — but it is slower than a plain map under write-heavy load, so prefer shard/merge here.)

> **Python note:** the GIL prevents the *interpreter* from corrupting a `dict`'s internal structure, so you will not get a hard crash — but `counts[w] += 1` is still a non-atomic bytecode sequence and *will* lose updates under threads. The shard-and-merge fix applies unchanged; for CPU-bound counting, `multiprocessing` (separate memory) beats threads regardless.

</details>

---

## Exercise 3 — Replace the spin loop with a wake-up

**Anti-pattern:** Busy Waiting / Spin Loop · **Language:** Go · **Difficulty:** ★ easy

A worker polls a shared boolean until a producer flips it. This burns a full CPU core doing nothing, and — worse — the read is itself a data race.

```go
var ready bool // written by one goroutine, spun on by another

func consumer() {
	for !ready { // busy wait: 100% CPU, and a data race on `ready`
	}
	fmt.Println("go!")
}

func producer() {
	time.Sleep(50 * time.Millisecond)
	ready = true
}
```

**Acceptance criteria**
- The consumer blocks (uses ~0% CPU) until signaled, then proceeds immediately.
- No data race on the signal.
- Use the idiomatic Go primitive for "one-shot signal."

**Hint:** the canonical Go answer to "wake me when this happens" is a channel. Closing a channel is a broadcast that every receiver observes; it also establishes the happens-before edge that makes the signal safe.

<details>
<summary>Solution</summary>

```go
func main() {
	ready := make(chan struct{}) // signal channel; struct{} carries no data

	go func() { // consumer
		<-ready // blocks, parked by the runtime — zero CPU
		fmt.Println("go!")
	}()

	time.Sleep(50 * time.Millisecond)
	close(ready) // broadcast: unblocks every receiver, now and future
}
```

**Why it's correct and efficient.** `<-ready` parks the goroutine on the runtime's scheduler until the channel becomes ready — it consumes no CPU while waiting, unlike the spin loop that pegged a core. `close(ready)` is the idiomatic one-shot broadcast: a receive from a closed channel returns immediately, so *any number* of waiting consumers wake up. Crucially, the channel operation also carries the **happens-before guarantee** — everything the producer did before `close` is visible to the consumer after `<-ready`, which is exactly the memory-visibility the racy boolean lacked. (If you genuinely need a reusable on/off flag rather than a one-shot, use `sync.Cond` as in Exercise 7, or `context.Context` for cancellation.)

</details>

---

## Exercise 4 — Wait for N workers without polling

**Anti-pattern:** Busy Waiting / Spin Loop · **Language:** Go · **Difficulty:** ★ easy

The main goroutine spins on a counter to detect when all workers have finished. It wastes CPU and races on `done`.

```go
func main() {
	const n = 8
	var done int32
	for i := 0; i < n; i++ {
		go func() {
			work()
			atomic.AddInt32(&done, 1) // at least this part is atomic...
		}()
	}
	for atomic.LoadInt32(&done) < n { // ...but spinning to wait is the anti-pattern
	}
	fmt.Println("all workers finished")
}
```

**Acceptance criteria**
- The main goroutine blocks instead of spinning.
- The completion signal is correct and race-free.
- Use the purpose-built primitive.

**Hint:** "wait until a known number of goroutines finish" is precisely what `sync.WaitGroup` exists for. `Add` before you launch, `Done` when each finishes, `Wait` to block.

<details>
<summary>Solution</summary>

```go
func main() {
	const n = 8
	var wg sync.WaitGroup
	for i := 0; i < n; i++ {
		wg.Add(1) // count the worker BEFORE launching it
		go func() {
			defer wg.Done() // defer guarantees Done even on panic/early return
			work()
		}()
	}
	wg.Wait() // blocks, parked — zero CPU — until the counter hits zero
	fmt.Println("all workers finished")
}
```

**Why it's correct.** `WaitGroup` is a counting latch built for exactly this. `wg.Wait()` parks the caller until the internal counter reaches zero, so there is no spinning and no wasted core. Two rules make it correct: call `wg.Add(1)` *before* the `go` statement (calling it inside the goroutine races with `Wait`), and use `defer wg.Done()` so the count is decremented even if the worker panics. The library guarantees the happens-before edge between each `Done` and the `Wait`'s return, so any results the workers wrote are visible after `Wait`.

</details>

---

## Exercise 5 — Confine the state to one owner

**Anti-pattern:** Shared Mutable State Without Protection · **Language:** Go · **Difficulty:** ★★ medium

A bank `Account` is mutated by many goroutines through a sprinkling of ad-hoc locking that is easy to get wrong (someone will forget a `Lock`). Refactor to **confine** the balance to a single owner goroutine so locking is impossible to forget.

```go
type Account struct {
	mu      sync.Mutex
	balance int
}

func (a *Account) Deposit(n int)  { a.balance += n }        // BUG: forgot to lock
func (a *Account) Withdraw(n int) { a.mu.Lock(); a.balance -= n; a.mu.Unlock() }
func (a *Account) Balance() int   { return a.balance }       // BUG: racy read
```

**Acceptance criteria**
- There is exactly one goroutine that ever touches the balance; no caller can forget a lock because there is no lock to forget.
- `Deposit`, `Withdraw`, and `Balance` remain callable concurrently from many goroutines.
- A withdrawal that would overdraw is rejected; `-race` is clean.

**Hint:** model the account as a goroutine that owns the balance and serves requests over a channel. Each public method sends a typed command; reads send a reply channel so the caller gets the value back. This is the actor / serialization pattern.

<details>
<summary>Solution</summary>

```go
type Account struct {
	deposits  chan int
	withdraws chan withdrawReq
	balances  chan chan int
}

type withdrawReq struct {
	amount int
	ok     chan bool
}

func NewAccount(initial int) *Account {
	a := &Account{
		deposits:  make(chan int),
		withdraws: make(chan withdrawReq),
		balances:  make(chan chan int),
	}
	go a.run(initial) // the sole owner of `balance`
	return a
}

// run is the ONLY function that touches balance — confinement.
func (a *Account) run(balance int) {
	for {
		select {
		case n := <-a.deposits:
			balance += n
		case req := <-a.withdraws:
			if req.amount <= balance {
				balance -= req.amount
				req.ok <- true
			} else {
				req.ok <- false
			}
		case reply := <-a.balances:
			reply <- balance
		}
	}
}

func (a *Account) Deposit(n int) { a.deposits <- n }

func (a *Account) Withdraw(n int) bool {
	req := withdrawReq{amount: n, ok: make(chan bool)}
	a.withdraws <- req
	return <-req.ok
}

func (a *Account) Balance() int {
	reply := make(chan int)
	a.balances <- reply
	return <-reply
}
```

**Why it's correct and robust.** The balance lives on the `run` goroutine's stack; *no other goroutine has a reference to it*. The `select` processes one request at a time, so deposit/withdraw/balance are serialized by construction — there is no lock to acquire and therefore none to forget, which kills the entire class of bug in the original (the missing `Lock` in `Deposit`, the racy `Balance`). The check-then-act in `Withdraw` ("is there enough? then subtract") is atomic because it runs inside one `select` case with no interleaving. Channels carry the happens-before edges, so `-race` is clean.

**Trade-off to know:** confinement adds a round-trip per call, so it is the right model when the owner does meaningful work or coordinates *several* fields atomically — not when a single `atomic.AddInt64` would do. For a one-field counter, prefer Exercise 1's atomic; for a multi-field invariant like this account, confinement (or a mutex guarding all fields together) is the clearer design.

</details>

---

## Exercise 6 — Fix the check-then-act on a shared map

**Anti-pattern:** Shared Mutable State Without Protection (compound action) · **Language:** Java · **Difficulty:** ★★ medium

Swapping `HashMap` for `ConcurrentHashMap` makes each *single* operation thread-safe — but this code does a **check-then-act** across two operations, which is still a race even on a concurrent map.

```java
class SessionRegistry {
    private final Map<String, Session> sessions = new ConcurrentHashMap<>();

    // Two threads can both see "absent", both create, one session is lost
    // and may leak its underlying resource.
    Session getOrCreate(String id) {
        if (!sessions.containsKey(id)) {   // check
            sessions.put(id, new Session(id)); // act — not atomic together
        }
        return sessions.get(id);
    }
}
```

**Acceptance criteria**
- For a given `id`, exactly one `Session` is ever created, even under concurrent calls.
- No explicit locking if a built-in atomic primitive can express it.
- Explain why `ConcurrentHashMap` alone did not fix it.

**Hint:** `ConcurrentHashMap` makes individual methods atomic, not your *sequence* of them. Collapse the check-and-act into one atomic call: `computeIfAbsent`.

<details>
<summary>Solution</summary>

```java
class SessionRegistry {
    private final Map<String, Session> sessions = new ConcurrentHashMap<>();

    Session getOrCreate(String id) {
        // Atomic check-and-create: the mapping function runs at most once per
        // absent key, under the map's per-bin lock.
        return sessions.computeIfAbsent(id, Session::new);
    }
}
```

**Why it's correct.** The original bug was a **compound action**: `containsKey` then `put` are each individually atomic, but another thread can slip between them, so two threads both observe "absent" and both construct a `Session` — one is silently overwritten and may leak (an open socket, a file handle). `computeIfAbsent` fuses the test and the insertion into a *single* atomic operation: the map guarantees the mapping function is invoked at most once for an absent key, holding the bin lock for that key while it runs. The takeaway generalizes far beyond maps: **a thread-safe collection does not make your multi-step logic thread-safe** — you must make the *compound* action atomic, either with a primitive like `computeIfAbsent`/`putIfAbsent` or by holding a lock across the whole sequence.

> Caveat: keep the mapping function cheap and free of side effects that touch the same map, since it runs while the bin is locked. For an expensive-to-build session, build it outside and use `putIfAbsent`, discarding your candidate if you lost the race.

</details>

---

## Exercise 7 — Replace the busy-wait flag with a condition variable

**Anti-pattern:** Busy Waiting / Spin Loop · **Language:** Java · **Difficulty:** ★★ medium

A bounded buffer's consumers spin-poll until an item appears, pegging the CPU and (because the flag isn't `volatile`) potentially never seeing the update at all.

```java
class Queue<T> {
    private final List<T> items = new ArrayList<>();
    private final int capacity;
    Queue(int capacity) { this.capacity = capacity; }

    T take() {
        while (items.isEmpty()) {
            // busy wait: burns CPU; also unsynchronized read of `items`
        }
        synchronized (this) { return items.remove(0); }
    }

    void put(T item) {
        while (items.size() >= capacity) {
            // busy wait again
        }
        synchronized (this) { items.add(item); }
    }
}
```

**Acceptance criteria**
- Producers and consumers **block** (no CPU spin) until space/an item is available.
- No lost wakeups; the wait condition is re-checked in a loop (guard against spurious wakeups).
- Correct under many producers and many consumers.

**Hint:** use `wait()`/`notifyAll()` inside a `synchronized` block — the only correct place to call them. *Always* re-check the condition in a `while` loop, never an `if`, because of spurious wakeups and the fact that another thread may win the lock first. Prefer `notifyAll()` over `notify()` when both producers and consumers wait on the same monitor.

<details>
<summary>Solution</summary>

```java
class BlockingQueue<T> {
    private final Queue<T> items = new ArrayDeque<>();
    private final int capacity;
    BlockingQueue(int capacity) { this.capacity = capacity; }

    synchronized T take() throws InterruptedException {
        while (items.isEmpty()) {
            wait(); // releases the monitor and parks; re-acquires on wake
        }
        T item = items.remove();
        notifyAll(); // a slot freed up — wake any blocked producer
        return item;
    }

    synchronized void put(T item) throws InterruptedException {
        while (items.size() >= capacity) {
            wait();
        }
        items.add(item);
        notifyAll(); // an item arrived — wake any blocked consumer
    }
}
```

**Why it's correct and efficient.** A blocked thread in `wait()` is *descheduled* — it uses no CPU until another thread calls `notifyAll()` on the same monitor, versus the spin loop that burned a core checking a flag. Three details make it correct:

1. **`wait`/`notify` inside `synchronized`.** `wait()` atomically releases the monitor and parks the thread, then re-acquires the monitor before returning; calling it without holding the monitor throws `IllegalMonitorStateException`. This atomic release-and-park is what closes the lost-wakeup window.
2. **`while`, not `if`.** On waking, the thread must re-test the condition: it may have been a spurious wakeup, or another consumer may have grabbed the item first. A bare `if` would proceed on a false assumption.
3. **`notifyAll`, not `notify`.** Producers and consumers wait on the same monitor; `notify()` might wake the *wrong* kind of waiter and let the right one sleep forever. `notifyAll` wakes everyone, and the `while` re-checks send the wrong ones back to sleep.

**In production, don't hand-roll this** — use `java.util.concurrent.ArrayBlockingQueue`, which gives you exactly this behavior (with separate `notFull`/`notEmpty` `Condition`s for efficiency) and is battle-tested. This exercise is to understand what that class does under the hood.

</details>

---

## Exercise 8 — Bound the thread-per-request server

**Anti-pattern:** Thread-Per-Request Without Bounds · **Language:** Go · **Difficulty:** ★★ medium

This server spawns an unbounded goroutine per request. Each one allocates a stack and (worse) opens a DB connection, so a traffic spike exhausts connections and memory and the whole process falls over.

```go
func serve(reqs <-chan Request, db *DB) {
	for req := range reqs {
		go func(r Request) { // unbounded: one goroutine per request, forever
			conn := db.Connect() // each opens a DB connection — pool exhausts
			defer conn.Close()
			handle(r, conn)
		}(req)
	}
}
```

**Acceptance criteria**
- The number of *concurrently executing* handlers never exceeds a fixed limit `N`.
- All requests are still processed (none dropped) — they queue and wait their turn.
- `N` is the bound on the expensive resource (DB connections), and it is configurable.

**Hint:** the fix is a **worker pool**: launch exactly `N` long-lived goroutines that range over the request channel. The channel itself is the work queue; the number of workers is your concurrency cap. Use `sync.WaitGroup` for clean shutdown.

<details>
<summary>Solution</summary>

```go
func serve(reqs <-chan Request, db *DB, workers int) {
	var wg sync.WaitGroup
	for i := 0; i < workers; i++ { // exactly `workers` goroutines, total
		wg.Add(1)
		go func() {
			defer wg.Done()
			for req := range reqs { // each worker pulls the next request
				conn := db.Connect()
				handle(req, conn)
				conn.Close()
			}
		}()
	}
	wg.Wait() // returns when reqs is closed and drained
}
```

**Why it's correct and scalable.** Concurrency is now *bounded by construction*: there are exactly `workers` goroutines and never more, so at most `workers` requests run at once and at most `workers` DB connections are in use — set `workers` to match the connection pool size. The request channel is the queue; when all workers are busy, new requests simply wait in the channel buffer (or block the sender, which is the backpressure you usually want — see Exercise 10) instead of spawning new goroutines that pile up until the machine dies. Closing `reqs` makes every `range` loop exit, and `wg.Wait()` blocks until all in-flight work drains — clean shutdown. This is the difference between *unbounded fan-out* (each arrival creates a new worker) and a *fixed pool* (a constant number of workers consume a queue), and it is the foundation of every production server's request handling.

> **Tuning note:** the right `workers` value is set by the bottleneck resource. For DB-bound work, size it to the connection pool; for CPU-bound work, `runtime.NumCPU()` is the starting point; for I/O-bound work it can be much higher. Profile, don't guess.

</details>

---

## Exercise 9 — Replace thread-per-task with a bounded executor

**Anti-pattern:** Thread-Per-Request Without Bounds · **Language:** Java · **Difficulty:** ★★ medium

This batch processor starts a raw `Thread` per file. Ten thousand files means ten thousand OS threads — each ~1 MB of stack — and the JVM throws `OutOfMemoryError: unable to create new native thread`.

```java
void processAll(List<File> files) {
    for (File f : files) {
        new Thread(() -> process(f)).start(); // one OS thread per file — unbounded
    }
    // also: no way to know when they all finish, no error handling
}
```

**Acceptance criteria**
- A fixed-size pool runs the work; the thread count is bounded regardless of `files.size()`.
- The method waits for all tasks to complete and surfaces failures.
- The executor is shut down cleanly (no leaked threads).

**Hint:** use an `ExecutorService` from `Executors.newFixedThreadPool(n)`. Submit tasks, collect the `Future`s, then `get()` each to both *wait* and *propagate exceptions*. Always shut the pool down in a `finally` (or use try-with-resources on Java 19+).

<details>
<summary>Solution</summary>

```java
void processAll(List<File> files) throws InterruptedException {
    int n = Runtime.getRuntime().availableProcessors();
    ExecutorService pool = Executors.newFixedThreadPool(n);
    try {
        List<Future<?>> futures = new ArrayList<>();
        for (File f : files) {
            futures.add(pool.submit(() -> process(f))); // queued; runs on a pool thread
        }
        for (Future<?> future : futures) {
            try {
                future.get(); // waits for completion AND rethrows task exceptions
            } catch (ExecutionException e) {
                log.error("file processing failed", e.getCause());
            }
        }
    } finally {
        pool.shutdown(); // no new tasks; existing ones finish
        pool.awaitTermination(1, TimeUnit.MINUTES);
    }
}
```

**Why it's correct and scalable.** The pool caps live threads at `n` no matter how many files arrive; the rest queue in the executor's internal work queue instead of becoming threads that exhaust native memory. Submitting returns a `Future`, and `future.get()` does double duty — it *blocks until the task is done* (so the loop is a join barrier) and it *rethrows* any exception the task threw wrapped in `ExecutionException`, fixing the original's silent-failure problem where a thread could die unnoticed. The `finally` guarantees the pool is shut down so the JVM can exit and no threads leak. This is the standard "bounded executor + futures" pattern; on Java 21+, virtual threads (`Executors.newVirtualThreadPerTaskExecutor()`) change the calculus for *I/O-bound* work — millions are cheap — but for CPU-bound work you still want a fixed pool sized to the cores.

</details>

---

## Exercise 10 — Add backpressure, don't drop or buffer forever

**Anti-pattern:** Thread-Per-Request + unbounded queue (Shared State) · **Language:** Go · **Difficulty:** ★★★ hard

A previous "fix" replaced thread-per-request with a worker pool — but fed it through an *unbounded* buffered channel. Now goroutines don't explode, but the queue does: under sustained overload, the channel grows without limit and the process OOMs. The job is to apply **backpressure** so a slow consumer slows the producer instead of burying it.

```go
// "Fixed" the goroutine explosion but moved the unboundedness into the queue.
func newServer() chan<- Request {
	queue := make(chan Request, 1_000_000) // effectively unbounded; just delays the OOM
	for i := 0; i < 16; i++ {
		go func() {
			for r := range queue {
				handle(r) // slow
			}
		}()
	}
	return queue
}

// Producer never blocks, so it outruns the workers until memory runs out.
func ingest(queue chan<- Request, r Request) {
	queue <- r
}
```

**Acceptance criteria**
- The in-flight queue is bounded to a small, deliberate size.
- When the queue is full, the producer either **blocks** (backpressure) or **sheds load** with a timeout/explicit rejection — and you justify which.
- No unbounded memory growth under sustained overload; no silent drops.

**Hint:** make the buffer small and intentional (e.g. `2 × workers`). A full channel naturally blocks the sender — that *is* backpressure. If blocking forever is unacceptable (e.g. an HTTP handler that must answer fast), use a `select` with a `context`/timeout to reject explicitly with a 503-style signal rather than dropping silently.

<details>
<summary>Solution</summary>

```go
const workers = 16

type Server struct {
	queue chan Request
}

func NewServer() *Server {
	s := &Server{
		// Small, deliberate buffer: enough to smooth bursts, not to hide overload.
		queue: make(chan Request, 2*workers),
	}
	for i := 0; i < workers; i++ {
		go func() {
			for r := range s.queue {
				handle(r)
			}
		}()
	}
	return s
}

// Submit applies backpressure: it blocks until there is room, OR gives up
// after the caller's deadline and reports rejection — never silently drops.
func (s *Server) Submit(ctx context.Context, r Request) error {
	select {
	case s.queue <- r:
		return nil // accepted (immediately, or after waiting for room)
	case <-ctx.Done():
		return fmt.Errorf("overloaded, request rejected: %w", ctx.Err())
	}
}
```

**Why it's correct and scalable.** The bounded channel turns the queue into a real **backpressure** mechanism: once `2*workers` items are in flight, `s.queue <- r` blocks the producer, which propagates the slowdown upstream — the system runs at the *consumer's* sustainable rate instead of accepting work it can never finish. The unbounded buffer in the broken version merely deferred the OOM; bounding it makes overload *visible immediately* rather than as a delayed crash.

The `select` chooses the right behavior per context: a background producer can use `context.Background()` and block indefinitely (pure backpressure); a latency-sensitive caller (an HTTP handler) passes a `context.WithTimeout`, so when the system is saturated it gets a fast, explicit "rejected" it can turn into a `503 Service Unavailable` with a `Retry-After`. Both paths are honest — the request is either accepted or *explicitly* refused, never silently swallowed. **Load shedding under overload is a feature, not a failure**: rejecting 5% of requests fast keeps the other 95% healthy, whereas accepting everything degrades all of them and eventually kills the process.

</details>

---

## Exercise 11 — Kill false sharing with padding

**Anti-pattern:** Shared Mutable State — cache-line contention · **Language:** Go · **Difficulty:** ★★★ hard

This per-worker counter array is *logically* race-free — each worker writes only its own slot. Yet it runs barely faster than a single thread. The culprit is **false sharing**: adjacent `int64`s share a 64-byte CPU cache line, so writes by different cores keep invalidating each other's cache.

```go
type Counters struct {
	values [8]int64 // 8 × 8 bytes = 64 bytes: all on ONE cache line
}

func bench(c *Counters) {
	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func(id int) {
			defer wg.Done()
			for j := 0; j < 10_000_000; j++ {
				c.values[id]++ // each core writes its own slot — but same cache line
			}
		}(i)
	}
	wg.Wait()
}
```

**Acceptance criteria**
- Each counter sits on its own cache line, so cores stop fighting over shared lines.
- The data is logically unchanged (still one counter per worker).
- A benchmark shows a real speedup over the packed version (no correctness change — it was already correct, just slow).

**Hint:** pad each counter so its struct occupies a full cache line (64 bytes on x86-64 / Apple Silicon). One `int64` (8 bytes) + 56 bytes of padding = 64 bytes, so no two counters share a line.

<details>
<summary>Solution</summary>

```go
// Each counter occupies a full 64-byte cache line; no two share a line.
type paddedCounter struct {
	value int64
	_     [56]byte // 8 (int64) + 56 (pad) = 64 bytes
}

type Counters struct {
	values [8]paddedCounter
}

func bench(c *Counters) {
	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func(id int) {
			defer wg.Done()
			for j := 0; j < 10_000_000; j++ {
				c.values[id].value++ // its own cache line — no cross-core invalidation
			}
		}(i)
	}
	wg.Wait()
}
```

Benchmark to *prove* it (don't trust intuition on cache effects):

```go
func BenchmarkPacked(b *testing.B)  { for i := 0; i < b.N; i++ { bench(&Counters{}) } }
// Compare against the original [8]int64 version. On an 8-core box the padded
// version is typically 3–7× faster despite doing identical arithmetic.
```

**Why it's better.** Caches operate on whole **cache lines** (64 bytes), not individual variables. When eight cores each write their own `int64` packed into one line, the cache-coherence protocol (MESI) forces the line to ping-pong: every write by one core invalidates the line in the other seven cores' caches, so each "independent" increment triggers cross-core traffic. Padding each counter to a full line means each core owns its line outright — writes stay local, the line never bounces, and the cores finally run in parallel. The arithmetic is identical and was always correct; padding fixes *performance*, not *correctness*. This is why high-performance counters (and Java's `LongAdder`, Go's `runtime` per-P counters) are line-padded. Measure with `-bench` before and after — false sharing is invisible in the code and only the benchmark reveals it.

> Production caveat: hardware cache-line size varies (some ARM platforms use 128 bytes). For library code, size padding to the largest line you target, or use a known-good constant; over-padding wastes a little memory but never hurts correctness.

</details>

---

## Exercise 12 — Pad the false-sharing hotspot in Java

**Anti-pattern:** Shared Mutable State — cache-line contention · **Language:** Java · **Difficulty:** ★★★ hard

Same disease, Java edition. Two `volatile long`s used as independent counters by two threads land on the same cache line and contend. Fix it idiomatically — and know the JDK's built-in answer.

```java
class Counters {
    volatile long a; // thread 1 writes only this
    volatile long b; // thread 2 writes only this
    // a and b are adjacent in the object layout -> same 64-byte cache line -> false sharing
}
```

**Acceptance criteria**
- `a` and `b` end up on different cache lines.
- Prefer the JVM's *intended* mechanism over hand-counted padding fields (which the JIT may reorder or dead-strip).
- Note the production-grade alternative for the common "many threads, one logical counter" case.

**Hint:** Java 8+ provides `@jdk.internal.vm.annotation.Contended` (exposed as `@sun.misc.Contended` pre-9) precisely to pad a field onto its own cache line — and you must run with `-XX:-RestrictContended` to enable it outside the JDK. For the "everyone increments one counter" pattern, `java.util.concurrent.atomic.LongAdder` already does this striping for you.

<details>
<summary>Solution</summary>

**Direct fix — `@Contended` puts each field on its own line:**

```java
import jdk.internal.vm.annotation.Contended; // run with -XX:-RestrictContended

class Counters {
    @Contended volatile long a;
    @Contended volatile long b;
    // The JVM inserts padding around each annotated field so a and b
    // no longer share a cache line. This is what the JDK itself uses
    // internally (e.g. in ForkJoinPool and LongAdder's Cell).
}
```

**The usual real answer — don't hand-roll; use `LongAdder`:**

```java
import java.util.concurrent.atomic.LongAdder;

class Metrics {
    private final LongAdder requests = new LongAdder();

    void onRequest() { requests.increment(); } // contends far less than AtomicLong
    long total()     { return requests.sum(); }
}
```

**Why it's better.** Hand-counted padding fields (`long p1, p2, p3, ...`) are fragile in Java: the JIT can reorder fields, and an aggressive optimizer may eliminate fields it proves unused, undoing your padding. `@Contended` is the *supported* mechanism — the JVM guarantees the annotated field gets its own cache line, which is exactly how the JDK's own concurrency classes avoid false sharing. But the higher-leverage move for the most common case ("N threads incrementing one counter") is `LongAdder`: instead of all threads hammering one `volatile` (which serializes on the coherence protocol no matter how you pad a single field), it keeps an *array of internally-padded cells*, each thread updates a different cell, and `sum()` adds them up — trading a tiny read cost for a massive write-throughput win under contention. Reach for `@Contended` when you control the layout of distinct hot fields; reach for `LongAdder` when many threads update one logical total.

> **Python note:** false sharing is a non-issue under CPython's GIL — only one thread executes bytecode at a time, so cores don't contend on a shared line through the interpreter. It resurfaces in `multiprocessing` with shared-memory arrays or in native extensions that release the GIL. The cure (give each worker its own slot/process and reduce at the end) is the same.

</details>

---

## Exercise 13 — Mini-project: the metrics aggregator

**Anti-pattern:** all three, in one realistic component · **Language:** Go · **Difficulty:** ★★★★ project

Below is a metrics collector that manages to commit **every** Shared-State anti-pattern at once: an unprotected shared map (race + runtime crash), a busy-wait flush loop (burns a core), and an unbounded goroutine-per-event ingest path (OOM under load). Refactor it into a correct, bounded, efficient collector. Work in steps; keep `-race` clean after each.

```go
type Collector struct {
	counts  map[string]int // (1) shared mutable map, no protection
	flushed bool           // (3) busy-waited flag
}

func NewCollector() *Collector {
	c := &Collector{counts: make(map[string]int)}
	go func() {
		for !c.flushed { // (2) BUSY WAIT: spins a core checking the flag + races on it
		}
		fmt.Println("final:", c.counts)
	}()
	return c
}

// Record spawns a goroutine PER event — unbounded fan-out.
func (c *Collector) Record(name string) {
	go func() { // (3) thread-per-request without bounds
		c.counts[name]++ // (1) concurrent map write -> crash
	}()
}

func (c *Collector) Flush() { c.flushed = true } // (2) racy signal
```

**Acceptance criteria**
- **Shared Mutable State:** the map is never written concurrently (confine it to one goroutine, or lock it).
- **Busy Waiting:** the flush waiter blocks on a signal, not a spin loop.
- **Thread-Per-Request:** ingest does not spawn a goroutine per event; concurrency is bounded.
- `Record` is safe to call from many goroutines; `Flush` returns the final, complete snapshot.
- `-race` is clean; no `concurrent map writes` crash.

**Hint:** the cleanest design *confines* the map to a single owner goroutine that ranges over a bounded `events` channel (this kills anti-patterns 1 and 3 together — one owner, bounded queue). Use a separate `done` channel closed on flush to replace the spin loop (anti-pattern 2). Build it in steps: first confine the map, then bound the channel, then replace the flag.

<details>
<summary>Solution</summary>

```go
type Collector struct {
	events chan string        // bounded queue — backpressure, no per-event goroutine
	result chan map[string]int // carries the final snapshot back to Flush
	once   sync.Once          // makes Flush idempotent / safe to call concurrently
}

func NewCollector() *Collector {
	c := &Collector{
		events: make(chan string, 1024), // deliberate bound, not unbounded
		result: make(chan map[string]int),
	}
	go c.run() // the SOLE owner of `counts`
	return c
}

// run is the only goroutine that touches the map — confinement kills the race.
func (c *Collector) run() {
	counts := make(map[string]int)
	for name := range c.events { // exits when events is closed (on Flush)
		counts[name]++ // no lock: not shared
	}
	c.result <- counts // hand the finished snapshot to Flush
}

// Record is safe from any number of goroutines; it does NOT spawn one.
// A full channel applies backpressure to the caller instead of unbounded fan-out.
func (c *Collector) Record(name string) {
	c.events <- name
}

// Flush stops ingestion and returns the final, complete snapshot. It blocks
// (parked) until run() finishes draining — no spin loop.
func (c *Collector) Flush() map[string]int {
	c.once.Do(func() { close(c.events) }) // signal end-of-input exactly once
	return <-c.result                     // receive the snapshot; blocks, zero CPU
}
```

**What happened to each anti-pattern:**

- **Shared Mutable State →** the map is confined to `run`. No other goroutine has a reference to `counts`, so there is no concurrent write, no lock to forget, and no `concurrent map writes` crash. Coordination happens only through channels, which carry the happens-before edges.
- **Busy Waiting →** the spin loop on `flushed` is gone. `Flush` parks on `<-c.result` and `run` parks on `range c.events`; both consume zero CPU until there is actual work or a signal. `close(c.events)` is the idiomatic end-of-stream signal, replacing the racy boolean.
- **Thread-Per-Request →** `Record` no longer spawns a goroutine per event. There is exactly *one* consumer goroutine; events flow through a *bounded* channel, so a flood of `Record` calls applies backpressure to callers rather than spawning unbounded goroutines that exhaust memory.

**Why it's better.** One ownership rule ("only `run` touches the map") eliminates two anti-patterns at once — the race *and* the fan-out — because confinement gives you a single, bounded consumer for free. The channel is the queue, its capacity is the concurrency bound, and closing it is both the shutdown signal and the flush trigger. `sync.Once` makes `Flush` safe to call from multiple goroutines and idempotent (closing a channel twice panics). Build it incrementally — confine the map first and rerun `-race`, then bound the channel, then delete the flag — never as one big rewrite.

> **Scaling further:** if a single consumer can't keep up, shard by `name` across *several* owner goroutines (each owning a disjoint key range, like Exercise 2's per-goroutine maps) and merge their snapshots in `Flush`. That preserves confinement (no shared map) while adding parallelism.

</details>

---

## Exercise 14 — Judgment: when is a bounded spin / small fan-out acceptable?

**Anti-pattern:** meta (knowing when the "anti-pattern" is the right call) · **Difficulty:** ★★★ hard · *(judgment exercise — no single code answer)*

Every rule in this chapter has a boundary where the textbook cure is *worse* than the "anti-pattern." Senior judgment is knowing where. For **each** scenario below, decide whether the flagged technique is acceptable here, and justify it concretely — name the cost you are trading and the condition that must hold.

1. **Bounded spin.** A lock-free queue's consumer expects an item within tens of nanoseconds (a producer on another core is mid-write). The choice is: spin a few hundred cycles, or call `wait()`/park the thread.
2. **Unbounded small fan-out.** A request handler must call exactly 3 independent downstream services and combine their results. The proposal: spawn 3 goroutines, no pool.
3. **Spin-then-block (hybrid).** A high-throughput server's worker contends on a hot mutex held for ~100 ns. Always parking on contention shows up as scheduler overhead in the profile.

**Acceptance criteria**
- A clear accept/reject per scenario with the *specific* trade-off named.
- The condition that flips your answer (when it would become a real anti-pattern).
- Evidence you'd want before committing (you should be *measuring*, not guessing).

<details>
<summary>Solution</summary>

**Scenario 1 — bounded spin: ACCEPTABLE.**
Parking a thread and waking it costs on the order of a microsecond (a syscall, a context switch, cache pollution). If the item is expected within *tens of nanoseconds*, parking-and-waking costs ~100× more than the wait itself — you'd burn more CPU on the context switch than on a short spin. A **bounded** spin (e.g. `for i := 0; i < 100; i++ { if ready() { break } }`, ideally with a CPU `PAUSE`/`runtime.Gosched()` hint) is correct here.
- **Trade-off named:** you burn a few hundred cycles of one core to *save* a microsecond-scale park/unpark round-trip and its cache effects.
- **Condition that flips it:** the spin must be *bounded* and the expected wait must be shorter than a context switch. The moment the wait could be milliseconds, or the bound is removed (`for !ready {}`), it becomes the real Busy-Waiting anti-pattern — burning a whole core indefinitely. (This is exactly why real mutexes are *adaptive*: a short spin, then park.)

**Scenario 2 — unbounded small fan-out: ACCEPTABLE.**
"Unbounded" is only dangerous when the count scales with input/load. Here the fan-out is a *fixed constant* (3) per request, bounded by the request concurrency that's already limited upstream (the server's own worker pool / connection limit). Spinning up a worker pool to manage 3 short-lived goroutines is ceremony that adds latency and code for no benefit.
- **Trade-off named:** you accept 3 cheap goroutines (a few KB of stack each) to avoid the complexity and latency of pool management; use `errgroup` to wait and propagate the first error.
- **Condition that flips it:** if the fan-out count becomes a function of input size (`for _, item := range millionItems { go fetch(item) }`), it is now the Thread-Per-Request anti-pattern and needs a bounded pool or a `semaphore`. The line is *does the goroutine count scale with load?* A fixed 3 doesn't; a per-item `go` does.

**Scenario 3 — spin-then-block hybrid: ACCEPTABLE, and it's what good runtimes already do.**
For a lock held ~100 ns, immediately parking on contention means the contending thread pays a context switch to wait for something that finishes in 100 ns — pure overhead the profile correctly flags. The right design is **adaptive**: spin briefly (the holder likely releases within the spin window), and only park if the spin fails.
- **Trade-off named:** a small, bounded CPU spend to dodge a context switch when the critical section is shorter than the switch cost; fall back to parking so you don't burn a core if the holder is actually slow (e.g. preempted).
- **Condition that flips it:** the critical section must be *reliably short*. If the holder can do I/O or block while holding the lock (the "Holding a Lock During I/O" anti-pattern from the [Coordination](../02-coordination/README.md) category), spinning is catastrophic — you spin for milliseconds. Don't hand-roll this; Go's `sync.Mutex` and the JVM's biased/adaptive locks already implement spin-then-park. Hand-rolling is justified only with a profile proving the standard primitive is your bottleneck.

**The meta-lesson.** None of these is "the rule is wrong." Each is the rule applied with its *boundary condition* attached: spin only when bounded and shorter than a park; fan out unboundedly only when the count doesn't scale with load; build a pool only when concurrency would otherwise be unbounded. And in every case the senior move is the same — **measure** (benchmark the spin vs. park, profile the scheduler overhead, check whether the count scales) rather than cite the rule as dogma.

</details>

---

## Summary

- **Shared mutable state is the root cause; every other anti-pattern here is a failed attempt to coordinate it.** The strongest cure is to *remove the sharing* — confine state to one owner (Exercises 1C, 5, 13) — so there is no lock to forget and no race to chase. When you can't confine, protect: a mutex for multi-field invariants, `atomic`/`LongAdder` for a single counter, an atomic compound primitive (`computeIfAbsent`) for check-then-act.
- **Busy waiting is solved by blocking on the event, never polling for it.** Channels (one-shot signal, `close` to broadcast), `sync.WaitGroup` (wait for N), and `wait`/`notifyAll` or `Condition` (state-change wakeups) all park the waiter at ~0% CPU. Re-check the condition in a `while`/`for` loop to survive spurious wakeups.
- **Thread-per-request is bounded by a worker pool + a bounded queue + backpressure.** A fixed pool caps concurrency to the bottleneck resource; a small, deliberate queue turns overload into backpressure (block) or honest load-shedding (reject with a deadline), never silent drops or an unbounded queue that just delays the OOM.
- **False sharing is a *performance* bug in correct code** — independent variables on one cache line make cores fight over it. Pad to a cache line (Go) or use `@Contended` / `LongAdder` (Java). It is invisible in the source; only a benchmark reveals it.
- **Always run Go concurrency code with `-race`, and measure before optimizing.** A test passing once proves nothing about a race. And the rules have boundaries (Exercise 14): a bounded spin, a fixed small fan-out, or a spin-then-block lock can be the *right* call — judged by measurement, not dogma.

---

## Related Topics

- [`junior.md`](junior.md) — what these races look like and why they're so hard to reproduce.
- [`middle.md`](middle.md) — detection (the race detector, profiling) and the safer patterns used here.
- [`senior.md`](senior.md) — debugging a contended path and a wedged server in production.
- [`find-bug.md`](find-bug.md) — spot-the-race snippets (critical reading practice).
- [`optimize.md`](optimize.md) — make these implementations safe *and* fast.
- [`interview.md`](interview.md) — Q&A across all levels for job prep.
- [Synchronization Misuse](../01-synchronization/README.md) — locks and memory primitives applied wrongly (the sibling category).
- [Coordination](../02-coordination/README.md) — deadlock, holding a lock during I/O, wrong granularity.
- [Clean Code → Immutability](../../../clean-code/14-immutability/README.md) — the deepest cure: state that can't be mutated can't be raced.
