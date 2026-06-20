# Coverage-Guided Dynamic Analysis — Professional Level

> **Roadmap:** [Dynamic Analysis & Sanitizers](../README.md) → Coverage-Guided Dynamic Analysis
> *The senior page taught you to drive a fuzzer. This page is about running a fuzzing **program** across an org — choosing which surfaces to harness first, owning a fleet of harnesses and corpora as durable assets, wiring continuous fuzzing, and answering the CFO's question: "we spend how many CPU-hours on this, to catch what?" The hardest truths here aren't about mutators. They're that a year of clean fuzzing usually means a weak oracle, not clean code — and that the bug Heartbleed shipped was a one-day harness away from never existing.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — Picking the Attack Surface: Where Fuzzing Pays](#core-concept-1--picking-the-attack-surface-where-fuzzing-pays)
5. [Core Concept 2 — Harnesses and Corpora as Owned, Durable Assets](#core-concept-2--harnesses-and-corpora-as-owned-durable-assets)
6. [Core Concept 3 — The Oracle Gap: Fuzzing Only Finds What You Can See](#core-concept-3--the-oracle-gap-fuzzing-only-finds-what-you-can-see)
7. [Core Concept 4 — Continuous Fuzzing and the Crash Lifecycle](#core-concept-4--continuous-fuzzing-and-the-crash-lifecycle)
8. [Core Concept 5 — The Economics: CPU Cost vs the Cost of a Shipped CVE](#core-concept-5--the-economics-cpu-cost-vs-the-cost-of-a-shipped-cve)
9. [Core Concept 6 — The Sanitizer Matrix for Fuzzing](#core-concept-6--the-sanitizer-matrix-for-fuzzing)
10. [War Stories](#war-stories)
11. [Decision Frameworks](#decision-frameworks)
12. [Mental Models](#mental-models)
13. [Common Mistakes](#common-mistakes)
14. [Test Yourself](#test-yourself)
15. [Cheat Sheet](#cheat-sheet)
16. [Summary](#summary)
17. [Further Reading](#further-reading)
18. [Related Topics](#related-topics)

---

## Introduction

> Focus: **Standing up and running a continuous fuzzing program across a real organization — judgment about surfaces, harnesses, corpora, oracles, economics, and triage SLAs at scale.**

The senior page framed fuzzing as a tool you point at a function. At the professional level the question changes from "how do I fuzz this parser?" to "which of our 300 services, parsers, and protocol handlers do we harness first, who owns the 40 harnesses we end up with, where does the corpus live so it survives a repo migration, and what's our SLA when the fleet finds a crash at 3 a.m.?"

These are not mechanics questions. The mechanics — libFuzzer, AFL++, coverage instrumentation, mutation — are assumed. The skill here is allocation and judgment under a fixed CPU budget and a finite headcount: knowing that the highest-ROI surface is almost always *whatever parses untrusted input* (Microsoft and Google both put memory-safety bugs at roughly **70%** of their critical vulnerabilities, and the lion's share live in parsers, decoders, and deserializers); knowing that a fuzzer that "found nothing in a year" is almost never evidence of clean code and almost always evidence of a harness that returns early or an oracle that can't see the bug; knowing when a coverage plateau means "buy more CPU" versus "the harness is the bottleneck, throw CPU at it and you'll just heat the datacenter."

This page is the battle-tested layer: the find→dedupe→bisect→file→verify→regress loop, the self-host-vs-OSS-Fuzz decision, the sanitizer matrix and its can't-combine constraints, and the security disclosure workflow for the day a fuzzer finds a *real* exploitable bug in shipped code.

---

## Prerequisites

- **Required:** [senior.md](senior.md) — coverage-guided mutation, libFuzzer/AFL++, the `LLVMFuzzerTestOneInput` shape, corpus minimization, structure-aware fuzzing, sanitizer basics.
- **Required:** You've written at least one real harness and watched coverage climb, plateau, and a crash reproduce.
- **Helpful:** You've owned a CI pipeline, a triage rotation, or an incident-response process.
- **Helpful:** You've been on the receiving end of a memory-safety CVE that required an emergency patch and disclosure.

---

## Glossary

- **Harness (fuzz target):** the thin adapter — `LLVMFuzzerTestOneInput(const uint8_t*, size_t)` or a Go `func Fuzz(f *testing.F)` — that turns a byte string into one exercise of the code under test. The single highest-leverage artifact in the whole program.
- **Corpus:** the curated set of inputs that exercise distinct code paths. A *durable asset*, not scratch data — it encodes everything the fuzzer has ever learned about reaching deep states.
- **Seed corpus:** the initial inputs you hand the fuzzer (real-world samples, regression files). Good seeds are often worth more than a 10× CPU increase.
- **Oracle:** the thing that decides an input is "bad." A crash, an ASan report, a failed assertion, a differential mismatch, a timeout. Fuzzing finds *only* what the oracle can detect.
- **Dictionary:** a list of magic bytes, tokens, and constants (`-dict=`) that lets the mutator jump comparison walls it can't brute-force.
- **CMP feedback (`-fsanitize-coverage=trace-cmp`):** instrumentation that feeds comparison operands back to the mutator so it can "solve" `if (magic == 0xDEADBEEF)` without a dictionary. AFL++'s equivalent is **CmpLog**.
- **Corpus minimization (`cmin`/`-merge=1`):** reducing the corpus to the smallest set that preserves total coverage. Done routinely to keep the fleet fast.
- **Test-case minimization (`tmin`):** shrinking a *single* crashing input to the smallest bytes that still trigger the bug. The first step of triage.
- **Coverage plateau:** the point where new coverage stops arriving despite more CPU — the signal to change the harness, seeds, or oracle rather than buy machines.
- **ClusterFuzz / ClusterFuzzLite:** Google's continuous-fuzzing infrastructure (full-scale and CI-embedded). **OSS-Fuzz** is the hosted Google service that runs ClusterFuzz for open-source projects for free.
- **Differential oracle:** running two implementations on the same input and flagging any divergence — a way to find *logic* bugs a sanitizer can't see.

---

## Core Concept 1 — Picking the Attack Surface: Where Fuzzing Pays

A fuzzing program with a fixed CPU and headcount budget is an allocation problem. You cannot harness everything, and you shouldn't. The dominant insight — the one that should drive your first quarter of harness-writing — is that memory-safety vulnerabilities cluster overwhelmingly in code that **reads attacker-controlled bytes and turns them into structured data**.

The high-value surfaces, in roughly the order you should harness them:

| Surface | Why it pays | Examples |
|---|---|---|
| **Parsers** | Hand-rolled state machines over untrusted bytes; classic OOB read/write | JSON/XML/YAML, config formats, custom wire formats |
| **Deserializers** | Reconstruct objects/graphs from bytes; type confusion, length fields | protobuf, Thrift, `pickle`-like, Java/`.NET` deserialization |
| **Decoders / codecs** | Tight pointer arithmetic over compressed/encoded data | image (libwebp, libpng, JPEG), audio/video, compression (zlib, lzma) |
| **Protocol handlers** | Stateful parsing of network input; the literal attack surface | TLS records, HTTP/2 frames, DNS, QUIC, custom RPC framing |
| **Anything taking untrusted file/network input** | If an attacker controls the bytes, it's a target | upload handlers, font/PDF rendering, regex engines on user patterns |

The triage rule for "is this worth a harness?" is two questions: **(1) does an attacker control the input?** and **(2) does the code do non-trivial parsing/pointer work on it?** Two yeses → harness it early. A pure-arithmetic function with no untrusted input and no memory complexity is a poor fuzzing target no matter how "core" it feels.

> **The professional reality:** the biggest ROI mistake is fuzzing what's *easy to harness* instead of what's *exposed*. A team will proudly fuzz a tidy pure-functional library (easy harness, no untrusted input, near-zero real risk) while the hand-written multipart-upload parser that touches every external byte sits un-fuzzed. Map your **trust boundaries first**, then harness the code those bytes flow into — in attack-surface order, not convenience order.

This is also where coverage reporting earns its keep at the program level: not "what % of lines did this run cover," but **"which exposed parsers have zero fuzz coverage?"** A coverage report that highlights *un-fuzzed attack surface* is a backlog-prioritization tool, and it's the single most useful artifact you can put in front of a security review.

---

## Core Concept 2 — Harnesses and Corpora as Owned, Durable Assets

A continuous fuzzing program is, in inventory terms, a fleet of harnesses and a set of corpora. Both are **assets with owners**, not throwaway scripts. Treating them as ephemeral is the most common way a program quietly dies.

**Harnesses need owners and code review.** A harness lives next to the code it tests, is reviewed like production code, and has a name on it. When the underlying API changes, the harness must change with it — an unmaintained harness silently stops compiling, gets disabled in the fleet config, and now you have *negative* signal: a green dashboard hiding a surface that hasn't been fuzzed in months. A good harness is also **deterministic, fast, and stateless per input**: no global state leaking between runs, no I/O, no sleeps, no early `return` that skips the interesting code (see the war story — this is the single most common silent failure).

```cpp
// A real harness for an image decoder: deterministic, no early-out on size,
// feeds the WHOLE input through the actual parse path.
extern "C" int LLVMFuzzerTestOneInput(const uint8_t *data, size_t size) {
  // DON'T do this — the classic "fuzzed clean for a year" bug:
  //   if (size < 4) return 0;            // fine, but...
  //   if (data[0] != 'P' || data[1] != 'X') return 0;  // <-- 99.9% of inputs die here
  // unless you ALSO ship a seed + dictionary so the fuzzer can get past the magic.

  Image img;
  // Decoder must run on the full buffer; let ASan/the decoder find the bug.
  img.DecodeFromMemory(data, size);   // no return-value gymnastics; the bug is inside
  return 0;
}
```

**Corpora are the most undervalued asset in the program.** The corpus encodes everything the fuzzer has *ever* learned about reaching deep states in your code. It is frequently worth more than CPU: a great seed corpus can take a target from 20% coverage to 60% in minutes, where raw CPU would take days. So:

- **Store corpora durably and centrally** — object storage (a GCS/S3 bucket), versioned, surviving repo migrations and CI rebuilds. A corpus that lives only on an ephemeral CI runner is gone the next build, and you restart cold every time.
- **Curate, don't hoard.** Run `-merge=1` (libFuzzer) / `afl-cmin` regularly to keep only inputs that add coverage. A bloated corpus slows every run in the fleet.
- **Seed from reality.** The best seeds are real-world samples of the format: sample images, captured protocol traffic, the test fixtures you already have. Public corpora exist for common formats — use them.
- **Promote crashes into a regression corpus.** Every minimized crash input becomes a permanent test case that runs forever, so a fixed bug can never silently return.

> **The asset mindset:** if a new engineer joined tomorrow, could they find every harness, run the fleet, and pull the shared corpus from a known location? If the answer is "the corpus is on Jane's old CI runner and the harnesses are scattered across three repos with no index," you don't have a program — you have some scripts. The corpus and the harness inventory are the durable capital; protect them like source code.

---

## Core Concept 3 — The Oracle Gap: Fuzzing Only Finds What You Can See

This is the most important idea on the page, and the one most teams learn the hard way. **A fuzzer is a search engine for inputs that trip an oracle. If your oracle is weak, the fuzzer is blind**, and you will conclude "our code is clean" when you have actually only proven "our code doesn't *crash* on these inputs." Those are wildly different statements.

The default oracle is "the process crashed" — a segfault, an abort. Compiled with a sanitizer, the oracle widens enormously: ASan turns a *silent* heap-overflow-that-didn't-crash into a hard abort; UBSan turns silent signed overflow and misaligned access into reports; MSan catches reads of uninitialized memory that no crash would ever reveal. **This is why fuzzing-without-a-sanitizer is mostly theater** for memory-safety work — most memory bugs don't crash on the spot; they corrupt and limp on. The sanitizer *is* the oracle.

But sanitizers only see *memory/UB* bugs. To find **logic** bugs — the parser that accepts a malformed input it should reject, the decoder that produces the wrong pixels, the serializer that doesn't round-trip — you must *add* oracles:

- **Assertions / contracts.** Every `assert(invariant)` you add is a new thing the fuzzer can violate. Internal invariants (lengths consistent, indices in range, state-machine transitions legal) turn into fuzzer-findable bugs. This is the cheapest oracle multiplier you have — see [06 — Runtime Assertions & Contracts](../06-runtime-assertion-and-contract-checking/professional.md).
- **Differential oracles.** Run two implementations on the same input and assert they agree: your parser vs a reference parser, your optimized path vs the slow reference, the new version vs the old. Any divergence is a bug. This finds entire *classes* of logic bugs sanitizers can't.
- **Round-trip oracles.** `decode(encode(x)) == x`, `parse(serialize(obj)) == obj`. Cheap to write, catches a startling number of real bugs.
- **Metamorphic oracles.** Properties that must hold across transformations (e.g., "re-compressing should not change the decompressed output").

```cpp
// A differential + round-trip harness — finds LOGIC bugs a sanitizer never would.
extern "C" int LLVMFuzzerTestOneInput(const uint8_t *data, size_t size) {
  Config a, b;
  bool ok_mine = parse_mine(data, size, &a);
  bool ok_ref  = parse_reference(data, size, &b);
  // Differential oracle: the two parsers must AGREE on accept/reject...
  assert(ok_mine == ok_ref);
  // ...and on the result when both accept.
  if (ok_mine && ok_ref) assert(a == b);
  // Round-trip oracle on the accepted value.
  if (ok_mine) {
    auto bytes = serialize(a);
    Config c;
    assert(parse_mine(bytes.data(), bytes.size(), &c) && c == a);
  }
  return 0;
}
```

> **The hard-won truth:** "we fuzzed for a year and found nothing" is, in my experience, *almost never* a clean-code result. It is a **weak-harness-or-missing-oracle** result. Either the harness `return`s early on most inputs (so the fuzzer never reaches the bug), the harness can't get past a magic-byte/checksum wall (Concept 4), or the oracle is just "didn't crash" and the bugs are logic bugs no one taught the fuzzer to see. Before you accept "nothing found," check coverage (is the interesting code even being executed?) and audit the oracle. Investing in oracles **multiplies the yield of every CPU-hour you were already spending.**

---

## Core Concept 4 — Continuous Fuzzing and the Crash Lifecycle

Fuzzing as a one-off run is a science fair. Fuzzing as a *program* is **continuous**: harnesses run constantly (or on a schedule), against a persistent shared corpus, with an automated loop that turns a raw crash into a filed, fixed, and regression-tested bug.

The canonical loop — and each step needs an owner and an SLA:

```
FIND      fleet/CI run hits a crash, captures the input + sanitizer report
  │
DEDUPE    cluster by crash signature (stack hash / sanitizer dedup key)
  │       — many raw crashes collapse to ONE bug; this is where flakiness bites
  │
MINIMIZE  tmin the input to the smallest bytes that still reproduce
  │
BISECT    git-bisect (or commit metadata) to find the introducing change
  │       → who/what introduced it, fast
  │
FILE      open a tracking bug with: minimized repro, stack, sanitizer output,
  │       offending commit. (Security-sensitive → restricted issue, see disclosure.)
  │
VERIFY    confirm the fix reproduces-then-doesn't on the minimized input
  │
REGRESS   add the minimized input to the permanent regression corpus
          → the fleet runs it forever; the bug can never silently return
```

**Where the program is wired** is the self-host-vs-hosted decision:

- **OSS-Fuzz** — if your project is open source, this is almost always the answer. Google runs ClusterFuzz for you, free: continuous fuzzing on a large fleet, automatic dedupe/minimize/bisect, automatic bug filing with a **90-day disclosure deadline**, and coverage reports. You write harnesses and a `Dockerfile`/`build.sh`; they run the fleet. Onboarding a real parser frequently surfaces dozens of bugs in the first week (see the war story).
- **ClusterFuzzLite** — the CI-embedded little sibling. Runs in GitHub Actions / GitLab CI on pull requests: replay the corpus + a few minutes of fuzzing per PR as a smoke test, with batch/scheduled deeper runs. The right entry point for closed-source repos that want fuzzing *in the pipeline* without standing up infrastructure.
- **Self-hosted ClusterFuzz** — full control, your own fleet, for closed-source at scale or when data can't leave your environment. Real operational cost: you own the cluster, the storage, the dedup pipeline, the upgrades.

**Three tiers of "how much" fuzzing**, which you mix:

1. **Per-PR smoke** (seconds–minutes): replay the regression corpus + a short fuzz burst on the changed targets. Catches the obvious regression *before merge*. Must be fast and non-flaky or developers will route around it.
2. **Scheduled deep runs** (hours, nightly/weekly): real exploration time on the full fleet against the shared corpus. Where most *new* bugs come from.
3. **Always-on fleet** (continuous): for the highest-value surfaces, run forever. This is what OSS-Fuzz gives open source by default.

> **The SLA discipline:** a continuous fuzzer that finds crashes faster than you triage them becomes noise, and a noisy dashboard gets ignored — at which point you're paying for CPU and learning nothing. Set explicit triage SLAs (e.g., *security-relevant crash → ack in 1 business day, owner assigned in 2*), and tie the fleet's *intake rate* to your *triage capacity*. It is better to run fewer targets you actually triage than a hundred targets whose crashes pile up unread. **Dedupe is load-bearing**: without solid crash-signature clustering, one flaky bug masquerades as hundreds of tickets and drowns the real findings.

---

## Core Concept 5 — The Economics: CPU Cost vs the Cost of a Shipped CVE

At the program level you will defend a budget. The argument is straightforward once you frame it correctly: **fuzzing CPU is cheap and a shipped memory-safety CVE is expensive**, and the gap is enormous.

A continuous fuzzing fleet might cost a few thousand dollars a month in CPU — spot/preemptible instances make it cheaper still, and fuzzing is *embarrassingly parallel* and perfectly suited to interruptible capacity. Against that, the loaded cost of a single shipped, exploitable memory-safety vulnerability includes: the emergency-patch engineering scramble, the coordinated disclosure and CVE process, customer notification and trust damage, regulatory exposure, and the opportunity cost of every engineer pulled onto the fire. Heartbleed-class bugs cost the industry collectively in the *hundreds of millions*. You do not need precise numbers; the asymmetry is the point. **One prevented critical CVE pays for years of fleet.**

But "more CPU is cheap" is not a license to throw money at it forever, because of **diminishing returns and the coverage plateau**. Every target follows the same curve: coverage rises fast, then flattens. Past the plateau, additional CPU buys almost no new coverage — you are paying to re-explore states you already cover. The professional skill is reading the plateau and knowing *which lever to pull*:

| The plateau says… | …and the right move is | …not |
|---|---|---|
| Coverage is flat, interesting code is *unreached* | Fix the **harness** (early-`return`s, wrong API), add **seeds**, add a **dictionary**/CMP feedback | Buy more CPU (it'll re-explore the shallow region) |
| Coverage is flat but the format is structured/checksummed | **Structure-aware** mutator (protobuf-mutator, grammar) or split the checksum out of the harness | Buy more CPU |
| Coverage is genuinely high, oracle is just "crash" | Add **assertions / differential / round-trip oracles** | Buy more CPU |
| Coverage high, oracles rich, still flat | *Now* more CPU / longer runs may help; or accept this target is mined out and reallocate | Keep one target pinned forever |

> **The allocation principle:** CPU is the cheap lever; **harness quality, seeds, structure-awareness, and oracles are the high-leverage levers.** The instinct when a target stops finding bugs is "give it more cores." Nine times out of ten the bottleneck is the harness or the oracle, and the right move is an afternoon of engineering — a better seed, a dictionary, one new invariant — that does more than a 10× CPU increase ever would. Spend CPU to *explore*; spend engineering to *unblock and to widen the oracle*.

---

## Core Concept 6 — The Sanitizer Matrix for Fuzzing

Because the sanitizer *is* the oracle for memory bugs, **which sanitizer(s) you build the fuzz target with is a first-class program decision** — and they have hard can't-combine constraints you must plan around.

| Sanitizer | Flag | Catches | Fuzzing notes |
|---|---|---|---|
| **ASan** | `-fsanitize=address` | Heap/stack/global OOB, use-after-free, double-free | The default fuzzing oracle. ~2× slowdown, ~3× RAM. Pair with **LeakSanitizer** (on by default) for leaks. |
| **UBSan** | `-fsanitize=undefined` | Signed overflow, misaligned access, bad shifts, `null` deref, type confusion | Cheap; **combine with ASan** for free extra coverage. Use `-fno-sanitize-recover=all` so UB *aborts* (becomes a crash the fuzzer counts). |
| **MSan** | `-fsanitize=memory` | Reads of **uninitialized** memory | High-value, but **cannot combine with ASan**, and needs *all* dependencies (including libc++) MSan-instrumented or you drown in false positives. A separate build. |
| **TSan** | `-fsanitize=thread` | Data races | Rarely used in classic single-input fuzzing (one input = one thread); relevant for concurrency harnesses. Cannot combine with ASan. |

**The constraints that shape your build matrix:**

- **ASan + MSan cannot coexist** — they both rewrite memory layout incompatibly. You run **separate fuzz builds**: one ASan(+UBSan+LSan), one MSan. OSS-Fuzz does exactly this.
- **MSan demands a fully-instrumented stack.** Any non-MSan dependency feeding the target produces uninitialized-read false positives. This is why MSan fuzzing is more work and often deferred until the ASan build is mined out.
- **ASan + UBSan + LSan is the standard "first build."** Most teams start here: it's the broadest cheap oracle. `-fsanitize=address,undefined -fno-sanitize-recover=undefined`.
- **Performance is part of the budget.** ASan halves throughput and triples RAM — relevant when you're sizing the fleet. Sometimes a fast no-sanitizer build explores breadth and feeds its corpus to slower sanitizer builds for the actual oracle pass.

> **The matrix discipline:** the right default is **ASan + UBSan + LSan as the primary continuous build**, with an **MSan build added once the ASan build plateaus** for surfaces where uninitialized-memory disclosure is a real risk (anything that copies parsed bytes into a response — the Heartbleed shape). Don't try to "turn everything on" in one binary; the toolchain won't let you, and you'd misread the throughput hit as a fleet problem. See [01 — AddressSanitizer](../01-address-sanitizer-asan/professional.md) and [03 — UndefinedBehaviorSanitizer](../03-undefined-behavior-sanitizer-ubsan/professional.md) for the per-sanitizer depth.

---

## War Stories

**The Heartbleed a one-day harness would have caught.** CVE-2014-0160 was an out-of-bounds *read* in OpenSSL's TLS heartbeat handler: a length field from the attacker, copied without checking it against the actual payload size, leaking up to 64 KB of process memory per request. A heartbeat-message parser is exactly the high-value surface from Concept 1 — a protocol handler over fully-attacker-controlled bytes. A trivial harness feeding random bytes into the heartbeat path, *compiled with ASan*, would have aborted on the over-read on day one. The bug shipped not because it was subtle but because **that surface had no harness and the oracle (plain crash) couldn't see an over-read that didn't segfault** — ASan would have. The whole episode is the canonical argument for "harness your protocol handlers, and make the sanitizer your oracle."

**The checksum wall that made the fuzzer find nothing.** A team harnessed a binary file format and let it run for a week: near-zero coverage growth, zero bugs. The format started with a 4-byte magic and a CRC32 over the body — so *every* mutated input failed validation in the first 20 lines and bailed before reaching the actual parser. Raw mutation has no chance of guessing a valid CRC. Two fixes unblocked it: (1) a **dictionary** (`-dict=`) with the magic bytes plus **CMP feedback** (libFuzzer's `trace-cmp` / AFL++'s **CmpLog**) so the mutator could "solve" the magic comparison, and (2) **removing the checksum check from the harness** (recompute it inside the harness after mutation, or compile it out) so the fuzzer could explore the parser without fighting the CRC. Coverage went from flat to climbing within minutes, and the parser bugs poured in. The lesson: **a coverage plateau near zero is a wall, not clean code** — find the comparison the mutator can't pass and remove it or feed it.

**The OSS-Fuzz onboarding that found dozens in week one.** A mature, well-tested open-source parsing library onboarded to OSS-Fuzz — a few harnesses, a `build.sh`, a `Dockerfile`. Within the first *week* the fleet filed dozens of distinct crashes: OOB reads on malformed inputs, integer overflows in length math, a use-after-free on an error path. This was not bad code; it was code that had only ever been tested with *valid, human-authored* inputs. Continuous coverage-guided fuzzing with ASan explored the malformed-input space no test suite had touched. The takeaway for the program: **the first deep fuzz of any real parser finds a backlog** — budget triage capacity for the onboarding spike, and don't read "we found 40 bugs" as alarming; read it as the latent backlog finally becoming visible.

**The harness that "fuzzed clean" because it returned early.** A service had a fuzz target on its request parser, green for months, zero findings — quietly cited as evidence the parser was solid. A coverage report told the real story: the harness covered **~3%** of the parser. The first lines did `if (size < HEADER_LEN) return 0;` and then `if (memcmp(data, EXPECTED_MAGIC, 8) != 0) return 0;` — with **no seed and no dictionary**, essentially every input died at the magic check and never reached the parser. The fuzzer had been heroically testing the early-return path for months. Fix: add a real seed corpus and a magic dictionary; coverage jumped past 60% and the first genuine bug appeared within an hour. The lesson burned into the program afterward: **"found nothing" must be checked against coverage** — a clean fuzzer with 3% coverage is a broken harness wearing a green badge.

**The flaky-crash dedup nightmare.** A newly-stood-up self-hosted fleet started filing *hundreds* of crash tickets a day, and the triage rotation drowned. Almost all of them were one non-deterministic bug — a crash that depended on allocation address / hash-map iteration order — producing a slightly different stack trace each time, so the dedup key (stack hash) never matched and every occurrence looked unique. The signal (a handful of *real* distinct bugs) was buried under noise. Fixing it meant making the target **deterministic** (pin the allocator/hash seed under fuzzing) and improving the **dedup signature** (normalize stacks, cluster on top-N frames). Intake dropped from hundreds to single digits and the real bugs surfaced. The lesson: **dedupe and determinism are load-bearing infrastructure**, not nice-to-haves — a fleet you can't dedupe is a fleet you can't triage, and an untriaged fleet is wasted money.

---

## Decision Frameworks

**What to harness first? Score each surface:**

| Surface | Attacker controls input? | Non-trivial parsing/pointer work? | Priority |
|---|---|---|---|
| Custom binary/wire-format parser | Yes | Yes | **Harness now** |
| Deserializer of untrusted data | Yes | Yes | **Harness now** |
| Image/audio/video/compression codec | Yes | Yes | **Harness now** |
| Network protocol handler (TLS/HTTP2/DNS) | Yes | Yes | **Harness now** |
| Regex/template engine on user patterns | Yes | Yes | High |
| Internal data structure, trusted callers only | No | Maybe | Low (consider property tests instead) |
| Pure arithmetic / pure function, no untrusted input | No | No | Skip — wrong tool |

**Per-PR smoke vs scheduled vs continuous?**

| Use… | When | Cost | What it catches |
|---|---|---|---|
| **Per-PR smoke** (replay corpus + minutes) | Every PR touching a fuzzed target | Seconds–minutes/PR | Obvious regressions before merge; *must* be fast + non-flaky |
| **Scheduled deep runs** (hours, nightly) | All targets, off-peak | Moderate, batchable | Most *new* bugs; the workhorse |
| **Always-on fleet** | Highest-value / most-exposed surfaces | Continuous CPU | Deep, rare states; default for open source via OSS-Fuzz |

**Coverage plateaued → what to change?**

| Observation | Change |
|---|---|
| Interesting code unreached, coverage near zero | Harness early-`return`s? wrong API? → fix harness |
| Stuck at a magic/checksum comparison | Add **dictionary** + **CMP feedback/CmpLog**; remove checksum from harness |
| Structured/length-prefixed format | **Structure-aware** mutator (protobuf-mutator / grammar) |
| High coverage, only crash oracle | Add **assertions / differential / round-trip** oracles |
| High coverage, rich oracles, still flat | More CPU *may* help; or accept mined-out and **reallocate** |

**Which oracle to add for which surface?**

| Surface | Add this oracle |
|---|---|
| Memory-touching parser/decoder (C/C++) | **ASan + UBSan** (the sanitizer *is* the oracle) |
| Code that copies parsed bytes into output (Heartbleed shape) | **MSan** (uninitialized-read disclosure) |
| Two implementations exist (new vs old, yours vs reference) | **Differential** oracle |
| Encode/decode or serialize/parse pair | **Round-trip** oracle |
| Rich internal invariants (state machine, length consistency) | **Assertions / contracts** |

**Self-host vs OSS-Fuzz vs ClusterFuzzLite?**

| Choose… | When |
|---|---|
| **OSS-Fuzz** | Open source; want a free large fleet + auto dedupe/bisect/filing + coverage; accept 90-day disclosure |
| **ClusterFuzzLite (CI)** | Closed source; want fuzzing *in the pipeline* (PR smoke + scheduled) without running infra |
| **Self-hosted ClusterFuzz** | Closed source at scale, or data can't leave your environment; you can own a cluster + storage + dedup + upgrades |

---

## Mental Models

- **Fuzzing is a search engine for inputs that trip an oracle.** Its yield is bounded by what the oracle can see. Strengthen the oracle (sanitizers, assertions, differential, round-trip) and the *same* CPU finds far more. A weak oracle makes a powerful fuzzer blind.

- **"Found nothing" is a hypothesis to disprove, not a result.** Before you believe a target is clean, check **coverage** (is the interesting code even executing?) and audit the **oracle**. The overwhelmingly likely explanation is a harness that returns early, a wall the mutator can't pass, or an oracle that's just "didn't crash."

- **The harness and the corpus are durable capital.** They encode everything the program has learned. Owned, reviewed, version-controlled, stored centrally. A corpus on an ephemeral runner and harnesses scattered across repos is not a program — it's some scripts that will rot.

- **Harness your trust boundaries, in attack-surface order.** Parsers, deserializers, decoders, protocol handlers — anything that turns untrusted bytes into structure. ~70% of critical vulns are memory-safety, and they live here. Fuzz what's *exposed*, not what's *easy to harness*.

- **CPU explores; engineering unblocks and widens.** A coverage plateau is usually a harness/seed/oracle problem, not a CPU problem. The afternoon spent on a better seed, a dictionary, or one new invariant beats a 10× core increase.

- **Continuous, deduped, regression-fed — or it's a science fair.** A one-off run finds a few bugs and rots. A program runs forever, dedupes crashes into bugs, and promotes every fix into a regression corpus so it can never return.

---

## Common Mistakes

1. **Fuzzing what's easy instead of what's exposed.** A tidy pure-functional library gets a harness while the hand-rolled upload parser that touches every external byte sits un-fuzzed. **Map trust boundaries first; harness in attack-surface order.**

2. **Reading "found nothing in a year" as clean code.** It is almost always a weak harness (early `return`), a wall the mutator can't pass, or a "didn't crash" oracle missing logic bugs. **Check coverage and audit the oracle before believing it.**

3. **Fuzzing without a sanitizer.** Most memory bugs don't crash on the spot — they corrupt and limp on. Without ASan/UBSan/MSan the oracle is blind to exactly the bugs you care about. **The sanitizer is the oracle.**

4. **Treating the corpus as scratch data.** A corpus that lives on an ephemeral CI runner is gone next build and you restart cold every time. **Store it durably and centrally, curate with `-merge=1`, seed from reality.**

5. **Unowned, unmaintained harnesses.** API drifts, the harness stops compiling, it's silently disabled, and the green dashboard hides an un-fuzzed surface. **Harnesses are reviewed, owned code that lives with what they test.**

6. **Ignoring the magic-byte/checksum wall.** A coverage plateau near zero is a wall, not clean code. **Add a dictionary + CMP feedback/CmpLog, or remove the checksum from the harness.**

7. **Intake rate exceeding triage capacity (no dedupe, no SLA).** Crashes pile up unread, the dashboard gets ignored, and you pay for CPU to learn nothing. **Solid dedupe + a triage SLA; run fewer targets you actually triage over many you don't.**

8. **Trying to combine ASan and MSan in one build.** The toolchain won't allow it. **Run separate fuzz builds (ASan+UBSan+LSan, and a separate MSan build).**

---

## Test Yourself

1. Your org can write 5 harnesses this quarter across a codebase of 300 services. What two questions do you ask of each candidate surface, and which surface types top the list — and why?
2. A target has fuzzed for a year with zero findings, and a teammate cites it as proof the code is clean. What is the *more likely* explanation, and what two things do you check before accepting "clean"?
3. A fuzzer's coverage is flat near zero on a binary format that begins with a magic number and a CRC32. Diagnose it and give two concrete fixes.
4. Why is fuzzing-without-a-sanitizer mostly theater for memory-safety work? What does ASan add that a plain crash oracle misses, and what does MSan add that ASan misses?
5. You want to find *logic* bugs (a parser that accepts what it should reject) that no sanitizer can see. Name two oracle types that find them and sketch a harness using one.
6. Defend the fuzzing budget to a skeptical finance partner in three sentences. Then explain why "more CPU" is *not* always the right response to a plateau.
7. Walk the find→regress crash lifecycle and name the step that, if done poorly, drowns your triage rotation in noise.
8. Your project is open source and you want continuous fuzzing with automatic dedupe, bisect, and bug filing, for free. What do you use, and what disclosure constraint comes with it? How would the answer change for a closed-source repo that just wants fuzzing in CI?

<details>
<summary>Answers</summary>

1. Ask **(1) does an attacker control the input?** and **(2) does the code do non-trivial parsing/pointer work on it?** Two yeses → harness early. Top types: **parsers, deserializers, decoders/codecs, protocol handlers** — anything turning untrusted bytes into structure — because ~70% of critical vulnerabilities are memory-safety bugs and they cluster there. Fuzz what's *exposed*, not what's *easy*.

2. Far more likely a **weak harness or missing oracle** than clean code. Check: **(a) coverage** — is the interesting code even being executed (a harness that `return`s early or can't pass a magic check covers ~3% and tests nothing useful)? **(b) the oracle** — is it just "didn't crash," missing logic bugs and silent memory corruption? Investigate both before believing "clean."

3. It's a **checksum/magic wall**: every mutated input fails the CRC/magic in the first lines and bails before reaching the parser, so coverage never grows. Fixes: **(1) add a dictionary (`-dict=`) with the magic + enable CMP feedback (`trace-cmp` / AFL++ CmpLog)** so the mutator can solve the comparisons; **(2) remove the checksum check from the harness** (recompute inside, or compile it out) so the fuzzer can explore the parser.

4. Most memory bugs **don't crash on the spot** — they corrupt memory and continue, so a plain crash oracle never sees them. **ASan** turns silent heap/stack OOB and use-after-free into immediate aborts (a crash the fuzzer counts). **MSan** adds detection of reads of **uninitialized** memory — the Heartbleed-shape disclosure bug — which ASan does *not* catch. (ASan and MSan can't combine, so MSan is a separate build.)

5. **Differential** (run two implementations on the same input, assert they agree on accept/reject and result) and **round-trip** (`parse(serialize(x)) == x`). Sketch: in `LLVMFuzzerTestOneInput`, call `parse_mine` and `parse_reference` on the same bytes, `assert(ok_mine == ok_ref)`, and `assert(result_mine == result_ref)` when both accept — any divergence is a logic bug.

6. *"A continuous fleet costs a few thousand a month in CPU — mostly cheap interruptible capacity. One shipped, exploitable memory-safety CVE costs orders of magnitude more in emergency patching, disclosure, customer trust, and regulatory exposure. One prevented critical CVE pays for years of fleet."* "More CPU" isn't always right because of the **coverage plateau**: past it, extra CPU re-explores known states and finds almost nothing. The bottleneck is usually the **harness, seeds, structure-awareness, or oracle** — engineering levers — not cores.

7. **Find → Dedupe → Minimize → Bisect → File → Verify → Regress.** The step that drowns triage if done poorly is **Dedupe**: without solid crash-signature clustering (and a deterministic target), one flaky bug yields a slightly different stack each time and looks like hundreds of unique tickets, burying the real findings.

8. **OSS-Fuzz** — Google runs ClusterFuzz for you free, with auto dedupe/minimize/bisect, bug filing, and coverage; the constraint is a **90-day disclosure deadline**. For a closed-source repo wanting fuzzing in CI without running infra, use **ClusterFuzzLite** (PR smoke + scheduled runs in GitHub Actions/GitLab CI); at larger closed-source scale or when data can't leave, **self-host ClusterFuzz**.

</details>

---

## Cheat Sheet

```
WHAT TO HARNESS FIRST (two-question test)
  attacker controls input?  AND  non-trivial parsing/pointer work?
    yes + yes → harness NOW: parsers, deserializers, codecs, protocol handlers
  ~70% of critical vulns are memory-safety, and they live on these surfaces

THE ORACLE IS THE CEILING
  crash only ........ misses silent corruption + all logic bugs
  + ASan/UBSan ...... memory/UB bugs (the standard memory oracle)
  + MSan ............ uninitialized reads (Heartbleed shape; separate build)
  + assertions ...... internal-invariant violations  (cheapest multiplier)
  + differential .... new vs old / yours vs reference disagree
  + round-trip ...... parse(serialize(x)) == x
  "found nothing" → CHECK COVERAGE + AUDIT ORACLE, don't assume clean code

PLATEAU? CHANGE THE RIGHT LEVER
  unreached code .......... fix harness (early return / wrong API)
  magic/checksum wall ..... -dict=  + CMP feedback / AFL++ CmpLog; drop checksum
  structured format ....... structure-aware mutator (protobuf-mutator/grammar)
  high cov, weak oracle ... add assertions / differential / round-trip
  rich + still flat ....... MORE CPU may help, or reallocate (mined out)
  RULE: CPU explores; engineering unblocks + widens the oracle

CRASH LIFECYCLE (each step owned, with SLA)
  find → dedupe → minimize(tmin) → bisect → file → verify-fixed → regress-corpus
  dedupe is load-bearing: bad signatures + nondeterminism = noise that drowns signal

SANITIZER MATRIX (can't-combine!)
  primary build : -fsanitize=address,undefined  (+ LSan)  -fno-sanitize-recover=undefined
  second build  : -fsanitize=memory   (MSan)   <-- CANNOT combine with ASan
  ASan ~2x slow, ~3x RAM (size the fleet for it)

WHERE TO RUN IT
  open source ............. OSS-Fuzz (free fleet, auto dedupe/bisect/file; 90-day disclosure)
  closed, want CI ......... ClusterFuzzLite (PR smoke + scheduled)
  closed at scale / private  self-hosted ClusterFuzz (you own cluster+storage+dedup)
  tiers: per-PR smoke (mins) | scheduled deep (hrs) | always-on (highest-value surfaces)

ECONOMICS
  fleet ≈ low thousands $/mo (cheap, interruptible, embarrassingly parallel)
  one shipped memory-safety CVE = orders of magnitude more
  ⇒ one prevented critical CVE pays for years of fleet
```

---

## Summary

- **Picking the attack surface is the first allocation decision.** Harness parsers, deserializers, decoders, and protocol handlers — anything turning untrusted bytes into structure — in attack-surface order, because ~70% of critical vulnerabilities are memory-safety bugs and they cluster there. Fuzz what's *exposed*, not what's *easy to harness*; coverage reports of *un-fuzzed surface* are your prioritization tool.
- **Harnesses and corpora are durable, owned assets.** Harnesses are reviewed code that lives with what they test and must stay deterministic and free of early `return`s; corpora are stored centrally and durably, curated with `-merge=1`, and seeded from real-world data. Every fixed bug's minimized input becomes a permanent regression-corpus entry.
- **The oracle is the ceiling on yield.** A fuzzer only finds what the oracle can see. ASan/UBSan make memory/UB bugs visible (the sanitizer *is* the oracle); assertions, differential, and round-trip oracles add the logic bugs sanitizers can't see. **"We fuzzed for a year and found nothing" almost always means a weak harness or missing oracle — check coverage first.**
- **A program is continuous, deduped, and regression-fed**: find → dedupe → minimize → bisect → file → verify → regress, each step owned with a triage SLA. Mix per-PR smoke, scheduled deep runs, and an always-on fleet for the highest-value surfaces. Dedupe is load-bearing — without it, one flaky bug drowns the signal.
- **The economics favor fuzzing overwhelmingly** — a fleet costs low-thousands a month against an order-of-magnitude-larger cost per shipped CVE — but more CPU is the *wrong* answer to a coverage plateau, where the real bottleneck is usually the harness, seeds, structure-awareness, or oracle.
- **The sanitizer matrix has hard constraints**: ASan+UBSan+LSan is the standard primary build; MSan is valuable but cannot combine with ASan and needs a fully-instrumented stack, so it's a separate build added once the ASan build is mined out.

You can now stand up and run a continuous fuzzing program as a security, economic, and operational concern — not just point a fuzzer at a function. The remaining tier — [interview.md](interview.md) — distills the topic into the questions that probe whether someone actually understands all of this.

---

## Further Reading

- [OSS-Fuzz documentation](https://google.github.io/oss-fuzz/) — the canonical guide to onboarding, harness shape, build integration, and the dedupe/bisect/disclosure workflow that defines "continuous fuzzing as a program."
- [ClusterFuzzLite](https://google.github.io/clusterfuzzlite/) — embedding per-PR smoke fuzzing and scheduled batch runs in your CI without standing up full infrastructure.
- [Google's "Fuzzing" guidance and the libFuzzer / AFL++ docs](https://github.com/google/fuzzing) — corpus management, dictionaries, structure-aware fuzzing, and harness anti-patterns from the team that runs the largest fuzzing fleet.
- *The Fuzzing Book* (Zeller et al.) — coverage-guided mutation, grammar/structure-aware fuzzing, and oracles, with runnable depth.
- Retrospectives on CVE-2014-0160 (Heartbleed) and the OSS-Fuzz bug-bash blog posts — live case studies in "the harness you didn't write" and "the backlog the first deep fuzz reveals."
- [interview.md](interview.md) — the same material distilled into interview questions.

---

## Related Topics

- [01 — AddressSanitizer (ASan)](../01-address-sanitizer-asan/professional.md) — the primary memory oracle for fuzzing, and its throughput/RAM cost when sizing a fleet.
- [03 — UndefinedBehaviorSanitizer (UBSan)](../03-undefined-behavior-sanitizer-ubsan/professional.md) — the cheap oracle you combine with ASan; `-fno-sanitize-recover` to make UB a countable crash.
- [06 — Runtime Assertions & Contracts](../06-runtime-assertion-and-contract-checking/professional.md) — assertions as the cheapest oracle multiplier, turning internal invariants into fuzzer-findable bugs.
- [Testing](../../testing/) — where per-PR fuzz smoke and the regression corpus plug into the broader test strategy.
- [Security](../../../../Security/) — the disclosure workflow and supply-chain context a fuzzer-found exploitable bug feeds into.
