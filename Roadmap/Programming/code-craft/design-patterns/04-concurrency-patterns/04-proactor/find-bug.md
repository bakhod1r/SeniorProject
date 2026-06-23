# Proactor — Find the Bug

> Buggy Proactor snippets with root-cause analysis and fixes. Most real Proactor bugs are lifetime, threading, or completion-semantics errors that only surface under load. Stack: C++/Boost.Asio and Java NIO.2. See [junior](junior.md) and [middle](middle.md).

## Table of Contents

1. [Bug 1 — Stack-allocated buffer](#bug-1--stack-allocated-buffer)
2. [Bug 2 — Object freed mid-operation](#bug-2--object-freed-mid-operation)
3. [Bug 3 — Ignoring bytes_transferred](#bug-3--ignoring-bytes_transferred)
4. [Bug 4 — async_read_some treated as full read](#bug-4--async_read_some-treated-as-full-read)
5. [Bug 5 — Buffer reused before completion](#bug-5--buffer-reused-before-completion)
6. [Bug 6 — Acceptor not re-armed](#bug-6--acceptor-not-re-armed)
7. [Bug 7 — Blocking inside a handler](#bug-7--blocking-inside-a-handler)
8. [Bug 8 — Data race on shared state](#bug-8--data-race-on-shared-state)
9. [Bug 9 — Mishandling operation_aborted](#bug-9--mishandling-operation_aborted)
10. [Bug 10 — Concurrent writes on one socket](#bug-10--concurrent-writes-on-one-socket)
11. [Bug 11 — Java buffer not flipped](#bug-11--java-buffer-not-flipped)
12. [Bug 12 — Unbounded reads (no backpressure)](#bug-12--unbounded-reads-no-backpressure)
13. [Practice Tips](#practice-tips)

---

## Bug 1 — Stack-allocated buffer

```cpp
void read_once(tcp::socket& sock) {
    char buf[1024];                                   // BUG: on the stack
    sock.async_read_some(boost::asio::buffer(buf),
        [](boost::system::error_code, std::size_t) { /* ... */ });
}   // function returns -> buf destroyed while kernel still writing into it
```

**What's wrong:** `buf` lives on the stack frame of `read_once`, which is destroyed the instant the function returns — but the async read runs *after* that.
**Root cause:** Buffer lifetime is shorter than the operation lifetime → use-after-free; the kernel writes into reclaimed stack memory.
**Fix:** Put the buffer in a heap object whose lifetime spans the operation — e.g. a member of a `shared_ptr`-held `Session`.

## Bug 2 — Object freed mid-operation

```cpp
void start(tcp::socket sock) {
    auto session = std::make_shared<Session>(std::move(sock));
    session->socket_.async_read_some(boost::asio::buffer(session->buf_),
        [session_raw = session.get()](boost::system::error_code, std::size_t n) {
            session_raw->process(n);                  // BUG: raw ptr, no ownership
        });
}   // 'session' shared_ptr goes out of scope -> Session destroyed
```

**What's wrong:** The lambda captures a *raw* pointer, so the `shared_ptr` refcount drops to zero when `start` returns, destroying the `Session` before the completion fires.
**Root cause:** The completion handler doesn't extend the object's lifetime.
**Fix:** Capture the `shared_ptr` (or `self = shared_from_this()`), not a raw pointer: `[session](ec, n){ session->process(n); }`.

## Bug 3 — Ignoring bytes_transferred

```cpp
sock.async_read_some(boost::asio::buffer(buf_),
    [this, self](boost::system::error_code ec, std::size_t /*n*/) {
        if (!ec) handle(buf_, buf_.size());           // BUG: assumes full buffer
    });
```

**What's wrong:** `handle` is given `buf_.size()` instead of the actual bytes read; it processes garbage from the unwritten tail of the buffer.
**Root cause:** `async_read_some` fills only `bytes_transferred` bytes; the rest is stale.
**Fix:** Use `n`: `handle(buf_, n);`.

## Bug 4 — async_read_some treated as full read

```cpp
// Want a 4-byte header.
boost::asio::async_read_some(sock, boost::asio::buffer(header_, 4),
    [this, self](auto ec, std::size_t n) {
        std::uint32_t len = decode(header_);          // BUG: maybe n < 4
    });
```

**What's wrong:** `async_read_some` may return fewer than 4 bytes; decoding a partially-filled header yields wrong lengths.
**Root cause:** Confusing "one read" (`*_some`) with "read exactly N" semantics.
**Fix:** Use `boost::asio::async_read(sock, boost::asio::buffer(header_, 4), handler)`, which loops until 4 bytes or error.

## Bug 5 — Buffer reused before completion

```cpp
sock.async_write(boost::asio::buffer(shared_buf_), write_handler);
sock.async_read_some(boost::asio::buffer(shared_buf_), read_handler); // BUG
```

**What's wrong:** Both ops reference `shared_buf_` concurrently; the read may overwrite bytes the write hasn't sent, and vice versa.
**Root cause:** A single buffer is owned by two outstanding kernel operations at once.
**Fix:** Use separate buffers per concurrent operation, or sequence them (start the read in the write's completion handler).

## Bug 6 — Acceptor not re-armed

```cpp
acceptor.async_accept([](boost::system::error_code ec, tcp::socket s) {
    if (!ec) std::make_shared<Session>(std::move(s))->start();
    // BUG: never calls async_accept again
});
```

**What's wrong:** Exactly one connection is ever accepted; the server goes silent afterward.
**Root cause:** Forgetting that each completion must re-initiate the next operation.
**Fix:** Call `do_accept()` again inside the handler (recurse) so the next accept is always pending.

## Bug 7 — Blocking inside a handler

```cpp
sock.async_read_some(boost::asio::buffer(buf_),
    [this, self](auto ec, std::size_t n) {
        auto rows = db_.query_blocking(...);          // BUG: blocks a worker
        respond(rows);
    });
```

**What's wrong:** A synchronous DB call blocks one Proactor worker thread for the whole query, starving all other connections served by that thread.
**Root cause:** Completion handlers must be non-blocking; the Proactor pool is small.
**Fix:** Use an async DB API, or offload the blocking call to a separate thread pool and resume via `post`/a completion.

## Bug 8 — Data race on shared state

```cpp
// Multi-threaded io_context, no strand.
void on_read(std::size_t n) {
    total_bytes_ += n;                                // BUG: unsynchronized
    cache_[key_] = value_;                            // BUG: concurrent map write
}
```

**What's wrong:** Handlers for different connections (or even the same one without a strand) run on multiple threads and mutate shared state without synchronization.
**Root cause:** Completions dispatch on arbitrary pool threads; shared state needs protection.
**Fix:** Bind handlers to a strand, shard connections per-thread, or guard shared structures with atomics/locks. For per-connection state, a strand is idiomatic.

## Bug 9 — Mishandling operation_aborted

```cpp
timer_.async_wait([this, self](auto) { socket_.cancel(); });
socket_.async_read_some(boost::asio::buffer(buf_),
    [this, self](boost::system::error_code ec, std::size_t n) {
        if (ec) { log_error(ec); abort_process(); }   // BUG: treats abort as fatal
    });
```

**What's wrong:** After `cancel()`, the read completes with `operation_aborted`. Treating it as a hard error spams logs and may crash a legitimate timeout-close path.
**Root cause:** `operation_aborted` is an expected outcome of cancellation, not a failure.
**Fix:** `if (ec == boost::asio::error::operation_aborted) { return; /* normal */ }` before generic error handling.

## Bug 10 — Concurrent writes on one socket

```cpp
void send(const std::string& msg) {
    sock_.async_write_some(boost::asio::buffer(msg), handler);  // BUG if called
}                                                               // re-entrantly
// send() called from two handlers before the first write completes
```

**What's wrong:** Two `async_write_some` ops are outstanding on the same socket; their bytes interleave on the wire, corrupting the stream. (Also `msg` is a dangling reference once `send` returns.)
**Root cause:** A socket allows only one outstanding write at a time for ordered output; and the buffer must outlive the op.
**Fix:** Queue outbound messages; write the next only after the previous write's completion. Own each message buffer (copy into the queue), not by reference.

## Bug 11 — Java buffer not flipped

```java
ch.read(buf, buf, new CompletionHandler<Integer, ByteBuffer>() {
    public void completed(Integer n, ByteBuffer b) {
        ch.write(b, b, writeHandler);   // BUG: buffer still in write-position
    }
    public void failed(Throwable t, ByteBuffer b) {}
});
```

**What's wrong:** After a `read`, the `ByteBuffer`'s position is at the end of the data; writing it without `flip()` sends zero/garbage bytes from position→limit.
**Root cause:** NIO buffers track position/limit; `read` fills forward, `write` must start from 0.
**Fix:** `b.flip();` before `ch.write(b, ...)`; after the write completes, `b.clear()` before the next read.

## Bug 12 — Unbounded reads (no backpressure)

```cpp
void do_read() {
    sock_.async_read_some(boost::asio::buffer(buf_),
        [this, self](auto ec, std::size_t n) {
            outbound_.push_back(std::string(buf_.data(), n)); // BUG: grows forever
            do_read();                                        // read again immediately
        });
}
```

**What's wrong:** If the consumer (or upstream socket) is slower than the producer, `outbound_` grows without bound → OOM.
**Root cause:** No backpressure: reads are re-armed regardless of how much un-sent data is queued.
**Fix:** Gate `do_read()` on a high-water mark; pause reading when `outbound_` bytes exceed it, resume in the write-completion handler when below a low-water mark.

## Practice Tips

- **Lifetime first.** When a Proactor server crashes intermittently under load with detached stacks, suspect Bug 1/2/5/10 (use-after-free / dangling buffer) before anything else. Reproduce under **AddressSanitizer**.
- **Races second.** Mysterious wrong results on multi-threaded `io_context` → Bug 8. Run under **ThreadSanitizer**; prefer strands or per-core sharding.
- **Semantics third.** Wrong/short data → Bug 3/4/11 (partial reads, buffer positions).
- **Always handle `operation_aborted`** explicitly before generic error handling.
- **One outstanding write per socket** — serialize via an outbound queue.
- Add **backpressure** to every read loop that can outrun its consumer.
