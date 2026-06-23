# Atomic Operations — Interview Questions

> **Topic:** [Atomic Operations](README.md)

---

## Introduction

Atomic operations are the lowest-level concurrency primitive most engineers touch directly. They are the bricks every higher-level construct — mutexes, channels, futures, lock-free queues, reference counts, garbage collectors — is built from. An interviewer asking about atomics is rarely testing whether you can spell `compare_exchange`. They are testing whether you understand what the hardware actually does, what guarantees the compiler and the memory model are willing to give you, and where the cliffs are when you mix the two.

This file collects the questions that come up in real interviews for systems, infrastructure, database, and high-performance roles. Some are conceptual and verify that you can explain why `counter++` is unsafe even on x86. Some are language-specific because every language exposes atomics with a slightly different API and a slightly different default memory ordering. Some are traps — they look easy and have a subtle wrong answer that experienced candidates fall into. Some are open-ended design questions where the interviewer wants to see how you reason about contention, cache lines, ABA, and progress guarantees.

Read each question, attempt your own answer before reading the response, and pay particular attention to the "why naive is wrong" explanations in the Tricky section. Those are the answers that separate someone who has read about atomics from someone who has shipped lock-free code and debugged it at 3am.

## Table of Contents

- [Conceptual / Foundational](#conceptual--foundational)
- [Language-Specific](#language-specific)
  - [C++ std::atomic](#c-stdatomic)
  - [Java AtomicInteger / AtomicReference / LongAdder](#java-atomicinteger--atomicreference--longadder)
  - [Go sync/atomic](#go-syncatomic)
  - [Rust AtomicUsize / Ordering](#rust-atomicusize--ordering)
  - [C11 atomic_int](#c11-atomic_int)
- [Tricky / Trap](#tricky--trap)
- [System / Design Scenarios](#system--design-scenarios)
- [Coding Questions](#coding-questions)
- [Behavioral](#behavioral)
- [What I'd Ask a Candidate Now](#what-id-ask-a-candidate-now)
- [Cheat Sheet](#cheat-sheet)
- [Further Reading](#further-reading)
- [Related Topics](#related-topics)

---

## Conceptual / Foundational

### Q: What does it mean for an operation to be atomic?

An operation is atomic when no other thread can observe it in a partially completed state. From the perspective of every other thread, the operation either has not happened yet or has fully completed; there is no in-between. Atomicity says nothing by itself about ordering relative to other operations or about visibility — it only guarantees indivisibility for that one access. In practice atomicity is enforced either by a single machine instruction whose effect on memory is indivisible (`lock xadd`, `cas`, `ldrex/strex` pair, `amoadd`) or by the runtime falling back to a mutex when the type is too large for a hardware atomic.

### Q: Why is `i++` on a shared integer not atomic, even on x86?

`i++` compiles to three logical steps: load the current value into a register, add one, store the new value back. Each step is its own machine instruction. Two threads can both load the same value, both compute the same incremented result, and both store it — leading to one lost increment. The fact that the load, add, and store are each individually atomic on x86 does not help, because another core can interleave between them. Making the increment atomic requires either a single read-modify-write instruction (`lock inc`, `lock xadd`) or a CAS loop.

### Q: What is compare-and-swap (CAS) and why is it the cornerstone of lock-free programming?

Compare-and-swap atomically reads a memory location, compares it to an expected value, and writes a new value if and only if the comparison succeeds. The whole sequence is one indivisible hardware operation, and it returns whether the swap happened. CAS is fundamental because it lets a thread say "I want to update X, but only if no one else has touched it since I last looked." Every lock-free data structure — Treiber stacks, Michael–Scott queues, hazard pointers, RCU — boils down to a CAS loop that retries when another thread races ahead. CAS is also the primitive used to implement mutexes themselves at the lowest level.

### Q: What is the ABA problem?

ABA happens when a thread reads value A, another thread changes it to B and back to A, and the original thread's CAS succeeds even though the world has changed underneath it. It bites lock-free data structures that recycle nodes: thread T1 reads pointer P pointing at node A; T2 pops A, pushes B, then pushes A again at the same memory address; T1's CAS compares pointer-to-A with pointer-to-A and succeeds, but the linked list past A is now wrong. Common fixes are tagged pointers (pack a version counter into the high bits), double-width CAS, hazard pointers, or epoch-based reclamation.

### Q: What is `fetch_add` and how does it differ from a CAS loop?

`fetch_add` atomically reads the current value, adds a delta, stores the result, and returns the original value — all as one indivisible operation. On x86 it compiles to `lock xadd`. It is strictly more efficient than a CAS loop for increments because it never retries: the hardware guarantees progress in one instruction. Use `fetch_add` whenever the operation is unconditional addition; use CAS only when the new value depends on more than just adding a constant (e.g., max, conditional updates, linked-list pointer swings).

### Q: What are the standard memory ordering levels, from weakest to strongest?

The C++ and Rust memory models expose six orderings: `relaxed`, `consume`, `acquire`, `release`, `acq_rel`, and `seq_cst`. Relaxed gives atomicity but no ordering guarantees with respect to other memory operations. Acquire on a load prevents subsequent operations from being reordered before it. Release on a store prevents prior operations from being reordered after it. Acq_rel combines both on a single RMW. Seq_cst additionally guarantees a single total order across all seq_cst operations system-wide. Consume is a weaker form of acquire keyed on data dependency and is in practice promoted to acquire by every compiler.

### Q: Explain acquire-release semantics.

A release store pairs with an acquire load on the same atomic variable to form a synchronization point. Everything written by thread A before the release store is guaranteed to be visible to thread B after its acquire load returns the stored value. Conceptually it builds a one-way fence: the release prevents earlier writes from sinking past it, the acquire prevents later reads from floating before it. This is the cheapest pattern for publishing data to another thread — for example, allocating and initializing a struct, then publishing the pointer with a release store.

### Q: What is sequential consistency and when is it required?

Sequential consistency is the strongest ordering: all `seq_cst` operations across all threads appear to execute in some single global order, consistent with the program order of each thread. It is the default in C++, Java `volatile`, and most managed languages because it is the most intuitive — code "just works" without thinking about reorderings. It is required whenever an algorithm depends on a global agreement about the order of multiple independent atomics (Peterson's lock, Dekker's algorithm, some forms of consensus). It is the most expensive ordering — on x86 a seq_cst store requires `mfence` or a `lock`-prefixed instruction.

### Q: What is false sharing?

False sharing occurs when two threads modify different variables that happen to live on the same cache line. Even though the threads logically share nothing, the cache coherence protocol invalidates the line on every write, bouncing it between cores. Throughput collapses by 10–100x. The fix is to pad each variable so it occupies its own cache line — typically 64 bytes on x86, 128 bytes on Apple Silicon. The classic example is an array of per-thread counters declared as `int counters[N]`; each cache line holds 16 of them, so 16 threads compete for one line.

### Q: What is linearizability and how does it relate to atomicity?

Linearizability is a correctness condition for concurrent objects: every operation appears to take effect instantaneously at some point between its invocation and its response, and that point is consistent with the real-time ordering of operations. An atomic load or CAS is linearizable by construction — its linearization point is the moment the hardware instruction commits. Higher-level data structures (a lock-free queue, a concurrent hashmap) are linearizable if every operation has a well-defined linearization point within its execution window. Linearizability composes: a data structure built from linearizable operations can itself be made linearizable.

### Q: What is the difference between atomicity, visibility, and ordering?

Atomicity means an operation is indivisible — no torn reads or writes. Visibility means a write made by one thread eventually becomes observable to another. Ordering means the apparent sequence in which different operations took effect. A relaxed atomic gives you atomicity but not ordering. A `volatile` field in Java gives you atomicity, visibility, and limited ordering (release on write, acquire on read). A plain mutex gives you all three for the operations inside the critical section. Confusing these three is the root cause of most concurrency bugs.

### Q: What is the difference between a hardware atomic and a software atomic via mutex?

A hardware atomic uses a single instruction (or LL/SC pair) that the CPU guarantees is indivisible at the bus or cache-coherence level. A software atomic uses a mutex to wrap a non-atomic sequence so it appears atomic to other threads. C++ `std::atomic<T>` for types larger than the platform's widest atomic instruction (typically `T` larger than 16 bytes) silently falls back to a hidden lock — visible via `is_lock_free()`. Hardware atomics are nanoseconds; mutex-based atomics are tens to hundreds of nanoseconds and can deadlock if the mutex is contended in signal handlers or interrupt contexts.

### Q: Why do we need memory fences when we already have atomic instructions?

An atomic instruction guarantees its own indivisibility but does not necessarily order it against the surrounding non-atomic memory operations on the same thread. A relaxed `fetch_add`, for example, can be reordered with adjacent ordinary loads and stores by both the compiler and the CPU. A fence (or an atomic with stronger ordering) inserts a barrier the compiler and CPU must respect. Fences are needed when you publish data through one atomic and consume it via another, or when you need to flush store buffers to make writes globally visible.

### Q: Are atomics free on x86?

No, but they are cheap by historical standards. A relaxed atomic load or store on aligned data is identical to a plain load or store. A `lock`-prefixed RMW (`lock xadd`, `lock cmpxchg`) costs roughly 10–40 cycles uncontended, but the real cost is the cache-coherence traffic when many cores contend on the same line — it can balloon into hundreds of cycles. On weaker architectures (ARM, RISC-V) acquire and release loads/stores are explicit instructions and are more expensive than plain ones. The cheapest atomic is the one no other core is touching.

### Q: What is the difference between `compare_exchange_strong` and `compare_exchange_weak`?

Strong CAS guarantees that a failure means the expected value did not match. Weak CAS is allowed to fail spuriously even when the values match — this happens on architectures like ARM that implement CAS via load-linked/store-conditional, where the store-conditional can fail due to context switches or cache events. Weak is faster because it does not need the extra retry loop the strong version performs internally. Use weak inside your own CAS loop where you would retry anyway; use strong when one-shot semantics matter (e.g., a singleton initialization check).

---

## Language-Specific

### C++ std::atomic

### Q: What does `std::atomic<T>::is_lock_free()` tell you and why does it matter?

`is_lock_free()` returns true if operations on this atomic use real hardware atomic instructions and false if they fall back to an internal mutex. It matters because lock-based atomics can block, are not safe in signal handlers or interrupt contexts, and have a completely different latency profile (tens of nanoseconds vs hundreds). For typical `int`, `long`, and pointer-sized types it is true on every mainstream platform. For 16-byte types it depends on CPU support for `cmpxchg16b` (x86-64) or `casp` (ARMv8.1+). For anything larger, expect false.

### Q: When should you choose `memory_order_relaxed`?

Choose relaxed when you need atomicity but no ordering with respect to other memory operations. The textbook example is an incrementing counter whose value is read at the end (e.g., metric collection): each increment must not be lost, but the order of increments relative to surrounding code does not matter. Relaxed is also fine for stat counters, hit/miss counts, and approximate gauges. Do not use relaxed for publishing pointers, signaling readiness flags, or anything where another thread reads the atomic and then dereferences memory that was written before the atomic store.

### Q: Explain the typical acquire-release publication pattern in C++.

```cpp
std::atomic<Data*> ptr{nullptr};

void producer() {
    Data* p = new Data();
    p->x = 42;
    p->y = "hello";
    ptr.store(p, std::memory_order_release);
}

void consumer() {
    Data* p;
    while (!(p = ptr.load(std::memory_order_acquire))) {}
    assert(p->x == 42);  // guaranteed visible
    assert(p->y == "hello");
}
```

The release store guarantees that the writes to `p->x` and `p->y` happen-before any thread that performs an acquire load and sees the stored pointer. This is the bread-and-butter idiom for publishing immutable data from one thread to others.

### Q: What is `memory_order_seq_cst` and when does its cost bite?

Seq_cst is the default. It guarantees both acquire-release semantics and a single total order across all seq_cst operations across all threads. The cost is concrete on x86: every seq_cst store requires either `mfence` or a `lock`-prefixed RMW to drain the store buffer, which is roughly 20–40 cycles plus stalling subsequent loads. On ARM it requires `dmb ish` fences before and after. In hot loops the difference between seq_cst and release/acquire is measurable. Most code does not need seq_cst; the rare cases where it does are algorithms that depend on a global agreement on the order of independent atomics.

### Q: How would you implement a spinlock using `std::atomic_flag`?

```cpp
class Spinlock {
    std::atomic_flag flag = ATOMIC_FLAG_INIT;
public:
    void lock() {
        while (flag.test_and_set(std::memory_order_acquire)) {
            // optional: PAUSE / yield
        }
    }
    void unlock() {
        flag.clear(std::memory_order_release);
    }
};
```

`atomic_flag` is the only type the standard guarantees is always lock-free. `test_and_set` returns the previous value and sets it to true atomically — when it returns false the caller has acquired the lock. The acquire on lock and release on unlock build the standard one-way fences so writes inside the critical section are visible to the next lock holder.

### Java AtomicInteger / AtomicReference / LongAdder

### Q: How does `AtomicInteger` differ from a `volatile int`?

A `volatile int` gives you visibility — a write is immediately visible to other threads — and acquire-release semantics on each access, but `i++` is still not atomic because it compiles to read-modify-write. `AtomicInteger` exposes `incrementAndGet`, `compareAndSet`, `getAndAdd` which are single atomic RMW operations backed by `Unsafe.getAndAddInt` (or `VarHandle` in modern JDKs). Use `volatile` for flags and single-writer values, use `AtomicInteger` when multiple threads must safely modify the same number.

### Q: When should you prefer `LongAdder` over `AtomicLong`?

When the value is incremented far more often than it is read, and contention is high. `AtomicLong` performs a CAS loop on a single memory location, which scales poorly when many cores hammer it — every increment invalidates the cache line on every other core. `LongAdder` maintains a striped array of cells; each thread updates its own cell, and `sum()` adds them up on read. Under heavy contention `LongAdder` can be 5–10x faster. Trade-off: `sum()` is not a linearizable snapshot, and the memory footprint is larger.

### Q: What does `AtomicReference::compareAndSet` do and what is its main pitfall?

It atomically replaces the referenced object if the current reference equals the expected reference (by identity, not `.equals`). The main pitfall is ABA: if the reference is restored to its original value between your read and your CAS, the CAS succeeds even though the object pointed to has changed semantically. For lock-free data structures this can corrupt invariants. Workarounds include `AtomicStampedReference` (pairs the reference with an integer version) and `AtomicMarkableReference` (pairs with a boolean), both of which let you detect intervening modifications.

### Q: What is double-checked locking and why was it broken pre-Java 5?

```java
class Lazy {
    private Helper helper;
    public Helper get() {
        if (helper == null) {
            synchronized (this) {
                if (helper == null) {
                    helper = new Helper();
                }
            }
        }
        return helper;
    }
}
```

Pre-Java 5 it was broken because the JIT could reorder the `Helper` constructor with the assignment to `helper`. A second thread could see a non-null `helper` whose fields were not yet initialized and dereference garbage. Java 5 fixed it by giving `volatile` writes release semantics and `volatile` reads acquire semantics. Declaring `helper` as `volatile` makes the pattern correct on modern JVMs — the construction of `Helper` happens-before any thread that reads the non-null reference.

### Q: How does the JMM define happens-before for atomic operations?

The Java Memory Model says a `volatile` write happens-before every subsequent `volatile` read of the same field. The same rule applies to `AtomicXxx` writes and reads under the hood (they piggy-back on the volatile semantics of internal fields). This means `set(x)` on an `AtomicInteger` is a release, `get()` is an acquire, and a CAS that succeeds is both. This is the same model as C++ `acq_rel`. JMM also adds a total order across all `volatile`/atomic operations, equivalent to C++ `seq_cst`.

### Go sync/atomic

### Q: What guarantees does `sync/atomic` provide in Go?

`sync/atomic` provides atomic load, store, add, swap, and CAS for `int32`, `int64`, `uint32`, `uint64`, `uintptr`, and `unsafe.Pointer`. As of Go 1.19, typed wrappers (`atomic.Int64`, `atomic.Pointer[T]`) make the intent clearer. The Go memory model guarantees that an atomic store synchronizes-before an atomic load that observes it — equivalent to C++ release/acquire. Go does not expose memory ordering knobs; everything behaves as if it were seq_cst from the user's point of view, and the implementation picks the cheapest ordering that satisfies that guarantee.

### Q: Why is `int64` atomicity tricky on 32-bit ARM?

On 32-bit platforms 64-bit operations are not naturally atomic, and Go originally required the address to be 8-byte aligned, with a runtime panic otherwise. The first field of a struct is aligned, but a 64-bit field placed after a 32-bit field is not. The convention was to put 64-bit atomic fields first. As of Go 1.19 the typed `atomic.Int64` wraps the value in a struct that forces alignment, so this concern is largely historical for new code — but legacy code with `atomic.AddInt64(&s.counter, 1)` on a misaligned field still panics.

### Q: How would you implement a lock-free counter in Go?

```go
type Counter struct {
    v atomic.Int64
}

func (c *Counter) Inc() { c.v.Add(1) }
func (c *Counter) Get() int64 { return c.v.Load() }
```

`Add(1)` is a single atomic RMW (`lock xadd` on x86). For very high contention scenarios a per-P sharded counter or the `expvar` package's `Int` type is preferable, and for purely write-heavy metrics tools like Prometheus client libraries provide sharded counters that avoid the contention hotspot entirely.

### Q: What is the role of `sync/atomic.Pointer`?

`atomic.Pointer[T]` lets you atomically publish a `*T` from one goroutine to others without a mutex. The classic use is copy-on-write configuration: you build a new config, then `Store` the pointer; every reader does `Load` and sees either the old or new pointer atomically. Combined with garbage collection, this gives you a poor-man's RCU — old configs are reclaimed automatically when no goroutine holds them. Before generics, this required `atomic.Value` with type assertions; the generic version is type-safe.

### Rust AtomicUsize / Ordering

### Q: What are the variants of `std::sync::atomic::Ordering`?

`Relaxed`, `Acquire`, `Release`, `AcqRel`, and `SeqCst`. Rust deliberately omitted `Consume` because no compiler implements it correctly; using `Acquire` is the conservative choice. Each ordering has the same semantics as the corresponding C++ memory order. Rust's type system enforces that you cannot, for example, pass `Release` to `load()` or `Acquire` to `store()` — the standard library panics in debug mode and the docs forbid it. `AcqRel` is only valid for RMW operations.

### Q: When is `Ordering::Relaxed` appropriate in Rust?

Same answer as C++. Relaxed is for atomic counters whose increments must not be lost but whose ordering relative to other memory operations does not matter. The classic example is `Arc::clone`: incrementing the strong reference count uses `Relaxed` because the count itself does not synchronize anything — synchronization happens on drop via `AcqRel`. Misusing `Relaxed` for pointer publication is a common bug; the compiler will not warn you.

### Q: Walk through the standard `Arc` clone/drop pattern.

```rust
fn clone(&self) -> Self {
    self.inner().strong.fetch_add(1, Ordering::Relaxed);
    // Just clone the Arc, return new one.
}

fn drop(&mut self) {
    if self.inner().strong.fetch_sub(1, Ordering::Release) != 1 {
        return;
    }
    // We are the last strong. Synchronize with all previous drops.
    atomic::fence(Ordering::Acquire);
    unsafe { self.drop_slow(); }
}
```

Clone uses `Relaxed` — the count alone synchronizes nothing. Drop uses `Release` so that prior writes by this thread happen-before the deallocation. The last drop issues an `Acquire` fence so the destructor sees all prior writes from all threads. This is the textbook lock-free reference counting pattern from Boost; Rust's `Arc` uses it verbatim.

### Q: How does Rust ensure you cannot share a non-Sync type across threads?

The `Send` and `Sync` traits are auto-implemented by the compiler based on the type's contents. `Sync` means `&T` is safe to share across threads. `AtomicUsize: Sync`, so `&AtomicUsize` can be sent into other threads. `Cell<T>: !Sync`, so it cannot. `Arc<T>: Send + Sync` requires `T: Send + Sync`. The borrow checker enforces this at compile time, so most data-race bugs that plague C++ and Java simply do not compile in safe Rust.

### C11 atomic_int

### Q: What does C11 `<stdatomic.h>` give you?

C11 introduced first-class atomic types: `atomic_int`, `atomic_long`, `atomic_uintptr_t`, etc., and generic `_Atomic(T)` for any type. Operations are macros (`atomic_load`, `atomic_store`, `atomic_fetch_add`, `atomic_compare_exchange_strong`) and orderings are the same enum as C++ (`memory_order_relaxed`, `memory_order_acquire`, etc.). The model is intentionally aligned with C++11's so that interop is straightforward. `atomic_flag` is the one always-lock-free type, identical to C++.

### Q: Show a correct C11 CAS-loop increment.

```c
#include <stdatomic.h>

atomic_int counter = ATOMIC_VAR_INIT(0);

void increment(void) {
    int old = atomic_load_explicit(&counter, memory_order_relaxed);
    while (!atomic_compare_exchange_weak_explicit(
        &counter, &old, old + 1,
        memory_order_relaxed, memory_order_relaxed)) {
        // old is updated to the current value on failure; retry.
    }
}
```

`compare_exchange_weak` is preferred inside loops because it can fail spuriously but is faster on LL/SC architectures. On failure the macro automatically updates `old` to the current value, so the next iteration uses the fresh value. In practice for a plain increment `atomic_fetch_add_explicit(&counter, 1, memory_order_relaxed)` is shorter and faster.

### Q: What is `atomic_thread_fence` for?

It is a standalone memory barrier that does not access any atomic location but constrains the ordering of surrounding atomic operations. It is rarely needed in practice — the orderings on the atomics themselves usually suffice. The classic legitimate use is in lock-free reference counting: the last drop wants `Release` on the decrement followed by an `Acquire` fence before deallocation, so the fence picks up all prior `Release` decrements from other threads without coupling that requirement to every single decrement.

### Q: Is `volatile` in C the same as atomic?

No, and this confusion is one of the deepest in systems programming. `volatile` tells the compiler not to optimize away or reorder accesses to a variable — it was designed for memory-mapped I/O. It says nothing about atomicity (a `volatile long` is not atomic on 32-bit platforms), nothing about ordering relative to other memory accesses, and nothing about visibility to other CPUs. Using `volatile` for thread synchronization is a bug — you need `_Atomic` or `atomic_int` from `<stdatomic.h>`. Java's `volatile` is unrelated to C's `volatile` despite the shared keyword.

### Q: How does `atomic_compare_exchange_strong` differ from `weak`?

Strong guarantees the CAS only fails when the values truly differ. Weak is allowed to fail spuriously even when they match. On x86 they generate identical code because `cmpxchg` never fails spuriously. On ARM and POWER, strong CAS wraps weak in a loop to mask spurious failures. If you are already inside your own retry loop (the common case), use weak — it avoids the redundant inner loop. Use strong when the CAS is the entire algorithm and you would otherwise need to wrap it yourself.

---

## Tricky / Trap

### Q: Your atomic counter using `Ordering::Relaxed` under-counts under load. Why?

It does not under-count — relaxed atomics still give you atomicity, so no increment is lost. The bug is somewhere else. The most likely candidates are: (1) the counter is read into a non-atomic local that is itself raced on; (2) one thread incrementing and another thread reading via a non-atomic alias (e.g., through a `*const`); (3) the counter is `i32` and you are overflowing; (4) you have two counter instances because of an unintended `Clone`; (5) you forgot to wait for all threads to finish before reading. If the count is genuinely lower than expected after all threads `join`, the bug is structural, not a relaxed-vs-acq_rel issue. Where `Relaxed` does bite is publishing pointers — not counting.

### Q: You implemented double-checked locking in Java 1.4 and it crashes intermittently. What is wrong?

Pre-Java 5 the JMM allowed the JIT and CPU to reorder the constructor of the inner object with the assignment to the outer reference. A second thread could see a non-null reference whose fields were still uninitialized. The naive fix of "add `synchronized` to the outer check" defeats the purpose; the real fix on Java 5+ is to declare the reference `volatile`, which gives the assignment release semantics. On Java 1.4 there is no clean fix — you must synchronize every access or use static initialization (`Holder` pattern), which is guaranteed thread-safe by the class loader.

### Q: You have a Treiber stack. Pop reads `head`, then CAS's `head` from `old` to `old->next`. It corrupts. Why?

Classic ABA. Thread T1 reads `head = A` and `old->next = B`. Thread T2 pops A (head = B), pops B (head = C), pushes A back (head = A). T1's CAS sees `head == A` and succeeds, setting `head = B`. But B was already popped — the stack is corrupted. Fixes: tagged pointers (combine the pointer with a version counter and CAS the pair via double-width CAS), hazard pointers (T2 cannot reclaim A while T1 has a hazard pointer to it), or epoch-based reclamation. The naive Treiber stack from textbooks only works in garbage-collected languages.

### Q: You wrap a `bool` in `std::atomic<bool>` to signal shutdown. Workers spin on it. They never stop. Why?

Three possibilities. (1) You stored to the bool from the main thread with `memory_order_relaxed` and the workers read with `memory_order_relaxed`, and the compiler hoisted the read out of the loop. The fix is `seq_cst` or `acquire` on the load. (2) The worker thread spins so tightly the OS never schedules the writer. Insert a `std::this_thread::yield()` or a small sleep. (3) You forgot to `notify_all` if the workers are waiting on a condition variable in parallel; the atomic alone does not wake them. The first is the textbook trap that demonstrates why "I made it atomic" is not enough.

### Q: Two threads each increment their own counter in an `int counters[8]` array. Throughput is half of single-threaded. Why?

False sharing. The eight `int`s fit in a single 32-byte cache line. Every increment from any thread invalidates the line on every other core. The fix is to pad each counter to its own cache line:

```cpp
struct alignas(64) Padded { std::atomic<int> v{0}; };
Padded counters[8];
```

After padding throughput scales linearly with the thread count. The same trap appears in lock-free queues where producer and consumer indices share a line, and in any per-thread metric structure laid out as an array of plain integers.

### Q: Your `compare_exchange_weak` in a CAS loop is dramatically slower than `compare_exchange_strong`. Why is this counterintuitive?

It should not be on a correct implementation. If `weak` is slower than `strong`, you are probably misusing it: the standard signature is `compare_exchange_weak(expected, desired)` where `expected` is passed by reference and updated on failure. If you pass a fresh `expected` every iteration, you discard the work the previous iteration did and force an extra load. The correct loop reads `expected` once outside, then loops on weak with the same `expected` reference. The second pitfall is that under low contention strong is fine on x86; the gap only opens on ARM where weak skips an inner retry loop.

### Q: You hold a pointer in `AtomicReference`. You read it, then CAS it. Sometimes the CAS succeeds but the object behind it has been mutated. Why?

`compareAndSet` checks reference identity, not deep equality. If another thread mutates the pointed-to object in place, the reference identity is unchanged and your CAS succeeds. The lesson is that lock-free designs require immutability — every change publishes a new object, never mutates an existing one. The standard pattern is read-copy-update: read the current pointer, allocate a new object copying the old one, modify the copy, CAS the pointer from old to new. Java's `CopyOnWriteArrayList` and Clojure's persistent data structures embody this discipline.

### Q: `volatile int x; x++` in C. Is this thread-safe?

No. `volatile` in C means "do not optimize this access" — it does not mean atomic, and it does not mean ordered with respect to other memory. `x++` is still load-modify-store, three separate instructions, and two threads can both load, increment, and store, losing one increment. Use `_Atomic int` from `<stdatomic.h>` instead. This is the single most common atomic-related bug in legacy C code, and it is reinforced by misleading folklore that says "use volatile for threads".

### Q: Your lock-free queue works on x86 but corrupts on ARM. Why?

x86 has a strong memory model: stores are TSO (total store order), loads are not reordered with prior loads, stores are not reordered with prior stores. Many bugs are hidden because the hardware enforces ordering you forgot to ask for. ARM is weakly ordered: without explicit `acquire`/`release` (or fences) the CPU can and will reorder freely. If you used `memory_order_relaxed` or no ordering at all for publication, ARM will break it. The fix is to audit every atomic operation and use `acquire` on loads that read published data, `release` on stores that publish data, and `seq_cst` only where required.

### Q: You added `std::atomic` everywhere "to be safe" and performance fell off a cliff. Why?

Atomics have a cost: on x86 a `lock`-prefixed RMW or seq_cst store is a serializing instruction that stalls the pipeline and forces the store buffer to drain. Acquire and release loads/stores on ARM are full DMB instructions. If you sprinkle atomics on data that does not need cross-thread synchronization — single-threaded code, thread-local state, data protected by a mutex — you pay this cost for no benefit. Use atomics surgically on the specific shared variables that need cross-thread coordination, not as a blanket "make it safe" tool.

### Q: A reader thread spins on an atomic flag, but the writer thread sometimes takes seconds to be observed. Why?

This is hyperthreading or CPU power-saving behavior, not a memory model bug. A tight spin loop on one logical core starves the sibling logical core of execution resources. Inserting `_mm_pause()` (x86) or `yield` (ARM `WFE`) lets the sibling progress. On battery-powered systems aggressive C-states can also park cores; the writer's store does propagate but the reader is in a state where it polls rarely. The lesson: spinning is a CPU-management problem as much as a memory-model problem.

### Q: You use `compare_exchange_strong` to implement a try-lock. Sometimes it returns failure even when the lock is free. Why?

You probably swapped the `expected` and `desired` arguments, or are seeding `expected` with the wrong initial value. The signature in C++ is `cmpxchg(expected_in_out, desired)`; `expected` must be the value you think is currently in memory. If you pass `expected = true` when the lock is unlocked (false), the CAS naturally fails. Another common mistake is reusing a stale `expected` from a previous iteration without refreshing — but for a try-lock you typically do not loop, you just try once.

### Q: You read an `atomic_int` with `memory_order_relaxed` and use the value to index an array. Is this safe?

The atomic load itself is safe — you get some prior value, not a torn read. What is not safe is what you do with it. If another thread wrote a value out of range of your array (because of a race on a non-atomic length field, for example), you index out of bounds. Atomic ordering does not bound values; it just orders accesses. Always validate values read across threads, and remember that relaxed gives no happens-before with any preceding write — so the data the index points to may not be initialized.

### Q: Your `AtomicLong` counter saturates throughput at ~30M ops/sec on a 64-core machine. Why so low?

A single `AtomicLong` is one cache line. Every increment invalidates the line on the other 63 cores. The cache-coherence traffic dominates and limits you to ~30M ops/sec regardless of how many cores you throw at it. The fix is to shard: maintain N independent counters and aggregate on read. `LongAdder` does this for you. The same applies to Prometheus counter shards, per-CPU counters in the Linux kernel (`percpu_counter`), and similar designs.

### Q: You publish a pointer with `Release` and read it with `Acquire`. The reader sees the new pointer but reads stale data from inside the object. Why?

You did not publish the pointer with release — or the reader read it with relaxed somewhere along the way, perhaps by copying the atomic into a local non-atomic pointer first and then reading via the local. The acquire on the original atomic synchronizes only with the release on that atomic. Once you copy into a non-atomic variable the synchronization edge is established but only at the point of the atomic load; if the load itself was relaxed, you have no synchronization at all. Audit every load — the cheapest path is to make the load itself acquire, not to add fences later.

---

## System / Design Scenarios

### Q: Design a lock-free MPMC queue.

The standard answer is the Michael-Scott queue (linked-list, lock-free, with hazard pointers or epoch reclamation) or a bounded ring buffer (Vyukov MPMC, slot-stamped). For unbounded, multi-producer multi-consumer with low contention: enqueue does a CAS on the tail pointer's `next`, then advances the tail; dequeue does a CAS on the head. The trap is ABA on pointer recycling, so use tagged pointers or a memory reclamation scheme. For bounded high-throughput: per-slot sequence numbers (Dmitry Vyukov's design). Each slot carries a seq counter; producers CAS it from `i` to `i+1` after writing; consumers wait for it to equal `i+1` before reading. False sharing matters — pad head and tail to separate cache lines.

### Q: Design a counter that scales to 64 cores.

A single `AtomicLong` does not. Use striped counters: an array of N cells (N >= number of cores, padded to cache lines), each thread hashes itself to a cell and increments that cell. `sum()` adds them up. Java's `LongAdder` does exactly this. To handle dynamic growth, start with one cell and expand on contention. For reads, accept that `sum()` is not a linearizable snapshot — it is a sum of independently increasing counters that may not all be observed at the same instant. This is almost always acceptable for metrics; for stricter semantics, take a brief read lock or use a synchronized aggregate.

### Q: Design concurrent reference counting.

Boost-style intrusive `shared_ptr`. Each object embeds a `std::atomic<size_t>` strong count. `clone` does `fetch_add(1, relaxed)` — the count alone does not need to synchronize anything because the caller already has a valid pointer. `drop` does `fetch_sub(1, release)`; if the result is 1 (we held the last reference), issue an `acquire` fence and run the destructor. The acquire fence on the last drop synchronizes with the release on every prior drop, so the destructor sees a consistent view. For weak references, add a second `atomic<size_t>` weak count; upgrading a weak to strong is a CAS loop that fails if the strong count has hit zero.

### Q: Design a single-producer single-consumer ring buffer.

```cpp
template<typename T, size_t N>
class SPSCRing {
    alignas(64) std::atomic<size_t> head{0};
    alignas(64) std::atomic<size_t> tail{0};
    T buf[N];
public:
    bool push(T v) {
        auto t = tail.load(std::memory_order_relaxed);
        auto next = (t + 1) % N;
        if (next == head.load(std::memory_order_acquire)) return false;
        buf[t] = std::move(v);
        tail.store(next, std::memory_order_release);
        return true;
    }
    bool pop(T& out) {
        auto h = head.load(std::memory_order_relaxed);
        if (h == tail.load(std::memory_order_acquire)) return false;
        out = std::move(buf[h]);
        head.store((h + 1) % N, std::memory_order_release);
        return true;
    }
};
```

Producer reads tail relaxed (only it writes tail), reads head acquire (paired with consumer's release). Consumer is symmetric. Padding head and tail to separate cache lines is essential.

### Q: Design a one-shot latch.

A single `std::atomic<bool>` flipped from false to true. Waiters spin or sleep on it; the writer does one release store. Add `std::atomic::wait` and `notify_all` (C++20) to avoid busy spinning; on older toolchains use a `futex`/`pthread_cond_t` wakeup mechanism wrapped around the atomic check. The release on set pairs with acquire on every read, so any data the setter wrote before flipping the flag is visible to waiters after they see it.

### Q: Design a wait-free statistics counter for tail latency tracking.

For a streaming p99 you usually use HDR Histogram or t-digest — neither is lock-free in general, but per-thread instances aggregated on read work well. Each thread has its own histogram (no synchronization needed on the hot path); a background thread or the reader merges them. For simpler metrics like a max, use `atomic.fetch_max` (C++20) or a CAS loop that retries until the stored value is at least as large as the new sample. The key property is per-thread state — never share a hot path location across threads.

### Q: Design a lock-free hash map.

Hard. Real implementations (e.g., Java's `ConcurrentHashMap`, Cliff Click's lock-free hash map, Folly's AtomicHashMap) typically use open addressing with a sentinel "in-progress" state per slot. Insert CAS's the slot from empty to the new entry; lookups skip in-progress slots. Resize is the hard part: every operation must check the table version and help with migration if a resize is in flight. For most practical applications, a fine-grained-locked hash map (lock per bucket or per stripe) gives 95% of the performance with 10% of the complexity. Reach for a truly lock-free map only when latency tails matter more than throughput.

### Q: Design a recursive read-mostly cache with atomic publication.

Read-copy-update style. Cache is a single `atomic<shared_ptr<Snapshot>>` or `atomic<const T*>` where `T` is the immutable snapshot. Readers do one acquire load — no locks, no contention. Writers build a new snapshot, then CAS the pointer from the old snapshot to the new one. Old snapshots are reclaimed when no reader holds them (refcounting, hazard pointers, or epochs). This pattern is wait-free for readers and lock-free for writers, and it is the canonical structure behind Linux's RCU, Java's `CopyOnWriteArrayList`, and many config-distribution systems.

---

## Coding Questions

### Q: Implement a Treiber stack push and pop in C++.

```cpp
template<typename T>
class TreiberStack {
    struct Node {
        T value;
        Node* next;
    };
    std::atomic<Node*> head{nullptr};
public:
    void push(T v) {
        Node* n = new Node{std::move(v), nullptr};
        Node* old = head.load(std::memory_order_relaxed);
        do {
            n->next = old;
        } while (!head.compare_exchange_weak(
            old, n,
            std::memory_order_release,
            std::memory_order_relaxed));
    }

    bool pop(T& out) {
        Node* old = head.load(std::memory_order_acquire);
        while (old) {
            Node* next = old->next;
            if (head.compare_exchange_weak(
                old, next,
                std::memory_order_acquire,
                std::memory_order_acquire)) {
                out = std::move(old->value);
                // delete old;  // ABA-unsafe without reclamation
                return true;
            }
        }
        return false;
    }
};
```

`push` is acquire-release safe. `pop` has the ABA hazard discussed earlier — production code needs hazard pointers or RCU. Deleting `old` after pop is the unsafe step; commenting it out leaks memory but is the simplest correct demo.

### Q: Implement a spinlock using `atomic_flag`.

```cpp
class Spinlock {
    std::atomic_flag flag = ATOMIC_FLAG_INIT;
public:
    void lock() {
        while (flag.test_and_set(std::memory_order_acquire)) {
            #if defined(__x86_64__)
            __builtin_ia32_pause();
            #endif
        }
    }
    bool try_lock() {
        return !flag.test_and_set(std::memory_order_acquire);
    }
    void unlock() {
        flag.clear(std::memory_order_release);
    }
};
```

The `pause` instruction reduces power and gives the sibling hyperthread time to make progress. Without it, contended spinning can drop overall throughput. For a production spinlock add backoff (exponentially increasing yields), and detect cases where you should fall back to a futex-based mutex.

### Q: Implement a CAS-loop increment in Rust.

```rust
use std::sync::atomic::{AtomicU64, Ordering};

fn increment(c: &AtomicU64) -> u64 {
    let mut old = c.load(Ordering::Relaxed);
    loop {
        match c.compare_exchange_weak(
            old, old + 1,
            Ordering::Relaxed, Ordering::Relaxed,
        ) {
            Ok(prev) => return prev + 1,
            Err(current) => old = current,
        }
    }
}
```

In practice you would write `c.fetch_add(1, Ordering::Relaxed)` and let the hardware do it in one `lock xadd`. This snippet is the educational version — the same shape works for `max`, `min`, conditional swaps, and other RMWs where `fetch_add` does not exist.

### Q: Implement a lock-free SPSC ring buffer in Go.

```go
type SPSC[T any] struct {
    head    atomic.Uint64
    _pad1   [56]byte
    tail    atomic.Uint64
    _pad2   [56]byte
    buf     []T
    mask    uint64
}

func New[T any](size uint64) *SPSC[T] {
    // size must be a power of two
    return &SPSC[T]{buf: make([]T, size), mask: size - 1}
}

func (q *SPSC[T]) Push(v T) bool {
    t := q.tail.Load()
    if t-q.head.Load() == uint64(len(q.buf)) {
        return false
    }
    q.buf[t&q.mask] = v
    q.tail.Store(t + 1)
    return true
}

func (q *SPSC[T]) Pop() (T, bool) {
    var zero T
    h := q.head.Load()
    if h == q.tail.Load() {
        return zero, false
    }
    v := q.buf[h&q.mask]
    q.head.Store(h + 1)
    return v, true
}
```

`size` is a power of two so `& mask` replaces modulo. Padding separates head and tail to different cache lines. The producer only writes `tail` and only reads `head`; the consumer is symmetric — that is what makes it SPSC and avoids contention entirely.

### Q: Implement a tagged-pointer ABA fix.

```cpp
#include <atomic>
#include <cstdint>

template<typename T>
class TaggedPtr {
    struct alignas(16) Tagged {
        T* ptr;
        uintptr_t tag;
    };
    std::atomic<Tagged> head{Tagged{nullptr, 0}};
    static_assert(std::atomic<Tagged>::is_always_lock_free,
                  "needs DCAS hardware (cmpxchg16b / casp)");
public:
    void push(T* p) {
        Tagged old = head.load(std::memory_order_relaxed);
        Tagged neu;
        do {
            p->next = old.ptr;
            neu = {p, old.tag + 1};
        } while (!head.compare_exchange_weak(old, neu,
                  std::memory_order_release));
    }

    T* pop() {
        Tagged old = head.load(std::memory_order_acquire);
        Tagged neu;
        do {
            if (!old.ptr) return nullptr;
            neu = {old.ptr->next, old.tag + 1};
        } while (!head.compare_exchange_weak(old, neu,
                  std::memory_order_acquire));
        return old.ptr;
    }
};
```

The tag increments on every push and pop, so even if the same `ptr` value returns the `tag` differs and the CAS fails. This requires double-width CAS (`cmpxchg16b` on x86-64). Older code packs the tag into the high bits of the pointer (works because virtual addresses do not use all 64 bits) to use single-width CAS.

### Q: Implement a one-shot done flag with C++20 wait/notify.

```cpp
#include <atomic>

class Latch {
    std::atomic<bool> done{false};
public:
    void wait() {
        while (!done.load(std::memory_order_acquire)) {
            done.wait(false, std::memory_order_acquire);
        }
    }
    void release() {
        done.store(true, std::memory_order_release);
        done.notify_all();
    }
};
```

`wait(false)` blocks until the value is not false. The atomic-level wait/notify avoids the busy-spin while keeping the API minimal. On Linux this is a futex; on Windows it is `WaitOnAddress`. The release store pairs with each waiter's acquire load so any data the producer wrote before releasing is visible to the waiters.

### Q: Implement a max-tracking atomic.

```cpp
template<typename T>
class AtomicMax {
    std::atomic<T> v{std::numeric_limits<T>::min()};
public:
    void update(T sample) {
        T current = v.load(std::memory_order_relaxed);
        while (sample > current &&
               !v.compare_exchange_weak(current, sample,
                   std::memory_order_relaxed)) {}
    }
    T load() const { return v.load(std::memory_order_relaxed); }
};
```

The CAS loop only attempts the swap when `sample > current`; if another thread raced ahead with a larger value the loop exits naturally without overwriting. This is the textbook pattern for any monotonic RMW that does not have a direct hardware instruction. C++20 adds `fetch_max` for some types which compiles to this loop on most platforms.

---

## Behavioral

### Q: Tell me about a time you debugged a data race in production.

A good answer names a specific symptom (intermittent crash, wrong count, hang), the diagnostic tools used (TSAN, helgrind, JFR, custom logging with thread IDs and timestamps), the root cause in atomic terms (missing release on publication, relaxed where acq_rel was needed, false sharing, ABA), and the fix with measured improvement. The interviewer is listening for whether you can reason about happens-before, not whether you found the bug by accident.

### Q: When have you chosen a lock over a lock-free structure?

The honest answer is "most of the time". Lock-free is harder to write, harder to test, harder to debug, harder to maintain, and only wins when contention is high enough that the locking cost dominates. A good answer describes a specific case where you measured that a mutex was the bottleneck (profiler showed >20% time waiting), considered lock-free alternatives, and either implemented one with a benchmark proving the gain or rejected it because the win was too small to justify the complexity.

### Q: How do you decide which memory ordering to use?

Start with seq_cst for clarity. Profile. If atomics show up in the profile, drop to acquire-release where you have a clear publication pattern. Drop to relaxed only for unconditional counters or where you can articulate exactly why no ordering is needed. Document the rationale next to the code — six months later neither you nor your colleagues will remember why a particular ordering was chosen. A good answer mentions tooling (TSAN catches some misuses, formal model checkers like `cdsspec` for the truly hard cases).

### Q: Describe a time you misused atomics.

Honest self-criticism shows seniority. Common confessions: used `volatile` in C thinking it was atomic; used `Relaxed` for pointer publication; assumed x86 strong ordering would carry over to ARM; added atomics everywhere "to be safe" and tanked performance; missed ABA in a Treiber stack. Discuss how you found the bug and what you changed about your design approach afterward.

### Q: How do you teach junior engineers about memory ordering?

Whiteboard the producer-consumer pattern, draw the happens-before edge, and walk through what each ordering forbids and permits. Use a small concrete program that breaks on relaxed and works on acq_rel. Recommend running TSAN on every change involving shared state. Point them at "C++ Concurrency in Action" or "The Art of Multiprocessor Programming". Emphasize that "make it atomic" is not a fix unless they can articulate the ordering requirement.

### Q: When have you preferred a high-level abstraction over raw atomics?

`std::shared_ptr` for refcounting, channels in Go, actors in Erlang, `Arc<Mutex<T>>` in Rust for shared state where lock contention is not the bottleneck. A good answer recognizes that hand-rolled atomic code is a maintenance liability and prefers the standard library or framework primitive whenever it meets the latency target. Save raw atomics for the hot path where the abstraction overhead is measurable.

### Q: How do you review code that uses atomics?

Look at every atomic operation and ask: what is being synchronized with what? If you cannot answer in one sentence, the code is probably wrong. Check that releases pair with acquires on the same atomic. Check for false sharing on hot variables (padding to cache line). Check that ABA cannot occur in pointer CAS. Look for `volatile` in C used as a sync primitive — almost always wrong. Suggest TSAN runs on the test suite. Require a comment next to each non-seq_cst ordering explaining why.

### Q: What is your approach to testing lock-free code?

Stress tests with many threads for long durations, run under TSAN and helgrind, and ideally a formal model checker like `Loom` in Rust or `cdsspec` in C++ that explores all possible interleavings of a small input. Property-based tests for invariants (queue: every enqueued item is dequeued exactly once). Inject delays at strategic points (after a load, before a CAS) to widen the race window. Code review by another engineer who is familiar with atomics. Accept that you can never fully verify lock-free code by testing alone — formal reasoning is required.

---

## What I'd Ask a Candidate Now

### Q: Walk me through what happens at the cache-coherence level when two threads do `fetch_add(1)` on the same atomic on a 64-core machine.

I want to hear about cache lines, MESI/MOESI states, the ping-pong of the line between the two cores' L1 caches, the cost in cycles, why throughput collapses as more cores join, and how striping or padding fixes it. A senior candidate should be able to estimate the slowdown (an order of magnitude or two) and propose a measurement strategy (`perf c2c` on Linux).

### Q: Explain when `memory_order_relaxed` is correct for a counter and when it is not.

I want to hear the producer-consumer publication pattern explicitly: counters are fine because no other thread reads them and then dereferences memory written before; pointers and ready-flags are not fine because the reader will access data written before the atomic store. A good candidate volunteers `Arc::clone` as the canonical relaxed counter and contrasts it with publication.

### Q: Why is ABA a problem and how would you defend against it?

I want to hear the recycle example, the tagged-pointer fix, the hazard-pointer fix, and an honest statement that "in a GC language, ABA on a non-recycled allocation is much rarer because the GC will not free a node while a thread holds a reference to it". A senior candidate distinguishes ABA on values (still possible) from ABA on freshly allocated pointers (GC mostly prevents this).

### Q: What is the difference between `compare_exchange_weak` and `compare_exchange_strong`, and which would you use in a retry loop?

I want the LL/SC explanation, the spurious-failure point, and the answer "weak in a retry loop, strong for one-shot semantics". A bonus is mentioning that on x86 they generate identical code.

### Q: Sketch a lock-free SPSC ring buffer and tell me where the cache lines should be aligned.

The candidate should produce something close to the snippet in Coding above, pad head and tail to separate cache lines, use power-of-two size with mask, use relaxed loads on the local index and acquire loads on the peer index. Bonus for noticing that if the consumer writes a "consumed up to" hint in its own cache line the producer reads less frequently.

### Q: Tell me about the most subtle atomic bug you have shipped.

I want a concrete story with diagnostic and root cause. The best answers involve realizing the bug only manifested on ARM, or only at scale, or only after a compiler upgrade exposed a missing fence. The worst answers say "I've never had an atomic bug" — that just means the candidate has not used atomics in anger.

### Q: When would you reach for `LongAdder` over `AtomicLong`?

High contention, write-heavy, read-light. The candidate should articulate the cache-line ping-pong on `AtomicLong` and the striping in `LongAdder`, and acknowledge the trade-offs (not a linearizable snapshot, larger footprint).

---

## Cheat Sheet

- **Atomicity** = indivisible. **Visibility** = eventual propagation. **Ordering** = sequence between operations. Confusing these is the root cause of most bugs.
- **`i++` is never atomic**. Use `fetch_add` or CAS-loop.
- **Memory orderings** (weakest first): relaxed, acquire (on loads), release (on stores), acq_rel (RMW), seq_cst.
- **Default in C++/Rust** is seq_cst; **default in Java** is volatile = release/acquire + seq_cst total order.
- **Acquire-release publication**: producer release-stores a pointer; consumer acquire-loads it; all prior writes by producer are visible to consumer.
- **CAS** = compare-and-swap. Foundation of every lock-free structure.
- **CAS weak vs strong**: weak inside loops (cheaper on ARM), strong for one-shot.
- **`fetch_add` > CAS-loop** for unconditional increments — never retries.
- **ABA**: value goes A->B->A between load and CAS; CAS succeeds incorrectly. Fix: tags, hazard pointers, RCU.
- **False sharing**: different variables on the same cache line bouncing between cores. Pad to 64 bytes.
- **`volatile` in C != atomic**. Use `<stdatomic.h>`. Java `volatile` is unrelated.
- **`volatile` in Java** = release on write, acquire on read, fixes pre-Java 5 double-checked locking.
- **`std::atomic<T>::is_lock_free()`** false means it falls back to a hidden mutex.
- **Spinlock** = `atomic_flag` + acquire on `test_and_set`, release on `clear`, with `pause`/`yield` inside.
- **Lock-free counter at scale**: stripe (LongAdder pattern), pad cache lines, sum on read.
- **x86 strong ordering** hides ordering bugs that surface on ARM. Audit explicit memory orders.
- **Reference counting**: clone with relaxed, drop with release, last drop with acquire fence.
- **Treiber stack pop**: ABA-unsafe without reclamation; use hazard pointers or epochs in C++.
- **Test with TSAN**, `helgrind`, `Loom` (Rust), and long-running stress tests. Formal reasoning required for correctness.
- **Reach for atomics surgically**; for most shared state a mutex is faster to write, debug, and maintain.

---

## Further Reading

- Maurice Herlihy & Nir Shavit, *The Art of Multiprocessor Programming* — the canonical textbook on lock-free algorithms.
- Anthony Williams, *C++ Concurrency in Action* (2nd ed) — clear walkthrough of `std::atomic` and the C++ memory model.
- Hans Boehm, "Threads Cannot Be Implemented as a Library" — why memory models had to be standardized.
- Paul McKenney, *Is Parallel Programming Hard, And, If So, What Can You Do About It?* — Linux kernel perspective.
- Maged Michael, "Hazard Pointers: Safe Memory Reclamation for Lock-Free Objects" — IEEE TPDS 2004.
- Dmitry Vyukov's blog on lock-free queues — practical bounded MPMC designs.
- Cliff Click, "A Lock-Free Hash Table" talk — JavaOne 2007.
- Jeff Preshing's blog series on memory ordering — the most accessible introductions to acquire/release.
- C++ Standard `[atomics]` and Java Memory Model JSR-133 specifications.
- Rust `std::sync::atomic` documentation and the `Ordering` enum's notes.

---

## Related Topics

- [Atomic Operations — Overview](README.md)
- [Memory Model and Happens-Before](../../../README.md)
- [Mutexes](../03-mutex/README.md)
- [Lock-Free Data Structures](../README.md)
- [False Sharing and Cache Lines](../../../../memory-management/README.md)
- [CPU Memory Models (x86, ARM)](../../../../../README.md)
- [Concurrency Patterns Skill](../../../../../../../../../skills/concurrency-patterns/SKILL.md)
- [Distributed Locking](../../../../../../../../../skills/distributed-locking/SKILL.md)
