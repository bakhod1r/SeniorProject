# Object Pool — Practice Tasks

> **Category:** [Object & State Patterns](../README.md) — borrow/use/reset/return a bounded set of expensive objects, exercised in Go, Java, and Python.

10 practice tasks with full Go, Java, Python solutions.

---

## Table of Contents

1. [Task 1: Minimal Bounded Pool](#task-1-minimal-bounded-pool)
2. [Task 2: Reset on Return](#task-2-reset-on-return)
3. [Task 3: Borrow With Timeout](#task-3-borrow-with-timeout)
4. [Task 4: Validate on Borrow](#task-4-validate-on-borrow)
5. [Task 5: Guaranteed Return Wrapper](#task-5-guaranteed-return-wrapper)
6. [Task 6: Leak Detection](#task-6-leak-detection)
7. [Task 7: Double-Return Guard](#task-7-double-return-guard)
8. [Task 8: sync.Pool for Buffers](#task-8-syncpool-for-buffers)
9. [Task 9: Game Object Pool](#task-9-game-object-pool)
10. [Task 10: Size a Connection Pool](#task-10-size-a-connection-pool)

---

## Task 1: Minimal Bounded Pool

Build a fixed-capacity pool pre-filled with objects.

### Java
```java
public final class SimplePool<T> {
    private final ArrayDeque<T> idle = new ArrayDeque<>();
    SimplePool(int n, Supplier<T> factory) {
        for (int i = 0; i < n; i++) idle.push(factory.get());
    }
    synchronized T borrow() {
        if (idle.isEmpty()) throw new IllegalStateException("exhausted");
        return idle.pop();
    }
    synchronized void release(T obj) { idle.push(obj); }
}
```

### Python
```python
class SimplePool:
    def __init__(self, n, factory):
        self._idle = [factory() for _ in range(n)]
    def borrow(self):
        if not self._idle: raise RuntimeError("exhausted")
        return self._idle.pop()
    def release(self, obj):
        self._idle.append(obj)
```

### Go
```go
type SimplePool struct{ idle chan *Obj }
func NewSimplePool(n int, mk func() *Obj) *SimplePool {
    p := &SimplePool{idle: make(chan *Obj, n)}
    for i := 0; i < n; i++ { p.idle <- mk() }
    return p
}
func (p *SimplePool) Borrow() (*Obj, bool) { o, ok := <-p.idle; return o, ok }
func (p *SimplePool) Release(o *Obj)        { p.idle <- o }
```

---

## Task 2: Reset on Return

Wipe state so no data leaks between borrowers.

### Java
```java
synchronized void release(byte[] buf) {
    Arrays.fill(buf, (byte) 0);   // RESET before reuse
    idle.push(buf);
}
```

### Python
```python
def release(self, conn):
    conn.rollback()    # abort any half-done transaction
    conn.autocommit = True
    self._idle.append(conn)
```

### Go
```go
func (p *BufPool) Release(b *bytes.Buffer) {
    b.Reset()          // clears contents, keeps capacity
    p.idle <- b
}
```

---

## Task 3: Borrow With Timeout

Block for at most `T`, then signal exhaustion.

### Java
```java
private final BlockingQueue<T> idle = new ArrayBlockingQueue<>(8);
T borrow(long t, TimeUnit u) throws InterruptedException {
    T obj = idle.poll(t, u);
    if (obj == null) throw new TimeoutException("pool exhausted");
    return obj;
}
```

### Python
```python
import queue
def borrow(self, timeout=1.0):
    try:
        return self._idle.get(timeout=timeout)
    except queue.Empty:
        raise TimeoutError("pool exhausted")
```

### Go
```go
func (p *Pool) Borrow(ctx context.Context) (*Obj, error) {
    select {
    case o := <-p.idle:
        return o, nil
    case <-ctx.Done():        // deadline = borrow timeout
        return nil, ctx.Err()
    }
}
```

---

## Task 4: Validate on Borrow

Discard and replace objects that died while idle.

### Java
```java
T borrow(long t, TimeUnit u) throws InterruptedException {
    T obj = idle.poll(t, u);
    if (obj == null) throw new TimeoutException("exhausted");
    if (!validate(obj)) { destroy(obj); obj = create(); }  // repair, never poison
    return obj;
}
```

### Python
```python
def borrow(self, timeout=1.0):
    obj = self._idle.get(timeout=timeout)
    if not self._validate(obj):
        self._destroy(obj)
        obj = self._create()
    return obj
```

### Go
```go
func (p *Pool) Borrow() *Conn {
    c := <-p.idle
    if c.Ping() != nil {      // died while idle?
        c.Close()
        c = p.dial()
    }
    return c
}
```

---

## Task 5: Guaranteed Return Wrapper

Make returning impossible to forget.

### Java
```java
<R> R withResource(Function<T, R> work) {
    T obj = borrow();
    try { return work.apply(obj); }
    finally { release(obj); }   // runs even on exception
}
// usage
String r = pool.withResource(buf -> process(buf));
```

### Python
```python
@contextmanager
def borrow(self, timeout=1.0):
    obj = self._idle.get(timeout=timeout)
    try:
        yield obj
    finally:
        obj.reset()
        self._idle.put(obj)
# usage
with pool.borrow() as obj:
    process(obj)
```

### Go
```go
func (p *Pool) Use(fn func(*Obj)) {
    o := <-p.idle
    defer func() { o.Reset(); p.idle <- o }()
    fn(o)
}
```

---

## Task 6: Leak Detection

Flag objects held longer than a threshold.

### Java
```java
private final Map<T, Long> leasedAt = new ConcurrentHashMap<>();
T borrow() { T o = idle.poll(); leasedAt.put(o, System.nanoTime()); return o; }
void release(T o) { leasedAt.remove(o); reset(o); idle.offer(o); }

void scanForLeaks(long maxMillis) {
    long now = System.nanoTime();
    leasedAt.forEach((o, since) -> {
        if (NANOSECONDS.toMillis(now - since) > maxMillis)
            log.warn("leak: object held > {} ms", maxMillis);
    });
}
```

### Python
```python
def scan_for_leaks(self, max_seconds):
    now = time.monotonic()
    for obj, since in list(self._leased.items()):
        if now - since > max_seconds:
            log.warning("leak: object held > %ss", max_seconds)
```

### Go
```go
func (p *Pool) scanLeaks(max time.Duration) {
    p.mu.Lock(); defer p.mu.Unlock()
    now := time.Now()
    for o, since := range p.leasedAt {
        if now.Sub(since) > max {
            log.Printf("leak: object held > %v", max)
        }
    }
}
```

---

## Task 7: Double-Return Guard

Reject returning an object that wasn't leased.

### Java
```java
private final Set<T> leased = ConcurrentHashMap.newKeySet();
T borrow() { T o = idle.poll(); leased.add(o); return o; }
void release(T o) {
    if (!leased.remove(o))
        throw new IllegalStateException("double return / not leased");
    reset(o); idle.offer(o);
}
```

### Python
```python
def release(self, obj):
    if obj not in self._leased:
        raise RuntimeError("double return / not leased")
    self._leased.discard(obj)
    obj.reset()
    self._idle.put(obj)
```

### Go
```go
func (p *Pool) Release(o *Obj) error {
    p.mu.Lock(); defer p.mu.Unlock()
    if _, ok := p.leased[o]; !ok {
        return errors.New("double return / not leased")
    }
    delete(p.leased, o)
    o.Reset()
    p.idle <- o
    return nil
}
```

---

## Task 8: sync.Pool for Buffers

Idiomatic Go buffer reuse on a hot path.

### Go
```go
var bufPool = sync.Pool{
    New: func() any { return make([]byte, 0, 32*1024) },
}

func render(w io.Writer, data []byte) error {
    buf := bufPool.Get().([]byte)[:0]   // reuse capacity, length 0
    defer bufPool.Put(buf[:0])          // return cleared
    buf = append(buf, data...)
    buf = append(buf, '\n')
    _, err := w.Write(buf)
    return err
}
```

> No Java/Python equivalent of `sync.Pool` semantics — in Java use a bounded pool or rely on the allocator; in Python, `queue.Queue`. `sync.Pool` is unique in being GC-flushable.

---

## Task 9: Game Object Pool

Recycle bullets to avoid mid-frame GC pauses.

### Python
```python
class BulletPool:
    def __init__(self, n):
        self._idle = [Bullet() for _ in range(n)]
        self._active = []
    def spawn(self, x, y, vx, vy):
        if not self._idle: return None      # cap reached — drop spawn
        b = self._idle.pop()
        b.reset(x, y, vx, vy)               # reset to fresh state
        self._active.append(b)
        return b
    def despawn(self, b):
        self._active.remove(b)
        self._idle.append(b)                # return for reuse
```

### Java
```java
final ArrayDeque<Bullet> idle = new ArrayDeque<>();
final List<Bullet> active = new ArrayList<>();
Bullet spawn(float x, float y, float vx, float vy) {
    Bullet b = idle.isEmpty() ? null : idle.pop();
    if (b == null) return null;             // bounded: skip spawn
    b.reset(x, y, vx, vy);
    active.add(b);
    return b;
}
void despawn(Bullet b) { active.remove(b); idle.push(b); }
```

---

## Task 10: Size a Connection Pool

Apply the formula and the global-budget constraint.

### Java (HikariCP)
```java
HikariConfig cfg = new HikariConfig();
// ((cores * 2) + spindles) ≈ small. 8 cores, SSD → ~17, round to 16.
cfg.setMaximumPoolSize(16);
cfg.setMinimumIdle(16);               // fixed-size: no churn
cfg.setConnectionTimeout(2_000);      // borrow blocks at most 2s
cfg.setMaxLifetime(1_500_000);        // 25 min < DB idle timeout
cfg.setLeakDetectionThreshold(20_000);
// Reconcile: 20 pods × 16 = 320  ≤  db.max_connections (e.g. 400)
```

### Go
```go
db.SetMaxOpenConns(16)
db.SetMaxIdleConns(16)
db.SetConnMaxLifetime(25 * time.Minute)
db.SetConnMaxIdleTime(5 * time.Minute)
// Verify: replicas × 16 ≤ max_connections, else front with PgBouncer.
```

### Python (psycopg / SQLAlchemy)
```python
engine = create_engine(
    dsn,
    pool_size=16,            # fixed working set
    max_overflow=0,          # hard cap — no growth past pool_size
    pool_timeout=2,          # borrow timeout (seconds)
    pool_recycle=1500,       # 25 min
    pool_pre_ping=True,      # validate-on-borrow
)
```

---

## Practice Tips

1. **Always reset on return** — zero buffers, roll back transactions, clear references.
2. **Always make return automatic** — `try/finally`, `defer`, context manager.
3. **Bound it and reconcile** the bound against the backend's global limit.
4. **Validate-on-borrow** for resources that die while idle (connections, sockets).
5. **Add leak + double-return guards** before shipping a hand-rolled pool — or use HikariCP / `database/sql` and skip the hand-roll.

---

[← Interview](interview.md) · [Object & State](../README.md) · [Coding Patterns](../../README.md) · **Next:** [Find-Bug](find-bug.md)
