# Iterator — Find the Bug

> **Source:** [refactoring.guru/design-patterns/iterator](https://refactoring.guru/design-patterns/iterator)

Each section presents an Iterator that *looks* fine but is broken. Find the bug yourself, then check.

---

## Table of Contents

1. [Bug 1: ConcurrentModificationException during remove](#bug-1-concurrentmodificationexception-during-remove)
2. [Bug 2: `next` without `hasNext`](#bug-2-next-without-hasnext)
3. [Bug 3: Reusing an exhausted iterator](#bug-3-reusing-an-exhausted-iterator)
4. [Bug 4: Closure captures loop variable late](#bug-4-closure-captures-loop-variable-late)
5. [Bug 5: Stream not closed leaks file handles](#bug-5-stream-not-closed-leaks-file-handles)
6. [Bug 6: Eager terminal op on infinite stream](#bug-6-eager-terminal-op-on-infinite-stream)
7. [Bug 7: Iterator wraps DB connection without close](#bug-7-iterator-wraps-db-connection-without-close)
8. [Bug 8: `Iterable` re-uses one Iterator](#bug-8-iterable-re-uses-one-iterator)
9. [Bug 9: Cursor pagination skips items](#bug-9-cursor-pagination-skips-items)
10. [Bug 10: Spliterator infinite loop on trySplit](#bug-10-spliterator-infinite-loop-on-trysplit)
11. [Bug 11: Iterator over HashMap with assumed order](#bug-11-iterator-over-hashmap-with-assumed-order)
12. [Bug 12: Reactive subscriber blocks the publisher](#bug-12-reactive-subscriber-blocks-the-publisher)
13. [Practice Tips](#practice-tips)

---

## Bug 1: ConcurrentModificationException during remove

```java
List<Integer> list = new ArrayList<>(List.of(1, 2, 3, 4));
for (Integer x : list) {
    if (x % 2 == 0) list.remove(x);   // BUG
}
```

`ConcurrentModificationException`.

<details><summary>Reveal</summary>

**Bug:** `list.remove(x)` mutates the underlying list while the for-each Iterator is walking. The Iterator's mod-count check throws on next iteration.

**Fix:** use `Iterator.remove()`.

```java
Iterator<Integer> it = list.iterator();
while (it.hasNext()) {
    if (it.next() % 2 == 0) it.remove();
}
```

Or `removeIf`:

```java
list.removeIf(x -> x % 2 == 0);
```

**Lesson:** Mutation during for-each iteration via the *collection* invalidates. Use the *Iterator's* remove method.

</details>

---

## Bug 2: `next` without `hasNext`

```java
Iterator<String> it = list.iterator();
String first = it.next();
String second = it.next();   // NoSuchElementException if list has 1 item
```

<details><summary>Reveal</summary>

**Bug:** Calling `next()` without checking `hasNext()` throws on exhaustion.

**Fix:** always check first.

```java
if (it.hasNext()) String first = it.next();
if (it.hasNext()) String second = it.next();
```

Or use `Optional`:

```java
Optional<String> first = it.hasNext() ? Optional.of(it.next()) : Optional.empty();
```

**Lesson:** Iterator contract: `hasNext` first, then `next`. Skipping the check is a bug pattern.

</details>

---

## Bug 3: Reusing an exhausted iterator

```python
gen = (x * 2 for x in range(5))
list(gen)         # [0, 2, 4, 6, 8]
list(gen)         # []  -- empty!
```

<details><summary>Reveal</summary>

**Bug:** Generators are one-shot. After the first `list(gen)` consumes all elements, the generator is exhausted. The second call sees an empty iterator.

**Fix:** materialize once or use a function that returns a fresh generator each call.

```python
def gen_factory():
    return (x * 2 for x in range(5))

list(gen_factory())   # [0, 2, 4, 6, 8]
list(gen_factory())   # [0, 2, 4, 6, 8]
```

Or convert to a list once:

```python
data = list(x * 2 for x in range(5))
```

**Lesson:** Most iterators are one-shot. Don't expect to re-iterate. Use a factory or materialize the data.

</details>

---

## Bug 4: Closure captures loop variable late

```javascript
const handlers = [];
for (var i = 0; i < 3; i++) {
    handlers.push(() => console.log(i));
}
handlers.forEach(h => h());
// Expected: 0 1 2
// Actual:   3 3 3
```

<details><summary>Reveal</summary>

**Bug:** `var` is function-scoped; all three closures capture the same `i`, which is `3` after the loop.

**Fix:** use `let` (block-scoped) — each iteration has its own `i`.

```javascript
for (let i = 0; i < 3; i++) {
    handlers.push(() => console.log(i));
}
// 0 1 2
```

Same trap in Python:

```python
funcs = [lambda: i for i in range(3)]
[f() for f in funcs]   # [2, 2, 2]
```

Fix: `[lambda i=i: i for i in range(3)]` (default arg binds at definition).

**Lesson:** Closures over iteration variables capture by reference. Use block-scoped variables (JS `let`, Java `final`) or default arguments.

</details>

---

## Bug 5: Stream not closed leaks file handles

```java
Stream<String> lines = Files.lines(Path.of("/var/log/big.log"));
lines.filter(l -> l.contains("ERROR")).forEach(System.out::println);
// File handle leaked
```

After running often, `Too many open files`.

<details><summary>Reveal</summary>

**Bug:** `Files.lines()` returns a Stream that holds an open file handle. Without `close()`, the handle stays open until GC. Under load, exhausts file descriptors.

**Fix:** try-with-resources.

```java
try (Stream<String> lines = Files.lines(Path.of("/var/log/big.log"))) {
    lines.filter(l -> l.contains("ERROR")).forEach(System.out::println);
}
```

**Lesson:** Streams that wrap resources are `AutoCloseable`. Always use try-with-resources. The Stream's `close` propagates to the underlying handle.

</details>

---

## Bug 6: Eager terminal op on infinite stream

```java
Stream<Integer> infinite = Stream.iterate(0, n -> n + 1);
List<Integer> first10 = infinite
    .filter(n -> n % 2 == 0)
    .collect(Collectors.toList());   // never returns
```

The JVM hangs.

<details><summary>Reveal</summary>

**Bug:** `collect(toList())` is a terminal operation that needs the *entire* stream. Filters are lazy; the final collect is eager. On an infinite source, the stream never ends.

**Fix:** bound it before terminal.

```java
List<Integer> first10 = infinite
    .filter(n -> n % 2 == 0)
    .limit(10)
    .collect(Collectors.toList());
```

**Lesson:** Terminal ops materialize the entire stream. Always bound infinite sources with `limit`, `take`, or `takeWhile`.

</details>

---

## Bug 7: Iterator wraps DB connection without close

```java
public class RowIterator implements Iterator<Row> {
    private final ResultSet rs;
    private final Statement st;
    // No close method
    public RowIterator(DataSource ds, String sql) { /* opens conn */ }
    public boolean hasNext() { /* ... */ }
    public Row next() { /* ... */ }
}

// Usage:
RowIterator it = new RowIterator(ds, "SELECT *");
while (it.hasNext()) it.next();
// Connection never closed; pool exhausted
```

<details><summary>Reveal</summary>

**Bug:** No `close()` / `AutoCloseable`. The DB connection stays open until GC. Under load, the connection pool is exhausted.

**Fix:** implement `AutoCloseable`; use try-with-resources.

```java
public class RowIterator implements Iterator<Row>, AutoCloseable {
    public void close() throws Exception {
        rs.close(); st.close(); conn.close();
    }
}

// Usage:
try (RowIterator it = new RowIterator(ds, "SELECT *")) {
    while (it.hasNext()) it.next();
}
```

**Lesson:** Iterators owning resources must be `AutoCloseable`. Caller's responsibility to close — usually via try-with-resources.

</details>

---

## Bug 8: `Iterable` re-uses one Iterator

```java
class OneShotIterable<T> implements Iterable<T> {
    private final Iterator<T> shared;
    public OneShotIterable(Iterator<T> it) { this.shared = it; }
    public Iterator<T> iterator() { return shared; }   // BUG
}

OneShotIterable<Integer> one = new OneShotIterable<>(List.of(1, 2, 3).iterator());
for (int x : one) System.out.println(x);   // 1 2 3
for (int x : one) System.out.println(x);   // (nothing)
```

<details><summary>Reveal</summary>

**Bug:** `iterator()` returns the same exhausted Iterator on second call. The contract says `iterator()` returns a fresh iterator each time.

**Fix:** if the source is iterable, store it; produce a fresh iterator on each call.

```java
class ProperIterable<T> implements Iterable<T> {
    private final Iterable<T> source;
    public ProperIterable(Iterable<T> src) { this.source = src; }
    public Iterator<T> iterator() { return source.iterator(); }
}
```

If the source is itself one-shot (like an Iterator), document that this Iterable is one-shot.

**Lesson:** `Iterable.iterator()` should return a fresh, independent iterator. Sharing one breaks the contract.

</details>

---

## Bug 9: Cursor pagination skips items

```sql
-- Page 1
SELECT * FROM events WHERE created_at > '2024-01-01' ORDER BY created_at LIMIT 100;
-- Last seen: created_at = '2024-01-05 10:30:00'

-- Page 2
SELECT * FROM events WHERE created_at > '2024-01-05 10:30:00' ORDER BY created_at LIMIT 100;
```

In production, sometimes events disappear from the iterator's output.

<details><summary>Reveal</summary>

**Bug:** Multiple events can share the same `created_at`. If page 1 ended with a tied timestamp, page 2 starts after it — skipping the tied events.

**Fix:** add a tiebreaker (usually the primary key).

```sql
-- Page 2
SELECT * FROM events
WHERE (created_at, id) > ('2024-01-05 10:30:00', 'last_id')
ORDER BY created_at, id LIMIT 100;
```

Or order by primary key alone if monotonic:

```sql
SELECT * FROM events WHERE id > $last_id ORDER BY id LIMIT 100;
```

**Lesson:** Cursor pagination must use a strictly-increasing key. With non-unique fields, add a tiebreaker.

</details>

---

## Bug 10: Spliterator infinite loop on trySplit

```java
public Spliterator<T> trySplit() {
    long mid = (current + fence) / 2;
    if (mid <= current) return null;
    return new MySpliterator(current, mid);   // BUG: didn't update `current`
}
```

`parallelStream` hangs.

<details><summary>Reveal</summary>

**Bug:** `trySplit` should advance `current` to `mid` so future splits / advances start from `mid`. Without it, the original Spliterator still spans `[current, fence)`; splits happen forever.

**Fix:**

```java
public Spliterator<T> trySplit() {
    long mid = (current + fence) >>> 1;
    if (mid <= current) return null;
    long lo = current;
    current = mid;   // advance original
    return new MySpliterator(lo, mid);
}
```

**Lesson:** `trySplit` returns a *new* Spliterator covering `[lo, mid)` AND mutates `this` to cover `[mid, fence)`. Both halves must be exclusive.

</details>

---

## Bug 11: Iterator over HashMap with assumed order

```java
Map<String, Integer> map = new HashMap<>();
map.put("a", 1); map.put("b", 2); map.put("c", 3);

for (var e : map.entrySet()) {
    System.out.println(e.getKey() + "=" + e.getValue());
}
// Tests assume: a=1, b=2, c=3
// Production: c=3, a=1, b=2 (random order)
```

Tests pass on dev; fail randomly in production.

<details><summary>Reveal</summary>

**Bug:** `HashMap` makes no order guarantee. Iteration order depends on hash codes and capacity. May vary across JVM versions, JIT optimizations, or insertion order.

**Fix:** use `LinkedHashMap` for insertion order or `TreeMap` for sorted.

```java
Map<String, Integer> map = new LinkedHashMap<>();
// Iteration in insertion order
```

**Lesson:** `HashMap` order is undefined. Tests that assume an order are flaky. Use the appropriate map for your needs.

</details>

---

## Bug 12: Reactive subscriber blocks the publisher

```java
flux.map(item -> {
    return blockingHttpCall(item);   // BLOCKS the reactor thread
}).subscribe(...);
```

Throughput collapses; reactor's thread pool is saturated.

<details><summary>Reveal</summary>

**Bug:** `blockingHttpCall` blocks one of the reactor's small fixed threads. With ~4 reactor threads and any blocking, throughput is ~4 ops/s.

**Fix:** offload to an elastic scheduler.

```java
flux.flatMap(item ->
    Mono.fromCallable(() -> blockingHttpCall(item))
        .subscribeOn(Schedulers.boundedElastic())
).subscribe(...);
```

`boundedElastic` is sized for blocking work; reactor threads stay free.

**Lesson:** Reactive iterators must NOT block their threads. Wrap blocking I/O in `subscribeOn(boundedElastic())`. Better: use a non-blocking client.

</details>

---

## Practice Tips

- **`Iterator.remove()` is the only safe way** to remove during iteration in Java collections.
- **Always check `hasNext` before `next`.** Or use the protocol's terminal signal.
- **Generators are one-shot.** Use a factory if you need re-iteration.
- **Closures capture variables, not values.** `let` / `final` / default args fix it.
- **Streams over resources need `try-with-resources`.** Otherwise leaks.
- **Bound infinite streams with `limit` / `take`.** Terminal ops are eager.
- **Iterators with resources must be `AutoCloseable`.**
- **`iterator()` returns a fresh iterator** every time. Sharing breaks the contract.
- **Cursor pagination needs strictly-increasing keys** (add tiebreakers).
- **`trySplit` mutates the original** AND returns a new piece. Both halves disjoint.
- **`HashMap` order is undefined.** Use `LinkedHashMap` / `TreeMap` for guarantees.
- **Reactive iterators must not block.** Offload blocking I/O to elastic schedulers.

[← Tasks](tasks.md) · [Optimize →](optimize.md)
