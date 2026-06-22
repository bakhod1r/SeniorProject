# Continuous Profiling — Middle Level

> **Topic:** [Continuous Profiling Roadmap](README.md)
> **Focus:** Standing up the *continuous pipeline* — collect → store time-indexed → query over time. Running Pyroscope and Parca locally. Pushing profiles from a Go/Python app and scraping pprof endpoints like Prometheus scrapes metrics. The pprof format as the lingua franca. Querying profiles by label and time window. Introducing diff flame graphs and the tooling landscape.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [The pprof Format — the Lingua Franca](#the-pprof-format--the-lingua-franca)
6. [The Continuous Pipeline](#the-continuous-pipeline)
7. [Push vs Scrape](#push-vs-scrape)
8. [Running Pyroscope Locally](#running-pyroscope-locally)
9. [Running Parca Locally](#running-parca-locally)
10. [Code Examples](#code-examples)
11. [Language SDKs in Depth](#language-sdks-in-depth)
12. [Querying Time-Indexed Profiles](#querying-time-indexed-profiles)
13. [Labels — Profiles Become Queryable](#labels--profiles-become-queryable)
14. [Differential Flame Graphs — First Contact](#differential-flame-graphs--first-contact)
15. [The Workflow — Spike to Flame Graph](#the-workflow--spike-to-flame-graph)
16. [Tooling Landscape](#tooling-landscape)
17. [Use Cases](#use-cases)
18. [Coding Patterns](#coding-patterns)
19. [Best Practices](#best-practices)
20. [Edge Cases & Pitfalls](#edge-cases--pitfalls)
21. [Common Mistakes](#common-mistakes)
22. [Tricky Points](#tricky-points)
23. [Test Yourself](#test-yourself)
24. [Cheat Sheet](#cheat-sheet)
25. [Summary](#summary)
26. [What You Can Build](#what-you-can-build)
27. [Further Reading](#further-reading)
28. [Related Topics](#related-topics)
29. [Diagrams & Visual Aids](#diagrams--visual-aids)

---

## Introduction

> Focus: **At junior level you collected one profile by hand. Now you build the pipeline that collects them forever — and makes them queryable like metrics.**

At junior level you ran `go tool pprof` against `/debug/pprof/profile?seconds=30`, stared at a flame graph, and closed the tab. That's a *point-in-time* profile: one window, one process, gone when you walk away. The whole premise of *continuous* profiling is that the profile must survive — stored, time-indexed, labelled — so that when p99 spikes at 14:32 you query history instead of trying (and failing) to reproduce it. This level is about building that pipeline.

The mental shift is exact and worth saying plainly: **profiles become queryable like metrics.** A metric is a number over time you slice by labels (`service`, `version`, `region`). A continuous profile is a *flame graph over time* you slice by the same labels. "Show me CPU by function for `checkout` in `eu-west`, version `v2.4.1`, between 14:30 and 14:35" is now a query, not an expedition. Two systems make this real and run locally in Docker: **Pyroscope** (Grafana's profiling database, SDK-push first) and **Parca** (Polar Signals' profiler, scrape-first — it pulls pprof endpoints the way Prometheus pulls `/metrics`).

This page covers the **pprof protobuf format** that everything speaks, the two ingestion models (push via SDK vs scrape via agent), continuous SDKs for Go/JVM/Python/Node/Rust, querying by time and label, and a first look at **differential flame graphs** (the killer feature — kept deep for [`senior.md`](senior.md)). It closes with the tooling landscape and the emerging OpenTelemetry profiling signal. Whole-system eBPF profiling gets a mention here and the full treatment in [`professional.md`](professional.md).

> 🎓 **Why this matters at middle level:** A junior can *read* a flame graph. A middle engineer can *stand up the system* that has the right flame graph already waiting when the incident hits — labelled by service and version, queryable by time, diffable against last week's deploy. That pipeline is the difference between "let me try to reproduce it" and "here's the line, at 14:32, in prod."

---

## Prerequisites

- **Required:** All of [`junior.md`](junior.md) — profile types, sampling, and reading a flame graph (width = samples, *not* time order).
- **Required:** You can run a small HTTP service in Go or Python and add an import/middleware to it.
- **Required:** Docker and `docker compose` installed — every backend here runs as a container.
- **Helpful:** You've scraped a Prometheus target, or at least seen a `scrape_configs:` block. Parca reuses that exact mental model.
- **Helpful:** The labels/cardinality intuition from [`../metrics/middle.md`](../metrics/middle.md) — profile series carry labels too, and the same cardinality discipline applies.

---

## Glossary

| Term | Definition |
|------|-----------|
| **pprof format** | The protobuf-encoded profile format (`profile.proto`) that originated in Go and became the industry's interchange standard. A `.pb.gz` blob describing samples, locations, functions, and value types. |
| **Profile series** | A stream of profiles over time sharing a label set — the profiling analogue of a metric time series. |
| **Ingestion model** | How profiles reach the backend: **push** (the app/SDK sends them) or **scrape** (the backend pulls a pprof endpoint). |
| **Pyroscope** | Grafana's continuous-profiling database. Push-first (language SDKs), Grafana-native UI, also supports scrape and eBPF. |
| **Parca** | Polar Signals' continuous profiler. Scrape-first — `parca-agent` and the server pull pprof endpoints like Prometheus. |
| **Scrape config** | YAML telling the agent which targets to pull, how often, and which profile types — mirrors Prometheus `scrape_configs`. |
| **Profile type / sample type** | What a profile measures: `cpu`, `alloc_space`, `inuse_space`, `goroutines`, `mutex`, `block` — encoded in the pprof value types. |
| **Differential / diff flame graph** | A flame graph coloring the *difference* between two profiles (two time windows, or two versions): red = got worse, green = got better. |
| **OTel profiling signal** | OpenTelemetry's profiling specification — the emerging vendor-neutral standard, fourth signal alongside logs/metrics/traces. |
| **eBPF profiling** | Kernel-level sampling that profiles *any* process — any language, no instrumentation. `parca-agent`, Pyroscope eBPF. |
| **Symbolization** | Turning raw addresses into `package.Function` names. Can happen at collect time (Go) or backend time (eBPF/native). |
| **Retention** | How long profiles are kept before downsampling/deletion. Profiles are bulky; retention is a cost lever. |

---

## Core Concepts

### 1. The pprof format is the contract everything speaks

Go's `runtime/pprof` emits a protobuf profile. py-spy, async-profiler, `pprof-rs`, Pyroscope, Parca, Datadog, and the OTel profiling signal all read or write it. Because the *format* is shared, the collectors and the backends are decoupled — you can scrape a Go service's pprof endpoint into Parca, or push a Python profile into Pyroscope, and the flame graph renders the same way. Learn the format once and the whole ecosystem opens up.

### 2. Continuous profiling = a profiling *database*, not a profiler

The novelty is not the profiler — it's the same cheap sampler from junior level. The novelty is the **store**: a time-series database for profiles. It ingests a profile every N seconds per process, indexes it by labels and timestamp, and lets you query "the CPU flame graph for `service=checkout` over the last hour." Pyroscope and Parca *are* those databases.

### 3. Two ways in: push or scrape

Either the app **pushes** profiles to the backend (Pyroscope's default — an SDK in your process ships profiles on a timer), or the backend **scrapes** a pprof HTTP endpoint your app exposes (Parca's default — exactly like Prometheus pulling `/metrics`). Same destination, opposite direction. The choice mirrors the pull-vs-push trade-off you met in metrics.

### 4. Labels turn a pile of profiles into a queryable signal

A raw profile is anonymous. Attach labels — `service`, `version`, `env`, `region`, `pod` — and now you can select *exactly* the profiles you want: one service, one version, one time window. This is the move that makes profiles "queryable like metrics." The same cardinality discipline applies: bounded labels (service, version, region), never identities (request ID, user ID).

### 5. The flame graph is still aggregate, still statistical

Even time-indexed, a flame graph for a window is the *aggregate* of all samples in that window: width = total samples, **not** chronological order. Continuous profiling is still sampling-based and statistical — a one-minute window has far more samples (and far less noise) than a one-second window, but it's an estimate, not a recording. The pipeline changes *where the data lives*, not *what a flame graph means*.

---

## The pprof Format — the Lingua Franca

A pprof profile is a protobuf message (`profile.proto`) — gzip-compressed on the wire as `.pb.gz`. Its core structure:

```text
Profile
 ├─ sample_type[]   what each sample value MEANS: {"cpu","nanoseconds"}, {"alloc_space","bytes"}
 ├─ sample[]        the data: each = a stack (location ids) + value[] (e.g. 30_000_000 ns)
 ├─ location[]      a program counter → which function + line
 ├─ function[]      name, filename, start line  (the symbolized identity)
 └─ string_table[]  deduped strings everything references by index
```

The reason this matters operationally: **one format, many producers and consumers.** Anything that can emit pprof can be stored and rendered by anything that reads pprof.

```bash
# Inspect any pprof file with the standard Go tool — works on profiles from ANY producer
go tool pprof -top    profile.pb.gz      # top functions by self value
go tool pprof -tree   profile.pb.gz      # call tree
go tool pprof -http=:8080 profile.pb.gz  # interactive flame graph in the browser

# A pprof profile is just protobuf+gzip; you can convert/merge them
go tool pprof -proto -output merged.pb.gz a.pb.gz b.pb.gz
```

A profile can carry **multiple sample types** at once — a single Go heap profile holds `alloc_objects`, `alloc_space`, `inuse_objects`, `inuse_space`. The UI lets you pick which value to render. This is why "the heap profile" is really four flame graphs in one blob.

> The OpenTelemetry profiling signal standardises a profile representation closely modelled on pprof, so this format knowledge transfers directly to the vendor-neutral future.

---

## The Continuous Pipeline

Three stages, mirroring the metrics pipeline you already know:

```text
   COLLECT                 STORE (time-indexed)            QUERY
   ───────                 ────────────────────            ─────
   SDK push  ─┐                                       ┌─ "CPU by function,
   (in-proc)  ├──► pprof ──► profiling DB ──► index ──┤   service=checkout,
   scrape    ─┘   blobs      (Pyroscope/        by    │   14:30–14:35"
   (agent)                    Parca)         {labels, └─ diff v2.4.0 vs v2.4.1
                                              time}
```

1. **Collect.** Either an in-process SDK samples and pushes, or an agent/server scrapes a pprof endpoint. Default cadence: a profile every 10–15 seconds per process.
2. **Store, time-indexed and labelled.** The backend writes each profile against `{label set, timestamp}` — the profiling equivalent of a metric series.
3. **Query.** Select by label and time window; the backend merges all matching profiles into one aggregate flame graph, or diffs two selections.

The shape is deliberately identical to metrics so the operational muscle memory carries over: collect cheaply, store time-indexed, query by label and window.

---

## Push vs Scrape

| | **Push (SDK)** | **Scrape (agent/server)** |
|---|---|---|
| Who initiates | Your process sends profiles on a timer | The backend pulls a pprof endpoint every N s |
| Canonical tool | Pyroscope SDKs | Parca (and `parca-agent`) |
| Setup | Add a library + a few lines of code | Expose `/debug/pprof/*`, add a scrape target |
| Good for | Serverless, short jobs, environments you can't scrape | Long-lived services you already discover (k8s, Consul) |
| Service discovery | App needs the backend URL | Backend needs to find targets (k8s SD, file SD) |
| "Is it up?" | Needs a heartbeat | A failed scrape is itself a signal |
| Mirrors | StatsD / OTLP push | Prometheus scrape |

The takeaway echoes metrics: **scrape long-lived services you already discover; push from ephemeral or unreachable ones.** Many shops run both — Parca scraping the fleet, plus SDK push from Lambdas and batch jobs. The pprof format makes that heterogeneity invisible at query time.

---

## Running Pyroscope Locally

Pyroscope ingests profiles (push-first) and ships a UI. The minimal stack:

```yaml
# docker-compose.yml — Pyroscope + Grafana
services:
  pyroscope:
    image: grafana/pyroscope:latest
    ports:
      - "4040:4040"        # ingest API + native UI
    command: ["server"]

  grafana:
    image: grafana/grafana:latest
    ports:
      - "3000:3000"
    environment:
      GF_INSTALL_PLUGINS: grafana-pyroscope-app
```

```bash
docker compose up -d
# Native UI at  http://localhost:4040
# Grafana at    http://localhost:3000  (add a Pyroscope data source → http://pyroscope:4040)
```

Pyroscope's flame-graph explorer lets you pick a profile type (`process_cpu`, `memory:alloc_space`, …), a label selector, and a time range — that's the "queryable like metrics" experience out of the box.

---

## Running Parca Locally

Parca is **scrape-first**: it pulls pprof endpoints on a schedule defined in YAML that looks just like Prometheus.

```yaml
# parca.yaml — scrape a Go service's pprof endpoints
object_storage:
  bucket:
    type: "FILESYSTEM"
    config:
      directory: "./data"

scrape_configs:
  - job_name: "my-go-app"
    scrape_interval: "15s"
    static_configs:
      - targets: ["host.docker.internal:6060"]   # your app's pprof port
    profiling_config:
      pprof_config:
        cpu:     { enabled: true }   # /debug/pprof/profile
        memory:  { enabled: true }   # /debug/pprof/allocs
        goroutine: { enabled: true } # /debug/pprof/goroutine
```

```yaml
# docker-compose.yml — Parca server
services:
  parca:
    image: ghcr.io/parca-dev/parca:latest
    command: ["/parca", "--config-path=/etc/parca/parca.yaml"]
    ports:
      - "7070:7070"            # UI + API
    volumes:
      - ./parca.yaml:/etc/parca/parca.yaml
      - ./data:/data
```

```bash
docker compose up -d
# Parca UI at http://localhost:7070 — select a profile type + time range to render
```

Parca relabels and discovers targets exactly like Prometheus, so a team already running Prometheus can profile the fleet with a near-identical config. `parca-agent` (the eBPF variant) needs *no* pprof endpoint at all — covered in [`professional.md`](professional.md).

---

## Code Examples

### Go — continuous push to Pyroscope via `pyroscope-go`

```go
package main

import (
    "runtime"

    "github.com/grafana/pyroscope-go"
)

func main() {
    // Mutex/block profiles are off by default — enable them to push.
    runtime.SetMutexProfileFraction(5)
    runtime.SetBlockProfileRate(5)

    pyroscope.Start(pyroscope.Config{
        ApplicationName: "checkout.service",
        ServerAddress:   "http://localhost:4040",
        // Bounded labels — these become your query dimensions.
        Tags: map[string]string{
            "version": "v2.4.1",
            "env":     "prod",
            "region":  "eu-west-1",
        },
        ProfileTypes: []pyroscope.ProfileType{
            pyroscope.ProfileCPU,
            pyroscope.ProfileAllocSpace,
            pyroscope.ProfileInuseSpace,
            pyroscope.ProfileGoroutines,
            pyroscope.ProfileMutexDuration,
            pyroscope.ProfileBlockDuration,
        },
    })

    // ... run your real server; the SDK samples and pushes on a timer ...
    select {}
}
```

The SDK runs the *same* `runtime/pprof` sampler from junior level on a loop and ships each profile to Pyroscope, tagged with `version`/`env`/`region`. Those tags are exactly what you'll select on at query time.

### Go — exposing pprof for Parca to scrape (no SDK)

```go
package main

import (
    "net/http"
    _ "net/http/pprof" // registers /debug/pprof/* — Parca scrapes these
)

func main() {
    // Bind to an internal port; Parca pulls profile/allocs/goroutine from here.
    go http.ListenAndServe("0.0.0.0:6060", nil)
    select {}
}
```

No client library — the *server* (Parca) does the work, exactly as Prometheus scrapes `/metrics`. Per-process labels come from the scrape config / service discovery, not the code.

### Python — py-spy + Pyroscope SDK

```python
import pyroscope

pyroscope.configure(
    application_name="ingest.worker",
    server_address="http://localhost:4040",
    tags={"version": "1.8.0", "env": "prod"},   # bounded query dimensions
)
# The SDK samples this process continuously and pushes CPU profiles.
# (py-spy is the underlying sampling engine; here it runs in-process.)
```

```bash
# Or, with ZERO code changes, run py-spy as a continuous pusher by PID:
py-spy record --pid 12345 --duration 0 --rate 100 \
  --format pprof --output /dev/stdout | curl ... # ship to the backend
# (Pyroscope also ships a py-spy-based agent that attaches by PID and pushes.)
```

### Java/JVM — continuous JFR and async-profiler

```bash
# Java Flight Recorder — built-in, low overhead, designed to run continuously.
# Start a recording at JVM launch that rolls a 1-hour window to disk:
java -XX:StartFlightRecording=name=cont,maxage=1h,maxsize=200m,settings=profile \
     -jar app.jar
# Dump the live recording at any time without stopping the app:
jcmd <pid> JFR.dump name=cont filename=snapshot.jfr
```

```bash
# async-profiler in CONTINUOUS mode — loop chunks to timestamped files (or a backend):
./asprof -e cpu --loop 1m -f profile-%t.jfr <pid>
#   --loop 1m  → emit one profile per minute, forever
#   Pyroscope's Java agent wraps async-profiler and pushes these continuously.
```

JFR and async-profiler are *designed* for always-on use; the Pyroscope Java agent simply pushes their output on a timer.

### Node — continuous CPU profiles

```bash
# Built-in V8 profiler (one-shot, the raw mechanism):
node --prof app.js && node --prof-process isolate-*.log > processed.txt

# Interactive flame graph in one command:
npx 0x app.js

# Deeper diagnostics (event-loop, GC, I/O):
npx clinic flame -- node app.js
```

```js
// Continuous: Pyroscope's Node SDK pushes V8 CPU/heap profiles on a timer.
const Pyroscope = require("@pyroscope/nodejs");
Pyroscope.init({
  appName: "api.gateway",
  serverAddress: "http://localhost:4040",
  tags: { version: "3.2.0", env: "prod" },
});
Pyroscope.start();
```

### Rust — `pprof-rs` and `perf`

```rust
// pprof-rs: sample this process and emit a pprof protobuf (push or store it).
use pprof::ProfilerGuardBuilder;

let guard = ProfilerGuardBuilder::default()
    .frequency(100)                 // 100 Hz, like everything else
    .blocklist(&["libc", "pthread"])
    .build()
    .unwrap();

// ... run workload ...
if let Ok(report) = guard.report().build() {
    let profile = report.pprof().unwrap();   // standard pprof — ship anywhere
    // serialize `profile` to .pb.gz and push to Pyroscope/Parca
}
```

```bash
# System-level, no code changes — perf record + flame graph (Brendan Gregg toolchain):
perf record -F 99 -g -p <pid> -- sleep 30
perf script | stackcollapse-perf.pl | flamegraph.pl > rust.svg
```

---

## Language SDKs in Depth

| Language | Continuous path | Mechanism | Notes |
|---|---|---|---|
| **Go** | `pyroscope-go` (push) **or** scrape `/debug/pprof/*` | built-in `runtime/pprof` | Gold standard; multi-type in one config; remember to enable mutex/block fractions. |
| **JVM** | JFR (`-XX:StartFlightRecording`) or async-profiler `--loop`; Pyroscope Java agent | JFR / async-profiler | Both built for always-on; JFR is the lowest-overhead native option. |
| **Python** | Pyroscope SDK / py-spy agent (push) | py-spy sampling | py-spy attaches by PID — profile prod without redeploying. |
| **Node** | `@pyroscope/nodejs` (push); `--prof`/`0x`/`clinic` one-shot | V8 profiler | V8 inlining can hide frames; mind the GIL-free but single-loop model. |
| **Rust** | `pprof-rs` (in-proc, emits pprof) or `perf` (system) | sampling + DWARF unwind | Native unwinding needs frame pointers or DWARF for clean stacks. |
| **Any language** | eBPF agent (`parca-agent`, Pyroscope eBPF) | kernel-level sampling | Zero instrumentation, whole-system — deep dive in [`professional.md`](professional.md). |

The unifying fact: **every one of these emits or is read as pprof.** The SDK choice is about *how the bytes get to the store*; the bytes themselves are a shared format.

---

## Querying Time-Indexed Profiles

This is what the pipeline buys you. The questions you can now ask:

- **"Top CPU consumers over the last hour"** — select profile type `cpu`, time range `now-1h..now`, render the merged flame graph; the widest leaves are the answer.
- **"Flame graph for a specific window"** — pin the range to `14:30–14:35` (the latency-spike window from your metrics) and render only those samples.
- **"By label"** — add a selector: `{service="checkout", version="v2.4.1", region="eu-west-1"}`.
- **"Compare two windows / two versions"** — select two ranges and diff them (next section).

Pyroscope uses a PromQL-like selector syntax (FlameQL):

```text
# CPU profile for one service+version, merged over the selected time range
process_cpu:cpu:nanoseconds{service_name="checkout", version="v2.4.1"}

# In-use heap for a region, last 30 minutes
memory:inuse_space:bytes{service_name="checkout", region="eu-west-1"}
```

Parca exposes the same idea through its UI and a query API: pick a profile type, a label selector, and a time range; it merges all matching profiles into one flame graph. **The merge is the key operation** — querying a window aggregates every profile in it into a single statistical view.

---

## Labels — Profiles Become Queryable

Labels are what make a profile *selectable*, and the cardinality rules from metrics apply verbatim:

| You want to slice by… | ✅ Bounded label | ❌ Cardinality bomb |
|---|---|---|
| Which service | `service="checkout"` | — |
| Which deploy | `version="v2.4.1"` | `commit_sha` per build *can* leak if you never expire |
| Which environment | `env="prod"` | — |
| Which region | `region="eu-west-1"` | — |
| Which user/request | **not a label** | `user_id`, `request_id` 💥 |

Per-profile labels (service/version/env/region) are the standard set and stay bounded. Some systems also support *dynamic* per-function tags inside a single profile (e.g. tagging stacks by endpoint) — powerful, but it inflates the profile's internal cardinality, so apply the same "bounded category, not identity" rule. Identity (which user, which request) belongs in **traces**, linked to the profile by timestamp and the shared `service`/`version` labels — the cross-signal correlation covered in [`senior.md`](senior.md) and the `observability-stack` skill.

---

## Differential Flame Graphs — First Contact

The single most valuable thing the time-indexed store unlocks. A **diff (differential) flame graph** colours the *change* between two selections:

```text
   BEFORE (v2.4.0)            AFTER (v2.4.1)            DIFF (after − before)
   ─────────────              ─────────────             ──────────────────────
   serialize 20%              serialize 38%             serialize  +18%  ███ RED  (regressed)
   queryDB   30%              queryDB   29%             queryDB     −1%  ░ neutral
   render    10%              render     4%             render      −6%  ▓▓ GREEN (improved)
```

The UI workflow is the same in Pyroscope and Parca:

1. Select profile type `cpu` and label `service=checkout`.
2. Set the **baseline** range/version (e.g. `version="v2.4.0"` or `13:00–13:05`).
3. Set the **comparison** range/version (`version="v2.4.1"` or `14:30–14:35`).
4. Switch to the **diff** view. Frames that got *wider* (more samples) glow red; frames that got *narrower* glow green.

This turns "did the deploy regress CPU?" from a guess into a colour. A red tower in the diff *is* the regression, named down to the function. The deep treatment — statistical significance, normalising for traffic, wiring it into the deploy gate — is [`senior.md`](senior.md) and [`professional.md`](professional.md); here, just internalise the *workflow* and that **red = worse, green = better**.

---

## The Workflow — Spike to Flame Graph

The end-to-end loop that justifies the whole pipeline:

```text
1. METRIC alerts   → p99 latency on checkout jumped at 14:32
2. TRACE narrows   → the time is inside checkout-service (not the DB, not the gateway)
3. PROFILE (query) → CPU flame graph for {service="checkout"} @ 14:30–14:35
                     → widest leaf: json.Marshal from serializeCart (38%)
4. DIFF confirms   → diff that window vs 13:00 (pre-spike): serialize glows RED +18%
5. CORRELATE       → version label shows the spike starts exactly at the v2.4.1 deploy
6. FIX             → pool the encoder / cache the marshaled payload; re-profile; box shrinks
```

Two things make step 3 instant rather than an expedition: the profile was *already collected* (continuous), and the **labels match across signals** — the same `service`/`version`/`region` you query in metrics select the right profiles. That label-alignment across logs, metrics, traces, and profiles is the heart of the `observability-stack` skill and a recurring theme of [`../observability-engineering/`](../observability-engineering/).

---

## Tooling Landscape

| Tool | Model | Strength | Notes |
|---|---|---|---|
| **Parca** (Polar Signals, OSS) | Scrape-first; eBPF agent | Prometheus-style scrape + whole-system eBPF | Self-host; relabeling like Prometheus. |
| **Pyroscope** (Grafana, OSS) | Push-first; also scrape + eBPF | Grafana-native UI, rich SDKs | Merged into Grafana's stack; FlameQL selectors. |
| **Polar Signals Cloud** | Scrape/eBPF (managed) | Hosted Parca, fleet scale | Commercial Parca. |
| **Datadog Continuous Profiler** | Push (agent) | Tight trace↔profile correlation | Part of Datadog APM; per-endpoint profiling. |
| **AWS CodeGuru Profiler** | Push (agent) | AWS-native, JVM/Python focus | Recommendations + cost reports. |
| **OTel profiling signal** | Standard, not a tool | Vendor-neutral fourth signal | Emerging; pprof-modelled; future-proofs your collectors. |
| **eBPF agents** (parca-agent, Pyroscope eBPF) | Scrape, kernel-level | Profiles *any* language, zero instrumentation | Whole-system; deep dive in [`professional.md`](professional.md). |

Two trends to know: **OpenTelemetry profiling** is standardising the signal so collectors and backends interoperate (the same way OTLP unified traces), and **eBPF whole-system profiling** lets one agent profile every process on a node — Go, Java, Python, native — with no code changes at all. You don't need eBPF to start; SDK push or pprof scrape gets you a working pipeline today.

---

## Use Cases

- **Tie a latency spike to a flame graph.** Metric alerts at 14:32; you query the CPU profile for that exact window and service — no reproduction.
- **Catch a deploy regression.** Diff `version="v2.4.1"` against `v2.4.0`; the red tower is the regressed function. (Automatable as a deploy gate — [`senior.md`](senior.md).)
- **Profile a Lambda you can't scrape.** SDK push: the short-lived function ships its profile before it exits.
- **Profile a polyglot fleet with one agent.** eBPF scrape covers Go, Java, Python, and native services uniformly — no per-language SDK.
- **Find the allocation hotspot across the fleet.** Query `inuse_space` by service over a day; the widest leaf is the leak/churn source.
- **Per-region performance comparison.** Same flame graph, `region` label flipped — see if `eu-west` is hotter than `us-east`.

---

## Coding Patterns

### Pattern 1 — Standard, bounded label set on every push

```go
Tags: map[string]string{"service": "checkout", "version": buildVersion, "env": env, "region": region}
// service · version · env · region — the four that align with metrics/traces. No IDs.
```

### Pattern 2 — Inject `version` from the build, not by hand

```go
var buildVersion = "dev" // set at link time: -ldflags "-X main.buildVersion=$(git describe)"
```

A correct `version` label is what makes deploy-diffs work; wire it from CI so it's never stale.

### Pattern 3 — Scrape long-lived, push ephemeral

```text
Parca scrape_configs:  the always-on fleet (k8s pods, daemons)
Pyroscope SDK push:    Lambdas, cron jobs, batch workers that die before a scrape
```

### Pattern 4 — Enable mutex/block before pushing them

```go
runtime.SetMutexProfileFraction(5) // off by default; nothing to push otherwise
runtime.SetBlockProfileRate(5)
```

### Pattern 5 — Keep the pprof endpoint internal

```go
go http.ListenAndServe("0.0.0.0:6060", nil) // internal network / k8s only
// Never expose /debug/pprof publicly — it leaks internals and allows a profile-DoS.
```

---

## Best Practices

1. **Label every profile with `service`, `version`, `env`, `region`** — bounded, and aligned with your metrics/traces so queries cross signals cleanly.
2. **Wire `version` from CI/build metadata**, never typed by hand — diff-by-version is only as good as the label.
3. **Scrape what you already discover; push what you can't reach.** Parca for the long-lived fleet, SDK push for serverless/batch.
4. **Default to ~10–15 s collection cadence** and ~100 Hz CPU sampling — the standard "leave it on" overhead (~1–2%).
5. **Keep pprof endpoints internal**, exactly as you would `net/http/pprof` at junior level.
6. **Set retention deliberately.** Profiles are bulky; keep high-resolution recent data and downsample/expire the rest (cost detail: [`../telemetry-cost-and-sampling-strategy/`](../telemetry-cost-and-sampling-strategy/)).
7. **Learn the diff view early.** It's the feature that pays for the whole pipeline; default to comparing against the previous deploy.

---

## Edge Cases & Pitfalls

- **A one-second query window is noisy.** Querying a tiny range merges few samples → a misleading flame graph. Widen the window; continuous storage is exactly what lets you.
- **`version` label that never changes (or never expires).** If every build reuses `version="prod"`, you can't diff deploys. If every build is a unique SHA you keep forever, label cardinality creeps. Use semantic/deploy versions and expire old ones.
- **Scraping a pprof CPU endpoint blocks for `seconds`.** `/debug/pprof/profile?seconds=30` holds the connection for 30 s; align `scrape_interval` with it or you'll overlap/stall scrapes.
- **eBPF stacks unsymbolized for some runtimes.** JIT'd or stripped code can show hex frames; the backend needs symbol upload or unwind info. (Native symbolization: [`professional.md`](professional.md).)
- **Pushing from a serverless function that freezes.** If the runtime freezes between invocations, an on-timer push may never fire — flush on shutdown or push synchronously per invocation.
- **Mismatched labels across signals.** If metrics say `service="checkout"` but profiles say `app="checkout-svc"`, your spike-to-flame workflow breaks. Standardise label *names and values* fleet-wide.

---

## Common Mistakes

| Mistake | Why it's wrong | Fix |
|---|---|---|
| Treating continuous profiling as "a fancier profiler" | The novelty is the time-indexed *store*, not the sampler | Build the pipeline: collect → store → query |
| No `version` label (or it's stale) | Can't diff deploys — the killer feature is dead | Inject `version` from CI build metadata |
| Putting `user_id`/`request_id` in profile tags | Same cardinality bomb as metrics | Identity → traces; profiles keep bounded categories |
| Reading a windowed flame graph as a timeline | Width is aggregate samples, *not* time order | Read widest-first, top-down; use a trace for order |
| Exposing `/debug/pprof` publicly for Parca to scrape | Leaks internals, enables profile-DoS | Internal network / k8s only |
| Querying a 1-second window and trusting it | Too few samples → noise | Widen to minutes; that's why you stored it |
| Inconsistent label names across services | Cross-signal queries and merges break | Standardise `service`/`version`/`env`/`region` |

---

## Tricky Points

- **Push vs scrape is the same trade-off as pull vs push in metrics** — long-lived & discoverable → scrape; ephemeral & unreachable → push. The pprof format hides the difference at query time.
- **A windowed flame graph is a *merge*.** The backend sums every profile in the range into one. More window = more samples = less noise, but still an aggregate, never a recording.
- **The diff view subtracts samples, and traffic skews it.** If `v2.4.1` simply got 2× the traffic, *every* box grows — a raw diff can look like a fleet-wide regression. Normalising for traffic is the senior-level subtlety; here, just know the trap exists.
- **Symbolization can happen at collect time or backend time.** Go symbolizes in-process (names ship in the pprof); eBPF/native often ship addresses and symbolize at the backend, needing debug info there.
- **"Profile type" and "sample type" overlap.** One pprof heap blob holds four value types (`alloc_objects/space`, `inuse_objects/space`); selecting the *value* changes the flame graph without re-collecting.
- **Continuous profiling is still statistical.** The same caveat from junior: absence of a thin box is weak evidence; a wide box in a long window is strong evidence.

---

## Test Yourself

1. What format do Go, py-spy, async-profiler, Pyroscope, and Parca all speak — and why does that matter?
2. Pyroscope defaults to *push*, Parca to *scrape*. Which would you use for a 200 ms Lambda, and which for a long-lived k8s deployment? Why?
3. You query a CPU flame graph for a 1-second window and it looks weird. What's likely wrong and what's the fix?
4. Which label makes differential-flame-graph-by-deploy possible, and how should you populate it?
5. In a diff flame graph, what do red and green mean? Name one reason a raw diff can mislead.
6. Walk the spike-to-flame-graph workflow from a metric alert to the fixed line.

<details>
<summary>Answers</summary>

1. The **pprof** protobuf format. Because the format is shared, collectors and backends are decoupled — any producer can be stored/rendered by any consumer.
2. **Push** for the Lambda (it dies before a scrape could fire and may be unreachable); **scrape** for the k8s deployment (long-lived and already discovered — mirrors Prometheus).
3. The window merges too few samples → statistical noise. **Widen the window** to minutes; the time-indexed store exists precisely so you can.
4. The **`version`** label. Populate it from **CI/build metadata** (`-ldflags -X`, env var) so it's accurate and changes per deploy — never hand-typed.
5. **Red = got wider = regressed (more samples); green = got narrower = improved.** Misleads if traffic changed between the two selections — more traffic widens every box, faking a regression. Normalise for traffic.
6. Metric alerts (p99 up at 14:32) → trace narrows to `checkout-service` → query the CPU profile for that window+service (widest leaf = the hot function) → diff vs pre-spike to confirm the regression in red → `version` label ties it to the deploy → fix and re-profile to watch the box shrink.

</details>

---

## Cheat Sheet

```text
┌──────────────────────── CONTINUOUS PROFILING — MIDDLE CHEAT SHEET ────────────────────────┐
│                                                                                            │
│  THE SHIFT: profiles become QUERYABLE LIKE METRICS — flame graph over time, by label.     │
│  PIPELINE:  collect ──► store (time-indexed, labelled) ──► query / diff                    │
│                                                                                            │
│  pprof FORMAT = the lingua franca (protobuf+gzip).                                         │
│    Go, py-spy, async-profiler, Pyroscope, Parca, OTel — all speak it.                      │
│    one blob can hold many sample types (alloc/inuse × objects/space).                      │
│                                                                                            │
│  TWO WAYS IN                                                                                │
│    PUSH (SDK)    → Pyroscope; app ships profiles on a timer; serverless/batch/unreachable  │
│    SCRAPE (agent)→ Parca; pulls /debug/pprof/* like Prometheus; long-lived discovered svc  │
│                                                                                            │
│  RUN LOCALLY                                                                                │
│    Pyroscope: grafana/pyroscope :4040  (+ Grafana :3000)                                   │
│    Parca:     ghcr.io/parca-dev/parca :7070  + scrape_configs (Prometheus-style YAML)      │
│                                                                                            │
│  SDKs:  Go pyroscope-go / built-in pprof · JVM JFR + async-profiler --loop ·               │
│         Python py-spy + SDK · Node @pyroscope/nodejs / 0x · Rust pprof-rs / perf ·         │
│         ANY language → eBPF agent (parca-agent / Pyroscope eBPF) [→ professional.md]       │
│                                                                                            │
│  LABELS (bounded!): service · version · env · region.  IDs → traces, NEVER tags.          │
│    version from CI build metadata → diff-by-deploy works.                                  │
│                                                                                            │
│  DIFF FLAME GRAPH: red = worse (wider), green = better.  watch traffic skew.               │
│  WORKFLOW: metric→trace→PROFILE(window+service)→diff→version→fix→re-profile.               │
│                                                                                            │
│  STILL: width = aggregate samples (NOT time) · still statistical · widen tiny windows.     │
└────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## Summary

- The novelty of *continuous* profiling is the **time-indexed, labelled store** — a profiling *database* — not the sampler. The mental model: **profiles become queryable like metrics** (a flame graph over time, sliced by label).
- The **pprof protobuf format** is the lingua franca; Go, py-spy, async-profiler, Pyroscope, Parca, and the OTel profiling signal all speak it, which decouples collectors from backends.
- The pipeline is **collect → store time-indexed → query/diff**, deliberately mirroring metrics.
- **Push (SDK, Pyroscope-style)** for ephemeral/unreachable processes; **scrape (agent, Parca-style)** for long-lived discovered services — the same pull-vs-push trade-off as metrics. Both run locally in Docker.
- **Continuous SDKs**: Go (`pyroscope-go` or built-in pprof), JVM (continuous JFR, async-profiler `--loop`), Python (py-spy + SDK), Node (`@pyroscope/nodejs`, `0x`), Rust (`pprof-rs`, `perf`); and **eBPF** profiles *any* language with no instrumentation (deep in [`professional.md`](professional.md)).
- **Labels** (`service`/`version`/`env`/`region`) make profiles selectable and must stay bounded — identities go to traces. A CI-driven **`version`** label unlocks deploy diffs.
- **Differential flame graphs** colour the change between two selections (red = worse, green = better) — the killer feature; here introduced at the workflow level, deepened in [`senior.md`](senior.md).
- A windowed flame graph is a **merge** of many samples — still aggregate (width ≠ time) and still statistical; widen tiny windows to cut noise.
- The payoff is the **spike-to-flame-graph workflow**: metric → trace → query the profile for that window → diff against the deploy → fix the named line.

---

## What You Can Build

- A **local continuous-profiling lab**: `docker compose` bringing up Pyroscope + Grafana *and* Parca, with a Go service that both pushes (`pyroscope-go`) and exposes `/debug/pprof` for Parca to scrape — see the same flame graph two ways.
- A **deploy-diff demo**: ship `v1` of a service, then `v2` with a deliberate CPU regression in one function; query the diff flame graph and watch that function glow red.
- A **polyglot fleet**: Go + Python + Node services all pushing to one Pyroscope with consistent `service`/`version`/`env` labels; build a Grafana dashboard that switches services by label.
- A **spike-to-flame-graph runbook**: a load generator that triggers a latency spike on a known endpoint; practise going metric → window → profile → diff → fix, timing how fast you reach the line.
- A **scrape-vs-push comparison**: the same workload profiled by Parca scrape and by SDK push; compare overhead, label handling, and freshness.

---

## Further Reading

- **Grafana Pyroscope docs** — language SDKs, FlameQL, eBPF — <https://grafana.com/docs/pyroscope/>.
- **Parca docs** — scrape configs, the storage model, `parca-agent` — <https://www.parca.dev/docs/>.
- **The pprof format (`profile.proto`)** — <https://github.com/google/pprof/blob/main/proto/profile.proto>.
- **The Go Blog — "Profiling Go Programs"** — the canonical `go tool pprof` tutorial — <https://go.dev/blog/pprof>.
- **async-profiler — continuous mode (`--loop`)** — <https://github.com/async-profiler/async-profiler>.
- **Java Flight Recorder** — `-XX:StartFlightRecording` reference — Oracle/OpenJDK JFR docs.
- **OpenTelemetry — profiling signal** — <https://opentelemetry.io/docs/specs/otel/profiles/>.
- The **`profiling-techniques`**, **`memory-leak-detection`**, and **`observability-stack`** skills — for the optimise-the-hot-function mechanics, the leak hunt, and how the four signals fit together.

---

## Related Topics

- **Previous level:** [junior.md](junior.md) — profile types, sampling, reading a flame graph.
- **Next level up:** [senior.md](senior.md) — differential flame graphs in depth (significance, traffic normalisation), off-CPU latency debugging, overhead budgets, profile-to-trace correlation.
- **Professional:** [professional.md](professional.md) — eBPF whole-system profiling, fleet rollout, deploy-gate regression detection, storage/cost at scale, native symbolization.
- **Interview:** [interview.md](interview.md). **Practice:** [tasks.md](tasks.md).

**Sibling diagnostic topics:**

- [Metrics — Middle](../metrics/middle.md) — labels & cardinality; profiles carry labels and obey the same rules.
- [Tracing](../tracing/README.md) — where identity (`user_id`, `request_id`) belongs; links to profiles by time + shared labels.
- [Logging](../logging/) — the per-event pillar.
- [Observability Engineering](../observability-engineering/) — how the four signals correlate via shared labels.
- [Dynamic Instrumentation & eBPF](../dynamic-instrumentation-and-ebpf/) — the kernel tech behind language-agnostic profiling.
- [Telemetry Cost & Sampling Strategy](../telemetry-cost-and-sampling-strategy/) — retention and the cost of storing profiles.

**Cross-roadmap links:**

- [Quality Engineering → Performance → Profiling](../../quality-engineering/performance/01-profiling/) — the one-off, laptop counterpart: this page *finds* the hot function in prod and over time; that one teaches you to *fix* it.

---

## Diagrams & Visual Aids

### The continuous pipeline (collect → store → query)

```text
   ┌─ COLLECT ───────────────┐   ┌─ STORE (time-indexed) ─┐   ┌─ QUERY ────────────┐
   │  SDK push (in-process)  │   │  profiling DB           │   │ select type+labels  │
   │   pyroscope-go ─────────┼──►│  ┌───────────────────┐  │   │ + time window       │
   │  scrape (agent/server)  │   │  │ {service,version, │  │──►│  → merged flame     │
   │   Parca pulls /pprof ───┼──►│  │  env,region} @ ts │  │   │  → DIFF two ranges  │
   └─────────────────────────┘   │  └───────────────────┘  │   └────────────────────┘
       pprof blobs every ~15s     │   (Pyroscope / Parca)   │     "queryable like
                                  └────────────────────────┘      metrics"
```

### Push vs scrape (same store, opposite direction)

```text
   PUSH  (Pyroscope default)              SCRAPE (Parca default)
   ────────────────────────              ──────────────────────
   [ app + SDK ] ──profiles──► [store]   [store] ──pull /debug/pprof──► [ app ]
        ▲                                    ▲
     ephemeral / unreachable             long-lived / discovered
     (Lambda, batch, cron)               (k8s pods, daemons)  — like Prometheus
```

### Differential flame graph (red = worse, green = better)

```text
   baseline v2.4.0          comparison v2.4.1            DIFF
   ┌─────────────┐          ┌─────────────┐         ┌──────────────────┐
   │ serialize20%│          │ serialize38%│   ──►   │ serialize +18% ███│ RED  regressed
   │ queryDB  30%│          │ queryDB  29%│         │ queryDB    -1% ░  │ neutral
   │ render   10%│          │ render    4%│         │ render     -6% ▓▓ │ GREEN improved
   └─────────────┘          └─────────────┘         └──────────────────┘
   workflow: pick type+service → set baseline → set comparison → switch to DIFF view
   ⚠ if traffic doubled, EVERY box grows — normalise before trusting a raw diff.
```

### Spike to flame graph (signals aligned by shared labels)

```text
   METRIC  ▁▂▅█▅  p99 ↑ @14:32                         ← alerts
      │
   TRACE   ├─ checkout-svc 480ms ──┬─ db 30ms          ← which service
      │                            └─ render 12ms
   PROFILE  query {service=checkout} @14:30–14:35      ← which LINE
            ████████ json.Marshal (serializeCart) 38%
      │
   DIFF    vs 13:00 baseline → serialize glows RED     ← confirms regression
      │
   VERSION label → spike starts at v2.4.1 deploy        ← ties to the cause
```

---
