---
layout: default
title: httptest — Optimize
parent: net/http/httptest
grand_parent: Testing and Benchmarking
ancestor: Go
nav_order: 10
has_children: false
permalink: /roadmap/programming-languages/golang/09-testing-and-benchmarking/04-httptest/optimize/
---

# httptest — Optimize

[← Back](../)

`httptest` is fast, but a test suite of 10,000 tests can still take meaningful wall-clock time. This file is about the two big trade-offs: `NewRecorder` vs `NewServer`, and reusing a server across tests vs creating one per test.

## NewRecorder vs NewServer

`NewRecorder` runs the handler in-process. There is no TCP socket, no `Accept` loop, no `bufio.Reader` over a `net.Conn`. The cost per call is a few allocations: `http.Header` (a map), `bytes.Buffer`, and the `ResponseRecorder` struct itself.

A representative micro-benchmark on Go 1.22, M2 Pro:

```
BenchmarkRecorder-10     1_500_000      750 ns/op       560 B/op       6 allocs/op
BenchmarkServer-10           50_000   23_000 ns/op    5_200 B/op      40 allocs/op
```

`NewServer` is roughly 30x slower per request. That includes TCP handshake (loopback), HTTP/1.1 request parsing, response writing, and a goroutine spawn per connection. For a unit-test suite with 5,000 handler tests, that's the difference between 4ms and 115ms. For an integration-test suite of 200 tests, the absolute cost (about 5ms total) is invisible.

**Heuristic.** If the code under test is an `http.Handler` and you do not need TLS, hijack, streaming, or real HTTP/1.1 parsing, prefer `NewRecorder`. If the code under test is an `*http.Client` (or anything *outside* the handler boundary), you have no choice but `NewServer`.

```go
// Cheap, in-process handler test
func TestHandler(t *testing.T) {
    rec := httptest.NewRecorder()
    req := httptest.NewRequest("GET", "/", nil)
    MyHandler(rec, req)
    if rec.Code != 200 {
        t.Fatalf("got %d", rec.Code)
    }
}
```

```go
// More expensive: a real server when you need a real client
func TestClient(t *testing.T) {
    ts := httptest.NewServer(http.HandlerFunc(myHandler))
    t.Cleanup(ts.Close)

    if err := CallAPI(ts.Client(), ts.URL); err != nil {
        t.Fatal(err)
    }
}
```

## Reusing a server across tests vs per-test

Spinning up a new `httptest.NewServer` per test is the safe default. It guarantees isolation and predictable cleanup. But for a suite that contains hundreds of integration tests sharing the same handler, you may want to amortise the setup.

```go
var sharedServer *httptest.Server

func TestMain(m *testing.M) {
    sharedServer = httptest.NewServer(buildHandler())
    code := m.Run()
    sharedServer.Close()
    os.Exit(code)
}

func TestUsers(t *testing.T) {
    resp, err := sharedServer.Client().Get(sharedServer.URL + "/users")
    if err != nil {
        t.Fatal(err)
    }
    defer resp.Body.Close()
    // ...
}
```

**Pros.** One listener, one accept goroutine, predictable port reuse, faster startup.

**Cons.** Shared mutable handler state. If `buildHandler()` carries an in-memory DB, every test sees and mutates the same data. You must reset state between tests or design idempotent endpoints (each test uses a unique UUID).

**Heuristic.** Reuse the server when the handler is genuinely stateless. Per-test when the handler holds mutable state.

A middle ground is "per-test handler, reused listener" — but `httptest.Server` does not support swapping the handler after `Start`. You'd have to write a small dispatcher that reads a `sync.Map` of handlers keyed by request path or a header.

## Body allocation

`ResponseRecorder.Body` is a `*bytes.Buffer`. Each `NewRecorder` allocates a fresh buffer. Tests that handle very large bodies (multiple MB) may push GC pressure. Two options:

1. Reuse a `*bytes.Buffer` via `sync.Pool` and inject it into the recorder (`rec.Body = pooled`). This breaks encapsulation but works.
2. Use `io.Discard` when you do not need the body — set `rec.Body = nil` *after* construction; writes will then be discarded.

For ordinary handler tests, leave it alone. The buffer is small and short-lived.

## Avoid `time.Sleep` in tests

Polling for "the server is ready" with `time.Sleep(100 * time.Millisecond)` is anti-pattern. `httptest.NewServer` returns *after* the listener is open, so the next line can issue a request without delay. If you find yourself adding `time.Sleep` to a test, you are working around a missing synchronisation primitive — usually a channel from the handler back to the test.

## Avoid running tests sequentially when you can parallelise

`t.Parallel()` is your single biggest lever. A 200-test suite with `t.Parallel` and per-test `httptest.NewServer` may run faster than a 200-test suite with a shared server but no parallelism. The Go runtime will multiplex goroutines onto cores; the kernel will assign distinct ports.

```go
func TestThing(t *testing.T) {
    t.Parallel()
    ts := httptest.NewServer(...)
    t.Cleanup(ts.Close)
    // ...
}
```

If you parallelise, verify with `go test -race`.

## Benchmarks

To compare your code paths under load, use the benchmark framework:

```go
func BenchmarkHandler(b *testing.B) {
    req := httptest.NewRequest("GET", "/", nil)
    b.ReportAllocs()
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        rec := httptest.NewRecorder()
        MyHandler(rec, req)
    }
}
```

```go
func BenchmarkServer(b *testing.B) {
    ts := httptest.NewServer(http.HandlerFunc(MyHandler))
    defer ts.Close()
    client := ts.Client()
    b.ReportAllocs()
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        resp, _ := client.Get(ts.URL)
        io.Copy(io.Discard, resp.Body)
        resp.Body.Close()
    }
}
```

Compare the two with `benchstat`; the gap is your tax for going through a real socket.

## Disable keep-alive when measuring per-request cost

`Server.Client()` may reuse connections across calls; for benchmarks that intend to measure connection setup, disable keep-alive on the request:

```go
req, _ := http.NewRequest("GET", ts.URL, nil)
req.Close = true
client.Do(req)
```

Or set `Transport.DisableKeepAlives = true` on a custom transport.

## Profile the test, not just the production code

When your test suite is slow, run `go test -cpuprofile=cpu.out -bench=.` and `pprof` the result. You will often find that the bottleneck is in your test setup — JSON marshalling of fixtures, deep struct comparisons, regex-based assertions — rather than the handler.

A typical profile of a slow handler benchmark looks like:

```
(pprof) top
Showing nodes accounting for 1.50s, 71.43% of 2.10s total
      flat  flat%   sum%        cum   cum%
     0.45s 21.43% 21.43%      0.62s 29.52%  runtime.mallocgc
     0.30s 14.29% 35.71%      0.30s 14.29%  syscall.Syscall
     0.25s 11.90% 47.62%      0.25s 11.90%  runtime.scanobject
     0.20s  9.52% 57.14%      0.45s 21.43%  encoding/json.(*Decoder).Decode
     0.18s  8.57% 65.71%      0.18s  8.57%  net.(*conn).Read
     0.12s  5.71% 71.43%      0.12s  5.71%  bytes.(*Buffer).String
```

Read the lines top-to-bottom. `mallocgc` and `scanobject` together account for a third of the time — allocations are the bottleneck. `syscall.Syscall` and `net.(*conn).Read` together account for almost a fifth — that's the loopback I/O. JSON decoding is significant. If you switched from `NewServer` to `NewRecorder`, the bottom three lines (`syscall`, `conn.Read`) would vanish.

---

## Allocation budgets

Set explicit allocation budgets for your hot benchmark loops. `b.ReportAllocs()` shows allocations per op; aim for stable numbers.

```go
func BenchmarkHandlerStable(b *testing.B) {
    b.ReportAllocs()
    req := httptest.NewRequest("GET", "/", nil)
    for i := 0; i < b.N; i++ {
        rec := httptest.NewRecorder()
        MyHandler(rec, req)
    }
}
```

If `allocs/op` increases between Go versions, you have a regression. Catch this in CI via `benchstat` comparing against a baseline.

```bash
benchstat baseline.txt new.txt
```

Sample output:

```
name              old time/op    new time/op    delta
Handler-10           750ns ± 2%     780ns ± 1%   +4.00%
HandlerStable-10     680ns ± 1%     685ns ± 1%   ~

name              old allocs/op  new allocs/op  delta
Handler-10            6.00 ± 0%     6.00 ± 0%   ~
HandlerStable-10      5.00 ± 0%     5.00 ± 0%   ~
```

A 4% time regression with no allocation change is a hot-path slowdown, probably in the handler body itself. A jump in `allocs/op` is more diagnostic — find the new allocation site with `-memprofile=mem.out` and `pprof`.

---

## Shared request, fresh recorder

A single benchmark loop allocates one `httptest.Recorder` per iteration. The `httptest.Request` can often be reused:

```go
func BenchmarkSharedReq(b *testing.B) {
    req := httptest.NewRequest("GET", "/path", nil) // outside the loop
    b.ReportAllocs()
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        rec := httptest.NewRecorder()
        MyHandler(rec, req)
    }
}
```

Caveat: if the handler reads `r.Body`, the body is exhausted after the first call. Either make a fresh request each iteration (slower, more allocations) or build the body once and `bytes.NewReader` it:

```go
bodyBytes := []byte(`{"name":"Ada"}`)
for i := 0; i < b.N; i++ {
    rec := httptest.NewRecorder()
    req := httptest.NewRequest("POST", "/", bytes.NewReader(bodyBytes))
    MyHandler(rec, req)
}
```

Each iteration allocates a fresh `bytes.Reader`, but reuses the byte slice.

---

## Avoid `t.Log` in benchmark hot loops

`t.Log` (well, `b.Log` in benchmarks) is slow because it formats and buffers a line. Inside the hot loop it dominates the runtime:

```go
// BAD
for i := 0; i < b.N; i++ {
    rec := httptest.NewRecorder()
    MyHandler(rec, req)
    b.Logf("status %d", rec.Code) // SLOW
}
```

Either remove the log or guard it with `if b.N == 1 { b.Logf(...) }` so it only fires once. Better: don't log; check `rec.Code` and `b.Fatal` on mismatch.

---

## Sub-benchmarks for parameter sweeps

A benchmark that compares handler performance across input sizes:

```go
func BenchmarkBySize(b *testing.B) {
    for _, size := range []int{100, 1000, 10000, 100000} {
        size := size
        b.Run(fmt.Sprintf("size=%d", size), func(b *testing.B) {
            body := bytes.Repeat([]byte{'x'}, size)
            b.ReportAllocs()
            b.ResetTimer()
            for i := 0; i < b.N; i++ {
                rec := httptest.NewRecorder()
                req := httptest.NewRequest("POST", "/", bytes.NewReader(body))
                MyHandler(rec, req)
            }
        })
    }
}
```

The output:

```
BenchmarkBySize/size=100-10         500000      2400 ns/op     800 B/op    7 allocs/op
BenchmarkBySize/size=1000-10        100000     12300 ns/op    1700 B/op    7 allocs/op
BenchmarkBySize/size=10000-10        15000     85000 ns/op   10800 B/op    7 allocs/op
BenchmarkBySize/size=100000-10        1500    780000 ns/op  104800 B/op    8 allocs/op
```

Note the linear-with-size time and bytes, but constant allocations. That's a good handler. Non-linear scaling is a bug; jumping allocations is a buffer-doubling pattern that could be pre-sized.

---

## Run benchmarks in CI

A benchmark suite that runs in CI catches regressions before merge. Run it on every PR, compare against `main`:

```bash
git checkout main
go test -bench=. -count=10 -run=^$ ./... > main.txt
git checkout pr-branch
go test -bench=. -count=10 -run=^$ ./... > pr.txt
benchstat main.txt pr.txt
```

The `-count=10` averages over runs; CI noise can be high. The `-run=^$` skips functional tests, running only benchmarks.

Threshold: fail the build on >5% regression in any benchmark. Tune to your project's tolerance.

---

[← Back](../)
