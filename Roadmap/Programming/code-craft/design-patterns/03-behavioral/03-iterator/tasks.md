# Iterator — Hands-On Tasks

> **Source:** [refactoring.guru/design-patterns/iterator](https://refactoring.guru/design-patterns/iterator)

Each task includes a brief and a reference solution. Try first; check after.

---

## Table of Contents

1. [Task 1: Tree DFS iterator](#task-1-tree-dfs-iterator)
2. [Task 2: Tree BFS iterator](#task-2-tree-bfs-iterator)
3. [Task 3: Auto-paginating API client](#task-3-auto-paginating-api-client)
4. [Task 4: Bidirectional list iterator](#task-4-bidirectional-list-iterator)
5. [Task 5: Filter + take generator chain](#task-5-filter-take-generator-chain)
6. [Task 6: Streaming JDBC iterator](#task-6-streaming-jdbc-iterator)
7. [Task 7: Snapshot iterator](#task-7-snapshot-iterator)
8. [Task 8: Custom Spliterator over a range](#task-8-custom-spliterator-over-a-range)
9. [Task 9: Zipping two iterators](#task-9-zipping-two-iterators)
10. [Task 10: Resource-aware file lines iterator](#task-10-resource-aware-file-lines-iterator)
11. [How to Practice](#how-to-practice)

---

## Task 1: Tree DFS iterator

**Brief.** A binary tree; DFS iteration yields values pre-order.

### Solution (Java)

```java
import java.util.*;

public final class Tree<T> {
    public final T value;
    public final List<Tree<T>> children = new ArrayList<>();
    public Tree(T v) { this.value = v; }

    public Iterator<T> dfs() {
        return new Iterator<>() {
            private final Deque<Tree<T>> stack = new ArrayDeque<>(List.of(Tree.this));

            public boolean hasNext() { return !stack.isEmpty(); }

            public T next() {
                if (!hasNext()) throw new NoSuchElementException();
                Tree<T> n = stack.pop();
                for (int i = n.children.size() - 1; i >= 0; i--) stack.push(n.children.get(i));
                return n.value;
            }
        };
    }
}
```

DFS pre-order. Stack pops parent before children; reverse-order push preserves left-to-right.

---

## Task 2: Tree BFS iterator

**Brief.** Same tree; BFS iteration yields values level-by-level.

### Solution (Java)

```java
public Iterator<T> bfs() {
    return new Iterator<>() {
        private final Queue<Tree<T>> queue = new ArrayDeque<>(List.of(Tree.this));

        public boolean hasNext() { return !queue.isEmpty(); }

        public T next() {
            if (!hasNext()) throw new NoSuchElementException();
            Tree<T> n = queue.poll();
            queue.addAll(n.children);
            return n.value;
        }
    };
}
```

Queue instead of stack; level-by-level order.

---

## Task 3: Auto-paginating API client

**Brief.** A REST API returns pages. The Iterator yields a flat sequence; auto-fetches next page.

### Solution (Python)

```python
from typing import Iterator
import requests


def list_orders() -> Iterator[dict]:
    url = "https://api.example.com/orders"
    while url:
        resp = requests.get(url, timeout=10)
        resp.raise_for_status()
        body = resp.json()

        for o in body["data"]:
            yield o

        url = body.get("next_url")


# Usage:
for o in list_orders():
    if o["amount"] > 1000:
        print(o["id"])
        if some_condition(o):
            break   # stops fetching
```

Caller sees a flat sequence. Pagination invisible. Stops gracefully on `break`.

---

## Task 4: Bidirectional list iterator

**Brief.** A list iterator with `next()` and `prev()`. Throw on out-of-bounds.

### Solution (Java)

```java
import java.util.*;

public final class BiIterator<T> {
    private final List<T> list;
    private int cursor = -1;

    public BiIterator(List<T> list) { this.list = list; }

    public boolean hasNext() { return cursor + 1 < list.size(); }
    public boolean hasPrev() { return cursor > 0; }

    public T next() {
        if (!hasNext()) throw new NoSuchElementException();
        return list.get(++cursor);
    }

    public T prev() {
        if (!hasPrev()) throw new NoSuchElementException();
        return list.get(--cursor);
    }
}

class Demo {
    public static void main(String[] args) {
        var it = new BiIterator<>(List.of("a", "b", "c"));
        System.out.println(it.next());   // a
        System.out.println(it.next());   // b
        System.out.println(it.prev());   // a
        System.out.println(it.next());   // b
    }
}
```

Java's `ListIterator` does this; this is a minimal version.

---

## Task 5: Filter + take generator chain

**Brief.** Generator yielding naturals; chain `filter(prime)` and `take(10)`. Verify lazy.

### Solution (Python)

```python
from typing import Iterator


def naturals() -> Iterator[int]:
    n = 0
    while True:
        yield n
        n += 1


def is_prime(n: int) -> bool:
    if n < 2: return False
    for i in range(2, int(n ** 0.5) + 1):
        if n % i == 0: return False
    return True


def filter_gen(source: Iterator[int]):
    for x in source:
        if is_prime(x): yield x


def take(source: Iterator[int], n: int):
    for i, x in enumerate(source):
        if i >= n: return
        yield x


for p in take(filter_gen(naturals()), 10):
    print(p)
# 2 3 5 7 11 13 17 19 23 29
```

Infinite source; lazy filter; finite take. No intermediate lists.

---

## Task 6: Streaming JDBC iterator

**Brief.** Stream rows from a Postgres table without loading all into memory.

### Solution (Java)

```java
import java.sql.*;
import javax.sql.DataSource;
import java.util.*;

public final class RowStream implements Iterator<Row>, AutoCloseable {
    private final Connection conn;
    private final PreparedStatement ps;
    private final ResultSet rs;
    private boolean has;

    public RowStream(DataSource ds, String sql) throws SQLException {
        this.conn = ds.getConnection();
        conn.setAutoCommit(false);   // server-side cursor needs this
        this.ps = conn.prepareStatement(sql, ResultSet.TYPE_FORWARD_ONLY, ResultSet.CONCUR_READ_ONLY);
        ps.setFetchSize(1000);
        this.rs = ps.executeQuery();
        advance();
    }

    private void advance() throws SQLException { has = rs.next(); }

    public boolean hasNext() { return has; }

    public Row next() {
        try {
            if (!has) throw new NoSuchElementException();
            Row r = new Row(rs.getString("id"), rs.getInt("amount"));
            advance();
            return r;
        } catch (SQLException e) { throw new RuntimeException(e); }
    }

    public void close() throws Exception {
        rs.close(); ps.close(); conn.close();
    }
}

record Row(String id, int amount) {}
```

Use with `try-with-resources` to guarantee close.

---

## Task 7: Snapshot iterator

**Brief.** An iterator that snapshots the underlying list at construction; concurrent mods don't affect it.

### Solution (Java)

```java
import java.util.*;

public final class SnapshotIterator<T> implements Iterator<T> {
    private final Object[] snapshot;
    private int cursor = 0;

    public SnapshotIterator(List<T> source) {
        this.snapshot = source.toArray();   // copy
    }

    public boolean hasNext() { return cursor < snapshot.length; }

    @SuppressWarnings("unchecked")
    public T next() {
        if (!hasNext()) throw new NoSuchElementException();
        return (T) snapshot[cursor++];
    }
}
```

Construction copies; iteration over the copy. Insulates from mid-iteration mutation.

---

## Task 8: Custom Spliterator over a range

**Brief.** A Spliterator over `[lo, hi)` that supports `trySplit` for parallel streams.

### Solution (Java)

```java
import java.util.*;
import java.util.function.LongConsumer;

public final class RangeSpliterator implements Spliterator.OfLong {
    private long current;
    private final long fence;

    public RangeSpliterator(long lo, long hi) { this.current = lo; this.fence = hi; }

    public long estimateSize() { return fence - current; }

    public int characteristics() {
        return SIZED | SUBSIZED | ORDERED | DISTINCT | SORTED | NONNULL | IMMUTABLE;
    }

    public Comparator<? super Long> getComparator() { return null; }

    public boolean tryAdvance(LongConsumer action) {
        if (current >= fence) return false;
        action.accept(current++);
        return true;
    }

    public Spliterator.OfLong trySplit() {
        long mid = (current + fence) >>> 1;
        if (mid <= current) return null;
        long lo = current; current = mid;
        return new RangeSpliterator(lo, mid);
    }
}

class Demo {
    public static void main(String[] args) {
        long sum = java.util.stream.StreamSupport
            .longStream(new RangeSpliterator(1, 1_000_001), true)   // parallel
            .sum();
        System.out.println(sum);   // 500000500000
    }
}
```

Parallel-friendly; splits ranges; characteristics inform the framework.

---

## Task 9: Zipping two iterators

**Brief.** Zip two iterators into pairs; stops at the shorter one.

### Solution (Python)

```python
from typing import Iterator, Tuple


def zip_iters(a: Iterator, b: Iterator) -> Iterator[Tuple]:
    while True:
        try:
            x = next(a)
            y = next(b)
        except StopIteration:
            return
        yield (x, y)


# Usage:
nums = iter([1, 2, 3, 4])
letters = iter("abc")

for pair in zip_iters(nums, letters):
    print(pair)
# (1, 'a')
# (2, 'b')
# (3, 'c')
```

Builtin `zip` does this; this is the manual equivalent.

---

## Task 10: Resource-aware file lines iterator

**Brief.** Iterate file lines lazily; close on exhaustion or break.

### Solution (Java)

```java
import java.io.*;
import java.nio.file.*;
import java.util.*;

public final class FileLines implements Iterator<String>, AutoCloseable {
    private final BufferedReader reader;
    private String nextLine;

    public FileLines(Path path) throws IOException {
        this.reader = Files.newBufferedReader(path);
        advance();
    }

    private void advance() {
        try { nextLine = reader.readLine(); }
        catch (IOException e) { nextLine = null; }
    }

    public boolean hasNext() { return nextLine != null; }

    public String next() {
        if (nextLine == null) throw new NoSuchElementException();
        String r = nextLine;
        advance();
        return r;
    }

    public void close() throws IOException { reader.close(); }
}

class Demo {
    public static void main(String[] args) throws IOException {
        try (FileLines lines = new FileLines(Path.of("/etc/hosts"))) {
            while (lines.hasNext()) {
                System.out.println(lines.next());
            }
        }
    }
}
```

Resource freed via `AutoCloseable` + try-with-resources. Lazy file read.

---

## How to Practice

- **Build the tree iterators first.** Pre-order, in-order, level-order — all separate Iterators.
- **Implement an auto-paginator.** Real-world cursor pagination is the most useful production skill.
- **Write a generator chain.** Filter → map → take. Verify laziness with print statements.
- **Stream from a DB.** Set fetchSize; verify constant memory under load.
- **Implement a Spliterator.** Run with `parallelStream`; observe speedup on multi-core.
- **Read JDK source.** `ArrayList$Itr`, `HashMap$EntryIterator` — production-grade reference.

[← Interview](interview.md) · [Find Bug →](find-bug.md)
