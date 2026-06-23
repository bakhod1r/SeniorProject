# Iterator — Optimize

> **Source:** [refactoring.guru/design-patterns/iterator](https://refactoring.guru/design-patterns/iterator)

Each section presents an Iterator that *works* but is wasteful. Profile, optimize, measure.

---

## Table of Contents

1. [Optimization 1: Stream rows from DB instead of loading all](#optimization-1-stream-rows-from-db-instead-of-loading-all)
2. [Optimization 2: Lazy generators over eager lists](#optimization-2-lazy-generators-over-eager-lists)
3. [Optimization 3: Indexed loop over Iterator for primitives](#optimization-3-indexed-loop-over-iterator-for-primitives)
4. [Optimization 4: Batch processing for I/O iterators](#optimization-4-batch-processing-for-io-iterators)
5. [Optimization 5: Cursor pagination over offset](#optimization-5-cursor-pagination-over-offset)
6. [Optimization 6: Custom Spliterator for parallel stream](#optimization-6-custom-spliterator-for-parallel-stream)
7. [Optimization 7: Replace LinkedList iteration with array-backed list](#optimization-7-replace-linkedlist-iteration-with-array-backed-list)
8. [Optimization 8: Backpressure with `request(n)`](#optimization-8-backpressure-with-requestn)
9. [Optimization 9: Drop unnecessary stream allocation](#optimization-9-drop-unnecessary-stream-allocation)
10. [Optimization 10: Vectorized batch iteration](#optimization-10-vectorized-batch-iteration)
11. [Optimization Tips](#optimization-tips)

---

## Optimization 1: Stream rows from DB instead of loading all

### Before

```java
List<Order> all = jdbcTemplate.query("SELECT * FROM orders", rowMapper);   // 10M rows → OOM
all.forEach(this::process);
```

OOM on big tables.

### After

```java
try (Stream<Order> stream = jdbcTemplate.queryForStream("SELECT * FROM orders", rowMapper)) {
    stream.forEach(this::process);
}
```

Or with raw JDBC:

```java
ps.setFetchSize(1000);
try (ResultSet rs = ps.executeQuery()) {
    while (rs.next()) process(mapRow(rs));
}
```

**Measurement.** Memory: O(N) → O(1). Latency to first item: huge → small.

**Lesson:** Streaming Iterators bound memory regardless of dataset size. Always for big result sets.

---

## Optimization 2: Lazy generators over eager lists

### Before

```python
def big_data():
    return [process(x) for x in range(10_000_000)]   # eager; 10M items in memory

for x in big_data():
    if condition(x): break
```

Allocates 10M items even though we may break early.

### After

```python
def big_data():
    for x in range(10_000_000):
        yield process(x)

for x in big_data():
    if condition(x): break   # stops processing immediately
```

**Measurement.** Memory: O(N) → O(1). Total work: huge → minimal (break short-circuits).

**Lesson:** When the consumer might short-circuit (break, take, takeWhile), generators win.

---

## Optimization 3: Indexed loop over Iterator for primitives

### Before

```java
List<Integer> nums = ...;
long sum = 0;
for (int n : nums) sum += n;   // boxed Integer iteration
```

Boxing per element.

### After

```java
int[] nums = ...;
long sum = 0;
for (int i = 0; i < nums.length; i++) sum += nums[i];
```

Or `IntStream`:

```java
long sum = IntStream.of(nums).sum();
```

**Measurement.** ~5-10× speedup for primitive math. Allocation-free.

**Lesson:** For primitive math, use primitive arrays / streams (`IntStream`, `LongStream`). Boxed `Iterator<Integer>` allocates.

---

## Optimization 4: Batch processing for I/O iterators

### Before

```java
for (Order o : ordersIterator) {
    db.save(o);   // one INSERT per call
}
```

Round-trip per row.

### After

```java
List<Order> batch = new ArrayList<>(100);
for (Order o : ordersIterator) {
    batch.add(o);
    if (batch.size() == 100) {
        db.saveBatch(batch);
        batch.clear();
    }
}
if (!batch.isEmpty()) db.saveBatch(batch);
```

Or with utility:

```java
import com.google.common.collect.Iterators;
Iterators.partition(ordersIterator, 100)
    .forEachRemaining(db::saveBatch);
```

**Measurement.** Throughput rises ~10-100× (depending on per-call latency).

**Lesson:** I/O-heavy iteration benefits from batching. Group items; do I/O once per batch.

---

## Optimization 5: Cursor pagination over offset

### Before

```sql
SELECT * FROM events ORDER BY id LIMIT 100 OFFSET 1000000;
```

Postgres scans 1M rows to skip them. Each successive page is slower.

### After

```sql
SELECT * FROM events WHERE id > $last_id ORDER BY id LIMIT 100;
```

Server uses the index; O(log N + page_size) regardless of position.

**Measurement.** Page latency stays constant. At deep offsets, ~100× speedup.

**Lesson:** Cursor pagination is the default for any growing dataset. Offset is acceptable only for tiny tables.

---

## Optimization 6: Custom Spliterator for parallel stream

### Before

```java
List<Long> data = LongStream.range(0, 10_000_000).boxed().collect(toList());
long sum = data.stream().mapToLong(Long::longValue).sum();   // serial
```

One core; ~150ms.

### After

```java
long sum = LongStream.range(0, 10_000_000).parallel().sum();   // built-in
// or with custom spliterator:
long sum = StreamSupport.longStream(new RangeSpliterator(0, 10_000_000), true).sum();
```

**Measurement.** ~`min(cores, work / overhead)` speedup. ~30 ms on 8-core.

**Lesson:** `parallel()` over splittable sources scales with cores. Custom Spliterator for non-standard data structures.

---

## Optimization 7: Replace LinkedList iteration with array-backed list

### Before

```java
LinkedList<Integer> list = new LinkedList<>();
for (Integer x : list) sum += x;   // pointer chasing; cache miss per node
```

Cache-hostile.

### After

```java
ArrayList<Integer> list = new ArrayList<>();
for (Integer x : list) sum += x;   // sequential memory; cache-friendly
```

**Measurement.** ~10-100× speedup on iteration-heavy workloads (varies by element size and cache state).

**Lesson:** For iteration, array-backed structures dominate. `LinkedList` is rarely the right choice in Java — name is misleading.

---

## Optimization 8: Backpressure with `request(n)`

### Before

```java
publisher.subscribe(new BaseSubscriber<>() {
    public void hookOnSubscribe(Subscription s) { s.request(Long.MAX_VALUE); }
    public void hookOnNext(Item i) { slowProcess(i); }
});
```

Publisher emits as fast as possible; slow processor's queue grows; OOM.

### After

```java
publisher.subscribe(new BaseSubscriber<>() {
    public void hookOnSubscribe(Subscription s) { s.request(10); }
    public void hookOnNext(Item i) { slowProcess(i); request(1); }
});
```

**Measurement.** Memory bounded; throughput now matches the slow processor's rate.

**Lesson:** Reactive Streams' explicit `request(n)` is backpressure. Use it; don't request `Long.MAX_VALUE` for a slow subscriber.

---

## Optimization 9: Drop unnecessary stream allocation

### Before

```java
List<String> strings = ...;
boolean any = strings.stream().anyMatch(s -> s.contains("foo"));
```

For small lists, the stream allocation costs more than the loop.

### After

```java
boolean any = false;
for (String s : strings) {
    if (s.contains("foo")) { any = true; break; }
}
```

**Measurement.** Microseconds saved per call. For tight inner loops over small lists, observable.

**Lesson:** Streams aren't free. For small or hot paths, plain loops can be faster. Don't over-stream.

---

## Optimization 10: Vectorized batch iteration

### Before (row-at-a-time)

```java
for (Row r : rows) {
    if (r.amount > 100) result.add(r);
}
```

Per-row overhead; cache miss on each row's columns.

### After (batch / columnar)

```java
Iterator<Batch> batches = source.batches(1024);
while (batches.hasNext()) {
    Batch b = batches.next();
    boolean[] mask = new boolean[b.size()];
    for (int i = 0; i < b.size(); i++) mask[i] = b.amount[i] > 100;   // SIMD-friendly
    // Use mask to copy selected rows.
}
```

**Measurement.** ~10× throughput for analytical workloads. Apache Arrow / DuckDB / ClickHouse use this internally.

**Lesson:** For analytical data processing, batch / columnar iteration beats row-by-row. Modern columnar engines are built around it.

---

## Optimization Tips

- **Stream large datasets.** Bounded memory regardless of size.
- **Lazy iteration when consumer might short-circuit.** Avoids wasted computation.
- **Indexed loops for primitives.** Avoid boxing.
- **Batch I/O.** Group calls; massive speedup.
- **Cursor pagination over offset.** Stable, fast, predictable.
- **Parallel streams for splittable, large sources.** Scale with cores.
- **Array-backed lists for iteration.** Cache-friendly.
- **`request(n)` for reactive backpressure.** Match consumer rate to publisher.
- **Streams aren't free.** For tight, small loops, plain `for` may be faster.
- **Batch / columnar for analytics.** Per-row dispatch dominates.
- **Profile.** Iteration cost is rarely the issue; usually it's the body.

[← Find Bug](find-bug.md) · [Behavioral patterns home](../README.md)
