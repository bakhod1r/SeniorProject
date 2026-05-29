# Audit Logging Roadmap

> *"Operational logs answer 'what is the system doing?' — audit logs answer 'who did what, and can we prove it?'"*

This roadmap is about **the security- and compliance-grade logging discipline that lives next to (but apart from) operational logging** — tamper-evident records of *who* did *what* to *which resource*, at *what time*, from *which origin*, with *what outcome*. Different consumers, different retention, different threat model.

> Looking for *operational* logging (log levels, structured fields, sampling, correlation IDs)? See [Logging](../logging/).
>
> Looking for the *system-design* angle (SIEM ingestion, immutable storage, WORM filesystems)? That belongs in the Security and System-Design tracks. This roadmap is the **language- and app-level** discipline that determines what is captured in the first place.

---

## Why a Dedicated Roadmap

Operational logs and audit logs look superficially similar but answer different questions:

| | Operational Logs | Audit Logs |
|---|---|---|
| Question | "What happened technically?" | "Who did what, intentionally?" |
| Consumer | On-call engineers | Compliance, security, legal |
| Sampling | OK — drop noise | **Never** — completeness is the point |
| Retention | Days to weeks | Months to years (SOC2 / HIPAA / GDPR) |
| Tampering | Tolerable in extreme cases | Unacceptable; must be tamper-evident |
| PII | Avoid | Often *required* (the *who* is the point) |

Confusing the two is the most common audit-logging mistake — and it usually means audit data is silently lost when log sampling kicks in.

| Roadmap | Question it answers |
|---|---|
| [Logging](../logging/README.md) | What was the system doing? |
| [Crash Reporting](../crash-reporting/README.md) | What failed? |
| **Audit Logging** (this) | Who acted on the system, and can I prove it later? |

---

## Sections

| # | Topic | Focus |
|---|---|---|
| 01 | Audit Log vs Operational Log | The differences in purpose, consumer, retention, tampering tolerance |
| 02 | The Audit Event Schema | Who, what, when, where, outcome, why; standardised fields (CloudEvents, ECS, OCSF) |
| 03 | What to Audit (and What Not) | Authorisation decisions, data access, admin actions; *not* every page view |
| 04 | Identity & Attribution | User ID, session ID, service account, on-behalf-of; how to capture the actual actor through delegation |
| 05 | Tamper-Evidence | Hash chains, signed entries, append-only storage, WORM, blockchain (mostly hype) |
| 06 | Retention & Legal Hold | SOC2, HIPAA, PCI, GDPR retention; legal hold; "right to be forgotten" tension |
| 07 | Sampling Is Forbidden | Why audit logs cannot be sampled; back-pressure handling when the pipeline jams |
| 08 | Separation From Operational Pipeline | Different sink, different ACL, different processing; why not just "another log stream" |
| 09 | SIEM Integration | Sending to Splunk / ELK / Sumo / Datadog Security; CEF / LEEF formats; alerting on patterns |
| 10 | Privacy & Minimisation | Logging the user without leaking the data — hashing IDs, redacting fields |
| 11 | Replay & Forensics | Reconstructing an incident from audit logs; query patterns, indexing for investigation |
| 12 | Anti-patterns | Audit-in-the-app-log, dropping under load, missing actor identity, PII in cleartext, mutable storage, no review process |

---

## Languages

Most audit logging is structurally cross-language (the *event* matters, not the SDK), but examples in **Java** (SLF4J + separate appender, Spring Security audit events), **Go** (separate `audit` logger, structured), **Python** (`structlog`, separate sink), **Node** (Winston/Pino with separate transport), and AWS / GCP managed audit services.

---

## Status

⏳ **Structure defined; content pending.**

---

## References

- *NIST SP 800-92* — Guide to Computer Security Log Management
- *PCI DSS Requirement 10* — the canonical audit-log requirements
- *AWS CloudTrail Architecture* — managed audit done well
- *Sigma / OCSF* — open standards for security event schemas
- *Open Cybersecurity Schema Framework* — OCSF specification

---

## Project Context

Part of the [Senior Project](../../../../index.md) — a personal effort to consolidate the essential knowledge of software engineering in one place.
