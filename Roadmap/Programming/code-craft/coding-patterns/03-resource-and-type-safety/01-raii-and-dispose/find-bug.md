# RAII & Dispose — Find the Bug

> **Category:** [Resource & Type-Safety Patterns](../README.md) — 12 buggy snippets across Go, Java, and Python where cleanup goes wrong.

12 buggy snippets across Go, Java, and Python.

---

## Bug 1: Close Only on the Success Path (Go)

```go
func read(path string) ([]byte, error) {
    f, err := os.Open(path)
    if err != nil {
        return nil, err
    }
    data, err := io.ReadAll(f)
    if err != nil {
        return nil, err          // BUG: f leaked here
    }
    f.Close()
    return data, nil
}
```

**Symptoms:** Under read errors, file descriptors leak until the process exhausts them.

<details><summary>Find the bug</summary>

`f.Close()` runs only on the happy path. The error return between open and close skips it.

</details>

### Fix

```go
f, err := os.Open(path)
if err != nil { return nil, err }
defer f.Close()                  // every path closes
return io.ReadAll(f)
```

### Lesson

Bind release to the scope with `defer`, immediately after a successful acquire.

---

## Bug 2: `defer` Inside a Loop (Go)

```go
func processAll(paths []string) error {
    for _, p := range paths {
        f, err := os.Open(p)
        if err != nil { return err }
        defer f.Close()          // BUG: deferred to FUNCTION end
        process(f)
    }
    return nil
}
```

**Symptoms:** All files stay open until `processAll` returns. With many paths, "too many open files".

<details><summary>Find the bug</summary>

`defer` runs at function return, not per iteration. Every opened file accumulates.

</details>

### Fix

```go
for _, p := range paths {
    if err := func() error {
        f, err := os.Open(p)
        if err != nil { return err }
        defer f.Close()          // end of THIS iteration
        return process(f)
    }(); err != nil {
        return err
    }
}
```

### Lesson

Give each iteration its own scope (a helper function) so `defer` fires per iteration.

---

## Bug 3: Relying on `__del__` for Cleanup (Python)

```python
class Logger:
    def __init__(self, path):
        self.f = open(path, "a")
    def __del__(self):
        self.f.close()           # BUG: may never run
    def write(self, line):
        self.f.write(line + "\n")
```

**Symptoms:** Logs not flushed; FDs leak; under reference cycles or `os._exit`, `__del__` never runs.

<details><summary>Find the bug</summary>

`__del__` runs at GC time, which is non-deterministic and skippable. It is not cleanup.

</details>

### Fix

```python
class Logger:
    def __init__(self, path): self.f = open(path, "a")
    def write(self, line): self.f.write(line + "\n")
    def close(self): self.f.close()
    def __enter__(self): return self
    def __exit__(self, *exc): self.close(); return False

with Logger("app.log") as log:
    log.write("started")
```

### Lesson

Finalizers are a backstop, never primary cleanup. Use `with`/`close`.

---

## Bug 4: `defer Close()` Before Checking the Error (Go)

```go
f, err := os.Open(path)
defer f.Close()                  // BUG: f may be nil if err != nil
if err != nil {
    return err
}
```

**Symptoms:** `nil pointer dereference` panic when `os.Open` fails.

<details><summary>Find the bug</summary>

`defer f.Close()` is registered before the error check; on failure `f` is nil and `Close()` panics.

</details>

### Fix

```go
f, err := os.Open(path)
if err != nil {
    return err
}
defer f.Close()                  // only after a successful open
```

### Lesson

Acquire, check the error, *then* defer the release.

---

## Bug 5: `__exit__` Swallows the Exception (Python)

```python
class Tx:
    def __enter__(self): self.tx = db.begin(); return self.tx
    def __exit__(self, exc_type, exc, tb):
        self.tx.close()
        return True              # BUG: swallows every exception
```

**Symptoms:** Errors inside the `with` block vanish silently; the transaction is "successful" but the body failed.

<details><summary>Find the bug</summary>

Returning `True` from `__exit__` suppresses the body's exception. Callers never learn the operation failed.

</details>

### Fix

```python
def __exit__(self, exc_type, exc, tb):
    if exc_type is None:
        self.tx.commit()
    else:
        self.tx.rollback()
    self.tx.close()
    return False                 # let the exception propagate
```

### Lesson

`__exit__` should return falsy unless suppression is genuinely intended.

---

## Bug 6: Double Close Crashes (Java)

```java
public void close() {
    pool.release(conn);          // BUG: not idempotent
}

// somewhere
lease.close();
// ... later, a finally also calls:
lease.close();                   // releases the same conn twice → pool corruption
```

**Symptoms:** Connection returned to pool twice; another caller gets a conn that's also held elsewhere.

<details><summary>Find the bug</summary>

`close()` has no guard. A second call releases the same resource again.

</details>

### Fix

```java
private boolean closed = false;
public void close() {
    if (closed) return;          // idempotent
    closed = true;
    pool.release(conn);
}
```

### Lesson

Make `close()`/`Dispose()` idempotent; double-close must be harmless.

---

## Bug 7: Dropping the Close Error on a Write (Go)

```go
func save(path string, data []byte) error {
    f, err := os.Create(path)
    if err != nil { return err }
    defer f.Close()              // BUG: a flush error in Close() is discarded
    _, err = f.Write(data)
    return err
}
```

**Symptoms:** `Write` returns nil but the buffered flush during `Close()` fails — data silently lost; function reports success.

<details><summary>Find the bug</summary>

For writable files the final flush happens in `Close()`. A bare `defer f.Close()` throws that error away.

</details>

### Fix

```go
func save(path string, data []byte) (err error) {
    f, err := os.Create(path)
    if err != nil { return err }
    defer func() {
        if cerr := f.Close(); cerr != nil && err == nil { err = cerr }
    }()
    _, err = f.Write(data)
    return err
}
```

### Lesson

On writes, capture and surface the `Close()`/flush error.

---

## Bug 8: Lock Not Released on Early Return (Java)

```java
void update(Account a, int amount) {
    lock.lock();
    if (amount <= 0) return;     // BUG: returns while holding the lock → deadlock
    a.credit(amount);
    lock.unlock();
}
```

**Symptoms:** After one bad call, every future caller blocks forever.

<details><summary>Find the bug</summary>

The early `return` skips `lock.unlock()`. The lock is held permanently.

</details>

### Fix

```java
void update(Account a, int amount) {
    lock.lock();
    try {
        if (amount <= 0) return;
        a.credit(amount);
    } finally {
        lock.unlock();           // always
    }
}
```

### Lesson

A lock must be released in a scope-bound way (try/finally or a lock guard), never on a single path.

---

## Bug 9: Cleaner Action Captures `this` (Java)

```java
public final class Buffer implements AutoCloseable {
    private static final Cleaner CLEANER = Cleaner.create();
    private final long handle;
    public Buffer() {
        this.handle = alloc();
        CLEANER.register(this, () -> free(this.handle));  // BUG: lambda captures `this`
    }
}
```

**Symptoms:** The Cleaner never fires; `free` is never called; native memory leaks.

<details><summary>Find the bug</summary>

The lambda captures `this`, so the registered action keeps the `Buffer` reachable forever — it never becomes collectable, so the Cleaner never runs.

</details>

### Fix

```java
private static final class State implements Runnable {
    final long handle;
    State(long h) { this.handle = h; }
    public void run() { free(handle); }      // holds only the handle
}
public Buffer() {
    long h = alloc();
    CLEANER.register(this, new State(h));    // no `this` capture
}
```

### Lesson

A finalizer/Cleaner action must not reference the object it cleans up.

---

## Bug 10: Use-After-Close (Python)

```python
def read_twice(path):
    with open(path) as f:
        first = f.read()
    second = f.read()            # BUG: f is closed here
    return first, second
```

**Symptoms:** `ValueError: I/O operation on closed file`.

<details><summary>Find the bug</summary>

`f` is closed when the `with` block ends. The second `f.read()` touches a closed file.

</details>

### Fix

```python
def read_twice(path):
    with open(path) as f:
        return f.read(), f.read()   # both reads inside the scope
```

### Lesson

Don't use a resource after its scope has closed it. Keep all use inside the `with`.

---

## Bug 11: Ownership Transfer Closed by the Wrong Scope (Go)

```go
func openDB() *sql.DB {
    db, _ := sql.Open("postgres", dsn)
    defer db.Close()             // BUG: closes the DB before returning it
    return db
}
```

**Symptoms:** The returned `*sql.DB` is already closed; every query fails with "database is closed".

<details><summary>Find the bug</summary>

The function *transfers ownership* by returning `db`, but its `defer` closes it at return — so the caller receives a dead handle.

</details>

### Fix

```go
func openDB() (*sql.DB, error) {
    return sql.Open("postgres", dsn)   // caller owns it and closes it
}

// caller:
db, _ := openDB()
defer db.Close()
```

### Lesson

A function that returns a resource transfers ownership and must not close it. The owner's scope closes it.

---

## Bug 12: One `finally` Closing Two Resources (Java)

```java
InputStream in = open(a);
OutputStream out = open(b);
try {
    copy(in, out);
} finally {
    in.close();                  // BUG: if this throws, out.close() is skipped
    out.close();
}
```

**Symptoms:** When `in.close()` throws, `out` leaks; and the original copy error can be masked.

<details><summary>Find the bug</summary>

A single `finally` closing both sequentially: a throw from the first close skips the second, leaking it.

</details>

### Fix

```java
try (InputStream in = open(a);
     OutputStream out = open(b)) {
    copy(in, out);
}   // both close LIFO; a close failure is suppressed onto the primary, not lost
```

### Lesson

Use the language mechanism for multiple resources — it guarantees all close and preserves errors via suppression.

---

## Practice Tips

1. **Run `go test -race`** and watch FD/connection gauges to catch leaks.
2. **Grep for `defer` inside `for`** — a frequent loop-leak.
3. **Check that every `close()` is idempotent** and guards use-after-close.
4. **Verify writable resources surface the flush/close error.**
5. **Confirm no `__del__`/`finalize` is doing real work** — backstop only.
6. **Trace ownership:** does any returned resource get closed by the creating scope?

---

[← Tasks](tasks.md) · [Resource & Type-Safety](../README.md) · [Roadmap](../../../../README.md) · **Next:** [Optimize](optimize.md)
