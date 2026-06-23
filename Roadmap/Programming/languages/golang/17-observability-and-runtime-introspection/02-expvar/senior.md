# The `expvar` Package — Senior Level

## Table of Contents
1. [Introduction](#introduction)
2. [The `expvar`-or-Not Decision: First Principles](#the-expvar-or-not-decision-first-principles)
3. [`expvar` vs Prometheus vs OpenTelemetry](#expvar-vs-prometheus-vs-opentelemetry)
4. [What `expvar` Cannot Express](#what-expvar-cannot-express)
5. [The Global Registry as a Design Liability](#the-global-registry-as-a-design-liability)
6. [`expvar` in Libraries vs Applications](#expvar-in-libraries-vs-applications)
7. [Security: Treating `/debug/vars` as Attack Surface](#security-treating-debugvars-as-attack-surface)
8. [The `DefaultServeMux` Exposure Problem](#the-defaultservemux-exposure-problem)
9. [Bridging `expvar` into a Real Metrics Pipeline](#bridging-expvar-into-a-real-metrics-pipeline)
10. [`expvar` as a Migration Stepping Stone](#expvar-as-a-migration-stepping-stone)
11. [Operational Patterns for Internal Debug Endpoints](#operational-patterns-for-internal-debug-endpoints)
12. [Anti-Patterns](#anti-patterns)
13. [Senior-Level Checklist](#senior-level-checklist)
14. [Summary](#summary)

---

## Introduction

A senior engineer's relationship with `expvar` is not "how do I publish a counter" but "is `expvar` the right tool here, what does it cost the system, and what does it lock me out of that a real metrics library would give me." The package is a one-method interface and a global registry served as JSON. Mechanically trivial. Strategically, it sits at a fork: keep it for cheap introspection, or recognize that the workload has outgrown it.

This file is about *the design and the trade-offs*. The mechanics live in [junior.md](junior.md) and [middle.md](middle.md).

After reading this you will:
- Decide when `expvar` is sufficient and when it is a liability
- Articulate precisely what `expvar` cannot express that Prometheus/OTel can
- Treat the global registry and the default-mux coupling as design constraints
- Reason about `/debug/vars` as attack surface and gate it correctly
- Bridge `expvar` into a real metrics pipeline when needed
- Use `expvar` deliberately as a stepping stone, not a destination

---

## The `expvar`-or-Not Decision: First Principles

`expvar` is a tool, not a default. The decision is downstream of two questions: *what kind of numbers do I need to expose?* and *who will consume them?*

### What `expvar` actually buys you

- **Zero-dependency, zero-config introspection.** A blank import and an HTTP server, and a running process exposes live numbers as JSON. No client library, no exposition format to learn, no agent.
- **Free runtime visibility.** `memstats` and `cmdline` are genuinely useful during incident triage and come at no cost.
- **A trivial scrape target.** Any script that can `curl` and parse JSON can consume it.

### What `expvar` costs you

- **No metric typing or semantics.** Output is untyped JSON. A consumer cannot distinguish a counter from a gauge, cannot compute a rate, cannot reason about reset-on-restart semantics.
- **No labels, histograms, or aggregation.** The shape of the data is fundamentally flat. Anything dimensional is faked with `Map` keys and breaks down at scale.
- **A global, process-wide registry** with permanent names and a fatal duplicate-publish rule — a design constraint that leaks into testing and library composition.
- **Default-mux coupling** that creates accidental exposure if you are not careful.

### When the answer is yes

- An internal service where you want a couple of counters and live `memstats`, and adding a metrics stack is disproportionate.
- A debugging endpoint behind a trusted network, alongside `pprof`.
- A throwaway tool, a CLI daemon, a sidecar where observability is "nice to have," not "load-bearing."

### When the answer is no

- You need rates, histograms, quantiles, or SLO-grade metrics.
- You need labels/dimensions that a single `Map` key cannot model.
- The numbers feed dashboards and alerting that your team already runs on Prometheus or OTel.
- The endpoint would be reachable publicly and you cannot reliably gate it.

The honest senior default for a *production service with real observability needs* is: do not build your metrics on `expvar`. Use it for quick debugging, and use a real metrics library for the metrics that matter.

---

## `expvar` vs Prometheus vs OpenTelemetry

The three occupy different points on the same axis: how much structure and semantics the metric carries.

| Dimension | `expvar` | Prometheus client | OpenTelemetry metrics |
|-----------|----------|-------------------|-----------------------|
| Model | Pull, JSON | Pull, text exposition | Push or pull, OTLP |
| Typing | None (raw JSON) | Counter/Gauge/Histogram/Summary | Counter/UpDownCounter/Histogram/Gauge |
| Labels | None (fake via `Map` keys) | First-class label sets | First-class attributes |
| Histograms | None | Native | Native (incl. exponential) |
| Aggregation | None | At query time (PromQL) | At SDK and backend |
| Dependencies | stdlib only | a client library | SDK + exporters |
| Ecosystem | none | dashboards, alerting, PromQL | vendor-neutral, traces+metrics+logs |
| Setup cost | near zero | low | moderate |

The decisive differences:

- **`expvar` is push-nothing, pull-JSON, untyped, label-less.** It cannot represent a histogram or a labeled counter natively. It is a window into a process, not a metrics format.
- **Prometheus** adds metric *types*, *labels*, and a query language. It is the default for most Go services. The cost is a client library and an exposition endpoint.
- **OpenTelemetry** adds vendor-neutrality and unifies metrics with traces and logs. It is the choice when you want a single instrumentation API across signals and backends. The cost is more setup and a heavier SDK.

A common, sound trajectory: start with `expvar` for the first few counters during early development; move to the Prometheus client once you need labels or histograms; adopt OTel when you need a unified, vendor-neutral telemetry pipeline across services.

`expvar` is not a competitor to these — it is the rung below them. Choosing it consciously means accepting that you have *introspection*, not *metrics*.

---

## What `expvar` Cannot Express

Knowing the hard limits prevents you from contorting `expvar` into something it is not.

- **Histograms and quantiles.** There is no native bucketed distribution. You cannot compute p50/p99 from `expvar`; the best you can do is a running sum and count (a mean), which hides tail behaviour.
- **Multi-dimensional labels.** A `Map` gives you one string dimension. `http_requests{method, status, route}` is three dimensions; modeling it as a `Map` means concatenating keys (`"GET|200|/api"`), which explodes cardinality and is unqueryable.
- **Rates.** A counter's *rate* (requests/second) requires two reads and a clock. `expvar` exposes the raw counter; rate computation is the consumer's problem, and there is no metadata telling the consumer it is a counter that resets on restart.
- **Metric metadata.** No `HELP`, no `TYPE`, no units. A consumer cannot self-describe the metric.
- **Exemplars, sketches, or exponential histograms.** Modern observability features have no place in `expvar`.

When a requirement names any of these, the answer is not "make `expvar` do it" — it is "use a metrics library." Forcing distributions or high-cardinality labels through `Map` keys produces an unmaintainable, unqueryable mess.

---

## The Global Registry as a Design Liability

`expvar`'s registry is a package-global singleton. For a small application this is convenient; for a large system it is a design constraint with real consequences.

- **Permanent names.** No `Unpublish`. The registry only grows. A renamed metric is a breaking change to every consumer.
- **Fatal duplicates.** Publishing a name twice calls `log.Fatal`. Two libraries — or a library and the application — colliding on a name kills the process at startup.
- **No isolation.** Every part of the process shares one namespace. There is no per-subsystem registry, no scoping, no dependency injection of a registry.
- **Test hostility.** Tests that publish into the global registry interfere with each other and cannot easily reset it.

The senior mitigation is architectural: **decouple measurement from publication.** Business code increments `*expvar.Int`s it was handed (via constructor injection); a single, thin wiring layer publishes them once at startup. This keeps logic testable, avoids collisions, and confines the global-registry coupling to one place you can later swap for a Prometheus registry without touching the logic.

This is the same lesson as any global-singleton API: do not let the singleton's reach spread through your codebase. Wrap it at the edge.

---

## `expvar` in Libraries vs Applications

A sharp rule: **libraries should not publish to `expvar`.**

- **Collisions.** A library that calls `expvar.NewInt("requests")` will `log.Fatal` if two of its instances are linked, or if the application uses the same name. The application owns the global namespace; a library cannot safely claim names in it.
- **Forced exposure.** A library that imports `expvar` for its side effect drags `/debug/vars` registration into every consumer, whether they want it or not.
- **No opt-out.** The consumer cannot decline the library's published vars.

The correct library pattern: **expose metrics as values, let the application publish them.** A library returns `*expvar.Int`s (or, better, an abstract metrics interface) and lets the application decide whether and under what name to publish. Or it accepts a metrics sink via its constructor. The library instruments; the application wires.

For applications, publishing to `expvar` is fine — the application owns the process and the registry. The discipline is namespacing and publishing-once.

---

## Security: Treating `/debug/vars` as Attack Surface

`/debug/vars` is a read-only information-disclosure endpoint, and it must be treated as attack surface.

- **`cmdline` discloses the binary path and all command-line flags.** If any secret was passed as a flag (an anti-pattern, but common), it is now world-readable. Even without secrets, flags reveal configuration, feature toggles, and deployment topology.
- **`memstats` discloses runtime behaviour** — heap size, GC cadence, allocation rate. This aids an attacker profiling the service for memory-pressure or timing attacks.
- **Application vars may disclose business data** — counts, identifiers, internal state — depending on what was published.

Gating rules:

1. **Never expose `/debug/vars` on a public listener.** Bind it to an internal interface, a localhost-only admin port, or behind authenticated access.
2. **Do not rely on path obscurity.** `/debug/vars` is well-known and documented.
3. **Audit what you publish.** No secrets, no PII, no internal identifiers that aid reconnaissance.
4. **If it must be reachable, wrap it in auth middleware.** `expvar.Handler()` is a plain `http.Handler`; compose it with authentication.

A defensible default: a separate internal listener (e.g. `127.0.0.1:6060`) that serves `/debug/vars` and `/debug/pprof`, reachable only via an SSH tunnel, a service-mesh sidecar, or an authenticated admin gateway — never the same listener as public traffic.

---

## The `DefaultServeMux` Exposure Problem

The most common real-world `expvar` security incident is accidental exposure through `http.DefaultServeMux`.

The mechanism: importing `expvar` (and, very commonly, `net/http/pprof`) registers handlers on the *default* mux during `init`. If any HTTP server in the process serves the default mux — `http.ListenAndServe(addr, nil)` — those debug endpoints are live on that listener. If that listener is public, the endpoints are public, silently, with no code that obviously says "expose debug vars."

This is insidious because:

- The exposure is a *transitive side effect of an import*, not an explicit handler registration.
- A blank import deep in a dependency can register `pprof`/`expvar` without the application author noticing.
- The default mux is the path of least resistance, so it is easy to end up serving it on the public port.

Senior defenses:

1. **Never serve `http.DefaultServeMux` on a public listener.** Always construct an explicit `*http.ServeMux` for public traffic and pass it to your server. Then the default-mux registrations are inert.
2. **Mount debug endpoints explicitly** on a separate internal mux/listener (`mux.Handle("/debug/vars", expvar.Handler())`), so their exposure is intentional and reviewable.
3. **Grep for accidental default-mux serving** in code review: `ListenAndServe(addr, nil)` on anything public is a red flag.
4. **Audit blank imports.** A `_ "net/http/pprof"` or `_ "expvar"` anywhere in the dependency tree means the default mux carries debug endpoints.

The principle: make exposure of debug endpoints an explicit, intentional act, never an emergent property of an import plus the default mux.

---

## Bridging `expvar` into a Real Metrics Pipeline

Sometimes you inherit `expvar`-instrumented code and need its numbers in Prometheus or another backend without rewriting all the instrumentation at once. Two bridging strategies:

### Strategy 1 — Scrape `/debug/vars` with a translator

A small exporter polls `/debug/vars`, parses the JSON, and re-emits the values as Prometheus metrics (or pushes to an OTLP endpoint). This is glue: it preserves the existing `expvar` instrumentation and adds a structured layer on top. The limitation is that you cannot recover labels or histograms that `expvar` never carried — you can only re-expose the flat numbers with names.

### Strategy 2 — Walk the registry in-process with `Do`

Inside the process, iterate the registry and translate:

```go
expvar.Do(func(kv expvar.KeyValue) {
    // map kv.Key/kv.Value into the target metric system
})
```

This avoids the HTTP round-trip and gives you typed access to each `Var` (you can type-switch on `*expvar.Int`, `*expvar.Map`, etc.). It is the cleaner bridge when you control the binary.

Both strategies are *transitional*. They let you stand up real dashboards on existing `expvar` numbers while you migrate the high-value metrics to native client instrumentation. Do not treat the bridge as a permanent architecture — it inherits all of `expvar`'s expressiveness limits.

---

## `expvar` as a Migration Stepping Stone

The healthiest way to think about `expvar` in a growing system is as the *first rung*.

- **Phase 1 — `expvar`.** Early in a service's life, a few `expvar` counters and `memstats` give you cheap visibility with zero dependencies. This is genuinely valuable and proportionate.
- **Phase 2 — outgrowing it.** You start wanting "requests by route and status," then "p99 latency," then alerting. Each of these is something `expvar` cannot express. The pain is the signal to migrate.
- **Phase 3 — Prometheus or OTel.** You adopt a metrics library. The decoupling you did earlier (counting separate from publishing) pays off: you swap the publication layer without rewriting the logic.

The senior move is to *anticipate* this trajectory. Instrument behind an abstraction from the start (even a tiny internal interface), so the move from `expvar` to a real metrics library is a change at the edges, not a rewrite. The migration becomes a wiring change, not a re-instrumentation project.

What you usually keep from `expvar` even after migrating: the `pprof`/`expvar` *debug endpoint* itself, on the internal port, for ad-hoc introspection. The metrics graduate; the debug window stays.

---

## Operational Patterns for Internal Debug Endpoints

`expvar` is most defensible as part of a well-structured internal debug surface.

- **Dedicated debug listener.** Run a second `http.Server` on an internal/localhost address serving `/debug/vars`, `/debug/pprof`, health, and readiness. Keep it off the public listener entirely.
- **Co-locate with `pprof`.** The two share the default-mux pattern and the same security posture. Mount both on the same internal mux.
- **Authentication for non-localhost access.** If the debug port is reachable beyond localhost (e.g. in a cluster), put it behind mTLS or an auth proxy.
- **Stable, namespaced names** so that any tooling reading the endpoint is not broken by renames.
- **Cheap `Func`s only.** The debug endpoint may be polled by humans during incidents; do not make it expensive or capable of perturbing the process under inspection.
- **Document the endpoint.** A short runbook entry — "live counters at `:6060/debug/vars`, here is what each means" — turns `expvar` from folklore into an operational asset.

---

## Anti-Patterns

- **Building production metrics on `expvar`.** It has no histograms, labels, or aggregation. Use a metrics library for metrics that feed dashboards and alerts.
- **Publishing to `expvar` from a library.** Causes collisions and forced exposure. Libraries expose values; applications publish.
- **Serving `http.DefaultServeMux` on a public listener** while `expvar`/`pprof` are imported. Silent exposure of debug endpoints. Use a custom mux for public traffic.
- **Faking high-cardinality labels with concatenated `Map` keys.** Unqueryable and memory-hungry. If you need dimensions, use real labels.
- **Hand-maintaining gauges** with `Add(1)`/`Add(-1)`. They drift. Use `Func`.
- **Expensive `Func` bodies** that do I/O or contend for locks on every scrape. Cache and return.
- **Letting the global registry's reach spread** through the codebase instead of confining it to a wiring layer.
- **Exposing secrets via `cmdline` or published vars.** Audit what is visible at `/debug/vars`.
- **Treating the `expvar` bridge to Prometheus as permanent.** It inherits all of `expvar`'s limits; migrate the metrics that matter.
- **Renaming published vars casually.** Names are an observability contract; treat changes as breaking.

---

## Senior-Level Checklist

- [ ] Decide `expvar`-or-not based on whether you need typed metrics, labels, and histograms
- [ ] Never build production metrics on `expvar`; use it for introspection/debugging
- [ ] Keep libraries from publishing to the global registry; expose values instead
- [ ] Decouple counting from publishing; confine the global registry to a wiring layer
- [ ] Never serve `http.DefaultServeMux` on a public listener
- [ ] Mount `/debug/vars` (and `pprof`) explicitly on an internal/localhost listener
- [ ] Gate the debug endpoint; audit `cmdline`/`memstats`/your vars for disclosure
- [ ] Keep `Func` and custom `String()` bodies cheap and panic-free
- [ ] Use `Func` for gauges, `Map` for one-dimensional counts, `Add` for counters
- [ ] Instrument behind an abstraction so migration to Prometheus/OTel is a wiring change
- [ ] Keep stable, namespaced, documented names — they are a contract

---

## Summary

`expvar` is a one-method interface and a global registry served as JSON. The senior responsibility is to place it correctly on the observability spectrum: it is *introspection*, not *metrics*. It is push-nothing, pull-JSON, untyped, and label-less — it cannot express histograms, quantiles, multi-dimensional labels, rates, or metric metadata. That makes it excellent for a couple of counters and live `memstats` on an internal debug endpoint, and a poor foundation for anything that feeds dashboards and alerting.

The design liabilities — a permanent, fatal-on-duplicate global registry, and a default-mux coupling that causes silent exposure — are manageable with discipline: decouple counting from publishing, keep libraries out of the registry, never serve the default mux publicly, and mount debug endpoints explicitly on a gated internal listener. Treat `/debug/vars` as attack surface, because `cmdline` and `memstats` disclose operational detail.

The strategic framing is `expvar` as the first rung: cheap, dependency-free visibility early on, behind an abstraction that lets you graduate to Prometheus or OpenTelemetry when the workload demands labels, histograms, and aggregation. Choose `expvar` consciously, confine its reach, gate its endpoint, and plan the migration before scale forces it.
