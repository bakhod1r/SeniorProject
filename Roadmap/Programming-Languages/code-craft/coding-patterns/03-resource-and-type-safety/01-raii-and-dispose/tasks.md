# RAII & Dispose — Practice Tasks

> **Category:** [Resource & Type-Safety Patterns](../README.md) — hands-on drills for deterministic cleanup in Go, Java, and Python.

10 practice tasks with full Go, Java, and Python solutions.

---

## Table of Contents

1. [Task 1: Safe File Read on Every Path](#task-1-safe-file-read-on-every-path)
2. [Task 2: Scope-Bound Lock Guard](#task-2-scope-bound-lock-guard)
3. [Task 3: Transaction — Commit or Rollback](#task-3-transaction-commit-or-rollback)
4. [Task 4: Custom Context Manager / AutoCloseable](#task-4-custom-context-manager-autocloseable)
5. [Task 5: Fix `defer` Inside a Loop](#task-5-fix-defer-inside-a-loop)
6. [Task 6: Idempotent Close + Use-After-Close Guard](#task-6-idempotent-close-use-after-close-guard)
7. [Task 7: Multiple Resources, LIFO Cleanup](#task-7-multiple-resources-lifo-cleanup)
8. [Task 8: Dispose Pattern with Finalizer Backstop](#task-8-dispose-pattern-with-finalizer-backstop)
9. [Task 9: Pool Lease (close == return)](#task-9-pool-lease-close--return)
10. [Task 10: Surface a Close/Flush Error on Writes](#task-10-surface-a-closeflush-error-on-writes)

---

## Task 1: Safe File Read on Every Path

**Goal:** Read a file and parse it; the handle must close even if parsing throws or you return early.

### Python

```python
def read_config(path: str) -> dict:
    with open(path) as f:          # closed on any exit
        raw = f.read()
    return parse(raw)              # parse outside the hold — minimal scope
```

### Go

```go
func readConfig(path string) (Config, error) {
    f, err := os.Open(path)
    if err != nil {
        return Config{}, err
    }
    defer f.Close()                // runs on every return below
    raw, err := io.ReadAll(f)
    if err != nil {
        return Config{}, err
    }
    return parse(raw)
}
```

### Java

```java
String readConfig(String path) throws IOException {
    try (var r = new BufferedReader(new FileReader(path))) {
        return r.lines().collect(Collectors.joining("\n"));
    }   // r.close() always runs
}
```

---

## Task 2: Scope-Bound Lock Guard

**Goal:** A function that mutates shared state under a lock and never leaves the lock held on error.

### Python

```python
def transfer(lock, a, b, amount):
    with lock:                              # released even if the check raises
        if a.balance < amount:
            raise InsufficientFunds()
        a.balance -= amount
        b.balance += amount
```

### Go

```go
func Transfer(mu *sync.Mutex, a, b *Account, amount int) error {
    mu.Lock()
    defer mu.Unlock()                       // unlocked on every return
    if a.Balance < amount {
        return ErrInsufficient
    }
    a.Balance -= amount
    b.Balance += amount
    return nil
}
```

### Java

```java
void transfer(Lock lock, Account a, Account b, int amount) {
    lock.lock();
    try {
        if (a.balance() < amount) throw new InsufficientFundsException();
        a.debit(amount); b.credit(amount);
    } finally {
        lock.unlock();                      // always unlocks
    }
}
```

---

## Task 3: Transaction — Commit or Rollback

**Goal:** Commit on success, roll back on any exception, always close.

### Python

```python
from contextlib import contextmanager

@contextmanager
def transaction(db):
    tx = db.begin()
    try:
        yield tx
        tx.commit()
    except Exception:
        tx.rollback()
        raise
    finally:
        tx.close()

with transaction(db) as tx:
    tx.execute("UPDATE accounts SET balance = balance - 100 WHERE id = 1")
    tx.execute("UPDATE accounts SET balance = balance + 100 WHERE id = 2")
```

### Go

```go
func WithTx(db *sql.DB, fn func(*sql.Tx) error) (err error) {
    tx, err := db.Begin()
    if err != nil {
        return err
    }
    defer func() {
        if p := recover(); p != nil {
            tx.Rollback()
            panic(p)
        } else if err != nil {
            tx.Rollback()
        } else {
            err = tx.Commit()
        }
    }()
    return fn(tx)
}
```

### Java

```java
void withTx(DataSource ds, Consumer<Connection> work) throws SQLException {
    try (Connection c = ds.getConnection()) {
        c.setAutoCommit(false);
        try {
            work.accept(c);
            c.commit();
        } catch (RuntimeException e) {
            c.rollback();
            throw e;
        }
    }   // connection closed regardless
}
```

---

## Task 4: Custom Context Manager / AutoCloseable

**Goal:** Wrap a non-RAII resource so callers get scope-bound cleanup.

### Python

```python
class Socket:
    def __init__(self, host): self._host = host
    def __enter__(self):
        self._conn = raw_connect(self._host)
        return self._conn
    def __exit__(self, exc_type, exc, tb):
        self._conn.close()
        return False                 # never swallow exceptions

with Socket("example.com:80") as conn:
    conn.send(b"GET / HTTP/1.0\r\n\r\n")
```

### Java

```java
public final class Socket implements AutoCloseable {
    private final RawConn conn;
    public Socket(String host) { this.conn = RawConn.connect(host); }
    public void send(byte[] b) { conn.write(b); }
    @Override public void close() { conn.shutdown(); }
}

try (Socket s = new Socket("example.com:80")) {
    s.send(request);
}
```

### Go

```go
// Go's idiom is a Close() method + defer at the call site
type Socket struct{ conn net.Conn }

func Dial(host string) (*Socket, error) {
    c, err := net.Dial("tcp", host)
    return &Socket{conn: c}, err
}
func (s *Socket) Close() error { return s.conn.Close() }

// caller:
s, _ := Dial("example.com:80")
defer s.Close()
```

---

## Task 5: Fix `defer` Inside a Loop

**Goal:** Process many files without holding all of them open at once.

### Go (the fix)

```go
// ❌ Broken: all files held open until the function returns
// for _, p := range paths { f, _ := os.Open(p); defer f.Close(); use(f) }

// ✅ Fixed: each iteration is its own scope
func processAll(paths []string) error {
    for _, p := range paths {
        if err := processOne(p); err != nil {
            return err
        }
    }
    return nil
}
func processOne(p string) error {
    f, err := os.Open(p)
    if err != nil {
        return err
    }
    defer f.Close()                  // closed at end of THIS call
    return use(f)
}
```

### Python (already correct)

```python
for p in paths:
    with open(p) as f:               # closed each iteration
        use(f)
```

### Java (already correct)

```java
for (String p : paths) {
    try (var f = new FileReader(p)) {   // closed each iteration
        use(f);
    }
}
```

---

## Task 6: Idempotent Close + Use-After-Close Guard

**Goal:** Calling `close()` twice is safe; using after close fails fast.

### Java

```java
public final class Handle implements AutoCloseable {
    private final Resource res;
    private boolean closed = false;
    public Handle() { this.res = Resource.acquire(); }
    public void use() {
        if (closed) throw new IllegalStateException("handle is closed");
        res.doWork();
    }
    @Override public void close() {
        if (closed) return;          // idempotent
        closed = true;
        res.release();
    }
}
```

### Python

```python
class Handle:
    def __init__(self): self._res = acquire(); self._closed = False
    def use(self):
        if self._closed: raise RuntimeError("handle is closed")
        self._res.do_work()
    def close(self):
        if self._closed: return       # idempotent
        self._closed = True
        self._res.release()
    def __enter__(self): return self
    def __exit__(self, *exc): self.close(); return False
```

### Go

```go
type Handle struct {
    res    *Resource
    closed bool
}
func (h *Handle) Use() error {
    if h.closed { return errors.New("handle is closed") }
    return h.res.DoWork()
}
func (h *Handle) Close() error {
    if h.closed { return nil }        // idempotent
    h.closed = true
    return h.res.Release()
}
```

---

## Task 7: Multiple Resources, LIFO Cleanup

**Goal:** Open three dependent resources; close them in reverse order; partial failures still clean up.

### Python (ExitStack)

```python
from contextlib import ExitStack

def pipeline(src_path, dst_path):
    with ExitStack() as stack:
        src = stack.enter_context(open(src_path))
        dst = stack.enter_context(open(dst_path, "w"))
        tx  = stack.enter_context(transaction(db))
        dst.write(transform(src.read()))
        tx.execute("INSERT INTO log VALUES ('done')")
    # closed LIFO: tx, dst, src — even if a later enter_context raised
```

### Java (try-with-resources, declared in dependency order)

```java
try (Connection conn = pool.get();
     PreparedStatement ps = conn.prepareStatement(SQL);
     ResultSet rs = ps.executeQuery()) {
    while (rs.next()) consume(rs);
}   // rs, then ps, then conn — reverse order
```

### Go (LIFO multi-closer)

```go
type closers []io.Closer
func (cs closers) Close() error {
    var err error
    for i := len(cs) - 1; i >= 0; i-- {     // LIFO
        if e := cs[i].Close(); e != nil && err == nil {
            err = e                          // keep closing, keep first error
        }
    }
    return err
}
```

---

## Task 8: Dispose Pattern with Finalizer Backstop

**Goal:** Deterministic disposal plus a GC-time safety net that *logs* the leak.

### Python (weakref.finalize — no `self` capture)

```python
import weakref, logging

class NativeBuffer:
    def __init__(self, size):
        self._handle = c_alloc(size)
        self._fin = weakref.finalize(self, NativeBuffer._release, self._handle)
    @staticmethod
    def _release(handle, *, _leaked=False):
        c_free(handle)
        if _leaked:
            logging.warning("NativeBuffer not closed()!")
    def close(self):
        self._fin()                  # deterministic; cancels the backstop
    def __enter__(self): return self
    def __exit__(self, *exc): self.close(); return False
```

### Java (Cleaner — static state class)

```java
public final class NativeBuffer implements AutoCloseable {
    private static final Cleaner CLEANER = Cleaner.create();
    private final Cleaner.Cleanable cleanable;
    private static final class State implements Runnable {
        final long handle;
        State(long h) { this.handle = h; }
        public void run() { free(handle); }       // backstop
    }
    public NativeBuffer(int size) {
        long h = alloc(size);
        this.cleanable = CLEANER.register(this, new State(h));
    }
    @Override public void close() { cleanable.clean(); }  // deterministic, once
}
```

### C# (canonical Dispose pattern, for reference)

```csharp
public sealed class NativeBuffer : IDisposable {
    private IntPtr handle; private bool disposed;
    public NativeBuffer(int size) => handle = Alloc(size);
    public void Dispose() { Dispose(true); GC.SuppressFinalize(this); }
    private void Dispose(bool disposing) {
        if (disposed) return;
        Free(handle); disposed = true;
    }
    ~NativeBuffer() => Dispose(false);   // backstop
}
```

---

## Task 9: Pool Lease (close == return)

**Goal:** Hand out a pooled resource with RAII ergonomics; close returns it to the pool.

### Python

```python
from contextlib import contextmanager

@contextmanager
def lease(pool):
    conn = pool.acquire()
    try:
        yield conn
    finally:
        pool.release(conn)           # "close" == return to pool

with lease(pool) as conn:
    conn.execute("SELECT 1")
```

### Java

```java
public final class Lease implements AutoCloseable {
    private final Pool pool; private final Conn conn; private boolean closed;
    public Lease(Pool pool) { this.pool = pool; this.conn = pool.acquire(); }
    public Conn get() { return conn; }
    @Override public void close() {
        if (closed) return;
        closed = true;
        pool.release(conn);          // returns, does not destroy
    }
}
```

### Go

```go
type Lease struct{ pool *Pool; conn *Conn }
func (p *Pool) Lease() *Lease { return &Lease{pool: p, conn: p.acquire()} }
func (l *Lease) Close() error { l.pool.release(l.conn); return nil }

// caller:
l := pool.Lease()
defer l.Close()                      // returns conn to pool
```

---

## Task 10: Surface a Close/Flush Error on Writes

**Goal:** For writable files, don't silently drop a flush/close error.

### Go (named return captures close error)

```go
func writeReport(path string, data []byte) (err error) {
    f, err := os.Create(path)
    if err != nil {
        return err
    }
    defer func() {
        if cerr := f.Close(); cerr != nil && err == nil {
            err = cerr               // a flush failure becomes the result
        }
    }()
    _, err = f.Write(data)
    return err
}
```

### Java (try-with-resources surfaces close failure)

```java
void writeReport(String path, byte[] data) throws IOException {
    try (var out = new BufferedOutputStream(new FileOutputStream(path))) {
        out.write(data);
    }   // close()/flush() failure propagates (or is suppressed onto a body error)
}
```

### Python (`with` propagates close failure)

```python
def write_report(path, data):
    with open(path, "wb") as f:
        f.write(data)
    # f.close() on exit; an OSError from flush propagates out of the with-block
```

---

## Practice Tips

1. **Audit every error/early-return path** for a missed `close`.
2. **Never `defer` inside a loop** — extract a per-iteration function.
3. **Make `close()` idempotent**, and guard use-after-close.
4. **`defer Close()` only after a successful acquire.**
5. **For writes, surface the close/flush error** — it can mean lost data.
6. **Use `ExitStack`/LIFO closers** for a dynamic number of resources.

---

[← Interview](interview.md) · [Resource & Type-Safety](../README.md) · [Roadmap](../../../../README.md) · **Next:** [Find-Bug](find-bug.md)
