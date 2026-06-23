# Diagnostic Endpoints Roadmap

> *"The best debugger is one already attached to production — you just need a safe way to talk to it."*

This roadmap is about **the live diagnostic surfaces a running service exposes** — `/debug/pprof`, `/health`, `/ready`, JMX, management endpoints, runtime-toggleable feature flags, in-process REPLs. The pattern that lets you ask a live production process "what's slow right now?" without re-deploying.

> Looking for *offline* analysis from a dead process (core dumps, heap dumps, JFR recordings)? See [Post-Mortem Analysis](../post-mortem-analysis/).
>
> Looking for *system-level* health-check design (load balancer probes, liveness vs readiness in Kubernetes)? See [Container Orchestration](../../../DevOps/) and the `high-availability-patterns` skill.

---

## Why a Dedicated Roadmap

Every senior engineer has been on the call where the only diagnostic option was "redeploy with more logs." Live diagnostic endpoints are the alternative — and they're a deeply *language-level* concern:

- **Go** ships `net/http/pprof` — one import, instant CPU/heap/goroutine snapshots
- **JVM** has JMX, JFR, Flight Recorder — built into the runtime, no SDK
- **Python** has nothing built-in but a strong third-party ecosystem (`py-spy`, `manhole`, `pyrasite`)
- **Node** has `--inspect` and worker introspection
- **Rust** has nothing built-in — you build what you need

What's safe, what's exposed, and what's dangerous (`/shutdown`?) differs everywhere. This roadmap unifies the principles.

| Roadmap | Question it answers |
|---|---|
| [Debugging](../debugging/README.md) | How do I attach a debugger and step through? |
| [Metrics](../metrics/README.md) | What does aggregate behaviour look like? |
| **Diagnostic Endpoints** (this) | How do I ask a live process for its state, *now*, safely? |

---

## Sections

| # | Topic | Focus |
|---|---|---|
| 01 | The Pattern | Why diagnostic endpoints exist, how they differ from logs/metrics/traces |
| 02 | Health & Readiness | `/health` vs `/ready`; the load-balancer contract; what a check should and shouldn't include |
| 03 | Liveness Probes | When a process is wedged but the port is still open; reaper patterns |
| 04 | Profiling Endpoints | `/debug/pprof/*` (Go), JFR start/stop (JVM), `py-spy dump` (Python) |
| 05 | Heap & State Snapshots | Heap dumps, goroutine dumps, thread dumps — on demand |
| 06 | Runtime Config Toggles | `/debug/vars`, JMX MBeans, feature-flag flip at runtime; safe propagation |
| 07 | In-Process REPLs | `manhole` (Python), Smalltalk-style images, Erlang `:observer`, why and when |
| 08 | Securing Diagnostic Endpoints | Why these must NOT be on the public listener; admin port, mTLS, IP allowlist |
| 09 | Kubernetes Probes & Sidecars | Liveness, readiness, startup probes; debug containers, ephemeral containers |
| 10 | Admin APIs | Drain, graceful shutdown, version, build info, dependency status |
| 11 | Continuous Profiling | Pyroscope, Grafana Phlare, Parca; the "always-on pprof" model |
| 12 | Anti-patterns | `/debug` on the public listener, "kill yourself" endpoints, heavy probes, no auth, leaking internal IPs |

---

## Languages

Examples in **Go** (`net/http/pprof`, `expvar`), **Java** (JMX, JFR, Spring Actuator), **Python** (`py-spy`, `manhole`), **Node** (`--inspect`, `inspector` module), **Rust** (`tokio-console`, custom).

---

## Status

✅ **Content complete** — `junior` · `middle` · `senior` · `professional` · `interview` · `tasks`.

---

## References

- *Site Reliability Engineering* — Google SRE Book (health checks chapter)
- *Designing Data-Intensive Applications* — Martin Kleppmann (operational concerns)
- *Continuous Profiling in Production* — Felix Geisendörfer
- *Java Flight Recorder* — Marcus Hirt

---

## Project Context

Part of the [Senior Project](../../../../index.md) — a personal effort to consolidate the essential knowledge of software engineering in one place.
