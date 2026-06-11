# Reactor — Practice Tasks

> Hands-on tasks to build Reactor intuition, ordered roughly easy → hard. Each has a goal, requirements, hints, and a solution sketch. Build on the echo server from [junior](junior.md) / [middle](middle.md).

## Table of Contents

1. [Task 1 — Minimal Echo Reactor](#task-1--minimal-echo-reactor)
2. [Task 2 — Correct Partial-Read Framing](#task-2--correct-partial-read-framing)
3. [Task 3 — Write Queue & OP_WRITE Toggling](#task-3--write-queue--op_write-toggling)
4. [Task 4 — Broadcast Chat Server](#task-4--broadcast-chat-server)
5. [Task 5 — Idle-Connection Timeout](#task-5--idle-connection-timeout)
6. [Task 6 — Backpressure on Slow Readers](#task-6--backpressure-on-slow-readers)
7. [Task 7 — Offload CPU Work to a Thread Pool](#task-7--offload-cpu-work-to-a-thread-pool)
8. [Task 8 — Main/Sub Reactor Across Cores](#task-8--mainsub-reactor-across-cores)
9. [Task 9 — Tiny HTTP/1.0 Server](#task-9--tiny-http10-server)
10. [Task 10 — Pluggable Demultiplexer for Testing](#task-10--pluggable-demultiplexer-for-testing)
11. [How to Practice](#how-to-practice)

---

## Task 1 — Minimal Echo Reactor

**Goal.** A single-threaded NIO server that echoes bytes back to each client.
**Requirements.** Use one `Selector`; register `OP_ACCEPT`; on accept register `OP_READ`; echo on read; handle `it.remove()` and `read() == -1`.
**Hints.** `configureBlocking(false)` on every channel. Test with `nc localhost 9090`.
**Solution sketch.** Exactly the `EchoReactor` in [junior](junior.md). The trap is forgetting `it.remove()` (re-dispatches stale keys) or registering a blocking channel (freezes the loop).

## Task 2 — Correct Partial-Read Framing

**Goal.** Echo *whole lines* only, surviving TCP fragmentation.
**Requirements.** Accumulate bytes per connection; emit a line only when `\n` is seen; keep the partial tail for the next read.
**Hints.** Feed input 1 byte at a time (`for c in msg; do printf "$c"; sleep 0.1; done | nc ...`) to prove framing is correct.
**Solution sketch.** Per-connection `ByteBuffer in`; scan for `\n`; on match, slice out the line and `queueWrite`; `in.compact()` to retain the unfinished tail. See `LineEchoReactor` in [middle](middle.md).

## Task 3 — Write Queue & OP_WRITE Toggling

**Goal.** Handle partial writes without blocking or busy-spinning.
**Requirements.** Per-connection `Deque<ByteBuffer>` output queue; on write, flush as much as possible; if bytes remain, set `OP_WRITE`; when the queue empties, clear `OP_WRITE`.
**Hints.** Simulate a slow reader: connect and *don't* read; send a large payload; watch the queue grow and `OP_WRITE` engage.
**Solution sketch.** `flush()` writes the head buffer; `head.hasRemaining()` → set `OP_WRITE` and return; empty queue → `interestOps & ~OP_WRITE`. The bug to avoid: leaving `OP_WRITE` always on (100% CPU spin).

## Task 4 — Broadcast Chat Server

**Goal.** Every line a client sends is delivered to *all* connected clients.
**Requirements.** Maintain the set of live connections; on a complete line, enqueue it to every other connection's write queue (reusing Task 3's flush path).
**Hints.** Don't write synchronously in a loop — enqueue per connection so each respects its own backpressure.
**Solution sketch.** Keep a `Set<Conn>`; in `onRead`, after framing, iterate the set calling `queueWrite(other, line.duplicate())`. Use independent buffer copies per recipient so positions don't collide.

## Task 5 — Idle-Connection Timeout

**Goal.** Close connections idle for > 30 s.
**Requirements.** Track `lastActivity` per connection; periodically sweep and close stale ones. Sweep must not block the loop.
**Hints.** Use `selector.select(timeoutMs)` so the loop wakes periodically even without I/O; on wake, sweep.
**Solution sketch.** Store `long lastActivityMillis` on `Conn`, update on every read/write. Use `select(1000)`; each wake, scan and `close` where `now - last > 30_000`. Bonus: replace the O(N) scan with a hashed timer wheel (O(1) amortized).

## Task 6 — Backpressure on Slow Readers

**Goal.** Prevent a slow consumer from OOMing the server via an unbounded write queue.
**Requirements.** Cap each connection's write queue (e.g. 64 buffers). When full, *stop reading* from the source (clear `OP_READ`); resume (`set OP_READ`) when the queue drains below a low-water mark.
**Hints.** This is flow control: tie producer reads to consumer drain. Two thresholds (high/low water) prevent flapping.
**Solution sketch.** In `queueWrite`, if `out.size() >= HIGH`, `key.interestOps(... & ~OP_READ)`. In `flush`, when `out.size() <= LOW`, restore `OP_READ`. Alternatively close the connection if the queue overflows a hard cap.

## Task 7 — Offload CPU Work to a Thread Pool

**Goal.** Run a 10 ms CPU task per request without stalling the loop.
**Requirements.** Loop frames the request, submits to an `ExecutorService`, worker computes off-loop, result posted back to the loop and written by the loop thread only.
**Hints.** Worker must NOT touch the channel. Use a `ConcurrentLinkedQueue<Runnable>` drained at the top of the loop + `selector.wakeup()`.
**Solution sketch.** `pool.submit(() -> { var r = compute(msg); loopTasks.add(() -> queueWrite(key, c, r)); selector.wakeup(); })`. Loop, before `select()`, drains `loopTasks`. This is [Half-Sync/Half-Async](../08-half-sync-half-async/junior.md); the queue provides the memory-visibility edge.

## Task 8 — Main/Sub Reactor Across Cores

**Goal.** Use N cores: one acceptor reactor, N sub-reactors.
**Requirements.** Main reactor accepts and round-robins each connection to a sub-reactor; each sub-reactor runs its own loop/thread; handoff must be thread-safe.
**Hints.** Sub-reactor exposes `handoff(channel)` that enqueues + `wakeup()`s; the sub-reactor's *own* thread calls `register()`.
**Solution sketch.** See the `SubReactor` in [senior](senior.md). Invariant: the main thread only enqueues and wakes; only the owning thread mutates its selector/channels. Bonus: replace main/sub with `SO_REUSEPORT` reactor-per-core.

## Task 9 — Tiny HTTP/1.0 Server

**Goal.** Serve `GET /` with a fixed body over the Reactor.
**Requirements.** Per-connection request parser (state machine: request-line → headers → blank line); on complete request, queue a well-formed HTTP response; close (HTTP/1.0) or keep-alive.
**Hints.** Parse incrementally — a request may arrive across many reads. `Content-Length` must match the body you send.
**Solution sketch.** `Conn` holds parse state and accumulated header bytes; detect `\r\n\r\n`; build `HTTP/1.0 200 OK\r\nContent-Length: N\r\n\r\n` + body; enqueue via Task 3's path. Test with `curl -v http://localhost:9090/`.

## Task 10 — Pluggable Demultiplexer for Testing

**Goal.** Make the loop unit-testable without real sockets.
**Requirements.** Define a `Demultiplexer` interface (`select()` → ready set); the real impl wraps `Selector`; a fake returns scripted ready-sets. Test framing/timeouts deterministically.
**Hints.** Inject the demultiplexer and a `Clock` into the Reactor; assert handler invocations against scripted events.
**Solution sketch.** `interface Demux { Set<Event> waitReady(long timeout); }`. Test feeds `[READ on conn A with bytes "hel"]`, then `[READ on conn A with "lo\n"]`, asserts exactly one framed line "hello". This catches the most common Reactor bug — framing across chunk boundaries.

## How to Practice

- **Always test with adversarial chunking** — 1 byte at a time and giant chunks. Most Reactor bugs hide at message boundaries.
- **Watch CPU at idle.** A correct Reactor uses ~0% CPU with no traffic. 100% means a stuck `OP_WRITE` or a select spin — investigate immediately.
- **Simulate slow readers** (connect, never read) to exercise backpressure and `OP_WRITE` paths.
- **Add a loop-latency assertion** in tests: if a handler exceeds your budget (e.g. 1 ms), fail — this institutionalizes the no-blocking rule.
- **Progress order:** Tasks 1–3 teach the core loop and partial I/O; 4–6 teach flow control; 7–8 teach scaling; 9–10 teach real protocols and testability. Do them in order; each builds on the last.
- **Then port one task to C with raw `epoll`** (edge-triggered, drain to `EAGAIN`) to feel what Java's `Selector` abstracts away.
