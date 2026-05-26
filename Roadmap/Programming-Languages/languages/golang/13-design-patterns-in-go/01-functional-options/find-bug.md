# Functional Options — Find the Bug

A collection of realistic, broken functional-options snippets. Each one looks correct at a glance and has passed someone's code review at least once. For each: the symptom, the cause traced to a rule from `junior.md` or `middle.md`, and the fix. Read them in order — by the end you should be able to spot every pattern in a PR before it lands.

---

## Bug 1: The default that "helpfully" overrides

```go
package server

import "time"

type Server struct {
    addr        string
    readTimeout time.Duration
}

type Option func(*Server)

func WithReadTimeout(d time.Duration) Option {
    return func(s *Server) {
        if d == 0 {
            d = 30 * time.Second
        }
        s.readTimeout = d
    }
}

func NewServer(addr string, opts ...Option) *Server {
    s := &Server{addr: addr}
    for _, opt := range opts {
        opt(s)
    }
    return s
}
```

**Question.** A caller writes `NewServer(":8080", WithReadTimeout(0))` because they want *no* read timeout (block forever, the standard Go convention). What do they get, and why is it a bug?

<details><summary>Answer</summary>

**Bug.** They get `30 * time.Second`, not zero. The option silently rewrites their input.

**Why it's there.** The author put the default inside the option, not the constructor. From `junior.md` §7: defaults belong in the constructor. The option function should be a dumb field-setter. Here the option is also a policy decision-maker ("if you passed zero, you didn't really mean it") — and that decision is silent.

**How to spot in review.** Any `WithX` function that contains an `if d == 0` branch followed by an assignment to a literal default is the smell. The option should look like a single-line setter.

**Fix.**

```go
func WithReadTimeout(d time.Duration) Option {
    return func(s *Server) { s.readTimeout = d }
}

func NewServer(addr string, opts ...Option) *Server {
    s := &Server{
        addr:        addr,
        readTimeout: 30 * time.Second,  // default lives here
    }
    for _, opt := range opts {
        opt(s)
    }
    return s
}
```

**Why it's common.** The author thinks "what if the caller passes zero?" — and answers it inside the option. The right answer is "they meant zero". The constructor's default is what runs when no option was passed at all; nothing else.
</details>

---

## Bug 2: The shared map

```go
package httpclient

type Client struct {
    headers map[string]string
}

type Option func(*Client)

func WithHeaders(h map[string]string) Option {
    return func(c *Client) { c.headers = h }
}

func NewClient(opts ...Option) *Client {
    c := &Client{headers: map[string]string{}}
    for _, opt := range opts {
        opt(c)
    }
    return c
}

// caller code:
func setup() *Client {
    h := map[string]string{"X-Trace-Id": "abc"}
    c := NewClient(WithHeaders(h))
    h["X-Trace-Id"] = "def"   // (!)
    return c
}
```

**Question.** What does `c.headers["X-Trace-Id"]` read after `setup()` returns?

<details><summary>Answer</summary>

**Bug.** `"def"`. The option captured the caller's map by reference. Mutating `h` after the call mutates `c.headers` too.

**Why it's there.** Maps in Go are reference types — assigning a map shares the same backing hash table. `WithHeaders(h)` stored a reference, not a copy. From `middle.md` §13.1: hidden mutation of caller-owned state.

**How to spot in review.** Any option taking a map, slice, or pointer to a mutable struct, then directly assigning it to a field, without a defensive copy. Worth a comment in the godoc if you genuinely want to share; otherwise copy.

**Fix.**

```go
func WithHeaders(h map[string]string) Option {
    h2 := make(map[string]string, len(h))
    for k, v := range h {
        h2[k] = v
    }
    return func(c *Client) { c.headers = h2 }
}
```

The copy happens once, at option construction time. If the option is built once and applied many times (rare, but possible), you still pay only once.

**Why it's common.** Junior developers think "assigning a map field is the same as assigning an int field". It isn't. The same trap exists for slices and channels.
</details>

---

## Bug 3: The option that assumes a non-nil field

```go
type Server struct {
    logger *log.Logger   // not initialised by default
    debug  bool
}

type Option func(*Server)

func WithDebug() Option {
    return func(s *Server) {
        s.debug = true
        s.logger.Println("debug mode enabled")
    }
}

func NewServer(addr string, opts ...Option) *Server {
    s := &Server{}
    for _, opt := range opts {
        opt(s)
    }
    return s
}
```

**Question.** What happens when a caller writes `NewServer(":8080", WithDebug())`?

<details><summary>Answer</summary>

**Bug.** `s.logger` is nil. The option calls `s.logger.Println(...)`, which is a nil pointer dereference. Panic.

**Why it's there.** The option assumes some other option (or some default) has set `s.logger`. The constructor doesn't initialise the field, and the caller didn't pass `WithLogger`. From `junior.md` §11.4 and `middle.md` §13.3: options should not depend on side effects of other options. From §7: defaults belong in the constructor.

**How to spot in review.** Any option that *reads* or *invokes* a field on the target rather than just setting one. The smell is `s.X.Y(...)` or `if s.X != nil { ... }` inside an option.

**Fix.** Two changes. First, give every reference-typed field a non-nil default in the constructor:

```go
func NewServer(addr string, opts ...Option) *Server {
    s := &Server{
        logger: log.New(io.Discard, "", 0),  // safe default
    }
    for _, opt := range opts {
        opt(s)
    }
    return s
}
```

Second, move the "enable debug mode" side effect out of the option and into a post-loop step in the constructor:

```go
func WithDebug() Option {
    return func(s *Server) { s.debug = true }
}

func NewServer(addr string, opts ...Option) *Server {
    s := &Server{logger: log.New(io.Discard, "", 0)}
    for _, opt := range opts { opt(s) }
    if s.debug {
        s.logger.Println("debug mode enabled")
    }
    return s
}
```

**Why it's common.** Options look small enough that the author treats them as little scripts. They aren't — they're field-setters that may run in any order.
</details>

---

## Bug 4: Order-dependent options

```go
type Server struct {
    logger        *log.Logger
    metricsClient *metrics.Client
}

type Option func(*Server)

func WithLogger(l *log.Logger) Option {
    return func(s *Server) {
        s.logger = l
        if s.metricsClient != nil {
            s.metricsClient.SetLogger(l)   // wire the logger into metrics
        }
    }
}

func WithMetrics(m *metrics.Client) Option {
    return func(s *Server) { s.metricsClient = m }
}
```

**Question.** A caller writes `NewServer(":8080", WithLogger(l), WithMetrics(m))`. What's wrong?

<details><summary>Answer</summary>

**Bug.** `s.metricsClient` is nil when `WithLogger` runs. The wiring branch is silently skipped. The metrics client never learns about the logger.

If the caller switches the order — `WithMetrics(m), WithLogger(l)` — the wiring works. So the program's behaviour silently depends on caller order, with no error and no panic.

**Why it's there.** `WithLogger` tries to do two jobs: set a field and wire cross-field state. Options run in the order the caller passed them, so any option that reads another option's field has a race-with-caller-order. From `middle.md` §13.3.

**How to spot in review.** Any option that touches more than one field, especially one that checks `if s.Other != nil` before doing extra work, is suspect. Better still: any option whose body is more than one line of field assignment.

**Fix.** Defer cross-field wiring to a post-loop block in the constructor.

```go
func WithLogger(l *log.Logger) Option {
    return func(s *Server) { s.logger = l }
}

func WithMetrics(m *metrics.Client) Option {
    return func(s *Server) { s.metricsClient = m }
}

func NewServer(addr string, opts ...Option) *Server {
    s := &Server{}
    for _, opt := range opts { opt(s) }

    // Cross-field wiring runs once, after all options are applied.
    if s.metricsClient != nil && s.logger != nil {
        s.metricsClient.SetLogger(s.logger)
    }
    return s
}
```

**Why it's common.** It feels natural to put related work next to the option that "triggers" it. The pattern's discipline is: options set, the constructor wires.
</details>

---

## Bug 5: The forgotten three dots

```go
func buildOptions(env string) []Option {
    opts := []Option{WithLogger(defaultLogger)}
    if env == "prod" {
        opts = append(opts, WithReadTimeout(5*time.Second))
        opts = append(opts, WithMaxConns(10_000))
    }
    return opts
}

func main() {
    opts := buildOptions("prod")
    s := NewServer(":8080", opts)   // (!)
    _ = s
}
```

**Question.** Why doesn't this compile, and what is the "fix" a hurried developer might apply that creates a new bug?

<details><summary>Answer</summary>

**Bug.** `NewServer(":8080", opts)` passes a `[]Option` where `...Option` is expected. Compiler error: `cannot use opts (variable of type []Option) as Option value`.

The dangerous "fix": instead of writing `opts...`, the developer makes the signature accept a slice:

```go
func NewServer(addr string, opts []Option) *Server { ... }
```

Now every existing caller that wrote `NewServer(":8080", WithLogger(l), WithRetries(3))` breaks. To restore them, the developer wraps the args in a slice literal at every call site — and the API stops looking like functional options at all.

**Why it's there.** Forgetting `...` is one of the two most common functional-options bugs in production. The compiler catches it; the panic is when developers "fix" the compile error by changing the signature instead of fixing the call. From `middle.md` §14.1.

**How to spot in review.** Search the codebase for `[]Option{` followed by no `...` at the call site. Most editors highlight the type mismatch immediately. If a PR changes a constructor signature from `opts ...Option` to `opts []Option`, ask why.

**Fix.** Use the spread operator:

```go
func main() {
    opts := buildOptions("prod")
    s := NewServer(":8080", opts...)   // spread the slice into variadic args
    _ = s
}
```

**Why it's common.** Variadic forwarding is the only place in Go where slice-vs-spread matters at the call site. Developers who haven't internalised the rule reach for the type system instead.
</details>

---

## Bug 6: The uintptr of a closure pointer

```go
type Server struct {
    onShutdown func()
}

type Option func(*Server)

// "Optimisation": store the function as a uintptr to "avoid the closure allocation".
func WithShutdownHook(fn func()) Option {
    addr := uintptr(unsafe.Pointer(&fn))
    return func(s *Server) {
        recovered := *(*func())(unsafe.Pointer(addr))
        s.onShutdown = recovered
    }
}
```

**Question.** What goes wrong, and how often?

<details><summary>Answer</summary>

**Bug.** `addr` is a `uintptr` — the garbage collector does not see it as a reference. The `func()` value pointed to is on the closure's stack (or in a temporary heap cell that the GC can free once `fn` becomes unreachable). Between the construction of the option and its application, the GC may run; the `uintptr` cast back to `*func()` then dereferences freed memory.

Sometimes the value is still there by coincidence. Sometimes it's been overwritten. Under `-d=checkptr` it fails immediately: `fatal error: checkptr: pointer arithmetic result points to invalid allocation`.

**Why it's there.** Someone read that "closures allocate" and decided to be clever. They confused the closure-environment allocation (real, ~24 bytes for a no-capture closure) with the value `fn` itself (already heap- or stack-allocated, depending on escape analysis). The `unsafe.Pointer` → `uintptr` round-trip violates the rule that `uintptr` is not a real pointer.

**How to spot in review.** Any `unsafe.Pointer` inside an option is a red flag. There is no legitimate reason for an option to use `unsafe`. If you see it, escalate.

**Fix.** Just store the function:

```go
func WithShutdownHook(fn func()) Option {
    return func(s *Server) { s.onShutdown = fn }
}
```

A `func()` is already a (function-pointer + closure-pointer) pair. Storing it costs nothing measurable. The "optimisation" was illusory and introduced undefined behaviour.

**Why it's common.** Almost never in real production code — but it appears in benchmark-driven blog posts where someone insists `unsafe` is the path to "zero-allocation options". It isn't. Options allocate at construction; that allocation amortises to nothing across the program's lifetime.
</details>

---

## Bug 7: Mutating a package-level default

```go
package server

import "time"

var defaultTimeouts = map[string]time.Duration{
    "read":  30 * time.Second,
    "write": 30 * time.Second,
    "idle":  90 * time.Second,
}

type Server struct {
    timeouts map[string]time.Duration
}

type Option func(*Server)

func WithTimeout(kind string, d time.Duration) Option {
    return func(s *Server) { s.timeouts[kind] = d }
}

func NewServer(addr string, opts ...Option) *Server {
    s := &Server{timeouts: defaultTimeouts}
    for _, opt := range opts { opt(s) }
    return s
}
```

**Question.** What does the second call to `NewServer` see if the first call passed `WithTimeout("read", 5*time.Second)`?

<details><summary>Answer</summary>

**Bug.** The second call sees `timeouts["read"] = 5 * time.Second`, even though it passed no options. Worse, every future call to `NewServer` from anywhere in the program sees the mutation, forever.

The constructor assigned the package-level map to `s.timeouts`. Maps are reference types: `s.timeouts` and `defaultTimeouts` point at the same backing hash table. `WithTimeout` then mutates the shared map.

**Why it's there.** Storing defaults in a package-level variable looks like an optimisation ("allocate the defaults once, not per server"). But the moment any option mutates the field, the "default" is gone, replaced by whatever the most recent caller wanted. From `junior.md` §11.2 and `middle.md` §9.

**How to spot in review.** Any package-level variable holding a map, slice, or pointer-to-mutable-struct, used as a default in a constructor literal. The smell is `s := &T{field: packageVar}`.

**Fix.** Build a fresh map per call, in the constructor:

```go
func NewServer(addr string, opts ...Option) *Server {
    s := &Server{
        timeouts: map[string]time.Duration{
            "read":  30 * time.Second,
            "write": 30 * time.Second,
            "idle":  90 * time.Second,
        },
    }
    for _, opt := range opts { opt(s) }
    return s
}
```

If the defaults are long enough that you want a helper, return a fresh map from a function — never expose the map as a variable:

```go
func defaultTimeouts() map[string]time.Duration {
    return map[string]time.Duration{ /* ... */ }
}
```

**Why it's common.** Package-level vars feel "constant-like" to developers who don't think about reference semantics. Tests catch this only if they run in a specific order. The bug ships.
</details>

---

## Bug 8: The option that spawns a goroutine

```go
type Server struct {
    metricsCh chan int
}

type Option func(*Server)

func WithMetricsReporting(interval time.Duration, sink io.Writer) Option {
    return func(s *Server) {
        s.metricsCh = make(chan int, 64)
        go func() {
            t := time.NewTicker(interval)
            defer t.Stop()
            for range t.C {
                select {
                case v := <-s.metricsCh:
                    fmt.Fprintln(sink, v)
                default:
                }
            }
        }()
    }
}

func NewServer(addr string, opts ...Option) *Server {
    s := &Server{}
    for _, opt := range opts { opt(s) }
    return s
}
```

**Question.** What happens to that goroutine when the `Server` is no longer used? What if `NewServer` is called many times during a test suite?

<details><summary>Answer</summary>

**Bug.** The goroutine has no exit condition. It runs forever, holding a reference to `s.metricsCh` and `sink`, preventing both from being garbage-collected. Every call to `NewServer` leaks one goroutine. In a long-running service with reconfiguration, or a test suite that builds 1000 servers, the program accumulates goroutines indefinitely.

**Why it's there.** The option starts a background worker as a side effect. Functional options are not the right place for lifecycle-owning code. From `junior.md` §11.4 and `middle.md` §13.3 (cross-field wiring): options should set state, not spawn work.

**How to spot in review.** Any `go func()` inside a `WithX` function. Also any option that touches `time.NewTicker`, opens a file, or starts a connection. These all need a lifecycle (start, stop, error path) that an option cannot provide.

**Fix.** The option stores the configuration; the constructor (or a separate `Start` method) launches the goroutine with an explicit lifecycle.

```go
type Server struct {
    metricsInterval time.Duration
    metricsSink     io.Writer
    metricsCh       chan int
    stopCh          chan struct{}
    wg              sync.WaitGroup
}

func WithMetricsReporting(interval time.Duration, sink io.Writer) Option {
    return func(s *Server) {
        s.metricsInterval = interval
        s.metricsSink = sink
    }
}

func (s *Server) Start() {
    if s.metricsInterval == 0 { return }
    s.metricsCh = make(chan int, 64)
    s.stopCh = make(chan struct{})
    s.wg.Add(1)
    go func() {
        defer s.wg.Done()
        t := time.NewTicker(s.metricsInterval)
        defer t.Stop()
        for {
            select {
            case <-s.stopCh:
                return
            case <-t.C:
                select {
                case v := <-s.metricsCh:
                    fmt.Fprintln(s.metricsSink, v)
                default:
                }
            }
        }
    }()
}

func (s *Server) Stop() {
    close(s.stopCh)
    s.wg.Wait()
}
```

**Why it's common.** Options "feel" like setup steps, and "start the reporter" is part of setup. But options run synchronously during construction; goroutines they spawn outlive the constructor. The lifecycle must be explicit.
</details>

---

## Bug 9: Loop-variable capture in option construction

```go
type Server struct {
    handlers map[string]http.Handler
}

type Option func(*Server)

func WithHandler(path string, h http.Handler) Option {
    return func(s *Server) {
        if s.handlers == nil {
            s.handlers = make(map[string]http.Handler)
        }
        s.handlers[path] = h
    }
}

func registerAll(routes []Route) []Option {
    var opts []Option
    for _, r := range routes {
        opts = append(opts, WithHandler(r.Path, r.Handler))
    }
    return opts
}
```

Assume the Go version is 1.21 with `GOEXPERIMENT=loopvar` *off* (or the project's go.mod says `go 1.20`).

**Question.** What gets registered, and why?

<details><summary>Answer</summary>

**Bug.** All paths map to the *last* route's handler, and all the keys are the last route's path (so effectively one entry).

**Why it's there.** In pre-1.22 Go, the loop variable `r` is shared across iterations — there's one `r` for the whole loop, reassigned each iteration. `WithHandler(r.Path, r.Handler)` calls evaluate `r.Path` and `r.Handler` *at option-construction time*, but the field accesses use the current value of `r`. After the loop, `r` is the last route.

Wait — actually that part is fine, because `r.Path` is evaluated *now* (the argument is read at call time, not when the closure runs). The real trap is the older pattern:

```go
for _, r := range routes {
    opts = append(opts, func(s *Server) {  // (!) inline closure, not via WithHandler
        s.handlers[r.Path] = r.Handler
    })
}
```

Here `r` is captured *by reference* inside the closure. All closures share the same `r`, and after the loop it holds the last value. Every closure registers `(lastRoute.Path, lastRoute.Handler)`.

**Why it's there.** Until Go 1.22, the loop variable in `for _, r := range routes` was scoped to the whole loop, not to each iteration. Closures that captured `r` all saw the same memory. From `junior.md` §8 (what an option closure captures).

**How to spot in review.** Any `for ... range` building a `[]Option` (or any `[]func(...)`) where the closure body references the loop variable directly. The fix-shape is to shadow the variable inside the loop body, *or* to use a constructor function (like `WithHandler`) that takes the values as arguments — exactly because arguments are evaluated eagerly.

**Fix.** Either shadow:

```go
for _, r := range routes {
    r := r   // shadow
    opts = append(opts, func(s *Server) {
        s.handlers[r.Path] = r.Handler
    })
}
```

Or upgrade to Go 1.22+ where the loop variable is per-iteration by default. Or — the cleanest — never write inline closures in a range loop; always wrap them in a `WithX` constructor whose arguments capture the values eagerly:

```go
for _, r := range routes {
    opts = append(opts, WithHandler(r.Path, r.Handler))   // arguments evaluated now
}
```

The original code in this exercise is *correct* because it used `WithHandler`. The trap is what a reader assumes about loop-captured closures. Reading `routes`-loops as suspect-by-default is the habit to build.

**Why it's common.** This trap consumed years of Go community debugging time. It was so common that the language was changed in 1.22 to default to per-iteration scoping. Codebases still on `go 1.20` or `go 1.21` keep the old semantics.
</details>

---

## Bug 10: Silent validation failure

```go
type Server struct {
    maxConns int
}

type Option func(*Server)

func WithMaxConns(n int) Option {
    return func(s *Server) {
        if n <= 0 {
            return   // ignore invalid input
        }
        s.maxConns = n
    }
}

func NewServer(addr string, opts ...Option) *Server {
    s := &Server{maxConns: 100}
    for _, opt := range opts { opt(s) }
    return s
}
```

**Question.** A caller writes `NewServer(":8080", WithMaxConns(userInput))` where `userInput` is `-1` due to a bug upstream. What does the caller see, and what's wrong with what they see?

<details><summary>Answer</summary>

**Bug.** The server starts with `maxConns = 100` (the default), the caller has no idea their input was ignored, and debugging the resulting "why isn't my config taking effect?" investigation is the worst hour of their week.

**Why it's there.** The option silently swallows invalid input. The caller wrote `WithMaxConns(-1)` expecting something to happen; instead, *nothing* happens. The constructor's default wins by accident. From `junior.md` §11.4.

**How to spot in review.** Any option with an early-`return` on invalid input. The smell is `if n <= 0 { return }`. Either validate at the place the value enters the program (before calling the option), or thread the error back through the constructor.

**Fix.** Two valid choices.

Option A — panic in the option for programmer errors (caught in test):

```go
func WithMaxConns(n int) Option {
    if n <= 0 {
        panic(fmt.Sprintf("WithMaxConns: n must be > 0, got %d", n))
    }
    return func(s *Server) { s.maxConns = n }
}
```

Note: the panic happens at option *construction* time, not application time. This catches the bug at the call site, before `NewServer` is invoked.

Option B — error-returning options (see `middle.md` §4.2):

```go
type Option func(*Server) error

func WithMaxConns(n int) Option {
    return func(s *Server) error {
        if n <= 0 {
            return fmt.Errorf("WithMaxConns: n must be > 0, got %d", n)
        }
        s.maxConns = n
        return nil
    }
}

func NewServer(addr string, opts ...Option) (*Server, error) {
    s := &Server{maxConns: 100}
    for _, opt := range opts {
        if err := opt(s); err != nil { return nil, err }
    }
    return s, nil
}
```

**Why it's common.** Authors think "robust = doesn't crash on bad input". For an exported API consumed by other programmers, robust = "fails loud and early". Silent skip is the worst of both worlds.
</details>

---

## Bug 11: Options applied after Start()

```go
type Server struct {
    httpSrv *http.Server
    running atomic.Bool
}

type Option func(*Server)

func WithReadTimeout(d time.Duration) Option {
    return func(s *Server) { s.httpSrv.ReadTimeout = d }
}

func NewServer(addr string) *Server {
    return &Server{httpSrv: &http.Server{Addr: addr}}
}

func (s *Server) Apply(opts ...Option) {
    for _, opt := range opts { opt(s) }
}

func (s *Server) Start() error {
    s.running.Store(true)
    return s.httpSrv.ListenAndServe()
}

// caller:
func main() {
    s := NewServer(":8080")
    go s.Start()
    time.Sleep(100 * time.Millisecond)
    s.Apply(WithReadTimeout(5 * time.Second))   // (!)
}
```

**Question.** What's wrong with applying options after `Start()`?

<details><summary>Answer</summary>

**Bug.** Two things, both quiet.

First: `s.httpSrv.ReadTimeout` is read by the running server on a different goroutine. Writing to it from `Apply` races with that read. `-race` flags it: `WARNING: DATA RACE`.

Second: even ignoring the race, the timeout change may or may not affect already-accepted connections. `http.Server` reads `ReadTimeout` when constructing each new `Conn`; in-flight connections keep the old value. The caller thinks they reconfigured the server; in practice they reconfigured only connections that arrive after the mutation completes.

**Why it's there.** The author exposed `Apply` as a way to reconfigure a running server, but the underlying type has no thread-safe knobs. Functional options assume a single-threaded construction phase. Applying them mid-lifecycle violates that assumption.

**How to spot in review.** Any `Apply` (or equivalent) method on a target type that has a `Start`/`Run`/`Serve` method. The pattern is "options are construction-time only" — extending it post-construction needs explicit synchronisation.

**Fix.** Forbid post-start application. Either return an error, or rename the method to make the intent obvious:

```go
func (s *Server) Apply(opts ...Option) error {
    if s.running.Load() {
        return errors.New("server: cannot Apply options after Start")
    }
    for _, opt := range opts { opt(s) }
    return nil
}
```

If runtime reconfiguration is genuinely needed, design explicit thread-safe setters (`s.SetReadTimeout(d)`) that synchronise internally — they are not "options", they are imperative methods on a live object.

**Why it's common.** "Hot reload" looks like a natural extension of "configure on startup". It isn't. Construction-time configuration and runtime reconfiguration have different invariants, and pretending they're the same gives you data races.
</details>

---

## Bug 12: Generic options, wrong type parameter

```go
package opt

type Option[T any] func(*T)

func Apply[T any](t *T, opts []Option[T]) {
    for _, o := range opts {
        if o != nil { o(t) }
    }
}

// in package server:
type Server struct{ readTimeout time.Duration }
type Client struct{ readTimeout time.Duration }

func WithReadTimeout[T any](d time.Duration) opt.Option[T] {
    return func(t *T) {
        // attempt to set readTimeout — but T is unknown
        any(t).(*Server).readTimeout = d  // (!)
    }
}

func NewClient(opts ...opt.Option[Client]) *Client {
    c := &Client{}
    opt.Apply(c, opts)
    return c
}
```

**Question.** A caller writes `c := NewClient(WithReadTimeout[Client](5*time.Second))`. What happens at runtime?

<details><summary>Answer</summary>

**Bug.** `panic: interface conversion: *server.Client is not *server.Server`. The generic option assumed `T` is always `*Server`, but the caller instantiated it with `Client`. The type assertion `any(t).(*Server)` fails.

**Why it's there.** The author wanted "one `WithReadTimeout` for any type with a `readTimeout` field", but Go generics don't let you write that without a type constraint. Falling back to a type assertion on `any` defeats the type checker — the code compiles but is wrong for every `T` except `Server`.

**How to spot in review.** Any generic option containing `any(t).(*Concrete)` or `reflect.ValueOf(t).Elem().FieldByName(...)`. Generics inside an option should use the type parameter directly, never assert to a concrete type.

**Fix.** Either keep the option non-generic per target type:

```go
func WithClientReadTimeout(d time.Duration) opt.Option[Client] {
    return func(c *Client) { c.readTimeout = d }
}

func WithServerReadTimeout(d time.Duration) opt.Option[Server] {
    return func(s *Server) { s.readTimeout = d }
}
```

Or, if you really want one `WithReadTimeout` for both types, use an interface constraint and a setter:

```go
type readTimeoutSetter interface {
    setReadTimeout(time.Duration)
}

func (c *Client) setReadTimeout(d time.Duration) { c.readTimeout = d }
func (s *Server) setReadTimeout(d time.Duration) { s.readTimeout = d }

func WithReadTimeout[T readTimeoutSetter](d time.Duration) opt.Option[T] {
    return func(t *T) { (*t).setReadTimeout(d) }
}
```

But this is usually more code than just writing two options. From `middle.md` §6.2: if you need constraints on `T`, you've probably left the functional-options pattern.

**Why it's common.** Generics were added to Go in 1.18 and developers reach for them eagerly. The right reflex is: generic options pay off only when the option *infrastructure* (Apply, Combine, If) is shared, not the individual options themselves.
</details>

---

## Bug 13: Interface-typed options compared with ==

```go
type Option interface {
    apply(*Server)
}

type readTimeoutOpt struct{ d time.Duration }
func (o readTimeoutOpt) apply(s *Server) { s.readTimeout = o.d }
func WithReadTimeout(d time.Duration) Option { return readTimeoutOpt{d: d} }

type headersOpt struct{ h map[string]string }
func (o headersOpt) apply(s *Server) { s.headers = o.h }
func WithHeaders(h map[string]string) Option { return headersOpt{h: h} }

// somewhere in user code:
func dedupe(opts []Option) []Option {
    seen := map[Option]bool{}
    var out []Option
    for _, o := range opts {
        if seen[o] { continue }
        seen[o] = true
        out = append(out, o)
    }
    return out
}
```

**Question.** What happens when `dedupe` encounters two `WithHeaders(...)` options?

<details><summary>Answer</summary>

**Bug.** Runtime panic: `runtime error: hash of unhashable type server.headersOpt`. The `headersOpt` struct contains a map field, and maps are not comparable in Go. Using `headersOpt` (or anything containing it) as a map key panics.

If the two `WithHeaders` happened to hold equal maps (same pointer to same backing table), the panic still fires — Go decides comparability statically, by type, not by current value.

**Why it's there.** Interface-typed options (from `middle.md` §3.2) hide the concrete option type from the caller. The caller assumed *all* options are comparable (because most are simple structs containing primitives). One option type containing a map breaks that assumption.

**How to spot in review.** Any code that uses options as map keys, or compares them with `==`. The fix is either to avoid those operations or to design every option type to be comparable.

**Fix.** Avoid comparing options. If deduplication is genuinely needed, key on the option's *type*, not its value:

```go
func dedupe(opts []Option) []Option {
    seenType := map[reflect.Type]bool{}
    var out []Option
    for _, o := range opts {
        t := reflect.TypeOf(o)
        if seenType[t] { continue }
        seenType[t] = true
        out = append(out, o)
    }
    return out
}
```

This keeps only the *last* `WithHeaders` of any kind — but it doesn't panic. The semantics ("dedupe by option category, last one wins") match how options behave anyway (later overrides earlier from `middle.md` §5.1).

Better still: don't dedupe at all. If a caller passes the same option twice, the loop runs both; the last one wins. That's the contract.

**Why it's common.** "Options are like configs, configs are values, values are comparable" — the chain of reasoning is intuitive and wrong. The mismatch shows up only when a particular option type happens to be unhashable.
</details>

---

## Bug 14: Required field demoted to an option

```go
type DB struct {
    dsn     string
    timeout time.Duration
    pool    int
}

type Option func(*DB)

func WithDSN(dsn string) Option {
    return func(d *DB) { d.dsn = dsn }
}

func WithTimeout(t time.Duration) Option {
    return func(d *DB) { d.timeout = t }
}

func NewDB(opts ...Option) (*DB, error) {
    d := &DB{timeout: 5 * time.Second, pool: 10}
    for _, opt := range opts { opt(d) }
    if d.dsn == "" {
        return nil, errors.New("NewDB: WithDSN is required")
    }
    return d, nil
}
```

**Question.** What's wrong with using `WithDSN` to deliver a required parameter, even though the constructor checks for it?

<details><summary>Answer</summary>

**Bug.** `NewDB()` compiles. The "required" parameter isn't actually required by the type system — it's required by a runtime check. Every caller has to read the godoc to know `WithDSN` is mandatory. Forgetting it produces a runtime error, not a compile error.

Worse, the order matters: if a caller passes `NewDB(WithDSN("x"), WithDSN(""))`, the second one silently wins, and the error message says `WithDSN is required` even though they passed it. Confusing.

**Why it's there.** The author thought "everything looks more uniform if all configuration is an option". Uniformity at the cost of compile-time safety is a bad trade. From `junior.md` §9.

**How to spot in review.** Any constructor whose body contains a post-loop check for a "required" field being non-zero. The fix is to promote the field to a positional argument.

**Fix.**

```go
func NewDB(dsn string, opts ...Option) (*DB, error) {
    if dsn == "" {
        return nil, errors.New("NewDB: dsn is required")
    }
    d := &DB{
        dsn:     dsn,
        timeout: 5 * time.Second,
        pool:    10,
    }
    for _, opt := range opts { opt(d) }
    return d, nil
}
```

Now `NewDB()` is a compile error, not a runtime error. The DSN is impossible to forget.

**Why it's common.** Authors who learned the pattern from one library extrapolate "everything is an option" too far. The rule is: required → positional, optional → option.
</details>

---

## Bug 15: WithHeader rebuilding vs mutating

```go
type Client struct {
    headers map[string]string
}

type Option func(*Client)

func WithHeader(key, value string) Option {
    return func(c *Client) {
        h := make(map[string]string, len(c.headers)+1)
        for k, v := range c.headers {
            h[k] = v
        }
        h[key] = value
        c.headers = h
    }
}

func NewClient(opts ...Option) *Client {
    c := &Client{}
    for _, opt := range opts { opt(c) }
    return c
}
```

**Question.** A caller writes `NewClient(WithHeader("A", "1"), WithHeader("B", "2"), WithHeader("C", "3"))`. What is the asymptotic cost in the number of headers `n`, and what's the right shape?

<details><summary>Answer</summary>

**Bug.** Quadratic, O(n²). Each `WithHeader` allocates a new map and copies all previous headers into it. For 3 headers: copy 0 + copy 1 + copy 2 = 3 copies. For 100 headers: 4,950 copies. For 1,000 headers: ~500,000 copies and 1,000 map allocations.

The author was probably trying to avoid the package-level mutable-default trap from Bug 7, and went too far in the other direction.

**Why it's there.** "Copy on write" feels safer than "mutate in place". For a single map field on a single struct being built up in a single goroutine during construction, copy-on-write is wrong — there is no concurrent reader to protect against. Just mutate.

**How to spot in review.** Any `WithX` that allocates a fresh container, copies the old one in, then assigns. For maps and slices being built up across many options, this is a quadratic-time smell.

**Fix.** Mutate the field directly, lazily initialising the map:

```go
func WithHeader(key, value string) Option {
    return func(c *Client) {
        if c.headers == nil {
            c.headers = make(map[string]string)
        }
        c.headers[key] = value
    }
}
```

Each call is O(1). The map grows once across many options, sized by Go's runtime.

If the constructor initialises the map up front (e.g., because the default has entries), the lazy-init check becomes unnecessary:

```go
func NewClient(opts ...Option) *Client {
    c := &Client{headers: map[string]string{}}
    for _, opt := range opts { opt(c) }
    return c
}

func WithHeader(key, value string) Option {
    return func(c *Client) { c.headers[key] = value }
}
```

**Why it's common.** Defensive programming, misapplied. The "always copy maps before mutating" reflex is correct when the map is shared (Bug 2, Bug 7); it's harmful when the map is owned by a struct under construction. Knowing which case you're in is the discipline.
</details>

---

## Summary

The bugs cluster around five themes.

1. **Defaults in the wrong place** (Bugs 1, 7) — defaults belong in the constructor literal, not in options and not in package vars.
2. **Hidden sharing of caller state** (Bugs 2, 7, 15) — options that capture maps/slices/pointers without copying, or that touch package-level shared state.
3. **Options doing too much** (Bugs 3, 4, 8, 11) — reading other fields, spawning goroutines, depending on order, mutating after Start. Options should be pure setters.
4. **Type-system shortcuts** (Bugs 6, 12, 13, 14) — `unsafe` "optimisations", generic options with type assertions, comparing interface-typed options, demoting required fields.
5. **Mechanical mistakes** (Bugs 5, 9, 10) — forgotten `...`, loop-variable capture in pre-1.22 Go, silent validation that swallows invalid input.

The defenses are the same in every case: keep options to one-line field setters, set defaults exactly once in the constructor, copy reference-typed inputs at option-construction time, validate loudly (panic on programmer error, error on runtime input), and audit any option whose body has more than three lines.

A unit test that constructs a target with various option combinations and asserts the resulting state catches most of these before they ship. `go vet`, the race detector, and `-d=checkptr` catch a few of the others. Code review catches the rest — and now you know what to look for.

---

## Further reading

- `junior.md` §7 (defaults in the constructor)
- `junior.md` §11 (common junior mistakes)
- `middle.md` §4 (options that can fail)
- `middle.md` §13 (common middle-level mistakes)
- `middle.md` §14 (debugging an options bug)
- Go 1.22 loopvar change: https://go.dev/blog/loopvar-preview
- `grpc-go` option implementations: https://github.com/grpc/grpc-go/blob/master/dialoptions.go
- `uber-go/zap` option implementations: https://github.com/uber-go/zap/blob/master/options.go
