# Dependency Injection — Interview Questions

> Practice questions ranging from junior to staff. Each has a model answer, common wrong answers, and follow-up probes.

---

## Junior

### Q1. What is dependency injection in one sentence?

**Model answer.** Passing the things a piece of code needs *into* it (usually through a constructor or function parameter), rather than letting it construct or look them up itself.

**Common wrong answers.**
- "Using a DI framework like `wire` or `fx`." (No — DI is the discipline; frameworks are optional tooling.)
- "Inversion of control." (Loosely related, but IoC is broader and DI is one technique.)

**Follow-up.** *Give an example of code that is **not** doing DI.* — A function that reaches out to a package-level `var db *sql.DB` instead of accepting it as a parameter.

---

### Q2. What is a constructor function in Go DI?

**Model answer.** An exported function that returns a fully-configured value of a struct, conventionally named `NewType`. It accepts the type's dependencies as parameters:

```go
func NewService(db DB, logger *slog.Logger) *Service {
    return &Service{db: db, logger: logger}
}
```

**Follow-up.** *Why not just expose the struct fields and let callers populate them?* — Two reasons: required dependencies cannot be enforced (zero values look "valid"), and you cannot validate or normalise inputs.

---

### Q3. What does "accept interfaces, return structs" mean?

**Model answer.** When designing a constructor, accept an interface as a parameter (so callers can substitute different implementations) but return a concrete struct (so callers get the full API and can convert to interfaces themselves later). It is the practical Go formulation of "depend on abstractions, expose specifics."

**Follow-up.** *When do you break this rule?* — When the caller genuinely only ever needs a small subset of behaviour and you want to enforce it; or when you want to forbid leaking concrete types out of a package.

---

### Q4. Why is `time.Now()` considered a dependency?

**Model answer.** It reads from external state (the system clock) and you cannot test code that uses it without controlling time. Wrapping it in a `Clock` interface (or a `func() time.Time` field) makes the dependency explicit and replaceable in tests.

**Follow-up.** *What other "implicit" things are dependencies?* — `os.Getenv`, `os.Args`, `rand` default source, `runtime.NumCPU`, the file system, the network.

---

### Q5. Why do most Go projects not use a DI framework?

**Model answer.** Go's standard tools (struct construction, structural interfaces, fast compiler) make manual wiring readable and zero-cost. A 50-line `main` that constructs everything is easier to follow than a framework with annotations or codegen, and the testability benefits of DI are 100% achievable without a framework.

**Follow-up.** *When does a framework start to pay off?* — When wiring crosses ~150 lines, when multiple binaries share most of the same providers, or when you operate many similar services that would benefit from a shared lifecycle abstraction.

---

## Middle

### Q6. What is a service locator and why is it considered an anti-pattern?

**Model answer.** A service locator is a global registry — typically a map from name or type to value — that code reaches into to find its dependencies. It looks like DI from the outside but the dependencies are hidden inside the function body, not visible in the signature.

Problems: function signatures lie about what code uses; tests need global mutation; parallel tests race; missing registrations fail at runtime, not compile time.

**Common wrong answer.** "It is the same as DI, just using a different syntax." (No — DI puts the dependency in the signature; service locator hides it.)

**Follow-up.** *Give two examples of accidental service locators.* — `log.Println(...)` reaching into a global default logger; `viper.GetString("key")` reaching into a global config.

---

### Q7. Where should an interface live: in the package that *defines* it or the package that *uses* it?

**Model answer.** In Go, interfaces should live where they are *consumed*. If `OrderService` calls `Charge(ctx, userID, cents)`, the `Payments` interface lives in the `orderservice` package, even though `Charge` is implemented in `stripeclient`. This keeps the interface narrow (only the methods the consumer actually uses) and keeps the dependency direction sane: domain code does not import infrastructure.

**Follow-up.** *When does the rule break?* — When multiple consumers genuinely share an interface and you want to express that explicitly. Then move it to a small shared package that contains only the interface.

---

### Q8. What is the difference between a fake and a mock?

**Model answer.** A *fake* is a hand-written, working in-memory implementation of an interface — e.g. a repo that stores users in a map. A *mock* is typically generated and records call expectations to assert against. Fakes are better for stateful dependencies and tests that read like code; mocks are better for one-shot dependencies where you only care about whether the call happened with given arguments.

**Follow-up.** *Why prefer fakes for repositories?* — Tests using a fake repo read like real code: arrange data, call the service, assert results. Mock-based tests for repos quickly become unreadable lists of `EXPECT().GetUser(...).Return(...)`.

---

### Q9. What does `google/wire` do, in one paragraph?

**Model answer.** It is a code generator. You declare provider sets — Go functions that produce a value — and an "injector skeleton" with a single `panic(wire.Build(...))` call. The `wire` CLI inspects the skeleton, resolves the dependency graph statically, and emits a real Go function that calls each provider in order. The generated code is plain Go, no reflection. If providers are missing, ambiguous, or cyclic, the build fails.

**Follow-up.** *What is the trade-off vs manual wiring?* — You get automatic upkeep of wiring code (one less thing to keep in sync as the graph grows) at the cost of a `go generate` step in your build pipeline.

---

### Q10. How do you avoid a 12-parameter constructor?

**Model answer.** Group dependencies into a `Deps` struct:

```go
type Deps struct {
    Repo    OrderRepo
    Users   UserRepo
    Clock   Clock
    Logger  *slog.Logger
    Metrics Metrics
    Tracer  Tracer
}

func New(d Deps) *Service { ... }
```

The call site becomes a labelled struct literal that documents itself. If a new dependency is needed, you add a field; existing call sites do not break.

**Follow-up.** *Should you use functional options for required dependencies?* — No. Functional options are best for *optional* knobs; required dependencies should be type-checked at compile time.

---

### Q11. How do you inject the system clock cleanly?

**Model answer.** Define a tiny interface or function type:

```go
type Clock interface{ Now() time.Time }

type realClock struct{}
func (realClock) Now() time.Time { return time.Now() }
```

Inject it everywhere you would otherwise call `time.Now()` directly. In tests, pass a fake clock that returns a fixed time or one you can advance.

A lighter alternative: inject a `func() time.Time` instead of a full interface — it is one method anyway.

**Follow-up.** *What about `time.Since(t)` and `time.Sleep`?* — `time.Since(t)` becomes `clock.Now().Sub(t)`. `time.Sleep` is harder; for code that sleeps, inject a `Sleeper` interface or use `time.Timer` whose channel you can fake.

---

## Senior

### Q12. When would you choose `wire` over manual wiring?

**Model answer.** When manual wiring crosses ~150 lines, becomes a friction point during refactors, or repeats across multiple binaries. `wire` adds a build step and a tiny conceptual overhead but produces zero-cost generated code and turns "you forgot to wire X" into a build error rather than a runtime crash.

**Follow-up.** *And when would you stay with manual?* — When the team values one-step builds, when you have a single small binary, or when your environment requires runtime selection of implementations that `wire` is awkward at expressing.

---

### Q13. When does `fx` make sense, and when does it not?

**Model answer.** `fx` makes sense when you operate many services that share a lifecycle skeleton (config, logging, metrics, tracing, graceful shutdown) and you want a uniform module system across them. Its costs are reflection at startup, runtime errors instead of compile errors, and a less idiomatic Go shape (the framework owns `main`).

It does not make sense for: small single-service projects, performance-sensitive cold-start scenarios, or teams that prize "no magic" Go.

**Follow-up.** *How would you measure whether `fx`'s startup cost matters?* — Capture a CPU profile across `App.Start`. Look for `dig.(*Container).provide` and `reflect.Value.Call` on the hot path. Multiply by deploy frequency to estimate operator-visible impact.

---

### Q14. Explain the nil-interface trap.

**Model answer.** An interface value is a (type, data) pair. A nil interface is `(nil, nil)`. A typed nil — say, a `*Service` whose value is `nil`, assigned to an interface variable — is `(*Service, nil)`. Comparing this to `nil` returns *false* because the type slot is populated. Calling a method on it dispatches into the method on `*Service`, dereferences the nil pointer, and panics.

The takeaway: do not use `if iface == nil` to defend against "the caller didn't supply anything". Either require non-nil at the type level, or check the *concrete* type before assignment.

**Follow-up.** *Where does this trap usually appear?* — In code that stores a value through a wrapping function, or in providers that conditionally return a typed nil instead of an explicit interface nil.

---

### Q15. How do you wire a multi-binary monorepo without code duplication?

**Model answer.** Define a base set of providers shared by all binaries (config, logging, infra) and per-binary tails that add what is unique. With manual wiring, this is a `BuildBase()` function plus per-binary `BuildAPI()` / `BuildWorker()` that call it and add their own pieces. With `wire`, this is `wire.NewSet` composition: one base set, one per binary.

The composition root for each binary is a tiny `cmd/<bin>/main.go` that calls the appropriate `Build` and runs. The graph code lives in `internal/app/`.

**Follow-up.** *How do you handle environment differences (prod vs staging vs local)?* — Pull the environment-specific decision out of the DI graph and into a small selector in `main`. The bulk of the graph remains static; only the seam where the choice happens varies.

---

### Q16. What is request scoping and how do you implement it in Go?

**Model answer.** A *request-scoped* value is created at the start of a request and lives until it ends — typically a request-tagged logger or a per-request transaction. In Go, you do not put these into the DI graph; you propagate them through `context.Context`. The DI graph stays singleton-shaped; per-request state rides on the request's `ctx`.

Implementation: define a context key, write `WithFoo(ctx, value)` and `FooFrom(ctx)` helpers, and wrap them in middleware that sets the value at the boundary.

**Follow-up.** *What about per-request `*sql.Tx`?* — Same pattern: middleware begins a transaction, attaches it to ctx, and the handler runs the request inside it. Repository calls look for a tx in ctx and use it if present.

---

### Q17. How do constructors interact with errors?

**Model answer.** Constructors that *cannot* fail have signature `func New(...) *T`. Constructors that *can* fail (validating inputs, opening connections) have signature `func New(...) (*T, error)`. Pick one per type; do not waver. If a constructor opens an external resource, also return a cleanup function: `func New(...) (*T, func(), error)`. `wire` recognises this pattern explicitly.

**Follow-up.** *Should a constructor `panic`?* — Almost never. Returning an error gives the caller (usually `main`) the option to handle it gracefully. Panic is reserved for invariant violations the caller cannot do anything about.

---

## Staff

### Q18. Walk through how `wire` proves a graph is correct at build time.

**Model answer.** `wire` parses the package with `go/packages`, locates injector skeletons (functions with `panic(wire.Build(...))` body), and resolves the provider set statically. For the injector's return type, it walks providers' parameters, recursively resolving each from the set. It checks for: missing providers (no provider produces a needed type), ambiguity (two providers produce the same type, no `wire.Bind` to break the tie), cycles (a provider transitively requires its own output), and dead code (providers that cannot be reached). All checks happen before any code runs; failures fail `wire generate`, which (in CI) fails the build.

**Follow-up.** *What is the failure mode if you forget to regenerate after editing a provider?* — `wire_gen.go` becomes stale. The generated injector still calls the old constructor signature; the build fails because that signature no longer exists. CI must enforce `git diff --exit-code` after `go generate ./...`.

---

### Q19. Compare the runtime overhead of manual, `wire`, and `fx` quantitatively.

**Model answer.** Manual and `wire` are *identical* at runtime — both produce direct constructor calls. `fx` (and `dig` underneath) reflect over each provider's signature, allocate `reflect.Value` slices on every call, and box every value in a `map[reflect.Type]any`. Empirically for a 100-provider graph, `fx` runs ~50× the wall-time and ~100× the allocations of manual at startup. After startup, all three are equivalent — you hold real Go values; the wiring layer is no longer involved.

**Follow-up.** *Does the binary size differ?* — Manual and `wire` have nothing extra to link in. `dig` and `fx` together add roughly several hundred KB. For embedded targets, that matters; for typical services, it does not.

---

### Q20. How would you migrate a project from `fx` to manual?

**Model answer.** It is mechanical. For each `fx.Provide(NewFoo)`, replace with a direct `foo := NewFoo(deps...)` call in `main`. For each `fx.Invoke(StartFoo)`, call it directly after construction. For each lifecycle hook, register a deferred call or a `signal.NotifyContext`-driven shutdown sequence. The complexity is finding the "fx-implicit" startup order; once written down, it is a linear sequence of constructor calls.

The team benefit is a `main` you can read top to bottom, reflection-free startup, and compile-time errors when a constructor changes.

**Follow-up.** *When would the migration be a bad idea?* — When `fx`'s `Module` system is doing real organisational work — say, twenty services share an `fx.Module` for tracing/logging that is configured uniformly. Replacing it with copy-pasted manual code might be uniform but is now duplicated.

---

### Q21. A team proposes a `Container` struct to "make wiring easier". What do you say?

**Model answer.** Ask what problem they are solving. If "wiring code is too long," group providers into `Set` structs returned from each package — that is plain Go and proves itself in CI. If "we need to register things dynamically at runtime," push back: dynamic wiring usually points at a deeper architectural problem (poor boundary definition). If they really need it, use `dig`/`fx` rather than reinventing them with bugs.

The hand-rolled `Container[string]any` is the service-locator anti-pattern with a struct around it. Every Go developer who tries it eventually pays the cost.

**Follow-up.** *What if the team insists?* — Walk them through writing one. They will discover the type-safety and ordering problems themselves within a day, and either give up or end up at `dig`. Either outcome is fine.

---

### Q22. How do you avoid a flaky test caused by `time.Now()`?

**Model answer.** Inject a clock. Code that calls `time.Now()` directly is non-deterministic; the test of a rate limiter, scheduler, token-mint, or cache invalidator must control time to avoid sleeping or to assert on exact timestamps. The simplest form is a `func() time.Time` injected as a field; the more expressive form is a `Clock` interface with `Now`, `Since`, and a `Sleep` equivalent.

After injecting, audit the package for any remaining direct calls (`time.Now`, `time.Since`, `time.Sleep`) — they are bypassing the seam and will reintroduce flakiness.

**Follow-up.** *What about `time.After`?* — Same problem; replace with `clock.NewTimer` (real or fake) or pass a duration plus a control channel.

---

### Q23. What is the difference between `dig.In` parameter objects and positional parameters in `fx`?

**Model answer.** `fx.In` (and `dig.In`) lets you declare a struct of fields that the container fills by reflection on each field. Positional parameters are the direct constructor signature. Functionally they are equivalent for required dependencies; `fx.In` adds support for optional fields, named values, and value groups via struct tags.

Trade-off: `fx.In` structs hide what the constructor actually depends on (you have to look inside the struct definition), and they cost a little more reflection at startup. Use them only when you need optional/named/group semantics; otherwise prefer positional.

**Follow-up.** *When is `dig.Optional` useful?* — When a dependency is genuinely conditional and the constructor knows how to behave when it is absent. In most code it is better to inject a no-op default and skip the optional machinery.

---

### Q24. Why is request-scoped state passed through `context.Context` rather than the DI graph?

**Model answer.** The DI graph is singleton-shaped: components are constructed once at startup. Per-request state (the request ID, a request-bound logger, a per-request transaction) lives for one request only. Forcing it through the graph means re-resolving the graph per request, which defeats the point of singletons.

`context.Context` is Go's idiomatic mechanism for request-scoped values — it propagates through call chains, supports cancellation, and is built into `net/http` and most libraries. Wire singletons via constructors; pass per-request context to *methods* on those singletons.

**Follow-up.** *Should I put the database handle in context?* — No. The handle is a singleton; only the *transaction* (per-request) goes in context if you use that pattern.

---

## Closing

DI questions in Go interviews are rarely about syntax — they are about *judgement*. Whether to use a framework, where to draw an interface, how to scope a dependency, when to refuse a fashionable pattern. The strongest answers cite concrete consequences: testability, build-time vs runtime errors, allocator pressure, code that future-you can read in six months. Frameworks come and go; the constructor-injection discipline outlasts all of them.
