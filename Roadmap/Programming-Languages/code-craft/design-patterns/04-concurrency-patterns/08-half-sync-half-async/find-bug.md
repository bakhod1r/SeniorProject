# Half-Sync/Half-Async — Find the Bug

> Buggy Half-Sync/Half-Async snippets. Read the code, spot the defect, then check the diagnosis. Back to [junior.md](junior.md) · [middle.md](middle.md) · [senior.md](senior.md).

Each entry: **buggy code → what's wrong → root cause → fix.**

---

## Bug 1 — Unbounded boundary queue

```java
BlockingQueue<Request> queue = new LinkedBlockingQueue<>(); // no capacity arg
void onReadable(Request r) { queue.put(r); }
```

**What's wrong:** Under sustained overload the queue grows without limit until the JVM OOMs.

**Root cause:** `LinkedBlockingQueue()` with no capacity is **unbounded**. The boundary must be bounded — it's the only place backpressure can be applied. This is the single most common Half-Sync/Half-Async production incident.

**Fix:**
```java
BlockingQueue<Request> queue = new ArrayBlockingQueue<>(1_000); // BOUNDED
void onReadable(Request r) { if (!queue.offer(r)) reject(r); }  // explicit overload policy
```

---

## Bug 2 — `put()` on the async thread

```java
// runs on the single selector thread
void onReadable(Request r) { queue.put(r); }  // bounded queue this time
```

**What's wrong:** When the (bounded) queue is full, `put()` **blocks** — and it's blocking the *one* async/selector thread, so all I/O for every connection freezes until a worker drains a slot.

**Root cause:** Blocking on application back-pressure inside the async layer. The async layer's cardinal rule is *never block on app work.*

**Fix:** Use non-blocking `offer()` and a reject path (or disarm `OP_READ`):
```java
if (!queue.offer(r)) reject(r);
```

---

## Bug 3 — Real work in the async layer

```java
void onReadable(SelectionKey key) {
    Request r = read(key);
    Response resp = database.query(r);   // BLOCKING DB call on the selector thread!
    write(key, resp);
}
```

**What's wrong:** The selector thread blocks on the database; every other connection stalls until the query returns. Throughput collapses to single-request-at-a-time.

**Root cause:** The whole point of the pattern is to **defer** blocking work to the sync layer. Doing it inline defeats it.

**Fix:** Hand off; let a worker do the blocking query:
```java
void onReadable(SelectionKey key) {
    Request r = read(key);
    if (!queue.offer(r)) reject(key);    // async layer just reads + enqueues
}
// worker thread:
Request r = queue.take();
write(r.channel(), database.query(r));   // blocking call lives HERE
```

---

## Bug 4 — Mutating the work item after enqueue

```java
ByteBuffer buf = perConn.buffer;      // reused across reads
buf.clear(); channel.read(buf); buf.flip();
queue.offer(new Request(channel, buf)); // enqueues a REFERENCE to the shared buffer
// ... next read on the same connection:
buf.clear(); channel.read(buf);         // overwrites data the worker hasn't read yet
```

**What's wrong:** The worker may read the buffer *after* the async thread has overwritten it with the next read — torn/garbage payload.

**Root cause:** Sharing a mutable object across the boundary and mutating it after handoff. The `BlockingQueue` only publishes state *as of enqueue time*; later mutation is a data race.

**Fix:** Copy or transfer ownership — make the work item immutable:
```java
byte[] data = new byte[buf.remaining()];
buf.get(data);
queue.offer(new Request(channel, data)); // immutable snapshot, safe to publish
```
(For zero-copy, transfer ownership of a *pooled* buffer and stop touching it — see [optimize.md](optimize.md) Bug/Opt on copies.)

---

## Bug 5 — Worker dies on an exception

```java
void workerLoop() {
    while (running) {
        Request r = queue.take();
        handle(r);              // throws on bad input → thread dies
    }
}
```

**What's wrong:** One bad request throws, the worker thread exits, and you've silently lost 1/N of your processing capacity. Repeat and the pool empties; the queue backs up and overflows.

**Root cause:** Unhandled exception in the worker loop, with nothing to restart it.

**Fix:** Isolate per-item failures:
```java
while (running) {
    Request r = queue.take();
    try { handle(r); }
    catch (Exception e) { log.error("handler failed for {}", r, e); } // worker survives
}
```

---

## Bug 6 — Ignoring `offer()`'s return value

```java
void onReadable(Request r) { queue.offer(r); } // return value discarded
```

**What's wrong:** When the queue is full, `offer` returns `false` and the request is **silently dropped** — no 503, no close, no metric. The client hangs until it times out.

**Root cause:** Treating a non-blocking enqueue as if it always succeeds. The `false` branch *is* your overload behavior.

**Fix:**
```java
if (!queue.offer(r)) { rejected.increment(); rejectPolicy.onReject(r); }
```

---

## Bug 7 — Non-volatile shutdown flag

```java
boolean accepting = true;            // plain field
void submit(Request r) { if (accepting) queue.offer(r); }
void shutdown() { accepting = false; } // set by a different thread
```

**What's wrong:** The async thread may never observe `accepting = false` (no happens-before edge); shutdown never actually stops intake, so the drain never terminates.

**Root cause:** Visibility — a plain field written by one thread isn't guaranteed visible to another.

**Fix:** `private volatile boolean accepting = true;` (or an `AtomicBoolean`).

---

## Bug 8 — Killing workers before draining

```java
void shutdown() {
    accepting = false;
    workers.shutdownNow();   // interrupts workers immediately
}
```

**What's wrong:** `shutdownNow()` interrupts workers and returns the queue's remaining items as a list you ignore — every queued-but-unprocessed request is dropped.

**Root cause:** Stopping the consumers before draining the boundary.

**Fix:** Drain first, then stop:
```java
accepting = false;                       // 1. stop intake
for (int i = 0; i < N; i++) queue.put(POISON); // 2. one sentinel per worker
workers.shutdown();
workers.awaitTermination(30, SECONDS);   // 3. let in-flight finish
```

---

## Bug 9 — Assuming global ordering with multiple workers

```java
// single queue, 8 workers
Request r = queue.take();
process(r);   // request 5 may finish before request 4
```

**What's wrong:** Code downstream assumes responses come out in arrival order, but 8 workers process in parallel and finish in arbitrary order — protocol corruption for ordered streams.

**Root cause:** A single queue with multiple consumers gives no ordering guarantee across items.

**Fix:** Affine by key to a single consumer:
```java
perWorkerQueue[Math.floorMod(r.connId().hashCode(), N)].offer(r); // per-conn single consumer → ordered
```

---

## Bug 10 — `size()`-based backpressure race

```java
if (queue.size() < CAP) queue.offer(r);   // check-then-act
else reject(r);
```

**What's wrong:** Between the `size()` check and the `offer`, other producers can fill the queue; and `size()` on a concurrent queue is approximate. The guard is both racy and redundant.

**Root cause:** Check-then-act on a concurrent collection; the queue already enforces its bound atomically.

**Fix:** Let `offer` be the atomic gate — it returns `false` exactly when full:
```java
if (!queue.offer(r)) reject(r);  // single atomic decision, no race
```

---

## Bug 11 — Forgetting `selector.wakeup()` after changing interest from another thread

```java
// worker thread re-arms reads when queue drains:
key.interestOps(key.interestOps() | OP_READ);   // but selector is blocked in select()
```

**What's wrong:** The selector thread is parked in `select()`; changing `interestOps` from another thread doesn't take effect until the next `select()` returns — which may be never if there are no other events. Reads stay disarmed; the connection stalls.

**Root cause:** `interestOps` changes from a non-selector thread aren't observed until the selector re-evaluates; it must be woken.

**Fix:**
```java
key.interestOps(key.interestOps() | OP_READ);
selector.wakeup();   // force select() to return and pick up the new interest
```
(Better: do interest changes *on* the selector thread by posting a task to it.)

---

## Bug 12 — Partial read enqueued as a full request

```java
void onReadable(SocketChannel ch) {
    ByteBuffer b = ByteBuffer.allocate(4096);
    ch.read(b); b.flip();
    queue.offer(new Request(ch, toBytes(b)));  // may be HALF a message
}
```

**What's wrong:** A non-blocking read can return a partial message (TCP is a byte stream, not message-framed). The worker tries to parse half a request and fails or, worse, misframes the next one.

**Root cause:** No per-connection reassembly before crossing the boundary; only the sync worker should see *complete* requests.

**Fix:** Accumulate per-connection bytes until a full frame (length-prefix/delimiter) is present, then enqueue only complete requests:
```java
ConnState st = (ConnState) key.attachment();
st.buffer().put(read(ch));
for (Request full : st.extractCompleteFrames()) queue.offer(full); // only whole messages cross
```

---

## Practice Tips

- **Scan the async layer first.** Most bugs are blocking or real work where only `read + enqueue + return` belongs (Bugs 2, 3, 12).
- **Then scan the handoff for shared mutable state** (Bugs 4) and visibility (Bug 7) — the classic data races.
- **Then the boundary policy:** bounded? (Bug 1) reject handled? (Bug 6) atomic? (Bug 10).
- **Then shutdown:** drain before stop, sentinels, volatile flag (Bugs 7, 8).
- **Then ordering** if the protocol needs it (Bug 9) and **partial reads** for any stream protocol (Bug 12).
- **A reliable smell test:** "Does the async thread ever wait on application work?" If yes (block, `put`, DB, `size()`-then-`offer` race), it's a bug. "Is any work item touched after enqueue?" If yes, it's a bug. "Is the queue bounded with a handled reject?" If no, it's a bug.
