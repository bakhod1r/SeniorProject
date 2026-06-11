# Reactor — Find the Bug

> Buggy Reactor snippets. Read the code, find the defect, understand the root cause, apply the fix. These are the bugs that actually bite in production — most cause a *global* failure (stalled loop, 100% CPU, dropped data) rather than a local one. Based on the patterns in [middle](middle.md).

## Table of Contents

1. [Bug 1 — The Forgotten remove()](#bug-1--the-forgotten-remove)
2. [Bug 2 — Blocking Inside a Handler](#bug-2--blocking-inside-a-handler)
3. [Bug 3 — Permanent OP_WRITE Spin](#bug-3--permanent-op_write-spin)
4. [Bug 4 — Assuming a Full Write](#bug-4--assuming-a-full-write)
5. [Bug 5 — Treating read()==0 as Closed](#bug-5--treating-read0-as-closed)
6. [Bug 6 — Blocking Channel Registered](#bug-6--blocking-channel-registered)
7. [Bug 7 — One Bad Connection Kills the Loop](#bug-7--one-bad-connection-kills-the-loop)
8. [Bug 8 — Cross-Thread register() Race](#bug-8--cross-thread-register-race)
9. [Bug 9 — Edge-Triggered Without Draining](#bug-9--edge-triggered-without-draining)
10. [Bug 10 — Assuming One Read = One Message](#bug-10--assuming-one-read--one-message)
11. [Bug 11 — Unbounded Write Queue](#bug-11--unbounded-write-queue)
12. [Bug 12 — Operating on a Cancelled Key](#bug-12--operating-on-a-cancelled-key)
13. [Practice Tips](#practice-tips)

---

## Bug 1 — The Forgotten remove()

```java
selector.select();
for (SelectionKey key : selector.selectedKeys()) {   // BUG
    if (key.isReadable()) echo(key);
}
```

**What's wrong.** The `selectedKeys()` set is never cleared.
**Root cause.** The JDK does not auto-clear `selectedKeys()`. On the next `select()`, old keys remain in the set and are re-dispatched even when not ready, causing spurious reads and corrupted state.
**Fix.**
```java
Iterator<SelectionKey> it = selector.selectedKeys().iterator();
while (it.hasNext()) { SelectionKey key = it.next(); it.remove(); /* handle */ }
```

## Bug 2 — Blocking Inside a Handler

```java
private void onRead(SelectionKey key) throws IOException {
    String user = readUser(key);
    Account acct = jdbc.query("SELECT * FROM accounts WHERE u=?", user); // BUG: blocks
    reply(key, acct);
}
```

**What's wrong.** A blocking JDBC call runs on the loop thread.
**Root cause.** The single loop thread is parked for the DB round-trip; *every* other connection stalls for that duration. The failure is global.
**Fix.** Offload to a [Thread Pool](../05-thread-pool/junior.md); post the result back via a task queue + `selector.wakeup()`, and let the loop write the reply.

## Bug 3 — Permanent OP_WRITE Spin

```java
client.register(selector, SelectionKey.OP_READ | SelectionKey.OP_WRITE); // BUG
```

**What's wrong.** `OP_WRITE` is registered permanently.
**Root cause.** A connected socket is almost always writable, so `select()` returns instantly every iteration, pinning a CPU at 100% with no traffic.
**Fix.** Register `OP_READ` only. Add `OP_WRITE` *only* when a write couldn't fully flush; clear it the moment the write queue drains.

## Bug 4 — Assuming a Full Write

```java
buf.flip();
client.write(buf);   // BUG: may write only part of buf
buf.clear();
```

**What's wrong.** `write()` can flush fewer bytes than offered (send buffer full); the rest is silently discarded by `clear()`.
**Root cause.** TCP send buffering means partial writes are normal under backpressure. Tails of large messages vanish.
**Fix.** Loop/queue: if `buf.hasRemaining()` after `write()`, keep the remainder, register `OP_WRITE`, and finish flushing when the socket is writable again.

## Bug 5 — Treating read()==0 as Closed

```java
int n = client.read(buf);
if (n == 0) { client.close(); return; }   // BUG
```

**What's wrong.** Closing on a 0-byte read.
**Root cause.** In Java NIO non-blocking mode, `read()` returns `0` for "no data available right now" (would-block) and `-1` for EOF (peer closed). Closing on `0` drops perfectly healthy connections.
**Fix.** `if (n == -1) { close(); return; }` and treat `0` as "nothing to do this iteration."

## Bug 6 — Blocking Channel Registered

```java
SocketChannel client = server.accept();
client.register(selector, SelectionKey.OP_READ);   // BUG: still in blocking mode
```

**What's wrong.** The accepted channel was never set non-blocking.
**Root cause.** Registering a blocking channel with a `Selector` throws `IllegalBlockingModeException`; if a blocking call sneaks through elsewhere, it freezes the loop.
**Fix.** `client.configureBlocking(false);` before `register`.

## Bug 7 — One Bad Connection Kills the Loop

```java
while (it.hasNext()) {
    SelectionKey key = it.next(); it.remove();
    if (key.isReadable()) echo(key);   // BUG: throws on a reset peer -> loop dies
}
```

**What's wrong.** No per-dispatch exception handling.
**Root cause.** A `read()` on a connection reset by peer throws `IOException`; uncaught, it propagates out of the loop and kills the entire server — all connections die because one misbehaved.
**Fix.** Wrap each dispatch in `try { ... } catch (IOException e) { close(key); }` so a broken connection is closed, not fatal.

## Bug 8 — Cross-Thread register() Race

```java
// Called from a worker thread:
void handoff(SocketChannel ch) throws IOException {
    ch.register(subSelector, SelectionKey.OP_READ);   // BUG: foreign-thread register
}
```

**What's wrong.** A non-owning thread calls `register()` on a selector that may be blocked in `select()`.
**Root cause.** `register()` contends for the selector's internal lock against an in-progress `select()`; this can deadlock or corrupt key state. Selector mutation is not safe from arbitrary threads.
**Fix.** Enqueue the channel to a thread-safe queue, `selector.wakeup()`, and have the *owning* loop thread perform `register()` at the top of its next iteration. (See [senior](senior.md).)

## Bug 9 — Edge-Triggered Without Draining

```c
ev.events = EPOLLIN | EPOLLET;            // edge-triggered
// ...
ssize_t r = read(fd, buf, sizeof buf);    // BUG: reads once, leaves data
if (r > 0) process(buf, r);
```

**What's wrong.** Under edge-triggered epoll, the fd is read only once per event.
**Root cause.** ET notifies only on the not-ready→ready *transition*. If more than one buffer's worth arrived, the residual bytes sit unread; no new event fires until *fresh* data arrives — the request hangs.
**Fix.** Drain in a loop until `read()` returns `EAGAIN`/`EWOULDBLOCK`:
```c
for (;;) { ssize_t r = read(fd, buf, sizeof buf);
           if (r > 0) process(buf, r);
           else if (r == -1 && errno == EAGAIN) break;
           else { close(fd); break; } }
```

## Bug 10 — Assuming One Read = One Message

```java
int n = client.read(buf);
buf.flip();
String msg = StandardCharsets.UTF_8.decode(buf).toString(); // BUG: maybe partial
handleCommand(msg);
```

**What's wrong.** Treating one read as a complete protocol message.
**Root cause.** TCP is a byte stream; a "message" may span multiple reads or share a read with the next message. You'll parse fragments and split/merge commands incorrectly.
**Fix.** Accumulate per-connection bytes and frame explicitly (delimiter or length-prefix); process only complete units; retain the partial tail.

## Bug 11 — Unbounded Write Queue

```java
void queueWrite(Conn c, ByteBuffer data) {
    c.out.addLast(data);   // BUG: no cap; slow reader -> OOM
    flush(c);
}
```

**What's wrong.** The pending-write queue grows without limit.
**Root cause.** A slow or stalled consumer never drains; the producer keeps enqueuing, and memory grows until OOM — a single slow client takes down the server.
**Fix.** Cap the queue (high-water mark). When full, apply backpressure: stop reading from the source (clear `OP_READ`) or drop the connection. Resume reads at a low-water mark.

## Bug 12 — Operating on a Cancelled Key

```java
while (it.hasNext()) {
    SelectionKey key = it.next(); it.remove();
    echo(key);   // BUG: key may have been cancelled this iteration
}
```

**What's wrong.** No validity check; the key may be cancelled/closed.
**Root cause.** A handler earlier in the batch may have closed a connection (cancelling its key). Operating on a cancelled key throws `CancelledKeyException`.
**Fix.** `if (!key.isValid()) continue;` before dispatching, and dispatch by readiness type (`isAcceptable`/`isReadable`/`isWritable`).

## Practice Tips

- **Most Reactor bugs fail globally.** When debugging, first ask "is the *whole* server stalled or hot?" — that points at a blocking handler (stall) or stuck interest/select-spin (100% CPU).
- **Reproduce framing bugs by chunking input** 1 byte at a time; reproduce write bugs with a non-reading client.
- **Idle CPU is a tell.** A healthy Reactor is ~0% CPU when idle. Any idle CPU means a spin (OP_WRITE, select bug, or EAGAIN retry).
- **Audit every handler for: blocking calls, full-write assumptions, `read()==0` vs `-1`, and missing try/catch.** Those four cover the majority of real incidents.
- **For ET epoll, the review rule is "show me the drain-to-EAGAIN loop."** If it's missing, it's a latent hang.
- **For multi-reactor code, the review rule is "which thread calls register()?"** It must be the owning loop thread only.
