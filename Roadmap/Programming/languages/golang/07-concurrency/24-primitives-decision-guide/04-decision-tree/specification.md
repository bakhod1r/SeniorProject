---
layout: default
title: Decision Tree — Specification
parent: Decision Tree
grand_parent: Primitives Decision Guide
ancestor: Go
nav_order: 4
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/24-primitives-decision-guide/04-decision-tree/specification/
---

# Decision Tree — Specification

[← Back](../)

The decision tree is not a tradition; it is the direct reading of normative documentation. Every branch in the tree corresponds to a sentence in a godoc comment, a passage in the Go memory model, or a guarantee printed in the package overview. When two engineers disagree about which primitive a particular task wants, the resolution is almost always one of "we are both inventing a fact that the spec settles in one line." This page collects the load-bearing sentences and labels the branch each one supports. Quote them in code reviews; do not paraphrase them.

## 1. sync.Map — the "use cases" paragraph

From `pkg/sync/map.go` (Go 1.22, condensed verbatim):

> The Map type is specialized. Most code should use a plain Go map instead, with separate locking or coordination, for better type safety and to make it easier to maintain other invariants along with the map content.
>
> The Map type is optimized for two common use cases: (1) when the entry for a given key is only ever written once but read many times, as in caches that only grow, or (2) when multiple goroutines read, write, and overwrite entries for disjoint sets of keys. In these two cases, use of a Map may significantly reduce lock contention compared to a Go map paired with a separate Mutex or RWMutex.
>
> The zero Map is empty and ready for use. A Map must not be copied after first use.

Branch consequences:

- The decision tree's "shared map?" branch defaults to `map + sync.RWMutex`, not `sync.Map`. The spec itself says "most code should use a plain Go map."
- `sync.Map` is the answer only when (a) the key is written once and read often (read-mostly cache that only grows) or (b) goroutines access disjoint key sets. Both conditions exclude general-purpose lookup tables that are frequently rewritten across the same keys.
- The "must not be copied after first use" line forbids passing a `sync.Map` by value through a function argument once it has been used. Pass `*sync.Map` or embed it in a struct that itself is passed by pointer.

## 2. sync.Pool — the "any item ... may be removed automatically" paragraph

From `pkg/sync/pool.go`:

> Pool's purpose is to cache allocated but unused items for later reuse, relieving pressure on the garbage collector. That is, it makes it easy to build efficient, thread-safe free lists. However, it is not suitable for all free lists.
>
> An appropriate use of a Pool is to manage a group of temporary items silently shared among and potentially reused by concurrent independent clients of a package. Pool provides a way to amortize allocation overhead across many clients.
>
> An example of good use of a Pool is in the fmt package, which maintains a dynamically-sized store of temporary output buffers. The store scales under load (when many goroutines are actively printing) and shrinks when quiescent.
>
> On the other hand, a free list maintained as part of a short-lived object is not a suitable use for a Pool, since the overhead does not amortize well in that scenario. It is more efficient to have such objects implement their own free list.
>
> An item stored in the Pool may be removed automatically at any time without notification. If the Pool holds the only reference when this happens, the item might be deallocated.
>
> A Pool must not be copied after first use.

Branch consequences:

- Pool sits on the "is this object large, allocation-heavy, and ephemeral within a request?" branch. If the answer is no — for instance, a connection or a stateful client — use an explicit pool with bounded size, not `sync.Pool`.
- The "may be removed automatically" sentence rules out using Pool as a cache. Two consecutive `Get` calls may return different objects even with no `Put` in between if the runtime swept the pool. Cache semantics require a structure where presence after Put is guaranteed until evicted by your policy.
- Pool entries must be reset before reuse. The spec is silent here but the convention is fixed: every `Get` followed by mutation must be paired with a `Reset()` on the object before `Put` returns it. Otherwise the next consumer sees leftover state.

## 3. golang.org/x/sync/errgroup — Group, Wait, Go, SetLimit

From `pkg/golang.org/x/sync/errgroup/errgroup.go`:

> Package errgroup provides synchronization, error propagation, and Context cancelation for groups of goroutines working on subtasks of a common task.
>
> A Group is a collection of goroutines working on subtasks that are part of the same overall task. A zero Group is valid, has no limit on the number of active goroutines, and does not cancel on error.
>
> Go calls the given function in a new goroutine. The first call to return a non-nil error cancels the group's context, if the group was created by calling WithContext. The error will be returned by Wait.
>
> Wait blocks until all function calls from the Go method have returned, then returns the first non-nil error (if any) from them.
>
> SetLimit limits the number of active goroutines in this group to at most n. A negative value indicates no limit. Any subsequent call to the Go method will block until it can add an active goroutine without exceeding the configured limit.

Branch consequences:

- The "wait for N tasks to finish" branch lands on `sync.WaitGroup` when none of the tasks can fail or the caller does not need the first error. It lands on `errgroup.Group` the instant either of those is false. Almost all production fan-outs need both, so `errgroup.WithContext` is the realistic default; bare `sync.WaitGroup` is for closed-loop pipelines that handle their errors internally.
- `SetLimit` is the right answer to "I want a worker pool that processes a slice in parallel with at most N goroutines." This is strictly simpler than a hand-rolled semaphore + WaitGroup; reach for it before you reach for `x/sync/semaphore`.

## 4. golang.org/x/sync/semaphore — Weighted, Acquire, Release, TryAcquire

From `pkg/golang.org/x/sync/semaphore/semaphore.go`:

> Package semaphore provides a weighted semaphore implementation.
>
> NewWeighted creates a new weighted semaphore with the given maximum combined weight for concurrent access.
>
> Acquire acquires the semaphore with a weight of n, blocking until resources are available or ctx is done. On success, returns nil. On failure, returns ctx.Err() and leaves the semaphore unchanged.
>
> If ctx is already done, Acquire may still succeed without blocking.
>
> Release releases the semaphore with a weight of n.
>
> TryAcquire acquires the semaphore with a weight of n without blocking. On success, returns true. On failure, returns false and leaves the semaphore unchanged.

Branch consequences:

- Weighted semaphores are for the case "some tasks consume more of the resource than others." If every task has weight 1, `errgroup.SetLimit` or a buffered channel of tokens is simpler and equally correct.
- The "may still succeed without blocking" sentence about already-cancelled contexts is a sharp edge: do not assume `Acquire` returns immediately on cancelled context if capacity is available. Code that depends on cancellation precedence must check `ctx.Err()` after the call.

## 5. sync.Cond — Signal, Broadcast, Wait

From `pkg/sync/cond.go`:

> Cond implements a condition variable, a rendezvous point for goroutines waiting for or announcing the occurrence of an event.
>
> Each Cond has an associated Locker L (often a *Mutex or *RWMutex), which must be held when changing the condition and when calling the Wait method.
>
> A Cond must not be copied after first use.
>
> In many cases, sync.Cond can be replaced with channels — the most common uses of sync.Cond are easier to express with channels. The principal exception is broadcasting to a dynamic set of waiters; channels do not have a built-in broadcast, so this case justifies a Cond.

(That last sentence is paraphrased from Russ Cox's commit messages and standing review comments; the godoc itself does not yet warn about overuse, but the same guidance has lived in the Go team's review feedback for over a decade and is the working specification.)

Branch consequences:

- The decision tree's "wait until a predicate becomes true" branch defaults to a channel close (`<-done`) for single-shot or replace-on-update predicates, and to a `sync.Cond` only when the waiter must re-check the predicate after each wakeup AND the set of waiters is dynamic.
- Every `Wait()` must sit inside a `for !predicate { c.Wait() }` loop. The godoc states explicitly: "Wait cannot return unless awoken by Broadcast or Signal. Because c.L is not locked while Cond is waiting, the caller typically cannot assume that the condition is true when Wait returns."

## 6. sync.Once and sync.OnceFunc — exactly-once initialization

From `pkg/sync/once.go`:

> Once is an object that will perform exactly one action.
>
> Do calls the function f if and only if Do is being called for the first time for this instance of Once. In other words, given var once Once, if once.Do(f) is called multiple times, only the first call will invoke f, even if f has a different value in each invocation. A new instance of Once is required for each function to execute.
>
> Do is intended for initialization that must be run exactly once. Since f is niladic, it may be necessary to use a function literal to capture the arguments to a function to be called by Do. If f panics, Do considers it to have returned; future calls of Do return without calling f.

And from `pkg/sync/oncefunc.go` (Go 1.21+):

> OnceFunc returns a function that invokes f only once. The returned function may be called concurrently. If f panics, the returned function will panic with the same value on every call.

Branch consequences:

- The "lazy initialization" branch always lands on `sync.Once` (or `sync.OnceFunc`/`sync.OnceValue`/`sync.OnceValues` in Go 1.21+), never on `atomic.Bool` + double-checked locking. The spec is explicit and the implementation handles the panic case correctly — your hand-rolled version probably will not.
- `atomic.Pointer[T]` with a CAS loop is the right primitive for "publish a snapshot once, but allow re-publishes later." `sync.Once` is for things that happen exactly one time across the program's lifetime.

## 7. sync/atomic — memory ordering for Load, Store, CAS

From `pkg/sync/atomic/doc.go`:

> Package atomic provides low-level atomic memory primitives useful for implementing synchronization algorithms. These functions require great care to be used correctly. Except for special, low-level applications, synchronization is better done with channels or the facilities of the sync package. Share memory by communicating; don't communicate by sharing memory.
>
> In the terminology of the Go memory model, if the effect of an atomic operation A is observed by atomic operation B, then A "synchronizes before" B. Additionally, all the atomic operations executed in a program behave as though executed in some sequentially consistent order. This definition provides the same semantics as C++'s sequentially consistent atomics and Java's volatile variables.

Branch consequences:

- The "increment a counter, read a flag, publish a pointer" branch lands on `atomic.Int64`, `atomic.Bool`, and `atomic.Pointer[T]` respectively. The "great care" warning translates concretely to: do not combine more than one atomic variable into a single logical state. If two atomics must move together, either use a mutex around both or pack them into one `atomic.Pointer[Snapshot]`.
- Sequential consistency is stronger than C11's relaxed atomics. Go does not expose `memory_order_relaxed`, so every atomic acts as both an acquire and a release. That makes the primitive simpler to reason about but also more expensive than a hand-rolled relaxed counter; if the benchmark says "I need relaxed semantics," the answer is "Go does not give you that — accept the cost or batch your updates."

## 8. Go memory model — channel and mutex synchronization

From the Go Memory Model document (verbatim, condensed):

> A send on a channel is synchronized before the completion of the corresponding receive from that channel.
>
> The closing of a channel is synchronized before a receive that returns because the channel is closed.
>
> A receive from an unbuffered channel is synchronized before the completion of the corresponding send on that channel.
>
> The kth receive on a channel with capacity C is synchronized before the completion of the (k+C)th send from that channel.
>
> For any sync.Mutex or sync.RWMutex variable l and n < m, call n of l.Unlock() is synchronized before call m of l.Lock() returning.

Branch consequences:

- A buffered channel of size C gives you exactly C slots of decoupling between producer and consumer. That sentence — "kth receive synchronized before (k+C)th send" — is the formal statement of why a buffered channel is *not* a fire-and-forget buffer once the buffer fills.
- Close-as-broadcast is a guaranteed pattern: every reader of a closed channel sees all writes that happened before the close. This is what makes `<-ctx.Done()` work as a cancellation signal across an arbitrary number of consumers without any other synchronization.

## 8a. sync.WaitGroup — Add, Done, Wait

From `pkg/sync/waitgroup.go`:

> A WaitGroup waits for a collection of goroutines to finish. The main goroutine calls Add to set the number of goroutines to wait for. Then each of the goroutines runs and calls Done when finished. At the same time, Wait can be used to block until all goroutines have finished.
>
> A WaitGroup must not be copied after first use.
>
> Note that calls with a positive delta that occur when the counter is zero must happen before a Wait. Calls with a positive delta, or calls with a negative delta that start when the counter is greater than zero, may happen at any time.

Branch consequences:

- The "must happen before a Wait" sentence is the spec-level reason for the canonical pattern of calling `wg.Add(1)` *before* the `go` statement, never inside the goroutine. Inside the goroutine, the Add races with Wait, and Wait may observe a zero counter before any goroutine has incremented it.
- The "must not be copied after first use" rules out passing a WaitGroup by value through a function argument. Pass `*sync.WaitGroup` or embed it in a struct passed by pointer.

## 8b. sync.Mutex — Lock, Unlock, TryLock

From `pkg/sync/mutex.go`:

> A Mutex is a mutual exclusion lock. The zero value for a Mutex is an unlocked mutex.
>
> A Mutex must not be copied after first use.
>
> If a goroutine holds a Mutex, no other goroutine may hold it. A Mutex must be unlocked by the same goroutine that locked it; the language does not enforce this but a violation will manifest as deadlocks or data races detected by the race detector.
>
> TryLock tries to lock m and reports whether it succeeded. Note that while correct uses of TryLock do exist, they are rare, and use of TryLock is often a sign of a deeper problem in a particular use of mutexes.

Branch consequences:

- The "must be unlocked by the same goroutine" rule rules out classic semaphore-by-mutex tricks where one goroutine Locks and another Unlocks. If you want that semantics, use a buffered channel or `semaphore.Weighted`.
- The TryLock guidance is direct: rarely correct. If you find yourself reaching for it, the question is "what is the design issue that makes me want non-blocking lock acquisition?" Usually the answer is a missing context, or a need for a buffered channel that does the non-blocking check naturally via `select { case ch <- v: default: }`.

## 9. context.Context — cancellation and deadlines

From `pkg/context/context.go`:

> Package context defines the Context type, which carries deadlines, cancellation signals, and other request-scoped values across API boundaries and between processes.
>
> Incoming requests to a server should create a Context, and outgoing calls to servers should accept a Context. The chain of function calls between them must propagate the Context, optionally replacing it with a derived Context created using WithCancel, WithDeadline, WithTimeout, or WithValue.
>
> When a Context is canceled, all Contexts derived from it are also canceled.
>
> Done returns a channel that's closed when work done on behalf of this context should be canceled. Done may return nil if this context can never be canceled. Successive calls to Done return the same value. The close of the Done channel may happen asynchronously, after the cancel function returns.

Branch consequences:

- "Cancel a long-running operation" lands on `context.WithCancel`. "Add a deadline" lands on `context.WithDeadline` or `context.WithTimeout`. Do not invent a parallel cancellation mechanism; use the one in the standard library that every reasonable Go API already understands.
- `ctx.Done()` is a closed channel. `select` composes naturally with it. `sync.Cond.Wait` and `sync.Mutex.Lock` do not — that is the spec-level reason channel-based signaling beats Cond-based signaling whenever cancellation is in scope.

## 10. golang.org/x/sync/singleflight — request deduplication

From `pkg/golang.org/x/sync/singleflight/singleflight.go`:

> Package singleflight provides a duplicate function call suppression mechanism.
>
> Group represents a class of work and forms a namespace in which units of work can be executed with duplicate suppression.
>
> Do executes and returns the results of the given function, making sure that only one execution is in-flight for a given key at a time. If a duplicate comes in, the duplicate caller waits for the original to complete and receives the same results.

Branch consequences:

- The "cache miss thundering herd" branch lands on `singleflight.Group`. Without it, 100 simultaneous misses cause 100 backend calls; with it, they cause 1 call and 99 shared results.
- `singleflight` is *not* a cache itself. It is the coordinator that prevents duplicate work while you fill a cache. The pattern is: check cache → on miss, `singleflight.Do(key, populate)` → write result to cache.

## Reading the spec changes the answer

Three common production mistakes that the specifications above resolve directly:

1. "We're using `sync.Map` for our routing table because there are many readers." The routing table is rewritten on every config reload — the keys are not "written once, read many times" and the access pattern is not "disjoint key sets." The spec says to use `map + sync.RWMutex` (or `atomic.Pointer[map[string]Route]` with copy-on-write if reads dominate by 1000:1). The first sentence of `sync.Map`'s godoc forbids the choice that was made.

2. "We're caching `*bytes.Buffer` in a `sync.Pool` for the entire lifetime of the request context." The spec says Pool entries may vanish without notification. If your code path depends on getting the same buffer back later in the request, Pool is the wrong container. Use a per-request slot or pass the buffer explicitly.

3. "We rolled our own channel-based once-only initialization." The `sync.Once` spec handles panic propagation: "If f panics, Do considers it to have returned; future calls of Do return without calling f." A hand-rolled version is almost guaranteed to either re-run after a panic (running side effects twice) or deadlock all subsequent callers. The standard library has solved this problem; do not solve it again.

## Cross-referencing the spec on the memory model

The Go memory model document anchors the rest. Key passages that drive the decision tree:

> A read r of a memory location x holding a value that is not larger than a machine word must observe some write w such that w happens before r and there is no write w' such that w happens before w' and w' happens before r.

This is the formal statement of "atomic reads see the latest atomic write." It is what justifies `atomic.Pointer[T]` as a publication mechanism: every reader sees either the old pointer or the new pointer, never a torn read.

> If the effect of an atomic operation A is observed by atomic operation B, then A is synchronized before B.

This is what makes the CAS loop in max-tracking correct: a successful CAS by goroutine X is synchronized before the subsequent Load by goroutine Y, so Y sees the value X wrote.

> Channel communication is the main method of synchronization between goroutines. Each send on a particular channel is matched to a corresponding receive from that channel, usually in a different goroutine. A send on a channel happens before the corresponding receive from that channel completes.

This is what makes "send a struct, receive it, mutate freely" correct: every field the sender wrote before the send is visible to the receiver after the receive, with no additional synchronization. The channel send acts as a memory barrier for everything that happened before it.

## What the spec does not say

Equally important: the godocs do *not* promise certain things you might assume.

- `sync.Map.Load` does not promise the latest write is visible if another goroutine just wrote. It promises the value will eventually become visible; for tightly-coupled visibility guarantees, use `atomic.Pointer` or a mutex-protected map.
- `sync.Pool.Get` does not promise the same `Put` will return the same object. If your test asserts pool identity, it is asserting something the spec does not guarantee.
- `sync.WaitGroup.Wait` does not promise any particular goroutine has finished by the time `Wait` returns — only that the counter has hit zero. If goroutines are still scheduled (e.g., they called `Done` and then did more work), `Wait` returns before they exit.

The decision tree's authority is the documentation, not any one engineer's instinct. When a branch feels wrong, the next step is not a debate; it is opening the godoc. The spec is the contract; everything else is convention.

## 11. sync.RWMutex — RLock, RUnlock, Lock, Unlock

From `pkg/sync/rwmutex.go`:

> A RWMutex is a reader/writer mutual exclusion lock. The lock can be held by an arbitrary number of readers or a single writer.
>
> If any goroutine calls Lock while the lock is already held for reading or writing, Lock blocks until the lock is available. To ensure that the lock eventually becomes available, a blocked Lock call excludes new readers from acquiring the lock.
>
> If a goroutine holds a RWMutex for reading and another goroutine might call Lock, no goroutine should expect to be able to acquire a read lock until the initial read lock is released. In particular, this prohibits recursive read locking. This is to ensure that the lock eventually becomes available; a blocked Lock call excludes new readers from acquiring the lock.

Branch consequences:

- The "blocked Lock excludes new readers" sentence is the writer-starvation prevention guarantee. It also means that under a constant stream of readers, a writer that asks to Lock will wait until all current readers finish, and during that wait no new readers can RLock.
- The "prohibits recursive read locking" sentence rules out the pattern where a goroutine holding RLock calls another function that also RLocks. The second RLock can deadlock against a pending writer. Restructure to either pass the locked state explicitly or take the write lock once at the outer boundary.

## 12. time.NewTimer and time.NewTicker — when to use which

From `pkg/time/sleep.go` and `pkg/time/tick.go`:

> NewTimer creates a new Timer that will send the current time on its channel after at least duration d.
>
> The Timer type represents a single event. When the Timer expires, the current time will be sent on C, unless the Timer was created by AfterFunc.
>
> NewTicker returns a new Ticker containing a channel that will send the current time on the channel after each tick. The period of the ticks is specified by the duration argument. The ticker will adjust the time interval or drop ticks to make up for slow receivers.

Branch consequences:

- `time.After(d)` is shorthand for `time.NewTimer(d).C`. In a hot loop, this allocates a Timer per iteration that won't be GC'd until it fires. For non-trivial loops, use `time.NewTimer` once and call `Reset` between iterations, or restructure to use `context.WithTimeout` at the outer scope.
- `time.NewTicker` drops ticks under load. If you need exact periodicity (and can tolerate drift), use a Timer that you Reset after each wakeup. If you need to compensate for missed ticks (replay them), you have to do so manually.

## Spec drift between versions

The decision tree's primitives are not frozen. Each Go release tweaks the standard library, and a few of those tweaks change the primitive choice:

- **Go 1.19** added `atomic.Pointer[T]`, `atomic.Int64`, `atomic.Uint64`, `atomic.Bool`. Before 1.19, the same operations were available as `atomic.Load64`, `atomic.LoadPointer`, etc., with explicit `unsafe.Pointer` conversions. The typed forms are strictly better — same speed, type-safe — and are the canonical answer in any modern Go code.
- **Go 1.21** added `sync.OnceFunc`, `sync.OnceValue`, `sync.OnceValues`. These should be preferred over `sync.Once` + package-level variables for new code.
- **Go 1.22** stabilized `slices` and `maps` packages, which include some concurrent-safe helpers (notably `slices.Concat`). Worth re-checking the decision tree against new helpers each release.
- **Forthcoming proposals:** structured concurrency (a `Task` type with parent-child cancellation), a `chan` of `T` with broadcast semantics, and channel TryClose. None of these are committed; do not bet on them.

The decision tree document for your team should be re-walked each minor Go release. Five minutes spent skimming the release notes for `sync` and `sync/atomic` changes catches the cases where the canonical primitive choice has shifted.

## How to read a spec passage during a code review

When debating a primitive choice in a PR, the productive form of the discussion is:

1. Name the specific godoc sentence that supports your choice.
2. Quote it verbatim in the review comment.
3. Map the sentence to the workload: "the spec says X, our workload is Y, therefore Z."

The unproductive form: "I think `sync.Map` is faster." That is folklore; the spec says exactly when it is and isn't.

Every passage above can be copy-pasted into a review thread. Doing so consistently shortens debates from days to minutes and trains everyone on the team to read documentation as a primary source.

## A short reading list

For deeper engagement with the underlying specifications:

- **The Go Memory Model** (go.dev/ref/mem) — formal happens-before rules; the contract that channels, mutexes, atomics all must obey.
- **godoc for `sync`, `sync/atomic`, `context`** — keep these tabs open while writing concurrent code.
- **godoc for `golang.org/x/sync/errgroup`, `semaphore`, `singleflight`** — the next layer of standard primitives.
- **The Go blog post "Share Memory By Communicating"** — the philosophical foundation for "channels first, primitives second."
- **Russ Cox's "Updating the Go Memory Model"** posts — the rationale for the current set of guarantees.

Reading these once, then re-reading them when a specific question arises, is more productive than reading any third-party tutorial. The specifications are the source of truth.

## Final note

The decision tree's authority is the spec. Every branch in the tree maps to a sentence in the documentation, a clause in the memory model, or a guarantee in the godoc. When the tree says "use atomic.Pointer for read-mostly state," the underlying reason is the memory model's guarantee that atomic loads observe the most recent atomic store. When the tree says "use a channel close for broadcast," the underlying reason is the channel close synchronizing-before every subsequent receive.

If you ever feel the decision tree is overruling your intuition, the resolution is to find the relevant spec passage. The spec is right. Your intuition, formed on a different language or a different problem, is the variable.
