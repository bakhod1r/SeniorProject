# Diagnostics

How to **see, attribute, and respond** to what's happening inside a running program — language-agnostic principles, with concrete examples in [languages/](../languages/).

---

## Sections

### The original three

- **[Debugging](debugging/)** — interactive debuggers, post-mortem analysis, core dumps, time-travel debugging, when prints beat breakpoints.
- **[Logging](logging/)** — levels, structured logs, correlation IDs, log volume vs signal, sampling, retention.
- **[Error Handling](error-handling/)** — exceptions vs result types, sentinel errors, error wrapping, stack traces, recovery vs propagation.

### Observability pillars (the rest of the triangle)

- **[Metrics](metrics/)** — counters, gauges, histograms; cardinality; Four Golden Signals / RED / USE; OpenTelemetry Metrics SDK.
- **[Tracing](tracing/)** — spans, context propagation, OpenTelemetry SDK, sampling; tying traces to logs and metrics.

### Production diagnostics

- **[Crash Reporting](crash-reporting/)** — Sentry / Crashlytics / Bugsnag flows; symbolication, deduplication, release tagging.
- **[Diagnostic Endpoints](diagnostic-endpoints/)** — `/debug/pprof`, JMX, JFR, health / readiness probes, in-process REPLs, runtime config toggles.
- **[Panic & Recovery](panic-and-recovery/)** — invariant violations, unwinding, signals, "let it crash," recover-at-boundary patterns.
- **[Post-Mortem Analysis](post-mortem-analysis/)** — core dumps, heap dumps, thread / goroutine dumps, JFR recordings, offline reproduction.
- **[Audit Logging](audit-logging/)** — security- and compliance-grade logs; tamper-evidence, retention, sampling-forbidden discipline; separation from operational logs.

---

## Related

- **[Quality Engineering › Performance › Profiling](../quality-engineering/performance/01-profiling/)** — CPU / memory / allocation profiling lives there; the diagnostic surfaces that *expose* profiles live in [Diagnostic Endpoints](diagnostic-endpoints/).
- **[Quality Engineering › Performance](../quality-engineering/performance/)** — when diagnostics _is_ profiling.
- **[Code Craft › Clean Code › Error Handling](../code-craft/clean-code/06-error-handling/)** — the source-level discipline.
- **[Code Craft › Clean Code › Logging & Diagnostics](../code-craft/clean-code/18-logging-and-diagnostics/)** — the source-level discipline for emitting diagnostic data.
- **[Language Internals](../language-internals/)** — knowing how the runtime works makes diagnostics tractable.
- **[Backend › Observability](../../Backend/backend/09-observability/)** — the system-level observability stack (storage, dashboards, alerting); this section is the language-level discipline that feeds it.
- **[Backend › Distributed Systems › Distributed Tracing](../../Backend/distributed-systems/10-distributed-tracing/)** — collector topology and end-to-end design that this section's [Tracing](tracing/) feeds into.
