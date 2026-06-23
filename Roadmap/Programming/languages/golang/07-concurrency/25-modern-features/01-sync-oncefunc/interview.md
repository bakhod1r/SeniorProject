---
layout: default
title: sync.OnceFunc — Interview
parent: sync.OnceFunc/OnceValue/OnceValues
grand_parent: Modern Concurrency Features
ancestor: Go
nav_order: 5
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/25-modern-features/01-sync-oncefunc/interview/
---

# sync.OnceFunc — Interview

[← Back](../)

## 1. What does `sync.OnceFunc` do?

It takes a `func()` and returns a `func()`. The returned function, no matter how many goroutines call it, runs the original exactly once and ignores every subsequent call. It is a drop-in replacement for the `var once sync.Once; once.Do(f)` pattern, packaged as a single value.

## 2. What is the difference between `sync.Once` and `sync.OnceFunc`?

`sync.Once` is a type with a `Do(f func())` method — the function lives separately from the `Once`, and you pass it in at every call site. `sync.OnceFunc` is a function that takes the function once, captures it in a closure, and returns a wrapper. With `Once` you say "do this thing once" at every call; with `OnceFunc` you say "this thing only happens once" by construction, and then you just call the returned wrapper. The behavior under panic also differs: `Once.Do` consumes the `Once` even on panic, so the next caller silently succeeds, while `OnceFunc` re-panics with the same value on every later call.

## 3. What happens if the wrapped function panics?

The first call panics with whatever `f` panicked with, carrying a full stack trace into `f`. Every subsequent call re-panics with the same value (`==` to the original), but at the wrapper's outer `panic(p)` site, so the stack trace points at the wrapper, not at `f`. This means downstream code that catches the panic by value (`recover() == errInitFailed`) keeps working on every call, but anyone hoping to see the original stack must catch it on the first call.

## 4. What about `sync.Once.Do` when the function panics?

`sync.Once.Do` marks the `Once` as done before calling `f`, so when `f` panics the panic propagates out of `Do` but the `Once` is now "consumed". The next caller of `Do` returns immediately as if everything had succeeded. This is a known footgun and is part of the reason `OnceFunc` exists.

## 5. Can the wrapper returned by `OnceFunc` be called concurrently?

Yes. Internally it uses a `sync.Once`, so the standard `Once` guarantee applies — all calls block until the first completes, and a happens-before edge connects the completion of `f` to every later return.

## 6. What is `sync.OnceValue` for?

For lazy single-value initialization. Instead of writing a `sync.Once` plus a package-level `var cached T`, you write `var load = sync.OnceValue(func() T { ... })` and call `load()` everywhere. The value is computed on the first call and returned by every subsequent call.

## 7. When would you reach for `sync.OnceValues` rather than `OnceValue`?

Whenever the underlying function returns `(T, error)`. Almost every "load this config" or "open this resource" function in Go has that signature, and `OnceValues` is the helper specifically designed for it: `var load = sync.OnceValues(func() (*Config, error) { ... })`.

## 8. What is the GC behavior of these wrappers?

After a successful first call, the wrapper sets its captured `f` to `nil`, so anything the closure captured (large buffers, file handles, parameters) becomes eligible for collection. Only the cached return values (for `OnceValue`/`OnceValues`) are retained. If `f` panicked, `f` is *not* cleared, because that line never runs.

## 9. What is the allocation cost of `sync.OnceFunc` compared to a raw `sync.Once`?

`OnceFunc` allocates: it has to box the closure, the `Once`, the `valid` flag, and the `p any` slot. A package-level `var once sync.Once` and a plain function pointer allocate nothing — they live in the BSS segment. In practice the difference is a single small heap allocation at program start, completely irrelevant compared to the work `f` typically does.

## 10. Can you reset a `OnceFunc` wrapper?

No. There is no exposed reset, and the proposal explicitly chose not to add one. If you need "run again after some condition", do not use `OnceFunc` — use a `sync.Mutex` + a `bool`, or an `atomic.Bool`, or a state machine that fits your problem.

## 11. What is the type of the wrapper returned by `OnceValue[int]`?

`func() int`. The generic parameter is erased into the closure's captured `T` slot; the returned function exposes only `func() T`.

## 12. Can `OnceValue` cache a pointer?

Yes — `OnceValue[*Config]` works fine. Every caller gets the same `*Config`, so they share state. If `Config` should be immutable from the callers' perspective, document it; the helper does not enforce immutability.

## 13. What about the captured value if `T` is a large struct?

`OnceValue` stores the returned `T` by value inside the wrapper closure. Every call returns a copy. For large structs you almost always want `OnceValue[*BigStruct]` instead.

## 14. Could you implement `OnceFunc` yourself with `sync.Once`?

Yes, in three lines:

```go
func MyOnceFunc(f func()) func() {
    var once sync.Once
    return func() { once.Do(f) }
}
```

This is missing the panic-reuse contract. Adding it doubles the size; the real `OnceFunc` in the stdlib is roughly twenty lines.

## 15. Why does the first call panic carry the stack trace but later calls do not?

Because on the first call the recover is followed by an immediate `panic(p)` inside the goroutine that ran `f`, before the deferred handlers unwind. The Go runtime preserves the stack from the original `panic` site through that re-panic. On later calls, however, the wrapper's outer `if !valid { panic(p) }` is a brand new `panic`, and the runtime captures the stack starting there. There is no good way to preserve the original stack on later calls without retaining the entire goroutine state, which would defeat the GC benefit.

## 16. Is `sync.OnceFunc` faster or slower than `sync.Once`?

On the fast path (after the first call), both reduce to a single atomic load of the "done" flag inside `sync.Once`. The wrapper adds one indirect function call and one read of `valid`. The difference is well under a nanosecond and never matters compared to the surrounding code.

## 17. What if I assign the wrapper to a new variable?

The wrapper is just a `func()` value. Copying it makes another reference to the same underlying closure, so both names trigger the same single execution. What you must not do is *re-create* the wrapper — `wrapper := sync.OnceFunc(f); wrapper()` followed by `wrapper = sync.OnceFunc(f); wrapper()` runs `f` twice. Each call to `sync.OnceFunc` returns a fresh wrapper.

## 18. Can you use `OnceFunc` inside a method?

Yes, but you must store the wrapper on the receiver, not create a fresh one per call. Creating a fresh `sync.OnceFunc(f)` every method call gives you a brand-new wrapper each time, which defeats the purpose. Common pattern:

```go
type Service struct {
    initOnce func()
}

func NewService() *Service {
    s := &Service{}
    s.initOnce = sync.OnceFunc(s.init)
    return s
}

func (s *Service) init() { /* ... */ }
```

## 19. What about generics — does `OnceValue` work on any `T`?

Yes, including interfaces, pointers, structs, channels, maps. The constraint is `any`. The captured value lives in a closure variable typed `T`.

## 20. Is there a `OnceFunc` for variadic functions?

No. The wrapped function must be `func()`. If your real function takes arguments, the arguments must be captured by the closure passed to `OnceFunc`. This is by design — if different callers passed different arguments, the "exactly once" contract would be meaningless.

## 21. When should you *not* use `sync.OnceFunc`?

When the initialization is conditional ("if the user enabled debug, also start the pprof server"), because `OnceFunc` runs unconditionally on first call. When you need to retry on error — the panic-reuse contract means a failed init poisons all callers forever. When you need to clear and re-run.

## 22. Is `sync.OnceFunc` part of the Go memory model?

Yes — `sync.Once.Do` is, and `OnceFunc` is implemented on top of it. The completion of `f` happens-before the return of every subsequent call to the wrapper. This is what lets you do `var load = sync.OnceValue(loadConfig)` and then read fields of the returned config from any goroutine without further synchronization.

## 23. What does `OnceValues` return if `f` panics?

It panics. There are no "default" or "zero" values returned on panic — the contract is that the wrapper either returns the values from a successful `f` or it panics with the recovered value.

## 24. Could the team have made `Once.Do` re-panic instead of adding new types?

Backward compatibility. Changing `sync.Once.Do` to re-panic would break programs that today silently absorb init failures. The proposal explicitly chose to add new APIs with the better contract rather than change `Once`.

## 25. What is the smallest correct way to write a lazy global config in Go 1.21+?

```go
var config = sync.OnceValue(func() *Config {
    return mustLoadConfig()
})
```

…and then `config().Database` everywhere. One line of state, one accessor function, panic propagation, GC of the loader closure. This is the pattern these helpers exist to enable.

## 26. What's the cost of a single `sync.OnceFunc` call after the first one?

Roughly two atomic loads and an indirect call — about 1.5–2 ns on modern x86. Effectively free for any non-trivial use.

## 27. Is `sync.OnceFunc` a generic function?

No. `sync.OnceFunc` is a regular function with signature `func(f func()) func()`. Only `sync.OnceValue` and `sync.OnceValues` use generics, because they need to capture return types.

## 28. What if I want to call `OnceValue` with a function that returns an interface?

That works fine — `OnceValue[error]`, `OnceValue[io.Reader]`, `OnceValue[any]` are all valid. The captured value is the interface, and the same interface (containing the same dynamic value) is returned on every call.

## 29. Are the wrappers safe to use as fields of a struct that itself moves (copying the struct)?

No. Copying a struct that contains a captured `OnceFunc` wrapper copies the closure pointer, but both copies share the underlying `sync.Once` and cached state. This is usually what you want — but if your struct semantics include "deep copy means independent state", you have a problem. The same caveat applies to embedding `sync.Once` directly; nothing new here.

## 30. Can you store a `sync.OnceFunc` wrapper in an interface?

Yes, via `interface{ Run() }` or similar. You'd typically wrap it:

```go
type Runner interface{ Run() }

type onceRunner struct{ run func() }

func (o *onceRunner) Run() { o.run() }

func NewOnceRunner(f func()) Runner {
    return &onceRunner{run: sync.OnceFunc(f)}
}
```

This is mostly a way to make the "exactly once" semantics visible at the type level.

## 31. What was the motivation for adding these to the standard library?

Russ Cox's proposal (#56102) observed that `sync.Once` is "almost always used in one of three stereotyped ways", and that each deserved direct support. The proposal also explicitly fixed the panic-on-second-call footgun of `sync.Once.Do`.

## 32. Could a third-party library have provided these before Go 1.21?

Yes — and several did. But stdlib inclusion matters because (a) it standardizes the pattern across the ecosystem, (b) it gets the panic-reuse contract right where many third-party implementations got it wrong, and (c) it ships with every Go installation, so it's the obvious default.

## 33. What's the difference between `sync.OnceValue` and `golang.org/x/sync/singleflight`?

`sync.OnceValue` runs `f` exactly once *forever*; the result is cached for the process lifetime. `singleflight.Group.Do(key, f)` deduplicates *concurrent* calls with the same key — once they all return, the next call runs `f` fresh. Use `OnceValue` for one-time initialization, `singleflight` for caching with refresh.

## 34. Does the wrapper allocate per call?

No. Allocations happen at construction (one or two small allocations for the closure environment). Per-call cost is zero allocations on the steady-state path.

## 35. Is the implementation lock-free?

No — it uses a `sync.Mutex` internally (via `sync.Once`). But the fast path (after the first call) is a single atomic load with no lock acquisition. So under contention you only block during the very first call.

## 36. Can two different `OnceValue` wrappers see each other's state?

No, they're entirely independent. Each `sync.OnceValue` call creates a brand-new wrapper with its own internal `sync.Once`, its own `valid` flag, its own cached value. They share nothing.

## 37. What about `sync.OnceValue` of a function that uses `runtime.Goexit()`?

The semantics are subtle. `runtime.Goexit` is not a panic — `defer`s run, but `recover()` returns nil. The implementation's `p = recover()` would store nil, and `valid` would not be set to true (because the assignment happens *after* `f()` returns normally, which `Goexit` prevents). So subsequent calls would see `!valid` and panic with `nil`. This is an unusual edge case; don't use `runtime.Goexit` inside `OnceValue`.

## 38. What's the difference between the first call's panic and subsequent calls' panics?

The first call propagates a true panic from inside `f` — the stack trace includes the call into `f`, the panic site, and all deferred handlers. Later calls hit the outer `panic(p)` in the wrapper, which is a fresh panic site — the stack trace points at the wrapper, not at `f`. The *value* is the same; the *trace* is different.

## 39. Is it safe to call the wrapper from a `defer`?

Yes. The wrapper is just a function value. Calling it from a defer is identical to calling it directly. If the wrapped function panics on the first call, the deferred call propagates that panic into the surrounding function's panic chain.

## 40. What's the right way to mock `sync.OnceValue` in tests?

Don't mock the wrapper — replace it. Make the lazy loader an injectable dependency:

```go
type Server struct { load func() *Config }
```

In production, pass `sync.OnceValue(realLoad)`. In tests, pass a plain function returning a fixed config. No package-level wrappers means no mocking puzzle.
