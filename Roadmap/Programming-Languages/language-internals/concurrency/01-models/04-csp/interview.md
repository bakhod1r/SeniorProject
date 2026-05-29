# CSP — Interview Questions

> **Topic:** [CSP](README.md)

---

## Introduction

Communicating Sequential Processes (CSP) is the concurrency model that shapes how engineers reason about Go, Clojure's `core.async`, Crystal, Pony's behaviors, and parts of Rust's async ecosystem. Interviews rarely ask you to recite Hoare's 1978 paper, but they routinely test whether you can think in terms of processes that share nothing and synchronize on channels. The questions in this file are designed to expose whether a candidate has actually built systems with channels, or only memorized the syntax.

The bar for senior engineers is high: it is not enough to write a `go func()` and send into a channel. You must know exactly when a goroutine will leak, when a select will silently lose work, when closing a channel is correct and when it is a contract violation, and how to compose channels into pipelines that cancel cleanly. CSP looks simple on the surface; the trap is that the abstractions are so small that mistakes compound silently.

This document covers conceptual foundations (CSP versus actor, rendezvous, ALT/choice), Go-specific deep dives, classic traps interviewers love (send on closed channel, range over never-closed channel, nil channels in select), system design scenarios (chat rooms, fan-out aggregators, rate limiters), and runnable coding exercises with sample solutions. For each tricky question, the answer explains the wrong instinct first, then the correct mental model.

Use this file two ways: as a self-quiz before interviewing, and as a checklist of what to ask candidates when you are on the other side of the table. The "What I'd Ask a Candidate Now" section captures the few questions that have proven, in practice, to separate engineers who understand CSP from those who have only used it.

## Table of Contents

1. [Conceptual / Foundational](#conceptual--foundational)
2. [Go-specific](#go-specific)
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

### Q: What is CSP in one sentence, and what problem does it solve?

CSP is a formal model in which independent sequential processes communicate exclusively by passing messages on named channels, never by sharing memory. The problem it solves is the inherent difficulty of reasoning about concurrent programs that share state through locks: instead of asking "who holds which lock in what order," you ask "what messages flow on which channel." The model was introduced by C.A.R. Hoare in 1978 and later formalized into a process algebra that allows mechanical refinement checking. Practically, CSP gives you a vocabulary (channel, send, receive, choice) that maps cleanly to language primitives in Go, Crystal, and Clojure's `core.async`. The trade-off is that you give up the flexibility of shared memory for the discipline of explicit communication.

### Q: How does CSP differ from the Actor model?

Both models avoid shared memory, but the locus of identity is different. In Actors, the addressable entity is the actor itself: you send a message to actor A, and A's mailbox queues it. In CSP, the addressable entity is the channel: processes are anonymous, and they meet at a channel. This has two practical consequences. First, CSP channels can be passed as first-class values, so topology is dynamic and explicit; Actor references are also values, but the asymmetry is different. Second, classical CSP rendezvous is synchronous (sender and receiver meet at the same instant), while Actor mailboxes are inherently asynchronous and unbounded. Go relaxes the synchronous rule by offering buffered channels, but the channel-as-identity stays. Erlang's actors and Go's goroutines+channels often look interchangeable for small examples, but the abstractions diverge once you need supervision trees (Actor strength) or composable selects over heterogeneous channels (CSP strength).

### Q: What is the difference between synchronous and asynchronous channels?

A synchronous (unbuffered) channel forces sender and receiver to meet at the same point in time: a send blocks until a receive is ready, and vice versa. This is the original CSP rendezvous. An asynchronous (buffered) channel decouples them by adding a queue of capacity N: a send blocks only when the buffer is full, a receive blocks only when it is empty. Synchronous channels give you tight backpressure for free, because a fast producer cannot outrun a slow consumer. Buffered channels improve throughput when producer and consumer rates vary, but they require you to think about queue depth, latency, and what happens when the buffer fills. The biggest interview trap here is assuming buffered channels are "faster" — they hide problems rather than solve them, and the right default in most Go code is an unbuffered channel.

### Q: What is a rendezvous?

A rendezvous is the synchronization point where two processes meet on a channel: one ready to send, one ready to receive. At that instant the value is transferred and both processes are released to continue. This is significant because it is a synchronization primitive in itself — no lock or condition variable is needed. A rendezvous gives you an ordering guarantee: every receive in process B happens-after the matching send in process A. In Go, sends on unbuffered channels are rendezvous; this is why `done <- struct{}{}` on an unbuffered done channel guarantees the sender knows the receiver got the message. With buffered channels you lose this guarantee for sends that fit in the buffer; the rendezvous degrades to a queue insertion.

### Q: What are the semantics of `select`?

`select` lets a process wait on multiple channel operations at once. If exactly one operation can proceed, it runs. If multiple are ready, one is chosen uniformly at random — this fairness is critical. If none are ready and there is a `default` clause, the default runs immediately (non-blocking). If none are ready and there is no default, the goroutine blocks until one becomes ready. The randomness is what prevents starvation in patterns like a worker reading from a job channel and a quit channel: if both have work, neither side monopolizes. Many bugs come from people assuming select has priority semantics; it does not. If you need priority, you compose two selects: one with priority cases inside a non-blocking outer select.

### Q: What does it mean to close a channel, and who should close?

Closing a channel signals "no more values will ever be sent." A receive on a closed channel returns the zero value immediately, with the `ok` flag set to false. A `range` loop over a closed channel terminates cleanly. The cardinal rule is that only the sender should close, and only when there is exactly one sender, or when senders coordinate among themselves. Closing is a broadcast: all current and future receivers see the close. The trap is treating close as a generic "I'm done" signal — if multiple goroutines send on the same channel, no single one can safely close, and you need an external coordination mechanism (WaitGroup followed by a designated closer goroutine).

### Q: What causes deadlock in a CSP-style program?

Deadlock happens when every process is waiting for a channel operation that no other process will perform. Classic patterns: a goroutine sends on an unbuffered channel with no receiver ever scheduled; two goroutines each waiting to send to the other before reading; a `select` over channels that will never be closed and will never receive. Go's runtime detects only the simplest case — all goroutines blocked, no progress possible — and panics with "fatal error: all goroutines are asleep." Partial deadlocks (some goroutines stuck while others continue) are silent leaks and are far more common in production. The discipline is to ensure every channel operation has a known source of unblocking: a send must have a guaranteed receiver, a receive must have a guaranteed sender or close.

### Q: What is structured concurrency and how does it relate to CSP?

Structured concurrency is the principle that the lifetime of a child task must be bounded by the lifetime of its parent's lexical scope. In other words, you cannot exit a function that spawned goroutines until those goroutines have terminated. CSP itself does not mandate this — Go in particular allows you to `go func()` and never wait — but the modern wisdom (Nathaniel Smith's "Notes on structured concurrency", Go's `errgroup`, Trio's nurseries) is that unstructured `go` is the same kind of mistake as `goto`. The connection to CSP is that channels make structured concurrency tractable: you can pass cancellation in through a context channel and a result out through a result channel, ensuring you wait for the child before returning. Go is moving toward this with proposals like `go.uber.org/goleak` and structured concurrency RFCs, but discipline is still on the programmer.

### Q: What is FDR and why does it matter?

FDR (Failures-Divergences Refinement) is the model checker for CSP, developed at Oxford. It mechanically checks whether one CSP process refines another — informally, whether your implementation respects the specification. The reason interviewers may mention it is to test whether you understand that CSP is not just a programming style but a formal calculus with refinement semantics, where you can prove properties like deadlock-freedom and livelock-freedom. You will not use FDR in a typical Go shop, but knowing it exists explains why CSP is taken seriously in safety-critical contexts (aerospace, hardware verification). It also explains why Go's design choices — buffered channels, select fairness — are sometimes contentious among CSP purists: they break the formal model in exchange for pragmatic ergonomics.

### Q: What is the ALT or choice operator in classical CSP?

In Hoare's CSP, ALT (often written `|` or `[]`) is the external choice operator: it offers the environment a choice among several guarded communications. `c?x -> P [] d?y -> Q` says "be willing to receive on c (then become P) or on d (then become Q)." The environment decides which by being ready on one channel or the other. Go's `select` is the direct descendant, with the addition of `default` for non-blocking selection and uniform random choice when multiple are ready. The trap in interview discussion is conflating internal choice (the process picks) with external choice (the environment picks): CSP distinguishes them carefully, and select is external choice.

### Q: Can CSP processes share memory at all?

In the pure model, no — communication is the only synchronization. In practice, every implementation cheats. Go shares an address space, so two goroutines can pass a `*Foo` through a channel and then both mutate it; this is the source of countless data races. The discipline taught by Go's authors is "share memory by communicating" — once you send a pointer over a channel, you transfer ownership and the sender must not touch it. This is convention, not enforced. Languages like Pony enforce it via the type system (reference capabilities), and Rust enforces it via ownership. The interview answer: pure CSP forbids it, real implementations allow it, and you must impose discipline yourself.

### Q: What is the difference between a process and a thread in CSP terminology?

A CSP process is an abstract sequential entity defined by its behavior — the sequence of events it engages in. It has no inherent relationship to OS threads. In Go, processes map to goroutines (M:N scheduled onto OS threads); in occam (the historical CSP language), they could map to dedicated hardware on a Transputer. Treating processes as cheap is the cultural shift CSP demands: you can have millions of goroutines because the runtime multiplexes them, and you should decompose your program along the natural communication boundaries rather than minimizing process count. The interview signal here is whether the candidate has internalized "process" as a logical unit of concurrent behavior, not a heavyweight OS construct.

### Q: How does backpressure work in CSP?

Backpressure is automatic in synchronous CSP: a fast producer that sends faster than the consumer receives will simply block on each send, throttling itself to the consumer's rate. With buffered channels, backpressure is delayed by the buffer depth: the producer can race ahead for N values before blocking. This is why selecting a buffer size is a capacity-planning question: too small wastes throughput, too large hides slow consumers and increases latency. The CSP idiom for explicit backpressure is to use unbuffered channels at every stage and let the slowest stage set the system rate. Compare this to actor mailboxes (unbounded by default), where a slow consumer silently grows memory until the process dies.

### Q: What guarantees does CSP give you about message ordering?

Within a single channel, messages are FIFO: receives observe sends in the order they happened. Across multiple channels, there is no global ordering — if process A sends to channel x and then to channel y, a process B reading from y first then x can observe them out of order. This matches our intuition for queues and is critical when designing pipelines: each stage's input channel preserves order, but if you split work across multiple channels (fan-out) and merge back (fan-in), ordering is lost unless you reconstruct it with sequence numbers. The classic interview follow-up is "how do you maintain order through a fan-out worker pool?" — the answer is either avoid fan-out for ordered work, or attach sequence numbers and reorder at the merge.

### Q: How do CSP and the pi-calculus relate?

The pi-calculus, developed by Robin Milner in the late 1980s, extends CSP-like ideas with the ability to communicate channel names themselves over channels — a feature called mobility. CSP in its original form has a fixed topology (channels are static names); the pi-calculus allows a process to receive a new channel and start using it, modeling dynamic connection patterns. Go's `chan chan T` and `chan func()` patterns are practically pi-calculus features grafted onto a CSP base. Interviewers rarely test this directly, but understanding the relationship explains why Go feels more flexible than pure CSP: passing channels around is exactly the mobility the pi-calculus formalizes.

### Q: What is divergence in CSP, and why does it matter?

A divergent process is one that performs an infinite sequence of internal events without ever interacting with the environment — informally, it spins or loops without making progress visible from outside. FDR's failures-divergences model distinguishes deadlock (cannot do anything) from divergence (does nothing useful externally). Practically, divergence in Go looks like a goroutine in a hot loop with no channel operations: `for { _ = compute() }` — it consumes CPU but never communicates. Detecting divergence at design time is the value of CSP refinement checking; at runtime, you spot it via CPU profilers showing a function with no scheduler interaction.

---

## Go-specific

### Q: Walk through exactly what happens on an unbuffered channel send and receive.

A goroutine G1 calls `ch <- v` on an unbuffered channel. The runtime checks if any goroutine is parked on a receive on `ch`. If yes, it copies `v` directly into the receiver's stack frame, marks both goroutines runnable, and the scheduler resumes them. If no receiver is waiting, G1 is enqueued on `ch`'s send queue (`sendq`) and parked. When some goroutine G2 later calls `<-ch`, the runtime sees a sender waiting, copies the value from G1's frame to G2's receive site, dequeues G1, and marks both runnable. The key insight is that the value never lives in the channel's buffer (there is none) — it is transferred directly between stacks. This is why unbuffered sends are a synchronization point: the moment a send completes, the receiver has already begun executing.

### Q: What happens when you range over a channel?

`for v := range ch` is sugar for a loop that does `v, ok := <-ch` and exits when `ok` is false. The loop continues to receive values until the channel is closed and drained. Closing the channel is the only way to terminate the loop cleanly. If no one ever closes the channel and you stop receiving, the goroutine doing the range will block forever — this is a common leak. If you close the channel while ranging, the loop will receive any buffered values first, then see the close and exit. The pattern in a pipeline is that each stage closes its output channel in a `defer` after its work is done, so downstream ranges naturally terminate.

### Q: When should you use `select` with a `default` case?

`default` makes the select non-blocking: if no case is ready, default runs immediately. The legitimate uses are: non-blocking sends (try to send, give up if no receiver) for telemetry where you would rather drop than block; non-blocking receives to poll a channel; and as a fast path before a blocking second select. The misuse is using default as a sleep-and-poll loop, which burns CPU. If you find yourself writing `for { select { case ... : default: time.Sleep(...) } }`, you have built a polling loop that defeats the purpose of channels. The correct fix is almost always to remove default and let the select block.

### Q: What is a channel of channels, and when is it useful?

`chan chan T` is exactly what it says: a channel whose elements are channels. The classic use is the request-response pattern: a client sends a request that includes a reply channel; the server processes the request and sends the response on the embedded channel. This avoids needing a global registry of pending requests or correlation IDs. Example: `type req struct { input int; reply chan int }; ch := make(chan req); ch <- req{42, make(chan int)}`. The client then blocks on `<-r.reply`. The pattern scales to fan-out worker pools where each worker pulls a job-channel from a pool channel, claims exclusive use, processes, and returns it.

### Q: What are channel direction types and why do they matter?

A function parameter can be declared `chan<- T` (send-only) or `<-chan T` (receive-only), which restricts what the function may do with the channel. A bidirectional `chan T` is implicitly convertible to either directional form, but not vice versa. This is a compile-time discipline tool: a producer function declared as `func produce() <-chan int` documents that it returns a read-only channel, and the type system prevents the caller from accidentally sending into it. In pipeline code, every stage's input is `<-chan T` and its output is `<-chan U`; only the originator and consumer see bidirectional channels internally. This catches a whole class of bugs at compile time and makes APIs self-documenting.

### Q: Describe the `context` + `select` cancellation pattern.

The canonical Go cancellation pattern is to pass a `context.Context` into every long-running function and wire its `Done()` channel into every blocking select. Example: `select { case v := <-input: handle(v); case <-ctx.Done(): return ctx.Err() }`. When the caller cancels the context (`cancel()` or deadline expiration), `ctx.Done()` closes, the select unblocks, and the function returns promptly. This works because closing a channel makes all receives ready. The discipline: every blocking operation in your function must be in a select that includes `<-ctx.Done()`. Forgetting one is the most common source of goroutine leaks. The corollary is that any helper function you call must also accept a context, otherwise cancellation does not propagate.

### Q: How do you detect goroutine leaks?

There are three layers. First, at development time, run tests under `go.uber.org/goleak`, which snapshots the goroutine list at test start and end and fails the test if extra goroutines remain. Second, in production, expose `/debug/pprof/goroutine` and watch the count over time — a steadily growing count with constant load is a leak. Third, use `runtime.NumGoroutine()` in metrics. To diagnose a specific leak, grab a goroutine profile and look for many goroutines stuck at the same line — usually a `<-ch` or `select` with no exit. The fix is almost always to add `<-ctx.Done()` to the select or to ensure the channel gets closed when the producer exits.

### Q: What are the rules around closing a channel?

The fundamental rule: only senders close, and only when no further sends will happen. From this come the practical patterns. Single producer: the producer closes in a defer at the end of its function. Multiple producers, single consumer: use a `sync.WaitGroup`, have a dedicated goroutine that waits on the WaitGroup and then closes. Never close a channel from the receiver side — the receiver does not know if more sends are pending. Never close twice — it panics. Never send after close — it panics. If you cannot statically determine who closes, you have a design problem; introduce a separate "done" channel that signals "stop sending."

### Q: How does `sync.WaitGroup` complement channels?

WaitGroup tracks how many goroutines are still running, without any value exchange. You call `wg.Add(n)` before spawning, `wg.Done()` at the end of each goroutine, and `wg.Wait()` to block until all are done. The pattern pairs with channels in two ways. First, in fan-in: spawn N workers, each writes to a shared output channel, a coordinator does `wg.Wait()` then `close(out)`. This solves the multiple-producer close problem above. Second, for graceful shutdown: signal stop via a `done` channel, then `wg.Wait()` for workers to finish their in-flight work. WaitGroup is for liveness (everyone finished), channels are for data flow. Mixing them up — using a channel to count completions — works but is more error-prone.

### Q: How do you write a reusable pipeline stage helper?

A pipeline stage is a function that takes a context, an input channel, and any parameters, and returns an output channel. It launches a goroutine that reads from input, transforms, writes to output, and closes output when done. The skeleton:

```go
func stage[T, U any](ctx context.Context, in <-chan T, f func(T) U) <-chan U {
    out := make(chan U)
    go func() {
        defer close(out)
        for v := range in {
            select {
            case out <- f(v):
            case <-ctx.Done():
                return
            }
        }
    }()
    return out
}
```

The contract: the stage closes its output when the input is drained or when the context cancels. This composes — you chain `stage(ctx, stage(ctx, source, f), g)` and cancellation propagates because each stage's range exits when the prior stage's defer closes the channel.

### Q: What is the difference between a goroutine and a thread, in terms of CSP semantics?

CSP processes are logical entities; goroutines are their Go realization. A goroutine starts with a tiny stack (about 2KB) that grows on demand, is scheduled M:N by the Go runtime onto a small pool of OS threads, and has near-zero startup cost (under a microsecond). This means you can have millions of goroutines on a single machine, which is what makes the CSP "process per concern" decomposition practical. The interview signal here is whether the candidate has internalized that creating a goroutine is cheap enough to use freely, but not free — every goroutine has a stack, a g struct, and scheduler bookkeeping. A program with a million idle goroutines uses roughly 2GB of RSS just for stacks.

### Q: How does `runtime.Gosched()` interact with channel scheduling?

`runtime.Gosched()` voluntarily yields the current goroutine and lets the scheduler pick another to run. With channels, you rarely need it — channel operations are themselves scheduling points (a blocked send/receive parks the goroutine, allowing others to run). The legitimate uses of Gosched are CPU-bound loops with no channel ops, where you want to be a good neighbor. The interview trap is candidates who insert Gosched as a defensive measure inside channel code, where it adds nothing because the channel operations already cooperate with the scheduler.

---

## Tricky / Trap

### Q: What happens when you send on a closed channel?

It panics. Specifically `panic: send on closed channel`, and the goroutine dies. The wrong instinct is to think "closed means done, sending should be a no-op or return an error" — that is how some libraries work, but not Go channels. Why does Go panic? Because closing is a contract that no more sends will happen; a later send is a violation, and silent dropping would hide bugs. The correct pattern is to ensure all senders have terminated before any close. If you have multiple senders, use WaitGroup + closer goroutine. If you need a "try send if open" semantic, you need an external done channel: `select { case ch <- v: case <-done: }` so you stop sending before the channel closes.

### Q: What happens if you close a channel twice?

Panic: `close of closed channel`. The wrong instinct is to defensively call close in multiple places "just to be safe." This is the opposite of safe: it makes a panic certain. The correct discipline is that exactly one goroutine owns the close, and it is the only one allowed to call close. If you need close-ness to be idempotent (rare and usually a sign of confused ownership), wrap it in a `sync.Once` so close runs at most once. Even better, redesign so ownership is clear.

### Q: What happens if you range over a channel that is never closed?

The range loop blocks forever after consuming all available values. The wrong instinct is to think "range will know when the producer is done." It will not — the runtime has no concept of "the producer is done" except via close. This is the most common goroutine leak: a worker ranges over a channel whose producer was killed without closing, and the worker is stuck. The fix is producer-side: defer close. The defensive fix on the consumer side is to use `for { select { case v, ok := <-ch: if !ok { return } ...; case <-ctx.Done(): return } }` so a cancelled context lets the receiver escape even if the producer misbehaves.

### Q: What is the leak pattern in `select` with no default?

If a goroutine sits in `select { case <-ch1: ...; case <-ch2: ... }` and neither channel will ever send or close, the goroutine is leaked permanently. The wrong instinct is to assume select will time out or that the runtime will detect this. It will not. The cure is to always include either a context done case or a timeout case in any select that is the goroutine's only point of progress. The Go authors' rule of thumb: a goroutine should have a guaranteed exit path under all upstream conditions, and a select without a cancellation case rarely satisfies that.

### Q: What happens if a `time.Ticker` is not stopped?

The ticker keeps running in the background, consuming a runtime timer slot, and any goroutine ranging over `ticker.C` keeps receiving. If the consumer goroutine has exited but the ticker was not stopped, the runtime still fires the timer and sends to the channel, but no one drains it — wasted work and a small leak. The wrong instinct is to think a ticker stops automatically when the receiving goroutine exits. It does not. The rule: every `time.NewTicker` must have a paired `defer ticker.Stop()` in the same scope. The same applies to `time.NewTimer` if not consumed.

### Q: What is the trap with a slow consumer and an unbounded buffer?

There is no such thing as an unbounded channel buffer in Go (capacity is fixed at make time), but the trap appears in two forms. First, people set buffer capacity to a "large enough" number like 1000 to "avoid blocking," and when the consumer slows down, the producer fills the buffer, then blocks, but only after wasting memory and adding latency. Second, people implement their own queue between channels, which is genuinely unbounded and grows until OOM. Both cases hide the real problem: the consumer is too slow and should be scaled out or the producer should be throttled. The discipline is to choose buffer size based on burst tolerance, not to mask backpressure.

### Q: What is the trap with `for { select { case <-ch: ... } }` when ch is closed?

Once ch is closed, every iteration the receive case fires immediately with the zero value. The loop spins at full speed, burning a CPU core. The wrong instinct is "the select will block once ch is closed because there is no more data." It does not — closed channels always deliver. The fix is to check `v, ok := <-ch; if !ok { return }` inside the case, or to nil the channel variable after detecting close so the case stops firing. This is one of the most common production CPU-spike bugs in long-lived consumers.

### Q: What is the role of a nil channel in `select`?

A nil channel in a select case is permanently not ready: sends and receives on it block forever. This is a feature, not a bug. The idiom is to disable a select case by setting its channel to nil. Example: in a producer that finishes its work, set the output channel variable to nil so the case "send next value" stops being chosen, but the rest of the select (e.g., cancellation) still works. The wrong instinct is to write `if ch != nil { select { case ch <- v: ... } }`, which is verbose and easy to get wrong. The right pattern is to write the select once and toggle channel variables to nil to enable/disable cases.

### Q: What happens to in-flight values when context is cancelled in the middle of a pipeline?

They are lost. If stage 2 has read a value from stage 1 and is about to send to stage 3, and the context cancels, the typical pattern is `select { case out <- v: case <-ctx.Done(): return }` — the value `v` is dropped because the send case loses the race to the done case. The wrong instinct is to assume cancellation flushes pending work. It does not. If you need at-least-once semantics, the pipeline pattern is wrong — you need a durable queue. If you can tolerate loss, document it. A subtler trap: closing channels on cancellation can race with sends; the safe pattern is to let the producer's range exit (driven by ctx.Done in the source) and let close happen via defer.

### Q: What is the trap when passing a pointer through a channel?

Passing a pointer transfers a reference, not a copy. If the sender keeps mutating the pointed-to data after sending, the receiver sees a moving target — a data race that the race detector will catch only if both sides write. The discipline: once you send a pointer, treat it as transferred ownership and do not touch it. The wrong instinct is "channels synchronize, so I'm safe." Channels synchronize the channel operation, not subsequent writes to the data. For shared-read-only data (a config struct after construction), passing a pointer is fine because no one writes after construction.

### Q: What is the bug in this code: `go func() { ch <- compute() }(); v := <-ch`?

This is fine in isolation, but the trap is when this pattern is reused with the same `ch` from a loop, or when `compute()` panics. If `compute()` panics, the send never happens, and the receiver blocks forever. The right pattern is to recover panics inside the goroutine and either propagate them via a result channel or via context cancellation. The deeper trap: many people write `for _, x := range items { go func() { ch <- f(x) }() }` and capture x incorrectly; with Go 1.22+ the loop variable is fresh each iteration, but pre-1.22 code needs `x := x` to avoid all goroutines seeing the last value.

### Q: Why does `select { case v := <-ch: ... }` with a single case behave the same as `v := <-ch`?

Mostly it does, but there is one difference: a select with one case still uses the select machinery and is marginally more expensive. The trap people fall into is wrapping receives in single-case selects "to be safe," which is performance overhead with no benefit. Use select only when you have multiple cases or a default. The deeper trap is when the single case is a send: `select { case ch <- v: }` blocks just like a plain send and adds nothing.

### Q: What is the trap with `for range ch` inside a `select` case?

You cannot put a for-range inside a single select case directly, but people write `case <-trigger: for v := range data: process(v)` and discover that during the range, the select is not being re-evaluated — cancellation cases are ignored until the range completes. The wrong instinct is to think "I'm in a select, so cancellation works." It does not work inside the case body. The fix is to inline the range as repeated receives with their own select including cancellation, or to launch a sub-goroutine for the range and have it respect ctx.

### Q: What happens with `select` on a channel that closes while a send is pending?

If goroutine A is blocked on `select { case ch <- v: ... }` and another goroutine calls `close(ch)`, A panics with "send on closed channel" as soon as it tries to complete the send. The wrong instinct is that select detects the close and falls through to another case. It does not — select only sees ready operations, and a send on a closed channel is technically ready (it would proceed to panic). The defensive pattern when you cannot guarantee single-sender is to wrap the send in a recover or use a done channel to stop sending before close happens.

### Q: What is wrong with `close(ch); ch <- v`?

It panics. Order matters and the language gives you no second chances. People write this when refactoring, intending to "reset" a channel by closing and resuming. Go channels do not work that way — once closed, always closed. To reuse, allocate a new channel: `ch = make(chan T, cap(ch))`. The wider lesson: a channel's lifecycle is one-way (open -> closed), and trying to model state with closes will burn you.

### Q: What is the trap with `default` in a select inside a tight loop?

`for { select { case v := <-ch: ...; default: } }` is a busy loop. The default fires on every iteration where ch is not ready, consuming 100% of a CPU core. The wrong instinct is "this is non-blocking, so it's efficient." It is non-blocking and inefficient. The fix is to remove default, or to add a small sleep, or to redesign so the goroutine blocks until there is real work. If you find yourself wanting polling, you usually want a `time.Ticker` instead.

### Q: What happens when you `select` on two cases where one is a send and one is a receive, both ready?

The runtime picks one at random with uniform probability. The wrong instinct is to expect "sends have priority" or "the order I wrote them matters." Neither is true. If you need priority, you write a nested select: outer select with default tries the priority case non-blocking; if it didn't fire, inner select blocks on all cases. This pattern is verbose but correct.

### Q: Why might `close(done); <-done` return immediately even though done was never sent to?

Because a receive on a closed channel returns the zero value immediately. The wrong instinct is "I never sent, so receive should block." It doesn't — close itself is what unblocks. This is the foundation of the done-channel cancellation idiom: closing broadcasts to all receivers. It also means done channels should usually be `chan struct{}` (no value transferred, just signaling) and should never be sent to — only closed.

### Q: What is wrong with using a channel as a mutex via `ch := make(chan struct{}, 1)`?

You can build a mutex from a buffered channel of capacity 1: send to lock, receive to unlock. It works, but there are subtle issues. First, it is slower than `sync.Mutex` because channel ops go through the scheduler. Second, it does not handle reentrancy — a goroutine that tries to lock twice deadlocks (which `sync.Mutex` also does, so this is consistent). Third, it does not integrate with the race detector's mutex annotations. The wrong instinct is "channels are CSP-pure, so I should use them for everything." Use the right tool: mutex for mutual exclusion, channel for communication and ownership transfer.

### Q: What is the trap with closing a channel inside a `defer` in a goroutine that may panic?

If the goroutine panics before reaching all its sends, the defer-close still runs (panics unwind through defers), and any pending sends in the call stack will have already been bypassed. Downstream receivers may see fewer values than expected and the close cascades. The trap is if you have a recover that swallows the panic — receivers see an early close with no indication that something went wrong. The pattern: recover, log, and either re-panic or send a sentinel error value on a separate error channel so downstream knows the pipeline aborted abnormally.

### Q: Why does `var ch chan int; ch <- 1` block forever rather than panic?

A nil channel is a valid value (channels are pointer-like under the hood), and send/receive on nil block forever by design. The wrong instinct is to expect a nil pointer dereference panic. This behavior is deliberate so that the nil-channel-in-select idiom works: disabling a case by nilling its channel relies on nil being a permanent block, not an error. The trap: a forgotten `make(chan int)` causes a silent goroutine leak rather than a fast crash. Defensive code can check `if ch == nil { ... }`, but the correct fix is to ensure the channel is initialized before use.

---

## System / Design Scenarios

### Q: Design a chat server with a channel per room.

Each chat room is represented by a goroutine that owns the room's state (member list, recent messages) and listens on an `incoming chan Message`. Clients join by sending a registration to the room's `join chan client`, which adds the client to the member list. When a message arrives on incoming, the room iterates members and sends the message to each member's outgoing channel. Each client has its own pair of goroutines: one reading from the socket and forwarding to the room's incoming, one reading from the client's outgoing channel and writing to the socket. Cancellation flows via a context tied to the client's connection lifetime; on disconnect, the client sends to a `leave` channel and the room removes them. The room's outgoing sends to clients should be non-blocking (`select { case c.out <- msg: default: c.disconnect() }`) so a single slow client cannot stall the room. This design has no locks anywhere — state ownership is enforced by the room goroutine.

### Q: Design a system that fans out a request to N backends and aggregates the responses.

Allocate a result channel with buffer N. Spawn N goroutines, each calling one backend and sending its result (or error) on the channel. The aggregator selects on the result channel and a context done channel, collecting results until either all N have arrived or context cancels. Three policies are common. First, wait-all: keep reading until N values. Second, first-success: return as soon as the first non-error arrives, cancel the others via a shared sub-context. Third, quorum: return when M of N agree. The trap is leaking goroutines when you return early — always cancel the sub-context so in-flight backends abort. The buffered result channel of capacity N is crucial: it guarantees every goroutine can send and exit even if the aggregator has already moved on.

### Q: Build a rate limiter using channels.

The token bucket pattern: a `chan struct{}` of capacity N, refilled by a producer goroutine running on a ticker. To consume a token, receive from the channel — blocks if empty. To produce a token, do a non-blocking send (drop if full, since the bucket is full). The producer:

```go
tokens := make(chan struct{}, burst)
go func() {
    t := time.NewTicker(interval)
    defer t.Stop()
    for range t.C {
        select { case tokens <- struct{}{}: default: }
    }
}()
```

To rate-limit a call site: `<-tokens; doWork()`. The beauty is that backpressure is automatic — a fast caller blocks on the receive until the producer drops a token. For per-key rate limiting, you have a token bucket per key, but be careful about memory growth. This pattern is what `golang.org/x/time/rate` implements under the hood, although it uses a more sophisticated math model than naive bucket-filling.

### Q: Design a multi-stage pipeline with cancellation.

A pipeline is N functions, each `func(ctx, in <-chan A) <-chan B`. Each stage spawns a goroutine that reads from in, transforms, and sends to a fresh output channel, closing it on completion. The first stage takes no input channel; the last stage's output is read by the caller. Cancellation: every stage's send is in a `select { case out <- v: case <-ctx.Done(): return }`. When the caller cancels, the source stage exits its read loop, defer-closes its output, the next stage's range exits, and the close cascades downstream. The caller must drain the final output until it closes — if the caller stops reading early without cancelling, upstream stages will block forever. This is why the caller's loop should also be in a select with ctx.Done, and the caller cancels on early termination.

### Q: Design a streaming aggregator that emits batched results every N events or T duration.

A batcher reads from an input channel and accumulates a slice. It emits the slice either when it reaches N elements or when T has elapsed since the first element of the current batch. Implementation: a goroutine with a select on the input channel and a timer channel. On input, append; if the batch is now full or the timer has fired, flush. On timer fire, flush the partial batch. The trick is timer management — start the timer when the first item of a new batch arrives, stop it on flush, drain it carefully on Stop returning false. Close semantics: when the input closes, flush any partial batch and close the output. This is the pattern Kafka producers use internally for batching, and it generalizes to any throughput-vs-latency tradeoff.

### Q: Build an event debouncer.

A debouncer collapses bursts of events into a single delayed event. The implementation owns a goroutine that listens on `events chan Event` and maintains a `*time.Timer`. On each event, reset the timer to fire after the debounce interval. When the timer fires, emit on the output channel. Code sketch:

```go
func debounce(in <-chan Event, d time.Duration) <-chan Event {
    out := make(chan Event)
    go func() {
        defer close(out)
        var t *time.Timer
        var pending Event
        var have bool
        for {
            var timerC <-chan time.Time
            if t != nil { timerC = t.C }
            select {
            case e, ok := <-in:
                if !ok { if have { out <- pending }; return }
                pending = e; have = true
                if t == nil { t = time.NewTimer(d) } else { if !t.Stop() { <-t.C }; t.Reset(d) }
            case <-timerC:
                out <- pending; have = false; t = nil
            }
        }
    }()
    return out
}
```

The trap is timer-reset races: between Stop and Reset, the channel might already have a value. The pattern above handles that with the `if !t.Stop() { <-t.C }` drain.

### Q: How do you implement at-most-once delivery in a pipeline?

CSP channels are at-most-once by default: each value sent is received by exactly one receiver (or zero, if the receiver exits before reading). To enforce at-most-once explicitly, you ensure no retry logic that could resend on the same channel. The harder question is at-least-once, which channels do not give you — for that you need a durable log (Kafka, NATS Jetstream) outside the channel system. In-memory pipelines should be assumed at-most-once, and any value lost to cancellation is lost forever.

### Q: Design a request coalescer (single-flight) using channels.

Single-flight collapses duplicate concurrent requests for the same key into one upstream call, broadcasting the result. The design: a coordinator goroutine owns a map of in-flight keys, each value being a channel that will be closed when the result is ready (and a shared result struct). A request for key K consults the map: if present, wait on the channel and read the shared result; if absent, register a new channel, perform the upstream call, store the result, and close the channel to wake all waiters. The trap is using `sync.Map` and trying to do this lock-free — the race between "is K in flight?" and "register K" requires a single owner of the map, and that owner can be a goroutine reading from a request channel. `golang.org/x/sync/singleflight` implements this with a mutex rather than channels, which is more efficient for the small critical section.

### Q: Design a worker pool with graceful shutdown.

Spawn N worker goroutines, each ranging over a shared `jobs chan Job`. The dispatcher sends jobs; when no more jobs are coming, the dispatcher closes the jobs channel, which causes each worker's range to exit. Use a WaitGroup to track workers; the main goroutine waits for `wg.Wait()` then exits. For mid-flight cancellation (e.g., on SIGTERM), each worker selects on `jobs` and `ctx.Done()`; on context cancel, workers abandon their current job (or finish it if you want clean shutdown) and exit. The dispatcher also watches ctx and stops sending. The trap: if the dispatcher closes jobs while workers are still mid-job, they will finish; if you want immediate abort, you need ctx cancellation in the workers themselves.

---

## Coding Questions

### Q: Implement a bounded buffer using channels.

A bounded buffer with capacity N is literally `make(chan T, N)`. The point of the exercise is whether you understand that. If they want a wrapper with explicit Put/Take that returns errors on cancellation:

```go
type BoundedBuffer[T any] struct{ ch chan T }

func New[T any](n int) *BoundedBuffer[T] { return &BoundedBuffer[T]{ch: make(chan T, n)} }

func (b *BoundedBuffer[T]) Put(ctx context.Context, v T) error {
    select {
    case b.ch <- v: return nil
    case <-ctx.Done(): return ctx.Err()
    }
}

func (b *BoundedBuffer[T]) Take(ctx context.Context) (T, error) {
    select {
    case v := <-b.ch: return v, nil
    case <-ctx.Done(): var zero T; return zero, ctx.Err()
    }
}
```

The discussion point is: why not use a mutex + slice + condition variable? Because channels give you cancellation for free via select, and the implementation is shorter.

### Q: Implement a fan-in helper that merges N input channels into one.

```go
func merge[T any](ctx context.Context, ins ...<-chan T) <-chan T {
    out := make(chan T)
    var wg sync.WaitGroup
    wg.Add(len(ins))
    for _, in := range ins {
        go func(c <-chan T) {
            defer wg.Done()
            for v := range c {
                select {
                case out <- v:
                case <-ctx.Done(): return
                }
            }
        }(in)
    }
    go func() { wg.Wait(); close(out) }()
    return out
}
```

Key points: each input has its own forwarder goroutine; a WaitGroup tracks them; a separate closer goroutine waits then closes the merged output. Context cancellation lets each forwarder exit early. The output is closed exactly once, only after all inputs are done or all forwarders cancelled.

### Q: Implement a fan-out worker pool with a fixed worker count.

```go
func fanOut[T, U any](ctx context.Context, in <-chan T, n int, work func(context.Context, T) U) <-chan U {
    out := make(chan U)
    var wg sync.WaitGroup
    wg.Add(n)
    for i := 0; i < n; i++ {
        go func() {
            defer wg.Done()
            for v := range in {
                u := work(ctx, v)
                select {
                case out <- u:
                case <-ctx.Done(): return
                }
            }
        }()
    }
    go func() { wg.Wait(); close(out) }()
    return out
}
```

Discussion: ordering is not preserved. If the caller needs ordered output, attach a sequence number to T and reorder at the consumer. Worker count should be tuned to the workload — CPU-bound = NumCPU, IO-bound = much higher.

### Q: Implement a ticker-driven debouncer.

(See the System Design "event debouncer" question above for the full implementation.) The key correctness points to mention: drain the timer channel after Stop returns false to avoid a stale fire; close the output on input close; flush any pending event on close. A simpler but less correct version that uses `time.After` in a select instead of an explicit Timer is a common interview answer, but it allocates a new timer per event, which is wasteful.

### Q: Implement a pipeline stage helper with generics.

(See "How do you write a reusable pipeline stage helper?" above for the canonical implementation.) Variations the interviewer may push for: a stage that returns errors (return `<-chan Result[U]`), a stage that batches (collect M items or T duration), a stage with concurrency inside (a fan-out within the stage). All of these compose by wrapping the same skeleton with extra logic in the goroutine.

### Q: Implement a tee channel that duplicates input to two outputs.

```go
func tee[T any](ctx context.Context, in <-chan T) (<-chan T, <-chan T) {
    out1, out2 := make(chan T), make(chan T)
    go func() {
        defer close(out1)
        defer close(out2)
        for v := range in {
            var a, b = out1, out2
            for i := 0; i < 2; i++ {
                select {
                case <-ctx.Done(): return
                case a <- v: a = nil
                case b <- v: b = nil
                }
            }
        }
    }()
    return out1, out2
}
```

The clever bit: by nilling the channel variable after a successful send, the inner loop must send on the other branch on its second iteration. This guarantees both outputs get every value, even though the order between them per-value is non-deterministic. Discussion point: tee creates backpressure coupling — a slow consumer on out1 slows down out2 too.

### Q: Implement a context-aware select that times out per receive.

```go
func receiveWithTimeout[T any](ctx context.Context, ch <-chan T, timeout time.Duration) (T, error) {
    t := time.NewTimer(timeout)
    defer t.Stop()
    var zero T
    select {
    case v, ok := <-ch:
        if !ok { return zero, errors.New("channel closed") }
        return v, nil
    case <-t.C:
        return zero, context.DeadlineExceeded
    case <-ctx.Done():
        return zero, ctx.Err()
    }
}
```

Discussion: why not `context.WithTimeout`? You can use that and avoid the explicit Timer. The version above is shown because interviewers sometimes ask for it without the helper. The point is to demonstrate that select with three cases including ctx.Done and a timer is the universal pattern.

### Q: Implement a generator that emits Fibonacci numbers until cancelled.

```go
func fib(ctx context.Context) <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        a, b := 0, 1
        for {
            select {
            case out <- a:
                a, b = b, a+b
            case <-ctx.Done():
                return
            }
        }
    }()
    return out
}
```

Usage: `ctx, cancel := context.WithCancel(ctx); defer cancel(); for v := range fib(ctx) { if v > 100 { cancel(); break } }`. The trap to discuss: if the caller breaks out of the range without cancelling, the generator leaks. The defer cancel is essential.

### Q: Implement an or-channel that closes when any of N input channels closes.

```go
func or(channels ...<-chan struct{}) <-chan struct{} {
    switch len(channels) {
    case 0:
        return nil
    case 1:
        return channels[0]
    }
    orDone := make(chan struct{})
    go func() {
        defer close(orDone)
        switch len(channels) {
        case 2:
            select {
            case <-channels[0]:
            case <-channels[1]:
            }
        default:
            select {
            case <-channels[0]:
            case <-channels[1]:
            case <-channels[2]:
            case <-or(append(channels[3:], orDone)...):
            }
        }
    }()
    return orDone
}
```

This is a classic from Katherine Cox-Buday's "Concurrency in Go." The recursive structure handles arbitrary fan-in of done channels in O(log N) goroutines instead of O(N). The trick: by passing `orDone` into the recursive call, when the outer goroutine closes orDone (because some channel fired), the recursive subtree is signaled to clean up too.

### Q: Implement a sticky session router using channels.

A router accepts request structs containing a session ID and dispatches each request to a per-session goroutine (preserving order within session, parallelism across sessions). The router owns a `map[string]chan req` and spawns a session goroutine on first request for a new session. Each session goroutine ranges over its channel processing requests serially. Idle sessions can be reaped via a separate ticker that closes session channels that have been silent for N seconds. The trap is concurrent map access — solve it by having a single router goroutine own the map and process all dispatch decisions sequentially. This pattern is how you get sticky session semantics without a global lock.

---

## Behavioral

### Q: Tell me about a goroutine leak you debugged.

Strong answers include: how you noticed it (rising memory, growing NumGoroutine, slow shutdown), how you isolated it (pprof goroutine profile, looking for many stacks at the same line), what the root cause was (missing ctx.Done case, never-closed channel, ticker not stopped), and what you changed in the codebase to prevent recurrence (added goleak to tests, code review checklist for channel ownership, lint rules). The signal: the candidate has actually debugged one and knows the diagnostic tools, not just the theory.

### Q: Describe a time you chose channels over a mutex (or vice versa).

The good answer acknowledges both have valid uses. Channels for ownership transfer and pipelines; mutexes for read-heavy shared maps and counters. A strong story: "I had a request counter we incremented from many goroutines. Channels would have required a dedicated counter goroutine and added latency; we used `atomic.Int64`. Conversely, for the request pipeline we needed cancellation and backpressure, and channels were clearly the right tool." The weak answer is dogma ("always channels" or "channels are slow, always mutexes").

### Q: Tell me about a deadlock you fixed.

Look for a description of the cycle: who was waiting on whom, and what change broke it (reordering acquires, adding a timeout, switching to channels with select, removing a synchronous backchannel). Bonus points if the fix involved redesigning the ownership model rather than papering over with timeouts.

### Q: Have you ever had to abandon CSP-style code for performance?

Sometimes yes — channels have allocation and scheduling overhead that, in extreme hot paths, matters. The honest story: "We had a path-counted inner loop processing millions of items per second; channels added 50ns per send, which was 10% of our budget. We replaced it with a ring buffer and atomic ops, paid in complexity, and benchmarks justified it." The point is showing you measure rather than assume.

### Q: Describe a code review where you pushed back on a channel pattern.

Common scenarios: someone added a buffered channel "to improve performance" without measurement; someone called close from the receiver side; someone wrote a default case that turned into a busy loop. The behavioral signal is whether you can articulate the principle (backpressure, ownership, busy wait) rather than just "I told them no."

### Q: When have you decided against using goroutines entirely?

Examples: a CLI tool with no concurrency need; a tight numerical loop where SIMD-friendly code matters more than concurrency; a piece of library code where the caller should decide concurrency. The signal: you do not reach for `go func()` reflexively.

### Q: How do you teach CSP to engineers new to Go?

Look for an answer that emphasizes mental models over syntax: "Share by communicating, not communicate by sharing." Walk them through unbuffered first, introduce select, then introduce close, then context cancellation. The trap is dumping pattern catalogs on them without grounding in why.

### Q: What is the worst CSP-style bug you've shipped?

Honesty matters. A common one: "I closed a channel from the receiver side because the producer was misbehaving, and the new close raced with a producer send and panicked the process." The lesson should reflect a deeper principle (ownership, contract) rather than a surface fix.

### Q: How do you decide between `errgroup`, raw `sync.WaitGroup`, and a manual coordinator goroutine?

`errgroup` for the common case: spawn N goroutines, want first-error semantics with automatic context cancellation. `sync.WaitGroup` when you just need "wait for all to finish" with no error handling or context propagation. Manual coordinator when the topology is unusual — dynamic spawn, fan-in with deduplication, ordered shutdown across stages. The signal in a behavioral interview is whether the candidate reaches for the right level of abstraction rather than always using the lowest-level primitive.

### Q: Tell me about a time you had to debug a race condition that the race detector did not catch.

The race detector catches races on shared memory but not races on channels themselves (channel ops are synchronized). The classic example: two goroutines select-sending on the same buffered channel and a third receiving, where order matters for application correctness. Or a slow consumer that drops events due to non-blocking send, where the "race" is whether the consumer is fast enough. The skill being tested: can the candidate think above the data-race-detector level to logical races?

---

## What I'd Ask a Candidate Now

### Q: Walk me through what happens when you send on an unbuffered channel with no receiver ready.

This is the single best question because it forces the candidate to articulate the runtime mechanics: the sender parks on the channel's sendq, the scheduler runs other goroutines, and a future receive will wake the sender. If they can do this, they understand goroutines and channels at the mechanical level. If they say "the value goes into the channel," they are still thinking in terms of queues.

### Q: Show me a piece of pipeline code you wrote and walk me through cancellation.

Asking for real code from their experience is hard to fake. The signal is whether ctx.Done appears in every select, whether stages close their outputs in defer, and whether they can explain why the cascade works. If they cannot find a real example, ask them to write a two-stage pipeline at the whiteboard.

### Q: When have you used a nil channel intentionally?

This is a niche but powerful idiom (disabling a select case). If the candidate has used it, they have actually written non-trivial select code. If they have not, that is fine — but I would walk them through it and watch how they reason about it on the fly.

### Q: What does goleak do, and why might you not need it?

This catches whether they use it (they should, in tests for any non-trivial concurrent code) and whether they understand why it might still miss leaks (production code paths not covered by tests; transient leaks under specific timing). The honest answer is "goleak helps but is not sufficient — you also need production monitoring."

### Q: When would you prefer a sync.Mutex over channels?

Looking for nuance: shared read-mostly state, simple counters, embedded synchronization in a struct. The flag is dogmatic answers; the strong answer is "I default to channels for ownership and pipelines, mutex for shared state with fine-grained access patterns."

### Q: Explain the difference between closing a context and closing a channel.

Closing a context propagates a signal through ctx.Done(), which is a channel under the hood, plus an error via ctx.Err(). Closing a channel directly is a lower-level operation with the same broadcast semantics but no error attached. The signal here is whether they understand that context.WithCancel is essentially a managed done channel with extra plumbing.

### Q: How do you decide buffer size for a channel?

The right answer starts with "default to unbuffered, add buffer only when measurement shows it." Then: buffer size should match the burst pattern of producers, not the rate. Setting buffer to a large number "for performance" is a smell. If you need to absorb bursts of 10 events without blocking, buffer 10. If you need to decouple producer and consumer rates long-term, you have a design problem.

### Q: Walk me through how you would refactor a 200-goroutine fan-out into something supervisable.

Looking for: identify the supervisor as a single goroutine that spawns and tracks children; use errgroup or a custom supervisor with restart policies; ensure every child respects ctx cancellation; pass a result channel back to the supervisor. The signal is whether they reach for structured concurrency principles instinctively rather than just adding more goroutines until it "works."

---

## Cheat Sheet

| Operation | Behavior |
|-----------|----------|
| `ch := make(chan T)` | Unbuffered, synchronous rendezvous |
| `ch := make(chan T, N)` | Buffered, async until full |
| `ch <- v` on closed channel | Panic |
| `ch <- v` on nil channel | Blocks forever |
| `<-ch` on closed channel | Returns zero value, ok=false |
| `<-ch` on nil channel | Blocks forever |
| `close(ch)` twice | Panic |
| `close(ch)` on nil channel | Panic |
| `range ch` | Loops until close, then exits |
| `select` with all blocking cases | Picks one when ready, random if multiple |
| `select` with default | Default runs if nothing else is ready |
| `select` with nil channel case | Case never fires |

| Pattern | Use When |
|---------|----------|
| Unbuffered channel | Default; tight backpressure; rendezvous |
| Buffered channel | Absorb known burst size; decouple producer/consumer |
| `chan struct{}` | Signaling only; close to broadcast |
| `chan chan T` | Request-response; worker handoff |
| Directional types | Document and enforce read/write at API boundaries |
| `select` + ctx.Done | Universal cancellation in every blocking op |
| Nil channel toggle | Disable a select case dynamically |
| WaitGroup + closer | Multiple producers, single close |
| `goleak` in tests | Detect leaks before production |
| Pipeline with defer close | Cascade termination cleanly |

| Anti-pattern | Why It's Bad |
|--------------|--------------|
| Close from receiver | Cannot know if more sends are pending; races |
| Close twice | Panic |
| Send on closed | Panic |
| Default in tight loop | Busy spin, 100% CPU |
| Buffered to "go faster" | Hides backpressure, increases latency |
| Single-case select | Wasted machinery; just use plain send/recv |
| Range without close | Goroutine leak forever |
| Select without ctx.Done | Goroutine leak on cancellation |
| Mixing close and WaitGroup wrong | Race between WaitGroup completion and close |

| Diagnostic | What It Tells You |
|------------|-------------------|
| `runtime.NumGoroutine()` | Total goroutine count; grows = leak |
| `/debug/pprof/goroutine?debug=2` | Full stacks; group by frame |
| `goleak.VerifyNone(t)` | Tests fail on leaked goroutines |
| `GODEBUG=schedtrace=1000` | Scheduler stats every 1s |
| `go test -race` | Detects data races |
| `runtime/trace` | Visualize goroutine lifetimes |

---

### Q: How do you reason about happens-before across channels?

The Go memory model guarantees: a send on a channel happens-before the corresponding receive completes. For unbuffered channels, the receive happens-before the send completes (which is stronger — it pairs them). For buffered channels, the k-th receive on a channel with capacity C happens-before the (k+C)-th send completes. Closing a channel happens-before a receive that returns the zero value because the channel is closed. These guarantees mean a channel doubles as a memory fence: any writes you did before sending are visible to the receiver after it receives. This is why you can pass pointers through channels safely without further locks, provided you do not touch the pointed-to data after sending.

### Q: When does select pick a case if multiple become ready at the same instant?

The runtime's select algorithm, simplified: it shuffles the case order, then evaluates whether each can proceed; the first ready one in the shuffled order wins. The uniform randomness is deliberate and important for fairness — a select with a job channel and a quit channel will not preferentially process jobs over quits or vice versa. The interview signal: do they know it is random, and do they know why (fairness)? A common follow-up is "how would you implement priority?" — the answer is the nested-select trick with default on the outer select.

### Q: How are channel operations compiled — do they always go through the runtime?

For the simple cases (single-case select with a known channel), the compiler can inline a fast path, but the general case goes through runtime functions like `chansend`, `chanrecv`, and `selectgo`. Each of these takes the channel's lock, checks the wait queues, and either transfers a value directly between goroutine stacks or buffers it. The cost is roughly 50-200 nanoseconds per operation depending on contention. For interview purposes, the key insight is that channels are not magic — they are protected by a mutex internally and incur scheduler overhead, which is why hot inner loops sometimes need atomic operations or lock-free queues instead.

---

## Further Reading

- C.A.R. Hoare, "Communicating Sequential Processes" (CACM, 1978) — the original paper
- C.A.R. Hoare, "Communicating Sequential Processes" (book, 1985) — the formal process algebra
- A.W. Roscoe, "Understanding Concurrent Systems" — modern treatment with FDR
- "The Go Memory Model" (golang.org spec) — channel operations and happens-before
- Sameer Ajmani, "Advanced Go Concurrency Patterns" (GopherCon 2014)
- Rob Pike, "Concurrency is not Parallelism" (Heroku Waza 2012)
- Bryan Mills, "Rethinking Classical Concurrency Patterns" (GopherCon 2018)
- Katherine Cox-Buday, "Concurrency in Go" (O'Reilly book)
- `go.uber.org/goleak` documentation
- `golang.org/x/sync/errgroup` — structured concurrency for goroutines that can fail
- Nathaniel J. Smith, "Notes on structured concurrency" — the principles, applied across languages

---

## Related Topics

- [Concurrency Models](../README.md) — index of all concurrency model topics
- [Shared Memory](../01-shared-memory/README.md) — the alternative CSP responds to
- [Actor Model](../02-actor/README.md) — closest relative; address-vs-channel as identity
- [Event Loop](../03-event-loop/README.md) — single-threaded async, no CSP rendezvous
- [Coroutines](../05-coroutines/README.md) — cooperative scheduling, often paired with channels
- [Go Scheduler](../../runtime-and-internals/04-scheduler/README.md) — how goroutines actually run
- [Context Source](../../15-go-source-reading/04-context-source/README.md) — the cancellation primitive
- [Channels Deep Dive](../../runtime-and-internals/05-channels/README.md) — runtime implementation of chan
- [Select Internals](../../runtime-and-internals/06-select/README.md) — how select is compiled and executed
