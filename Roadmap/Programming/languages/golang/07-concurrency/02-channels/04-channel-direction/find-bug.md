# Channel Direction — Find the Bug

> Each snippet below has a bug. Some are compile errors that direction would prevent or report; others are runtime issues caused by direction mistakes. For each, identify the bug, explain why it happens, and show the fix.

---

## Bug 1 — Consumer closes the channel

```go
func consumer(in chan int) {
    for v := range in {
        fmt.Println(v)
    }
    close(in)
}

func producer(out chan int) {
    defer close(out)
    out <- 1
    out <- 2
    out <- 3
}

func main() {
    ch := make(chan int)
    go producer(ch)
    consumer(ch)
}
```

**Bug.** The consumer attempts to `close(in)` after the producer has already closed it. This causes a runtime panic: "close of closed channel."

**Why it slipped through.** Both producer and consumer take `chan int` (bidirectional). The compiler cannot prevent the consumer from closing because the type permits it.

**Fix.** Narrow the consumer's parameter to `<-chan int`. Now the consumer cannot close at all — the compiler refuses.

```go
func consumer(in <-chan int) {
    for v := range in {
        fmt.Println(v)
    }
    // close(in) would not compile
}
```

This is the most common direction-related bug. Every pipeline consumer should take a receive-only channel.

---

## Bug 2 — Producer accidentally reads

```go
func producer(ch chan int) {
    for i := 0; i < 5; i++ {
        ch <- i
    }
    // accidentally added during refactor
    v := <-ch
    fmt.Println("got back:", v)
    close(ch)
}
```

**Bug.** The producer reads from its own channel after sending. This deadlocks (nothing on the channel to read; sends have all been received by the consumer goroutine) or returns a stale value depending on timing.

**Fix.** Narrow the parameter to `chan<- int`. The read `v := <-ch` becomes a compile error.

```go
func producer(ch chan<- int) {
    for i := 0; i < 5; i++ {
        ch <- i
    }
    close(ch)
}
```

The compiler now enforces the producer's contract.

---

## Bug 3 — Pipeline stage sends back upstream

```go
func square(in chan int) chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        for v := range in {
            out <- v * v
            in <- 0    // BUG: sends back to its own input
        }
    }()
    return out
}
```

**Bug.** The stage sends a sentinel `0` into `in`, polluting upstream data and potentially blocking or deadlocking.

**Fix.** Narrow `in` to `<-chan int` and `out` to `<-chan int` (returned). The line `in <- 0` becomes a compile error.

```go
func square(in <-chan int) <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        for v := range in {
            out <- v * v
            // in <- 0  // would not compile
        }
    }()
    return out
}
```

---

## Bug 4 — Trying to widen back

```go
func source() <-chan int {
    ch := make(chan int)
    go func() {
        defer close(ch)
        for i := 0; i < 3; i++ {
            ch <- i
        }
    }()
    return ch
}

func main() {
    r := source()
    bi := chan int(r)   // attempt to widen
    bi <- 99
}
```

**Bug.** The cast `chan int(r)` does not compile. Direction cannot be widened — once you hand out a `<-chan int`, the caller cannot get a bidirectional reference back.

**Fix.** If the caller needs to send, the function must give the caller a sendable view. Either return a `chan<- int` too:

```go
func source() (<-chan int, chan<- int) {
    ch := make(chan int)
    // ... goroutine ...
    return ch, ch
}
```

Or, redesign so the producer is the caller's own goroutine.

---

## Bug 5 — `select` send case on receive-only

```go
func sendAny(a, b <-chan int, msg int) error {
    select {
    case a <- msg:     // BUG
        return nil
    case b <- msg:     // BUG
        return nil
    }
}
```

**Bug.** `a` and `b` are receive-only channels. Sending on them is a compile error.

**Fix.** If the function genuinely sends, the parameters must be `chan<- int`:

```go
func sendAny(a, b chan<- int, msg int) error {
    select {
    case a <- msg:
        return nil
    case b <- msg:
        return nil
    }
}
```

---

## Bug 6 — Mock that "publishes" via the read channel

```go
type EventSource interface {
    Events() <-chan Event
}

type MockSource struct {
    out <-chan Event
}

func (m *MockSource) Events() <-chan Event { return m.out }

func (m *MockSource) Push(e Event) {
    m.out <- e         // BUG: cannot send on <-chan
}
```

**Bug.** The mock stores `out` as `<-chan Event`. Sending on it is illegal.

**Fix.** Store the channel as bidirectional internally; expose the receive-only view via `Events()`:

```go
type MockSource struct {
    out chan Event           // bi internally
}

func (m *MockSource) Events() <-chan Event { return m.out }
func (m *MockSource) Push(e Event)         { m.out <- e }
```

A common direction-design rule: internal fields are bidirectional; public methods narrow.

---

## Bug 7 — Producer goroutine that leaks on early return

```go
func collect(n int) []int {
    ch := make(chan int)
    go func() {
        for i := 0; i < n; i++ {
            ch <- i
        }
        close(ch)
    }()
    if n < 0 {
        return nil          // BUG: leaks the goroutine
    }
    var out []int
    for v := range ch {
        out = append(out, v)
    }
    return out
}
```

**Bug.** If `n < 0`, the goroutine sends on `ch` forever (well, never starts a send because the loop has zero iterations; but with the right condition it could). The function never drains the channel. If we shift the scenario slightly:

```go
go func() {
    ch <- compute()    // single send
}()
if condition {
    return  // ch is never read; goroutine blocks forever
}
v := <-ch
```

Here the goroutine is genuinely stuck sending into a channel that no one reads. The directional type does not help directly, but **if the goroutine's reference were `chan<- int`** it would be obvious that the goroutine holds the sender side and the caller (with the bidirectional or receive-only reference) must read.

**Fix.** Use a buffered channel for "produce once" or include a `ctx.Done()` case in the goroutine:

```go
ch := make(chan int, 1)   // buffer 1
go func() {
    ch <- compute()
}()
```

Now the send completes regardless of whether anyone reads, and the goroutine exits. Combine with `select` for cancellation:

```go
go func() {
    select {
    case ch <- compute():
    case <-ctx.Done():
        return
    }
}()
```

---

## Bug 8 — Public field exposed bidirectionally

```go
type Broker struct {
    Events chan Event   // exported, bidirectional
}

func New() *Broker {
    b := &Broker{Events: make(chan Event)}
    go b.run()
    return b
}

func (b *Broker) run() {
    for i := 0; i < 10; i++ {
        b.Events <- newEvent(i)
    }
    close(b.Events)
}
```

**Bug.** Subscribers can close `b.Events`, panic the producer, or send polluted events. Anyone with `b *Broker` has full bidirectional access.

**Fix.** Make the field unexported; expose a receive-only accessor:

```go
type Broker struct {
    events chan Event
}

func (b *Broker) Events() <-chan Event { return b.events }
```

External code can read and `range`, but not send or close.

---

## Bug 9 — Slice of channels with wrong type

```go
func merge(ins []<-chan int) <-chan int {
    out := make(chan int)
    var wg sync.WaitGroup
    wg.Add(len(ins))
    for _, in := range ins {
        go func(in <-chan int) {
            defer wg.Done()
            for v := range in {
                out <- v
            }
        }(in)
    }
    go func() { wg.Wait(); close(out) }()
    return out
}

// Caller:
bis := []chan int{a, b, c}
merged := merge(bis)   // BUG
```

**Bug.** `[]chan int` does not implicitly convert to `[]<-chan int`. The compiler refuses.

**Fix.** Construct the directional slice explicitly:

```go
recvs := make([]<-chan int, len(bis))
for i, c := range bis {
    recvs[i] = c
}
merged := merge(recvs)
```

Alternative: use generics with a variadic function so the caller can pass each channel separately:

```go
func merge[T any](ins ...<-chan T) <-chan T { ... }

merge(a, b, c)   // each ch implicitly narrows individually
```

---

## Bug 10 — Returning a directional channel from a constructor that needs to send later

```go
type Server struct {
    in <-chan Request    // BUG: server cannot send into this
}

func NewServer() (*Server, chan<- Request) {
    ch := make(chan Request)
    return &Server{in: ch}, ch   // BUG: cannot assign chan Request to <-chan Request... wait
}
```

**Bug.** The server is supposed to *read* from `in`. But then this declaration has it stored as `<-chan Request`. That is *correct* if the server only reads. The bug is in a different place: in the function body of the server's run method, suppose someone added:

```go
func (s *Server) run() {
    for req := range s.in {
        s.in <- req.Echo()   // BUG: cannot send into <-chan
    }
}
```

Compile error caught immediately.

**Fix.** If the server needs to echo, take a separate sender channel:

```go
type Server struct {
    in  <-chan Request
    out chan<- Response
}
```

Now the design is explicit: read from `in`, write to `out`.

---

## Bug 11 — Goroutine that holds both sides forever

```go
func loop() {
    ch := make(chan int)
    go func() {
        for v := range ch {
            fmt.Println(v)
        }
    }()
    // ch is never closed; the goroutine ranges forever
}
```

**Bug.** No one closes `ch`. The goroutine blocks on `range ch` forever. The function returns; nothing references `ch`; the goroutine is stranded.

**Fix.** Either close the channel before returning, or use `context.Context` for cancellation:

```go
func loop(ctx context.Context) {
    ch := make(chan int)
    go func() {
        for {
            select {
            case v := <-ch:
                fmt.Println(v)
            case <-ctx.Done():
                return
            }
        }
    }()
}
```

Direction does not directly help here, but if the goroutine took `<-chan int` it could not accidentally try to close it from the inside. The leak fix is via cancellation/lifecycle, not direction.

---

## Bug 12 — Direction in interface mismatch

```go
type Source interface {
    Events() <-chan Event
}

type S struct{}

func (s S) Events() chan Event { return make(chan Event) }   // BUG

func use(src Source) { _ = src.Events() }

func main() {
    use(S{})    // does this compile?
}
```

**Bug.** `S.Events` returns `chan Event`, but the interface requires `<-chan Event`. In Go, methods must have the *exact* type for interface satisfaction — there is no implicit narrowing in interface methods.

Wait — actually, this *does not* satisfy the interface because Go does not allow direction to widen in method signatures. The error: `S does not implement Source (wrong type for Events method: have func() chan Event, want func() <-chan Event)`.

**Fix.** Change the method's return type to match exactly:

```go
func (s S) Events() <-chan Event {
    ch := make(chan Event)
    return ch
}
```

Or expand the interface to accept `chan Event`, but then you lose the receive-only contract.

---

## Bug 13 — Channel-of-channel with wrong inner direction

```go
type Subscriber struct {
    in chan<- Event   // we send events to subscribers
}

type Hub struct {
    subs chan Subscriber
}

func (h *Hub) Run() {
    var all []Subscriber
    for sub := range h.subs {
        all = append(all, sub)
    }
    for _, s := range all {
        s.in <- newEvent()
    }
}

// Subscriber side:
func subscribe(hub *Hub) <-chan Event {
    ch := make(chan Event)
    hub.subs <- Subscriber{in: ch}   // BUG?
    return ch
}
```

**Bug.** Look closely. The `Subscriber.in` field is `chan<- Event`. The subscriber passes `ch` (a `chan Event`). Implicit narrowing: `chan Event → chan<- Event`. That works.

The subscriber returns `<-chan Event` to the user — that works too.

The bug is subtler: the subscriber's own goroutine has no reference to `ch` after the function returns. The hub holds the `chan<- Event` side. If the user's consumer goroutine exits early, the hub keeps trying to send into `ch`, blocking forever (assuming an unbuffered channel).

**Fix.** Buffer the channel and combine with `ctx`:

```go
ch := make(chan Event, 64)
```

And in the hub:

```go
select {
case s.in <- newEvent():
default:
    // drop, or unsubscribe
}
```

Direction is correct here; the leak is a separate issue.

---

## Bug 14 — Reflect direction mismatch

```go
ch := make(chan int)
v := reflect.ValueOf(ch)
v.Recv()                       // OK
v.Send(reflect.ValueOf(42))    // OK
v.Close()                      // OK

// Convert to send-only:
sendT := reflect.ChanOf(reflect.SendDir, reflect.TypeOf(0))
sv := v.Convert(sendT)
sv.Recv()                      // BUG
```

**Bug.** `sv` is a send-only view. Calling `Recv()` panics: "reflect: receive from send-only channel."

**Fix.** Only call operations that match the direction. To receive, keep a bidirectional view.

---

## Bug 15 — Direction inside a closure capture

```go
func startWorker(jobs chan Job) {
    go func() {
        for j := range jobs {
            process(j)
        }
        close(jobs)   // BUG: worker should not close
    }()
}
```

**Bug.** The worker closes the job queue, preventing other producers from sending and possibly causing panics in concurrent producers.

**Fix.** Narrow the parameter to `<-chan Job`; the close becomes a compile error.

```go
func startWorker(jobs <-chan Job) {
    go func() {
        for j := range jobs {
            process(j)
        }
        // close(jobs) — compile error
    }()
}
```

---

## Bug 16 — Mistaken type assertion direction

```go
func handle(i any) {
    if ch, ok := i.(chan int); ok {
        ch <- 0
        return
    }
    fmt.Println("not a channel")
}

func main() {
    var x chan<- int = make(chan int)
    handle(x)   // misses the type assertion
}
```

**Bug.** The type assertion `i.(chan int)` does not match `chan<- int`. The function prints "not a channel" instead of handling the case.

**Fix.** Add cases for all expected directions:

```go
func handle(i any) {
    switch ch := i.(type) {
    case chan int:
        ch <- 0
    case chan<- int:
        ch <- 0
    default:
        fmt.Println("not a sendable int channel")
    }
}
```

Or, accept `any` and use reflection to handle direction generically.

---

## Bug 17 — Buffered channel close race

```go
func produce(out chan<- int) {
    for i := 0; i < 5; i++ {
        out <- i
    }
    close(out)
}

func main() {
    ch := make(chan int, 2)
    go produce(ch)
    go produce(ch)             // BUG: two producers, both will close
    for v := range ch {
        fmt.Println(v)
    }
}
```

**Bug.** Two producers race to close the same channel. The second close panics: "close of closed channel."

**Fix.** Coordinate close. Use a `sync.WaitGroup` and a single closer goroutine:

```go
var wg sync.WaitGroup
wg.Add(2)
go func() { defer wg.Done(); produce(ch) }()
go func() { defer wg.Done(); produce(ch) }()
go func() { wg.Wait(); close(ch) }()
for v := range ch {
    fmt.Println(v)
}
```

Note: the `produce` function should *not* close; we removed that. The directional `chan<- int` parameter still permits close, but the design discipline is "only the coordinator closes."

Alternative: redesign so `produce` does not close, and the coordinator does:

```go
func produce(out chan<- int) {
    for i := 0; i < 5; i++ {
        out <- i
    }
    // no close here
}
```

This is a case where the directional type permits close but the design forbids it. Use `sync.Once` or a coordinator goroutine for safety.

---

## Bug 18 — Nil directional channel

```go
func main() {
    var ch chan<- int       // nil
    ch <- 1                  // blocks forever
}
```

**Bug.** A nil directional channel blocks just like a nil bidirectional channel. The program deadlocks. The runtime reports: "fatal error: all goroutines are asleep - deadlock!"

**Fix.** Initialise the channel before use:

```go
ch := make(chan int, 1)
var send chan<- int = ch
send <- 1
```

Direction does not change nil semantics; you still must make the channel first.

---

## Bug 19 — Closing a nil send-only channel

```go
func main() {
    var ch chan<- int
    close(ch)              // BUG: runtime panic
}
```

**Bug.** Closing a nil channel — directional or not — panics: "close of nil channel."

**Fix.** Always check for nil before closing, or guarantee the channel is initialised:

```go
if ch != nil {
    close(ch)
}
```

But in practice, you should not have a nil channel that needs closing — that is a design problem upstream.

---

## Bug 20 — Direction lost through `any`

```go
func storeAndRetrieve(ch chan<- int) chan<- int {
    var i any = ch
    out, _ := i.(chan int)   // BUG: dynamic type is chan<- int, not chan int
    return out
}
```

**Bug.** The type assertion to `chan int` fails because the dynamic type of `i` is `chan<- int`. The function returns a nil channel.

**Fix.** Assert to the correct type:

```go
out, _ := i.(chan<- int)
```

Or skip the round-trip through `any` if you do not need it.

---

## Final Notes

The bug patterns above fall into a few categories:

- **Wrong-side close.** Consumer closes; coordinator races to close; nil close. Narrow types and use `sync.Once` or coordinators.
- **Wrong-side send.** Reader sends; pipeline stage sends back. Narrow types.
- **Widening attempts.** Trying to convert directional back to bidirectional via cast, `any`, or reflect. Fails by design.
- **Lost direction in collections.** `[]chan T` does not become `[]<-chan T` implicitly. Construct explicitly.
- **Direction mismatches in interfaces.** Method signatures must match exactly.
- **Nil and panic semantics.** Direction does not change them; you still need defensive code.

Use directional types at every function boundary you control. The compiler will catch most of the bugs above before they reach the runtime. The rest (lifecycle, races, panics) require additional discipline — `context.Context`, `sync.Once`, `sync.WaitGroup`, `-race` in CI.
