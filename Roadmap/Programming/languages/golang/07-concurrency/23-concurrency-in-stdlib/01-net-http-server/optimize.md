---
layout: default
title: net/http Server Concurrency — Optimize
parent: net/http Server Concurrency
grand_parent: Concurrency in Stdlib
ancestor: Go
nav_order: 10
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/23-concurrency-in-stdlib/01-net-http-server/optimize/
---

# net/http Server Concurrency — Optimize

[← Back](../)

> Scenarios where the default `*http.Server` is suboptimal, and the fix.

---

## Scenario 1 — `ReadTimeout` too coarse for a mixed workload

**Before:**
```go
srv := &http.Server{
    Addr:        ":8080",
    ReadTimeout: 5 * time.Second,
    Handler:     mux,
}
```

A 5-second `ReadTimeout` is fine for tiny APIs but kills legitimate large uploads. Either you raise it (becoming vulnerable to slow-header attacks) or you cap upload size aggressively.

**After:**
```go
srv := &http.Server{
    Addr:              ":8080",
    ReadHeaderTimeout: 5 * time.Second,  // headers only
    ReadTimeout:       0,                // no overall read deadline
    WriteTimeout:      30 * time.Second, // generous response budget
    IdleTimeout:       60 * time.Second, // close idle keep-alive
    Handler:           mux,
}
```

Now headers must arrive in 5s (slowloris-resistant) but body reads have no overall deadline. Per-handler logic uses `r.Context()` + `context.WithTimeout` for endpoint-specific limits.

**Expected gain.** Slowloris vulnerability closed without breaking large uploads. Goroutines for slow header attackers exit in 5s instead of holding indefinitely.

**Verification.** Slowloris attacker simulation; legitimate `curl --upload-file 100M` succeeds.

---

## Scenario 2 — Tuning `MaxConcurrentStreams` for HTTP/2

**Before:** Default `http2.Server.MaxConcurrentStreams = 250`.

A heavy gRPC-ish workload with 1000 long-poll streams per connection saturates the limit; clients see `REFUSED_STREAM` and retry, churning streams.

**After:**
```go
h2s := &http2.Server{
    MaxConcurrentStreams: 2000,
    MaxReadFrameSize:     1 << 20, // 1 MiB
    IdleTimeout:          5 * time.Minute,
}
srv := &http.Server{
    Addr:    ":8080",
    Handler: h2c.NewHandler(handler, h2s),
}
http2.ConfigureServer(srv, h2s)
```

**Caveat.** Each stream is one goroutine. 2000 streams = 2000 goroutines per connection. With 1000 connections that's 2M goroutines. Stack memory at 8 KB each = 16 GiB. Tune in proportion to actual concurrent demand.

**Expected gain.** Fewer `REFUSED_STREAM` errors, smoother latency under bursts.

**Verification.** Increase load; measure `REFUSED_STREAM` rate and goroutine count.

---

## Scenario 3 — `MaxHeaderBytes` for memory protection

**Before:** Default 1 MiB (`http.DefaultMaxHeaderBytes`).

Attacker sends 1 MiB of header per connection × 100k connections = 100 GiB of allocated buffer.

**After:**
```go
srv := &http.Server{
    Addr:           ":8080",
    MaxHeaderBytes: 16 << 10, // 16 KiB
    Handler:        mux,
}
```

**Expected gain.** Per-connection header memory capped at 16 KiB. Slow header attackers run out of budget quickly.

**Verification.** Generate headers exceeding the limit; server returns 431 Request Header Fields Too Large.

---

## Scenario 4 — `sync.Pool` for handler scratch buffers

**Before:** Each request allocates a fresh `[]byte` buffer for JSON serialisation.

```go
func handler(w http.ResponseWriter, r *http.Request) {
    buf := make([]byte, 0, 4096)
    buf = appendJSON(buf, data)
    w.Write(buf)
}
```

With 100k req/s, this allocates 400 MB/s of buffers, all churned by GC.

**After:**
```go
var bufPool = sync.Pool{
    New: func() any { b := make([]byte, 0, 4096); return &b },
}

func handler(w http.ResponseWriter, r *http.Request) {
    pb := bufPool.Get().(*[]byte)
    *pb = (*pb)[:0]
    defer bufPool.Put(pb)
    
    *pb = appendJSON(*pb, data)
    w.Write(*pb)
}
```

**Expected gain.** Allocation rate drops by 90%+. GC pause times reduced. CPU spent in `runtime.mallocgc` drops.

**Verification.** `go test -bench . -benchmem`; allocations/op should drop from ~5 to ~1 or 0.

---

## Scenario 5 — Avoid `io.ReadAll` on request body

**Before:**
```go
func handler(w http.ResponseWriter, r *http.Request) {
    body, _ := io.ReadAll(r.Body) // BUG: unbounded
    var req Req
    json.Unmarshal(body, &req)
    // ...
}
```

`io.ReadAll` allocates as much memory as the client sends. Attacker sends 10 GiB body → server OOMs.

**After:**
```go
func handler(w http.ResponseWriter, r *http.Request) {
    r.Body = http.MaxBytesReader(w, r.Body, 1<<20) // 1 MiB cap
    var req Req
    if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
        if errors.Is(err, &http.MaxBytesError{}) {
            http.Error(w, "body too large", http.StatusRequestEntityTooLarge)
            return
        }
        http.Error(w, err.Error(), 400)
        return
    }
}
```

**Expected gain.** Memory bounded per request. `json.Decoder` streams instead of buffering.

**Verification.** Send a 10 MiB body; server returns 413.

---

## Scenario 6 — Per-CPU server with `SO_REUSEPORT`

**Before:** Single listener, one accept loop, contention on `accept`.

```go
http.ListenAndServe(":8080", handler)
```

Under heavy connection rate, `accept` is a single-goroutine bottleneck. The kernel queues incoming SYNs; the user-space accept can't drain fast enough on a 32-core box.

**After:** Multiple listeners on the same port via `SO_REUSEPORT`, one per CPU:

```go
import "golang.org/x/sys/unix"

func reusePortListen(addr string) (net.Listener, error) {
    lc := net.ListenConfig{
        Control: func(network, address string, c syscall.RawConn) error {
            return c.Control(func(fd uintptr) {
                unix.SetsockoptInt(int(fd), unix.SOL_SOCKET, unix.SO_REUSEPORT, 1)
            })
        },
    }
    return lc.Listen(context.Background(), "tcp", addr)
}

func main() {
    for i := 0; i < runtime.NumCPU(); i++ {
        ln, _ := reusePortListen(":8080")
        srv := &http.Server{Handler: handler}
        go srv.Serve(ln)
    }
    select {}
}
```

The kernel distributes connections across listeners (Linux 3.9+, BSD).

**Expected gain.** 2-4x accept throughput on heavily connection-churn workloads.

**Verification.** `ab -k -n 1000000 -c 100 ...`; measure connections/sec.

---

## Scenario 7 — Limit goroutines via `netutil.LimitListener`

**Before:** No connection limit. SYN flood spawns 100k goroutines.

**After:**
```go
import "golang.org/x/net/netutil"

func main() {
    ln, _ := net.Listen("tcp", ":8080")
    ln = netutil.LimitListener(ln, 10000) // max 10k concurrent conns
    srv := &http.Server{Handler: handler}
    srv.Serve(ln)
}
```

Beyond 10k accepted conns, `Accept` blocks. The kernel SYN queue fills, then drops.

**Expected gain.** Predictable goroutine count under flood. Memory bounded.

**Caveat.** Legitimate clients get connection-refused under sustained flood; combine with rate-limiting at IP level.

**Verification.** Flood test; goroutine count caps at limit.

---

## Scenario 8 — Avoid `fmt.Sprintf` in hot paths

**Before:**
```go
func handler(w http.ResponseWriter, r *http.Request) {
    msg := fmt.Sprintf("hello %s, you are %d", r.Header.Get("Name"), age)
    w.Write([]byte(msg))
}
```

`fmt.Sprintf` allocates and uses reflection. At 100k req/s, this is a measurable hot spot.

**After:**
```go
func handler(w http.ResponseWriter, r *http.Request) {
    name := r.Header.Get("Name")
    b := make([]byte, 0, 32+len(name))
    b = append(b, "hello "...)
    b = append(b, name...)
    b = append(b, ", you are "...)
    b = strconv.AppendInt(b, int64(age), 10)
    w.Write(b)
}
```

Or, with `sync.Pool` for the buffer:

```go
pb := bufPool.Get().(*[]byte)
*pb = (*pb)[:0]
*pb = append(*pb, "hello "...)
// ...
w.Write(*pb)
bufPool.Put(pb)
```

**Expected gain.** 3-5x throughput in micro-benchmark. Significant in real APIs.

**Verification.** `go test -bench .`; allocations/op drops to 1-2.

---

## Scenario 9 — Use `Server.ConnContext` for connection-scoped state

**Before:** Per-request middleware fetches the client's TLS certificate from `r.TLS.PeerCertificates`. Called per request.

**After:** Use `ConnContext` to compute it once per connection:

```go
type contextKey string
const certCN contextKey = "certCN"

srv := &http.Server{
    Addr: ":443",
    ConnContext: func(ctx context.Context, c net.Conn) context.Context {
        if tlsC, ok := c.(*tls.Conn); ok {
            cs := tlsC.ConnectionState()
            if len(cs.PeerCertificates) > 0 {
                return context.WithValue(ctx, certCN, cs.PeerCertificates[0].Subject.CommonName)
            }
        }
        return ctx
    },
    Handler: mux,
}
```

Now `r.Context().Value(certCN)` is set per connection — no per-request TLS state inspection.

**Expected gain.** Small but consistent; eliminates a per-request reflection or parsing step.

**Verification.** Benchmark mTLS API before/after; latency P50 drops.

---

## Scenario 10 — Disable keep-alive when not beneficial

**Before:** Keep-alive default-on. For a one-shot batch worker that hits the API once, keep-alive holds the server goroutine and conn for `IdleTimeout` after the request.

**After:** If your clients are non-persistent, disable keep-alive to free resources faster:

```go
srv.SetKeepAlivesEnabled(false)
```

Each response gets `Connection: close`; server closes conn immediately after response.

**Expected gain.** Lower memory under fan-out workloads. Fewer goroutines lingering.

**Caveat.** Lose the TCP/TLS handshake amortisation. Only flip this if you've measured that connections don't get reused.

---

## Scenario 11 — Disable HTTP/2 if not needed

**Before:** TLS server with default HTTP/2 negotiation. Each connection has framer + writer + per-stream goroutines.

**After:** If clients only do simple sequential HTTP/1.1, disable HTTP/2:

```go
srv := &http.Server{
    Addr:        ":443",
    Handler:     mux,
    TLSConfig:   tlsCfg,
    TLSNextProto: map[string]func(*http.Server, *tls.Conn, http.Handler){}, // disable h2
}
```

**Expected gain.** Lower goroutine count per connection (~3x fewer for h2 conns). Lower CPU spent in frame parsing.

**Verification.** Run with both configs; compare `runtime.NumGoroutine` and CPU profile.

---

## Scenario 12 — Profile with `pprof` to find the real bottleneck

The above scenarios are educated guesses. Always profile before optimizing:

```go
import _ "net/http/pprof"

go func() { http.ListenAndServe("localhost:6060", nil) }()
```

Under load:
- `go tool pprof http://localhost:6060/debug/pprof/profile?seconds=30` — CPU.
- `go tool pprof http://localhost:6060/debug/pprof/heap` — memory.
- `go tool pprof http://localhost:6060/debug/pprof/goroutine` — goroutine state.
- `curl http://localhost:6060/debug/pprof/trace?seconds=5 > trace.out; go tool trace trace.out` — scheduling.

**Method.** Identify the top 3 functions by CPU. Find one that has an algorithmic improvement (not "Go is slow"). Apply it. Re-profile. Repeat. Stop when no function dominates.

**Common findings.**
- `runtime.mallocgc` → reduce allocations (sync.Pool, buffer reuse).
- `syscall.Read`/`Write` → reduce syscalls (batch with `bufio`).
- `crypto/tls.(*Conn).Write` → reduce response sizes or enable HTTP/2 (one TLS conn for many requests).
- `encoding/json.Marshal` → use `easyjson`, `jsoniter`, or hand-rolled encoders.
- `regexp.(*Regexp).Match` → precompile once, not per-request.

---
