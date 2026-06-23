# Dynamic Analysis & Sanitizers

> *"Testing shows the presence, not the absence of bugs."* — Dijkstra. Sanitizers narrow the gap: they make whole **classes** of bug impossible to miss *when the code runs over them.*

This roadmap is about the bugs you **cannot see by reading code or running a linter** — the data race that only manifests on the 1-in-10,000 interleaving, the use-after-free that happens to read plausible-looking garbage, the signed overflow that "works" until the optimizer notices it's undefined. Dynamic analysis instruments a running program so that the *first* time execution touches one of these defects, you get a precise, actionable report — file, line, allocation stack, and the access that broke the rules — instead of a silent corruption that surfaces as a mysterious crash three hours later in production.

> Looking for *what can be proven without running the code* (linters, type-checkers, SAST)? That's the static counterpart — see **[Static Analysis & Linting](../static-analysis/)**. The two are complementary: static analysis reasons about *all* paths but over-approximates; dynamic analysis sees *only the paths you execute* but reports with near-zero false positives.
>
> Looking for *how to generate the inputs* that drive execution into the dark corners? See **[Testing → fuzzing](../testing/)**; sanitizers + a coverage-guided fuzzer is the single most productive bug-finding combination in systems software, covered in [05](05-coverage-guided-dynamic-analysis/).
>
> Looking to *prove* a property holds on every input rather than catch violations as they happen? See **[Formal Methods & Verification](../formal-methods-and-verification/)**.

---

## Why a Dedicated Roadmap

Memory-safety and concurrency bugs are the most expensive defects in the industry — Microsoft and Google both report that **~70% of their serious security vulnerabilities are memory-safety issues** — and they are exactly the bugs that unit tests, code review, and static analysis most reliably *miss*. A use-after-free passes review because the lifetime bug spans two files. A data race passes CI because the failing interleaving didn't happen that run. Undefined behaviour passes testing because the compiler hadn't yet exploited it. Sanitizers and dynamic analysers attack this blind spot head-on by **watching the actual execution** and turning latent corruption into an immediate, well-located failure. Knowing which tool catches which bug class, what each costs, and how to wire them into CI is core systems-quality engineering.

| Roadmap | What it catches | When it runs |
|---|---|---|
| [Static Analysis & Linting](../static-analysis/) | Pattern/rule violations, type errors, *potential* bugs on all paths | Without executing — compile time |
| **Dynamic Analysis & Sanitizers** (this) | Memory-safety, races, UB, leaks — *real* bugs on executed paths | While the program runs |
| [Formal Methods & Verification](../formal-methods-and-verification/) | Violations of a *specified* property, on all reachable states | At proof/model-check time |

---

## Sections

Each topic ships the full five-tier set — **junior / middle / senior / professional / interview**.

| # | Topic | Focus |
|---|---|---|
| [01](01-address-sanitizer-asan/) | AddressSanitizer (ASan) | Heap/stack/global overflow, use-after-free/return/scope, double-free; shadow memory & redzones; ~2× cost; `-fsanitize=address`; CI wiring |
| [02](02-thread-sanitizer-tsan/) | ThreadSanitizer (TSan) | Data-race detection via happens-before; the memory model; shadow cells; why it needs the race to *execute*; Go's `-race`; ~5–15× cost |
| [03](03-undefined-behavior-sanitizer-ubsan/) | UndefinedBehaviorSanitizer (UBSan) | Signed overflow, null deref, misaligned access, bad shifts, type confusion; trap vs recover; cheap enough for some prod builds |
| [04](04-memory-leak-detection-valgrind/) | Leak Detection & Valgrind | Memcheck's full DBI vs compile-time instrumentation; uninitialized reads, invalid frees, leaks; LSan as the fast path; Massif/Cachegrind/Helgrind |
| [05](05-coverage-guided-dynamic-analysis/) | Coverage-Guided Dynamic Analysis | libFuzzer/AFL++/Go fuzzing; the sanitizer + fuzzer combo; corpus & coverage feedback; structure-aware fuzzing; OSS-Fuzz; the bridge to [testing](../testing/) |
| [06](06-runtime-assertion-and-contract-checking/) | Runtime Assertions & Contracts | `assert`, pre/post/invariants, design-by-contract at runtime, debug vs release, fail-fast vs recover; assertions as the fuzzer's oracle |

---

## Sources & Vocabulary

Grounded in: the **LLVM/Clang sanitizer suite** (ASan, TSan, MSan, UBSan, LSan) and the **AddressSanitizer** and **ThreadSanitizer** papers (Serebryany et al., USENIX/Google); **Valgrind** (Nethercote & Seward) and Memcheck/Helgrind/Massif/Cachegrind; **libFuzzer**, **AFL++**, **Go's race detector and native fuzzing**, and **OSS-Fuzz**; the C/C++ notion of **undefined behaviour** (and Regehr's *"A Guide to Undefined Behavior"*); **design by contract** (Meyer, *Eiffel*); the Microsoft/Google memory-safety vulnerability statistics; the broader **dynamic program analysis** literature.

---

## Status

✅ **Content-complete.** All 6 topics are written across the full five-tier set (junior / middle / senior / professional / interview): 30 topic files in total.

---

## Project Context

Part of the [Senior Project](../../../../index.md) — a personal effort to consolidate the essential knowledge of software engineering in one place. Sits in [Quality Engineering](../) alongside its static counterpart [Static Analysis & Linting](../static-analysis/), the input-generation side in [Testing](../testing/), and the proof-based sibling [Formal Methods & Verification](../formal-methods-and-verification/). Memory-safety findings here feed directly into [Security](../../../Security/).
