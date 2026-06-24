# External Resources — Senior Go Backend Interview

Curated, high-signal sources cross-referenced against this question bank. Use these to pressure-test your answers against what interviewers actually ask in 2025–2026.

## Go language & concurrency
- [Second Talent — 23 Advanced Golang Backend Questions (Senior)](https://www.secondtalent.com/interview-guide/golang/) — senior-framed, GMP / sync primitives / profiling.
- [Gank Interview — 30 Qs on Concurrency, Channel, GC & Escape Analysis](https://www.gankinterview.com/en/blog/golang-interview-questions-30-questions-on-concurrency-channel-gc-and-escape-ana) — deep, with solutions; matches our §1–2.
- [CodeForGeek — Senior Golang: Advanced Concurrency & Performance](https://codeforgeek.com/senior-golang-interview-questions/)
- [Devinterview-io/golang-interview-questions (GitHub)](https://github.com/Devinterview-io/golang-interview-questions) — large curated set.
- [FullStack.Cafe — 34 Go Interview Questions](https://www.fullstack.cafe/blog/go-interview-questions)
- [InterviewBit — Top Golang Questions](https://www.interviewbit.com/golang-interview-questions/) · [Turing — 100+ Go Q&A](https://www.turing.com/interview-questions/golang) · [roadmap.sh — 50 Go Questions + quiz](https://roadmap.sh/questions/golang)
- [Medium (dsysd dev) — 20 Advanced Qs for Senior Go](https://dsysd-dev.medium.com/20-advanced-questions-asked-for-a-senior-developer-position-interview-1a65203e5d5e)

## Kafka & event-driven architecture
- [Hello Interview — Kafka Deep Dive for System Design](https://www.hellointerview.com/learn/system-design/deep-dives/kafka) — the single best Kafka-for-interviews read; matches our §11.
- [DataCamp — 20 Kafka Interview Questions](https://www.datacamp.com/blog/kafka-interview-questions)
- [codefarm0 (Medium) — 200+ Kafka Questions](https://codefarm0.medium.com/comprehensive-list-of-kafka-interview-questions-200-c7a484d43a3f)
- [WeCreateProblems — 100+ Kafka Q&A](https://www.wecreateproblems.com/interview-questions/kafka-interview-questions)

## Backend, distributed systems & system design
- [F1Jobs — System Design Prep for Backend Engineers](https://www.f1jobs.io/resources/blog/system-design-interview-backend-roles) — distributed systems, APIs, DBs.
- [Second Talent — Top 20 Backend Developer Questions](https://www.secondtalent.com/interview-guide/backend-developer/)
- [FinalRound AI — 90+ Backend Developer Questions](https://www.finalroundai.com/blog/backend-developer-interview-questions)
- [MeetAssist — Backend Developer Questions (2026)](https://meetassist.io/interview-questions/backend-developer)

## System design — courses, primers & curated collections
- [System Design Primer (donnemartin)](https://github.com/donnemartin/system-design-primer) — the canonical free, open-source study guide: building blocks, back-of-envelope numbers, and worked designs. Pairs directly with our §14.
- [Grokking the System Design Interview (DesignGurus)](https://www.designgurus.io/course/grokking-the-system-design-interview) — the original "framework + N worked problems" course; mirrors our §14 problem set (URL shortener, newsfeed, chat, rate limiter…).
- [Python Design Patterns — refactoring.guru](https://refactoring.guru/design-patterns/python) — illustrated GoF patterns with idiomatic Python; cross-references our §28 (OOP & design patterns).
- [Python Design Patterns — faif/python-patterns (GitHub)](https://github.com/faif/python-patterns) — a large runnable catalog of patterns + idioms in Python; good for "show me the code" follow-ups.
- **Curated link bundles (Telegram):** [links_for_mine_prep #184](https://t.me/links_for_mine_prep/184) · [links_for_mine_prep #210](https://t.me/links_for_mine_prep/210) — the source collections this list was drawn from; they also point to *System Design Cheatsheet*, *System Design Academy*, and other "best system design resources" roundups. Treat them as an index, then map each item back to the matching section here.

> Coverage note: every topic in the shared "system thinking" checklist — distributed systems, latency/timeout/retry/backoff, idempotency, CAP, consistency models, DB & Postgres internals, caching, queues/event-driven, Kafka internals, API gateway, rate limiting, circuit breaker, observability, scalability patterns, multi-tenant architecture — already maps to a section in this bank (§5, §7, §11, §13, §14, §18, §22) and to a hands-on brief in `Projects/`. Use the links above to pressure-test, not to relearn.

## How to use
1. Answer each of our `questions.json` items out loud first (cover the answer).
2. Then skim the matching external list above to catch phrasings/edge cases we may not have framed.
3. For Kafka & system design, read the Hello Interview deep dives end-to-end — they mirror real senior loops.

> Validation note: a 2026 web sweep confirmed our taxonomy covers what's actually asked — GMP/scheduler, slice-aliasing & goroutine leaks, context rationale, escape analysis (`-gcflags=-m`), tri-color GC tuning, Kafka exactly-once/idempotent consumers/transactional outbox, Saga, and database-per-service. No major topic gap was found.
