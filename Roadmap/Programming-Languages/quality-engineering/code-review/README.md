# Code Review Roadmap

> *"The reviewer's job is not to write the code, but to ensure the code that ships is worth shipping."*

This roadmap is about **the engineering discipline of reading other people's code** — what to look for, in what order, what to flag, what to defer, and how to give feedback that improves the change without drowning the author. It is the technical complement to the human side of review.

> Looking for *the soft-skills and communication side of review* (tone, mentorship, disagreement)? See [Soft-Skills / Code Review](../../../Soft-Skills/code-review/).
>
> Looking for *receiving review* on your own code? Pair this with the `receiving-code-review` skill.
>
> Looking for *requesting review* effectively? Pair this with the `requesting-code-review` skill.
>
> Looking for *style rules that should never be in a review comment*? See [Static Analysis](../static-analysis/) — let the linter own those.

---

## Why a Dedicated Roadmap

Code review is the highest-leverage quality activity most teams have, and the one most often done by reflex. A reviewer who knows *what to look at first*, *what to trust the tooling for*, and *what only a human can catch* produces dramatically better PRs than one who reads top-to-bottom and comments on whatever catches the eye. This roadmap treats review as a skill with an order of operations.

| Roadmap | Question it answers |
|---|---|
| [Static Analysis](../static-analysis/README.md) | What can a machine catch before review even starts? |
| [Testing](../testing/README.md) | Does the code prove it works? |
| **Code Review** (this) | Is this the right change, correctly built, that a future maintainer can live with? |

---

## Sections

| # | Topic | Focus |
|---|---|---|
| [01](01-review-goals/) | The Review Goals | Bugs, design coherence, knowledge spread — what review IS for vs the things it is *not* (style policing, gatekeeping, re-architecting) |
| [02](02-review-order/) | Review Order | Correctness before design before style; the "read the tests first" technique; reading commits in order vs the squashed diff |
| [03](03-diff-vs-change/) | The Diff vs the Change | When the unified diff is enough, when you must pull the branch, when you must run it |
| [04](04-reviewing-tests-first/) | Reviewing Tests First | What test changes reveal about intent; missing tests as a design smell; tests that lie |
| [05](05-bug-finding-patterns/) | Bug-Finding Patterns | Concurrency hazards, off-by-one, swallowed errors, null/nil derefs, resource leaks — what to grep the diff for |
| [06](06-architectural-feedback/) | Architectural Feedback | Recognising when a PR is the wrong shape; giving that feedback early without sinking weeks of work |
| [07](07-performance-feedback/) | Performance Feedback | What to flag from reading (N+1, allocation in hot loops) vs what must wait for a benchmark |
| [08](08-security-feedback/) | Security Feedback | Input validation, missing auth checks, log injection, secret leakage, unsafe deserialisation |
| [09](09-reviewer-workload/) | Reviewer Workload | How many reviews per day before quality collapses; the LGTM-without-reading failure mode; review batching |
| [10](10-async-vs-sync-review/) | Async vs Synchronous Review | Written review vs pair programming vs walkthroughs; when each is the right tool |
| [11](11-reviewing-your-own-code/) | Reviewing Your Own Code | The pre-PR self-review pass; what to catch before a human ever sees it |
| [12](12-anti-patterns/) | Anti-patterns | Bikeshedding on style (let the linter do it), rubber-stamping, blocking on personal preference, ego comments, scope creep via "could you also…" |

---

## Languages

The discipline of review is largely **language-agnostic** — the order of operations and the bug-pattern hunt apply everywhere. What shifts is the *priority list*: memory safety and lifetime correctness dominate C++ and `unsafe` Rust review; error wrapping and context propagation dominate Go review; async cancellation and `Send`/`Sync` correctness dominate Rust async and Node review; mass assignment and ORM N+1 dominate Ruby/Python web review. The core skill — knowing what to look at first and what to ignore — transfers.

---

## Status

⏳ **Structure defined; content pending.**

---

## References

- *Software Engineering at Google* — Winters, Manshreck, Wright (the code review chapters are the single best published treatment of the topic)
- *Code Complete* — Steve McConnell (chapters on collaborative construction and review)
- *Google Engineering Practices Documentation* — the "Code Review Developer Guide" and "How to do a code review" companion (public, free, definitive)
- *How to Do Code Reviews Like a Human* — Michael Lynch (two-part essay on tone, technique, and what to skip)

---

## Project Context

Part of the [Senior Project](../../../../index.md) — a personal effort to consolidate the essential knowledge of software engineering in one place.
