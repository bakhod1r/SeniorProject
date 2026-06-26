# Stack vs Heap — Interview Questions
> **Topic:** [Stack vs Heap](README.md)

A focused bank of stack-vs-heap interview questions spanning fundamentals, language-specific tooling, classic traps, and design judgment. Each answer is the tight, correct response a strong candidate gives — enough to demonstrate depth without rambling. Use the traps section especially: they are where interviewers separate memorizers from people who understand the machine.

## Table of Contents
- [Conceptual](#conceptual)
- [Tool-Specific](#tool-specific)
- [Tricky / Trap](#tricky--trap)
- [Design](#design)

---

## Conceptual

## Question 1
**What is the actual difference between the stack and the heap? They're both RAM.**

Correct — both live in the same physical memory. The difference is *organization and reclamation*. The stack is managed in strict LIFO order tied to function calls: allocation is moving the stack pointer, deallocation is moving it back on return, and it's thread-private. The heap supports arbitrary allocation/free order and arbitrary lifetimes, which requires an allocator (or GC) to track free space, and it's shared across threads. The consequences cascade from there: the stack is fast, fragmentation-free, and size-limited; the heap is flexible, slower, and prone to fragmentation and leaks.

## Question 2
**What lives in a stack frame?**

A stack frame (activation record) holds one function call's state: its parameters (those not passed in registers), its local variables, the return address (where to resume in the caller), the saved frame pointer of the caller, and any callee-saved registers the function must preserve. The prologue sets it up (`sub rsp, N` reserves the locals in one instruction); the epilogue tears it down.

## Question 3
**Why is stack allocation so much cheaper than heap allocation?**

Stack allocation is a single arithmetic instruction — subtract N from the stack pointer — with no search, no per-object metadata, no free list, and no locking, and the memory is cache-hot. Heap allocation must round to a size class, find a free slot (free-list pop on the fast path), update bookkeeping, and possibly take a lock or syscall to the OS on the slow path. Roughly: ~1 cycle for the stack vs tens of cycles (fast path) to thousands (slow path) for the heap — plus later cache-miss and GC/free costs the stack never incurs.

## Question 4
**What decides whether a value goes on the stack or the heap?**

Lifetime. If a value's lifetime is provably bounded by the function call that creates it, it can live on the stack. If it must outlive that call — returned to a caller, stored in a longer-lived structure, shared across threads — it must go on the heap. In managed languages a compiler pass called *escape analysis* makes this determination automatically.

## Question 5
**Which way does the stack grow, and why does it matter?**

On essentially all mainstream architectures the stack grows *downward* (toward lower addresses) while the heap grows upward, so the two grow toward each other from opposite ends of the address space. It matters for understanding overflow (the stack pointer descending into a guard page) and for reasoning about buffer overflows, where writing past a stack buffer can overwrite the return address sitting at a higher address.

## Tool-Specific

## Question 6
**In Go, how do you find out whether a value escapes to the heap?**

`go build -gcflags='-m'` (add a second `-m` for more detail) prints the compiler's escape-analysis decisions in plain English: `moved to heap: x` or `x does not escape`. For allocation counts, `go test -bench=. -benchmem` reports allocs/op, and a pprof memory profile (`-alloc_space` vs `-inuse_space`) distinguishes churn from live set.

## Question 7
**What causes a value to escape in Go?**

Returning its address (`return &local`), storing it into something longer-lived (a global, a heap object, a channel), capturing it in a closure that escapes, or passing it somewhere the compiler can't see through — notably storing it in an `interface{}` or calling through an interface, which forces conservative heap allocation. Escape analysis is conservative: if it can't prove the value stays local, it heap-allocates.

## Question 8
**How does the JVM avoid heap-allocating objects that don't escape?**

HotSpot's JIT runs escape analysis and, for non-escaping objects, applies *scalar replacement*: it decomposes the object into its individual fields and keeps them in registers or stack slots, eliminating the allocation entirely. It can also do lock elision on objects proven thread-local. So `new Point(...)` in a hot loop may allocate nothing at all. You can confirm with `-XX:+PrintEliminateAllocations` under diagnostic VM options.

## Question 9
**You see 20% of CPU in `mallocgc` in a Go profile. What do you do?**

Find the hot allocation sites (pprof `-alloc_space`), then for each ask whether it can stay on the stack — check the escape report. Common fixes: avoid `interface{}` boxing in the loop, reuse a buffer (`buf[:0]` + `append`, or `sync.Pool`), return by value instead of by pointer where lifetime allows, and avoid `fmt.Sprintf` in hot paths. The goal is to cut the *allocation rate*, which also reduces GC frequency and cache misses.

## Tricky / Trap

## Question 10
**Is it safe to return a pointer to a local variable?**

It depends entirely on the language. In **C/C++** it is a serious bug: the local lives in a frame that's popped on return, so the pointer dangles into reclaimed memory — undefined behavior. In **Go**, it's perfectly safe: the compiler's escape analysis notices the pointer outlives the function and moves the value to the heap automatically. So the *same source pattern* is a footgun in one language and idiomatic in another. Knowing why is the point of the question.

## Question 11
**"Primitives go on the stack and objects go on the heap." True?**

It's a useful first approximation but wrong as a rule. The real determinant is lifetime/escape, not type. A Java object that doesn't escape may be scalar-replaced and never hit the heap; a Go struct (a value type) escapes to the heap if you return its address; a Python integer (a "primitive" conceptually) is a heap object. State the lifetime rule and note the exceptions, and you've shown you understand the mechanism rather than the slogan.

## Question 12
**Does `new` always allocate on the heap?**

No. With escape analysis, `new`/`make`/`&T{}` may allocate on the stack (Go) or be eliminated entirely via scalar replacement (Java). The source-level keyword expresses intent to create an object; the compiler decides the storage. Treating `new` as synonymous with "heap allocation" is exactly the misconception escape analysis exists to break.

## Question 13
**Can the heap fragment? Can the stack?**

The heap can suffer both internal fragmentation (a 20-byte request rounded up to a 32-byte size class wastes 12 bytes) and external fragmentation (free memory splintered so a large request fails despite enough total free space). The stack *cannot* fragment: its strict LIFO discipline means freeing is always "move the pointer back," so there are never holes. This fragmentation-freedom is a core reason the stack is fast and predictable.

## Question 14
**What exactly is a stack overflow, and how is it different from heap exhaustion?**

A stack overflow is the stack pointer descending past the stack's limit into the guard page — typically from infinite/deep recursion or an oversized local/`alloca`. The CPU faults on the guard page, producing a clean crash (`SIGSEGV`, `StackOverflowError`). Heap exhaustion is the allocator being unable to satisfy a request — `malloc` returns `NULL`, the JVM throws `OutOfMemoryError`. Different cause, different symptom, different fix: reduce recursion depth / move data off the stack vs reduce live memory / raise the heap limit.

## Question 15
**How can a goroutine start with a 2 KB stack when a thread needs megabytes?**

Goroutine stacks are *growable*. They start tiny (~2 KB) and the function prologue checks whether there's room; if not, the runtime allocates a larger contiguous stack, copies the old contents over, rewrites every pointer that pointed into the old stack, and resumes. This pointer-rewriting is only possible because Go's runtime has precise knowledge of where pointers live — something a C runtime lacks, which is why OS threads must reserve a large fixed stack up front. (Go originally used segmented stacks but switched to copying to avoid a "hot split" performance cliff.)

## Design

## Question 16
**You're designing a high-throughput Go service and care about p99 latency. How does stack-vs-heap influence your design?**

The lever is allocation rate, because GC frequency scales with it and GC drives tail latency. Concretely: prefer value types and return-by-value where lifetimes allow so escape analysis keeps data on the stack; avoid `interface{}`/boxing in hot paths; reuse buffers (`sync.Pool`, pre-sized slices) instead of allocating per request; choose contiguous structures (slices of structs over slices of pointers) for cache locality. Then *verify* with the escape report and `-benchmem`, and graph allocation rate and GC time as SLIs. The design goal isn't "never use the heap" — it's keeping per-request allocation low and predictable.

## Question 17
**When would you deliberately choose the heap even though the data could fit on the stack?**

When the data must outlive the function (returned or shared), when it's large enough to threaten the stack limit (multi-MB buffers belong on the heap regardless of lifetime), when many callers share one instance and copying by value would be wasteful, or when its size is only known at runtime and could grow. Also: passing a large struct by value copies it on every call, so a single heap allocation plus pointer passing can be cheaper than repeated large stack copies. The decision is lifetime *and* size *and* sharing, not lifetime alone.
