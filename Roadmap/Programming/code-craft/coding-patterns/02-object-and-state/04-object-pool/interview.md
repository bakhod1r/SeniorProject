# Object Pool — Interview Questions

> **Category:** [Object & State Patterns](../README.md) — borrow/use/reset/return a bounded set of expensive objects; the interview tests whether you know *when not to*.

---

## Junior Questions (10)

### J1. What is an object pool?
**Answer:** A bounded set of pre-built, reusable objects lent out via borrow → use → return, so you avoid re-creating expensive objects on a hot path.

### J2. What three steps make up its lifecycle?
**Answer:** Borrow (acquire), use, return (release). The invariant: whatever you borrow, you return exactly once.

### J3. Give the canonical legitimate use case.
**Answer:** Database connection pools (HikariCP, PgBouncer) — a TCP+TLS+auth handshake is tens of milliseconds, far too expensive to pay per query.

### J4. Why must you reset an object on return?
**Answer:** A reused object still holds the previous borrower's data. Without a reset, that stale data leaks to the next borrower — a correctness or security bug.

### J5. What is pool exhaustion?
**Answer:** All objects are in use and none are idle, so a borrow can't be satisfied immediately.

### J6. Name three responses to exhaustion.
**Answer:** Block with a timeout, grow the pool, or fail fast. Block-with-timeout is the usual production choice.

### J7. Why is Go's `sync.Pool` wrong for connections?
**Answer:** It's GC-aware and may drop its contents at any garbage collection. A connection it discards leaks. It's for ephemeral, reconstructible objects like buffers.

### J8. What's the most common pooling bug?
**Answer:** Forgetting to return the object (a leak) — or forgetting to reset it (stale-state leak). Both are the dangerous "return half" of the pattern.

### J9. How do you make returning hard to forget?
**Answer:** Wrap the borrow in `try-with-resources` (Java), `defer` (Go), or a context manager (Python) so return runs even on exception.

### J10. When should you NOT pool?
**Answer:** When the object is cheap to construct, or when you haven't profiled. The allocator/GC is usually faster and bug-free for ordinary objects.

---

## Middle Questions (10)

### M1. Pool vs cache — what's the difference?
**Answer:** A cache holds shared, read-only values it may evict and recompute. A pool lends exclusively-owned objects and demands them back. Ownership and return obligation differ.

### M2. Pool vs memoization?
**Answer:** [Memoization](../03-memoization-and-caching/junior.md) caches *values* keyed by input. A pool reuses *objects* regardless of input. Memo entries are shared; pool objects are borrowed one at a time.

### M3. What lifecycle hooks does a real pool need?
**Answer:** `create`, `validate` (still alive?), `reset` (wipe state), `destroy` (free the resource). Apache Commons Pool's `PooledObjectFactory` is exactly this.

### M4. Why is "more connections = more throughput" wrong?
**Answer:** A connection pool queues in front of a fixed-capacity backend. Oversizing moves the queue into the DB, where it's slower and less visible. A small pool can out-throughput a huge one.

### M5. What does HikariCP's `leakDetectionThreshold` do?
**Answer:** Logs a stack trace (pointing at the borrow site) when an object is held longer than the threshold — surfacing a missing return before the pool is exhausted.

### M6. Test-on-borrow vs test-while-idle?
**Answer:** Test-on-borrow validates every borrow (correct, adds latency). Test-while-idle uses a background sweeper to validate idle objects off the hot path (lower latency, tiny race window).

### M7. Why retire healthy connections (maxLifetime)?
**Answer:** To roll the pool gracefully, avoid server-side resource creep, and let connections drift to a new primary after a failover. Set it below the DB/firewall idle timeout.

### M8. What's the global-budget constraint on pool size?
**Answer:** `pods × maxPoolPerPod ≤ db.max_connections`. Per-pod pools draw from one shared backend budget; ignoring this causes connection exhaustion at the DB.

### M9. Why is a fixed-size pool (`minIdle == max`) often best in production?
**Answer:** No churn (no constant create/destroy), predictable memory footprint, and stable latency under sustained high traffic. HikariCP recommends it.

### M10. Why are game engines a classic pool case?
**Answer:** Allocating bullets/particles mid-frame triggers GC pauses that drop frames. A pool keeps frame time flat by recycling pre-allocated objects.

---

## Senior Questions (10)

### S1. How do you size a connection pool?
**Answer:** Start from HikariCP's `(core_count*2)+effective_spindles` (often <20 per instance), then reconcile with the global backend limit and verify with a load test. Bigger is usually worse.

### S2. Which exhaustion policy, and why?
**Answer:** Block-with-timeout — bounded wait, clean backpressure, observable (borrow-timeout metric). The borrow timeout must be shorter than the upstream request deadline.

### S3. How do you guarantee fairness?
**Answer:** FIFO waiter queue (fair lock/queue) so nobody starves; combine with LIFO object reuse to keep the cache warm and let surplus objects age out for eviction.

### S4. What metrics do you export for a pool?
**Answer:** active/idle/total, borrow wait p50/p99, borrow timeouts/s, create/destroy rate, pending borrowers. Alert on sustained saturation and any borrow timeouts.

### S5. How does a double-return corrupt a pool?
**Answer:** The object lands in the idle set twice; two borrowers then receive the same object and corrupt each other's state. Guard with a "leased" set checked on return.

### S6. Why can't a `synchronized` pool scale?
**Answer:** A single lock serializes all borrows/returns, so the pool becomes the bottleneck it was meant to relieve. Production pools shard (thread-local lists) or go lock-free.

### S7. Reset that itself fails — what do you do?
**Answer:** Destroy the object and create a replacement. Returning a poisoned object (failed `rollback`) to the idle set hands a broken resource to the next borrower.

### S8. How does the pool tie into request deadlines?
**Answer:** The borrow timeout (or Go `context` deadline) should derive from the remaining request budget, so a borrow can't outlive the request it serves and a cancelled request frees its slot.

### S9. PgBouncer transaction mode — when and why?
**Answer:** When many app replicas would otherwise exceed `max_connections`. It multiplexes thousands of client connections onto a few hundred real ones, decoupling app-side pool sizing from the DB limit.

### S10. What's the security angle of reset?
**Answer:** A buffer reused without zeroing can leak one user's bytes to another; a connection returned mid-transaction can run the next user's queries in the prior user's transaction. Reset is a cross-tenant data boundary.

---

## Professional Questions (10)

### P1. Why is a small-object pool often slower than `new`?
**Answer:** A generational bump-pointer allocator allocates in a few ns, lock-free; the dead object is reclaimed for free. The pool adds synchronization on borrow/return plus reset, and the long-lived pooled objects get promoted and traced on every old-gen GC.

### P2. How does `sync.Pool` avoid a global lock?
**Answer:** Per-P (per-processor) sharding. The goroutine is pinned to a P during Get/Put, so its local slot/chain is touched contention-free; only on a miss does it steal from another P.

### P3. How does `sync.Pool` cooperate with the GC?
**Answer:** It registers a cleanup hook that runs each GC, using two generations (local/victim). An object survives at most two GC cycles. That's why it's only safe for reconstructible objects.

### P4. What is HikariCP's ConcurrentBag and why?
**Answer:** A borrow store using thread-local lists plus non-blocking stealing and a direct handoff to waiters. It keeps the common borrow/return path lock-free, so the pool scales with cores instead of serializing.

### P5. What is false sharing in a pool?
**Answer:** Hot counters (active/wait) sharing a cache line; an increment on one invalidates the other core's line, killing throughput. Fix with cache-line padding (`@Contended` / manual padding).

### P6. Quantify reset cost for a 64 KB buffer.
**Answer:** Zeroing 64 KB is a `memset`, a few µs, memory-bandwidth-bound — sometimes rivaling the allocation you're avoiding. Zero only the written region when correctness allows; never skip it for sensitive data.

### P7. Pool vs arena vs escape analysis?
**Answer:** Pool = you manage lifetime (resources). Arena = bulk-free a region (request-scoped objects). Escape analysis = the compiler stack-allocates non-escaping objects for free — check this first before pooling.

### P8. When does `sync.Pool` clearly win?
**Answer:** Large, hot buffers — allocation + zeroing of 64 KB dominates, so the pool's ~0-alloc reuse is several-fold faster. For tiny structs it loses (~5×) to the allocator.

### P9. Why retire connections below the firewall idle timeout?
**Answer:** A stateful firewall/load balancer silently drops idle TCP flows; a connection idle past that limit appears alive but fails on first use. `maxLifetime`/`maxIdleTime` set under that window pre-empt the drop.

### P10. How do you prove a pool is even needed?
**Answer:** Profile allocation pressure and acquisition cost. If escape analysis already stack-allocates the object, or the object is cheap, there's nothing to pool — the bottleneck is elsewhere.

---

## Coding Tasks (5)

### C1. Minimal blocking pool (Java)
```java
final BlockingQueue<byte[]> idle = new ArrayBlockingQueue<>(8);
byte[] borrow() throws InterruptedException {
    byte[] b = idle.poll(1, TimeUnit.SECONDS);
    if (b == null) throw new IllegalStateException("exhausted");
    return b;
}
void release(byte[] b) { Arrays.fill(b, (byte)0); idle.offer(b); }  // reset on return
```

### C2. `sync.Pool` buffer reuse (Go)
```go
var p = sync.Pool{New: func() any { return new(bytes.Buffer) }}
func use(d []byte) {
    b := p.Get().(*bytes.Buffer)
    defer func() { b.Reset(); p.Put(b) }()
    b.Write(d)
}
```

### C3. Context-managed pool (Python)
```python
@contextmanager
def borrow(self, timeout=1.0):
    obj = self._q.get(timeout=timeout)
    try: yield obj
    finally: obj.reset(); self._q.put(obj)
```

### C4. Double-return guard (Java)
```java
private final Set<T> leased = ConcurrentHashMap.newKeySet();
void release(T o) {
    if (!leased.remove(o)) throw new IllegalStateException("not leased / double return");
    reset(o); idle.offer(o);
}
```

### C5. Size database/sql correctly (Go)
```go
db.SetMaxOpenConns(15)
db.SetMaxIdleConns(15)                 // fixed-size, no churn
db.SetConnMaxLifetime(25 * time.Minute) // below DB/firewall idle timeout
```

---

## Trick Questions (5)

### T1. Is a bigger pool always faster?
**No.** Past the backend's capacity, more connections add queueing and contention at the DB, lowering throughput.

### T2. Is `sync.Pool` a capacity limit?
**No.** It never blocks and never caps; `New` manufactures on a miss. It's a GC-flushable performance hint, not a bound.

### T3. Can you skip reset if "the object always gets fully overwritten"?
**Risky.** Partial writes, error paths, and security-sensitive bytes make "always overwritten" a fragile assumption. Reset is the safe default.

### T4. Is returning an object after using it past return safe?
**No.** Once returned, the object may be re-borrowed by another thread; touching it is a use-after-return data race.

### T5. Does pooling reduce GC work?
**Only sometimes.** It cuts allocations but keeps objects long-lived, so they get promoted and traced on every old-gen GC. For cheap objects this *increases* GC work.

---

## Behavioral Questions (5)

### B1. Tell me about a pool you tuned in production.
**Sample:** "We cut HikariCP `maximumPoolSize` from 100 to 12 per pod after a load test showed p99 query latency *dropping* — the DB stopped thrashing. We also reconciled `pods × 12` against `max_connections`."

### B2. Describe a pool bug you debugged.
**Sample:** "A response handler skipped `release()` on an exception path. The pool slowly leaked until borrows blocked and the service hung. `leakDetectionThreshold` logged the exact borrow site; we wrapped it in try-with-resources."

### B3. When did you decide *not* to pool?
**Sample:** "Someone proposed pooling DTO objects 'for GC.' A profiler showed escape analysis already stack-allocated them; the pool would have added contention for zero gain. We didn't build it."

### B4. A stale-state incident.
**Sample:** "A buffer pool skipped zeroing 'for speed.' Under load, one user's payload bytes appeared in another's response — an info-disclosure bug. We added a scoped zero of the written region and a test asserting clean borrows."

### B5. How do you explain pool saturation to non-engineers?
**Sample:** "Picture a rack of rental shoes. We have 12 pairs; at peak, 12 people are bowling and the 13th waits. The fix isn't infinite shoes — it's making each game shorter or adding lanes."

---

## Tips for Answering

1. **Lead with the caution:** pooling is a last-resort optimization; name the allocator/GC default first.
2. **Anchor on connections/threads/buffers** — the legitimate cases.
3. **Name the two killer bugs:** forgotten return (leak) and skipped reset (stale state).
4. **Know `sync.Pool` is GC-flushable** and not for connections.
5. **Sizing is queueing theory, not "bigger is better."**

---

[← Professional](professional.md) · [Object & State](../README.md) · [Coding Patterns](../../README.md) · **Next:** [Tasks](tasks.md)
