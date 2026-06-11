# Actor Model & CSP — Interview Q&A

> **Roadmap:** [Programming Paradigms](../README.md) → Actor Model & CSP
>
> *The **actor model** (Hewitt) and **CSP** (Hoare) are two ways to structure concurrency around the same idea: isolated units that own private state and coordinate only by passing messages — no shared memory, no locks. They split on the mechanics. Actors are **named** units with a **mailbox**, send **asynchronously**, and run on **supervision trees**; CSP processes are **anonymous**, communicate over **channels**, and (classically) **rendezvous synchronously**. Know the shared slogan, the mechanical differences, and the trade-offs you take on in exchange for losing data races.*

A bank of 40+ interview questions from junior definitions to staff-level architecture. Each answer models how a strong candidate reasons — naming the trade-off and the runtime reality, not just the textbook line. Use the `<details>` toggles to self-quiz: read the question, answer aloud, then expand.

Examples are in **Erlang/Elixir** (actors), **Go** (CSP — goroutines and channels), and **Akka/Scala** pseudocode where it clarifies an idea.

---

## Table of Contents

1. [Fundamentals / Junior](#fundamentals--junior)
2. [Mechanics / Middle](#mechanics--middle)
3. [Trade-offs & Design / Senior](#trade-offs--design--senior)
4. [Distribution & Architecture / Staff](#distribution--architecture--staff)
5. [Code-Reading — What Happens?](#code-reading--what-happens)
6. [Curveballs](#curveballs)
7. [Rapid-Fire / One-Liners](#rapid-fire--one-liners)
8. [How to Talk About Message Passing in Interviews](#how-to-talk-about-message-passing-in-interviews)
9. [Summary](#summary)
10. [Related Topics](#related-topics)

---

## Fundamentals / Junior

> The core idea, the two models, and the "why no locks" reasoning.

**Q1. What's the core idea shared by the actor model and CSP?**

<details><summary>Answer</summary>

Structure concurrency as **isolated units that own private state and coordinate only by passing messages** — never by sharing memory. No two units touch the same data, so there's nothing to race on and no locks are needed. The Go slogan captures it: *"Don't communicate by sharing memory; share memory by communicating."* Both the actor model (Hewitt, 1973) and CSP (Hoare, 1978) are concrete realizations of this one idea; they differ in the mechanics (named mailboxes + async vs anonymous channels + rendezvous).
</details>

**Q2. Why does message passing avoid data races *by construction*?**

<details><summary>Answer</summary>

A data race needs three ingredients at once: **shared memory**, **two concurrent accesses**, and **at least one write**. Message passing removes the first — the mutable state lives inside one unit, which processes one message at a time, so there's never a second concurrent accessor. The race isn't *fixed* with a lock; it's made **impossible to express**, the same way a type system makes "add a number to a string" un-writable. That's why no locks are needed inside a unit.
</details>

**Q3. What is an actor?**

<details><summary>Answer</summary>

An independent concurrent unit with three things: **private state** nobody else can touch, an **address** (handle) others use to send it messages, and a **mailbox** (queue) where incoming messages wait. It processes **one message at a time**, and in response to a message it can: update its state, send messages to other actors, and **spawn new actors**. Those three responses (Hewitt's definition) are the whole model. Erlang processes and Akka actors are the canonical implementations.
</details>

**Q4. What is a mailbox?**

<details><summary>Answer</summary>

The per-actor queue holding messages that have arrived but aren't processed yet. Anyone with the actor's address can drop a message in; only the actor reads from it, one message at a time. By default it's **unbounded** (it grows), which is convenient but a hazard under load — a fast sender can grow it until the process runs out of memory. The "one reader, one message at a time" property is exactly what makes the actor's state updates lock-free.
</details>

**Q5. What is CSP, and how do goroutines and channels relate to it?**

<details><summary>Answer</summary>

CSP — Communicating Sequential Processes (Hoare) — models concurrency as **anonymous processes communicating over channels**. Go is the mainstream embodiment: a **goroutine** is the lightweight process, and a **channel** (`make(chan T)`) is the typed pipe they pass values through. `ch <- v` sends, `<-ch` receives. The key CSP feature is the **synchronous rendezvous**: on an unbuffered channel, a send blocks until another goroutine receives — the hand-off *is* the synchronization. So "goroutine + channel" is CSP, the way "actor + mailbox" is the actor model.
</details>

**Q6. Actor model vs CSP — name the main differences.**

<details><summary>Answer</summary>

| | Actor | CSP |
|---|---|---|
| Unit | **Named** (has an address) | **Anonymous** |
| Carrier | **Mailbox** (one per actor) | **Channel** (a shared pipe) |
| Default send | **Asynchronous** (don't wait) | **Synchronous rendezvous** (wait for receiver) |
| Buffer | **Unbounded** mailbox | **Bounded** channel |
| Backpressure | Not automatic | **Built in** (sender blocks when full) |

Same slogan (no shared memory, message passing), opposite defaults: actors are *named, async, unbounded*; CSP is *anonymous, sync, bounded*.
</details>

**Q7. If there's no lock, what stops two messages from corrupting an actor's state?**

<details><summary>Answer</summary>

The actor processes **one message at a time**. Two senders can fire messages concurrently, but they land in the mailbox and are handled **sequentially**, so the two state updates never overlap — there's no moment when two pieces of code are mid-update on the same data. Serialization is structural (one owner, one-at-a-time), not enforced by a lock you might forget. It's the *single-writer principle* baked into the runtime.
</details>

**Q8. Synchronous vs asynchronous messaging — what's the difference and who uses which?**

<details><summary>Answer</summary>

**Asynchronous**: the send returns immediately; the sender doesn't wait for the message to be received or processed (Erlang `Pid ! msg`, fire-and-forget). **Synchronous (rendezvous)**: the send completes only when a receiver takes the message (Go's unbuffered `ch <- v` blocks until a `<-ch`). Classic actors default to async; classic CSP defaults to sync. The practical consequence: synchronous gives you **backpressure for free** (a fast sender is throttled to the receiver), while asynchronous decouples sender and receiver but lets queues grow unbounded.
</details>

**Q9. What does "share memory by communicating" actually mean?**

<details><summary>Answer</summary>

It inverts the usual approach. Normally you *communicate by sharing memory*: multiple threads read/write one variable and guard it with locks. Go's slogan says do the opposite — keep the data owned by **one** goroutine, and let others access it by **sending messages** to that owner. The "memory" (the state) is effectively *shared* in the sense that everyone can affect it — but only *through communication*, never by direct concurrent access. That removes the locks because there's only ever one accessor.
</details>

**Q10. Give a real-world system built on each model.**

<details><summary>Answer</summary>

**Actors:** WhatsApp and Discord backends (Erlang/Elixir), where each connection/user is a cheap actor; Ericsson's telecom switches (Erlang's birthplace). **CSP:** Go services like Kubernetes and Docker, where each request is a goroutine and components coordinate via channels. The pattern in both: lots of independent concurrent things (connections, requests, jobs) modeled as isolated units, lock-free.
</details>

---

## Mechanics / Middle

> Addresses, channels, select, ordering, and request/reply.

**Q11. How do you do request/reply if sends are one-way?**

<details><summary>Answer</summary>

You **build** the round trip by carrying the return path in the request. In actors, include your own address (and a unique ref/tag) in the message; the actor sends a reply message back to it, and you match the reply by ref. In CSP, put a fresh **reply channel** *inside* the request struct; the server sends the answer back on it. Either way, *and always bound the wait with a timeout* (`receive ... after`, or `select` with `time.After`) — a reply might never come if the peer crashed, and an unbounded wait turns one lost message into a permanent hang.
</details>

**Q12. What is `select` in CSP and why is it essential?**

<details><summary>Answer</summary>

`select` waits on **several** channel operations at once and proceeds with whichever is ready first. It's how a single process handles multiple message sources, plus timeouts and cancellation, without busy-waiting. Idioms: `case <-ctx.Done()` for cancellation, `case <-time.After(d)` for timeouts, multiple `case <-chN` for fan-in. Without `select`, a goroutine could only block on one channel at a time, making multi-source coordination impossible. The actor analogue is **selective receive** — pattern-matching to pick which message in the mailbox to handle next.
</details>

**Q13. What ordering guarantees do messages have?**

<details><summary>Answer</summary>

**Point-to-point FIFO, no global order.** If A sends m1 then m2 to B, B receives m1 before m2. But if A and C both send to B, the order B sees their messages is **undefined** — there's no global clock. Across a network, even point-to-point ordering can weaken. The practical rules: never rely on cross-sender ordering, and match replies by a **correlation id**, not by "it's the next message in my mailbox" (another message may slip in first).
</details>

**Q14. Is there mutable state in actor/CSP programs?**

<details><summary>Answer</summary>

Yes — plenty. The actor's `count`, the goroutine's local `n`: these mutate on every message. The principle isn't "no mutation," it's "**no *shared* mutation.**" Each unit can be fully imperative internally because its state is **encapsulated behind a single owner** — nothing outside can observe a half-finished update. So message passing gives you the benefits of mutable state without the cost of sharing it. An actor is essentially an object whose method calls are serialized through a queue.
</details>

**Q15. Buffered vs unbuffered channel in Go — what changes?**

<details><summary>Answer</summary>

**Unbuffered** (`make(chan T)`): a send blocks until a receiver is ready — a synchronous rendezvous, full backpressure. **Buffered** (`make(chan T, n)`): a send blocks only when the buffer is *full*; a receive blocks only when it's *empty*. A buffered channel is the closest CSP gets to a (bounded) mailbox — it decouples sender and receiver up to `n` items, then re-applies backpressure. Crucially it's *bounded*: it is **not** an unlimited queue, which surprises people expecting Erlang-style growing mailboxes.
</details>

**Q16. How does an actor change behavior over time (a state machine)?**

<details><summary>Answer</summary>

An actor's "behavior" is the function that handles the next message, and it can **swap** that function based on the current message. In Erlang you recurse into a *different* loop function (`idle(State)` handles a message and calls `busy(State')`); in Akka you `become`/return a new behavior. This is how actors model state machines cleanly: the *set of messages it will accept and how it reacts* changes with state, with no shared flag and no lock. OTP formalizes this as `gen_statem`.
</details>

**Q17. In CSP, who owns a channel? Can many goroutines use one channel?**

<details><summary>Answer</summary>

A channel isn't owned by one process — it's a shared conduit. Many goroutines can send on it and many can receive from it. A **worker pool** is exactly N goroutines all receiving from the *same* jobs channel; the runtime hands each job to one of them. This is a key difference from actors: an actor's mailbox belongs to *one* actor, so you address a *recipient*; a channel decouples sender from receiver, so you address a *pipe* and whoever's listening receives. Convention (not the language) usually designates one goroutine as the closer.
</details>

**Q18. What does closing a channel do, and is there an actor equivalent?**

<details><summary>Answer</summary>

`close(ch)` signals "no more values will be sent." Receivers can detect it (`v, ok := <-ch`; `ok` is false when drained) — it's the clean broadcast-shutdown mechanism, e.g. a `done` channel telling all workers to stop. There's no direct actor analogue: actors don't "close" mailboxes; you send an explicit `stop`/`shutdown` message, or the actor is terminated by its supervisor. Note: sending on a closed channel **panics**, and closing twice panics — closing is a "sender's responsibility, once" discipline.
</details>

---

## Trade-offs & Design / Senior

> What you gain, what you trade, and when to choose message passing.

**Q19. Message passing has no locks — does that mean no concurrency bugs?**

<details><summary>Answer</summary>

No. It **trades** one set for another. You lose **data races** and **lock-ordering deadlocks**; you gain **message-flow deadlock** (two units each blocked awaiting the other's message), **mailbox overflow** (unbounded queues under a fast sender), **delivery uncertainty** (lost/duplicated messages across a network), and **no global consistent view**. Different bugs, not zero bugs. The honest senior line is "message passing makes concurrency *differently hard* — and often *better*-hard — not easy."
</details>

**Q20. How can a CSP/actor system deadlock?**

<details><summary>Answer</summary>

Cyclic waits on messages. In Go: two goroutines each try to send on an unbuffered channel before receiving from the other → both block forever. In actors: A does a synchronous *ask* to B and waits, while B is busy doing a synchronous ask to A — each is stuck in its own handler, unable to process the other's request. Mitigations: avoid synchronous request/reply inside a handler, impose a **DAG on message flow** (no cycles of synchronous waits — the message analogue of lock ordering), and **bound every wait with a timeout** so a deadlock degrades to a recoverable error.
</details>

**Q21. What is backpressure, and how do the two models handle it?**

<details><summary>Answer</summary>

Backpressure is throttling a fast producer to a slow consumer's rate so queues don't blow up. **CSP gives it for free**: an unbuffered/full channel blocks the sender. **Actors don't** — the unbounded mailbox just grows until OOM, with no built-in signal. So in an actor system backpressure is something you must **add deliberately**: bounded mailboxes that reject when full, drop-oldest/newest policies, or scaling consumers. The senior reflex is to always ask "what happens when the receiver can't keep up?" and pick the overflow policy *on purpose* — an unbounded mailbox is the accidental policy "grow until crash."
</details>

**Q22. Explain message delivery guarantees: at-most-once, at-least-once, exactly-once.**

<details><summary>Answer</summary>

**At-most-once**: zero or one delivery — no duplicates, possible loss (Erlang's cross-node default; cheap). **At-least-once**: one or more deliveries — no loss, possible **duplicates** (sender retries when unsure; needs acks). **Exactly-once**: precisely one — **not achievable as a pure transport guarantee** in a distributed system. You *approximate* it as **at-least-once delivery + idempotent processing** (dedupe by message id, or design operations so a replay is a no-op). The senior takeaway: "exactly-once delivery" is largely a myth; "exactly-once *effect*" via idempotency is the real, achievable goal. Pick the weakest guarantee that's correct for each message type.
</details>

**Q23. Why is there "no global consistent view" in a message-passing system, and when does that matter?**

<details><summary>Answer</summary>

Because there's no shared memory and no global clock, no instant exists at which you can read every unit's state consistently. By the time you've collected each actor's reply, the others have moved on. A consistent global snapshot requires a real algorithm (Chandy–Lamport) or a transactional store — it is *not* a free read. It matters when the problem **fundamentally needs a synchronous global invariant** (a strongly-consistent total enforced across all units): message passing makes that *harder*, and you'll reach for consensus or a transactional store anyway. It's a non-issue when the problem decomposes into mostly-independent units with local interactions.
</details>

**Q24. What is "let it crash," and why is it safe in an actor system?**

<details><summary>Answer</summary>

Instead of defensively handling every weird state in-line, you let the actor **crash** on an unexpected error and have a **supervisor restart it** from a known-good state. It's safe specifically because actor state is **isolated** — one actor crashing can't corrupt anything else, so a restart is a clean reset with no half-mutated shared memory to repair. The philosophy concentrates correctness in the supervisor and the known-good initial state instead of smearing defensive checks everywhere. It is *not* "be careless" — and it would be *reckless* in a shared-memory program where a crash can leave shared state corrupt or locks held.
</details>

**Q25. What is a supervision tree?**

<details><summary>Answer</summary>

A hierarchy where leaf actors do work and inner-node **supervisors** watch children and react to their deaths via a **restart strategy** (`one_for_one`: restart just the dead child; `one_for_all`: restart all siblings that share fate; `rest_for_one`: restart the dead child and those started after it). A **restart intensity** ("≤ N restarts per T seconds") retries transient bugs but **escalates** a persistent failure up the tree instead of restart-looping. The blast radius of a bug is the subtree of the supervisor that catches it — so designing the tree *is* designing fault tolerance. Erlang/OTP pioneered this; CSP/Go has no built-in equivalent.
</details>

**Q26. When should you choose message passing over shared memory + locks?**

<details><summary>Answer</summary>

Choose **message passing** when the problem decomposes into **isolated, stateful units** (entities, connections, jobs) that interact by request/reply, when you need **fault isolation/supervision**, or when you're going **distributed** (messages already cross processes). Choose **shared memory + locks** when the state is a **small, hot, read-mostly** value where a channel round trip per access is pure overhead, when everything's in one process with tiny obvious critical sections, or when you need a **consistent multi-variable read** a single lock makes trivial. The anti-pattern is forcing a message protocol onto what's really just a shared counter.
</details>

**Q27. Actors vs CSP — when would you pick one over the other?**

<details><summary>Answer</summary>

Pick **actors** when the domain is **stateful entities** ("one actor per user/order/device"), when you need **supervision and fault isolation**, or when you're going **distributed** (location transparency). Pick **CSP** when the problem is a **pipeline/flow** of work through stages, when you want **backpressure for free**, or when units are **anonymous and interchangeable** (a worker pool draining a channel) — and when you're in Go. Rule of thumb: actors think in *who* (entities with identity); CSP thinks in *flow* (data through pipes). Actors extend across the network; CSP is in-process.
</details>

**Q28. How do you debug an asynchronous message flow?**

<details><summary>Answer</summary>

The hard part is that one logical operation has **no single stack trace** — it's scattered across async hops. Techniques: **correlation/trace IDs** stamped on every message so logs stitch into one timeline (distributed tracing — mandatory, not optional); **typed messages** (Akka Typed, Go typed channels) so the compiler catches wrong-message-to-wrong-recipient; **log transitions** ("received Charge in state Idle → Charging"), not just states; and **watch mailbox/queue depths** as the leading indicator of overload or a stuck consumer. The meta-skill: you debug *flow* (what message went where, what got stuck), not *state* (what's in the variable).
</details>

---

## Distribution & Architecture / Staff

> OTP, location transparency, hot reload, and the link to microservices.

**Q29. What is location transparency, and what's the trap in it?**

<details><summary>Answer</summary>

Sending to an actor looks **identical** whether it's local, on the same machine, or across the network — you hold an address, you send, the runtime routes. It's powerful because the actor model never assumed shared memory, so distributing it is mostly routing, not a rewrite (deploy everything in one node, split across machines later). The **trap** is mistaking it for location *invisibility*: a remote send can be **delayed, reordered, lost, or hit a dead node**, with latency orders of magnitude higher. The *syntax* is the same; the *failure modes* are not. Design every possibly-remote send for failure — the network is not local memory (the Fallacies of Distributed Computing).
</details>

**Q30. What is Erlang/OTP, and why not just hand-roll the receive loop?**

<details><summary>Answer</summary>

OTP is the framework that turns Erlang's raw primitives into reusable **behaviors**: `gen_server` (a stateful server handling sync `call`/async `cast`), `gen_statem` (state machine), and `supervisor`. You fill in callbacks; OTP writes the mailbox loop, the request/reply plumbing, timeouts, supervision integration, and live introspection. You don't hand-roll `receive` because OTP encodes decades of hardening — correct timeout handling, clean shutdown, and supervision wiring — that's easy to get subtly wrong by hand. OTP is "the actor model productionized."
</details>

**Q31. What's the default cross-node delivery guarantee in Erlang, and why that choice?**

<details><summary>Answer</summary>

**At-most-once.** A cross-node `!` is fire-and-forget; if the network drops it or the link breaks, it's gone and the sender isn't told. The rationale: at-most-once is cheap with clean semantics, and Erlang deliberately pushes reliability up to **supervision and monitoring** (detect the dead peer via a monitor and react) rather than into the transport. When you need stronger, you build at-least-once (acks + retries) with **idempotent** receivers on top — the same pattern as Akka Persistence's `AtLeastOnceDelivery` or a durable queue.
</details>

**Q32. How does hot code reload work, and why does the paradigm enable it?**

<details><summary>Answer</summary>

The BEAM VM can load a new version of a module while processes run. A process loops by calling its behavior function; a **fully-qualified call** (`?MODULE:loop(State)`) dispatches to the *latest* loaded version, so between handling one message and the next, a process starts running new code — and OTP's `code_change` callback migrates old state to the new shape. The paradigm enables it because each process is **isolated and message-driven**: there's a natural safe point (between messages) to swap, and no shared mutable state straddling old/new code to corrupt. In a shared-memory thread pool there's no such clean seam. (Most modern deployments still prefer rolling/blue-green, but hot reload is the defining demonstration of what isolation buys.)
</details>

**Q33. How does the actor model relate to microservices and event-driven architecture?**

<details><summary>Answer</summary>

They're the same paradigm at different granularities. An actor is an isolated unit reacting to messages; a microservice consuming a queue is an isolated unit reacting to messages. The mailbox = the inbound queue (Kafka/SQS); point-to-point order = partition order; mailbox overflow = consumer lag; supervisor catching a poison message = dead-letter queue. The trade-offs transfer wholesale: no global view → sagas/eventual consistency; delivery uncertainty → idempotent consumers; async debugging → distributed tracing. So "microservices are actors over a network with a broker." Mastering this paradigm hands you one mental model from a single process up to a planet-scale system.
</details>

**Q34. Does Go's CSP work across machines?**

<details><summary>Answer</summary>

No — channels are **in-process** only. Go's CSP is a superb *intra-service* concurrency model (goroutines + channels + `context` + bounded pools), but distribution is handled by *external* infrastructure: gRPC, message queues, service meshes. This is the sharpest architectural difference from the actor lineage: **Erlang/Akka extend the same message-passing model across the wire** (location transparency), while **Go stops at the process boundary** and delegates the network to a broker. When you hear "does the message-passing model cross the process boundary?", that's the actor-vs-CSP fork at scale.
</details>

**Q35. How do Akka and Orleans scale actors across a cluster?**

<details><summary>Answer</summary>

**Akka Cluster Sharding** distributes entity actors (one per user/order) across nodes, routing a message for entity X to wherever X lives and migrating entities as nodes join/leave. **Akka Persistence** event-sources an actor (persist the *events*, replay them on restart) so "let it crash and restart" becomes durable. **Orleans** ("virtual actors"/grains) does the same with automatic activation/placement — you address a grain by identity and the runtime materializes it somewhere. The unifying idea: the actor is the unit of **state, concurrency, distribution, and failure all at once**, which is why it scales to millions of independently-living entities.
</details>

---

## Code-Reading — What Happens?

> You're shown a snippet; say what it does and why.

**Q36. Go — what does this print or do?**

```go
func main() {
    ch := make(chan int)   // unbuffered
    ch <- 1                // send
    fmt.Println(<-ch)
}
```

<details><summary>Answer</summary>

**Deadlock** — the program panics with `fatal error: all goroutines are asleep - deadlock!`. The channel is unbuffered, so `ch <- 1` blocks until *another* goroutine receives — but there's only the main goroutine, and it's stuck on the send, so the receive on the next line is never reached. Fix: run the send (or receive) in a separate goroutine (`go func(){ ch <- 1 }()`), or make the channel buffered (`make(chan int, 1)`) so the send doesn't block. This is the #1 beginner CSP trap: an unbuffered send with no concurrent receiver.
</details>

**Q37. Erlang — what's the bug here?**

```erlang
Pid = spawn(fun() -> server(0) end),
Pid ! {get, self()},
%% ... no receive for the reply ...
do_other_work().
```

<details><summary>Answer</summary>

The code sends a `{get, self()}` request but **never receives the reply**, so the answer sits unread in the *caller's* mailbox while `do_other_work()` runs on stale assumptions — and if this is in a loop, the mailbox fills with unmatched replies (a slow leak and a selective-receive performance hit). The send is **async**: `!` returns immediately and gives you nothing back. To get the value you must add a `receive {value, V} -> V after 5000 -> timeout end`. The lesson: actor sends are fire-and-forget; a reply is a separate message you must explicitly wait for (with a timeout).
</details>

**Q38. Go — is there a race in this counter "server"?**

```go
func counter(inc <-chan int) {
    n := 0
    for range inc { n++ }
}
// started once: go counter(inc); many goroutines do `inc <- 1`
```

<details><summary>Answer</summary>

**No race.** Although many goroutines send on `inc` concurrently, only the *single* `counter` goroutine ever touches `n`, and it handles one received value at a time — so the `n++` updates never overlap. The channel serializes the increments. This is the canonical "share memory by communicating" pattern: the mutable state has exactly one owner, and concurrency is mediated entirely through the channel. `go run -race` reports clean. (Contrast: if two goroutines both ran `n++` on a shared `n`, *that* would race.)
</details>

**Q39. Go — what's wrong with this goroutine?**

```go
func handle(ctx context.Context, in <-chan Job) {
    for {
        job := <-in          // blocks forever if `in` never gets another value
        process(job)
    }
}
```

<details><summary>Answer</summary>

A **goroutine leak**. The bare `<-in` blocks forever if no more jobs arrive and the channel is never closed — the goroutine never exits, leaking its stack and anything it captures, even after the request that spawned it is cancelled. Fix with `select` on cancellation and channel-close:

```go
for {
    select {
    case <-ctx.Done(): return
    case job, ok := <-in:
        if !ok { return }
        process(job)
    }
}
```

The CSP discipline at scale is "every blocking op also selects on `ctx.Done()`" — the #1 cause of Go memory growth is goroutines blocked on channels nobody will ever send to.
</details>

---

## Curveballs

> Questions designed to catch glib answers.

**Q40. "If I pass a pointer through a channel, that's message passing, right?"**

<details><summary>Answer</summary>

Only if you then **stop touching it on the sender side**. If both the sender and receiver keep a copy of the pointer and both mutate the pointed-to object, you've re-created **shared mutable state** and the data race you were avoiding — the channel did nothing for safety. True message passing requires passing **data** (immutable, or a value copy) *or* transferring ownership (the sender hands off the pointer and never touches it again — "I'm done with this, it's yours now"). The channel moves the *reference*; safety comes from the *ownership discipline*, not the channel itself.
</details>

**Q41. Is the actor model lock-free all the way down?**

<details><summary>Answer</summary>

No — at the *user* level you write no locks, but the runtime uses synchronization **internally**. A mailbox is a concurrent queue that multiple senders push to; that queue is implemented with locks or lock-free atomics under the hood. The win isn't that locks vanish from the universe — it's that they're **encapsulated in the runtime, written once and hardened**, instead of being your responsibility to place correctly in application code. You trade "many ad-hoc locks I can get wrong" for "one well-tested mailbox primitive." Same with Go channels: a channel is a mutex-protected ring buffer internally.
</details>

**Q42. Is an actor just an object?**

<details><summary>Answer</summary>

It's close — Alan Kay's original OOP vision (objects = isolated things communicating only by messages) is essentially the actor model, and an actor *is* "an object that runs in its own thread and whose method calls are serialized through a queue." But mainstream OOP objects diverged: method calls are **synchronous** (the caller's thread runs the method) and objects **share memory** (you pass references and call methods directly). An actor's "method calls" are **asynchronous messages** processed one-at-a-time by the actor's *own* concurrency, with **no shared state**. So actors are arguably *truer* to the original OO idea than C++/Java objects are. The difference that matters: async + isolated vs sync + shared.
</details>

**Q43. Does message passing scale better than shared memory? Isn't copying messages slower than sharing a pointer?**

<details><summary>Answer</summary>

It depends on what you're optimizing. *Per-operation*, copying a message **is** more work than dereferencing a shared pointer, and a channel round trip to read a value beats a direct read on raw latency. But shared memory has a hidden tax that doesn't scale: **lock contention and cache-line bouncing** — many cores fighting over one cache line serialize hard, and the contention gets *worse* with more cores. Message passing avoids that by giving each unit its own state (no shared cache line), and — decisively — it **crosses the network for free** because it never assumed shared memory. So: shared memory often wins *within one core/small critical sections*; message passing wins for *high core counts, isolation, and distribution*. "Faster" is the wrong frame — pick by the shape of the workload, not a blanket ranking.
</details>

**Q44. Is "exactly-once delivery" achievable? People claim their queue does it.**

<details><summary>Answer</summary>

Not as a pure *transport* guarantee over an unreliable network — you can't distinguish "the message was lost" from "the ack was lost," so any retry that guarantees no-loss risks a duplicate, and any no-duplicate policy risks a loss. What real systems mean by "exactly-once" is **at-least-once delivery + idempotent processing** (the consumer deduplicates by message id, or operations are designed so a replay is a no-op) — sometimes wrapped in a transaction that atomically commits "processed this message" with the side effect. So the honest answer is "exactly-once *effect*, yes; exactly-once *delivery*, no." A candidate who says "sure, exactly-once delivery" without that nuance is signaling they haven't built one.
</details>

**Q45. Async messaging removes deadlocks since nobody blocks — true?**

<details><summary>Answer</summary>

False, and a common trap. Pure fire-and-forget async messaging doesn't deadlock *on the send* — but real systems do **synchronous request/reply** (ask + await the result), and that re-introduces blocking and therefore deadlock: A awaits B's reply while B awaits A's. Even without explicit blocking, you can get a **logical livelock/stall** where two actors are each waiting for a message the other will only send after receiving one. Async lowers the *frequency* of deadlock but doesn't eliminate the possibility — which is why bounded waits (timeouts) and acyclic synchronous-call graphs still matter.
</details>

---

## Rapid-Fire / One-Liners

> Crisp answers; what an interviewer wants in one or two sentences.

**Q46. Actor model in one line?**

<details><summary>Answer</summary>

Isolated units, each with private state and a mailbox, that process one message at a time and coordinate only by asynchronous message sends.
</details>

**Q47. CSP in one line?**

<details><summary>Answer</summary>

Anonymous processes communicating over channels, classically by synchronous rendezvous (the send blocks until a receiver takes it).
</details>

**Q48. The one-sentence reason there are no data races?**

<details><summary>Answer</summary>

State is owned by one unit that handles one message at a time, so there's no shared memory and no second concurrent accessor to race with.
</details>

**Q49. Actor send: sync or async?**

<details><summary>Answer</summary>

Async — fire-and-forget; it returns immediately and gives you nothing back.
</details>

**Q50. Unbuffered Go channel send: sync or async?**

<details><summary>Answer</summary>

Synchronous — it blocks until another goroutine receives (a rendezvous).
</details>

**Q51. "Let it crash" in one sentence?**

<details><summary>Answer</summary>

Don't defensively handle every error; let the isolated unit crash and have a supervisor restart it from a known-good state.
</details>

**Q52. Message ordering guarantee?**

<details><summary>Answer</summary>

Point-to-point FIFO (A→B preserved); no global order across different senders.
</details>

**Q53. Erlang's default cross-node delivery guarantee?**

<details><summary>Answer</summary>

At-most-once — fire-and-forget; may be lost, never duplicated.
</details>

**Q54. Backpressure: which model gives it for free?**

<details><summary>Answer</summary>

CSP — a full/unbuffered channel blocks the sender. Actors don't (unbounded mailbox); you add it.
</details>

**Q55. Go slogan for this paradigm?**

<details><summary>Answer</summary>

"Don't communicate by sharing memory; share memory by communicating."
</details>

---

## How to Talk About Message Passing in Interviews

A few habits separate a strong answer from a textbook recital:

- **Lead with the shared slogan, then the split.** "Both avoid shared memory by passing messages; they differ in named-async-unbounded (actors) vs anonymous-sync-bounded (CSP)." That one sentence shows you understand the relationship, not just two disconnected facts.
- **Say "races avoided by construction, not fixed."** Then name the three race ingredients and which one is removed. It proves you understand the *mechanism*, not the slogan.
- **Always name the trade-off.** "No data races, but you trade them for message-flow deadlock, mailbox overflow, and no global view." Absolutism ("message passing has no concurrency bugs") is an instant tell; "it's differently hard, and here's how" reads senior.
- **Get the delivery guarantees right.** At-most/at-least-once, and "exactly-once delivery is a myth; exactly-once *effect* via idempotency is real." This one distinction separates people who've built distributed systems from people who've read about them.
- **Tie "let it crash" to isolation.** It's safe *because* state is isolated — that connection shows you understand why the philosophy works, not just that it exists.
- **Distinguish location transparency from invisibility.** Same syntax, radically different failure modes. Cite the Fallacies of Distributed Computing if you want to signal depth.
- **Connect to microservices.** "An actor's mailbox is a microservice's inbound queue" shows you carry one model from a single process to a distributed system — exactly the breadth staff interviews probe.
- **Don't claim "faster."** Message passing trades per-op cost for isolation, scalability across cores, and distribution. Pick by workload shape, not a blanket ranking.

---

## Summary

- The **actor model** (Hewitt) and **CSP** (Hoare) both structure concurrency as **isolated units exchanging messages**, with **no shared memory** — so data races are **impossible by construction** (the state has one owner handling one message at a time) and no locks are needed in application code.
- They split on **mechanics**: actors are **named** (address + mailbox), send **asynchronously**, have **unbounded** mailboxes, spawn **trees**, and run on **supervision**; CSP processes are **anonymous**, communicate over **channels** with a **synchronous rendezvous**, are **bounded** (free backpressure), and use **`select`**. Actors think in *who* (entities); CSP thinks in *flow*.
- The **trade-off** is the heart of senior answers: you lose data races and lock-ordering deadlock, and gain **message-flow deadlock**, **mailbox overflow**, **delivery uncertainty** (at-most-/at-least-once; "exactly-once" = at-least-once + **idempotency**), and **no global consistent view**. Debugging shifts from *state* to *flow*, making correlation IDs mandatory.
- The actor world's fault model — **"let it crash" + supervision trees** — is safe *because* state is isolated, and it scales (Erlang/OTP, Akka cluster sharding, Orleans) into a **distributed architecture** via **location transparency** (which is *not* location invisibility). **Go's CSP** scales superbly in-process but stops at the process boundary, delegating distribution to brokers.
- The biggest framing win: **event-driven microservices are this paradigm with a broker in the middle** — mailbox = queue, point-to-point order = partition order, supervisor = dead-letter handling — so one mental model spans a single process to a planet-scale system.

---

## Related Topics

- [`junior.md`](junior.md) — the intuition: mailboxes, channels, and races avoided by construction.
- [`middle.md`](middle.md) — the mechanics: addresses, `select`, ordering, request/reply, hidden mutable state.
- [`senior.md`](senior.md) — trade-offs, backpressure, supervision, and when message passing beats shared memory.
- [`professional.md`](professional.md) — OTP, supervision trees, location transparency, hot reload, Akka clusters, and microservice messaging.
- [05 — Reactive Programming](../05-reactive-programming/) — backpressure and streams as a paradigm.
- [06 — Dataflow & Stream Programming](../06-dataflow-and-stream-programming/) — pipelines, the CSP architecture cousin.
- [11 — Event-Driven Programming](../11-event-driven-programming/) — the same paradigm at microservice granularity.
- [Concurrency, Async & Parallelism](../../language-internals/concurrency-async-parallel/) — the thread/scheduler mechanics underneath.
- [System Design](../../../Architecture/system-design/) — message queues, delivery guarantees, sagas, and observability at scale.
