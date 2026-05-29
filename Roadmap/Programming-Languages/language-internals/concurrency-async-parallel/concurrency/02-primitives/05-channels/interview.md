# Channels — Interview Questions

> **Topic:** [Channels](README.md)

---

## Introduction

Channels are typed conduits for communicating values between concurrent tasks. They package three things in a single primitive: data transfer, synchronization, and ownership transfer. A send and a receive together form a synchronization edge — the receiver is guaranteed to observe everything the sender wrote before the send. That makes channels not just a queue but a memory model device.

Interviewers ask about channels because they reveal whether a candidate understands message-passing concurrency or only mutex-based concurrency. Knowing the difference between unbuffered (rendezvous) and buffered channels, when close panics, what `nil` channels do in `select`, and why "share memory by communicating" is more than a slogan separates someone who has shipped concurrent Go from someone who has only read about it.

This file collects questions across languages — Go (the gold standard), Rust (`std::sync::mpsc` and Tokio's family), Clojure `core.async`, and Python `asyncio.Queue`. Most patterns generalize: rendezvous, fan-in, fan-out, oneshot, broadcast, watch, and bounded backpressure show up in every runtime under different names.

Expect a mix of conceptual ("what does close mean?"), trap ("send on closed?"), design ("rate limit 1000 RPS with a channel"), and coding ("write a worker pool"). The coding questions in this file include runnable Go solutions; treat the sample code as a starting point, not the only valid answer.

---

## Table of Contents

1. [Conceptual / Foundational](#conceptual--foundational)
2. [Language-Specific](#language-specific)
3. [Tricky / Trap](#tricky--trap)
4. [System / Design Scenarios](#system--design-scenarios)
5. [Coding Questions](#coding-questions)
6. [Behavioral](#behavioral)
7. [What I'd Ask a Candidate Now](#what-id-ask-a-candidate-now)
8. [Cheat Sheet](#cheat-sheet)
9. [Further Reading](#further-reading)
10. [Related Topics](#related-topics)

---

## Conceptual / Foundational

### Q: What is a channel and how is it different from a shared variable plus a lock?

A channel is a typed FIFO conduit for sending values between concurrent tasks. It bundles three operations atomically: data transfer (the value moves), synchronization (sender and receiver coordinate), and ownership transfer (the receiver now owns the value). A shared variable plus a lock provides only mutual exclusion — every reader and writer must agree on the protocol externally. With a channel, the protocol is the type. A `chan int` says "values flow one direction at a time, in order" without any auxiliary state. Channels also make handoff explicit, which makes data races impossible at the language level (you cannot accidentally read a half-written struct because the send is atomic). The cost is a slight performance overhead and a different mental model that takes practice.

### Q: What is the difference between an unbuffered and a buffered channel?

An unbuffered channel has zero capacity. A send blocks until a receiver is ready, and a receive blocks until a sender is ready — the two operations synchronize as a single event called a rendezvous. A buffered channel has a fixed capacity `N`; sends succeed without blocking as long as the buffer is not full, and receives succeed without blocking as long as the buffer is not empty. Buffered channels weaken synchronization: the sender no longer waits for the receiver, so the sender can race ahead by up to `N` items. Use unbuffered channels when you want the sender to know the receiver has taken the value. Use buffered channels when you want to smooth bursts or batch work, and accept that you have introduced a queue.

### Q: What is a rendezvous and why does it matter?

A rendezvous is the moment when an unbuffered send and receive meet — both goroutines (or threads, or tasks) proceed past the operation at exactly the same logical instant. The matter for two reasons. First, it gives you a synchronization edge in the memory model: everything the sender wrote before the send happens-before everything the receiver does after the receive. Second, it provides backpressure for free — a slow receiver naturally throttles a fast sender because the sender cannot proceed until the value is taken. Rendezvous semantics are the reason Go's mantra "do not communicate by sharing memory; share memory by communicating" works without explicit locks.

### Q: What does closing a channel mean, and what are its semantics?

Closing a channel signals that no more values will be sent. After close, receivers can drain any buffered values; once the buffer is empty, receives return the zero value with `ok == false`. The two-value receive form `v, ok := <-ch` distinguishes a real send from a closed-and-drained channel. A `range` loop over a channel exits cleanly when the channel is closed and drained. Closing is a one-shot signal: closing an already-closed channel panics, and sending on a closed channel panics. The convention is that the sender closes (because only the sender knows when it is done). With multiple senders, you need an external coordinator — closing from a receiver is almost always wrong.

### Q: What happens when you range over a channel?

`for v := range ch` repeatedly receives from `ch` and binds each value to `v`. The loop exits when `ch` is closed and drained. If the channel is never closed, the loop blocks forever on the final receive — this is a common goroutine leak. Range gives you idiomatic iteration without writing the `v, ok := <-ch; if !ok { break }` boilerplate. It works on both buffered and unbuffered channels. Range is the most readable way to consume a stream of values when you know the producer will close the channel when finished.

### Q: What is `select` and why is it the most important channel operation?

`select` lets a goroutine wait on multiple channel operations simultaneously and proceed with whichever is ready first. If multiple cases are ready, one is chosen at random (uniformly). If none is ready, `select` blocks; if a `default` case is present, the `default` runs immediately, making the select non-blocking. Select is the most important channel operation because it composes channels into larger patterns: timeout (`<-time.After(d)`), cancellation (`<-ctx.Done()`), fan-in (multiple input channels), and priority. Without `select`, channels would be linear pipes; with `select`, they become a coordination algebra.

### Q: What are directional channel types and why use them?

A bidirectional `chan T` can be restricted to send-only `chan<- T` or receive-only `<-chan T` at function boundaries. The restriction is purely a compile-time check — at runtime it's the same channel. Use directional types in function signatures to document and enforce intent: a producer takes `chan<- T`, a consumer takes `<-chan T`. This prevents bugs like accidentally closing a channel from the consumer side or sending where you meant to receive. It also makes function signatures self-documenting; a reader knows at a glance which side of the pipe each function is on.

### Q: How can you use a channel as a semaphore?

A buffered channel with capacity `N` is a counting semaphore that limits concurrency to `N`. Acquire with `sem <- struct{}{}` (blocks if `N` slots are in use), release with `<-sem`. This pattern bounds the number of concurrent goroutines doing some expensive work — for example, limiting concurrent HTTP requests to a downstream service. The `struct{}` value carries no data and takes zero bytes, so the channel is purely a synchronization device. It is simpler than `sync.Semaphore` (which Go's standard library doesn't even provide directly) and integrates cleanly with `select` for cancellation: `select { case sem <- struct{}{}: ...; case <-ctx.Done(): ... }`.

### Q: How is a channel different from a queue?

A queue is a data structure: enqueue, dequeue, maybe peek, maybe a size method. A channel is a synchronization primitive that happens to behave like a queue. The differences matter. Channels block on full sends and empty receives by default — queues typically return an error or null. Channels integrate with `select` for multiplexing; queues do not. Channels carry a memory-model guarantee (happens-before across send/receive); generic queues do not. Channels are typed at the language level; queues are usually generic containers. If you only need to pass data without coordination, a lock-free queue might be faster; if you need coordination, a channel is the right primitive.

### Q: What do SPSC, MPSC, and MPMC mean for channels?

SPSC is single-producer single-consumer, MPSC is multi-producer single-consumer, and MPMC is multi-producer multi-consumer. Go's `chan T` is MPMC by default — any number of goroutines can send and receive concurrently. Rust's `std::sync::mpsc` is MPSC by design: you get many `Sender`s (cloneable) but exactly one `Receiver`. Tokio's `mpsc` is also MPSC; for SPSC use `oneshot`, for broadcast use `broadcast`. The terminology matters because the implementation can be much faster for restricted shapes — an SPSC ring buffer needs no locks, while an MPMC channel typically does. When choosing a channel type, match the topology to the cardinality of producers and consumers.

### Q: What is the happens-before relationship for channel operations?

In Go's memory model, a send on a channel happens-before the corresponding receive completes. This means: if goroutine A writes to variable `x` and then sends on `ch`, and goroutine B receives from `ch` and then reads `x`, B is guaranteed to see A's write. The channel acts as a synchronization edge. For unbuffered channels, the receive happens-before the send completes (counterintuitive but correct — the rendezvous publishes the value, then the sender proceeds). For buffered channels, the `k`-th receive happens-before the `(k+N)`-th send completes, where `N` is the buffer size. These rules let you reason about visibility without locks.

### Q: When should you NOT use a channel?

When you have a single shared counter or flag, an atomic is faster and simpler. When multiple readers and writers operate on shared state that doesn't have a natural "ownership transfer" pattern, a mutex is clearer. When you need broadcast (one sender, many receivers, every receiver gets every value), channels are awkward — use `sync.Cond`, a broadcast channel type, or per-receiver channels. When performance is critical and the work is fine-grained, channel overhead (typically hundreds of nanoseconds per operation in Go) can dominate. The mantra "share memory by communicating" doesn't mean "always use channels" — it means prefer channels where they fit naturally.

### Q: What is fan-in and fan-out with channels?

Fan-out distributes work from one channel to many workers — typically a single producer channel feeding `N` worker goroutines that range over it. Each value goes to exactly one worker (because each receive consumes the value). Fan-in merges multiple channels into one — typically `N` producer goroutines each writing to a shared output channel, or a helper that selects across input channels and forwards to a single output. Together they form pipelines: producer → fan-out → workers → fan-in → consumer. The pattern scales horizontally; you can tune worker count without changing the topology.

### Q: How do channels interact with garbage collection and leaks?

A goroutine blocked on a channel that will never be ready is leaked — the GC cannot collect it because the runtime considers it live. Common causes: a goroutine ranges over a channel that is never closed; a goroutine sends on a channel after the receiver has exited; a goroutine waits in a `select` with no `ctx.Done()` case while the parent has moved on. Channels themselves are heap-allocated and garbage collected when no goroutine holds a reference. The practical rule: every goroutine that sends or receives on a channel should have a clear termination path, usually via a context or done channel in the `select`. If you cannot answer "how does this goroutine exit?" you probably have a leak.

### Q: What is the difference between a closed channel and a nil channel?

A closed channel returns zero values on receive (with `ok == false`) and panics on send. A nil channel blocks forever on both send and receive — operations on it never complete. In a `select`, a nil channel case is silently skipped, which is the basis for a powerful pattern: setting a channel variable to nil to disable a case dynamically. For example, in a "drain then exit" loop, you might nil out the input channel once it's closed so the select stops trying to read from it. Confusing these two states (closed vs nil) is a common source of bugs; remember: closed = "done", nil = "disabled".

---

## Language-Specific

### Q: In Go, why does sending on a closed channel panic instead of returning an error?

Because there is no meaningful recovery. A send on a closed channel indicates a programming error — the sender did not coordinate with whoever closed the channel. Returning an error would require every send site to check it, which would defeat the simplicity of `ch <- v`. The panic surfaces the bug immediately at the offending goroutine. The standard pattern to avoid this is "only the sender closes, and only when no more sends will happen." When you have multiple senders, you typically use a separate done channel or a coordinating goroutine that closes the data channel after all senders have signaled completion.

### Q: In Go, what does `select {}` (empty select) do?

It blocks forever. An empty `select` has no cases that can ever be ready, so the goroutine parks indefinitely. It is occasionally used in `main` to keep a program alive after spawning background goroutines, though `<-make(chan struct{})` or a signal handler is usually clearer. It is a Go idiom worth recognizing because it's a one-line "block forever" expression. In production code, an empty select usually indicates the author wanted something more specific (waiting on signals, context, or work) and wrote the wrong thing.

### Q: In Go, how do you implement a timeout with channels?

Use `time.After(d)` inside a `select`. `time.After` returns a `<-chan time.Time` that fires after the duration. Combine it with the work channel: `select { case v := <-work: ...; case <-time.After(5*time.Second): return ErrTimeout }`. The pattern is concise and composable. Caveat: `time.After` allocates a new timer each call; if the surrounding select runs in a hot loop, prefer `time.NewTimer` with manual `Stop` and `Reset` to avoid timer churn. For cancellation that's not strictly time-based, prefer `<-ctx.Done()`.

### Q: In Go, how do you signal cancellation through a channel?

The idiomatic way is `context.Context`. The context's `Done()` method returns a `<-chan struct{}` that closes when the context is canceled. Goroutines select on it: `select { case <-ctx.Done(): return ctx.Err(); case ... }`. Closing (rather than sending) is the right primitive because close is broadcast — every receiver sees the close, no matter how many. Sending on a single channel only reaches one receiver. Before contexts, the convention was a `chan struct{}` named `done` that the parent closed; contexts standardize this pattern and add deadline propagation.

### Q: In Go, what happens if you set a channel variable to nil inside a select loop?

The case using that nil channel is permanently disabled for the rest of the loop iterations (until you assign a non-nil channel back). Operations on a nil channel block forever, and `select` treats blocking cases as unready, so it simply skips them. This is used to "remove" a case after it has done its job. Classic example: a pipeline stage that reads from input until closed, then sets `input = nil` so the select stops trying and only listens for the output or done channel. It's an elegant trick that avoids restructuring the loop.

### Q: In Go, what's the difference between `len(ch)` and `cap(ch)`?

`cap(ch)` returns the channel's capacity — the size set at `make(chan T, N)`. `len(ch)` returns the current number of buffered values waiting to be received. For unbuffered channels both are 0. These values are useful for debugging or metrics but are race-prone — by the time you act on them, the values may have changed. Don't use `len(ch)` to decide whether to send (someone could fill the buffer between your check and your send); use `select` with a `default` instead. They're observability, not control flow.

### Q: In Go, how would you build a non-blocking send?

Use `select` with a `default` case: `select { case ch <- v: sent = true; default: sent = false }`. If `ch` cannot accept the send immediately (unbuffered with no receiver, or buffered and full), the `default` runs and you handle the drop. This is the only way to do non-blocking channel operations in Go. The same trick works for non-blocking receive. Use it sparingly — non-blocking sends often indicate a backpressure design problem you should solve at the topology level instead.

### Q: In Go, what is the pattern for closing a channel with multiple senders?

The senders themselves cannot close, because the second sender to call close panics. The standard solution is a coordinator: each sender signals completion (via a `sync.WaitGroup` or a per-sender done channel), and a single coordinating goroutine closes the data channel after all senders have finished. Alternative: have senders send through a layer of buffering owned by a single goroutine, which closes the downstream channel when its upstream signals are all complete. The "only one closer" rule is non-negotiable; the question is who that one closer is.

### Q: In Go, how does `select` choose between ready cases?

Uniformly at random. The Go runtime evaluates all cases, finds the ready ones, and picks one with equal probability. This is important for fairness: without randomization, a busy channel could starve other cases. Do not rely on a specific case being picked; if you need priority, use nested selects (outer for high priority with a `default` that runs a nested select for low priority) or design the topology so priority is enforced structurally. The randomization is intentional and not configurable.

### Q: In Go, when should you use a channel of channels?

When you need to return a channel from a request — typically for reply patterns. The client sends a request struct that includes a reply channel; the server processes the request and sends the response on the reply channel. This is the "request/reply" or "oneshot" pattern. A channel of channels is also used in some worker-pool designs where workers register themselves by sending their own input channel into a shared "available workers" channel. It's a powerful idiom but can be hard to read; comment generously.

### Q: In Rust's `std::sync::mpsc`, why is the receiver not `Clone`?

Because it's a multi-producer, single-consumer channel by design. The `Sender<T>` is `Clone` so you can hand copies to many threads, but `Receiver<T>` is not — only one task can pull from it. This is a deliberate simplification: SPSC and MPSC channels can use simpler, faster internal queues than MPMC channels. If you need multiple consumers, you wrap the receiver in a `Mutex` (slow) or reach for a different channel like `crossbeam::channel` (MPMC) or build a dispatcher that fans out. The single-receiver constraint catches design mistakes at compile time.

### Q: In Tokio, what is the difference between `mpsc`, `broadcast`, `watch`, and `oneshot`?

`mpsc` is multi-producer single-consumer with a bounded buffer — the default for backpressured work queues. `broadcast` is multi-producer multi-consumer where every receiver sees every value; slow receivers can lag and miss values. `watch` is a single-value channel that holds the latest value; receivers see the most recent, not the history — perfect for config updates. `oneshot` is a single-use channel for one value: ideal for request/reply where you need a future-shaped reply slot. Picking the right one is half the design; the wrong choice forces awkward workarounds.

### Q: In Tokio, what happens when a `mpsc::Receiver` is dropped?

All future sends from senders return `Err(SendError)`, because there is no one to receive. Senders should handle this — typically by logging and exiting, since their work product has nowhere to go. Tasks that are blocked in `send().await` are woken up with the error. This is a graceful shutdown signal: drop the receiver to tell all producers "stop." It mirrors Go's "close the channel" pattern but inverted — in Tokio, the consumer signals end-of-stream by going away, while in Go the producer signals it by closing.

### Q: In Tokio, why is `mpsc::channel` bounded while `unbounded_channel` exists separately?

Because bounded is the safe default. A bounded channel applies backpressure — when the buffer is full, senders await space, throttling producers to consumer speed. An unbounded channel will happily eat memory if the consumer falls behind, eventually OOMing the process. Tokio puts the bounded version under the obvious name `channel` and forces you to type `unbounded_channel` if you really want it. The bounded version's `send` is async (it might wait); the unbounded version's `send` is sync (it never waits, because there's always room). Choose unbounded only when you can prove producers are slower than consumers.

### Q: In Tokio, what's the right way to do a request/reply across tasks?

Use `oneshot`. The requester creates a `(tx, rx)` pair, sends the request along with `tx` to the worker via an `mpsc`, and awaits `rx`. The worker processes the request and sends the response on `tx`. `oneshot` is the right primitive because it's single-use and zero-buffer — exactly what request/reply needs. The pattern composes with timeout via `tokio::time::timeout(d, rx)` so the requester gives up gracefully. This is how many actor frameworks implement "ask" semantics.

### Q: In Clojure `core.async`, what is the difference between `<!` and `<!!`?

`<!` is the parking take, usable only inside a `go` block. It cooperatively yields the underlying thread back to the pool until the channel has a value. `<!!` is the blocking take, usable from any thread, that actually blocks the calling thread. The same distinction holds for `>!` (parking put) and `>!!` (blocking put). The parking forms are non-blocking from the JVM thread's perspective, so you can multiplex thousands of `go` blocks onto a small thread pool. Mixing them up is a common beginner mistake: using `<!` outside `go` is a compile error, but using `<!!` inside `go` blocks the thread and undoes the parking benefit.

### Q: In Clojure `core.async`, what does `alts!` do and how does it differ from `select`?

`alts!` takes a vector of channel operations (takes, puts) and returns the first one that becomes ready, along with the channel it came from. It's the analog of Go's `select`. Like `select`, it can include a `:default` case for non-blocking behavior and a `:priority true` flag to evaluate cases in order rather than randomly. Unlike Go's `select`, the syntax is a data structure (a vector of operations) rather than a control-flow form — which makes it composable: you can build the case list dynamically. This is a small but real win for programs that need to wait on a variable number of channels.

### Q: In Clojure `core.async`, when should you use a transducer-equipped channel?

When you want stream transformations (map, filter, mapcat, dedupe) to happen at the channel boundary rather than in a separate `go` block. `(chan 10 (map inc))` creates a buffered channel that increments every value it carries. The transducer runs on the producer side, so filtered-out values never consume buffer slots. This composes elegantly: a single channel becomes a typed processing stage. The alternative — a downstream `go` that maps over the channel — is more verbose and adds a goroutine. Use channel transducers for simple per-element transforms; use dedicated stages for anything stateful or expensive.

### Q: In Python `asyncio.Queue`, how is it different from a Go channel?

`asyncio.Queue` is a queue you `await` on; it's bounded if you set `maxsize`. The main differences: it doesn't carry a memory-model guarantee (Python has the GIL, which handles that), it doesn't compose with `select` (asyncio uses `asyncio.wait` or `asyncio.as_completed` instead), and there's no "close" semantics built in. The convention for "no more items" is to put a sentinel like `None` and have consumers stop when they see it. The lack of close is a real ergonomic gap; you handle it by protocol. For broadcast, asyncio offers `Condition` and various third-party event buses; the standard library doesn't have a one-line equivalent of a closed channel.

### Q: In Python `asyncio.Queue`, what is `task_done` and `join` for?

`task_done` signals that an item taken from the queue has been fully processed. `join` blocks until every item that was ever put has had a matching `task_done`. Together they implement "wait for all work to drain." This is a half-step toward Go's `sync.WaitGroup` baked into the queue. Use it for worker-pool shutdown: producer puts N items, awaits `queue.join()`, then knows all consumers have finished. Forgetting `task_done` causes `join` to hang forever — a classic asyncio bug.

### Q: In Python `asyncio.Queue`, can multiple coroutines safely consume from one queue?

Yes — `asyncio.Queue` is designed for many producers and many consumers within a single event loop. Internally it's safe because the event loop is single-threaded; only one coroutine runs at a time. If you span threads, you need `janus.Queue` or similar, because `asyncio.Queue` is not thread-safe. The single-loop assumption is the asyncio model; cross-thread queueing is a separate problem with its own primitives. For pure async workloads in one loop, `asyncio.Queue` is an MPMC channel without the broadcast.

---

## Tricky / Trap

### Q: What happens if you send on a closed channel?

The send panics with "send on closed channel." The wrong intuition is "it returns false" or "it silently drops." Go chose panic because a send on a closed channel almost always means the sender doesn't know it should have stopped — a programming error that should fail loudly rather than continue silently. The standard pattern to avoid this: only the sender closes, and only when it knows no more sends will occur. With multiple senders, you need an explicit coordinator. Defensive techniques like wrapping every send in `defer recover()` are anti-patterns that paper over a design bug.

### Q: What happens if you close an already-closed channel?

It panics with "close of closed channel." This catches the common mistake of having two goroutines that both think they own the close. The wrong intuition is "close is idempotent." It is not — close is a one-shot transition, and re-closing is treated as an ownership violation. The fix is structural: have exactly one goroutine close the channel, and use other signals (WaitGroups, done channels) to coordinate when. If you're tempted to write `sync.Once` around a close, ask first whether the design has the wrong number of closers.

### Q: What happens if you range over a channel that is never closed?

The range loop blocks forever on the final iteration. Receives succeed as long as values come in; once the producer stops sending but doesn't close, the receive blocks. The wrong intuition is "the loop will exit when there are no more values." Without close, the loop has no way to know "no more values" versus "no more values yet." This is one of the most common goroutine leaks in Go. Fix: ensure the producer closes when done, or use a done channel and `select` instead of `range`.

### Q: What does a `select` do if all its channel cases are nil?

It blocks forever (assuming no `default`). Operations on nil channels never become ready, so `select` parks the goroutine indefinitely. The wrong intuition is "nil cases are skipped and the select returns immediately." Skipped, yes; returning, no — if all cases are nil and there's no default, there's nothing to do but wait. This is occasionally a feature (a permanently-blocked goroutine to keep a program alive), more often a bug (you nilled out cases prematurely). Add a `<-ctx.Done()` case so the goroutine can always exit.

### Q: How can a forgotten `select` case leak goroutines?

If you start a goroutine that selects on a worker channel but not on a cancellation signal, and the worker channel never sends, the goroutine waits forever. Even if the parent goroutine returns, the child is parked, holding references to whatever closures it captured. Over time, leaked goroutines accumulate until `runtime.NumGoroutine` climbs and memory grows. The fix is to always include a `<-ctx.Done()` case in every long-lived select. Treat "how does this goroutine exit?" as a mandatory review question.

### Q: What goes wrong with a slow consumer and an unbounded buffer?

The producer races ahead, the buffer grows without bound, and memory usage climbs until OOM. The wrong intuition is "an unbounded buffer is safer because nothing blocks." In reality, blocking is the feature — it's backpressure. Without it, fast producers and slow consumers have no coordination, and the queue is the only thing absorbing the mismatch. Use bounded channels by default. If you think you need unbounded, prove that the producer is rate-limited externally (by a network, by user input) so the queue size has a natural cap.

### Q: Why is closing a channel from the receiver almost always wrong?

Because the receiver doesn't know whether the sender is still working. After the receiver closes, any subsequent send by the sender will panic. The wrong intuition is "the receiver knows it's done, so it should signal that." But "the receiver is done" is not the same as "the sender is done" — they're different goroutines with different state. The correct signal from receiver to sender is a separate cancellation channel or a context: the receiver cancels, the sender notices and exits, and the sender (or a coordinator) closes the data channel.

### Q: What's wrong with `for { select { case v := <-ch: ...; default: } }`?

It's a busy-loop. The `default` makes the select non-blocking, so when `ch` has no value, the default fires immediately and the loop spins on the CPU. The wrong intuition is "default makes it efficient." Default is for non-blocking checks, not for polling loops. Either remove `default` (so the select blocks until something is ready) or, if you really need polling, add a `<-time.After(d)` case so the loop yields. CPU-bound busy loops on channels are easy to spot in profilers but easy to write by accident.

### Q: What's wrong with `go func() { ch <- compute() }()` when nobody receives?

If no one receives from `ch`, the goroutine blocks on the send forever, leaking. The wrong intuition is "the goroutine will be garbage collected when nothing references it." Blocked goroutines are roots — the runtime considers them live, and they pin everything they capture. This pattern is common in code that "tries to be helpful" by launching work in the background. Always ensure a receiver exists, or use a buffered channel of capacity 1 if the result might be discarded.

### Q: Why might `select { case ch <- v: }` block even when `ch` has buffer space?

If `ch` was closed before the send. A buffered closed channel still panics on send — the buffer doesn't save you. The wrong intuition is "buffer space means the send succeeds." Send semantics depend on the channel's state (open vs closed), not just buffer availability. Close + send-buffer is one of the trickiest bug shapes because it's intermittent: works in tests where close happens late, fails in production where close races with sends.

### Q: What happens if you `range` over a buffered channel after closing it?

You receive any buffered values, then the loop exits. Close doesn't drop pending values; it just means "no more new ones." The wrong intuition is "close empties the channel." It doesn't. This is actually the intended graceful shutdown: producer sends N values, closes, consumer drains all N and then exits the range cleanly. This behavior matters when designing shutdowns — you don't lose in-flight work just because you closed.

### Q: Is `len(ch)` safe to use for flow control?

No. The value is a snapshot that can change immediately. By the time you act on it ("the channel has space, I'll send"), another goroutine may have filled the buffer. The wrong intuition is "len(ch) is atomic so I can use it." It's atomic to read, but not stable. For flow control, use `select` with `default` for non-blocking send or use the blocking semantics directly. `len(ch)` is for observability — metrics, debug logs — not for decisions.

### Q: What happens if you close a nil channel?

It panics with "close of nil channel." The wrong intuition is "close on nil is a no-op like delete on nil map." Close has stricter contracts. The fix is to either ensure the channel is initialized before closing or guard with `if ch != nil { close(ch) }`. This usually indicates a code path that didn't initialize the channel, which is itself worth fixing.

### Q: How can `select` cause priority inversion?

If you have a high-priority case (e.g., cancellation) and a low-priority case (e.g., work) in the same select, both being ready means random choice — sometimes the cancellation fires, sometimes work proceeds. The wrong intuition is "the first case listed is preferred." Order doesn't matter in Go's select. To enforce priority, structure as nested selects: outer select checks cancellation first with a `default` that falls through to the inner select for normal work. This idiom is common in long-running pipelines that need strict shutdown semantics.

### Q: Why does `time.After` in a long-running select leak memory?

Each call to `time.After` allocates a new timer that fires once. In a hot loop, you allocate a timer per iteration, and the runtime holds them until they fire (default duration). The wrong intuition is "the unused timers are immediately collected." They aren't — they're scheduled. For long-running selects with a per-iteration timeout, use `time.NewTimer` once, then `Stop` and `Reset` it each iteration, or restructure so the timeout is set up outside the loop.

---

## System / Design Scenarios

### Q: Design a fan-out to N backends and aggregate the first K responses.

Spawn N goroutines, each making a request and writing its result to a shared channel. Use a buffered channel of size N so no sender blocks even if the receiver is slow. Have the aggregator receive K times, then cancel the remaining requests via context. The cancellation is critical: without it, the N-K stragglers leak. The aggregator returns once it has K results or all N have replied. Use `select` over the result channel and `<-ctx.Done()` so the caller can also cancel. This is the standard "scatter-gather" pattern; tune K based on your latency vs. confidence trade-off (K=1 is hedged requests; K=majority is quorum).

### Q: Design a multi-stage pipeline with cancellation.

Each stage is a goroutine that reads from its input channel, processes, and writes to its output channel. Stages connect: source → stage1 → stage2 → ... → sink. Pass a `context.Context` to each stage; every send and receive is wrapped in a `select` that also listens on `<-ctx.Done()`. When cancellation fires, every stage drops its current work and closes its output (or returns), letting downstream stages drain and exit. The producer closes its output when done; each stage closes its output when its input is closed and drained. This composes naturally and shuts down cleanly. The key discipline is: every channel op is in a select with ctx.

### Q: Design a token-bucket rate limiter using a channel.

A buffered channel of capacity `B` (the burst) is filled by a ticker goroutine at the desired rate `R` per second. Each request takes a token by receiving from the channel: `<-tokens`. If empty, the receive blocks until the next refill. The ticker uses `time.NewTicker(time.Second/R)` and sends a token each tick; if the buffer is full, it drops the token (with a non-blocking send) to enforce the cap. This gives you a smooth rate limit with burst tolerance and natural backpressure. Cancellation: select with `<-ctx.Done()` so requests can give up. For 1000 RPS, R=1000 and the ticker fires every 1ms, which is fine on modern hardware.

### Q: Design a chat server with channel-per-room.

Each room has a dedicated goroutine and a channel of incoming messages. Clients in the room are tracked by the room goroutine and receive via per-client send-only channels. When a message arrives at the room channel, the goroutine fans it out to each client's channel. New clients send a "join" message; leaving clients send "leave"; the room goroutine maintains the membership list. Per-client channels are buffered (small, e.g., 16) and use non-blocking send — if a client falls behind, the room drops messages for that client or disconnects them rather than blocking the whole room. This isolates failure: one slow client cannot stall the room.

### Q: Design a producer with bounded retry that drops on persistent failure.

The producer sends to a result channel; if the consumer is slow (channel full), the producer retries with backoff via a `select` that times out. After N failed attempts, it drops the message and increments a dropped-count metric. Implementation: `for attempt := 0; attempt < N; attempt++ { select { case ch <- msg: return nil; case <-time.After(backoff): backoff *= 2 } }; return ErrDropped`. The bounded retry combined with backoff means the producer never blocks indefinitely, and dropping after N is a graceful degradation. Pair this with monitoring on the drop rate to detect chronic capacity problems.

### Q: Design a worker pool that processes jobs and supports graceful shutdown.

Create a jobs channel (buffered, sized to absorb bursts) and a context for cancellation. Spawn N worker goroutines, each ranges over the jobs channel and processes each job, but the processing is inside a select that also watches `<-ctx.Done()`. The dispatcher pushes jobs into the channel. On shutdown, close the jobs channel (no more new work) and cancel the context (in-flight work should stop). Workers exit when the channel is drained and closed. Use a WaitGroup to wait for all workers to finish, ensuring you don't shut down the process before in-flight work cleans up. This is the canonical Go worker pool.

### Q: Design a request/reply pattern over channels.

The caller creates a per-request reply channel (oneshot in Tokio terms; an unbuffered or capacity-1 channel in Go) and sends a request struct that embeds the reply channel: `{ Args, Reply chan Response }`. The server receives requests, processes them, and writes the response to the embedded reply channel. The caller waits on the reply channel with a timeout. Use capacity-1 buffered channels for the reply so the server can write and return without blocking on the caller. This is how RPC-style communication maps onto channel primitives.

### Q: Design a publish-subscribe with channels.

Per-subscriber channels, owned by a broker goroutine. Subscribers register by sending a "subscribe" message that includes a return channel for delivered events; unsubscribe by sending an "unsubscribe" with the same channel. The broker has a registry (map of subscriber ID to channel). When a publish arrives, it iterates the registry and sends (non-blocking) to each channel. Slow subscribers don't block the broker because sends are non-blocking; instead, slow subscribers see dropped messages. For "no drops" semantics, the broker can block per subscriber — but that ties broker liveness to subscriber speed, so design carefully.

---

## Coding Questions

### Q: Implement a bounded buffer (producer/consumer) using a channel.

```go
package main

import (
 "context"
 "fmt"
 "time"
)

// BoundedBuffer is a wrapper to demonstrate the pattern; in practice the channel itself is the buffer.
type BoundedBuffer struct {
 ch chan int
}

func NewBoundedBuffer(capacity int) *BoundedBuffer {
 return &BoundedBuffer{ch: make(chan int, capacity)}
}

func (b *BoundedBuffer) Put(ctx context.Context, v int) error {
 select {
 case b.ch <- v:
  return nil
 case <-ctx.Done():
  return ctx.Err()
 }
}

func (b *BoundedBuffer) Get(ctx context.Context) (int, error) {
 select {
 case v := <-b.ch:
  return v, nil
 case <-ctx.Done():
  return 0, ctx.Err()
 }
}

func main() {
 buf := NewBoundedBuffer(3)
 ctx, cancel := context.WithTimeout(context.Background(), time.Second)
 defer cancel()

 go func() {
  for i := 0; i < 5; i++ {
   _ = buf.Put(ctx, i)
   fmt.Println("put", i)
  }
 }()

 for i := 0; i < 5; i++ {
  v, err := buf.Get(ctx)
  if err != nil {
   fmt.Println("get err:", err)
   return
  }
  fmt.Println("got", v)
 }
}
```

### Q: Write a `FanIn` helper that merges N channels into one.

```go
package main

import (
 "fmt"
 "sync"
)

func FanIn[T any](inputs ...<-chan T) <-chan T {
 out := make(chan T)
 var wg sync.WaitGroup
 wg.Add(len(inputs))
 for _, in := range inputs {
  go func(ch <-chan T) {
   defer wg.Done()
   for v := range ch {
    out <- v
   }
  }(in)
 }
 go func() {
  wg.Wait()
  close(out)
 }()
 return out
}

func main() {
 a := make(chan int)
 b := make(chan int)
 go func() { defer close(a); a <- 1; a <- 2 }()
 go func() { defer close(b); b <- 3; b <- 4 }()
 merged := FanIn[int](a, b)
 for v := range merged {
  fmt.Println(v)
 }
}
```

### Q: Implement a fan-out worker pool with N workers.

```go
package main

import (
 "context"
 "fmt"
 "sync"
)

type Job struct {
 ID int
}

type Result struct {
 JobID int
 Out   int
}

func worker(ctx context.Context, id int, jobs <-chan Job, results chan<- Result, wg *sync.WaitGroup) {
 defer wg.Done()
 for {
  select {
  case <-ctx.Done():
   return
  case j, ok := <-jobs:
   if !ok {
    return
   }
   // simulated work
   results <- Result{JobID: j.ID, Out: j.ID * 2}
   _ = id
  }
 }
}

func RunPool(ctx context.Context, n int, jobs <-chan Job) <-chan Result {
 results := make(chan Result)
 var wg sync.WaitGroup
 wg.Add(n)
 for i := 0; i < n; i++ {
  go worker(ctx, i, jobs, results, &wg)
 }
 go func() {
  wg.Wait()
  close(results)
 }()
 return results
}

func main() {
 jobs := make(chan Job)
 ctx, cancel := context.WithCancel(context.Background())
 defer cancel()
 go func() {
  defer close(jobs)
  for i := 0; i < 5; i++ {
   jobs <- Job{ID: i}
  }
 }()
 for r := range RunPool(ctx, 3, jobs) {
  fmt.Printf("job %d -> %d\n", r.JobID, r.Out)
 }
}
```

### Q: Implement a ticker that batches incoming events with a debounce window.

```go
package main

import (
 "fmt"
 "time"
)

// Debounce groups events that arrive within `window` and emits each batch.
func Debounce[T any](in <-chan T, window time.Duration) <-chan []T {
 out := make(chan []T)
 go func() {
  defer close(out)
  var batch []T
  timer := time.NewTimer(window)
  timer.Stop()
  for {
   select {
   case v, ok := <-in:
    if !ok {
     if len(batch) > 0 {
      out <- batch
     }
     return
    }
    if len(batch) == 0 {
     timer.Reset(window)
    }
    batch = append(batch, v)
   case <-timer.C:
    if len(batch) > 0 {
     out <- batch
     batch = nil
    }
   }
  }
 }()
 return out
}

func main() {
 in := make(chan int)
 go func() {
  defer close(in)
  for i := 0; i < 10; i++ {
   in <- i
   time.Sleep(40 * time.Millisecond)
  }
 }()
 for batch := range Debounce[int](in, 100*time.Millisecond) {
  fmt.Println("batch:", batch)
 }
}
```

### Q: Implement a oneshot request/reply over a job channel.

```go
package main

import (
 "context"
 "fmt"
 "time"
)

type Request struct {
 N     int
 Reply chan int
}

func server(ctx context.Context, reqs <-chan Request) {
 for {
  select {
  case <-ctx.Done():
   return
  case r := <-reqs:
   // simulate work
   go func(r Request) {
    r.Reply <- r.N * r.N
   }(r)
  }
 }
}

func Ask(ctx context.Context, reqs chan<- Request, n int) (int, error) {
 reply := make(chan int, 1)
 select {
 case reqs <- Request{N: n, Reply: reply}:
 case <-ctx.Done():
  return 0, ctx.Err()
 }
 select {
 case v := <-reply:
  return v, nil
 case <-ctx.Done():
  return 0, ctx.Err()
 }
}

func main() {
 reqs := make(chan Request)
 ctx, cancel := context.WithTimeout(context.Background(), time.Second)
 defer cancel()
 go server(ctx, reqs)
 v, err := Ask(ctx, reqs, 7)
 fmt.Println(v, err)
}
```

### Q: Implement a rate limiter using a token-bucket channel.

```go
package main

import (
 "context"
 "fmt"
 "time"
)

type Limiter struct {
 tokens chan struct{}
}

func NewLimiter(ctx context.Context, rps int, burst int) *Limiter {
 l := &Limiter{tokens: make(chan struct{}, burst)}
 // pre-fill
 for i := 0; i < burst; i++ {
  l.tokens <- struct{}{}
 }
 go func() {
  t := time.NewTicker(time.Second / time.Duration(rps))
  defer t.Stop()
  for {
   select {
   case <-ctx.Done():
    return
   case <-t.C:
    select {
    case l.tokens <- struct{}{}:
    default:
     // bucket full, drop
    }
   }
  }
 }()
 return l
}

func (l *Limiter) Wait(ctx context.Context) error {
 select {
 case <-l.tokens:
  return nil
 case <-ctx.Done():
  return ctx.Err()
 }
}

func main() {
 ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
 defer cancel()
 lim := NewLimiter(ctx, 10, 5)
 for i := 0; i < 20; i++ {
  if err := lim.Wait(ctx); err != nil {
   fmt.Println("stop:", err)
   return
  }
  fmt.Println("tick", i, time.Now().UnixMilli())
 }
}
```

### Q: Implement a `Take(n)` helper that takes the first N from a channel.

```go
package main

import "fmt"

func Take[T any](in <-chan T, n int) <-chan T {
 out := make(chan T)
 go func() {
  defer close(out)
  for i := 0; i < n; i++ {
   v, ok := <-in
   if !ok {
    return
   }
   out <- v
  }
 }()
 return out
}

func main() {
 src := make(chan int)
 go func() {
  defer close(src)
  for i := 0; i < 100; i++ {
   src <- i
  }
 }()
 for v := range Take[int](src, 5) {
  fmt.Println(v)
 }
}
```

---

## Behavioral

### Q: Tell me about a time you used channels (or a channel-like primitive) to simplify a concurrent design.

Pick a real example where you replaced mutex-and-shared-state with a message-passing design and got simpler code. Describe the original design (mutex, condition variable, callback hell, whatever), the channel-based replacement, and what specifically got better — usually it's easier to reason about ownership, easier to test, or easier to add cancellation. Mention any trade-offs (channels have overhead; some patterns are awkward) so the answer feels honest rather than evangelical.

### Q: Tell me about a goroutine leak you debugged.

Walk through the symptoms (memory growth, increasing `runtime.NumGoroutine`, sluggish shutdown), how you diagnosed it (pprof's goroutine profile, stack dumps), and the root cause (usually a send on an unread channel, a range over an unclosed channel, or a select missing `ctx.Done()`). End with the fix and the broader lesson — for me, it usually leads to a "every goroutine must have an exit path" review rule.

### Q: Describe a bug caused by close panics or double close.

Concrete example: two goroutines that both think they own the close because the design was unclear about who the closer is. Talk about the production symptom (process crash on a rare path), the post-mortem finding (race between two paths to close), and the structural fix (single closer with a `sync.Once` only as a band-aid; ideally a coordinator goroutine that's the sole closer). The lesson is that close ownership is part of the API contract.

### Q: Tell me about a design where you intentionally avoided channels.

Maybe a high-throughput counter where atomics were 100x cheaper, or a broadcast pattern where channels were awkward and `sync.Cond` was clearer, or a complex state machine where channels obscured the invariants. The point is to show channel-as-tool not channel-as-religion. Explain the alternative and why it fit better. Interviewers appreciate engineers who pick the right primitive instead of forcing channels everywhere.

### Q: Describe a time you tuned channel buffer sizes and what you measured.

Pick an example where you measured the impact: throughput, latency tail, or memory. Talk about the starting point (often unbuffered or arbitrary), the metric that motivated the change (queueing latency, dropped messages, lock contention), and the result. Mention that you went up *and* down — sometimes a smaller buffer is better because it surfaces backpressure earlier. End with the broader principle: buffer sizes are a tuning knob, not a constant.

### Q: Tell me about a deadlock involving channels you've debugged.

Common shape: a goroutine A sends to channel X and expects a reply on channel Y, while goroutine B receives from Y and expects a value on X — circular waiting. Walk through how you noticed (stuck process, goroutine dump showing both blocked on channel ops), how you diagnosed (drew the wait graph), and how you fixed (broke the cycle, usually by adding a timeout or restructuring so the dependency went one way). Mention what tooling helped — Go's race detector won't catch deadlocks but goroutine dumps do.

### Q: How do you handle situations where stakeholders push back on adding channel-based concurrency?

Often the pushback is fair — concurrency adds complexity, and not every problem needs it. Talk about how you frame the trade-off: what concrete user pain are you solving, what's the maintenance cost, what does the test plan look like. If the pushback is "we don't use channels at this company" because of historical bugs, you address the root cause (training, code review patterns) rather than fighting the convention. The story is about engineering judgment, not winning arguments.

### Q: Tell me about a time you explained channels to someone new to Go.

Pick a teaching moment — onboarding a junior, a code review where the new person didn't grasp why range needs close. Talk about the analogy you used (postal mail, bucket brigade), what concept clicked, and what didn't. The best version of this answer shows empathy for the learner and patience: channels are confusing because they bundle data, synchronization, and ownership in one operation. Acknowledging the difficulty makes you a better teammate.

---

## What I'd Ask a Candidate Now

### Q: Walk me through what happens when an unbuffered send meets a receiver.

I'm checking whether they understand rendezvous semantics — that both goroutines unblock at the same logical instant, that the value transfers atomically, and that this creates a happens-before edge. A strong candidate also mentions that the sender can rely on the receiver having taken the value once the send returns. A weak candidate describes channels as queues without the synchronization angle.

### Q: When would you choose an unbuffered channel over a buffered one?

I want to hear that they think about backpressure and synchronization rather than just throughput. Unbuffered for handoff confirmation; buffered for smoothing bursts at the cost of looser coupling. Bonus points for "buffer size is a tuning knob I'd measure rather than guess." Red flag: "buffered is always faster" — that's both wrong and a sign of cargo culting.

### Q: How do you ensure a goroutine that's selecting on channels always exits?

I'm probing for the "include ctx.Done() in every select" discipline. Bonus points for mentioning structured concurrency (errgroup, parent-child cancellation) and for being able to describe how they'd review code for this. Weak answer: "we just trust the goroutines to exit." That trust is how leaks happen.

### Q: Describe how you'd build a pipeline that processes a stream of events with cancellation.

I'm watching for stage-per-goroutine architecture, channels between stages, ctx propagation, and graceful shutdown semantics (close output when input is drained). Strong candidates also discuss backpressure (bounded buffers between stages) and observability (metrics on queue depth). Weak candidates describe a single monolithic goroutine with a switch statement.

### Q: How would you implement a rate limiter using channels?

Token bucket via a ticker that refills a buffered channel; consumers receive a token before doing work. I'm checking they can reason about burst capacity, rate, and graceful giveup via select with ctx. Bonus points for mentioning the failure modes (ticker drift, allocation pressure with too-fine ticks) and alternatives (golang.org/x/time/rate for production).

### Q: What's the difference between closing a channel and sending a "done" value?

Close is broadcast — every receiver sees it, no matter how many. Sending a sentinel only reaches one receiver. Close also distinguishes "no more values" from "value happens to be the zero value." I'm testing whether they understand close as a one-shot fan-out signal rather than just "the way to end a range loop."

### Q: How would you debug a goroutine leak in production?

Walk through pprof's goroutine profile (`go tool pprof http://.../debug/pprof/goroutine`), reading the stack dumps to find what they're blocked on, then mapping back to the code. Bonus points for talking about monitoring `runtime.NumGoroutine` over time as an early signal, and for having a habit of code reviewing for exit paths preventively rather than only debugging reactively.

---

## Cheat Sheet

```
Send/receive
  ch <- v           send (block until ready)
  v := <-ch         receive (block until ready)
  v, ok := <-ch     receive with closed detection (ok=false when closed+drained)

Close
  close(ch)         signals "no more sends"
  close(closed)     PANIC
  close(nil ch)     PANIC
  send on closed    PANIC
  recv on closed    returns zero, ok=false (after drain)
  recv on nil       BLOCKS FOREVER
  send on nil       BLOCKS FOREVER

Select rules
  multiple ready -> random pick (uniform)
  none ready, no default -> block
  none ready, default -> default runs
  nil channel case -> permanently skipped (until ch != nil again)

Buffer semantics
  cap=0  unbuffered: rendezvous, sender blocks until receiver ready
  cap=N  buffered:   sender blocks only when buffer full
  len(ch) = current items; cap(ch) = capacity (race-prone for control flow)

Patterns
  Cancel       <-ctx.Done() in every select
  Fan-out      one channel, many workers ranging over it
  Fan-in       merge N channels via N goroutines into one out channel
  Pipeline     producer -> stage -> stage -> consumer; close-on-done
  Semaphore    buffered chan struct{} with cap=N
  Rate limit   ticker fills buffered channel, consumers take a token
  Oneshot      cap=1 reply channel embedded in request struct
  Debounce     reset timer on each input, emit on timeout

Anti-patterns
  Closing from receiver
  Multiple closers
  Range without producer-side close (leak)
  Send without receiver (leak)
  Select default in hot loop (busy spin)
  len(ch) for flow control (race)
  Unbounded channel with no producer rate cap (OOM)

Cross-language
  Go            chan T (MPMC), select, close
  Rust std      mpsc::channel (MPSC), no select, send returns Result
  Tokio         mpsc/broadcast/watch/oneshot, tokio::select!
  Clojure       core.async, <! / >! (parking), <!! / >!! (blocking), alts!
  Python        asyncio.Queue (MPMC, single loop), no built-in close
```

---

## Further Reading

- The Go Memory Model — channel synchronization rules: https://go.dev/ref/mem
- Effective Go — channels section: https://go.dev/doc/effective_go#channels
- Go blog: "Go Concurrency Patterns: Pipelines and cancellation": https://go.dev/blog/pipelines
- Go blog: "Advanced Go Concurrency Patterns": https://go.dev/blog/io2013-talk-concurrency
- Sameer Ajmani, "Go Concurrency Patterns" (talk): https://go.dev/talks/2012/concurrency.slide
- Bryan C. Mills, "Rethinking Classical Concurrency Patterns": https://drive.google.com/file/d/1nPdvhB0PutEJzdCq5ms6UI58dp50fcAN/view
- Tokio docs — channels overview: https://tokio.rs/tokio/tutorial/channels
- Rust std::sync::mpsc docs: https://doc.rust-lang.org/std/sync/mpsc/
- Rich Hickey, "Clojure core.async Channels" (talk): https://www.infoq.com/presentations/clojure-core-async/
- "Communicating Sequential Processes" — Tony Hoare's original paper: https://www.cs.cmu.edu/~crary/819-f09/Hoare78.pdf

---

## Related Topics

- [Channels — README](README.md)
- [Goroutines & Green Threads](../03-goroutines-green-threads/README.md)
- [Mutex, RWMutex, Sync Family](../01-mutex-rwmutex-sync/README.md)
- [Atomics](../02-atomics/README.md)
- [Condition Variables](../04-condition-variables/README.md)
- [Concurrency Models](../../01-models/README.md)
- [Async Programming](../../../async-programming/README.md)
- [Parallel Programming](../../../parallel-programming/README.md)
