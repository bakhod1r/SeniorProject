# Channel Direction — Optimisation Exercises

> Direction itself has zero runtime cost. The optimisation goal here is to use direction as a **design tool** — narrowing APIs, eliminating dead-code bug surface, and combining direction with adjacent concerns (buffering, generics, refactor safety) for code that is faster *and* clearer.

---

## Principle: Direction is Free; Misdesign Is Not

The conversion from `chan T` to `chan<- T` or `<-chan T` is a no-op at runtime. The compiler emits identical machine code. There is nothing to "optimise" about direction per se.

What we can optimise is the *code shape* that direction enables:

- Eliminate accidental bidirectional access that leads to runtime panics, bug-fix patches, and defensive code.
- Replace ad-hoc loops with generic pipeline stages that compose cleanly.
- Refactor old `chan T`-heavy APIs to make new code build only if it respects roles.

Each optimisation below is about *catching mistakes at compile time* or *reducing code volume*, not about CPU cycles. Channel sends and receives are the bottleneck if any direction-related code matters at all.

---

## Exercise 1 — Narrow every pipeline stage

**Starting code:**

```go
func gen(nums ...int) chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        for _, n := range nums {
            out <- n
        }
    }()
    return out
}

func square(in chan int) chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        for v := range in {
            out <- v * v
        }
    }()
    return out
}

func print(in chan int) {
    for v := range in {
        fmt.Println(v)
    }
}
```

**Optimisation.** Narrow returns to `<-chan int` and parameters to `<-chan int`.

```go
func gen(nums ...int) <-chan int { /* unchanged body */ }

func square(in <-chan int) <-chan int { /* unchanged body */ }

func print(in <-chan int) { /* unchanged body */ }
```

**Win.** Every line of code that uses these functions now has compile-time enforcement of the role. Future refactors that accidentally send into a "read" channel or close a "write" channel from the wrong side fail to build. Zero runtime impact.

**Verification.** Compile the new version; run the tests; commit.

---

## Exercise 2 — Replace ad-hoc loops with generic stages

**Starting code:**

You have five copies of essentially the same pipeline pattern:

```go
func ints2strs(in <-chan int) <-chan string {
    out := make(chan string)
    go func() {
        defer close(out)
        for v := range in {
            out <- strconv.Itoa(v)
        }
    }()
    return out
}

func strs2upper(in <-chan string) <-chan string {
    out := make(chan string)
    go func() {
        defer close(out)
        for v := range in {
            out <- strings.ToUpper(v)
        }
    }()
    return out
}

// ... three more copies for other type pairs ...
```

**Optimisation.** Replace with one generic `Map`:

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

Callers become one-liners:

```go
strs := Map(ctx, ints, strconv.Itoa)
upper := Map(ctx, strs, strings.ToUpper)
```

**Win.** Less code, fewer goroutine bookkeeping bugs (one canonical close path, one ctx integration). Compile-time direction enforced. Generics give type-safety for free.

---

## Exercise 3 — Eliminate "flexibility" return types

**Starting code:**

```go
// Returns chan int "in case caller wants flexibility"
func Stream() chan int {
    ch := make(chan int)
    go func() { /* publish */ close(ch) }()
    return ch
}
```

**Audit.** Find every caller. Do any of them write to or close the returned channel?

If no callers write or close, narrow:

```go
func Stream() <-chan int {
    ch := make(chan int)
    go func() { /* publish */ close(ch) }()
    return ch
}
```

**Win.** Future callers cannot write or close — the contract is now type-enforced. Existing call sites continue to compile because they only read.

If *some* callers do write, they are misusing the API. Fix them. Then narrow.

---

## Exercise 4 — Replace `chan T` struct fields with method accessors

**Starting code:**

```go
type Broker struct {
    Out chan Event   // public, bidirectional
}

func main() {
    b := newBroker()
    for e := range b.Out {
        process(e)
    }
}
```

**Optimisation.** Wrap the field:

```go
type Broker struct {
    out chan Event   // private
}

func (b *Broker) Out() <-chan Event { return b.out }
```

Callers change one line:

```go
for e := range b.Out() {       // method call instead of field
    process(e)
}
```

**Win.** Callers cannot close or send. The Broker can evolve internally — add metrics, change the channel implementation, add filtering — without breaking the API.

---

## Exercise 5 — Pre-narrow inside long producer goroutines

**Starting code:**

```go
func source(ctx context.Context) <-chan Event {
    ch := make(chan Event)
    go func() {
        defer close(ch)
        for {
            evt, ok := fetch()
            if !ok {
                return
            }
            select {
            case ch <- evt:
            case <-ctx.Done():
                return
            }
        }
    }()
    return ch
}
```

**Optimisation.** Inside the goroutine, narrow `ch` to a local `chan<- Event`:

```go
func source(ctx context.Context) <-chan Event {
    ch := make(chan Event)
    go func() {
        var out chan<- Event = ch    // narrow inside goroutine
        defer close(out)
        for {
            evt, ok := fetch()
            if !ok {
                return
            }
            select {
            case out <- evt:
            case <-ctx.Done():
                return
            }
        }
    }()
    return ch
}
```

**Win.** Inside the goroutine, you cannot accidentally read from `ch` (a real bug we saw in earlier exercises). Trivial cost; small but real safety improvement.

---

## Exercise 6 — Replace one bidirectional with two directional fields

**Starting code:**

```go
type Pipe struct {
    ch chan Message
}

func (p *Pipe) Send(m Message) { p.ch <- m }
func (p *Pipe) Recv() Message  { return <-p.ch }
```

**Optimisation.** Split into two narrowed fields:

```go
type Pipe struct {
    in  chan<- Message
    out <-chan Message
}

func NewPipe() *Pipe {
    ch := make(chan Message, 16)
    return &Pipe{in: ch, out: ch}
}
```

Now expose access through the typed fields:

```go
p.in  <- m
m := <-p.out
```

**Win.** External access goes through directional fields. The `Pipe` struct's underlying channel is hidden; senders see only the send side, readers see only the read side. Reduces accidental misuse.

---

## Exercise 7 — Buffered channel direction + buffer sizing

**Starting code:**

```go
func produce(out chan<- int) {
    defer close(out)
    for i := 0; i < 10000; i++ {
        out <- i
    }
}

func consume(in <-chan int) int {
    sum := 0
    for v := range in {
        sum += v
    }
    return sum
}

func main() {
    ch := make(chan int)
    go produce(ch)
    fmt.Println(consume(ch))
}
```

**Optimisation.** Add a buffer to reduce send/receive synchronisation overhead. Direction stays the same:

```go
ch := make(chan int, 256)    // buffered
```

**Win.** Direction is unchanged; the conversion to `chan<- int` and `<-chan int` works the same. Buffered channel reduces context switches for high-throughput pipelines (covered in detail in the `01-buffered-vs-unbuffered` subsection).

**Note.** Direction is orthogonal to buffer size. A `chan<- T` with capacity 256 behaves identically to a `chan T` with capacity 256, when used with the same operations.

---

## Exercise 8 — Use direction to enable parallel refactoring

**Starting state.** A package has 50 functions that all use `chan T`. You want to refactor in PRs without blocking the team.

**Strategy.** Narrow returns first, in independent PRs:

- PR 1: narrow `func A() chan T` to `func A() <-chan T`. Check call sites.
- PR 2: narrow `func B(ch chan T)` to `func B(in <-chan T)`. Check call sites.
- PR 3: ... and so on.

Each PR is small and independently reviewable. The build catches conflicts.

**Win.** A 50-function refactor becomes 50 small reviewable PRs that other team members can merge without coordination conflicts. Direction makes each step safe.

---

## Exercise 9 — Use direction in tests for clearer fixtures

**Starting code:**

```go
func TestSomething(t *testing.T) {
    ch := make(chan int)
    go feed(ch)
    consume(ch)
}
```

**Optimisation.** Use the same narrowed signatures as production code:

```go
func TestSomething(t *testing.T) {
    ch := make(chan int)
    // feed expects chan<- int; consume expects <-chan int
    var feeder chan<- int = ch
    var reader <-chan int = ch
    go feed(feeder)
    consume(reader)
}
```

**Win.** Test code looks like production code. If you accidentally call `feed(reader)`, the build fails immediately. (Also the test does not work, but the build-time error is more helpful than a runtime hang.)

For variadic generic tests:

```go
func TestMerge(t *testing.T) {
    a := emit(1, 2, 3)         // returns <-chan int
    b := emit(4, 5, 6)
    out := Merge(ctx, a, b)     // <-chan int
    var sum int
    for v := range out {
        sum += v
    }
    if sum != 21 {
        t.Errorf("got %d", sum)
    }
}
```

---

## Exercise 10 — Replace tagged messages with separate channels

**Starting code:**

```go
type Op struct {
    Kind  string
    Value int
}

func process(ops chan Op) {
    for op := range ops {
        switch op.Kind {
        case "add":  // ...
        case "sub":  // ...
        case "mul":  // ...
        }
    }
}
```

**Optimisation.** Split into typed channels with direction:

```go
type Ops struct {
    Add <-chan int
    Sub <-chan int
    Mul <-chan int
}

func process(o Ops) {
    for {
        select {
        case v := <-o.Add: // ...
        case v := <-o.Sub: // ...
        case v := <-o.Mul: // ...
        }
    }
}
```

**Win.** No tagged-union dispatch in hot path. Type system enforces what kinds of operations can be sent. Direction in struct fields prevents the receiver from publishing fake ops back into any channel.

(Caveat: only worth it for small, fixed sets of operations. For many ops, a tagged message is simpler.)

---

## Exercise 11 — Use direction in plug-in interfaces

**Starting code:**

```go
type Plugin interface {
    Run(in chan Event, out chan Event) error
}
```

**Optimisation.** Narrow to roles:

```go
type Plugin interface {
    Run(in <-chan Event, out chan<- Event) error
}
```

**Win.** Plug-ins (which may be third-party code or generated mocks) cannot close `in`, cannot read from `out`, cannot send back into `in`. The interface is the contract; the type system enforces it.

If a plug-in needs to do something different (e.g., publish into the input stream), it must request that capability explicitly — typically via a different channel passed in. The narrowed defaults limit blast radius.

---

## Exercise 12 — Wrap async APIs with directional channels

**Starting code:**

```go
// Old API: takes a callback
func Subscribe(cb func(Event)) {
    go func() {
        for {
            cb(fetch())
        }
    }()
}
```

**Optimisation.** Wrap in a channel-based API with direction:

```go
func Stream(ctx context.Context) <-chan Event {
    out := make(chan Event, 64)
    go func() {
        defer close(out)
        for {
            select {
            case out <- fetch():
            case <-ctx.Done():
                return
            }
        }
    }()
    return out
}
```

**Win.** Callers can `select`, `range`, and integrate with the rest of their concurrency code. The `<-chan Event` return enforces the role. The producer goroutine closes on context cancellation.

---

## Exercise 13 — Use direction with `errgroup`

**Starting code:**

```go
var wg sync.WaitGroup
errCh := make(chan error, n)
for _, item := range items {
    wg.Add(1)
    go func(item Item) {
        defer wg.Done()
        if err := process(item); err != nil {
            errCh <- err
        }
    }(item)
}
wg.Wait()
close(errCh)
for err := range errCh {
    log.Println(err)
}
```

**Optimisation.** Use `golang.org/x/sync/errgroup` and pass the directional channel:

```go
g, ctx := errgroup.WithContext(context.Background())
errs := make(chan error, n)
for _, item := range items {
    item := item
    g.Go(func() error {
        if err := process(item, ctx); err != nil {
            select {
            case errs <- err:
            case <-ctx.Done():
            }
            return err
        }
        return nil
    })
}
g.Wait()
close(errs)
```

Or, more idiomatic, let `errgroup` collect the errors directly. Direction shows up if you build a pipeline of error-aware stages, each returning `<-chan Result` where `Result` has an `Err` field.

**Win.** Clear contract, ctx-aware send, no goroutine leaks.

---

## Exercise 14 — Lint for missing direction

**Project.** Build a linter that flags:

- Functions returning `chan T` where the body never sends.
- Functions taking `chan T` where the body never reads.

```go
// Using golang.org/x/tools/go/analysis
var Analyzer = &analysis.Analyzer{
    Name: "chandirection",
    Doc:  "suggests narrowing channel direction at function boundaries",
    Run:  run,
}
```

**Win.** Once you add this to CI, every new function automatically gets reviewed for narrowing opportunities. Over time, the codebase converges to narrow types.

---

## Exercise 15 — Performance: zero-cost direction in benchmarks

**Project.** Verify direction has no runtime cost.

```go
func BenchmarkBi(b *testing.B) {
    ch := make(chan int, 1)
    for i := 0; i < b.N; i++ {
        ch <- i
        <-ch
    }
}

func BenchmarkSendOnly(b *testing.B) {
    ch := make(chan int, 1)
    var s chan<- int = ch
    var r <-chan int = ch
    for i := 0; i < b.N; i++ {
        s <- i
        <-r
    }
}
```

Run `go test -bench=. -count=10` and compare. Expect identical numbers within noise (variation < 1%).

**Win.** Empirical confirmation that direction is purely compile-time.

---

## Exercise 16 — Reduce allocation via shared bi-channel field

**Starting code:**

```go
type Worker struct {
    in  chan Job        // bi internally; accessed via methods
}

func (w *Worker) Submit(j Job)        { w.in <- j }
func (w *Worker) Jobs() <-chan Job    { return w.in }
```

**Optimisation.** This is already optimal. The single `chan Job` field is shared; the accessors expose narrowed views (one of them via `<-chan Job` return, the other via method body). No extra allocation per access.

Compare to a hypothetical bad design:

```go
func (w *Worker) Jobs() <-chan Job {
    out := make(chan Job)         // allocate a new channel each call!
    go func() {
        for j := range w.in {
            out <- j
        }
    }()
    return out
}
```

That allocates and spawns per call. The simple `return w.in` is correct.

**Win.** Confirm that narrowing via implicit conversion does not allocate; refactor any "wrapping" goroutines that are not needed.

---

## Exercise 17 — Avoid premature narrowing inside short functions

**Starting code:**

```go
func tinyHelper(ch chan int) {
    var s chan<- int = ch
    s <- 42
    var r <-chan int = ch
    _ = <-r
}
```

**Optimisation.** Drop the local narrowing:

```go
func tinyHelper(ch chan int) {
    ch <- 42
    <-ch
}
```

**Win.** Less clutter, same compile-time guarantees. Reserve narrowing for boundaries where it documents intent; in 10-line helpers, narrowing adds nothing.

---

## Exercise 18 — Pipeline stage with backpressure

**Starting code:**

```go
func slowStage(in <-chan int) <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        for v := range in {
            time.Sleep(10 * time.Millisecond)
            out <- v
        }
    }()
    return out
}
```

**Optimisation.** Direction is already correct. The bottleneck is the sleep; the design is fine but slow. To speed up, fan out:

```go
func slowStage(ctx context.Context, in <-chan int, workers int) <-chan int {
    out := make(chan int)
    var wg sync.WaitGroup
    wg.Add(workers)
    for i := 0; i < workers; i++ {
        go func() {
            defer wg.Done()
            for v := range in {
                time.Sleep(10 * time.Millisecond)
                select {
                case out <- v:
                case <-ctx.Done():
                    return
                }
            }
        }()
    }
    go func() { wg.Wait(); close(out) }()
    return out
}
```

**Win.** Throughput scales with workers. Direction stays narrow at the boundaries; each worker's local closure parameter can be narrowed too if you want.

---

## Exercise 19 — Code review checklist

Build a personal checklist for PRs that touch channels:

1. Every channel return is `<-chan T` (unless caller needs to send).
2. Every channel parameter has the narrowest direction.
3. Every struct field with a channel is unexported; access via methods.
4. Every method that returns a channel chooses the narrowest direction.
5. Every pipeline stage uses `defer close(out)` inside its goroutine.
6. Every long-lived producer respects `context.Context`.
7. Every channel created with `make` lives in exactly one goroutine that owns close.
8. Test code uses the same narrowed signatures as production.

**Win.** Reviews become mechanical for direction concerns. Substantive discussion moves to logic and lifecycle.

---

## Exercise 20 — Pre-allocate slice of directional channels

**Starting code:**

```go
func fanOut(in <-chan int, n int) []<-chan int {
    var outs []<-chan int
    for i := 0; i < n; i++ {
        ch := make(chan int)
        outs = append(outs, ch)
        go func(c chan<- int) {
            defer close(c)
            for v := range in {
                c <- v
            }
        }(ch)
    }
    return outs
}
```

**Optimisation.** Pre-allocate the slice:

```go
func fanOut(in <-chan int, n int) []<-chan int {
    outs := make([]<-chan int, 0, n)        // pre-allocated capacity
    for i := 0; i < n; i++ {
        ch := make(chan int)
        outs = append(outs, ch)
        go func(c chan<- int) {
            defer close(c)
            for v := range in {
                c <- v
            }
        }(ch)
    }
    return outs
}
```

**Win.** One allocation for the slice instead of growth. Direction stays the same; the optimisation is unrelated but worth noting in fan-out code.

---

## Final Notes

Channel direction does not optimise CPU cycles. It optimises *engineering* — fewer bugs, faster reviews, safer refactors, clearer APIs. Treat it as a design tool and a static analyser combined.

The exercises above focus on:

1. **Narrowing API boundaries** — the single highest-value direction-related optimisation.
2. **Replacing repetition with generics** — direction stays consistent across the generic stages.
3. **Refactor safety** — direction lets you split big refactors into small reviewable PRs.
4. **Linting and tooling** — automate the narrowing decision.

Use direction everywhere it adds clarity. Skip it in 10-line helpers where the role is obvious. Combine it with `context.Context`, `errgroup`, `sync.Once`, and the rest of the concurrency toolkit. The compound effect is a codebase where build-time errors catch bugs that would otherwise become production incidents.
