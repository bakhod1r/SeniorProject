# Iterator — Interview Preparation

> **Source:** [refactoring.guru/design-patterns/iterator](https://refactoring.guru/design-patterns/iterator)

---

## Table of Contents

1. [Junior Questions](#junior-questions)
2. [Middle Questions](#middle-questions)
3. [Senior Questions](#senior-questions)
4. [Professional Questions](#professional-questions)
5. [Coding Tasks](#coding-tasks)
6. [Trick Questions](#trick-questions)
7. [Behavioral / Architectural Questions](#behavioral-architectural-questions)
8. [Tips for Answering](#tips-for-answering)

---

## Junior Questions

### Q1. What is the Iterator pattern?

**A.** A behavioral pattern that lets you walk a collection's elements one at a time without exposing its internal storage. The Iterator answers "is there more?" and "give me the next." Same code works for arrays, trees, hash maps, lazy streams.

### Q2. What's the difference between Iterator and Iterable?

**A.** Iterable is "I can produce iterators" — a collection. Iterator is "I'm currently walking" — a position-holding object. `iterator()` on Iterable returns a fresh Iterator each time.

### Q3. What's external vs internal iteration?

**A.** External: caller drives the loop (`while (it.hasNext())`). Internal: collection drives, you give it a callback (`list.forEach(item -> ...)`). External: more control. Internal: cleaner pipelines.

### Q4. Why does each call to `iterator()` return a new instance?

**A.** Independent traversal state. Two callers can walk the same collection at different speeds without interfering. Reusing one Iterator after exhaustion isn't supported by most APIs.

### Q5. What's the difference between Iterator and a generator?

**A.** Functionally the same. A generator is a function that uses `yield`; the language compiles it into an Iterator state machine. Same protocol; less boilerplate.

### Q6. What's lazy iteration?

**A.** Elements are computed on demand, not eagerly. `[x*2 for x in source]` is eager — builds a list. `(x*2 for x in source)` is lazy — yields one at a time. Lazy iteration enables infinite sequences and saves memory.

### Q7. Why is mutating a collection during iteration usually a bug?

**A.** Adding or removing elements invalidates the Iterator's position assumptions. Java throws `ConcurrentModificationException`. C++ has undefined behavior. Either iterate over a copy, or use the Iterator's own `remove()` method.

### Q8. Give 5 real-world examples.

**A.** Java collection iterators, Python generators, JDBC ResultSet, Kafka consumers, AWS S3 paginators, file system walkers, DOM TreeWalker, RxJava Observable, Kotlin Sequence/Flow.

### Q9. What's a fail-fast Iterator?

**A.** One that detects modification of the underlying collection and throws (e.g., `ConcurrentModificationException`). Java's `ArrayList`, `HashMap`. The opposite is fail-safe, where the Iterator works on a snapshot and ignores subsequent changes.

### Q10. When should you NOT use Iterator?

**A.** Flat array with one fixed traversal — direct indexing is clearer. Tiny collection where allocation cost outweighs benefit. Language idiom (Go's `range`) handles iteration without explicit pattern.

---

## Middle Questions

### Q11. Class-based vs generator-based Iterator — when each?

**A.** Generator: most cases when supported (Python, JS, C#, Kotlin). Less code; lazy by default. Class: when explicit lifecycle is needed (resources to close), Java's traditional `Iterator`, or when multiple methods (peek, mark, reset) are required.

### Q12. How does `for-each` work under the hood?

**A.** Calls `iterator()` on the collection; loops `while (it.hasNext()) { var x = it.next(); ... }`. The compiler desugars the loop. For arrays, may compile to indexed access directly.

### Q13. What's a `Spliterator`?

**A.** Java 8's parallel-friendly Iterator. Has `tryAdvance` (like `next`) and `trySplit` (divide for parallel processing). Streams use it. Implements `characteristics()` (ORDERED, SIZED, etc.) for optimization hints.

### Q14. How do you implement an iterator over a tree?

**A.** Two stacks-or-queues approaches. DFS: stack of unvisited nodes; on `next()`, pop and push children. BFS: queue; pop and enqueue children. Each algorithm is its own Iterator.

### Q15. What's an auto-paginating Iterator?

**A.** Wraps an external paginated API. The Iterator fetches the first page; on exhaustion, fetches the next page transparently. Caller sees a flat sequence; pagination is invisible.

### Q16. Why is `remove()` on Java's Iterator a special method?

**A.** It mutates the underlying collection without invalidating the Iterator. Direct `list.remove(...)` would invalidate. The Iterator's `remove` is aware of its own state.

### Q17. What's the cost of creating an Iterator?

**A.** A small object allocation (typically 16-48 bytes). For long iterations, the cost is amortized. For tight inner loops over small collections, can dominate; profile.

### Q18. When does iteration order matter for HashMap?

**A.** Iteration order is unspecified for `HashMap`. Use `LinkedHashMap` for insertion order, `TreeMap` for sorted order. Relying on `HashMap`'s order is a bug — it can change across JVM versions.

### Q19. How does Kotlin's Sequence differ from Stream?

**A.** Both are lazy. Sequence is sequential; Stream supports `.parallel()`. Sequence is cold (re-iterable); Stream is one-shot. Sequence is Kotlin-native syntax (`asSequence()`); Stream is Java's API.

### Q20. What's an infinite Iterator?

**A.** One that always returns `true` from `hasNext`. Examples: `Stream.iterate(0, n -> n + 1)`, Python's `itertools.count()`. Useful with `take(n)` to bound iteration. Calling `toList` would never return.

---

## Senior Questions

### Q21. How do you stream millions of rows from a database?

**A.** JDBC: `setFetchSize(N)` plus `TYPE_FORWARD_ONLY` cursor. Postgres needs autoCommit=false for server-side cursors. Iterate with `while (rs.next())`. Close in `finally` / `try-with-resources`. Without these settings, the driver loads everything into memory.

### Q22. How does Reactive Streams' backpressure work?

**A.** Subscriber requests N items: `subscription.request(n)`. Publisher emits at most n. Subscriber requests more as it processes. Without this, fast publishers OOM slow subscribers. Reactive Streams TCK enforces the contract.

### Q23. What's cursor pagination and why use it over offset?

**A.** Cursor: `WHERE id > $last_id ORDER BY id LIMIT N`. Offset: `LIMIT N OFFSET M`. Cursor is O(log N + page_size); offset is O(M + N). Cursor is also stable under concurrent inserts (offset shifts). Standard for any large dataset.

### Q24. How do you implement an Iterator that closes resources?

**A.** Implement `AutoCloseable`. Use `try-with-resources`. The Iterator owns the resource (file handle, DB connection); `close()` releases it. If users forget to close, the resource leaks. Stream's `Files.lines()` works this way.

### Q25. What's the trade-off between fail-fast and fail-safe iteration?

**A.** Fail-fast: detects mutation, throws. Forces correctness; doesn't scale to concurrent modification. Fail-safe: snapshot at construction. Always works; doesn't see post-construction changes; memory cost. Use fail-safe for concurrent collections.

### Q26. How does Java's parallel stream split work?

**A.** Underlying `Spliterator.trySplit` halves the range; ForkJoinPool divides work across cores. Speedup approaches `min(cores, source_size / chunk_size)`. Inefficient for tiny streams or imbalanced work distributions.

### Q27. What's a one-shot Iterator?

**A.** An Iterator that can be iterated only once; cannot restart. Most generators are one-shot — they "consume" themselves. Java `Stream` is one-shot; Kotlin `Sequence` is multi-shot.

### Q28. How do you parallelize iteration over a tree?

**A.** Custom `Spliterator` whose `trySplit` divides children among threads. Tricky if traversal order matters. For dependency trees, parallelize by level (BFS layers).

### Q29. What's a mid-iteration failure recovery strategy?

**A.** State the Iterator's position; on retry, resume from cursor. For DB iterators: transaction-bound; close on error and re-issue with the last seen ID. For idempotent processing: track last-processed ID separately; iteration becomes resumable.

### Q30. How do you observe iteration in production?

**A.** Metrics: items processed per second, current cursor position, error rate. Logs: structured per-item or per-batch. Distributed traces: span per page or per batch. Watch for: stuck iterators (no progress), lopsided splits (one parallel worker handles 90%).

---

## Professional Questions

### Q31. How do generators compile to state machines?

**A.** The compiler rewrites the function into a class with a state field. `yield` becomes a label; resumption jumps to the label and continues. C# / Kotlin / JS engines do this transparently. Per-`next` cost is one switch + a few field assignments.

### Q32. JIT optimization of `for-each` over ArrayList?

**A.** Monomorphic call site sees `ArrayList$Itr`. JIT inlines `hasNext` (compares cursor to size) and `next` (array access). Result is identical to indexed access. For megamorphic sites (multiple Iterable types), falls back to vtable.

### Q33. What's the cost of boxing in `Iterator<Integer>`?

**A.** Each `next()` returns a boxed `Integer`. Allocation per element. For `int[]`, prefer `IntStream` or indexed loops. For mass numerical work, columnar / native arrays are 10-100× faster than Iterator-of-Integer.

### Q34. How does Reactor implement operator chaining?

**A.** Each operator is a Subscriber to upstream and a Publisher to downstream. Subscribe propagates downstream; request propagates upstream; emissions propagate downstream; complete/error propagate. Each operator is allocation per subscription.

### Q35. What's the cost of `flatMap` in reactive streams?

**A.** `flatMap` introduces concurrency: spawns N inner subscribers (default 256). Each is a small allocation. Order is not preserved (use `concatMap` for ordered). High-cardinality flatMap in tight pipelines is a perf hotspot.

### Q36. How do columnar engines avoid per-row Iteration cost?

**A.** Iterate batches (1024 rows). Operators (filter, project) work on entire columns at once, often with SIMD. Per-row dispatch cost amortized. Apache Arrow, DuckDB, ClickHouse all use this.

### Q37. What's the memory layout impact on iteration?

**A.** Sequential array iteration: prefetcher saturates memory bandwidth (~30 GB/s). Linked list pointer chasing: cache miss per node (~100 ns each). Choose array-backed structures for iteration-heavy workloads.

### Q38. How does Rust achieve zero-cost iteration?

**A.** `Iterator` is a trait; generic code monomorphizes per concrete type. No vtable. Aggressive inlining + LLVM optimizations produce code identical to hand-written loops. `for x in vec` and `for i in 0..vec.len()` compile to the same machine code.

### Q39. What's `Spliterator.SUBSIZED` characteristic?

**A.** Means each `trySplit` produces a Spliterator with known size. Enables optimization: total work known; allocation can be sized. Arrays have it; HashMaps don't.

### Q40. Why might `Stream.parallel()` be slower than serial?

**A.** Overhead: thread coordination, ForkJoinPool dispatch, Spliterator splits. For small sources or fast operators, overhead dominates. Use parallel only when N × per-element cost > thread overhead (~1ms threshold).

---

## Coding Tasks

### T1. Implement a Tree DFS iterator

A binary tree with `dfs()` returning an `Iterator<T>`. Test with a 5-node tree.

### T2. Implement a Tree BFS iterator

Same tree, `bfs()` returning an `Iterator<T>`. Verify level-by-level order.

### T3. Auto-paginating client

Wrap an API that returns pages with `next_url`. Iterator yields a flat sequence of items.

### T4. Bidirectional iterator

Add `prev()` to a list iterator. Boundary conditions: stay at index 0 / size.

### T5. Filter + take generator chain

Generator producing primes; `take(10)` returns first 10. Verify lazy evaluation.

### T6. Streaming JDBC iterator

Stream a `SELECT *` from a table without loading all into memory. Use try-with-resources.

### T7. Concurrent-safe iterator

A snapshot-based iterator over a `List`; concurrent modifications don't affect it.

### T8. `Spliterator` for a custom range

Range `[lo, hi)` with `tryAdvance` and `trySplit`. Test parallel stream over it.

---

## Trick Questions

### TQ1. "If I `return` early from a `for-each` loop, does the iterator get closed?"

**A.** No, not automatically — unless wrapped in `try-with-resources`. `Stream` from `Files.lines()` requires explicit closing. If you `return` mid-iteration, the file handle stays open. Always `try-with-resources` for resource-bearing iterators.

### TQ2. "Can two threads safely call `next()` on the same Iterator?"

**A.** Almost never. Iterators are stateful and not thread-safe by default. Each thread should have its own. Even thread-safe collections produce iterators meant for one thread.

### TQ3. "Is a `Stream` the same as an `Iterator`?"

**A.** Built on Iterators (via Spliterator). Stream adds operators (filter, map, reduce), laziness, parallelism. Both are one-shot. You can convert: `iterator.spliterator()` or `Stream.iterator()`.

### TQ4. "Why does `for (var x : list) list.add(...)` throw?"

**A.** Mutation of the underlying list during iteration → `ConcurrentModificationException` (fail-fast). The Iterator's mod-count check detects it. Fix: collect new items separately and add after.

### TQ5. "Can I convert an Iterator to an Iterable?"

**A.** Yes, but it's a one-shot Iterable: `() -> iterator`. After the first `iterator()` call, subsequent calls return the same exhausted iterator. Acceptable for one-pass usages; surprising otherwise.

### TQ6. "What's the difference between a Java `Stream` and a Kotlin `Sequence`?"

**A.** Both lazy. Stream supports `parallel()`; Sequence doesn't. Stream is one-shot; Sequence is cold (re-iterable on each terminal op). Sequence has Kotlin-friendly receivers.

### TQ7. "Why don't HashMaps have a defined iteration order?"

**A.** Hash buckets aren't ordered — entries are placed by `hashCode % capacity`. Insertion order isn't preserved. Use `LinkedHashMap` for insertion order; `TreeMap` for sorted.

### TQ8. "How do you iterate over an infinite stream?"

**A.** With operators that bound it: `take(n)`, `takeWhile(...)`, `limit(n)`. Without bounding, terminal operations like `collect`, `toList`, `count` never return.

---

## Behavioral / Architectural Questions

### B1. "Tell me about a time you streamed huge data instead of loading it all."

Concrete: a CSV of 50M rows. Memory blew up with `readAll`. Refactored to a streaming iterator that yields rows; pipeline stays bounded. Mention transforms (filter, map) preserved laziness.

### B2. "How would you design pagination for a public API?"

Cursor-based. Encode cursor opaquely (base64 of last-id + tiebreaker). Stable under concurrent inserts. Document max page size. Provide an SDK iterator that auto-paginates. Avoid offset for any data growing unboundedly.

### B3. "Walk me through reactive stream backpressure."

Subscriber requests N. Publisher honors. Operators propagate. Demand control prevents OOM under load mismatch. Mention `onBackpressureBuffer` for tolerance, `subscribeOn(boundedElastic)` for blocking ops.

### B4. "When would you use a generator vs a class iterator?"

Generators when supported and logic is linear (yield-based). Classes when explicit lifecycle (close), multi-method API, or language doesn't support generators. Don't fight idiom.

### B5. "Your iteration is slow over a HashMap. Why?"

Pointer chasing (entries scattered across buckets); cache misses. Switching to `LinkedHashMap` keeps the bucket array but adds entry chains for order — similar perf. For pure speed, an `ArrayList<Entry>` may beat `HashMap.entrySet()`.

### B6. "How do you handle errors mid-iteration?"

Depends on semantics. Fail-fast: bubble up, position lost. Resumable: track last-good cursor, retry from there. Lossy: log and skip. State the trade-off explicitly.

---

## Tips for Answering

1. **Lead with intent.** "Iterator hides the storage; same loop works over any collection."
2. **Generator example first.** Most modern languages have them; show idiom.
3. **Mention multiple traversals.** Trees, graphs — DFS and BFS as separate Iterators.
4. **Cursor pagination is the architect's answer.** Don't suggest offset for big data.
5. **Reactive backpressure is a senior topic.** Be ready to explain `request(n)`.
6. **Distinguish lazy vs eager.** Cost trade-off, semantics.
7. **Acknowledge fail-fast / fail-safe.** Senior interviewers probe.
8. **Performance: usually iteration overhead is invisible** — until it isn't. Profile.

[← Professional](professional.md) · [Tasks →](tasks.md)
