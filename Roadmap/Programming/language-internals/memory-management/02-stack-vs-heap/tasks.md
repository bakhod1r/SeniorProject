# Stack vs Heap — Hands-On Tasks
> **Topic:** [Stack vs Heap](README.md)

These tasks make stack-vs-heap concrete by having you *measure* it. You'll watch escape analysis decide, trigger and diagnose a stack overflow, benchmark allocation cost, and tune a hot path to zero allocations. Prefer Go for the escape-analysis tasks (best tooling), C for the overflow/dangling-pointer tasks, and your choice for the rest. Work through them in order; each builds intuition for the next.

## Table of Contents
- [Warm-Up](#warm-up)
- [Core](#core)
- [Advanced](#advanced)
- [Capstone](#capstone)
- [Self-Assessment](#self-assessment)

---

## Warm-Up

### Task 1 — Make a value escape, then prove it
Write a Go file with two functions: one that creates a small struct and returns its value, and one that creates the same struct and returns its address. Run `go build -gcflags='-m'` and read the output.

**Self-check:**
- [ ] I can point to the exact line that prints `moved to heap`.
- [ ] I can explain why the address-returning version escapes and the value version doesn't.
- [ ] I changed one function so a previously-escaping value stops escaping, and confirmed it in the report.

*Hint:* Returning `&p` escapes; returning `p` (by value) usually does not. Use `//go:noinline` so the compiler doesn't inline away your example.

### Task 2 — Trigger a stack overflow on purpose
Write infinitely recursive functions in two languages of your choice and observe the crash. Note the exact error message each runtime produces.

**Self-check:**
- [ ] I saw a stack-overflow-class crash (e.g., Go `fatal error: stack overflow`, JVM `StackOverflowError`, C `Segmentation fault`).
- [ ] I can explain that the crash is the stack pointer hitting a guard page, not the heap filling up.
- [ ] I rewrote one recursion as a loop and confirmed the crash disappears.

*Hint:* For C, a plain `void f(){ f(); }` will segfault when it reaches the guard page below the stack.

### Task 3 — Classify where values live
Take this list and label each as stack, heap, or "depends on escape analysis," with a one-line reason: a Go loop counter `i`; a Go `&User{}` returned from a constructor; a Java `int` local; a Java `new ArrayList<>()`; a Python `[1,2,3]`; a C `char buf[64]` local; a C `malloc(64)` result.

**Self-check:**
- [ ] I justified each answer by *lifetime*, not by type.
- [ ] I marked the Go pointer-return and Java object cases correctly (heap / depends).
- [ ] I noted that in Python essentially everything is heap.

---

## Core

### Task 4 — Benchmark stack vs heap allocation
In Go, write two benchmarks: one that constructs a small struct on the stack per iteration, and one that allocates it on the heap (force escape by returning a pointer or storing in a package-level sink). Run `go test -bench=. -benchmem`.

**Self-check:**
- [ ] The heap benchmark reports ≥1 allocs/op; the stack one reports 0.
- [ ] The heap benchmark is measurably slower per op.
- [ ] I can explain the ns/op gap in terms of allocator work *and* GC pressure, not just the allocation itself.

*Hint:* Assign to a `var sink *T` package variable to defeat the optimizer and force a real escape.

### Task 5 — Reproduce the dangling-pointer bug in C
Write a C function that returns the address of a local `int`, call it, dereference the result, and observe undefined behavior. Then fix it correctly with `malloc` and document who must `free`.

**Self-check:**
- [ ] I observed garbage, a crash, or "works by luck" from the broken version.
- [ ] I compiled with `-Wall -Wextra` and saw the compiler warn about returning a local address.
- [ ] My fixed version heap-allocates and the comment states the caller's `free` obligation.
- [ ] I ran the fixed version under `valgrind` (or ASan) and saw zero errors.

*Hint:* `gcc -fsanitize=address` will flag the use-after-return immediately.

### Task 6 — Watch a goroutine stack grow
Write a Go program with a deeply (but finitely) recursive function that accumulates large locals, run it, and use `GODEBUG` / runtime tracing or `runtime.Stack` to reason about stack growth. Compare starting goroutine count cost vs OS threads.

**Self-check:**
- [ ] I can explain that the goroutine started at ~2 KB and grew by copy-and-relocate.
- [ ] I can articulate why this requires a precise runtime (pointer rewriting) that C lacks.
- [ ] I estimated the memory for 1,000,000 goroutines vs 1,000,000 OS threads and saw the orders-of-magnitude gap.

*Hint:* A goroutine starts at 2 KB; a default OS thread reserves ~8 MB of address space.

### Task 7 — Expose boxing cost
In Java (or C#/Go-with-interfaces), build a collection of one million boxed values and the equivalent primitive array. Measure memory footprint and iteration time of each.

**Self-check:**
- [ ] The boxed collection uses several times more memory than the primitive array.
- [ ] Iteration over the primitive array is meaningfully faster.
- [ ] I can explain the gap via per-element heap objects and cache-miss-heavy pointer chasing.

*Hint:* `int[1_000_000]` is ~4 MB contiguous; `ArrayList<Integer>` of the same is ~20+ MB scattered.

---

## Advanced

### Task 8 — Drive a hot path to zero allocations
Take a function that builds a string key per call with `fmt.Sprintf` (Go) and rewrite it to allocate zero times in steady state using a reusable byte buffer and `strconv.AppendInt`. Prove it with `-benchmem`.

**Self-check:**
- [ ] Before: ≥1 allocs/op. After: 0 allocs/op once the buffer is reused.
- [ ] I avoided `interface{}` boxing (no `Sprintf` with `%v`-style args).
- [ ] The new API lets the caller own/reuse the buffer across calls.
- [ ] I confirmed the escape report shows the buffer not escaping.

### Task 9 — Diagnose churn vs leak from a profile
Generate a Go (or JVM) workload, capture a heap profile, and distinguish high allocation churn from a real leak using `alloc_space` vs `inuse_space` (Go) or two heap dumps over time (JVM).

**Self-check:**
- [ ] I produced one scenario where `alloc_space` is high but `inuse_space` is flat (churn) and one where `inuse_space` grows without bound (leak).
- [ ] For the leak, I found the retaining reference and fixed it.
- [ ] For the churn, I reduced allocation rate and observed lower GC frequency (`GODEBUG=gctrace=1`).

*Hint:* An unbounded map or slice that's appended to forever, never trimmed, is a classic "leak that isn't a bug in the allocator."

### Task 10 — Measure the locality penalty
Build two equivalent structures holding the same N elements: one contiguous (array/slice of structs) and one pointer-linked or pointer-indirected (slice of pointers / linked list). Sum a field across each and compare time. Confirm the gap is cache-driven.

**Self-check:**
- [ ] The contiguous version is several times faster for large N.
- [ ] I used `perf stat` (or equivalent) to show more cache misses in the pointer-chasing version.
- [ ] I can explain why this is the *real* reason "reduce heap allocations" speeds programs up — locality, not just alloc cost.

*Hint:* `perf stat -e cache-misses,cache-references ./prog` quantifies the difference.

---

## Capstone

### Task 11 — Allocation-aware refactor of a real service path
Take (or write) a small HTTP handler that does per-request allocation: JSON decode into a fresh struct, build response strings, log with formatting. Profile it under load, then refactor to minimize per-request heap allocation — reuse buffers, pool decoders, avoid interface boxing, return-by-value where safe — without changing behavior. Produce a before/after report.

**Self-check:**
- [ ] I have a baseline: allocs/op, allocation rate, GC time, and p99 latency under a fixed load.
- [ ] Each optimization is justified by the profile, not by guesswork, and verified by the escape report.
- [ ] After: measurably lower allocation rate, fewer GC cycles, and equal-or-better p99 — with identical responses (tests pass).
- [ ] I documented which allocations I *kept* on the heap deliberately and why (lifetime/size/sharing).
- [ ] I can defend every change to a reviewer who asks "why was this on the heap, and why is it safe to move?"

*Hint:* `sync.Pool` for decoders/buffers, `json.Decoder` reuse, pre-sized slices, and `strconv.Append*` over `fmt.Sprintf` are the usual high-leverage moves. Keep request-lifetime correctness front of mind: a pooled buffer must not outlive the request.

---

## Self-Assessment

You have mastered this topic when you can:

- [ ] Explain, in machine terms, why a stack allocation is ~1 cycle and a heap allocation is tens-to-thousands.
- [ ] Read a Go escape report and predict it before running it.
- [ ] Tell stack overflow apart from heap exhaustion by symptom and name the guard-page mechanism.
- [ ] Explain why returning a pointer to a local is a bug in C but safe in Go.
- [ ] Drive a hot path to zero allocations and prove it with `-benchmem`.
- [ ] Distinguish allocation churn from a leak using a heap profile.
- [ ] Articulate why locality (cache/TLB), not allocation cost alone, makes "reduce heap allocations" such a powerful performance lever.
- [ ] Justify, for a real design, when the heap is the *right* choice despite the stack being cheaper.

If any box is unchecked, revisit the corresponding tier file and redo the matching task with measurement, not intuition.
