# High-Performance TCP Socket Server (C10K → C10M)

> Build a TCP server in Go from the socket up — `accept`, read/write, a custom
> length-prefixed binary protocol — then drive it across the concurrency
> frontier until you find the wall. The goal is not "it serves connections."
> The goal is to **name and prove** what breaks first at each scale: goroutine
> memory, the GC, syscall rate, the accept lock, or the NIC.

| | |
|---|---|
| **Tier** | Networking |
| **Primary domain** | Low-level socket programming / network performance |
| **Skills exercised** | BSD sockets, the Go netpoller (epoll/kqueue), goroutine-per-conn vs event-loop, stream framing, TCP tuning (Nagle, buffers, keepalive), backpressure, zero-copy, buffer pooling, fd/port limits, graceful drain |
| **Interview sections** | 9 (networking fundamentals), 2 (concurrency), 17 (performance engineering) |
| **Est. effort** | 4–6 focused days |

---

## 1. Context

You own the connection layer at a company whose mobile and IoT fleet keeps
**hundreds of thousands of persistent TCP sockets** open to your edge. Today the
gateway is a naive `net.Listener` with a goroutine per connection, and nobody
can answer the questions that matter: *How many idle connections can one box
hold before it OOMs? At what accept rate does a single `Accept()` loop become
the bottleneck? When a large payload streams through, where do the allocations
come from?* When the box fell over last quarter, the post-mortem said "too much
load" — which is not an answer.

Your job is to build the server from raw sockets, instrument it, and push it
through the historic concurrency milestones — **C10K** (Kegel, 1999), then
C100K, then aim at the **C10M** frontier — and at each rung produce a number
and the proven cause behind it. You will learn exactly where Go's
goroutine-per-connection model (which is already epoll-backed by the runtime
netpoller) stops paying for itself, and what you'd reach for instead.

## 2. Goals / Non-goals

**Goals**
- Implement a correct framed TCP server over a raw `net.TCPListener`: a
  length-prefixed binary wire protocol with **zero partial-read bugs** under
  fragmentation.
- Characterize **memory per idle connection** and find the connection count
  where one box (with stated RAM) tips over.
- Find the **single-acceptor accept-rate ceiling** and beat it with
  `SO_REUSEPORT` multi-acceptor sharding; report the multiplier.
- Quantify the cost knobs: `TCP_NODELAY` (Nagle), socket send/recv buffer sizes,
  buffer pooling (`sync.Pool`) on the hot path, zero-copy (`sendfile`/`splice`).
- Compare goroutine-per-conn vs an explicit epoll event loop (`gnet`/`evio`)
  and state, with evidence, **when the event loop is worth it**.
- Hold a stated p99 + throughput SLO at the C10M-class workload and **prove the
  binding constraint** (syscalls, GC, NIC, NUMA).

**Non-goals**
- TLS termination (that's a separate concern; raw TCP only here so the syscall
  and copy costs are visible).
- HTTP — this is *below* HTTP. WebSockets sit atop this; see
  `senior/04-realtime-chat-presence/`.
- A production protocol with versioning/auth. Keep the wire format fixed and
  minimal so framing and transport, not parsing, are the subject.

## 3. Functional requirements

1. A **server** (`cmd/server`) listens on a configured TCP port, accepts
   connections, and speaks a length-prefixed binary protocol (§7): for each
   inbound frame it returns a response frame (echo in Stage 0; a tiny RPC —
   `PING`, `ECHO`, `SINK`, `STREAM` — beyond that).
2. Framing must survive **stream realities**: a single frame split across
   multiple TCP segments (partial reads), multiple frames coalesced into one
   read (Nagle/batching), and a frame straddling a buffer boundary. Use
   `bufio.Reader` + `io.ReadFull` (or an explicit accumulating decoder).
3. A pluggable **transport backend**, switchable by flag:
   `-engine=goroutine` (one goroutine per conn over `net`) vs `-engine=epoll`
   (an explicit event loop via `gnet` or `evio`).
4. Per-connection limits enforced: **bounded write buffer**, read/write
   **deadlines** (idle timeout), and a **max-frame-size** guard so one peer
   cannot exhaust memory.
5. **Graceful shutdown**: stop accepting, drain in-flight frames within a
   deadline, then close; report how many connections were force-closed.
6. A **load client** (`cmd/loadclient`) opens N connections (configurable
   idle/active split), sends frames at a target rate and payload size, and
   records a full latency histogram (HdrHistogram, not just a mean).

## 4. Load & data profile

- **Connection scale:** sweep **1k → 10k → 100k → 1M+** concurrent sockets.
  Above ~28k you will exhaust the default ephemeral-port range from a single
  client IP — drive load from multiple source IPs/ports or multiple client
  hosts (this is part of the lesson).
- **Payload sizes:** small **64 B** request frames (RPC-style, exposes
  per-message overhead and syscall rate) and large **1 MB–1 GB** streams
  (exposes copy/alloc cost and buffer management). Report both.
- **Traffic model:** **open model** (fixed send rate, not closed-loop
  "as-fast-as-it-drains") so queueing and tail latency are real and coordinated
  omission is avoided.
- **Connection mix:** test mostly-idle fleets (C10M is dominated by *idle*
  conns: memory, not CPU) *and* mostly-active fleets (small-message storm:
  syscall + scheduler bound). State the split per run.
- **Generator:** deterministic given a seed; frame payloads are reproducible.

## 5. Non-functional requirements / SLOs

| Metric | Target |
|--------|--------|
| Concurrent connections (idle), one box | **≥ 1,000,000** held stably; report RSS and **bytes/connection** (target trend toward ≤ 10 KB/conn with tuned buffers) |
| Accept rate (new conns/s), single acceptor | Find & report the ceiling; then **≥ 3×** it with `SO_REUSEPORT` × N acceptors and explain the lock removed |
| Throughput, large-payload streaming | Saturate the NIC: **≥ 90%** of line rate (e.g. ≥ 1.1 GB/s on 10 GbE); name the bound if you fall short |
| Small-message rate (64 B frames) | Report peak frames/s; identify whether syscall rate, scheduler, or GC binds it |
| Round-trip p99 (64 B echo) at 80% of peak rate | **< 1 ms** intra-host / **< 5 ms** over a real link; report p50/p99/p999 |
| Allocations on the hot path | **0 allocs/op** steady-state for a fixed-size frame (prove with `-benchmem` + heap profile) |
| Graceful drain | In-flight frames complete within the drain deadline; **zero truncated frames** mid-shutdown |

> The point is not a magic number — it's to **find your box's number at each
> rung and prove what bounds it.** A throughput figure without a named, proven
> bottleneck is not a finished result.

## 6. Architecture constraints & guidance

- Start on the **raw `net` package** (`net.ListenTCP`, `TCPConn`). Reach
  syscall-level knobs via `SyscallConn().Control(...)` + `golang.org/x/sys/unix`
  for `setsockopt` (`SO_REUSEPORT`, `SO_RCVBUF`/`SO_SNDBUF`, `TCP_NODELAY`,
  keepalive). Understand that `net` is **already epoll/kqueue-backed** by the
  runtime netpoller — a goroutine that blocks on `Read` is parked, not pinned to
  a thread. The comparison is therefore *runtime netpoller + goroutine stacks*
  vs *userspace event loop + flat per-conn buffers*, not "blocking vs epoll."
- For the explicit event-loop engine use `panjf2000/gnet` (or `tidwall/evio`):
  one epoll loop per core, no per-conn goroutine, flat callback model.
- Tune the host and record it in findings: `ulimit -n` (fd limit), `nofile`
  rlimit, `net.ipv4.ip_local_port_range`, `net.ipv4.tcp_tw_reuse`,
  `somaxconn`/listen `backlog`, `net.core.rmem_max`/`wmem_max`. Pin kernel and
  Go versions.
- Instrument with Prometheus + pprof: live conn gauge, accept rate, bytes/s,
  goroutine count, GC pause (`runtime/metrics`), p50/p99/p999, and a continuous
  heap profile. `runtime/trace` for scheduler/netpoller behavior at high RPS.
- Keep `cmd/server` and `cmd/loadclient` as separate binaries on separate hosts
  (or at least separate NICs/namespaces) so client CPU never masks server limits.

## 7. Wire protocol / frame format

A stream is *bytes*, not messages — **TCP gives you a byte stream with no
record boundaries**. The protocol imposes framing. Length-prefix (chosen here)
over delimiter-based framing: no escaping, no scanning, a single `ReadFull` of
a known size, and a cheap max-size guard.

```
Frame (big-endian, length-prefixed):

  0        1        3                      ...
  +--------+--------+--------+-----+--------+
  |  type  |     length      |    payload   |
  | 1 byte |    2 bytes (uint16, payload len, max 65535)
  +--------+--------+--------+-----+--------+
                             |<-- length bytes -->|

  type:    0x01 PING   (length=0)         → PONG
           0x02 ECHO   (payload echoed)   → ECHO  (same payload)
           0x03 SINK   (payload discarded)→ ACK   (length=0)  // big-data ingest
           0x04 STREAM (start; length = chunk size, N chunks follow) → ACK per chunk
  length:  uint16 payload byte count (header excluded). Guard: reject > maxFrame.
```

Decoder contract (the trap to get right):
1. `io.ReadFull(r, hdr[:3])` — never assume one `Read` yields the whole header.
2. Parse `length`; reject if `> maxFrame` (DoS guard) **before** allocating.
3. `io.ReadFull(r, buf[:length])` into a **pooled** buffer.
4. A short `Read` is normal, not an error — only `io.EOF` *before* a full frame
   is a protocol error. Multiple frames per `Read` and one frame per many
   `Read`s must both decode identically.

For payloads beyond 64 KB use the `STREAM` type: a header announcing total size
+ chunk size, then framed chunks — so a 1 GB transfer never needs a 1 GB buffer.

## 8. Interface contract

- **Wire API:** the framed protocol in §7 over raw TCP. No HTTP.
- **Server flags/env:** `-addr`, `-engine=goroutine|epoll`, `-acceptors=N`
  (`SO_REUSEPORT` shards), `-nodelay=true|false`, `-rcvbuf`, `-sndbuf`,
  `-readbuf` (bufio size), `-write-queue` (bounded write-buffer depth),
  `-idle-timeout`, `-max-frame`, `-drain-timeout`, `-pool=true|false`.
- **Load client flags:** `-conns`, `-active-frac`, `-rate` (frames/s/conn),
  `-payload`, `-srcips` (to dodge ephemeral-port exhaustion), `-duration`.
- **Observability:** `GET /metrics` (Prometheus, on a side HTTP port) and
  `/debug/pprof/*`. Metrics include `conns_open`, `accept_total`,
  `bytes_in/out_total`, `frame_rtt_seconds` histogram, `goroutines`,
  `gc_pause_seconds`, `write_queue_drops_total`.
- **Contrast probes (read, don't fully build):** a 20-line **UDP** echo
  (`net.ListenUDP`, no accept/no connection state — datagram boundaries are
  free but delivery isn't) and a **Unix-domain socket** variant (same framing,
  no TCP/IP stack — your intra-host latency floor) to anchor what TCP itself
  costs.

## 9. Key technical challenges

- **The framing trap.** TCP is a stream; `Read` returns *some* bytes, not *your*
  bytes. Every naive server has a partial-read bug that only shows under
  fragmentation/Nagle coalescing. The length-prefix decoder + `ReadFull` is the
  fix — prove it survives a 1-byte-at-a-time adversarial client.
- **Memory per connection is the C10M wall.** A goroutine starts at ~2–8 KB of
  stack; add a read buffer + write buffer + `bufio` and a naive conn can cost
  **32–64 KB**. At 1M conns that's 32–64 GB — the box dies on *idle* memory,
  not CPU. Shrinking per-conn footprint (smaller/pooled buffers, no per-conn
  goroutine in the epoll engine) is the central optimization.
- **The accept lock.** A single `Accept()` loop serializes new-connection setup
  and becomes the ceiling under connection churn. `SO_REUSEPORT` lets N
  acceptors each own a kernel queue, removing the contention — measure the
  before/after.
- **Syscall rate vs batching.** At millions of tiny frames/s, two syscalls per
  frame (`read`+`write`) dominate. Nagle/`TCP_CORK` batch on the wire but add
  latency; `writev`/buffering batches in userspace. The right trade-off depends
  on whether you're latency- or throughput-bound.
- **GC under churn.** Per-frame allocation feeds the GC; at high RPS GC CPU and
  pause become the bound. `sync.Pool` + escape-analysis discipline drive the hot
  path to **0 allocs/op** (see `load-testing/05-go-memory-and-zero-allocation/`).
- **Backpressure / slow consumers.** A slow-reading peer (or a slow-loris)
  fills your write buffer; unbounded, it OOMs you one connection at a time.
  Bounded write queues + write deadlines turn "OOM" into "drop the slow peer."
- **When goroutine-per-conn stops scaling.** It's superb up to ~100k–500k conns;
  past that, stack memory and scheduler run-queue pressure favor an event loop
  with flat per-conn state. Know the crossover for *your* workload, not folklore.

## Stages (0 simple → 1 big data → 2 high RPS → 3 both)

Build Stage 0 correct first — it's your control. Then push each axis alone, then
both. **Don't tune what isn't yet correct.**

| Stage | Conns | Throughput / msg-rate | Payload | Bottleneck it exposes | Pass criterion |
|-------|-------|-----------------------|---------|-----------------------|----------------|
| **0 · Simple** | ~100–1,000 | low (a few k frames/s) | 64 B | Framing correctness only — partial reads, coalesced frames, max-size guard | Framed echo/RPC server with **zero partial-read bugs**, proven against a 1-byte-at-a-time adversarial client; graceful drain truncates nothing |
| **1 · Big data** | ~100 | stream GB-scale total bytes/conn; saturate NIC | 1 MB–1 GB | Buffer management, copy cost, allocations & memory per connection on large transfers | Stream **≥ 100 GB total** at **≥ 90% line rate**; hot path at **0 allocs/op** (pooled buffers); `sendfile`/`splice` fast path measured vs naive copy |
| **2 · High RPS** | 10k → 100k+ (idle + bursts) | very high accept rate + small-msg storm | 64 B | Goroutine memory, scheduler pressure, **accept-throughput ceiling**, epoll vs goroutine-per-conn | Hold **100k** conns; report **bytes/conn**; beat single-acceptor accept rate **≥ 3×** with `SO_REUSEPORT`; goroutine-vs-epoll memory & throughput compared with numbers |
| **3 · Both (C10M frontier)** | **≥ 1,000,000** | high throughput **and** small-msg load with non-trivial payloads | mixed 64 B + 4–64 KB | The **binding constraint**: syscall rate, GC CPU/pause, NIC saturation, NUMA/per-core locality, run-queue length | Hold **1M** conns under active load meeting **p99 < 5 ms** and stated throughput SLO; **name and prove** the single binding constraint with pprof/`perf`/NIC counters |

A run is only **senior/staff done at Stage 3** — SLO held *and* bottleneck
proven, not merely "it didn't crash."

## 10. Experiments to run (break it / tune it)

Record before/after numbers (and the command) for each:

1. **Goroutine-per-conn vs epoll — memory.** Hold 100k then 1M *idle* conns on
   both engines. Compare RSS and bytes/conn. Where does the goroutine stack tax
   become the wall? At what conn count does epoll's flat model win?
2. **Goroutine-per-conn vs epoll — throughput.** Small-message storm at fixed
   conn count. Compare frames/s, CPU, GC pause, scheduler latency
   (`runtime/trace`). State the crossover.
3. **Framing / partial-read correctness.** Adversarial client sending one byte
   per `write` with `TCP_NODELAY` on; then 10 frames in one `write`. Prove
   identical decode. Then a frame claiming `length > maxFrame` is rejected
   pre-alloc.
4. **Nagle on/off latency.** `TCP_NODELAY` true vs false on 64 B request/response.
   Measure p50/p99 RTT and frames/s. Show the ~40 ms delayed-ACK + Nagle
   interaction on small writes, and the throughput cost of disabling it.
5. **Buffer-pool alloc win.** `-pool=false` vs `-pool=true`. Report allocs/op,
   GC CPU %, and p99 under load. Target 0 allocs/op steady-state; show the heap
   profile before/after.
6. **Zero-copy.** `SINK`/`STREAM` of a 1 GB payload via naive `io.Copy` vs the
   `sendfile`/`splice` fast path (file→socket). Compare throughput, CPU, and
   copies (confirm with `strace`/`perf`).
7. **Slow-consumer backpressure.** A client that reads 1 KB/s while you push
   1 GB/s. With an unbounded write buffer, watch RSS climb (and the OOM). With a
   bounded write queue + deadline, show the slow peer is dropped and other
   connections are unaffected. Measure `write_queue_drops_total`.
8. **fd & ephemeral-port exhaustion.** Drive conns past `ulimit -n` (watch
   `accept: too many open files`) and past a single client IP's
   `ip_local_port_range` (~28k) into `EADDRNOTAVAIL`. Fix with raised rlimits,
   multiple source IPs, and `tcp_tw_reuse`; show `TIME_WAIT` accumulation in `ss`.
9. **Accept lock vs `SO_REUSEPORT`.** Single `Accept()` loop vs N acceptors
   each with `SO_REUSEPORT`. Measure new-conns/s ceiling and CPU distribution
   across cores; report the multiplier and the lock you removed.
10. **TCP buffer sizing.** Sweep `SO_RCVBUF`/`SO_SNDBUF`; show the
    bandwidth-delay-product effect on large-transfer throughput over a link with
    real RTT, and the memory cost at 1M conns.

## 11. Milestones

1. Raw-socket framed echo server (Stage 0) + adversarial framing test; load
   client with HdrHistogram; Prometheus + pprof wired.
2. Large-payload `STREAM`/`SINK` path; buffer pooling to 0 allocs/op; zero-copy
   fast path (Stage 1).
3. 100k-conn run; `SO_REUSEPORT` multi-acceptor; goroutine-vs-epoll memory &
   throughput comparison (Stage 2, experiments 1–2, 9).
4. Backpressure + slow-consumer handling; fd/port-exhaustion investigation;
   graceful drain (experiments 7–8).
5. 1M-conn C10M-class run holding the p99/throughput SLO with the binding
   constraint named and proven (Stage 3); findings note.

## 12. Acceptance criteria (definition of done)

- [ ] Framed server passes the adversarial decoder test (1-byte writes and
      coalesced frames decode identically); oversized frames rejected pre-alloc.
- [ ] **≥ 1,000,000** concurrent connections held on one box; **bytes/conn**
      reported with the heap profile that proves it.
- [ ] Single-acceptor accept-rate ceiling reported, then beaten **≥ 3×** with
      `SO_REUSEPORT`; the removed contention explained.
- [ ] Large-payload streaming at **≥ 90% line rate**; zero-copy vs naive-copy
      numbers shown.
- [ ] Hot path at **0 allocs/op** steady-state (benchmem + heap profile).
- [ ] Goroutine-per-conn vs epoll compared on **both** memory and throughput,
      with the crossover stated and defended.
- [ ] Slow-consumer test: bounded write queue protects the process; slow peer
      dropped, others unaffected.
- [ ] Stage-3 run holds **p99 < 5 ms** + throughput SLO with the binding
      constraint **named and proven** (pprof / `perf` / NIC counters).
- [ ] Every number reproducible from a committed command + config + host-tuning
      record (`ulimit`, sysctls, kernel/Go versions).

## 13. Stretch goals

- **`io_uring`** backend (via `github.com/iceber/iouring-go` or cgo
  liburing): completion-based I/O, batched submission; compare syscall count and
  throughput vs epoll at high RPS.
- **`SO_REUSEPORT` + eBPF** custom socket-distribution to pin connections to the
  NIC-RSS / NUMA-local core; measure cross-socket cache-miss reduction.
- **Multi-NIC / RSS** scaling: spread accept + I/O across queues; show per-core
  throughput and the NUMA effect.
- A real **WebSocket** upgrade layer on top to feed
  `senior/04-realtime-chat-presence/`.
- **`TCP_CORK`/`writev` batching** for the small-message path; quantify the
  syscall-rate reduction vs added latency.

## 14. Evaluation rubric

| Dimension | Senior bar | Staff bar |
|-----------|-----------|-----------|
| Framing correctness | Length-prefix decoder works in normal traffic | Proven correct against adversarial fragmentation + coalescing; oversize guarded pre-alloc |
| Memory per connection | Reports bytes/conn | Drives it down, holds 1M conns, and **names** what each KB is (stack vs buffers vs bufio) |
| Accept scaling | Knows a single accept loop is a ceiling | Measures it, removes it with `SO_REUSEPORT`, reports the multiplier and the lock |
| Engine choice | Tries goroutine-per-conn and epoll | **Proves** the crossover; states when goroutine-per-conn stops scaling and why |
| Throughput | Reports a number | Saturates the NIC or names the proven bound (syscall/GC/copy) below it |
| Allocations / GC | Notices allocs hurt | 0 allocs/op on the hot path; quantifies GC CPU/pause before/after |
| Backpressure | Adds deadlines | Bounded write queue; proves one slow peer can't take the process down |
| Bottleneck analysis | Identifies a likely cause | **Names and proves** the binding constraint at *each* scale (memory→accept→syscall/GC→NIC) |
| Communication | Clear findings note | Could defend every curve — and the C10M wall — to a staff panel |

## 15. References

- D. Kegel, **"The C10K Problem"** (1999) — the original
  one-machine-many-connections framing.
- **"The C10M Problem"** (R. Graham, Shmoocon 2013) — why the kernel itself
  becomes the bottleneck; kernel-bypass framing.
- W. R. Stevens, *UNIX Network Programming, Vol. 1* — sockets, `SO_REUSEPORT`,
  listen backlog/SYN queue, `TCP_NODELAY`/Nagle, keepalive.
- Linux man pages: `tcp(7)`, `socket(7)`, `epoll(7)`, `sendfile(2)`,
  `splice(2)`, `accept(2)` (and `EMFILE`).
- Go: `net` netpoller internals (`runtime/netpoll.go`), `golang.org/x/sys/unix`
  `setsockopt`; `panjf2000/gnet`, `tidwall/evio` event-loop engines.
- Cloudflare / LWW engineering: `SO_REUSEPORT` load distribution; "Why does one
  NGINX worker take all the load?"
- See also: `senior/04-realtime-chat-presence/` (WebSockets atop this
  transport), `load-testing/05-go-memory-and-zero-allocation/` (hot-path alloc
  reduction).
- Interview theory: `Interview Question/09-networking-fundamentals/`,
  `Interview Question/02-concurrency/`,
  `Interview Question/17-performance-engineering/`.
