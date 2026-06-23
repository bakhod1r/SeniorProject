# Logging Roadmap

> *"If it isn't logged, it didn't happen — and if it's logged badly, you'll wish it hadn't."*

This roadmap is about **how a running program reports what it's doing to its operator** — structured logs, log levels, correlation IDs, sampling, and the discipline around what to log and what never to log.

> Looking for *how code expresses failure to its caller* (exceptions, `Result`, error wrapping)? See the sibling roadmap: [Error Handling](../error-handling/README.md). Errors and logs are related but distinct concerns — errors are an API question, logs are an operational question.
>
> Looking for the *Clean Code chapter angle*? See [Clean Code → Logging & Diagnostics](../../code-craft/clean-code/18-logging-and-diagnostics/README.md).
>
> Looking for *dashboards, alerts, SLOs, full observability stack*? See [Backend → Observability](../../../Backend/backend/09-observability/) and the `observability-stack` / `monitoring-alerting` skills. This roadmap stays at the **code level** — what you write inside the program; observability covers what happens to those logs after they leave the process.
>
> Looking for the *three pillars comparison* (logs vs metrics vs traces)? That's covered briefly in section 09 below, but the deep treatment lives in `observability-stack`.

---

## Why a Dedicated Roadmap

Logging is usually treated as an afterthought until a 3am incident exposes that the logs are useless: no structure, no correlation, half the codebase using `println`, sensitive data in plaintext. This roadmap treats logging as **a design problem of its own**, separate from error handling and separate from the broader observability platform.

| Roadmap | Question it answers |
|---|---|
| [Error Handling](../error-handling/README.md) | How does my code express failure to its caller? |
| **Logging** (this) | How does my running program report what it's doing to its operator? |
| [Debugging](../debugging/README.md) | How do I find out *why* something went wrong after the fact? |

---

## Sections

| # | Topic | Focus |
|---|---|---|
| 01 | Why Logging Is Hard | The hidden costs (perf, storage, PII risk), the value (post-mortem, audit, debug) |
| 02 | Structured vs Unstructured | Key-value over freeform text, JSON logs, log schemas, parseability |
| 03 | Log Levels & Discipline | TRACE / DEBUG / INFO / WARN / ERROR / FATAL — what each means and when to use it |
| 04 | Context Propagation | Request IDs, trace IDs, user IDs, tenant IDs — passing them through call stacks |
| 05 | What to Log, What Not To | PII, secrets, high-cardinality fields, the GDPR / SOC 2 angle |
| 06 | Sampling & Volume Control | When 100% logging is wasteful; head-based vs tail-based sampling |
| 07 | Performance | Async appenders, lock-free queues, the cost of a `log.Debug` call you don't see |
| 08 | Logging Libraries | Go (`slog`, `zerolog`, `zap`), Java (SLF4J + Logback / Log4j2), Python (`logging`, `structlog`, `loguru`) |
| 09 | Logs vs Metrics vs Traces | The three pillars at a glance — when each is the right tool, and when logs are the wrong one |
| 10 | Log Pipelines | stdout → collector (Fluent Bit / Vector / OTEL) → backend (Loki, ELK, Datadog) — the boundary where this roadmap ends and `observability-stack` begins |
| 11 | Anti-Patterns | `print` debugging that shipped to prod, log-and-rethrow, swallowed errors with no log, log lines that mean nothing six months later |

---

## Languages

Examples in **Go** (`slog`, `zerolog`, `zap`), **Java** (SLF4J + Logback / Log4j2), and **Python** (`logging`, `structlog`) — covering the dominant libraries in each ecosystem.

---

## Status

⏳ **Structure defined; content pending.**

---

## References

- *Site Reliability Engineering* — Beyer, Jones, Petoff, Murphy (the chapters on monitoring and incident response)
- *Observability Engineering* — Majors, Fong-Jones, Miranda
- Twelve-Factor App — *Logs* (treat logs as event streams)
- Charity Majors — writings on structured logging and high-cardinality events

---

## Project Context

Part of the [Senior Project](../../../../index.md) — a personal effort to consolidate the essential knowledge of software engineering in one place.
