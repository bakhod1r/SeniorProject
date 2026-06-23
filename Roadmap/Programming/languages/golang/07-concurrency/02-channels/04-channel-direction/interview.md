# Channel Direction — Interview Questions

> Real questions from screening rounds to staff-level system design. Each comes with a short ideal answer and, where useful, a follow-up to test depth.

---

## Junior — Syntax and Semantics

### Q1. What are the three channel-type forms in Go?

**A.** `chan T` (bidirectional), `chan<- T` (send-only), `<-chan T` (receive-only). The `<-` arrow indicates which way values flow relative to the channel.

### Q2. Which of these compile?

```go
var bi chan int   = make(chan int)
var s  chan<- int = bi
var r  <-chan int = bi
var b2 chan int   = s
```

**A.** The first three compile. The fourth does not — `chan<- int` cannot be widened back to `chan int`. The implicit conversion is one-way only.

### Q3. Can you `close` a `<-chan T`?

**A.** No. The compiler rejects it. Only bidirectional and send-only references may close. The rule reflects the design principle that the producer owns the channel's lifetime.

### Q4. What does `make(<-chan int)` produce?

**A.** That is a compile error. `make` only creates bidirectional channels (`chan T`). To get a directional view, assign or pass the bidirectional channel where the directional type is expected.

### Q5. In `func f(ch chan<- int)`, what is forbidden inside `f`?

**A.** Receiving from `ch` (`<-ch`). The channel direction permits sends and close only. `len(ch)`, `cap(ch)`, comparisons with `nil`, and storing in another variable are all fine.

### Q6. What does the arrow next to `chan` mean?

**A.** It indicates the direction of data flow. `chan<-` means values go *into* the channel (send); `<-chan` means values come *out of* the channel (receive). Bare `chan` allows both.

### Q7. Is direction a runtime or compile-time property?

**A.** Purely compile-time. The runtime sees a regular `*hchan` regardless of the source-level direction. The compiler refuses illegal operations before generating code.

### Q8. Does direction affect performance?

**A.** No. The compiler emits identical machine code for sends and receives regardless of source-level direction. The conversion from `chan T` to `chan<- T` is a zero-cost type widening.

---

## Junior → Middle — Patterns

### Q9. Sketch a pipeline stage signature.

**A.**
```go
func stage(ctx context.Context, in <-chan In) <-chan Out
```
Receive-only input, receive-only output. Inside, the stage creates a bidirectional output channel, spawns a goroutine that reads from `in` and writes to `out`, closes `out` on exit, and returns the receive-only view.

### Q10. Why is `defer close(out)` important in a pipeline stage?

**A.** It guarantees the consumer's `range` loop terminates on every exit path: end-of-input, ctx cancellation, or panic. Without it, downstream consumers can block forever waiting on a never-closed channel.

### Q11. How do you let an external caller stop a long-lived producer without giving them the bidirectional channel?

**A.** Pass a `context.Context` for cancellation. The producer's `select` includes `case <-ctx.Done(): return`. The caller can cancel via the context without needing to touch the channel.

### Q12. Why is returning `<-chan T` better than returning `chan T` from a constructor?

**A.** Three reasons: (1) the caller cannot close the channel, which is the producer's job; (2) the caller cannot accidentally send into the channel, polluting the stream; (3) the contract is documented in the type, no comment required.

### Q13. Convert this to use directional types:

```go
func filter(in chan int, out chan int, pred func(int) bool) {
    for v := range in {
        if pred(v) { out <- v }
    }
    close(out)
}
```

**A.**
```go
func filter(in <-chan int, out chan<- int, pred func(int) bool) {
    defer close(out)
    for v := range in {
        if pred(v) { out <- v }
    }
}
```
Inputs narrow to receive-only, outputs narrow to send-only. `defer close(out)` improves safety on panic.

### Q14. What is the worker pool signature?

**A.**
```go
func worker(jobs <-chan Job, results chan<- Result) {
    for j := range jobs {
        results <- process(j)
    }
}
```
Read-only job queue, write-only result queue. The worker cannot close the job queue (dispatcher's job) or read from the result queue (aggregator's job).

### Q15. What happens to a `<-chan T` when the underlying channel is closed?

**A.** A receive returns the element type's zero value and `ok=false`. A `range` loop ends. The directional view does not change this behaviour — it is the same as for a bidirectional reference.

---

## Middle — Conversions and Edge Cases

### Q16. Does `[]chan int` convert to `[]<-chan int` implicitly?

**A.** No. The implicit widening of channel direction does not extend to slice types. You must build a `[]<-chan int` explicitly by copying each element.

### Q17. Can you compare `chan int` and `chan<- int` with `==`?

**A.** No. They are different types and cannot be compared directly. You can compare two values of the same directional type to check if they reference the same underlying channel.

### Q18. What is the type of `<-someChan` if `someChan` is `chan<- int`?

**A.** That is a compile error. The receive operation is illegal on a send-only channel.

### Q19. Can you have a function that returns `chan<- T`?

**A.** Yes, though it is less common than returning `<-chan T`. A useful case: a queue object exposes its input side via a method like `func (q *Queue) In() chan<- Task`. Callers can submit tasks but not consume them.

### Q20. What does `chan<- <-chan int` mean?

**A.** A send-only channel whose element type is a receive-only channel of int. You send `<-chan int` values into it. Reading right-to-left: outer `chan<-` of element type `<-chan int`. Common in dynamic fan-out brokers.

### Q21. Why might you store a channel in a struct as `chan T` rather than `<-chan T`?

**A.** Internal use needs both sides. The struct itself owns the channel; methods expose narrowed views. Keeping the field bidirectional lets internal methods send, receive, and close as appropriate.

### Q22. How would you write `Map` as a generic pipeline stage?

**A.**
```go
func Map[A, B any](ctx context.Context, in <-chan A, f func(A) B) <-chan B {
    out := make(chan B)
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

### Q23. Is `chan<- T → <-chan T` a legal conversion?

**A.** No. Both are directional; neither is bidirectional. The assignability rule requires the source to be bidirectional. There is no escape hatch via explicit conversion either.

### Q24. Suppose a function returns `chan T`. You refactor it to return `<-chan T`. Is this a breaking change?

**A.** Yes if any callers were writing to or closing the returned channel — those calls would now fail to compile. If all callers were only reading or ranging, the change is safe and compatible. Run the build to verify.

### Q25. What happens if you do `close` on a `nil` `chan<- T`?

**A.** Runtime panic, same as closing a `nil` bidirectional channel. Direction does not affect nil semantics.

---

## Middle → Senior — Design Trade-offs

### Q26. When would you *not* use a directional type?

**A.** Three cases: (1) a symmetric peer-to-peer scenario where both ends send and receive; (2) a short function body where the role is obvious without narrowing; (3) legacy request/reply patterns where the reply channel travels inside a request struct and the server must send into it.

### Q27. How does direction interact with `context.Context`?

**A.** They are complementary. `context.Context` handles cancellation across goroutine trees; directional channels handle data flow. Producers typically `select` on both the output channel and `ctx.Done()` to avoid blocking after cancellation.

### Q28. A subscriber holds `<-chan Event`. The publisher panics. What does the subscriber see?

**A.** Depends on whether the panic is recovered. If unrecovered, the entire program crashes. If recovered with a `defer recover` in the producer goroutine, the producer's `defer close(out)` still runs, and the subscriber's `range` ends cleanly. Direction does not change panic semantics.

### Q29. How would you design a plug-in interface using directional channels?

**A.**
```go
type Plugin interface {
    Process(in <-chan Event, out chan<- Event) error
}
```
The plug-in gets read-only access to its input and write-only access to its output. It cannot disrupt the host's internal pipelines via these channels — direction prevents reading from `out` or closing `in`.

### Q30. Why might exposing `chan T` as a public field be a bad idea?

**A.** Anyone can close it, send into it, or store it elsewhere with full bidirectional access. A method that returns `<-chan T` lets the package evolve internally (add metrics, switch implementations) without breaking callers and prevents misuse.

### Q31. Is direction part of an interface method's signature?

**A.** Yes. `Events() <-chan Event` and `Events() chan Event` are different signatures. An interface mandates the exact directional type. Implementations must return that type — the compiler will not allow a wider type as a substitute.

### Q32. Suppose you have a long-lived broadcast hub with many subscribers. How do you let subscribers unsubscribe?

**A.** Return a tuple from `Subscribe`: the receive-only channel and an unsubscribe function. The function (a closure inside the hub package) does the cleanup — removing the subscriber from the list and closing the channel under the hub's lock. The subscriber cannot close the channel directly because they hold `<-chan T`.

### Q33. Compare directional channels to Rust's `&` and `&mut`.

**A.** Both are compile-time disciplines that narrow what an aliasing reference can do. Rust's borrow checker is more general (it applies to all references, with lifetime tracking). Go's directional channels apply only to channels and are simpler. Both are zero-runtime-cost contracts enforced by the type system.

### Q34. Direction does not prevent goroutine leaks. Why?

**A.** Direction is about *operations*, not *control flow*. A producer with `chan<- T` that loops forever sending into a channel no one reads still leaks. Use `context.Context` for cancellation, `select` for non-blocking sends, and clear ownership for cleanup.

### Q35. When refactoring a large codebase to add directional types, what do you do first?

**A.** Audit. Grep for `chan ` (with trailing space) to find all channel parameters and returns. Narrow returns first because callers usually only read. Then narrow parameters. Then narrow struct fields and access methods. Each step is binary-compatible if the callers were already respecting the role.

---

## Senior → Staff — Architecture and Implementation

### Q36. How does the Go compiler enforce direction?

**A.** During type checking. The compiler's `*types.Chan` (or `types2.Chan`) carries a direction (`SendOnly`, `RecvOnly`, `SendRecv`). When checking a send statement, the type-checker confirms the channel's direction permits sends. Same for receive and close. The runtime has no enforcement.

### Q37. Why is direction stored in the type descriptor but not in `hchan`?

**A.** The runtime functions (`chansend`, `chanrecv`, `closechan`) treat all channels identically; they only need the buffer, the wait queues, and the closed flag. Direction is a type-system concept used by `reflect` to expose direction to user code. Storing it in `hchan` would waste memory and serve no purpose.

### Q38. Can you defeat directional types using `unsafe`?

**A.** Yes. Casting a `chan<- T` through `unsafe.Pointer` and back to a `chan T` bypasses the compiler check. The runtime cannot tell the difference and will accept sends and receives. This is undefined behaviour per the spec — do not do it in production.

### Q39. What does `reflect.TypeOf(make(chan int)).ChanDir()` return?

**A.** `reflect.BothDir`. The directional value is part of the channel's type descriptor. The constants are `RecvDir = 1`, `SendDir = 2`, `BothDir = 3` — `RecvDir | SendDir`.

### Q40. Can `reflect.MakeChan` create a receive-only channel directly?

**A.** No. `MakeChan` panics if you pass a directional type. You must create a bidirectional channel and convert (`Value.Convert`) to the directional type. The conversion follows the same one-way rule as the compiler.

### Q41. How would you implement a generic pipeline framework that works for any element type?

**A.** Use type parameters for the element type. Direction is concrete in each stage signature. Provide a small set of stages (`Map`, `Filter`, `Batch`, `Merge`) that take and return `<-chan T` and accept `context.Context` for cancellation. Each stage owns its output channel and closes it on exit.

### Q42. How do directional types interact with race conditions?

**A.** They do not prevent races. Direction is about which *operations* a reference can perform, not about *concurrent access*. Two goroutines sending on the same `chan<- T` reference is perfectly fine (sends are concurrency-safe), but two goroutines mutating a shared variable is still a race regardless of any channel direction.

### Q43. Design a pub/sub system where direction enforces correct usage.

**A.** Sketch:
```go
type Broker[T any] struct {
    in  chan T              // bidi internally
    subs map[chan T]struct{}
    mu  sync.Mutex
}

func (b *Broker[T]) Publish() chan<- T { return b.in }       // narrow
func (b *Broker[T]) Subscribe() <-chan T {                   // narrow
    c := make(chan T, 64)
    b.mu.Lock(); b.subs[c] = struct{}{}; b.mu.Unlock()
    return c
}
```
`Publish` returns send-only; `Subscribe` returns receive-only. Internal goroutine fans out from `b.in` to subscribers. Callers cannot mix up the roles.

### Q44. How does the Go memory model treat directional channels?

**A.** It does not distinguish. The happens-before rules ("the kth send is synchronized before the (k+C)th receive on a buffered channel," etc.) apply to operations on channels, not to directional types. The memory model is operation-level; direction is erased before it applies.

### Q45. What is the cost of storing direction in the type system?

**A.** A small amount of compiler complexity (type identity, assignability, conversion rules), a few extra bytes per channel-type descriptor in the binary (~80 bytes per unique directional type), and slightly more work in `reflect` to track and report the direction. None of these have runtime performance impact.

### Q46. When would generics let you abstract over channel direction?

**A.** They do not. You can write a constraint like `chan T | <-chan T | chan<- T`, but the type set is not useful inside a function body because no single operation is legal on all three types. In practice, you write the function three times if you need that, or use `reflect`. Real-world need is rare.

### Q47. Suppose a channel is held by both a bidirectional reference and a receive-only one. Can the receive-only reference observe sends from the bidirectional one?

**A.** Yes. They reference the same underlying channel; direction is only a static restriction on what each reference can do. The receive-only reference sees every value sent through the bidirectional one and observes the close.

### Q48. A team uses `chan T` everywhere; you propose narrowing. How do you sell it?

**A.** Show concrete benefits: (1) build-time errors instead of runtime panics for misuse; (2) self-documenting signatures cut code-review time; (3) zero performance cost; (4) makes future refactors safer. Show a real bug in their codebase that direction would have caught — e.g., a consumer closing a channel and crashing the producer.

### Q49. How do you handle a function that needs to read from one channel and write to another, where both have the same type?

**A.** Use distinct parameter directions: `func f(in <-chan T, out chan<- T)`. The two distinct directional types make the role clear and prevent accidental misuse. Each parameter is its own narrowed view; the bidirectional channels exist only outside `f`.

### Q50. Staff-level: design review for a streaming framework. The team proposes a `Stream` type with one bidirectional channel and "you can read or write." What is your feedback?

**A.** Push back. Bidirectional public APIs are almost always a sign that ownership has not been thought through. Ask: who closes? Who sends? Who reads? Each role should have a method that returns the narrowest directional type. The "you can read or write" framing is invitation to bugs at scale; the next intern who joins will write code that closes the channel out from under the framework.

Proposed alternative: `Stream.Publish() chan<- T` and `Stream.Subscribe() <-chan T`. The Stream owns the underlying channel and lifecycle. Subscribers and publishers each get the narrowest type for their role. This pattern scales to thousands of subscribers across the codebase without surprising failures.

---

## Closing Notes

Directional channels are a small feature with a large pay-off. Junior questions test syntax recognition; middle questions test pattern fluency; senior and staff questions test design judgment and the discipline to push back on weak abstractions. Practice writing pipelines, refactoring legacy APIs, and reading other people's code through a "who can send, who can close" lens.

The most common interview mistake: treating direction as a syntax curiosity rather than a contract. Frame your answer around the contract, the ownership, and the consequences — that signals seniority more than any single fact about `<-chan T`.
