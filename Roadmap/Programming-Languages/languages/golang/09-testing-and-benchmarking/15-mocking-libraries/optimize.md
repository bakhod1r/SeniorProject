---
layout: default
title: Mocking Libraries — Optimize
parent: Mocking Libraries Deep Dive
grand_parent: Testing and Benchmarking
ancestor: Go
nav_order: 9
has_children: false
permalink: /roadmap/programming-languages/golang/09-testing-and-benchmarking/15-mocking-libraries/optimize/
---

# Mocking Libraries — Optimize

[← Back](../)

## 1. Cut mock setup boilerplate

If three quarters of every test is `EXPECT().X().Return(...)`, build a helper
that returns a pre-configured mock with reasonable defaults:

```go
func newStubUserRepo(t *testing.T) *mocks.UserRepo {
    t.Helper()
    ctrl := gomock.NewController(t)
    r := mocks.NewMockUserRepo(ctrl)
    r.EXPECT().Get(gomock.Any(), gomock.Any()).
        Return(&User{ID: "u1", Name: "Default"}, nil).
        AnyTimes()
    return r
}
```

Now tests only override the calls they care about. Use `gomock.InOrder` or
explicit overrides only for the assertion of interest.

## 2. Replace mocks with in-memory fakes for hot paths

A test suite of 4000 tests that each construct a controller and register 6
expectations spends measurable time in `gomock`'s reflection machinery.
Profile it:

```bash
go test ./... -bench=. -cpuprofile=cpu.out
go tool pprof -top cpu.out | grep gomock
```

If `gomock.(*Controller).Call` or `gomock.matcherToString` dominate, replace
the most-mocked interfaces with hand-written fakes (a map, a slice, a
counter). Fakes have no reflection cost and survive refactors.

## 3. Cache generated mocks

Re-running `mockgen` on every `go test` invocation slows CI. Add a Make rule
that only regenerates when the interface file is newer than the mock file:

```make
mocks/store_mock.go: internal/store/store.go
	mockgen -source=$< -destination=$@ -package=mocks
```

In CI, regenerate once at the start and verify the working tree is clean:

```bash
go generate ./... && git diff --exit-code
```

This catches stale mocks without paying the cost in every test run.

## 4. Parallelize mock-heavy tests

gomock controllers are independent per-test, so tests with mocks can usually
be `t.Parallel()`. The win is large when each test was waiting on real I/O
that has been stubbed out — parallelization gives close to N× speedup where
N is the number of cores.

Caveat: shared package-level variables (`var globalClient = ...`) defeat
parallelization. Inject dependencies through the constructor.

## 5. Trim oversized `.Return` payloads

If a mock returns a 50-field struct that the SUT only reads two fields of,
construct only those two fields. Smaller payloads reduce allocations and
keep tests focused. This is more about readability than speed, but in
property-based tests with thousands of iterations it adds up.

## 6. Disable `with-expecter` for unused packages

`mockery` with `with-expecter: true` doubles the generated file size. If a
package only needs the basic `m.On("Foo")` syntax, set the flag to false
in `.mockery.yaml` for that package. The result is faster builds and smaller
binaries.

## 7. Use `bufconn` instead of mocking gRPC clients

A gRPC client mock that returns a canned response costs `gomock` overhead;
a `bufconn` listener with a real server costs an in-memory copy. For
end-to-end gRPC tests, `bufconn` is usually faster AND more realistic:

```go
lis := bufconn.Listen(1 << 20)
srv := grpc.NewServer()
pb.RegisterUserServer(srv, &fakeUserServer{})
go srv.Serve(lis)
defer srv.Stop()

conn, _ := grpc.Dial("bufnet", grpc.WithContextDialer(
    func(ctx context.Context, _ string) (net.Conn, error) {
        return lis.Dial()
    }), grpc.WithTransportCredentials(insecure.NewCredentials()))
```

## 8. Strip generated mocks from coverage

Mock files inflate coverage numerators without adding signal. Exclude them:

```bash
go test ./... -coverpkg=$(go list ./... | grep -v /mocks) -coverprofile=c.out
```

You now measure real code, not generated boilerplate. Some teams also add
`// +build !coverage` build tags to mock packages so they are excluded
entirely.

## 9. Use shared `t.Cleanup` for repeated mock setup

If many tests in a file create the same mocks with the same defaults,
hoist the boilerplate into a per-test helper:

```go
type fixture struct {
    ctrl     *gomock.Controller
    repo     *mocks.MockUserRepo
    notifier *mocks.MockNotifier
    svc      *user.Service
}

func newFixture(t *testing.T) *fixture {
    t.Helper()
    f := &fixture{ctrl: gomock.NewController(t)}
    f.repo = mocks.NewMockUserRepo(f.ctrl)
    f.notifier = mocks.NewMockNotifier(f.ctrl)
    f.svc = user.NewService(f.repo, f.notifier)
    return f
}
```

Tests become:

```go
func TestX(t *testing.T) {
    f := newFixture(t)
    f.repo.EXPECT().Get(...).Return(...)
    f.notifier.EXPECT().Notify(...).Return(nil)
    require.NoError(t, f.svc.DoSomething(ctx))
}
```

Less boilerplate per test, cleaner reading order: what's different
about this test rather than what's the same.

## 10. Pre-warm mockgen in CI

`mockgen` compiles itself the first time it runs. In CI, this adds ~3s
to the first `go generate`. Cache the binary:

```yaml
- name: Cache mockgen
  uses: actions/cache@v3
  with:
    path: ~/go/bin/mockgen
    key: mockgen-${{ hashFiles('go.mod') }}
```

Trivial in a single project; significant when multiplied across hundreds
of microservice CIs.

## 11. Profile the test suite before optimizing

Don't guess where the time goes. Profile:

```bash
go test ./... -count=1 -test.timeout=30s -test.v 2>&1 | \
    awk '/--- PASS/ {print $NF, $(NF-1)}' | \
    sort -h | tail -20
```

The 20 slowest tests usually account for >50% of suite runtime.
Optimize those first. Often you'll find a single test that uses real
Redis or real HTTP that should be using miniredis or httptest.

## 12. Trim transitive dependencies in mock-heavy modules

Each test mock import pulls in a dep tree. `go mod why -m` shows where a
dep comes from. Common over-pulls:

- `github.com/stretchr/objx` (testify dep) pulled in by any testify
  mock.
- `github.com/google/uuid` pulled in by some mock libraries for IDs.

For most projects these are negligible. For libraries you publish, they
add to the consumer's dep graph. Audit annually.

## 13. Lazy mock construction

If a mock is expensive to construct and not always used:

```go
var lazyRepo func() *mocks.MockUserRepo
{
    var once sync.Once
    var repo *mocks.MockUserRepo
    lazyRepo = func() *mocks.MockUserRepo {
        once.Do(func() {
            repo = mocks.NewMockUserRepo(ctrl)
        })
        return repo
    }
}
```

Rare in practice — mock construction is usually cheap — but useful for
tests where many alternative branches need different mock setups.

## 14. Bottom line

Test suite optimization compounds: every 10ms saved on a mock-heavy
test, multiplied by 10,000 test runs per week, is ~28 hours of
developer time saved per month at typical CI throughput. Aim for fast
mocks even if the gain per test is small. The compounding payoff is
real.

## 15. Avoid `t.Logf` in hot mocks

`Do(func(...) { t.Logf(...) })` is great for debugging but expensive in
production tests. `t.Logf` formats strings, locks an internal mutex,
and writes to a buffer. In a test that exercises the mock 10,000 times
via property-based testing, this adds measurable overhead.

For property-based or fuzz tests:

```go
// Bad
m.EXPECT().Foo(gomock.Any()).
    Do(func(x int) { t.Logf("Foo(%d)", x) }).
    Return(nil).AnyTimes()

// Good
m.EXPECT().Foo(gomock.Any()).Return(nil).AnyTimes()
```

Use `t.Logf` mocks only in tests where the SUT calls the mock a few
times.

## 16. Skip mock asserts in benchmarks

In a benchmark using mocks, the controller's verification at cleanup
runs once per benchmark iteration if you call `b.Loop` incorrectly:

```go
// Bad: controller per iteration
for i := 0; i < b.N; i++ {
    ctrl := gomock.NewController(b)
    m := mocks.NewMockX(ctrl)
    m.EXPECT().Foo().Return(nil).AnyTimes()
    svc.Run(m)
}
```

Move the controller and mock outside the loop:

```go
// Good
ctrl := gomock.NewController(b)
m := mocks.NewMockX(ctrl)
m.EXPECT().Foo().Return(nil).AnyTimes()
b.ResetTimer()
for i := 0; i < b.N; i++ {
    svc.Run(m)
}
```

This is straightforward but easy to miss; benchmark times will be
dominated by mock construction otherwise.

## 17. Use build tags to exclude mocks from production

If mocks live in the same package as production code, exclude them
from non-test builds:

```go
//go:build test || !production

package store
```

Or place mocks in `mocks/` subpackages, which is the cleaner pattern.
Either way, ensure release builds don't drag in `testify/mock` or
`gomock` runtime dependencies.

## 18. Final note

Most of these optimizations are micro-level. The biggest single
optimization is **replacing mocks with fakes or real-in-memory
implementations**. A fake-heavy test suite is often 3-5x faster than a
mock-heavy one because reflection overhead disappears. Start there;
the rest is icing.
