---
layout: default
title: Mocking Libraries — Interview
parent: Mocking Libraries Deep Dive
grand_parent: Testing and Benchmarking
ancestor: Go
nav_order: 6
has_children: false
permalink: /roadmap/programming-languages/golang/09-testing-and-benchmarking/15-mocking-libraries/interview/
---

# Mocking Libraries — Interview

[← Back](../)

## Q1. Why was `github.com/golang/mock` archived and what replaced it?

The original `github.com/golang/mock` project was archived by Google in June
2023. The Uber team forked it to `go.uber.org/mock`, kept the same API
(`gomock.NewController`, `EXPECT()`), and added bug fixes, generics support,
and `t.Cleanup` integration. New projects should depend on `go.uber.org/mock`;
old projects should migrate by rewriting imports and re-running `mockgen` from
the new module.

## Q2. Compare `mockgen` source mode and reflect mode.

- **Source mode** (`-source=foo.go`) parses the file with `go/parser`. It is
  fast, works without a compiler, supports unexported types in the same
  package, and is the default in most projects.
- **Reflect mode** (`mockgen pkgpath InterfaceName`) compiles a tiny program
  that imports the target package and reflects on the interface. It handles
  cross-package interfaces and embedded interfaces cleanly but is slower and
  requires the package to compile.

Most teams pick source mode and put `//go:generate mockgen` directives in
the file declaring the interface.

## Q3. gomock vs testify/mock — which would you choose for a new project?

- gomock is strict, code-generated, and type-safe. The compiler catches
  signature drift after `go generate`. The cost is the extra build step.
- testify/mock is reflection-based, written by hand, lenient by default.
  Argument matchers use `interface{}`, so a typo in a method name is only
  caught at test runtime.

For a new project I default to `go.uber.org/mock` because compile-time safety
saves more time than the generation step costs. For a project already heavy on
`stretchr/testify`, the cost of switching usually outweighs the benefit.

## Q4. How does `mockery` differ from `mockgen`?

`mockery` generates `testify/mock`-based mocks rather than gomock-style ones.
It reads `.mockery.yaml` and supports templating the output path and package
name. With `with-expecter: true`, it generates a strongly typed
`EXPECT()`-style helper similar to gomock, making testify/mock feel more
type-safe. Pick `mockery` if your codebase already uses testify; pick
`mockgen` if you want gomock semantics.

## Q5. When would you avoid a mocking library entirely?

- When an in-memory fake is small and reusable (e.g. an in-memory
  `UserRepository` implemented with a `map[string]User`). Fakes survive
  refactors better than mocks because they test behavior, not method calls.
- When the dependency is a pure function (just pass a different function).
- When you can swap the real implementation for an embedded test server
  (`httptest.NewServer` for HTTP, `bufconn.Listen` for gRPC).

A useful heuristic: if you find yourself mocking the same interface in five
test files with the same return values, write a fake.

## Q6. Explain `gomock.InOrder`.

`InOrder(e1, e2, e3)` chains `After` relations so the controller only
satisfies `e2` after `e1` is fully consumed, and so on. It does **not** mean
the calls must happen back-to-back — other unrelated expectations may
interleave — only that the specified expectations must be consumed in that
order. Use it sparingly: ordering assertions tightly couple tests to call
sequence and break under refactoring.

## Q7. What is `bufconn` and when do you use it?

`google.golang.org/grpc/test/bufconn` provides an in-memory `net.Listener`
that lets you run a real gRPC server and a real gRPC client in the same
process without opening a TCP socket. It is faster than `httptest`-style
servers for gRPC and is the recommended way to integration-test gRPC
services. It is preferred over mocking the gRPC client because the real
client exercises serialization, interceptors, and stream framing.

## Q8. How do you handle context arguments in mocks?

For matchers that ignore the context, use `gomock.Any()` for the first
argument. For matchers that care about cancellation or values, use
`gomock.AssignableToTypeOf(ctx)` plus a custom matcher built with
`gomock.Cond(func(x any) bool { ... })` (added in v0.4).

## Q9. What is the danger of `.AnyTimes()`?

`AnyTimes()` accepts zero or more calls, including zero. If the SUT no longer
calls the dependency (because of a refactor), the test still passes silently.
Prefer `MinTimes(1)` when you need lenient counts but want to assert the
dependency is exercised.

## Q10. Why are generated mocks usually placed in a `mocks/` subpackage?

Two reasons:

1. To avoid circular imports — production code uses `package store`, the mock
   needs to live in a package that imports `store`'s interface but is
   imported only by tests.
2. To keep generated files separate so `git diff` and code review can ignore
   them. Many teams add `mocks/**` to `.gitattributes` with `linguist-generated`
   so GitHub does not show them in PR diffs.

## Q11. Compare `moq` and `counterfeiter`.

Both generate function-field-based fakes. `moq` is smaller, produces
fewer lines of generated code, and has fewer features. `counterfeiter`
records into a typed args slice with explicit accessors
(`GetArgsForCall(i)`) and supports per-call returns (`GetReturnsOnCall`).
For most projects `moq` is sufficient; pick `counterfeiter` if its
explicit accessor API fits your style, or if you're working in a
Cloud Foundry / BOSH codebase where it's the convention.

## Q12. What is `gomock.Cond` and when did it land?

`gomock.Cond` (`go.uber.org/mock/gomock`) is a matcher that takes a
predicate `func(x any) bool`. It landed in `go.uber.org/mock@v0.4.0` and
replaces the need to write a full custom `Matcher` struct for one-off
predicates:

```go
m.EXPECT().Save(gomock.Any(), gomock.Cond(func(x any) bool {
    u, ok := x.(*User)
    return ok && u.Active
})).Return(nil)
```

It is the closest equivalent to testify's `mock.MatchedBy`.

## Q13. How do you mock a method that takes a channel?

The channel is passed as a normal argument. Match with `gomock.Any()` or
`gomock.AssignableToTypeOf(chan T(nil))`. To exercise channel semantics,
use `DoAndReturn` to send/receive in the mock:

```go
m.EXPECT().Subscribe(gomock.Any(), gomock.Any()).
    DoAndReturn(func(ctx context.Context, ch chan<- Event) error {
        go func() { ch <- Event{ID: "e1"} }()
        return nil
    })
```

This sends an event from the mock so the SUT can react to it.

## Q14. Why might `mock.ExpectationsWereMet()` pass when expectations are unmet?

It can't — if expectations are unmet, `ExpectationsWereMet` returns a
non-nil error. The pitfall is that tests sometimes don't *check* the
returned error:

```go
mock.ExpectationsWereMet() // result discarded
```

Always:

```go
require.NoError(t, mock.ExpectationsWereMet())
```

Or use the mockery `NewMockX(t)` constructor that registers the check
in `t.Cleanup` automatically.

## Q15. How would you test code that consumes a server-streaming gRPC RPC?

Two options:

1. **bufconn** with a fake server that streams test data. Recommended:
   exercises real stream framing.
2. **gomock** of the generated `pb.X_StreamYServer` interface, returning
   canned messages from `Recv`. Verbose but works when bufconn is
   overkill.

Most engineers reach for bufconn.

## Q16. How do you mock a struct method (not interface method)?

You don't. Go doesn't support mocking concrete types directly. Refactor:

a. Extract an interface containing the method.
b. Inject the interface into the consumer.
c. Provide the real struct in production and a mock in tests.

Or, if the method is package-level:

a. Replace the call with a function variable.
b. Override the variable in tests.

But interface extraction is cleaner. Just don't extract one-method
interfaces for everything — pick judiciously.

## Q17. What's wrong with this test?

```go
func TestX(t *testing.T) {
    ctrl := gomock.NewController(t)
    repo := mocks.NewMockUserRepo(ctrl)
    repo.EXPECT().Get(gomock.Any(), gomock.Any()).Return(&User{}, nil).AnyTimes()
    repo.EXPECT().Save(gomock.Any(), gomock.Any()).Return(nil).AnyTimes()

    svc := user.NewService(repo)
    svc.DoSomething(ctx) // doesn't return anything observable
}
```

The test asserts nothing. With `AnyTimes()` on everything, the
controller can't even verify the dependencies were exercised. The test
passes if `DoSomething` panics in a goroutine and silently exits. Fix:
either return something from `DoSomething` to assert on, or replace
`AnyTimes()` with `Times(1)` so the controller verifies the calls
happen.

## Q18. When would you choose miniredis over redismock?

For nearly all test cases. miniredis runs real Redis-compatible logic
(TTLs, sorted sets, Lua scripts) in-memory. redismock is essentially a
test framework for asserting "these commands were sent in this order".
Pick redismock only when you specifically need that command-sequence
assertion; otherwise miniredis is more realistic and easier to use.

## Q19. How does `gomock.NewController(t)` integrate with `testing.T`?

It stores `t` and uses `t.Errorf` for non-fatal failures (e.g. wrong
argument) and `t.Fatalf` for fatal ones (e.g. controller used after
Finish). From v0.4+, it also registers `t.Cleanup(ctrl.Finish)` so the
controller's `Finish` method runs automatically at test end, verifying
expectations were met.

## Q20. Why does mockery generate two methods per recorder type
(`Return` and `RunAndReturn`)?

`Return` sets a static return value. `RunAndReturn` accepts a function
that computes the return dynamically (similar to gomock's
`DoAndReturn`). Both exist because each fits a different use case:
static returns are simpler and more common; dynamic returns are needed
for stateful mocks (counters, sequences, conditional responses).

## Q21. What is the difference between a mock and a stub?

A **stub** returns canned values; it doesn't care who calls it or how
many times. A **mock** records calls and asserts on them — it cares
about *who, when, how many times, in what order*. In Go terminology
(and most modern testing terminology), the difference matters mainly
because tests that "use mocks" tend to assert on call patterns, while
tests that "use stubs" tend to assert on return values.

gomock and testify/mock blur the line: their objects can act as either
a stub (set `Return`, don't verify) or a mock (set `Times`, verify at
cleanup).

## Q22. How would you mock an interface from the standard library?

For `io.Reader`:

```bash
mockgen io Reader -destination=mocks/reader.go -package=mocks
```

Reflect mode handles it without writing the source file. Then in
tests:

```go
ctrl := gomock.NewController(t)
r := mocks.NewMockReader(ctrl)
r.EXPECT().Read(gomock.Any()).
    DoAndReturn(func(p []byte) (int, error) {
        copy(p, []byte("hello"))
        return 5, io.EOF
    })

data, _ := io.ReadAll(r)
require.Equal(t, "hello", string(data))
```

Or, often cleaner: just use `bytes.NewReader` or `strings.NewReader`
which are real `io.Reader` implementations. Mocking `io.Reader` is
rarely necessary.

## Q23. Should generated mocks be checked into the repo or generated in CI?

Both approaches work. Checking in:

- Pros: PR diffs show every change including mocks; no CI dependency
  on the generator; works offline.
- Cons: PRs become larger; reviewers may waste time on generated diffs;
  stale mocks if `go generate` is skipped.

Generating in CI:

- Pros: smaller PRs; can't forget to regenerate.
- Cons: CI dependency on `mockgen`/`mockery`; harder to inspect
  generated code; offline development requires generating manually.

Most teams check in mocks and use `linguist-generated=true` to collapse
the diff. Some Google-style teams generate at build time. Either is
defensible.

## Q24. What is the role of `gomock.Controller` after v0.4?

Pre-v0.4 it was the primary lifecycle object — you constructed it, used
it to make mocks, and called `Finish` to verify. Post-v0.4 it is still
the lifecycle object but `Finish` runs automatically via `t.Cleanup`.
The controller's role narrowed to "shared state across multiple mocks
in one test", which most tests don't need to think about.
