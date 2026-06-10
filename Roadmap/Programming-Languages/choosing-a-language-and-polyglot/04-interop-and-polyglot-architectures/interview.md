# Interop & Polyglot Architectures — Interview Q&A

A graded set of questions, from "what does polyglot mean?" to a staff-level interop-strategy design. The interviewer is testing whether you treat language boundaries as *liabilities with recurring costs* (not free abstractions), whether you can pick the right interop mechanism for a given coupling, and whether you can govern polyglot at org scale. Each answer includes a model response and **what it signals.**

---

## Section A — Foundations (1–4)

**Q1. What does "polyglot architecture" mean, and when is it a good idea?**

A: A polyglot system is built from more than one programming language — the common case being a Python ML service, a Go or Java API tier, and a TypeScript frontend, all in one product. It's a good idea when each component has a genuinely different shape and the language choice is *forced or strongly favored* by that shape: ML lives in Python's ecosystem, the browser only runs JS/TS, a hard-real-time component wants Rust. It's a *bad* idea when languages accrete without justification — a Ruby service because one engineer liked Ruby, a Scala service from a hackathon — because every language is a permanent tax on toolchains, hiring, and on-call.

The honest one-liner: polyglot is correct when the *capability* a language provides is irreplaceable and worth a forever-tax; it's sprawl when it isn't.

*What it signals:* whether the candidate sees polyglot as both a capability *and* a cost, rather than just "use the best tool." A junior answer stops at "best tool for the job"; a strong answer names the tax in the same breath.

---

**Q2. Two services are in different languages. What's the simplest way to make them cooperate, and why is it the default?**

A: Put each in its own process and have them exchange messages over the network — typically REST + JSON, or gRPC internally. It's the default because the OS process boundary gives you fault isolation, independent deployment, and *language independence* for free: the only thing the two sides share is the message shape, not any code. Any language ever made can speak HTTP and parse JSON, so the boundary works universally. The languages literally don't know the other exists — one serializes a request, the other deserializes it.

*What it signals:* understanding that the network boundary's superpower is *decoupling* — that "they don't share a language, they share a contract" is the whole point. A weak answer describes the mechanics of HTTP without naming why isolation matters.

---

**Q3. What's the first hidden cost of going polyglot that teams underestimate?**

A: The toolchain multiplication. The moment the system is polyglot, the *team* is polyglot: a second package manager, a second CI pipeline, a second runtime to deploy and patch, a second body of on-call knowledge, and a second hiring requirement — all permanent. None is a disaster alone; together they're a steady drag I'd call the polyglot tax. It's invisible on day one (when you just needed ML, so Python was obviously right) and very visible on day 400 (when a CVE means auditing two dependency trees with two tools, and the Go on-call engineer can't profile the Python service).

*What it signals:* whether the candidate thinks past the build to the *operate/hire/maintain* horizon, where the real cost lives.

---

**Q4. Name the main interop mechanisms and place them on a spectrum.**

A: From loosely coupled/slow to tightly coupled/fast:

```
Message queue → REST/JSON → gRPC/protobuf → sockets/shared mem → FFI (in-process)
 async, decoupled                                                  function call, no serialization
```

As you move right: latency drops, coupling rises, blast radius grows (an FFI crash kills the whole process; a queue consumer crashing doesn't touch the producer). Queues for async work (image processing, ETL); REST at public edges for debuggability; gRPC for internal hot paths where you want a typed contract; FFI only for hot, stable native libraries like NumPy. There's also runtime-level polyglot — JVM, .NET — where multiple languages share one heap and interop is a plain method call with near-zero cost.

*What it signals:* breadth, and the key insight that the choice is a *coupling-vs-latency* trade, not a "which is best" ranking.

---

## Section B — Mechanisms and tradeoffs (5–9)

**Q5. When would you use FFI (cgo, JNI, ctypes, PyO3) instead of a network call, and what are you giving up?**

A: Only when two things are both true: the call is *hot* — invoked so often that per-call network overhead (µs–ms each) dominates the actual work — and the native code is *mature and stable* enough to trust inside your address space. NumPy clears both bars: the inner loops run millions of times, and the underlying C/Fortran is battle-tested. What you give up is the big one: **fault isolation.** A network boundary is a bulkhead — when the other side OOMs, you get a clean `UNAVAILABLE`. With FFI, a buffer overrun in the native code segfaults your *entire* process; there's no bulkhead. You also lose both languages' memory-safety guarantees at the seam (manual pointer ownership, no shared GC), gain a fragile ABI dependency, and complicate the build (cgo, famously, kills Go's clean static cross-compilation).

So my own evolving business logic almost never justifies FFI; a stable native library in a genuinely hot path occasionally does.

*What it signals:* mature risk assessment. The trap is a candidate who reaches for FFI "for speed" without weighing fault isolation. The senior answer leads with what's *lost*, not what's *gained*.

---

**Q6. Why is a shared schema (protobuf, Avro, JSON Schema) important, and what makes it more than just documentation?**

A: It turns an informal handshake into a machine-checked, versioned contract. It does three jobs: it's the single source of truth (both sides generate their types from one `.proto`, so they *can't* disagree about field names or types); it generates idiomatic code in every language, deleting the drift-prone hand-written DTOs each side would otherwise maintain; and it encodes schema-*evolution* rules — which changes are safe (adding an optional field) versus breaking (renaming-by-reuse, changing a type, reusing a field number).

The thing people miss: it's not the choice of REST vs gRPC that makes polyglot safe — it's the schema on the boundary. An unenforced JSON API is a verbal agreement that rots on the third silent field-name typo.

*What it signals:* whether the candidate knows the contract — not the protocol — is the load-bearing part of safe interop.

---

**Q7. What's the most dangerous mistake you can make evolving a protobuf schema, and why?**

A: Reusing or changing a field *number*. protobuf's wire format keys off the numeric tag, not the field name — that's *why* you can rename `model` to `model_name` freely (old clients still match tag 2). But if you change tag 2 from a `string` to a `double`, or reuse a retired tag 2 for a new field, you corrupt *every* deployed client at once, because they'll decode the new bytes against their old type. Renaming is safe; renumbering and type-changes are catastrophic. The discipline is "field numbers are forever" — reserve retired numbers explicitly (`reserved 2;`) so no one reuses them.

*What it signals:* hands-on schema-evolution experience. This is the kind of thing you only know if you've been burned or read carefully — a strong discriminator.

---

**Q8. A service makes a million fine-grained JSON-over-HTTP calls to another service in a loop. It's slow. Diagnose and fix.**

A: This is a chatty-boundary problem: the serialization (JSON encode/decode is several times costlier than protobuf) plus a network round-trip per call (tens of µs on localhost, ms cross-DC) dwarfs the actual work. Two fixes, in order of preference: first, **batch** — send 1,000 items per request instead of one, which amortizes the round-trip and serialization across the batch and is usually a 10–100× win for almost no architectural change. Second, if it's still hot after batching and the relationship is genuinely tight, consider moving the boundary right on the spectrum — gRPC/protobuf to cut serialization cost, or eliminating the boundary via FFI/co-location if profiling proves the hop itself is the floor. But I'd batch first and measure before reaching for FFI's sharp edges.

*What it signals:* whether the candidate reaches for the cheap, safe fix (batching) before the expensive, risky one (FFI), and whether they profile round-trip *count*, not just per-call time.

---

**Q9. What is runtime-level polyglot, and how does it change the interop math?**

A: It's multiple languages compiled to the *same runtime*, sharing one heap, one GC, and one type system — Java/Kotlin/Scala/Clojure on the JVM, C#/F# on .NET, GraalVM's polyglot context, Elixir/Erlang/Gleam on BEAM. Because the languages are already speaking the same bytecode, "interop" is a plain method call with *zero* serialization and no network hop. A Kotlin class calls a Java class directly. This collapses the *machine-level* boundary cost to near zero, which is exactly why "polyglot on the JVM" is so common and so cheap relative to polyglot across the network.

The catch: you're cheap-polyglot only within that runtime's gravity well — Kotlin-to-Python is still a network or FFI problem. And the *human* costs (two languages to hire for and review) remain; only the machine cost vanishes.

*What it signals:* knowing that not all polyglot is equally expensive, and that "monoglot core, polyglot edges" sometimes means "one runtime, several languages on it."

---

## Section C — Org-level and judgment (10–14)

**Q10. How do you cross-language *debug* a request that fails deep in a polyglot call chain?**

A: The honest answer is: it's hard, and you only get to do it if you invested *before* the incident. A stack trace dies at every language boundary — a failure in the Python service surfaces in Go as a generic RPC error, not a Python traceback. To reconstruct the causal chain you need three things in place: distributed tracing (OpenTelemetry) with `traceparent` context propagated at *every* hop — one service that drops it and the trace splits in two; a *mandated* structured-log schema so you can correlate logs across Go's `slog`, Python's `logging`, and Java's Logback by request ID; and a deliberate error contract so the Python error arrives as a meaningful gRPC status, not "INTERNAL, 500." Polyglot's real tax is paid in *incident time*, not request latency, and observability across boundaries is the precondition that keeps that tax bounded.

*What it signals:* operational maturity — the candidate has felt the 3 a.m. pain and knows observability is a precondition, not a nice-to-have.

---

**Q11. How do you tell principled polyglot from sprawl? Give the test.**

A: The test for any language in the system: *"What would we lose if this were rewritten in our primary language, and is that loss worth the toolchain, hiring, and on-call tax it imposes forever?"* If the answer is "we'd lose the entire ML ecosystem" (Python) or "the browser physically can't run anything else" (TS), it's principled — the capability is irreplaceable. If the answer is "nothing really, it's just history — an engineer who's since left liked it," it's sprawl, and it's a consolidation candidate. Two systems can both have four languages; one is a deliberate set of forced choices, the other is an uncoordinated museum. The number of languages isn't the diagnostic — the *justification per language* is.

*What it signals:* judgment over dogma. A weak candidate says "polyglot is good" or "monolith is better"; a strong one gives a *test* that distinguishes the two cases.

---

**Q12. How would you govern language choices across an engineering org of 200?**

A: A written, owned, tiered supported-languages list — supported (first-class: shared libs, CI templates, observability, on-call all exist), allowed-with-justification (permitted via an ADR + review, team owns the gaps), exception/sunset (legacy or acquired, not for new work), and not-supported (needs an approved exception). It has a named owner and a periodic review. Crucially, adding to "supported" is an explicit, *funded* commitment — it obligates the platform team to build and maintain that language's toolchain forever, which is why the list stays short. This shifts every debate from "is Rust good?" (religious war) to "is this component's need worth us owning a Rust toolchain in perpetuity?" (an economic question with an answer). And I'd recognize that most polyglot is a Conway's-law outcome — so I'd also shape *team structure* to produce the architecture I want, not just police it after the fact.

*What it signals:* whether the candidate can operate at org scale — governance with exceptions, funded commitments, and Conway's-law awareness, rather than a blanket ban or a free-for-all.

---

**Q13. What's the role of a platform team in a polyglot org, and why does the supported-languages list have to be short?**

A: The platform team absorbs the cross-cutting tax *once* so product teams don't pay it N times: a shared schema registry with CI-enforced compatibility checks, shared observability (mandated log schema, OTel config, trace propagation), per-language CI/CD golden-path templates, and shared cross-cutting libraries (auth, retry, metrics) maintained in every supported language. A language is genuinely "supported" only when there's a paved road for it — otherwise "supported" is a slogan. That's exactly why the list must be short: every entry is a standing commitment of finite platform capacity. A list of three supported languages is a real, fundable promise; a list of ten is a fiction that rots, because no platform team can maintain ten golden paths, ten auth libraries, and ten sets of vuln-scanning.

*What it signals:* understanding that "support" is a capacity commitment, and connecting governance (the list) to investment (the platform team).

---

**Q14. (Staff-level design.) Design the interop strategy for a system with a Python ML core and a latency-critical serving path.**

A: I'd start by separating two concerns that get conflated: *training/experimentation* (offline, Python-heavy, latency-insensitive) and *serving* (online, latency-critical). They want different interop.

**Training/experimentation** stays fully in Python — the ecosystem is irreplaceable, and there's no latency pressure. It produces a *model artifact* (a serialized model, ONNX, or a compiled graph), which is the contract handed to serving.

**Serving** is where the interesting decision lives, and I'd lay out the spectrum:

1. **Python ML service behind gRPC, separate process** (the default). The latency-critical API (say Go) calls the Python predictor over gRPC with a shared `.proto`. Pros: fault isolation, independent scaling and deploy, typed contract. Cons: a network hop and serialization per prediction, plus Python's GIL limiting per-process concurrency. I'd start here and *measure*.

2. **If the gRPC hop is the proven bottleneck**, options in order of increasing coupling:
   - **Batch predictions** — score many requests per call to amortize the hop. Often closes the gap with zero architectural risk.
   - **Co-locate as a sidecar** — Python predictor on the same host/pod, talking over a Unix domain socket to cut network latency while *keeping process isolation* (a crash still doesn't kill the API).
   - **Export the model out of Python entirely** — compile to ONNX and run inference in the serving language via ONNX Runtime, or use a Rust/C++ inference engine via FFI. This deletes the Python boundary on the hot path: training stays Python, serving doesn't run Python at all. This is the strongest answer for truly latency-critical paths — the model becomes a *data artifact*, not a *service*, and the language boundary disappears.

3. **FFI (embedding Python in the serving process)** I'd explicitly *reject* — the GIL, the crash-takes-down-the-API risk, and the build pain make it the worst of both worlds for a latency path.

The governing principle: **the model is the contract.** Whether it crosses as a gRPC message, a batched call, or a compiled ONNX artifact is a latency-driven decision I'd make by measurement — starting at the loosely-coupled, fault-isolated end (separate gRPC service) and tightening only when profiling forces it, with "export the model so serving isn't polyglot at all" as the endgame for the hottest paths.

*What it signals:* the staff-level moves — separating training from serving, treating the model as the contract, starting loosely-coupled and tightening on evidence, knowing the ONNX/export escape hatch that removes the boundary entirely, and explicitly rejecting the tempting-but-wrong FFI option.

---

## How to use this list

A 30-minute screen: one from A, one from B, one from C. A 45-minute senior loop: Q5, Q8 or Q10, Q11, and the Q14 design. The signal you're listening for across all of them is consistent: does the candidate treat a language boundary as a **liability with a recurring, multi-currency cost** (serialization, two debuggers, error impedance, on-call), and can they reason about *where* on the coupling spectrum a given relationship belongs? Candidates who say "use the best tool for the job" and stop are junior. Candidates who say it *and* immediately price the tax, name the observability precondition, and start loosely-coupled-then-tighten are operating at senior/staff level.

---

**Summary line:** every interop question reduces to one trade — coupling and safety versus latency — and every polyglot question reduces to one test — is this language's irreplaceable capability worth its forever-tax? Defend boundaries as liabilities, default to network isolation, put a schema on every seam, and start loosely-coupled and tighten only on evidence.
