# Proactor — Tasks

> Hands-on tasks to build Proactor fluency, from a first async echo server to a per-core sharded engine. Primary stack: C++/Boost.Asio; Java NIO.2 alternatives noted. See [junior](junior.md) and [middle](middle.md) for background.

## Table of Contents

1. [Task 1 — Minimal Async Echo](#task-1--minimal-async-echo)
2. [Task 2 — Fixed-Length Framing](#task-2--fixed-length-framing)
3. [Task 3 — Correct Lifetime](#task-3--correct-lifetime)
4. [Task 4 — Idle Timeout](#task-4--idle-timeout)
5. [Task 5 — Multi-Threaded + Strands](#task-5--multi-threaded--strands)
6. [Task 6 — Coroutine Rewrite](#task-6--coroutine-rewrite)
7. [Task 7 — Backpressure](#task-7--backpressure)
8. [Task 8 — TCP Proxy](#task-8--tcp-proxy)
9. [Task 9 — Per-Core Sharding](#task-9--per-core-sharding)
10. [Task 10 — Async File Copier](#task-10--async-file-copier)
11. [How to Practice](#how-to-practice)

---

## Task 1 — Minimal Async Echo

**Goal:** Implement the simplest possible Proactor echo server.
**Requirements:** Accept connections asynchronously; for each, `async_read_some` then `async_write` the same bytes back, then loop. Re-arm the acceptor.
**Hints:** Use `io_context`, `tcp::acceptor::async_accept`, and capture state in a `Session` class. Don't forget to call `io.run()`.
**Solution sketch:** A `Session` with a `std::array<char,1024> buffer_`, methods `do_read`/`do_write` chaining each other in their completion handlers; `main` runs an `async_accept` loop that `make_shared<Session>(...)->start()`. *Java:* `AsynchronousServerSocketChannel.accept` + nested `CompletionHandler`s.

## Task 2 — Fixed-Length Framing

**Goal:** Read length-prefixed messages: 4-byte big-endian length, then that many body bytes.
**Requirements:** Use `async_read` (full read), not `async_read_some`, so partial reads are handled. Echo each full message.
**Hints:** Two-stage read: header completion decodes length, then initiates the body read sized to that length.
**Solution sketch:** `read_header()` reads into a 4-byte buffer; its handler computes `len` and calls `read_body(len)` which resizes a `std::vector<char>` and `async_read`s exactly `len` bytes. Validate `len` against a max to avoid OOM from a malicious length.

## Task 3 — Correct Lifetime

**Goal:** Make the session provably safe against use-after-free.
**Requirements:** The session must not be destroyed while any async op is pending; the buffer must outlive every op.
**Hints:** `std::enable_shared_from_this`; capture `auto self = shared_from_this()` in every handler lambda.
**Solution sketch:** Sessions are only ever held by `shared_ptr`. Each handler captures `self`, so the refcount stays ≥1 until the last outstanding completion fires. Verify by running under AddressSanitizer with rapid connect/disconnect churn.

## Task 4 — Idle Timeout

**Goal:** Close connections idle for >30 seconds.
**Requirements:** A per-connection `steady_timer` armed before each read; if it fires first, `socket.cancel()`; if the read completes first, cancel the timer.
**Hints:** `cancel()` causes pending ops to complete with `operation_aborted` — handle that as a normal close, not an error to log loudly.
**Solution sketch:** `arm_timeout()` sets `expires_after(30s)` and `async_wait`; on fire, `socket_.cancel()`. Read handler calls `timer_.cancel()` on entry. Ensure object lifetime survives both the read and timer completions.

## Task 5 — Multi-Threaded + Strands

**Goal:** Run the Proactor on N threads without data races on per-connection state.
**Requirements:** `io.run()` from `hardware_concurrency()` threads; bind every connection handler to that connection's strand.
**Hints:** `asio::strand<...>` created from the socket's executor; wrap handlers with `asio::bind_executor(strand_, handler)`.
**Solution sketch:** Add `strand_` member; bind all `async_read`/`async_write`/timer handlers. Run a stress test with ThreadSanitizer to prove no races on the connection's buffers/state.

## Task 6 — Coroutine Rewrite

**Goal:** Replace the callback chain with an Asio coroutine.
**Requirements:** A single `awaitable<void> session(tcp::socket)` using `co_await async_read/async_write` with `use_awaitable`; `co_spawn` it per accepted socket.
**Hints:** The read buffer becomes a local of the coroutine frame — note how the lifetime hazard largely disappears.
**Solution sketch:** Linear `for(;;){ n = co_await read; co_await write; }` wrapped in try/catch for connection close. Compare line count and readability against Task 2.

## Task 7 — Backpressure

**Goal:** Prevent unbounded memory growth when a client sends faster than you can process/forward.
**Requirements:** Maintain an outbound queue; stop initiating new reads when its size/bytes exceed a high-water mark; resume below a low-water mark.
**Hints:** Track outstanding bytes; gate `do_read()` on the watermark.
**Solution sketch:** A bounded `std::deque` of pending writes; reads pause when `pending_bytes_ > HIGH`; the write-completion handler resumes reads when it drops below `LOW`. Add a counter to a metric to observe pausing under load.

## Task 8 — TCP Proxy

**Goal:** Forward bytes bidirectionally between a client and an upstream.
**Requirements:** `async_connect` to upstream on accept; then two independent async pipes (client→upstream, upstream→client), each read-then-write chained.
**Hints:** Two buffers, two directions; close both sockets when either side EOFs.
**Solution sketch:** A `Pipe` helper does `async_read_some` on src then `async_write` to dst, looping. A `Session` owns both pipes and both sockets via `shared_ptr`. Handle half-close cleanly. Apply Task 7's backpressure per direction.

## Task 9 — Per-Core Sharding

**Goal:** Scale to many cores by sharding connections.
**Requirements:** One `io_context` + thread per core; accept on one, then *assign* each new connection to a shard so its handlers always run on one thread (no strand needed).
**Hints:** Round-robin or hash-by-fd to pick a shard; move the socket into that shard's executor.
**Solution sketch:** Vector of `io_context`s each with a work guard and thread (pinned in prod). The acceptor's handler picks `shard = next++ % cores` and re-creates the socket on `ios[shard]`'s executor before `start()`. Benchmark throughput vs. the single-context version.

## Task 10 — Async File Copier

**Goal:** Copy a large file using overlapping async reads and writes.
**Requirements:** Use async file I/O (`asio::random_access_file` / io_uring file ops, or Win32 overlapped `ReadFile`/`WriteFile`); keep multiple operations in flight.
**Hints:** Maintain a window of K outstanding read/write ops to saturate the device; track offsets.
**Solution sketch:** Ring of K buffers; each read completion at offset O initiates a write at O, whose completion initiates the next read. Compare wall-clock against a naive synchronous copy and against io_uring with registered buffers.

## How to Practice

- Do tasks **in order** — each builds on the last; 1→3 establish correctness, 4→7 production-hardening, 8→10 scale.
- **Always run under sanitizers** (ASan for lifetime bugs, TSan for races) — Proactor's worst bugs are invisible without them.
- After Task 6, **rewrite earlier tasks as coroutines** to feel the readability difference.
- **Benchmark** Tasks 9 and 10 with varying connection counts / message sizes; observe where Proactor's edge widens (high connections) and narrows (few large ops).
- For each task, **inject faults** (`eof`, `connection_reset`, short reads, timeouts) and confirm every error branch is handled.
