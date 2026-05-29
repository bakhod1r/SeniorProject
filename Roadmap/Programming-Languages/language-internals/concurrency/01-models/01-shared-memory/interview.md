# Shared-Memory Concurrency — Interview Questions

> **Topic:** [Shared-Memory Concurrency](README.md)

---

## Introduction

These questions probe a candidate's understanding of the shared-memory concurrency model — the foundation underneath every threading library, every lock primitive, and every atomic variable used in production systems. The goal is not to trap candidates on trivia but to discover whether they can reason about programs where two or more threads of execution observe and mutate the same memory, and whether they understand the gap between the program they wrote and the program the CPU actually executes.

A strong candidate answers these questions with mechanical precision: they distinguish between data races and race conditions, they speak of memory ordering rather than "thread safety" in the abstract, and they recognize that on a modern multi-core CPU there is no single global notion of "the value of `x`" — instead there are caches, store buffers, write coalescing, and compiler reorderings to reason about. A weaker candidate gives surface-level answers ("use a lock") without explaining what the lock actually does to the hardware. The questions below progress from the foundational vocabulary to language-specific surfaces, then to traps where the textbook answer is wrong, then to design scenarios that test whether the candidate has actually built concurrent systems.

## Table of Contents

- [Conceptual / Foundational](#conceptual--foundational)
- [Language-Specific](#language-specific)
  - [Java](#java)
  - [Go](#go)
  - [Python](#python)
  - [C++](#c)
  - [Rust](#rust)
- [Tricky / Trap Questions](#tricky--trap-questions)
- [System / Design Scenarios](#system--design-scenarios)
- [Coding Questions](#coding-questions)
- [Behavioral / Experience](#behavioral--experience)
- [What I'd Ask a Candidate Now](#what-id-ask-a-candidate-now)
- [Cheat Sheet](#cheat-sheet)
- [Further Reading](#further-reading)
- [Related Topics](#related-topics)

---

## Conceptual / Foundational

### Q: What is the difference between a data race and a race condition?

A data race is a precise, mechanical concept: two or more threads access the same memory location concurrently, at least one access is a write, and there is no synchronization (no happens-before edge) between them. In most memory models — C11, C++11, Java, Go — a data race is undefined behavior or produces unspecified values. A race condition is a broader, semantic concept: the correctness of the program depends on the relative timing of operations. A program can have a race condition without a data race (for example, two threads each take a properly-locked balance and decide to withdraw, and both succeed even though the bank balance only supports one withdrawal). Conversely, a program can have a data race that, on a particular CPU and compiler, happens to produce correct results — but it is still undefined behavior and is allowed to break at any time. The distinction matters because tools like ThreadSanitizer detect data races mechanically, while race conditions require reasoning about invariants.

### Q: What is happens-before?

Happens-before is a partial order over memory operations defined by the language's memory model. If operation A happens-before operation B, then the effects of A (including writes to memory) are guaranteed to be visible to B. Happens-before is established by: program order within a single thread, synchronization operations (lock acquire and release, atomic operations with the appropriate memory order, thread start and join, channel send and receive), and transitively by chaining the above. Crucially, the absence of a happens-before relationship between two writes by different threads is exactly what makes them a data race. When an interviewer asks "is this thread-safe?", the disciplined answer is to draw the happens-before edges and check whether every read of a shared variable is preceded by a happens-before edge from the latest write.

### Q: Why was double-checked locking broken before JSR-133?

The classic double-checked locking pattern looks like `if (instance == null) { synchronized(lock) { if (instance == null) instance = new Singleton(); } }`. The pattern reads `instance` without holding the lock and only takes the lock if the field appears null. The bug, prior to Java's JSR-133 memory model (Java 5), was that the constructor of `Singleton` is not atomic from another thread's perspective: the JVM is allowed to publish the reference to `instance` before the constructor's writes to the object's fields are visible. Another thread can therefore observe `instance != null`, dereference it, and read default values (zero, null) from its fields — even though the constructor logically wrote to them. JSR-133 fixed this by giving `volatile` reads and writes acquire and release semantics, so declaring `instance` as `volatile` makes the pattern correct on Java 5 and later. In C++, the same pattern needs `std::atomic<Singleton*>` with appropriate memory orders or `std::call_once`.

### Q: What is false sharing?

False sharing is a performance pathology, not a correctness bug. Modern CPUs maintain coherence at cache line granularity, typically 64 bytes on x86 and ARM. If two variables happen to live on the same cache line and two threads on different cores write to those variables, the cache coherence protocol (MESI, MOESI) treats each write as if it conflicts with the other: the line bounces back and forth between cores, invalidating each core's copy on every write. The variables themselves never share data, hence "false" sharing. Symptoms include a per-thread counter array that scales sub-linearly with thread count, or a single hot variable being inexplicably slow. The fix is padding (align each hot variable to its own cache line, often `alignas(64)` in C++ or `_ pad [64]byte` in Go) or restructuring so that hot writes from different threads land on different lines.

### Q: What does `volatile` mean in C versus Java?

The two are different keywords that happen to share a name and confuse generations of developers. In C and C++, `volatile` is about memory-mapped I/O and signal handlers: it tells the compiler not to optimize away or reorder accesses to a variable because the value may change outside the normal program flow (a hardware register, a signal handler write). `volatile` in C provides no atomicity, no inter-thread ordering, and no protection against data races. In Java, `volatile` is a synchronization primitive: a `volatile` read has acquire semantics and a `volatile` write has release semantics, which means writes that happen-before a `volatile` write are visible to any thread that subsequently reads that `volatile`. Java's `volatile` is roughly equivalent to C++'s `std::atomic<T>` with `memory_order_seq_cst`. The mistake of using C's `volatile` for thread synchronization is one of the most common errors in legacy multithreaded C code.

### Q: What is a memory fence?

A memory fence (or memory barrier) is a CPU instruction that constrains the ordering of memory operations across the fence. A full fence prevents both loads and stores from being reordered across it; an acquire fence prevents subsequent loads and stores from being moved before it; a release fence prevents prior loads and stores from being moved after it. Fences are how high-level synchronization primitives like locks and atomics are implemented under the hood. On x86, most fences are implicit (the TSO model forbids most reorderings), but `mfence` is needed for sequentially consistent stores. On ARM and POWER, explicit `dmb` or `lwsync` instructions are emitted by the compiler when you use `std::atomic` with `seq_cst` or `acq_rel` orderings. Understanding fences is essential to reasoning about lock-free code.

### Q: Why is `i++` not atomic?

`i++` compiles to at least three machine operations: load `i` from memory into a register, increment the register, and store the register back to memory. Between any of these steps, another thread can read or write `i`. If two threads both execute `i++` starting from `i = 0`, the interleaving can be: thread A loads 0, thread B loads 0, thread A increments to 1, thread B increments to 1, both store 1, so the final value is 1 instead of 2 — one increment is lost. An atomic increment requires either a hardware instruction like x86 `lock xadd` or a CAS loop (compare-and-swap that retries on contention). High-level languages expose this through `std::atomic<int>::fetch_add`, `java.util.concurrent.atomic.AtomicInteger.incrementAndGet`, or Go's `atomic.AddInt64`.

### Q: Spinlock versus mutex — when do you use each?

A spinlock burns CPU in a tight loop checking whether a flag has been released. A mutex puts the waiting thread to sleep in the kernel and wakes it when the lock becomes available. Spinlocks are appropriate when the critical section is very short (a few instructions), contention is low or bounded, the cost of a context switch is high relative to the critical section, and the lock holder is guaranteed to be running on another core (so spinning will succeed soon). Mutexes are appropriate for everything else: longer critical sections, higher contention, or when the lock holder might be preempted. In user space, almost always use a mutex (or a futex-based hybrid like `pthread_mutex_t`, which spins briefly then sleeps). Spinlocks are common in kernel code where you cannot sleep while holding the lock, or in user-space lock-free fast paths where you know contention is rare.

### Q: What is priority inversion and what was the Mars Pathfinder bug?

Priority inversion occurs when a high-priority thread is blocked waiting for a resource (typically a lock) held by a low-priority thread, while a medium-priority thread runs and prevents the low-priority thread from making progress. The high-priority thread is effectively running at the medium thread's priority — inverted. The Mars Pathfinder mission in 1997 suffered this exact bug: a high-priority bus management task waited on a mutex held by a low-priority meteorological task, while a medium-priority communications task starved the meteorological task, causing repeated system resets. The fix on Pathfinder was to enable priority inheritance on the mutex (uploaded as a patch from Earth), where the low-priority lock holder temporarily inherits the priority of the highest-priority waiter so it can finish and release the lock. Other solutions include priority ceiling protocols.

### Q: What is the ABA problem?

The ABA problem arises in lock-free algorithms that use CAS to detect concurrent modification. A thread reads value A, computes a new value, and tries to CAS from A to its new value. Another thread changes A to B, then back to A. The first thread's CAS succeeds because the memory still contains A, but the meaning of A has changed — for example, in a lock-free stack, the head pointer might point to the same node, but that node's `next` pointer has been recycled. The result is silent corruption. Solutions include tagged pointers (pack a generation counter into the pointer's unused bits so each modification bumps the tag), hazard pointers (prevent reclamation while another thread is reading), epoch-based reclamation, or simply using a primitive that already handles this like `std::shared_ptr` with `std::atomic`.

### Q: When and why does the compiler or CPU reorder memory operations?

Both compiler and CPU reorder operations to extract performance. The compiler reorders for register allocation, common subexpression elimination, and instruction scheduling — as long as the single-threaded observable behavior is preserved (the "as-if" rule). The CPU reorders through pipelining, out-of-order execution, store buffers, and write coalescing. On a single core or in a single-threaded program, these reorderings are invisible. Across threads, however, a write that happens before another in program order may become visible to other threads in the opposite order. The memory model defines which reorderings are allowed. x86 is relatively strong (TSO — only store-to-load reordering across different addresses is permitted). ARM and POWER are weak (almost any reordering is permitted unless an explicit fence is inserted). This is why portable concurrent code uses `std::atomic` or `volatile` (Java) — the compiler then emits the right fences for the target architecture.

### Q: What does CAS return?

Compare-and-swap takes a memory location, an expected value, and a new value. The hardware atomically checks whether the memory location contains the expected value, and if so, writes the new value; otherwise it leaves memory unchanged. CAS returns either the previous value of the memory location (so the caller can check whether the swap succeeded by comparing it to the expected value), or a boolean success indicator depending on the API. In C++, `std::atomic::compare_exchange_strong` and `compare_exchange_weak` take the expected value by reference: on failure, they update the reference to the actual current value and return false. The "weak" variant is allowed to fail spuriously (return false even when the values match), which lets it map directly to the LL/SC pattern on ARM and POWER. Code that uses weak CAS must loop.

### Q: What is livelock?

Livelock is the concurrent analogue of two polite people trying to pass each other in a hallway, each stepping aside and ending up in the other's way again. Threads are not blocked — they are actively making "progress" — but the system as a whole makes none. A common cause is naive deadlock-avoidance: when a thread detects it might deadlock, it backs off and retries, but all threads back off and retry in lockstep, so none ever holds all the locks it needs. Optimistic concurrency control can livelock when contention is high: every transaction restarts because another transaction committed first, and none ever finishes. The fix is randomized backoff, prioritization, or a higher-level scheduler that breaks symmetry.

### Q: What is sequential consistency versus TSO versus weak ordering?

Sequential consistency (SC), defined by Lamport, says the result of any execution is as if all operations of all threads were executed in some sequential order, and the operations of each thread appear in program order. SC is the model most programmers intuitively assume but is the most expensive to implement. Total Store Order (TSO), used by x86 and SPARC, allows a load to be reordered before an earlier store to a different address (because stores are buffered). TSO preserves enough ordering that most code "just works" but allows surprising outcomes like Dekker's algorithm requiring an `mfence`. Weak ordering, used by ARM, POWER, and Alpha, allows almost any reordering unless an explicit fence is inserted. Higher-level languages (Java, C++, Go) hide this with their memory models: when you use the language's synchronization primitives, the compiler emits whatever fences the target architecture needs.

### Q: What is the difference between deadlock and starvation?

Deadlock is a state where two or more threads are each holding a resource the other needs and none can make progress; the system is permanently stuck unless an external party intervenes. The four classic Coffman conditions are required: mutual exclusion, hold-and-wait, no preemption, and circular wait. Breaking any one breaks deadlock. Starvation is different: a thread is denied progress indefinitely while other threads keep making progress. A reader-writer lock that prioritizes readers can starve a writer; an unfair scheduler can starve a low-priority thread. Starvation is harder to detect than deadlock because the system still appears alive. Fairness mechanisms (FIFO queues in locks, priority aging in schedulers) address starvation.

### Q: Explain test-and-set versus compare-and-swap.

Test-and-set (TAS) is the simplest atomic primitive: it atomically reads a memory location and sets it to a known value, returning the old value. It is sufficient to implement a spinlock but limited because the new value is fixed. Compare-and-swap (CAS) is strictly more powerful: it takes an expected value and a new value, and writes the new value only if memory currently holds the expected value. CAS can implement TAS trivially, but TAS cannot implement CAS without other primitives. CAS is the foundation of lock-free programming because it lets a thread say "I want to make this change, but only if the world hasn't changed underneath me." Most modern architectures expose CAS directly (`cmpxchg` on x86, `ldxr`/`stxr` LL/SC pairs on ARM that the compiler synthesizes into CAS).

---

## Language-Specific

### Java

### Q: What does `synchronized` do beyond mutual exclusion?

`synchronized` establishes a happens-before relationship: writes that happen before the release of a monitor (the implicit unlock at the end of a `synchronized` block) are visible to any thread that subsequently acquires the same monitor. It is both a mutual exclusion primitive and a memory barrier. `synchronized` is reentrant (the same thread can acquire the same monitor multiple times). Modern JVMs implement `synchronized` as a thin lock that escalates: biased locking (now deprecated), then a lightweight CAS-based lock, then a heavyweight OS monitor on contention. The HotSpot JIT can also eliminate `synchronized` blocks on objects proven to be thread-local via escape analysis.

### Q: What guarantees does `volatile` provide in Java?

A `volatile` field provides three guarantees: atomic read and write of the field even for 64-bit `long` and `double` (which would otherwise be torn on 32-bit JVMs), visibility (a write is immediately visible to all subsequent reads on any thread), and ordering (the JMM treats `volatile` writes as releases and `volatile` reads as acquires, so writes that happen before a `volatile` write are visible to threads that read the `volatile`). What `volatile` does not provide is atomicity of compound operations: `volatile int x; x++;` is still a race because the increment is read-modify-write.

### Q: How is `AtomicInteger` different from `volatile int`?

`volatile int` provides atomic read and write but compound operations like `++` are not atomic. `AtomicInteger` wraps an `int` and exposes atomic compound operations: `incrementAndGet`, `compareAndSet`, `getAndAdd`. Under the hood, these use the platform's CAS instruction (`lock xadd` or `lock cmpxchg` on x86). Use `volatile int` when you only need single-write visibility (for example, a `running` flag that one thread sets and others poll); use `AtomicInteger` when you need read-modify-write atomicity (counters, sequence generators).

### Q: When would you use `ReentrantLock` instead of `synchronized`?

`ReentrantLock` (from `java.util.concurrent.locks`) offers features that `synchronized` lacks: timed lock acquisition (`tryLock(timeout)`), interruptible lock acquisition (`lockInterruptibly`), multiple condition variables on the same lock (`newCondition`), fair acquisition order, and the ability to lock and unlock in different methods (which is also a footgun). `synchronized` is simpler, has JIT support like biased locking and lock elision, and the lock is automatically released on exception. Use `synchronized` by default; reach for `ReentrantLock` when you specifically need its features.

### Q: Walk me through correct double-checked locking in modern Java.

```java
class Singleton {
    private static volatile Singleton instance;

    public static Singleton getInstance() {
        Singleton local = instance;
        if (local == null) {
            synchronized (Singleton.class) {
                local = instance;
                if (local == null) {
                    local = new Singleton();
                    instance = local;
                }
            }
        }
        return local;
    }
}
```

The `volatile` declaration is essential — without it, the JIT or CPU can reorder the constructor's writes after the `instance = local` publication. The local variable is an optimization to avoid re-reading the `volatile` field on the fast path. In modern Java, prefer `enum`-based singletons or static-holder idioms (`static class Holder { static final Singleton INSTANCE = new Singleton(); }`) which use class initialization semantics and are simpler and equally safe.

### Q: Explain the Java Memory Model at a high level.

The JMM, formalized in JSR-133 and refined since, defines what values a read is allowed to return in a multi-threaded program. The model is defined in terms of happens-before, which is established by program order, monitor lock and unlock, `volatile` writes and reads, thread `start` and `join`, and a few others. The JMM is intentionally weak — it permits the JIT and CPU significant reordering freedom for performance — but it provides strong guarantees when synchronization primitives are used correctly: a properly synchronized program (one with no data races under sequentially consistent execution) is guaranteed to behave as if it were sequentially consistent. The JMM also guarantees safe publication of objects through `final` fields, `volatile` fields, `synchronized` blocks, and static initializers.

### Go

### Q: What does `sync.Mutex` guarantee?

`sync.Mutex` provides mutual exclusion: at most one goroutine holds the lock at a time. It also establishes a happens-before relationship in Go's memory model: a `Lock` synchronizes-with the previous `Unlock` on the same mutex, so writes before the `Unlock` are visible after the `Lock`. Go's mutex is not reentrant — calling `Lock` while already holding it deadlocks. The implementation uses a fast path (a single CAS for uncontended acquisition) and falls back to the runtime's semaphore on contention, parking goroutines rather than burning CPU.

### Q: When would you use `sync.RWMutex` and what is its main pitfall?

`sync.RWMutex` allows many concurrent readers or one writer. Use it when reads vastly outnumber writes and the read critical section is long enough to amortize the lock's overhead. The main pitfall is that RWMutex is significantly more expensive than a plain Mutex on the uncontended path because it tracks separate reader counters. For short critical sections, a plain Mutex is often faster even under heavy read load. Another trap: Go's RWMutex prioritizes writers to avoid writer starvation, which means a stream of readers cannot starve a writer, but a writer waiting can block new readers — measure both directions before assuming RWMutex is a win.

### Q: When do you use `sync/atomic` versus a mutex?

`sync/atomic` provides hardware-level atomic operations on single 32-bit or 64-bit words (and pointers): load, store, add, swap, CAS. Use atomics for single-word counters, flags, or pointer publication where the operations are independent and the mutex's overhead is unnecessary. Use a mutex when you need to maintain an invariant across multiple fields, when the critical section is more than a single load or store, or when the data does not fit in a single machine word. Mixing atomic and non-atomic access to the same variable is a data race — `go vet` and the race detector will catch the easy cases. Go 1.19 added typed `atomic.Int64`, `atomic.Pointer[T]`, etc., which are easier to use correctly than the raw `atomic.LoadInt64` API.

### Q: How does `sync.WaitGroup` work?

`WaitGroup` is a counting semaphore inverted: callers `Add(n)` to increment the counter, `Done()` (which is `Add(-1)`) to decrement, and `Wait()` blocks until the counter reaches zero. It is the idiomatic Go primitive for fork-join parallelism. The crucial rules: call `Add` from the parent goroutine before starting the children (calling `Add` from inside the goroutine creates a race with `Wait`), do not reuse a WaitGroup until `Wait` has returned, and do not let the counter go negative. Internally, the counter and waiter count are packed into a single 64-bit atomic, with the runtime semaphore used for parking goroutines.

### Q: What problem does `sync.Once` solve?

`sync.Once` guarantees that a function is executed exactly once, even when called concurrently from multiple goroutines, and that all callers observe the completed effects of the function before `Do` returns. It is the idiomatic Go primitive for lazy initialization and replaces the various broken double-checked locking patterns. Implementation: a single `uint32` flag accessed with atomics, plus a mutex for the slow path. The first goroutine to enter takes the mutex, runs the function, then sets the flag with `atomic.StoreUint32`; later callers see the flag set on the fast path and skip the mutex entirely.

### Python

### Q: What does `threading.Lock` actually do given the GIL?

`threading.Lock` is a non-reentrant mutex implemented on top of the OS's pthread mutex. The GIL serializes Python bytecode execution but is released around blocking operations (I/O, `time.sleep`, calls into C extensions). Without `Lock`, a thread can be preempted between bytecodes — including between the load and store of `x += 1` — and the result is the classic lost-update race. The GIL therefore eliminates data races at the C level (Python objects' refcounts and internal state are protected by it) but does not eliminate race conditions at the Python level. You still need `threading.Lock` for any compound operation on shared state. CPython's free-threaded build (PEP 703, in development) removes the GIL and makes proper locking even more important.

### Q: Does the GIL eliminate data races?

Partially and accidentally. The GIL ensures that at most one Python thread executes bytecode at a time, so individual bytecode operations are atomic with respect to other Python threads. A single assignment `x = y` is therefore atomic and does not need a lock. But compound operations like `x += 1`, `list.append`, `dict.setdefault` may compile to multiple bytecodes between which a thread switch can happen. Furthermore, the GIL is released when a C extension calls `Py_BEGIN_ALLOW_THREADS`, and any C code that touches Python objects without holding the GIL can race. The GIL is an implementation detail, not part of the language specification, and relying on it for correctness produces code that breaks on PyPy, Jython, IronPython, and the free-threaded build of CPython.

### Q: What is `threading.RLock` and when do you use it?

`RLock` is a reentrant lock: the thread that owns it can acquire it again without blocking, and must release it the same number of times to fully unlock it. Use `RLock` when a method that holds the lock calls another method that also acquires the same lock — a common pattern in object-oriented code where public methods lock and then call other locked methods on the same object. `RLock` is more expensive than `Lock` (it must track owner and recursion depth), so prefer `Lock` when you can ensure no reentrant acquisition.

### Q: When would you use `queue.Queue` instead of a list with a lock?

`queue.Queue` is a thread-safe FIFO with optional bounded capacity. It internally uses a `Lock` and two `Condition` variables (not empty, not full), providing blocking `put` and `get` semantics. Use `queue.Queue` for producer-consumer patterns: you get backpressure (bounded capacity), blocking, and timeout handling for free. A plain list with a lock works for simple cases but you must build the condition signalling yourself, which is the kind of bespoke code that hides bugs. For non-blocking work distribution and async patterns, prefer `concurrent.futures` or `asyncio.Queue`.

### C++

### Q: Explain the `std::memory_order` values.

`memory_order_relaxed` provides only atomicity — no ordering with other memory operations. Use it for counters where you don't care when the increment is visible. `memory_order_acquire` (on loads) and `memory_order_release` (on stores) form a synchronizes-with pair: writes before a release are visible to threads that observe the corresponding acquire. Use them for handoff patterns. `memory_order_acq_rel` is both on a read-modify-write. `memory_order_seq_cst` (the default) provides everything acquire-release does plus a single global order on all `seq_cst` operations across all threads — the most expensive but the easiest to reason about. `memory_order_consume` was an attempt at dependency-based ordering for pointer chasing on weak architectures; it is essentially unimplemented and you should treat it as deprecated.

### Q: `std::mutex` versus `std::shared_mutex`?

`std::mutex` is a plain mutual exclusion lock. `std::shared_mutex` (C++17) is a reader-writer lock with `lock` and `unlock` for writers and `lock_shared` and `unlock_shared` for readers. Use `shared_mutex` for read-mostly workloads with long-enough read critical sections to justify the additional overhead — the implementation must track reader counts, which costs more than a plain mutex's atomic word. The standard makes no guarantee about reader-writer fairness, so check your implementation. RAII wrappers `std::lock_guard`, `std::unique_lock`, and `std::shared_lock` are how you should always acquire these locks to make exception safety automatic.

### Q: Why must a `std::condition_variable` `wait` always be in a loop?

`condition_variable::wait` is allowed to return spuriously — without the predicate being true and without `notify` being called. This is a concession to OS implementations: pthread `cond_wait` can return spuriously on some platforms, and requiring a loop simplifies the implementation. Even without spurious wakeups, a thread that wakes up may find that another waiter beat it to the resource. The idiomatic pattern is `cv.wait(lock, [&]{ return predicate; });` which loops internally. Writing `if (!predicate) cv.wait(lock);` is a bug — the woken thread might find the predicate still false.

### Q: What is the difference between `std::lock_guard` and `std::unique_lock`?

`lock_guard` is a minimal RAII wrapper: it acquires the lock in its constructor and releases it in its destructor, with no other operations. It is the cheapest option when you do not need to manipulate the lock during its scope. `unique_lock` is a more flexible wrapper that supports deferred acquisition, transfer of ownership (it is movable), explicit unlock and relock, and use with `condition_variable::wait` (which requires `unique_lock`). Use `lock_guard` for simple critical sections and `unique_lock` when you need its features.

### Rust

### Q: What does `Mutex<T>` give you in Rust that `std::mutex` in C++ does not?

Rust's `Mutex<T>` wraps the data, not just the lock — you cannot access the data without holding the lock, by construction. `mutex.lock()` returns a `MutexGuard<T>` that implements `Deref` to give access to the inner `T`, and the guard's `Drop` releases the lock. The compiler statically prevents you from using the data without locking, and statically prevents you from holding the guard across a `.await` in a synchronous context. In C++, by contrast, the mutex and the data are separate, and there is nothing to stop you from forgetting to lock. Rust's `Mutex` is also poisoned if a thread panics while holding it, surfacing the failure to other threads.

### Q: Why do you need `Arc<Mutex<T>>` to share mutable state between threads?

`T` needs `Send + Sync` to be shared between threads. `Arc<T>` (atomically reference-counted) provides shared ownership with a thread-safe refcount, and is `Send + Sync` when `T: Send + Sync`. `Mutex<T>` provides interior mutability with synchronization — you can mutate through a shared reference because the lock guarantees exclusive access. Combining them, `Arc<Mutex<T>>` is the idiomatic pattern for "multiple threads can mutate the same `T`". For read-mostly access, `Arc<RwLock<T>>` is the equivalent. For atomic primitives, `Arc<AtomicUsize>` avoids the mutex entirely.

### Q: When would you use `AtomicUsize` directly?

Use `AtomicUsize` (and friends: `AtomicU64`, `AtomicBool`, `AtomicPtr`) when the shared state is a single word and the operations fit the atomic API: load, store, swap, fetch_add, compare_exchange. They are significantly cheaper than `Mutex<usize>` for hot counters or flags. The methods take a `Ordering` parameter that maps directly to C++'s `std::memory_order` — use `Ordering::Relaxed` for counters where ordering doesn't matter, `Ordering::Acquire`/`Release` for handoff, and `Ordering::SeqCst` as a safe default when you're unsure.

### Q: Explain the `Send` and `Sync` traits.

`Send` means a type can be transferred to another thread. Most types are `Send`; the exceptions are types with thread-local state like `Rc<T>` (non-atomic refcount, would race), `RefCell<T>` (non-atomic borrow checking), and raw pointers (the compiler cannot reason about them). `Sync` means a type can be referenced from multiple threads simultaneously: `T: Sync` iff `&T: Send`. `Mutex<T>` is `Sync` because the lock makes concurrent access safe; `Cell<T>` is not `Sync` because its interior mutability is not synchronized. These traits are `auto` traits: the compiler infers them for composite types, and they propagate through generics. They are the heart of Rust's "fearless concurrency" — data races are caught at compile time.

### Q: How does Rust prevent data races at compile time?

The borrow checker enforces that at any time, you have either one mutable reference or any number of shared (immutable) references to a value, but not both. `Send` and `Sync` extend this to threads: a value moved to another thread must be `Send`; a value shared across threads must be `Sync`. To mutate shared state, you need interior mutability through a `Sync` wrapper like `Mutex` or atomic types. The combination means that a data race — concurrent access where at least one is a write — is impossible without `unsafe` code or a deliberately incorrect `Send`/`Sync` implementation. Race conditions (semantic bugs) are still possible; the type system does not prove deadlock-freedom or correctness of invariants.

---

## Tricky / Trap Questions

### Q: Is `if (instance == null) instance = new Singleton()` safe inside a `synchronized` block?

Yes, that part is safe — the read and write are both protected by the lock. The trap is the question stem: candidates often answer "no, you need double-checked locking" and miss that the question is just asking about the locked check itself. The unsafe pattern is reading `instance` outside the lock and only entering the lock if it appears null; that requires `volatile` on the field. With the entire check-and-set inside `synchronized`, no further ordering is needed.

### Q: `volatile int x; x++;` — what does this guarantee?

The read of `x` is atomic and visible, and the write of `x` is atomic and visible — but the increment as a whole is not atomic. Two threads can both read the same value, both increment it, and both write the same incremented value, losing one update. `volatile` provides ordering and visibility, not read-modify-write atomicity. Candidates who say "volatile makes it thread-safe" are wrong; you need `AtomicInteger.incrementAndGet` or an explicit lock.

### Q: Your atomic counter reads stale values — why?

Atomic loads return the current value at the moment of the load, but "current" is per-cache-line, and the value can be updated by another thread the moment after. If your code reads the counter, makes a decision, and acts, the value can change between the read and the act — this is a race condition, not a data race, and atomics don't fix it. Either use compare-exchange to detect the change, hold a lock across the read and action, or accept that the read is a snapshot. Another possibility: the read uses `memory_order_relaxed` and is not synchronized with the writer's release; tighten the ordering or check that the writer also uses appropriately strong ordering.

### Q: Two `ReentrantLock`s acquired in different orders deadlock — how do you find the bug?

Symptoms: threads stuck, no CPU activity, application hangs. Diagnosis: take a thread dump (`jstack`, `kill -3`, or `ThreadMXBean.findDeadlockedThreads`). The JVM detects circular wait among `ReentrantLock`s and reports it. If thread dumps don't surface the deadlock — perhaps because it's intermittent — instrument with timed `tryLock` and log when acquisition takes more than expected. The fix is to impose a global lock ordering (lowest-ID first), use `tryLock` with backoff to detect and break cycles, or restructure to use a single coarser lock.

### Q: False sharing makes my counter 10x slower — what is the fix?

Pad each counter to its own cache line (typically 64 bytes) so that two counters from different threads do not coexist on the same line. In C++: `alignas(64) std::atomic<uint64_t> counter;`. In Java: declare with `@Contended` (since Java 8, with `-XX:-RestrictContended`). In Go: insert `_ [56]byte` between counters. Verify with a benchmark — the speedup should be near-linear in thread count if the only contention was false sharing. The wider fix for high-throughput counters is per-thread (or per-CPU) counters aggregated periodically; this also eliminates contention on the cache line itself, not just false sharing.

### Q: Your code works on x86 and fails on ARM — what class of bug is this?

Memory ordering bug. x86's TSO model forbids most reorderings, so code that relies on naive load-store ordering happens to work. ARM's weak memory model allows reorderings that x86 does not. The fix is to use proper memory ordering primitives — `std::atomic` with `acquire`/`release`, Java `volatile`, Go `sync/atomic` — rather than plain reads and writes that happened to work because of x86's strictness. The same bug class explains why some code that worked for decades on Intel servers fails on Apple Silicon or AWS Graviton.

### Q: My program uses only atomics and no locks — is it lock-free?

Not necessarily. Lock-free is a progress property: at least one thread makes progress in any bounded number of steps. A program that uses atomics in CAS loops can still livelock (no thread makes progress) or starve a particular thread (some threads make progress, but a specific thread never does, which is technically lock-free but not wait-free). The absence of `Mutex` does not imply lock-free; the algorithm itself must have the progress guarantee. Many "lock-free" implementations are actually just obstruction-free or non-blocking.

### Q: Is reading a `long` in Java atomic?

Not necessarily on a 32-bit JVM. The Java spec allows 64-bit `long` and `double` writes to be torn into two 32-bit writes, so a reader can observe a value composed of the high half of one write and the low half of another. Declaring the field `volatile` makes 64-bit reads and writes atomic. On 64-bit JVMs this is typically not observable because the underlying instructions are atomic, but the spec permits the tear, so portable code must use `volatile` or `AtomicLong`.

### Q: What does `Thread.sleep(0)` do?

It is a hint to the scheduler to yield the CPU. The thread does not actually sleep; it goes back into the runnable queue and may be immediately rescheduled if no other runnable thread has higher priority. Sometimes used in spin loops as a "polite spin" to allow other threads to run, though `Thread.onSpinWait` (Java 9+, emits a `pause` instruction on x86) is the better primitive for spin loops. Relying on `sleep(0)` for correctness is always a bug — it does not synchronize anything.

### Q: Should `getInstance()` itself be `synchronized`?

That is the "fully synchronized" singleton pattern: simple, correct, and historically considered slow because every call takes the lock. Modern JVMs with biased and lightweight locking make this nearly free in the uncontended case, so the performance argument is much weaker than it used to be. The static-holder idiom (`static class Holder { static final Singleton INSTANCE = new Singleton(); }`) is arguably the cleanest solution: it uses class initialization (which the JVM guarantees runs exactly once) and requires no `volatile` or synchronization.

### Q: Can I just use `AtomicReference` for a list?

You can swap the entire list atomically (read the reference, build a new list, CAS the reference), but you cannot atomically append to the existing list — every modification creates a new immutable list. This is the copy-on-write pattern: cheap for reads, expensive for writes, suitable when reads vastly outnumber writes. For frequent writes, use `ConcurrentLinkedQueue` or another concurrent collection. Be careful with the ABA problem if you reuse list instances.

### Q: Why does my benchmark show that adding more threads makes the program slower?

Common culprits, in rough order: lock contention (threads serialize on a hot lock), cache-line ping-pong (atomic operations on a hot cache line bounce between cores), false sharing (unrelated variables on the same line), memory bandwidth saturation (more threads competing for the same memory subsystem), or NUMA effects (threads on different sockets accessing each other's memory). The diagnostic is profiling — `perf stat` for cache misses and instructions per cycle, `perf c2c` for cache-line contention, lock-profiling tools for contention. Adding threads only helps when the work is parallelizable and the bottleneck is CPU, not memory or synchronization.

### Q: Does `synchronized` on a `String` work?

It compiles and runs, but it is a notorious footgun. String literals are interned by the JVM, so `"foo"` in one class is the same object as `"foo"` in another class — synchronizing on the literal accidentally synchronizes with code in unrelated classes. The same applies to `Boolean.TRUE`, `Integer.valueOf(small)`, and `Class` objects (less obviously). Always synchronize on a `private final Object lock = new Object()` field that you own.

### Q: Is `ConcurrentHashMap.get(k)` always safe to call concurrently with `put(k, v)`?

Yes — `ConcurrentHashMap` is designed for that. But "safe" means no data race; it does not mean the `get` and `put` happen in any particular order, and it does not mean a compound operation like `if (!map.containsKey(k)) map.put(k, v)` is atomic. For check-then-act, use `putIfAbsent`, `computeIfAbsent`, or the other atomic methods. Plain `HashMap` accessed concurrently is much worse — it can corrupt internal state and cause infinite loops on get (historical resize bug, fixed but still a warning).

### Q: Can two threads read different values from the same memory address simultaneously?

Yes, on weakly ordered architectures and with relaxed atomics. One thread might read a value that another thread wrote a moment ago; a third thread might still see the older value because the cache coherence message has not yet arrived. With sequentially consistent atomics or proper locking, all threads agree on a single order of writes, so any read of a given address returns a well-defined value from that order. With relaxed atomics, this is not guaranteed — different threads can see writes in different orders to different locations (but not to the same location: per-location, writes are always observed in modification order).

### Q: Why does `notify_one` sometimes wake the wrong thread?

`notify_one` wakes some thread waiting on the condition variable, not the thread that should logically proceed. If multiple waiters are blocked on the same condition variable but waiting for different sub-conditions (for example, a queue with producers waiting for space and consumers waiting for items, sharing one CV), notifying "one" may wake a producer when an item is available — that producer rechecks its predicate, finds the queue still full, and goes back to sleep, while the consumer that should have woken stays blocked. The lost-wakeup pattern is one of the most insidious concurrency bugs. Fixes: use separate condition variables per condition, use `notify_all` and accept the spurious-wake overhead, or carefully structure code so only one role waits on each CV.

### Q: What does `Thread.yield()` actually do?

`Thread.yield` (Java) and `std::this_thread::yield` (C++) are hints to the scheduler that the current thread is willing to release the CPU. The scheduler may move the thread to the back of the runnable queue, or may ignore the hint entirely — the spec gives no guarantee. Using `yield` for correctness is always a bug (the scheduler is not required to actually yield, so any required state transition can be delayed indefinitely). Using `yield` for performance, such as in a spin loop, has been mostly superseded by CPU spin hints (`pause` on x86, `yield` on ARM) which are issued by primitives like `Thread.onSpinWait` and tell the CPU rather than the OS scheduler.

---

## System / Design Scenarios

### Q: Design a thread-safe LRU cache.

A textbook LRU cache combines a hashmap (for O(1) lookup) with a doubly-linked list (for O(1) LRU promotion and eviction). For concurrency, the naive approach is a single mutex around both data structures — correct but a bottleneck for read-heavy workloads. Improvements: shard the cache into N independent partitions keyed by hash, each with its own lock, so concurrent access to different keys does not contend. For read-mostly workloads, use an RW lock (writes still need exclusive access to update the LRU list, but reads can be concurrent if you defer LRU updates — Caffeine's "read buffer" technique). For very high throughput, consider lock-free or wait-free designs like Caffeine in Java or moka in Rust, which separate the read path (lock-free hashmap lookup) from the eviction policy (run by a single background thread consuming an MPSC queue of access events).

### Q: Design a lock-free counter for 1M QPS.

A single `AtomicInteger.incrementAndGet` becomes a bottleneck above some millions of ops/sec because every increment requires exclusive ownership of the cache line — every other core's copy is invalidated, and the cache-coherence traffic dominates. Solutions, in order of complexity: (1) `LongAdder` in Java or `Striped64`, which keeps an array of cells, hashes the current thread to a cell, and increments the cell; `sum()` walks the array. (2) Per-thread counters with periodic flush to a global counter. (3) Per-CPU counters using `sched_getcpu()` or thread-local storage with a generation counter. Trade-off: read of "the total" becomes O(N_threads) rather than O(1), so this works when writes dominate reads.

### Q: Design a per-CPU counter aggregator.

For metrics that are incremented millions of times per second per CPU, eliminate cross-CPU traffic entirely. Allocate one counter per CPU (or per NUMA node), pad each to a cache line. Each writer increments its local counter using a plain non-atomic operation if only its own CPU writes to it (no concurrent writers per cell), or with relaxed atomics if multiple threads can land on the same cell. A reader thread periodically sums all per-CPU counters into a global value; readers of the metric query the global rather than summing on every read. Trade-off: the reported value lags real-time by the aggregation interval; the implementation must handle a writer migrating between CPUs (use thread-local with periodic re-binding, or accept occasional double-counting and double-incrementing on adjacent cells). Linux's percpu counters and DPDK's per-LCORE counters use this design.

### Q: Design a thread-safe object pool.

Goal: amortize allocation cost by reusing objects, with low contention on acquire and release. Naive: a single mutex around a free list — works but contends on every acquire and release. Better: thread-local pools that overflow to a global pool. Each thread acquires from its local pool first (no synchronization needed because only that thread accesses it); if local is empty, take a batch from the global pool. On release, return to the local pool; if local exceeds a threshold, push a batch to the global pool. The global pool can be a lock-free stack (Treiber stack) or a mutex-protected list. This is essentially the tcmalloc and jemalloc allocator strategy at small scale. Be careful about object lifetime — if pooled objects hold resources (file descriptors, large buffers), the pool must bound its size to avoid memory bloat.

### Q: Design a hand-over-hand locked linked list.

Hand-over-hand locking (also called lock coupling or chain locking) allows multiple threads to traverse a linked list concurrently by holding at most two locks at a time. To traverse from node A to node B, the thread acquires B's lock before releasing A's. To delete or insert, the thread holds both the predecessor's and the successor's locks during the pointer update. The benefit is that two threads operating on widely separated parts of the list do not contend. The cost is the per-node lock overhead and the more complex acquisition protocol. In practice, lock-free linked lists (Harris's algorithm, or skip lists with CAS) are usually preferred when contention is high; hand-over-hand shines for medium contention with simple operations. Always acquire locks in a consistent direction (head-to-tail) to avoid deadlock.

### Q: Design a publish-subscribe primitive backed by shared memory.

A shared-memory pub-sub typically uses a ring buffer: producers write to the next slot and advance the write head; consumers read from their independent read head, advancing it after consuming. For a single producer and multiple consumers (SPMC), the producer's write head can be a plain non-atomic write followed by a release-fence atomic store of the new head; consumers acquire-load the head, then read up to that position. For multiple producers (MPMC), use the Disruptor-style design with a sequence per slot and a CAS to claim slots, or use LMAX Disruptor itself. The buffer size must be a power of two so that modulo can be a bitwise AND. Carefully consider what happens when a slow consumer falls behind — drop, block, or overflow into a secondary buffer.

### Q: Design a thread-safe set with low write contention.

For a set where writes dominate, a single mutex-protected `HashSet` is the bottleneck. Sharding by hash into N independent sets reduces contention by a factor of N — `ConcurrentHashMap`'s backing structure in Java works this way (historically with explicit segments, now with a striped lock approach). For very low-contention writes and read-mostly access, copy-on-write (atomic reference to an immutable set) gives lock-free reads at the cost of O(N) writes. For high-write workloads with a small number of unique keys, consider a Bloom filter or count-min sketch fronting the structure to absorb probes for non-members.

### Q: Design a thread-safe object cache with TTL eviction.

Combine a `ConcurrentHashMap`-style structure for storage with a background eviction thread. Each entry stores its value and an expiration timestamp. On `get`, check expiration and treat expired entries as miss (lazy expiration). On `put`, add or replace the entry. The background thread scans periodically and removes expired entries. For very large caches, scanning the whole map is expensive; use a separate expiration queue (a priority queue or time wheel) where the eviction thread reads the next-to-expire entry, sleeps until its expiration, and removes it. Be careful about the race between expiration check and access: the background thread might evict an entry just as a reader is accessing it; either accept the inconsistency or use a reference count.

---

## Coding Questions

### Q: Implement a spinlock with exponential backoff.

```cpp
class Spinlock {
    std::atomic<bool> locked{false};
public:
    void lock() {
        int backoff = 1;
        while (true) {
            // Test-and-test-and-set: cheap relaxed load before CAS.
            while (locked.load(std::memory_order_relaxed)) {
                for (int i = 0; i < backoff; i++) {
                    _mm_pause();  // x86 pause hint
                }
                backoff = std::min(backoff * 2, 1024);
            }
            bool expected = false;
            if (locked.compare_exchange_weak(expected, true,
                    std::memory_order_acquire,
                    std::memory_order_relaxed)) {
                return;
            }
        }
    }
    void unlock() {
        locked.store(false, std::memory_order_release);
    }
};
```

The TTAS (test-and-test-and-set) pattern avoids issuing CAS while the lock is held, which would generate constant cache-coherence traffic. The `pause` instruction tells the CPU we are in a spin loop, improving SMT (hyper-threading) behavior and reducing power. Exponential backoff prevents repeated cache-line bouncing.

### Q: Implement Peterson's algorithm for two threads.

```c
volatile int flag[2] = {0, 0};
volatile int turn = 0;

void lock(int self) {
    int other = 1 - self;
    flag[self] = 1;
    turn = other;
    // Acquire fence to prevent reordering of critical section reads above.
    atomic_thread_fence(memory_order_acquire);
    while (flag[other] && turn == other) {
        // spin
    }
}

void unlock(int self) {
    atomic_thread_fence(memory_order_release);
    flag[self] = 0;
}
```

Peterson's algorithm is a classic mutual exclusion algorithm using only loads and stores. It is correct under sequential consistency. On real hardware, it needs explicit memory fences because the load of `flag[other]` can be reordered before the store of `flag[self]`, breaking mutual exclusion. The `volatile` declarations are for the compiler; the fences are for the CPU.

### Q: Implement a reentrant mutex.

```go
type ReentrantMutex struct {
    mu       sync.Mutex
    owner    int64 // goroutine id, simplified
    depth    int
}

func (r *ReentrantMutex) Lock(gid int64) {
    if atomic.LoadInt64(&r.owner) == gid {
        r.depth++
        return
    }
    r.mu.Lock()
    atomic.StoreInt64(&r.owner, gid)
    r.depth = 1
}

func (r *ReentrantMutex) Unlock(gid int64) {
    if atomic.LoadInt64(&r.owner) != gid {
        panic("not the owner")
    }
    r.depth--
    if r.depth == 0 {
        atomic.StoreInt64(&r.owner, 0)
        r.mu.Unlock()
    }
}
```

In Go, goroutine IDs are intentionally not exposed; in a real implementation you would pass a token or use thread-local storage. The recursion counter and owner check make this reentrant. Note that Go's `sync.Mutex` is intentionally non-reentrant; this is a teaching example.

### Q: Implement a bounded blocking queue with a mutex and two condition variables.

```cpp
template <typename T>
class BoundedQueue {
    std::mutex m;
    std::condition_variable not_full;
    std::condition_variable not_empty;
    std::queue<T> q;
    size_t capacity;
public:
    explicit BoundedQueue(size_t cap) : capacity(cap) {}

    void put(T value) {
        std::unique_lock<std::mutex> lock(m);
        not_full.wait(lock, [&]{ return q.size() < capacity; });
        q.push(std::move(value));
        not_empty.notify_one();
    }

    T take() {
        std::unique_lock<std::mutex> lock(m);
        not_empty.wait(lock, [&]{ return !q.empty(); });
        T value = std::move(q.front());
        q.pop();
        not_full.notify_one();
        return value;
    }
};
```

Two condition variables avoid spurious wake-ups across roles: producers wait on `not_full`, consumers on `not_empty`. The predicate-loop form of `wait` handles spurious wakeups correctly. `notify_one` is sufficient because only one waiter can make progress per operation.

### Q: Implement a Treiber stack.

```cpp
template <typename T>
class TreiberStack {
    struct Node { T value; Node* next; };
    std::atomic<Node*> head{nullptr};
public:
    void push(T value) {
        Node* node = new Node{std::move(value), nullptr};
        node->next = head.load(std::memory_order_relaxed);
        while (!head.compare_exchange_weak(node->next, node,
                std::memory_order_release,
                std::memory_order_relaxed)) {
            // node->next is updated by compare_exchange_weak on failure
        }
    }

    bool pop(T& out) {
        Node* old_head = head.load(std::memory_order_acquire);
        while (old_head &&
               !head.compare_exchange_weak(old_head, old_head->next,
                   std::memory_order_acquire,
                   std::memory_order_relaxed)) {
        }
        if (!old_head) return false;
        out = std::move(old_head->value);
        // delete old_head;  // ABA problem - need hazard pointers or epochs
        return true;
    }
};
```

The Treiber stack is the canonical lock-free stack: CAS the head pointer to insert or remove. The commented-out `delete` highlights the ABA problem — if another thread recycles the node back to the top of the stack, our CAS would succeed against the same address but the stack state changed. Real implementations use hazard pointers, epoch-based reclamation, or tagged pointers.

### Q: Implement a read-mostly counter using CAS.

```java
class ReadMostlyCounter {
    private final AtomicLong value = new AtomicLong(0);

    public long get() { return value.get(); }

    public void add(long delta) {
        long current;
        long updated;
        do {
            current = value.get();
            updated = current + delta;
        } while (!value.compareAndSet(current, updated));
    }
}
```

For a single counter, `getAndAdd` is preferred (it is a single `lock xadd` on x86). The CAS-loop pattern shown here generalizes to any read-modify-write where you cannot use a single atomic primitive. For very high contention, `LongAdder` is dramatically faster because it spreads the contention across multiple cells.

### Q: Implement a one-shot latch.

```rust
use std::sync::{Mutex, Condvar};

pub struct Latch {
    state: Mutex<bool>,
    cv: Condvar,
}

impl Latch {
    pub fn new() -> Self {
        Self { state: Mutex::new(false), cv: Condvar::new() }
    }

    pub fn wait(&self) {
        let mut done = self.state.lock().unwrap();
        while !*done {
            done = self.cv.wait(done).unwrap();
        }
    }

    pub fn release(&self) {
        let mut done = self.state.lock().unwrap();
        *done = true;
        self.cv.notify_all();
    }
}
```

A one-shot latch is signaled exactly once; all waiters proceed after `release`. The pattern generalizes to a `CountDownLatch` by replacing the boolean with a counter. In Rust, `std::sync::Barrier` covers some related use cases; for one-shot signalling, `tokio::sync::Notify` or a custom latch like above is idiomatic.

---

## Behavioral / Experience

### Q: What is the hardest concurrency bug you debugged, and how did you find it?

A strong answer describes the symptom (intermittent corruption, hang, panic), the diagnostic process (logs, thread dumps, ThreadSanitizer, perf), the root cause (a specific memory ordering, lock ordering, or visibility bug), and the fix. Bonus points for explaining why the bug was hard — non-deterministic, only reproduced under load, looked like a different bug at first. The interviewer is listening for whether you treat concurrency bugs as "spooky action at a distance" or as mechanical artifacts of the memory model that can be reasoned about. Mentioning tools (TSan, Helgrind, race detector, `jstack`, `pprof`) is positive.

### Q: Describe a misuse of `volatile` that you fixed.

Common cases: a developer used `volatile` in C/C++ for thread synchronization, expecting it to act like Java `volatile` — replaced with `std::atomic`. A developer used `volatile int x` for a counter and relied on `x++` being atomic — replaced with `AtomicInteger`. A developer used `volatile` on a reference to a mutable object, thinking it makes the object thread-safe — added proper locking or made the object immutable. The good answer explains the misconception and the principled fix, not just the mechanical replacement.

### Q: Tell me about a time a read-write lock hurt performance.

The classic case: a workload that looked read-mostly turned out to have writes frequent enough to repeatedly invalidate the reader-tracking cache lines, and a plain mutex would have been faster. Another case: a long-held read lock prevented a writer from making progress, causing latency spikes — fixed by reducing the read critical section or using a snapshot pattern. The candidate should explain how they diagnosed (measured with a profiler, observed write starvation, ran a comparative benchmark) and what they replaced it with.

### Q: When was shared memory the wrong choice?

Cases: a problem that could have been solved with message passing was forced into shared state, leading to lock ordering complexity that grew with every new feature. A problem that needed strong durability or distribution was kept in-process when an external queue or database would have been better. A problem where the working set exceeded a single machine's RAM and shared memory was an artificial constraint. Strong answer: acknowledges that shared memory is the highest-performance primitive but also the most error-prone, and chooses it deliberately, not by default.

### Q: How do you test concurrent code?

A reasoned approach uses several layers: deterministic unit tests for the single-threaded logic; stress tests that run many threads against the structure and check invariants under load; randomized scheduling tests with tools like JCStress (Java) or `loom` (Rust) that explore interleavings; sanitizers (ThreadSanitizer, Helgrind) to detect data races; and production canary releases. Acknowledging that concurrent code cannot be exhaustively tested and that careful reasoning plus tooling is the only path to confidence is mature.

### Q: Have you ever shipped code with a known concurrency bug?

Strong answer: yes, here is the bug, here is why we shipped (timing, risk assessment, mitigation), here is what we did to monitor for it in production, here is when we fixed it. Demonstrates engineering judgment about risk versus delivery. Weak answer: "no, all my code is correct" — implausible and shows the candidate has not worked at scale.

### Q: How do you onboard a junior engineer to concurrent code?

Cover the basics first: data race vs race condition, happens-before, locks as synchronization not just mutual exclusion. Then pair on bug investigations using thread dumps and race detectors to make the abstractions concrete. Have them read concurrent code reviews. Avoid the trap of teaching lock-free programming before they have internalized lock-based correctness. Emphasize that "I don't know" is the right answer when reasoning about a tricky interleaving.

### Q: Describe your debugging process for an intermittent hang.

(1) Reproduce — or accept that it might not reproduce and prepare to debug from production traces. (2) Capture state when it hangs: thread dump, heap dump, CPU profile, lock owner reports. (3) Identify the waiting threads and what they wait on. (4) Trace back to who should be signalling or releasing — is the signal missed (woken before wait started), the lock leaked (held by a thread that returned without releasing), or a deadlock cycle? (5) Form a hypothesis, add logging or assertions, and try to force-reproduce. The discipline of "I will not propose a fix until I understand the bug" separates seniors from juniors.

### Q: How do you approach concurrency code review?

Look for shared mutable state and check that every access is either inside a lock, on an atomic, or genuinely immutable. Verify lock ordering is consistent across the codebase to prevent deadlock. Check that compound operations (read-modify-write, check-then-act) are atomic, not just the individual reads and writes. Confirm condition variable waits use predicate loops. Examine error paths — locks acquired in the happy path are often leaked on exceptions. Flag any use of `volatile` in C/C++ for synchronization (it does not work). Question every clever lock-free implementation: is the ABA problem handled, are memory orders correct, has it been stress-tested with sanitizers?

---

## What I'd Ask a Candidate Now

These are the meta-questions that probe judgment rather than facts.

### Q: When would you choose actors or CSP over shared memory?

Looking for: an articulation that shared memory is best for low-latency tightly coupled state, while actors and CSP are best for loosely coupled state with clear ownership boundaries. A candidate who says "always use actors" or "always use shared memory" is showing dogma rather than judgment.

### Q: How do you choose between a mutex and a lock-free structure?

Looking for: a measurement-first attitude. Default to a mutex (or an off-the-shelf concurrent structure), measure, and only reach for lock-free designs when profiling shows lock contention is the bottleneck. Acknowledgement that lock-free code is harder to write correctly and harder to maintain.

### Q: What is the most common concurrency mistake you see in code reviews?

Looking for: a specific, concrete answer drawn from experience. Common ones: forgetting that compound operations are not atomic; relying on `volatile` for ordering it does not provide; holding locks across blocking calls; check-then-act patterns without atomicity; using mutable shared state where immutable or copy-on-write would suffice.

### Q: How would you design a code review checklist for concurrent code?

Looking for: ownership of shared state is documented; invariants are stated and enforced; lock acquisition order is consistent and minimal; locks are not held across I/O or blocking calls; condition variable waits are in loops; atomics use the right memory order; data structures are accessed through thread-safe APIs only.

### Q: What would you do differently if you were designing your last concurrent system from scratch?

Looking for: reflection. A candidate who would change nothing has either built nothing or learned nothing. Common honest answers: would use immutable data structures earlier; would push more shared state into a database; would reach for message passing for cross-component communication and shared memory only inside components.

### Q: When is it appropriate to write your own synchronization primitive?

Looking for: almost never. Use what the standard library and platform provide. Reasons to write your own include a measured bottleneck that off-the-shelf primitives cannot fix, a hardware-specific optimization, or a fundamentally new primitive (rare). A candidate who reflexively writes custom locks is a yellow flag.

### Q: How do you think about backwards compatibility when concurrency semantics change?

Looking for: awareness that memory model changes (Java 1.5, C++ 11) and language evolution can break code that relied on incidental behavior. The fix is to write to the spec, not to the implementation, and to use tools (race detectors, model checkers) to verify rather than trust observed behavior.

---

## Cheat Sheet

```
+--------------------------------------------------------------+
| Shared-Memory Concurrency Must-Know                          |
+--------------------------------------------------------------+
| 1. Data race != race condition                               |
|    Data race = no happens-before, undefined behavior         |
|    Race condition = timing-dependent correctness             |
|                                                              |
| 2. Happens-before establishes visibility                     |
|    Lock acquire/release, volatile, atomics, thread join      |
|                                                              |
| 3. volatile (C) != volatile (Java)                           |
|    C: hardware/signal hints, NO thread synchronization       |
|    Java: acquire/release semantics, IS synchronization       |
|                                                              |
| 4. i++ is NEVER atomic                                       |
|    Use AtomicInteger, std::atomic::fetch_add, etc.           |
|                                                              |
| 5. Memory orders: relaxed < acquire/release < seq_cst        |
|    Default to seq_cst; relax only with proof                 |
|                                                              |
| 6. False sharing kills counters                              |
|    Pad to cache line (64B), or use LongAdder/Striped64       |
|                                                              |
| 7. Cond vars require predicate loops                         |
|    while(!ready) cv.wait(lock); -- never if                  |
|                                                              |
| 8. Lock ordering prevents deadlock                           |
|    Always acquire locks in a globally consistent order       |
|                                                              |
| 9. ABA is silent corruption in lock-free CAS code            |
|    Use hazard pointers, epochs, or tagged pointers           |
|                                                              |
| 10. x86 is TSO; ARM/POWER are weak                           |
|    Code that "works" on x86 may break on ARM                 |
+--------------------------------------------------------------+
```

---

## Further Reading

- "Java Concurrency in Practice" — Brian Goetz et al. The canonical Java concurrency reference.
- "The Art of Multiprocessor Programming" — Maurice Herlihy and Nir Shavit. Lock-free and wait-free algorithms.
- "C++ Concurrency in Action" — Anthony Williams. The reference for `std::atomic` and the C++ memory model.
- "Is Parallel Programming Hard, And, If So, What Can You Do About It?" — Paul McKenney. Free online; deep dive into kernel-style concurrency.
- "A Primer on Memory Consistency and Cache Coherence" — Sorin, Hill, Wood. The hardware perspective.
- JSR-133: Java Memory Model and Thread Specification Revision.
- "Memory Models" by Russ Cox — a three-part series on the history and current state of memory models.
- "What Every Systems Programmer Should Know About Concurrency" — Matt Kline.
- The Linux kernel's `Documentation/memory-barriers.txt`.
- "The Little Book of Semaphores" — Allen Downey. Free; classic synchronization problems.
- "Shared Memory Consistency Models: A Tutorial" — Adve and Gharachorloo. The foundational survey.
- Doug Lea's lecture notes on concurrent programming (jsr166 archive).
- LMAX Disruptor whitepapers — ring buffer and mechanical sympathy.
- "Hazard Pointers: Safe Memory Reclamation for Lock-Free Objects" — Maged Michael.
- "Wait-Free Synchronization" — Maurice Herlihy. The seminal paper on the consensus hierarchy.

---

## Related Topics

- [Concurrency Models Overview](../README.md)
- [Message-Passing Concurrency](../02-message-passing/README.md)
- [Lock-Free Programming](../../02-synchronization/02-lock-free/README.md)
- [Memory Models](../../03-memory-models/README.md)
- [Atomic Operations](../../02-synchronization/01-atomics/README.md)
- [Mutex and Condition Variables](../../02-synchronization/03-mutexes/README.md)
- [Cache Coherence and False Sharing](../../../cpu-architecture/02-caches/README.md)
- [Java Memory Model](../../../languages/java/memory-model/README.md)
- [Go's Memory Model](../../../languages/golang/memory-model/README.md)
- [Rust's Send and Sync](../../../languages/rust/send-sync/README.md)
