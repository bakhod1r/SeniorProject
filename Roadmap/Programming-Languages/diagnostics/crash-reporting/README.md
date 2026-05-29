# Crash Reporting Roadmap

> *"The crash that nobody noticed is worse than the one that woke you up — because the second one, you can fix."*

This roadmap is about **collecting, transmitting, and triaging unhandled errors from production code** — Sentry / Crashlytics / Bugsnag-style flows, symbol upload, deduplication, and the discipline of *not drowning in noise*. It is the bridge between [Error Handling](../error-handling/) (what you wrote in the code) and on-call response (what wakes the engineer).

> Looking for *post-mortem analysis* of a process after it died (core dumps, heap dumps, JFR)? See [Post-Mortem Analysis](../post-mortem-analysis/).
>
> Looking for *alerting* discipline (SLOs, alert fatigue, paging)? See [Backend → Observability → Monitoring](../../../Backend/backend/09-observability/).

---

## Why a Dedicated Roadmap

Crash reporting sits in a strange middle ground:

- It's not *logging* — you want the **first occurrence + deduplication**, not every instance.
- It's not *metrics* — you want **full stack traces and context**, not counts.
- It's not *tracing* — you want **what failed**, not what worked.

Done badly, the dashboard fills with thousands of unrelated stack traces and nobody looks. Done well, it's the single most reliable production-quality signal a team has.

| Roadmap | Question it answers |
|---|---|
| [Error Handling](../error-handling/README.md) | How does my code *handle* errors? |
| [Logging](../logging/README.md) | What did the code *say*? |
| **Crash Reporting** (this) | Which errors made it past the handlers, and which user/session/version saw them? |

---

## Sections

| # | Topic | Focus |
|---|---|---|
| 01 | Crash vs Error vs Warning | What's worth reporting, what's noise; signal-to-noise discipline |
| 02 | Capture Surfaces | Uncaught exception handlers (JVM, Node, Python `sys.excepthook`); panics; signals; promise rejections |
| 03 | Symbolication & Source Maps | Why a minified JS trace is useless; uploading `.dSYM`, `.pdb`, `.map`; ProGuard / R8 deobfuscation |
| 04 | Context Enrichment | User ID (without PII), release version, env, breadcrumbs, last-seen log lines |
| 05 | Deduplication & Fingerprinting | Same crash, many instances; fingerprint by frames, not message |
| 06 | Release Tracking | Tying crashes to releases; regression vs new bug; auto-resolve on next release |
| 07 | Mobile vs Backend Crash Flows | Network unreliability, batching, on-device queue; vs server-side immediate upload |
| 08 | Sampling & Rate-Limiting | Stopping a tight crash loop from saturating quota; client-side sampling |
| 09 | Sentry / Crashlytics / Bugsnag SDKs | What they instrument, what they cost, what they leak |
| 10 | Self-hosted vs SaaS | Privacy, retention, customisation; GlitchTip and other open alternatives |
| 11 | Crash-Free Sessions | The unifying mobile metric; how to define and surface it |
| 12 | Anti-patterns | "Log it and forget," PII in stack traces, no source maps, no release tagging, swallowing errors before they're captured |

---

## Languages

Examples in **JavaScript** (Sentry browser + Node SDK, source maps), **Java/Kotlin** (Sentry SDK, ProGuard mappings), **Swift** (Crashlytics, symbolication), **Python** (Sentry `sys.excepthook`), **Go** (Sentry `raven-go`, recover-then-report).

---

## Status

⏳ **Structure defined; content pending.**

---

## References

- *Sentry Documentation* — the canonical reference for the modern flow
- *Production-Ready Microservices* — Susan J. Fowler
- *Mobile Crash Reporting* talks — Firebase Crashlytics team

---

## Project Context

Part of the [Senior Project](../../../../index.md) — a personal effort to consolidate the essential knowledge of software engineering in one place.
