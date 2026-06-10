# Object Pool — Find the Bug

> **Category:** [Object & State Patterns](../README.md) — the pattern's bugs cluster on the *return half*: leaks, missing resets, double-returns, and use-after-return.

12 buggy snippets across Go, Java, Python.

---

## Bug 1: No Reset on Return — Stale State Leaks (Java)

```java
void release(byte[] buf) {
    idle.offer(buf);   // BUG: previous borrower's bytes still in buf
}
```

**Symptoms:** The next borrower reads leftover data from the previous request — corruption, or one user's bytes in another user's response (info disclosure).

<details><summary>Find the bug</summary>

The object goes back to the pool carrying the last borrower's state. Reuse without reset leaks that state across the borrow boundary.

</details>

### Fix
```java
void release(byte[] buf) {
    Arrays.fill(buf, (byte) 0);   // RESET — wipe before reuse
    idle.offer(buf);
}
```

### Lesson
Reset on return is a correctness *and security* boundary, not housekeeping.

---

## Bug 2: Missing finally — Object Leaks on Exception (Python)

```python
obj = pool.borrow()
result = risky(obj)      # BUG: if this raises, obj never returns
pool.release(obj)
return result
```

**Symptoms:** Each error path permanently loses one object. The pool slowly drains until every borrow blocks and the service hangs — far from the buggy line.

<details><summary>Find the bug</summary>

No `try/finally`. An exception in `risky(obj)` skips `release`, leaking the object.

</details>

### Fix
```python
with pool.borrow() as obj:   # context manager returns in its finally
    return risky(obj)
```

### Lesson
Make return structural: context manager, `try-with-resources`, or `defer`.

---

## Bug 3: Use After Return (Go)

```go
o := pool.Get()
pool.Put(o)            // returned...
o.Field = compute()    // BUG: ...then used. Another goroutine may now own o.
```

**Symptoms:** Intermittent corruption: two goroutines mutate the same object because it was returned, then touched, then re-borrowed elsewhere.

<details><summary>Find the bug</summary>

After `Put`, the object is the pool's again and may be handed to another goroutine. Touching it is a use-after-return data race.

</details>

### Fix
```go
o := pool.Get()
defer pool.Put(o)      // return last, after all use
o.Field = compute()
```

### Lesson
An object is yours only between borrow and return. `defer` the return so it happens *after* the last use.

---

## Bug 4: Double Return (Java)

```java
T obj = pool.borrow();
process(obj);
pool.release(obj);
// ... later, on a cleanup path ...
pool.release(obj);   // BUG: returned twice
```

**Symptoms:** The same object sits in the idle set twice. Two borrowers receive it; they silently share and corrupt each other's state.

<details><summary>Find the bug</summary>

`release(obj)` runs twice. Nothing prevents the same object entering the pool more than once.

</details>

### Fix
```java
private final Set<T> leased = ConcurrentHashMap.newKeySet();
void release(T o) {
    if (!leased.remove(o))
        throw new IllegalStateException("double return / not leased");
    reset(o); idle.offer(o);
}
```

### Lesson
Track leased objects; reject any return that isn't currently leased.

---

## Bug 5: sync.Pool Used for Connections (Go)

```go
var connPool = sync.Pool{New: func() any { return dial() }}

func query() {
    c := connPool.Get().(*Conn)   // BUG: GC may have dropped pooled conns
    defer connPool.Put(c)
    c.Exec("SELECT 1")            // c could be a brand-new, or a leaked, connection
}
```

**Symptoms:** Connection count drifts unpredictably; connections leak (the GC drops pooled ones without closing the socket) and new ones are silently dialed.

<details><summary>Find the bug</summary>

`sync.Pool` is GC-flushable and unbounded — wrong for connections, which must persist, be capped, and be explicitly closed. A dropped pooled connection leaks its socket.

</details>

### Fix
```go
// Use database/sql, which is a real, bounded, validating connection pool:
db.SetMaxOpenConns(16)
rows, err := db.QueryContext(ctx, "SELECT 1")
```

### Lesson
`sync.Pool` is for ephemeral, reconstructible objects (buffers), never connections.

---

## Bug 6: Reset Failure Poisons the Pool (Python)

```python
def release(self, conn):
    conn.rollback()          # BUG: if conn is broken, this raises...
    self._idle.put(conn)     # ...and we never reach here — OR worse, we do and return a dead conn
```

**Symptoms:** A broken connection either escapes the pool entirely (leak) or, with a swallowed exception, gets returned dead and breaks the next borrower.

<details><summary>Find the bug</summary>

Reset (`rollback`) can fail on a broken connection. There's no path that destroys-and-replaces; the pool either leaks or poisons.

</details>

### Fix
```python
def release(self, conn):
    try:
        conn.rollback()
        self._idle.put(conn)
    except Exception:
        self._destroy(conn)           # don't return a poisoned object
        self._idle.put(self._create())
```

### Lesson
A failed reset must destroy the object and create a replacement — never return a poisoned one.

---

## Bug 7: Borrow Timeout Longer Than Request Deadline (Java)

```java
// request deadline: 2s
Connection c = pool.borrow(30, TimeUnit.SECONDS);   // BUG: 30s >> 2s
```

**Symptoms:** Under load, requests that already missed their 2s deadline keep occupying borrow slots for 30s, amplifying the backlog into a cascading stall.

<details><summary>Find the bug</summary>

The borrow timeout exceeds the upstream request deadline, so doomed requests hog the pool long after the client gave up.

</details>

### Fix
```java
long remaining = deadline - System.currentTimeMillis();
Connection c = pool.borrow(Math.max(0, remaining), TimeUnit.MILLISECONDS);
```

### Lesson
Borrow timeout must be shorter than the request deadline it serves.

---

## Bug 8: Unbounded "Pool" (Go)

```go
func (p *Pool) Borrow() *Obj {
    select {
    case o := <-p.idle:
        return o
    default:
        return p.create()   // BUG: always create on miss → unbounded
    }
}
```

**Symptoms:** Under load the pool creates without limit; "20 connections max" silently becomes thousands, and the backend collapses.

<details><summary>Find the bug</summary>

On an empty pool it always creates a new object. There's no cap and no backpressure — it's a leak dressed as a pool.

</details>

### Fix
```go
func (p *Pool) Borrow(ctx context.Context) (*Obj, error) {
    select {
    case o := <-p.idle:
        return o, nil
    case <-ctx.Done():       // bounded: wait, then fail — no unbounded growth
        return nil, ctx.Err()
    }
}
```

### Lesson
A pool without a hard ceiling isn't a pool. Bound it; block-with-timeout on exhaustion.

---

## Bug 9: Pooled Object Pins a Large Graph (Java)

```java
class Worker {
    byte[] lastPayload;          // 10 MB
    void reset() { /* BUG: doesn't null lastPayload */ }
}
```

**Symptoms:** Memory creeps up. Each pooled `Worker` keeps its last 10 MB payload alive forever because the reference is never cleared — a slow leak hidden inside a pool meant to *save* memory.

<details><summary>Find the bug</summary>

`reset()` doesn't null out the reference to a large object, so the long-lived pooled object pins the payload, defeating GC.

</details>

### Fix
```java
void reset() {
    this.lastPayload = null;     // release the reference so GC can reclaim it
}
```

### Lesson
Reset must clear references to large objects, or the pool becomes a memory leak.

---

## Bug 10: Validation Race — Dead Connection Handed Out (Python)

```python
def borrow(self):
    conn = self._idle.get()
    return conn               # BUG: never checks the conn is still alive
```

**Symptoms:** A connection killed by the DB's idle timeout (or a failover) is handed out; the first query fails with "connection closed."

<details><summary>Find the bug</summary>

No validate-on-borrow. Idle connections can die server-side; the pool must check liveness before lending.

</details>

### Fix
```python
def borrow(self):
    conn = self._idle.get()
    if not self._is_alive(conn):     # e.g. cheap ping / pre_ping
        self._destroy(conn)
        conn = self._create()
    return conn
```

### Lesson
Pooled resources rot while idle; validate on borrow (or evict in the background).

---

## Bug 11: Single Lock Serializes the Whole Pool (Java)

```java
public synchronized T borrow() { ... }    // BUG: every borrow contends one lock
public synchronized void release(T o) { ... }
```

**Symptoms:** Throughput plateaus and CPU shows threads parked on the pool's monitor — the pool, meant to relieve a bottleneck, *is* the bottleneck under high concurrency.

<details><summary>Find the bug</summary>

A single `synchronized` serializes all borrows and returns. With many cores hammering it, the lock is the contention point.

</details>

### Fix
```java
// Use a concurrent structure (e.g. a fair BlockingQueue), or a sharded /
// thread-local design like HikariCP's ConcurrentBag, so borrows don't all
// contend one monitor.
private final BlockingQueue<T> idle = new ArrayBlockingQueue<>(size, true);
```

### Lesson
The pool's own synchronization must scale; a global lock recreates the bottleneck.

---

## Bug 12: Capacity Counted Wrong Under Concurrency (Go)

```go
func (p *Pool) Borrow() *Obj {
    if p.count < p.max {     // BUG: check-then-act race
        p.count++            // two goroutines both see count<max and both ++
        return p.create()
    }
    return <-p.idle
}
```

**Symptoms:** The pool occasionally exceeds `max` — two goroutines pass the `count < max` check simultaneously and both create, so the cap is breached under load.

<details><summary>Find the bug</summary>

`count < max` then `count++` is a check-then-act race. Without atomicity, concurrent borrows overshoot the limit.

</details>

### Fix
```go
// Use a buffered channel as the bound — capacity is enforced atomically:
type Pool struct{ idle chan *Obj }   // make(chan *Obj, max)
func (p *Pool) Borrow(ctx context.Context) (*Obj, error) {
    select {
    case o := <-p.idle: return o, nil
    case <-ctx.Done():  return nil, ctx.Err()
    }
}
```

### Lesson
Enforce the bound with an atomic primitive (a buffered channel / semaphore), not a racy counter.

---

## Practice Tips

1. **Run `go test -race`** on any hand-rolled Go pool — most pool bugs are races.
2. **Test the exception path:** assert the object returns to the pool when the use block throws.
3. **Test reset explicitly:** borrow, dirty the object, return, borrow again, assert it's clean.
4. **Test the cap under concurrency:** spawn `max+N` borrowers and assert the pool never exceeds `max`.
5. **Prefer HikariCP / `database/sql`** over a hand-roll — they've already fixed bugs 1–12.

---

[← Tasks](tasks.md) · [Object & State](../README.md) · [Coding Patterns](../../README.md) · **Next:** [Optimize](optimize.md)
