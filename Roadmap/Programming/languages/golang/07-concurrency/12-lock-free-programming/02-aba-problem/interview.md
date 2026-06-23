# The ABA Problem — Interview Questions

## Table of Contents
1. [How to Use This File](#how-to-use-this-file)
2. [Conceptual Questions (Junior)](#conceptual-questions-junior)
3. [Implementation Questions (Middle)](#implementation-questions-middle)
4. [Design Questions (Senior)](#design-questions-senior)
5. [Systems Questions (Professional)](#systems-questions-professional)
6. [Tricky Questions](#tricky-questions)
7. [Whiteboard Tasks](#whiteboard-tasks)
8. [Common Wrong Answers](#common-wrong-answers)
9. [What Interviewers Actually Listen For](#what-interviewers-actually-listen-for)

---

## How to Use This File

These questions are drawn from interview rotations at companies known for serious systems engineering (Google, Cloudflare, Stripe, Anthropic, ByteDance Bytedance Cloud, etc.) and from public collections like *Cracking the Coding Interview*, *System Design Interview*, and McKenney's perfbook study questions.

The answers are structured as you would speak them in a 45-minute interview: short upfront, then expanded, then a follow-up the interviewer would likely ask. Use them as a study aid, not a script.

For each level, the questions get progressively harder. Junior-level questions should take 1-2 minutes each; professional-level questions can fill a 45-minute discussion.

---

## Conceptual Questions (Junior)

### Q1. What does the name "ABA problem" stand for?

**Short.** A thread reads value `A`, gets preempted, and resumes; another thread changes the value to `B` and back to `A`. The first thread's CAS now sees `A` again and assumes nothing happened. The letters are the sequence of values seen by an observer: `A`, then `B`, then `A`.

**Expanded.** The bug is that CAS compares bits but not history. The second `A` is the same bit pattern as the first, but the surrounding state (other pointers, counters, metadata) may have changed. Any algorithm whose correctness depends on the surrounding state — most lock-free linked structures — can be fooled.

**Follow-up: "Why is this a CAS problem and not a Load problem?"** Because CAS is the synchronisation primitive that lock-free algorithms use to detect interference. A plain Load that reads `A` is fine — the value really is `A`. The issue is the *next step*, where the algorithm acts on the assumption that nothing changed because the value did not change.

### Q2. Give a concrete example where ABA causes a bug.

**Short.** A lock-free stack pop. The pop reads `head = A`, plans to set `head = A.next = B`. Meanwhile another thread pops `A`, pops `B`, pushes `C`, then pushes `A` back with `A.next = C`. The original thread resumes, CAS succeeds (head still `A`), sets `head = B`. `B` is now off the stack and `C` is lost.

**Expanded.** This is the canonical Treiber-stack ABA. The reason it is so famous is that it requires several specific events but they all happen routinely under load: pop, pop, push, push. The CAS protocol per-step is correct; the failure is a wider invariant (stack contents) that the per-step CAS cannot enforce.

**Follow-up: "Does this bug happen in Go?"** Not for fresh-allocation Go code. The garbage collector keeps `A` alive while any goroutine references it, so `A` cannot be popped, freed, and re-pushed with its original address. The bug returns the moment you use `sync.Pool` for nodes.

### Q3. Why does Go's garbage collector prevent most ABA cases?

**Short.** Because the GC will not reuse a memory address until no goroutine references it. While a thread holds `top := head.Load()`, the GC pins `top`'s allocation, so no other thread can produce a `*Node` with `top`'s address bits for a different object.

**Expanded.** This means bit equality of pointers implies state equality of objects, in a fresh-allocation algorithm. Without the GC, two different `Node`s could share an address at different times; with it, they cannot. The textbook ABA scenario simply cannot occur. Practitioners say "Go's GC is implicit hazard pointers."

**Follow-up: "When does this protection lift?"** When you opt out of the GC. `sync.Pool`, custom free lists, `unsafe.Pointer` tricks, integer indices, generation counters — anything that recycles a value gives back the C-flavour ABA.

### Q4. What is a "tagged pointer" and how does it prevent ABA?

**Short.** A pointer paired with a generation counter, treated as a single CAS-able unit. Every modification increments the counter, so the same `(pointer, gen)` pair cannot recur. CAS compares the whole pair; even if the pointer matches by coincidence, the counter difference defeats the CAS.

**Expanded.** Two implementations: packed 128-bit (DWCAS) or wrapper struct CAS-swapped via `atomic.Pointer`. In Go, the wrapper is idiomatic. The wrapper pattern allocates one struct per modification, which is acceptable for most workloads.

**Follow-up: "What width should the counter be?"** `uint64` by default. `uint32` wraps in seconds under load and reintroduces ABA.

---

## Implementation Questions (Middle)

### Q5. Implement a lock-free stack with a generation counter in Go.

**Short.** Wrap `(head, gen)` in an immutable struct, swap via `atomic.Pointer`.

```go
type Node struct {
    value any
    next  *Node
}

type versioned struct {
    head *Node
    gen  uint64
}

type Stack struct {
    state atomic.Pointer[versioned]
}

func (s *Stack) Push(v any) {
    n := &Node{value: v}
    for {
        old := s.state.Load()
        n.next = old.head
        next := &versioned{head: n, gen: old.gen + 1}
        if s.state.CompareAndSwap(old, next) {
            return
        }
    }
}

func (s *Stack) Pop() (any, bool) {
    for {
        old := s.state.Load()
        if old.head == nil {
            return nil, false
        }
        next := &versioned{head: old.head.next, gen: old.gen + 1}
        if s.state.CompareAndSwap(old, next) {
            return old.head.value, true
        }
    }
}
```

**Expanded.** The wrapper is immutable after publication. Each modification allocates a new wrapper. The CAS compares wrapper pointers, which are unique even if `head` recycles (Go GC guarantees address uniqueness while reachable). The counter is defensive.

**Follow-up: "What is the allocation cost?"** One `versioned` (16 bytes) per modification, plus one `Node` per push. Under typical workloads this is fine. Under extreme throughput, allocation-free variants with DWCAS via assembly are an option.

### Q6. Why can't you just use two separate `atomic` fields, one for `head` and one for `gen`?

**Short.** Because two separate atomic operations are not jointly atomic. A reader can see an inconsistent `(head, gen)` snapshot.

**Expanded.** Concretely: T1 loads `head = A`, gets descheduled. T2 modifies, bumping both fields. T1 loads `gen` and sees the new value. T1 now has `(A, gen_new)` which is a value that never existed in the structure. Any CAS based on this is wrong.

**Follow-up: "Is there a way to do this without a wrapper allocation?"** Yes — DWCAS via assembly. Pack `(head, gen)` into 128 bits and CAS as one unit. Go does not expose DWCAS in `sync/atomic`, so this requires a `.s` file. Most teams choose the wrapper instead.

### Q7. Where does ABA still bite in idiomatic Go?

**Short.** `sync.Pool`, integer indices, generation counters that wrap, slot-based ring buffers, refcount fields, anywhere recycling occurs.

**Expanded.** The unifying principle: anywhere a value can return to a previous one. Pointers in fresh-allocation Go cannot return (GC prevents it). Pooled objects can. Integer counters can if they wrap. Slot identities by definition do (the slot at index 5 today is the same slot at index 5 tomorrow).

For each case, the mitigation differs:
- `sync.Pool`: hazard pointers around the pool, or stop pooling.
- Integer wraparound: widen to 64 bits.
- Slot reuse in ring buffers: per-slot sequence numbers (Vyukov MPMC pattern).

**Follow-up: "Give an example of a Go-specific gotcha."** A `uint32` request ID that wraps under load. Two unrelated requests get the same ID; an observer treats them as the same request.

### Q8. What is `atomic.Pointer[T]` and how does it interact with the GC?

**Short.** Type-parameterised atomic pointer introduced in Go 1.19. Stored pointers are GC roots; reads participate in the write barrier; the API is type-safe.

**Expanded.** Before 1.19, `atomic.LoadPointer` operated on `unsafe.Pointer` and required casting. The new API gives compile-time type safety and the same runtime behaviour. The interaction with GC is unchanged: a `*T` stored via `atomic.Pointer[T].Store` keeps the object reachable.

**Follow-up: "Does `atomic.Pointer[T]` provide tagged pointers?"** No. You need a wrapper struct to bundle a generation counter.

---

## Design Questions (Senior)

### Q9. Compare hazard pointers and epoch-based reclamation. When would you choose each?

**Short.** Hazard pointers: bounded memory, wait-free reads, one atomic store per dereference. EBR: unbounded retire list under stress, near-zero reader overhead, batched reclamation.

**Expanded.** The trade-off is reader overhead vs memory bound. Hazard pointers cost ~one extra atomic store per pointer dereference, but the memory is bounded by `O(P * H)` regardless of how slow a thread is. EBR is essentially free on the reader fast path (one relaxed write on enter/exit) but a stalled reader stalls reclamation, and the retired list grows.

Choose hazard pointers when memory bound matters (kernel, embedded, real-time). Choose EBR when read throughput matters (hash table reads, cached lookups). Hybrid schemes (hazard eras, interval-based) try for the best of both.

**Follow-up: "How do you implement either in Go without TLS?"** Each goroutine is assigned a slot index, typically at creation. A `sync.Pool` of slot indices works for short-lived goroutines. The Go runtime does not expose `getg()` for application use, so explicit slot management is necessary.

### Q10. Walk me through how a hazard-pointer-protected stack pop works.

**Short.** Load head, publish in hazard slot, re-read head, retry on mismatch, dereference safely, CAS the head, retire the popped node, clear hazard slot.

**Expanded.**

```go
func (s *Stack) Pop(slotIdx int) (any, bool) {
    for {
        top := s.head.Load()                          // 1
        if top == nil {
            return nil, false
        }
        s.hp.Protect(slotIdx, unsafe.Pointer(top))    // 2: publish
        if s.head.Load() != top {                      // 3: re-read
            continue                                    //    retry on mismatch
        }
        next := top.next                               // 4: safe to deref
        if s.head.CompareAndSwap(top, next) {          // 5: CAS
            v := top.value
            s.hp.Retire(unsafe.Pointer(top), ...)      // 6: retire
            s.hp.Clear(slotIdx)                        // 7: clear
            return v, true
        }
    }
}
```

The re-read at step 3 is load-bearing. Without it, a freeing thread could have already passed its scan before the hazard was published, and the dereference at step 4 could read freed memory.

**Follow-up: "What if the re-read succeeds but the CAS fails?"** Retry the entire loop. The hazard slot is reused or cleared, the next iteration starts over. The hazard is not stale; it is a fresh publication for a fresh load.

### Q11. Describe a scenario where ABA can occur in `sync.Map`.

**Short.** It cannot, because `sync.Map`'s internal protocol uses tombstones and never recycles slots within a logical version.

**Expanded.** `sync.Map` uses two maps internally: a read-mostly `read` map and a write-mostly `dirty` map. Entries that are deleted from the read map become "expunged" — a sentinel value, not slot recycling. Promotions from `dirty` to `read` rebuild the entire `read` map, not in-place updates. So an ABA-vulnerable interleaving has no purchase: there is no slot identity that recycles, no pointer that could match across logical versions.

`sync.Map` does have other concurrency hazards (the `read.amended` bit transitions, miss accounting under thrash) but ABA specifically is avoided by design.

**Follow-up: "What if you implemented your own concurrent map with CAS-on-slot?"** Then you have the slot-recycling problem and need either per-slot generation counters or hazard pointers protecting probes. The "concurrent map corruption" postmortem in professional.md is exactly this case.

### Q12. Is `atomic.AddInt64` immune to ABA? Why?

**Short.** Yes, because it applies a delta rather than comparing to an expected value.

**Expanded.** `AddInt64(p, delta)` says "add `delta` to `*p`, return the new value." It does not say "if `*p == expected, set to expected+delta`." There is no expected value, so there is no notion of "the value returned to a previous one." The operation is intrinsically correct under interleaving.

This is why FAA (fetch-and-add) is the preferred primitive for counters, sequences, and round-robin selectors. Wherever you can use FAA instead of CAS, you eliminate an entire class of bugs.

**Follow-up: "What about Pop on a stack — can you express it with FAA?"** Not directly, because Pop is conditional (only succeeds if non-empty) and the operation is "remove the head," which requires reading and writing the head. The conditional and the pointer manipulation force CAS. Some queue designs (LCRQ) use FAA to allocate slot indices within a ring, sidestepping the CAS for the common case.

---

## Systems Questions (Professional)

### Q13. Explain DWCAS, where it exists in hardware, and why Go doesn't expose it.

**Short.** Double-word CAS swaps two adjacent machine words atomically. `CMPXCHG16B` on x86_64; `CASP` (LSE) or `LDXP`/`STXP` (LL/SC) on ARM64. Go does not expose it because the API surface is narrow and most use cases are served by a wrapper allocation plus single-word CAS.

**Expanded.** DWCAS is the hardware primitive that gives you packed tagged pointers without an allocation. With DWCAS you can CAS `(pointer, generation)` as a unit, where pointer is 64 bits and generation is 64 bits, in a single instruction. The cost is exposing 128-bit alignment requirements and architecture-specific behaviour.

Go's `sync/atomic` follows a portability-first design. Exposing DWCAS would force every architecture to provide it (RISC-V has emerging support, MIPS does not). The Go authors chose to expose only single-word atomics; tagged pointers via wrapper struct is the official answer.

**Follow-up: "Could you implement DWCAS in Go via assembly?"** Yes. Write a `.s` file with `CMPXCHG16B` (amd64) or `CASP` (arm64) and expose it via `go:noescape`. Libraries like `golang-fuse` use this pattern. The maintenance cost is non-trivial.

### Q14. Walk me through the Michael-Scott queue and its ABA hazards.

**Short.** MS queue is a singly-linked list with separate head/tail pointers. Enqueue CASes `tail.next` from nil to a new node, then advances `tail`. Dequeue CASes `head` to `head.next` and returns `head.next.value`. ABA hazards: the dequeue dereferences `head` before the CAS; in a non-GC environment, `head` could be freed and reused. The enqueue's `tail.next` CAS can also ABA if nodes recycle.

**Expanded.** The original MS paper (PODC 1996) presents the algorithm and proves correctness assuming a hazard pointer or equivalent reclamation scheme. Most production implementations (Folly's `MPMCQueue` predecessor, `liburcu`'s wfcqueue) pair MS with hazard pointers.

In Go with fresh allocation, the GC handles reclamation and ABA does not occur. With pooled nodes, the bugs return immediately. This is why most Go MPMC queue implementations either avoid MS (in favour of Vyukov ring buffer) or document explicitly that they rely on the GC.

**Follow-up: "Why is the Vyukov MPMC preferred in Go?"** Fixed-size ring buffer with per-slot sequence numbers. No dynamic allocation, no node reclamation, no ABA on slots. The cost is a fixed capacity. For bounded queues, this is almost always the right choice.

### Q15. Describe an ABA-related incident from your past or a public postmortem.

**Short.** Pick a specific incident and walk through symptoms, investigation, root cause, fix, and lesson.

**Expanded.** A standard structure for this answer (used at staff-level interviews):

1. **Symptom.** What the user-facing or operational impact was.
2. **Investigation.** What tools or observations led to the diagnosis.
3. **Root cause.** The specific bug, named and explained.
4. **Fix.** The change made, and any compromises.
5. **Lesson.** What the team learned and how the process changed.

The three postmortems in professional.md (concurrent map corruption, pooled buffer use-after-free, wrapped counter) follow this structure. Pick whichever resonates and tell it as your own.

**Follow-up: "What would you do differently next time?"** Almost always: more aggressive stress-testing, linearizability checking before shipping, and assuming wider widths for counters by default.

### Q16. How does Go's choice to make all atomics sequentially consistent affect lock-free programming?

**Short.** It simplifies reasoning at the cost of barrier overhead on weak architectures. ABA mitigations require fewer ordering annotations; ARM/POWER code pays for unnecessary barriers.

**Expanded.** In C++, every atomic op has an ordering parameter (`memory_order_relaxed`, `acquire`, `release`, `acq_rel`, `seq_cst`). Lock-free algorithms specify the minimum ordering they need; the compiler generates the cheapest barrier. In Go, every atomic op is `seq_cst`, so the compiler always emits the strongest barrier.

For ABA mitigations: hazard pointer publication needs `release`; the freeing thread's scan needs `acquire`. In Go these are both `seq_cst` and the ordering is automatic. The proof of correctness is shorter; the barrier cost on ARM is higher.

For most Go code, this is a wash. For hot-path lock-free libraries, it is a real cost. But the Go team chose simplicity, and the result is that lock-free code in Go is shorter and more obviously correct than the C++ equivalent.

**Follow-up: "Would you advocate for adding `relaxed` atomics to Go?"** Probably not for the standard library. The complexity cost is high, and the use cases are narrow. An external package with assembly intrinsics could serve the niche.

---

## Tricky Questions

### Q17. Suppose I have a lock-free stack in Go that allocates fresh `Node`s on every push. Can ABA still occur?

**Short.** No (for the stack's CAS on `head`), unless something defeats GC pinning.

**Expanded.** Fresh allocation means each `*Node` is a unique heap object until garbage collected. While any goroutine holds a `*Node` reference, the GC will not reuse that address. ABA requires `head` to return to a previous value; with fresh allocation, it cannot. The textbook ABA does not occur.

Cases that defeat this:
- The stack returns nodes to a `sync.Pool` after popping.
- A goroutine stores a `uintptr` of a node and lets the `*Node` go out of scope.
- The user violates the API by retaining a node after popping and re-pushing it.

**Follow-up: "Can I write an ABA-corrupting test for the fresh-allocation stack?"** No. Not without `unsafe` or `sync.Pool`. This is one of the rare cases where Go genuinely eliminates a class of bugs.

### Q18. If I increment a generation counter inside the wrapper but never use it for anything, is it useless?

**Short.** In Go with fresh wrapper allocation, yes — the wrapper pointer identity already prevents ABA. The counter is defensive documentation.

**Expanded.** Some teams keep the counter as a paranoia bit: if a future refactor introduces wrapper recycling (via a sync.Pool of `*versioned`s, say), the counter would catch the resulting ABA. Other teams omit the counter, citing YAGNI and one fewer field to think about. Both are defensible. The cost of keeping it is 8 bytes per wrapper.

**Follow-up: "Could I cache wrappers in a `sync.Pool` to avoid allocations?"** Then the counter becomes load-bearing — you have introduced exactly the recycling that the counter defends against.

### Q19. Why does `atomic.Pointer[T].CompareAndSwap` not need a generation counter when most C++ atomic-pointer CAS code does?

**Short.** Because Go's GC keeps the old pointer's allocation reachable while any goroutine references it, providing implicit hazard-pointer protection.

**Expanded.** In C++, after a successful CAS that replaces `old` with `new`, the `old` allocation is the caller's responsibility to free. While freeing, the address can be reused for another allocation. If another thread had loaded `old` but not yet CAS'd, it now holds a pointer whose address might point to an unrelated object. This is the use-after-free flavour of ABA.

In Go, `old` cannot be freed while any goroutine references it. The address is pinned. ABA is impossible. The generation counter that C++ code needs is redundant in Go for this case.

This breaks when you opt out of GC. Then C++ rules apply.

**Follow-up: "Does this mean Go is universally ABA-safe?"** No. It means Go is ABA-safe for fresh-allocation pointer CAS. Integer counters, slot indices, and pooled objects all remain vulnerable.

### Q20. Can `runtime.GC()` cause ABA?

**Short.** No. GC scheduling does not affect the ABA scenarios in Go; the GC's job is to *prevent* ABA by pinning reachable objects.

**Expanded.** A confused intuition: "What if the GC runs between my Load and my CAS, and reallocates something?" The GC cannot reallocate an object that is reachable. The Load placed the value in a local variable; the local is a GC root; the object stays alive. The GC scheduling is irrelevant.

A different confused intuition: "What if the GC runs a finalizer between Load and CAS?" Finalizers run only on unreachable objects. While the local holds the reference, the object is reachable, no finalizer runs.

**Follow-up: "What about under `runtime.SetFinalizer`?"** Finalizers do not change the rules. They run after the object becomes unreachable. If a hazard pointer (`unsafe.Pointer`) is the only "reference" to an object, the GC sees it as unreachable and may finalize it. This is the `runtime.KeepAlive` issue.

---

## Whiteboard Tasks

### T1. (15 min) Implement a lock-free counter with `atomic.Add` and explain why it is ABA-free.

```go
type Counter struct {
    v atomic.Uint64
}

func (c *Counter) Inc()   { c.v.Add(1) }
func (c *Counter) Get() uint64 { return c.v.Load() }
```

The implementation uses FAA, which has no expected value. There is no CAS, no notion of "the value returned to a previous one mattering." History-independence (S3 from specification.md) holds. ABA cannot occur.

### T2. (20 min) Write a tagged-pointer lock-free stack in Go. Argue its correctness.

See Q5 above. Argue: wrapper pointer identity is unique while reachable (GC); generation is defensive; CAS on `*versioned` succeeds only if no modification has occurred.

### T3. (30 min) Sketch a hazard-pointer scheme for a lock-free linked list with `Insert`, `Delete`, `Contains`.

Outline:
- Per-goroutine slot index, two hazard slots per goroutine (for current and next during traversal).
- Each operation: publish hazard, re-read, traverse, perform CAS, retire.
- Retired list per goroutine; scan when size exceeds threshold.
- Discuss the Harris marking technique for `Delete` to coexist with hazard pointers.

### T4. (30 min) Given a buggy stack (visible to the candidate), identify the ABA hazard and fix it.

```go
// Provided buggy code
type Node struct { value int; next *Node }
type Stack struct { head atomic.Pointer[Node] }
var pool = sync.Pool{New: func() any { return &Node{} }}

func (s *Stack) Push(v int) {
    n := pool.Get().(*Node)
    n.value = v
    for {
        old := s.head.Load()
        n.next = old
        if s.head.CompareAndSwap(old, n) { return }
    }
}

func (s *Stack) Pop() (int, bool) {
    for {
        top := s.head.Load()
        if top == nil { return 0, false }
        next := top.next
        if s.head.CompareAndSwap(top, next) {
            v := top.value
            pool.Put(top)
            return v, true
        }
    }
}
```

Identify: `pool.Put(top)` defeats GC pinning. A concurrent Pop can load `top`, then this Pop pools `top`, a concurrent Push gets `top` back, reinitialises it, and pushes it. The original concurrent Pop's `next := top.next` reads the new state, and its CAS may succeed against a recycled `top`.

Fix: either stop pooling nodes, or pair with hazard pointers, or use a tagged wrapper.

---

## Common Wrong Answers

- "ABA is when the same value appears twice in a row." Wrong. ABA is when a CAS succeeds against a value that has returned, not when adjacent values are equal.
- "Go has no ABA because of the GC." Partly right, fully wrong. Go eliminates pointer-reuse ABA for fresh-allocation code. Counter wraparound, slot recycling, and pool reuse all remain.
- "Use a mutex." Valid pragmatic answer in many contexts, but does not engage with the question. Interviewers want to see you understand the lock-free path even if the production choice is a mutex.
- "Tagged pointers solve everything." They solve value-level ABA, not use-after-free. In manually managed code you still need a reclamation scheme.
- "Hazard pointers are too slow to be practical." False. Folly uses them in production; the Linux kernel's RCU is a close cousin. The reader overhead is ~one atomic store, comparable to a mutex acquire.

---

## What Interviewers Actually Listen For

At junior level: can you explain the bug in your own words and not just recite a definition?

At middle level: can you write the wrapper-based stack and explain why it works? Do you know what `atomic.Pointer[T]` is?

At senior level: can you compare hazard pointers and EBR with specific trade-offs? Have you read a real implementation? Can you write a correctness argument?

At professional level: do you have a story? Have you debugged an ABA-related production incident, or read a postmortem and internalised the lessons? Can you sketch a system design that anticipates this class of bug rather than reacting to it?

Across all levels: do you distinguish between the bug (ABA, a CAS observation problem) and the symptom (use-after-free, slot corruption, counter wraparound)? Many candidates conflate them. Separating the two demonstrates senior-level understanding.

The strongest signal in interviews is the candidate who, when asked "is this code ABA-safe?", answers with a structured argument referring to specific values, specific CAS sites, and a specific reclamation scheme. The weakest signal is "I would use a mutex" without engaging the lock-free reasoning at all.
