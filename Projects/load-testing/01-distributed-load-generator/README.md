# Distributed Load Generator (k6/vegeta-class, in Go)

> Build a load generator, and in doing so learn why most load tests *lie*. The
> bug is rarely in the target — it's in the client: closed-loop concurrency that
> can't push true load, a stalled request that quietly hides 50 ms of latency,
> and an "average of averages" that erases your tail. Generate sustained high RPS
> from one node, coordinate several, record full distributions, and find a
> service's *real* p99/p999.

| | |
|---|---|
| **Tier** | Load-testing (meta-skill) |
| **Primary domain** | Performance-testing craft |
| **Skills exercised** | Open vs closed load models, arrival-rate / Poisson pacing, coordinated omission, HdrHistogram / t-digest, connection reuse, token-bucket rate control, distributed result merge, Go (`net/http`, goroutines, `golang.org/x/time/rate`) |
| **Interview sections** | 17 (performance engineering), 22 (scalability), 9 (networking) |
| **Est. effort** | 3–5 focused days |

---

## 1. Context

Your team just shipped a service and someone "load tested" it: they ran a tool
with `-c 100` (100 concurrent workers in a loop), watched it report a p99 of
18 ms, and declared the SLO met. In production the same endpoint shows a p99 of
210 ms under the *same* aggregate request rate. The tool didn't lie about the
numbers it computed — it lied about *what it measured*. A closed-loop client with
100 workers can never offer more than 100 in-flight requests, so when the server
slows down, the client simply slows down with it and **never records the latency
that a real, indifferent stream of users would experience.**

You're going to build the tool you wish you'd had: a load generator that drives
load by **arrival rate** (an open model), records the **full latency
distribution** rather than a mean, **corrects for coordinated omission**, and can
**coordinate multiple agents** to push load beyond a single node's ceiling. Then
you'll point it at a sample service and report a p99 you can defend.

You will produce numbers, and — more importantly — you'll be able to explain why
the *other* tool's numbers were wrong.

## 2. Goals / Non-goals

**Goals**
- Implement both load models — **closed** (fixed concurrency) and **open**
  (target arrival rate, Poisson inter-arrival) — and show they measure different
  things against the same target.
- Record **full latency distributions** with an HdrHistogram, not a running mean;
  report p50/p90/p99/p999/max with bounded error.
- Detect and **correct coordinated omission**, and report both the naive and
  corrected p99.
- Find the **single-agent throughput ceiling** (where the *generator* saturates,
  not the target) and prove what bounds it.
- **Coordinate ≥ 3 agents** to a controller, merge their histograms correctly,
  and report a single aggregate distribution.

**Non-goals**
- Building a browser-driving / scripting tool (this is HTTP-level load, not
  Selenium). Protocol-level only.
- A pretty TUI or web dashboard — a correct CSV/JSON report beats a chart here.
- Reimplementing HTTP/2 or QUIC from scratch — use `net/http`; you may *test*
  h2, but the focus is the load model, not the transport.

## 3. Functional requirements

1. A **load agent** (`cmd/agent`) issues HTTP requests against a target URL under
   one of two models, selected by flag:
   - `closed` — N goroutines, each looping request→wait-for-response→request.
   - `open` — a target arrival rate λ (req/s); requests are *scheduled* at λ
     regardless of whether prior requests have returned, using a token-bucket /
     Poisson scheduler. In-flight count is unbounded (or bounded only by a stated
     ceiling you record).
2. Each agent records **every** request's latency into an **HdrHistogram**
   (`codahale/hdrhistogram-go`), tagged with start-time, send-time, and
   receive-time so coordinated-omission correction is possible after the fact.
3. The agent supports **connection reuse on/off**: a shared `http.Transport` with
   keep-alive and tuned `MaxIdleConnsPerHost`, vs a fresh connection per request.
4. A **controller** (`cmd/controller`) starts a synchronized run across ≥ 3
   agents, collects each agent's serialized histogram, and **merges** them into a
   single distribution (histogram add, *not* averaging percentiles).
5. A **sample target** (`cmd/target`) is provided: a Go service with a tunable,
   *injectable* latency profile (e.g. base 5 ms + a configurable tail — 1% of
   requests sleep 50 ms) so the experiments have a known ground truth.
6. The report (`-out report.json`) contains the run config, per-agent and merged
   histograms, and both naive and CO-corrected percentiles.

## 4. Load & data profile

- **Target throughput:** drive a sustained **≥ 50,000 req/s** aggregate against
  the sample target across agents; single-agent runs at **≥ 20,000 req/s**
  (numbers to *find and beat*, not gospel — report your real ceiling).
- **Run shape:** explicit **warm-up** (≥ 30 s, discarded from the histogram) then
  **steady state** (≥ 2 min recorded). Never report warm-up samples.
- **Request mix:** a single GET endpoint with a known injected latency
  distribution; payloads small (≤ 1 KB) so you measure latency, not bandwidth.
- **Ground-truth tail:** the target's injected profile is *known* (e.g. p50 5 ms,
  p99 ≈ 50 ms by construction) so you can check whether each load model
  *recovers* the true tail.
- **Determinism:** the open-model scheduler is seeded so Poisson arrivals are
  reproducible given a seed and λ.

## 5. Non-functional requirements / SLOs (generator capability)

| Metric | Target |
|--------|--------|
| Max sustained RPS / agent | Find & report the ceiling; **name the bound** (goroutine scheduling? `net/http` connection pool? GC? local CPU? ephemeral-port/`TIME_WAIT` exhaustion?) |
| Open-model rate accuracy | Achieved λ within **±2%** of target λ at steady state, *and* not silently degrading when the target stalls (back-pressure must surface as a recorded error, not as a hidden slowdown) |
| Histogram accuracy | HdrHistogram with **3 significant figures**; reported p99 within **±1%** of an offline exact-quantile computed from a recorded raw-latency sample |
| Coordinated-omission correction | Corrected p99 must move *toward* the known ground-truth tail; report the delta (naive vs corrected) |
| Merge correctness | Merged-across-agents p99 equals the p99 of the pooled raw samples within **±1%** (proves histogram-add ≠ average-of-averages) |
| Generator overhead | < 5% of measured latency attributable to the client; prove it (loopback / null-target calibration run) |

> The point is not the magic 50k number — it's to **find** your generator's
> ceiling, **prove** the target's number isn't your own client's bottleneck, and
> **report a tail you can defend.**

## 6. Architecture constraints & guidance

- Pure Go, `net/http` client. One shared `http.Transport` per agent in keep-alive
  mode; tune `MaxIdleConnsPerHost`, `MaxConnsPerHost`, and set explicit
  `DialContext`/timeouts. Do **not** create an `http.Client` per request.
- Open-model scheduler: drive sends off a ticker / token bucket
  (`golang.org/x/time/rate`) or an explicit Poisson inter-arrival generator;
  *decouple* request scheduling from response handling — a slow response must not
  delay the next scheduled send.
- Use a **bounded** worker pool for the open model with an explicit in-flight cap;
  when the cap is hit, that is a *recorded* event (the generator is saturating or
  the target is stalling), never a silent stall.
- Latency capture: record **intended send time** (when the request *should* have
  gone out per the schedule), **actual send time**, and **receive time**. The gap
  between intended and actual is what makes coordinated-omission correction
  possible.
- Controller↔agent: a simple gRPC or HTTP control plane — `Start(config)`,
  `Stop()`, `Collect() → serialized HdrHistogram`. Time-sync the run start so
  windows overlap.
- Reference designs: **vegeta** (open-model, constant arrival rate, by Tomás
  Senart) and **k6** (which exposes both VU/closed and arrival-rate/open
  executors). Read how they pace and how they aggregate before you build.

## 7. Data model

```
sample:   { intended_ns int64, sent_ns int64, recv_ns int64, status int, err string }
           latency = recv_ns - sent_ns                      // what naive tools record
           service_time_corrected = recv_ns - intended_ns   // CO-corrected latency

per-agent: HdrHistogram(min=1µs, max=60s, sigfigs=3)         // mergeable, lossless tails
report:    { config, per_agent:[hist...], merged: hist,
             naive: {p50,p99,p999,max}, corrected: {p50,p99,p999,max} }
```
Histograms are stored, not summarized: a 3-sig-fig HdrHistogram over [1µs, 60s]
is a few KB and **adds** losslessly across agents — that property is the whole
reason you don't ship percentiles over the wire.

## 8. Interface contract

- `cmd/agent -model {open|closed} -rate λ -conns N -target URL -keepalive {on|off} -duration 2m -warmup 30s -out agent.hdr`
- `cmd/controller -agents host1,host2,host3 -model open -rate 50000 -duration 2m -out report.json`
- `cmd/target -base-latency 5ms -tail-fraction 0.01 -tail-latency 50ms -listen :8080`
- Control plane (per agent): `Start(RunConfig)`, `Stop()`, `Collect() → bytes`
  (serialized HdrHistogram + raw-sample sidecar for verification runs).
- Report JSON includes naive **and** corrected percentiles, per-agent and merged.

## 9. Key technical challenges

- **Coordinated omission.** When a request stalls, a closed-loop client stops
  issuing new requests, so the *long* latencies that *would* have been measured
  during the stall are never recorded — the tail is silently erased. Gil Tene's
  framing: you must record latency against the *intended* schedule, not the
  *actual* send time, or back-fill the omitted samples. This is the single most
  important idea in the lab.
- **Open vs closed measure different physics.** Closed-loop measures
  *throughput-limited round-trip time at fixed concurrency*; open-loop measures
  *response time under an externally fixed arrival rate*. Little's Law connects
  them (L = λW), but they answer different questions and will report different
  p99s against the *same* server.
- **Not measuring your own client.** A generator that GCs, runs out of goroutines,
  or exhausts ephemeral ports will report *its own* latency as the target's. You
  must calibrate (null/loopback target) and find the ceiling before trusting any
  target number.
- **Merging distributions.** `avg(p99_a, p99_b)` is meaningless. You must add the
  histograms and re-read the percentile. Proving this difference numerically is an
  acceptance gate.
- **Rate fidelity under stress.** A token-bucket pacer that "catches up" by
  bursting after a stall distorts the arrival process; a pacer that drops ticks
  silently under-loads. Decide and measure.

## 10. Experiments to run (break it / tune it)

Record before/after numbers and a one-line conclusion for each:

1. **Open vs closed, same target.** Run `closed -conns 100` and `open` tuned to
   the *same* achieved RPS against the same sample target. Report both p99s. The
   open model should reveal a higher, truer p99 — explain the gap via coordinated
   omission.
2. **Coordinated omission, demonstrated.** With the target injecting a periodic
   50 ms stall, record naive latency (recv − sent) vs corrected latency
   (recv − intended). Show the naive p99 hides the stall and the corrected p99
   recovers it; report both numbers and the delta.
3. **Single-agent throughput ceiling.** Ramp λ until *achieved* RPS plateaus
   while *intended* RPS keeps rising. Find where the **generator** saturates and
   **prove the bound** (pprof CPU profile, goroutine count, `netstat` for
   `TIME_WAIT`/ephemeral ports, GC pause). This is the "am I measuring myself?"
   number.
4. **Scale to multiple agents.** Add agents 1 → 3 → N at fixed per-agent rate.
   Show aggregate RPS scales (near-)linearly until the *target* becomes the bound,
   and identify which side is now limiting.
5. **Keep-alive vs new-connection-per-request.** Same λ, `-keepalive on` vs
   `off`. Measure RPS ceiling, p99, ephemeral-port usage, and connection-setup
   overhead. Quantify how much "load" disappears into TCP/TLS handshakes when you
   don't reuse connections.
6. **Histogram merge vs average-of-averages.** Merge 3 agents' histograms and read
   the p99; separately compute `mean(p99_i)`. Show the two diverge, and that the
   merged value matches the pooled-raw-sample p99 within ±1%.
7. **Warm-up sensitivity.** Report p99 *including* vs *excluding* the warm-up
   window (cold connection pool, cold JIT-less but cold caches/GC on the target).
   Show how much warm-up samples inflate the tail.

## 11. Milestones

1. `cmd/target` with injectable latency; `cmd/agent` closed model with a shared
   keep-alive transport; HdrHistogram capture; first p99 report.
2. Open model: token-bucket / Poisson scheduler decoupled from response handling;
   intended/sent/recv timestamps recorded.
3. Coordinated-omission correction; experiments 1–2 (open vs closed, CO demo).
4. Single-agent ceiling characterization with proof of bound (experiment 3).
5. Controller + multi-agent merge; experiments 4–6; findings note.

## 12. Acceptance criteria (definition of done)

- [ ] Open and closed models both implemented; experiment 1 reports two distinct
      p99s for the same target with an explanation.
- [ ] Coordinated-omission correction implemented; experiment 2 shows naive vs
      corrected p99 against a *known* injected tail, and the corrected number
      moves toward ground truth.
- [ ] Single-agent ceiling reported **with the bottleneck named and proven**
      (pprof / `netstat` / GC evidence attached).
- [ ] ≥ 3 agents coordinated by the controller; merged p99 matches pooled-raw p99
      within ±1% (show the diff vs `avg(p99_i)`).
- [ ] Keep-alive on/off effect quantified (RPS, p99, port usage).
- [ ] Generator-overhead calibration run proves < 5% client contribution.
- [ ] Every number reproducible from a committed command + config + seed.

## 13. Stretch goals

- **t-digest** alternative to HdrHistogram; compare tail accuracy and merge cost
  for the same runs.
- **Latency-vs-throughput curve** ("hockey stick"): sweep λ and plot p99 vs
  achieved RPS to find the target's knee — the open model's signature output.
- **Adaptive open model**: ramp λ automatically until p99 crosses an SLO, then
  report max sustainable RPS at that SLO.
- **Multi-target / weighted routes** (vegeta-style targets file) and per-route
  histograms.
- **HTTP/2 vs HTTP/1.1 keep-alive**: how multiplexing changes the in-flight model
  and the ceiling.

## 14. Evaluation rubric

| Dimension | Senior bar | Staff bar |
|-----------|-----------|-----------|
| Load models | Implements open and closed; knows they differ | Explains *why* via Little's Law; picks the right model per question and defends it |
| Coordinated omission | Has heard of it; applies a correction | **Understands it deeply** — can derive why a closed client erases the tail, implements correction, and shows it recovers a known ground-truth tail |
| Tail measurement | Reports p99 from a histogram, not a mean | Reports p999/max with bounded error; explains HdrHistogram bucketing and why averaging percentiles is wrong |
| Generator ceiling | Finds a max RPS | Proves what bounds it and shows the target number isn't the client's bottleneck |
| Distributed merge | Merges histograms instead of averaging | Proves merge correctness vs pooled raw samples; explains the mergeability property |
| Communication | Clear findings note | Could defend every percentile to a staff panel and debunk a colleague's lying load test |

## 15. References

- Gil Tene — **"How NOT to Measure Latency"** (the canonical talk on
  *coordinated omission*); his `wrk2` and HdrHistogram work.
- **HdrHistogram** — `codahale/hdrhistogram-go`; the original by Gil Tene.
- **vegeta** (Tomás Senart) — constant-arrival-rate / open-model HTTP load tool.
- **k6** — open (arrival-rate) vs closed (VU) executors; read their executor docs.
- Go: `net/http`, `http.Transport` tuning, `golang.org/x/time/rate`.
- Little's Law (L = λW) for connecting concurrency, arrival rate, and latency.
- See also: `Interview Question/17-performance-engineering/` (latency
  percentiles, tail latency, open vs closed systems).
