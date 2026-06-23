# 8.10 `net` — Tasks

> Hands-on exercises with acceptance criteria. Each task targets a
> specific layer of the package — dialing, listening, deadlines,
> framing, graceful shutdown, observability. Code in the solution
> hints; expand to a full program with tests.

## 1. Echo server with line framing

Write a TCP server on port 8080 that reads lines from each client
and echoes them back, prefixed with `"echo: "`.

**Acceptance:**

- `nc localhost 8080` works interactively.
- A second client can connect simultaneously without blocking.
- `Ctrl+C` shuts down within 5 seconds, logging the conn count.

**Hints:**

```go
ln, _ := net.Listen("tcp", ":8080")
for {
    c, err := ln.Accept()
    if err != nil { return }
    go func() {
        defer c.Close()
        s := bufio.NewScanner(c)
        for s.Scan() {
            fmt.Fprintf(c, "echo: %s\n", s.Text())
        }
    }()
}
```

Add the SIGINT handler with `signal.NotifyContext` and a wait
group around the conn-handling goroutine.

## 2. UDP DNS-style request/response

Write a UDP server on port 9000 that receives a 4-byte big-endian
request id, replies with the same 4 bytes prefixed by 0x01.

**Acceptance:**

- Server uses `net.ListenPacket("udp", ":9000")`.
- Reply uses `pc.WriteTo` with the source address from `ReadFrom`.
- A test client sends 100 requests in parallel and verifies all
  responses match their requests.

**Hints:**

```go
buf := make([]byte, 1500)
for {
    n, src, _ := pc.ReadFrom(buf)
    if n != 4 { continue }
    resp := append([]byte{0x01}, buf[:n]...)
    pc.WriteTo(resp, src)
}
```

Don't forget to *copy* `buf[:n]` if you fan out to a worker.

## 3. Length-prefixed binary protocol with cap

Build a server that reads frames in this format: `[4-byte BE
length][payload]`. Reject frames over 1 MiB. Echo the payload
back, framed identically.

**Acceptance:**

- A 0-byte payload round-trips.
- A 1 MiB payload round-trips.
- A 2 MiB payload causes the server to log "frame too large" and
  close the conn (with no panic).
- A truncated header (peer closes mid-length-prefix) is logged as
  `io.ErrUnexpectedEOF`, no panic.

**Hints:** Use `io.ReadFull` for the header and the body. Cap with
an explicit `if n > maxFrame` check before `make`.

## 4. Deadlines that don't accumulate

A buggy server uses `c.SetReadDeadline(time.Now().Add(d))` once
and never resets. After the first deadline fires, the conn becomes
unusable. Fix it: read a request, process, write response, with
the deadline reset before each phase.

**Acceptance:**

- Test: open a conn, send a request slowly (1 byte/sec), verify
  the deadline fires.
- Send a normal request immediately after, verify it succeeds —
  i.e., the conn isn't permanently broken.

**Hints:** A new `SetReadDeadline(time.Now().Add(d))` overrides
the old one. After a timeout error, the conn is still usable;
just reset.

## 5. Dialer with context

Write a function `Dial(ctx context.Context, addr string)
(net.Conn, error)` that uses `net.Dialer.DialContext`, sets a
3-second per-attempt timeout, and respects the context's
deadline.

**Acceptance:**

- Test: pass a context with 100ms deadline, dial a slow address —
  the call returns the deadline error.
- Test: pass a context with 10s deadline, dial an unreachable
  address — returns `connect: connection refused` or similar
  within 3 seconds (the dialer timeout).

**Hints:**

```go
d := net.Dialer{Timeout: 3 * time.Second}
return d.DialContext(ctx, "tcp", addr)
```

Use `errors.Is(err, context.DeadlineExceeded)` in tests.

## 6. Graceful shutdown for a TCP server

Take task 1's echo server and add proper shutdown. On SIGTERM:

1. Stop accepting new conns.
2. Wait up to 30 seconds for in-flight conns to finish (a client
   in the middle of a request gets to finish).
3. Force-close any conns still open after the deadline.
4. Exit with code 0.

**Acceptance:**

- Test: open a conn, send a partial line, send SIGTERM, send the
  rest of the line, verify the response arrives.
- Test: open a conn, do nothing, send SIGTERM, verify the server
  exits within 30s and the conn is closed by the server.

**Hints:** Wrap `Accept` in a goroutine; use `sync.WaitGroup` for
handlers; close the listener on signal; track open conns in a
`sync.Map` so you can force-close on timeout.

## 7. UDP server with worker pool

Build a UDP server where the read goroutine fans out received
datagrams to a pool of N workers (N = `runtime.NumCPU()`). Each
worker sleeps 10ms and replies.

**Acceptance:**

- Throughput scales with CPU count (test with 1, 2, 4 workers).
- The read goroutine never blocks waiting for a worker — drop
  packets if the work queue is full.
- Drop count is logged every 10 seconds.

**Hints:**

```go
work := make(chan packet, 1024)

select {
case work <- pkt:
default:
    drops.Add(1)
}
```

A buffered channel + non-blocking send is the simplest backpressure.

## 8. Unix socket with file-mode lock

Write a server that listens on `/tmp/yourapp.sock`, sets the file
mode to `0o660`, and removes the file on shutdown.

**Acceptance:**

- A user not in the right group cannot connect.
- Restarting the server doesn't fail with "address already in use."
- A test that creates a stale socket file (e.g., kill -9) and
  restarts succeeds (your code should `os.Remove` the path before
  `Listen` on second start, or detect and clean up).

**Hints:**

```go
os.Remove(path) // pre-clean
ln, _ := net.Listen("unix", path)
os.Chmod(path, 0o660)
defer os.Remove(path)
defer ln.Close()
```

## 9. Random-port listener for tests

Write a test helper `func newServer(t *testing.T) (addr string,
shutdown func())` that starts an echo server on a kernel-chosen
port and returns the address and a cleanup function.

**Acceptance:**

- Multiple tests can run in parallel without port collision.
- `t.Cleanup` runs `shutdown` automatically.
- The address is `127.0.0.1:PORT` (not `[::]:PORT`).

**Hints:**

```go
ln, _ := net.Listen("tcp", "127.0.0.1:0")
addr := ln.Addr().(*net.TCPAddr).String()
```

## 10. Dialer with custom resolver

Build a `*net.Dialer` whose resolver always uses 1.1.1.1:53 over
TCP (avoiding any local DNS). Use it to dial `example.com:80`.

**Acceptance:**

- Verify with `tcpdump` or by setting `GODEBUG=netdns=go+1` that
  the lookup goes to 1.1.1.1.
- Lookup fails fast (within 2 seconds) if 1.1.1.1 is unreachable.

**Hints:**

```go
r := &net.Resolver{
    PreferGo: true,
    Dial: func(ctx context.Context, network, addr string) (net.Conn, error) {
        d := net.Dialer{Timeout: 2 * time.Second}
        return d.DialContext(ctx, "tcp", "1.1.1.1:53")
    },
}
d := net.Dialer{Resolver: r, Timeout: 5 * time.Second}
c, err := d.DialContext(ctx, "tcp", "example.com:80")
```

## 11. Half-close a TCP connection

Write a client that sends a multi-line request, calls `CloseWrite`,
then reads the response until EOF.

**Acceptance:**

- The peer (a simple cat-style server) reads to EOF, processes,
  and replies; the client sees the response.
- Without `CloseWrite`, the test hangs (verify by removing the
  call and observing).

**Hints:**

```go
tc := c.(*net.TCPConn)
io.WriteString(tc, "line1\nline2\nline3\n")
tc.CloseWrite()
io.Copy(os.Stdout, tc)
```

## 12. Connection pool with idle timeout

Write a TCP connection pool with: max idle 100, idle timeout 90s,
health check on Get (zero-byte read with 1ms deadline; evict if it
returns anything other than a deadline error).

**Acceptance:**

- Stress test with 1000 goroutines doing short requests reuses
  conns — `lsof` shows ~100 open, not 1000.
- Conns idle past 90s are evicted on the next maintenance tick.
- A killed server (peer side) doesn't poison the pool — broken
  conns are detected on Get.

**Hints:** Background goroutine sweeping the pool every 30s. The
zero-byte deadline trick:

```go
c.SetReadDeadline(time.Now().Add(time.Millisecond))
var b [1]byte
_, err := c.Read(b[:])
if err == nil || !errors.Is(err, os.ErrDeadlineExceeded) {
    // peer sent something or closed; not safe to reuse
    return false
}
c.SetReadDeadline(time.Time{}) // clear
return true
```

## 13. Wrap `net.Listener` for accept-rate limiting

Write a wrapper `RateLimited(ln, perSecond int) net.Listener`
that limits how many `Accept`s succeed per second; over the cap,
sleep until the next bucket.

**Acceptance:**

- Test: 10 conns/sec cap; bench shows ~10/sec accept rate
  regardless of how many clients try.
- Excess clients see their conn delayed but eventually accepted
  (no rejection).

**Hints:** Token bucket on `Accept`; the wait happens *before*
`Accept` returns to the caller, so the listener appears slow but
correct.

## 14. UDP request/reply with timeout and retry

Build a UDP client that sends a request, waits 500ms for a reply,
retries up to 3 times with exponential backoff.

**Acceptance:**

- Server replies on first try → client returns immediately.
- Server replies on third try → client returns the third reply.
- Server never replies → client returns an error after ~3.5s
  total.

**Hints:** `*UDPConn.SetReadDeadline` per attempt; retry on
`os.ErrDeadlineExceeded`. Use a fresh deadline each retry.

## 15. Detect a goroutine leak

Take task 1's echo server, deliberately remove `defer c.Close()`,
and write a test that detects the leak using
`runtime.NumGoroutine()` before and after a simulated client
disconnection.

**Acceptance:**

- Test fails (red) when `Close` is missing.
- Test passes when `Close` is restored.
- The test has a settle delay (e.g., 100ms) so transient goroutines
  finish before the count.

**Hints:**

```go
n0 := runtime.NumGoroutine()
// run requests, close clients
time.Sleep(200 * time.Millisecond)
runtime.GC()
n1 := runtime.NumGoroutine()
if n1-n0 > tolerance { t.Fail() }
```

## 16. Stretch: TCP proxy

Write `proxy(local, remote string)`: listens on `local`, for each
incoming conn dials `remote` and copies bytes in both directions.
Close both sides when either closes.

**Acceptance:**

- `nc localhost LOCAL` to a proxy of `example.com:80` succeeds at
  HTTP.
- Half-close from one side propagates as `CloseWrite` to the other.
- Both directions terminate cleanly when either side closes.

**Hints:**

```go
go func() { io.Copy(remote, local); remote.(*net.TCPConn).CloseWrite() }()
io.Copy(local, remote)
local.Close(); remote.Close()
```

The trick is making the two `io.Copy` goroutines tear down both
conns; cancelling one means the other will read EOF.

## 17. Stretch: file-descriptor handover

Build two binaries: `parent` listens on port 8080; on signal
SIGUSR2, it exec's `child` with the listener's fd in `ExtraFiles`,
then exits after draining. `child` wraps the inherited fd as a
listener and continues.

**Acceptance:**

- `nc -k localhost 8080` keeps working through the handover (no
  "connection refused" from new clients).
- In-flight requests on `parent` finish with the response (test
  with a slow handler).

**Hints:** See [professional.md §6](professional.md). Use
`os.Getenv` and `os.NewFile(uintptr(3), "lis")` in the child.

## 18. Stretch: SO_REUSEPORT scaling

Start N processes (or N goroutines with N listeners), all bound
to the same port via `SO_REUSEPORT`. Verify load is spread across
them.

**Acceptance:**

- Each listener accepts roughly the same number of conns under
  uniform load.
- Killing one process redistributes load to the others within a
  few seconds.

**Hints:**

```go
lc := net.ListenConfig{
    Control: func(_, _ string, c syscall.RawConn) error {
        return c.Control(func(fd uintptr) {
            unix.SetsockoptInt(int(fd), unix.SOL_SOCKET, unix.SO_REUSEPORT, 1)
        })
    },
}
ln, _ := lc.Listen(ctx, "tcp", ":8080")
```

Linux only; `SO_REUSEPORT` semantics differ on BSD.

## 19. Stretch: rate-limited writer per-conn

Wrap `net.Conn.Write` with a token bucket so each conn writes at
most N bytes/second. Apply to the echo server.

**Acceptance:**

- Bench: a single client sees its echoes streamed at the
  configured rate.
- Multiple clients each get the full per-conn allowance (rate is
  per-conn, not global).

**Hints:** Reuse the rate-limited writer pattern from
[`../01-io-and-file-handling/middle.md`](../01-io-and-file-handling/middle.md), or
use `golang.org/x/time/rate.Limiter`.

## 20. Stretch: TLS-wrapped server

Take task 1 and wrap the listener in `tls.Listen` with a self-signed
cert. Test with `openssl s_client`.

**Acceptance:**

- `openssl s_client -connect localhost:8080` completes the
  handshake.
- After the handshake, sending a line still echoes.
- Setting `SetReadDeadline` on the `*tls.Conn` after the handshake
  works as before.

**Hints:**

```go
cert, _ := tls.LoadX509KeyPair("cert.pem", "key.pem")
cfg := &tls.Config{Certificates: []tls.Certificate{cert}}
ln, _ := tls.Listen("tcp", ":8080", cfg)
```

For cert generation, see [`../13-crypto/`](../13-crypto/junior.md).

## Cross-references

- [`../01-io-and-file-handling/tasks.md`](../01-io-and-file-handling/tasks.md) — exercises that combine well with these.
- [find-bug.md](find-bug.md) — bugs you'll spot in your solutions.
- [optimize.md](optimize.md) — performance follow-ups for tasks 7, 13, 18.
