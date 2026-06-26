# What Metaprogramming Is — Interview Questions

> **Topic:** [What Metaprogramming Is](README.md)

---

## Introduction

These questions probe whether a candidate truly understands metaprogramming — programs that read, generate, or transform programs (or themselves) — or merely recognizes the buzzwords. The decisive signal is whether the candidate can place any technique on the field's two organizing axes: *when* the meta-level runs (compile/build-time vs runtime) and *what* it does (generate code vs inspect/alter existing code). A strong candidate reasons about staging, knows why different languages sit at different points on the spectrum (Go's deliberate minimalism, Rust's compile-time macros, Python's runtime dynamism, Lisp's homoiconicity), and treats reflection and `eval` as concrete cost and security trade-offs rather than magic. A weaker candidate says "it's code that writes code" and stops.

The questions move from foundational vocabulary, through language-specific surfaces (Rust, Java, Python, Go, Lisp/C++), into traps where the obvious answer is wrong, and finally to design scenarios that reveal whether the candidate has actually *built* or *operated* systems that lean on metaprogramming.

## Table of Contents

- [Conceptual / Foundational](#conceptual--foundational)
- [Language-Specific](#language-specific)
- [Tricky / Trap Questions](#tricky--trap-questions)
- [Design / Scenario](#design--scenario)

---

## Conceptual / Foundational

## Question 1

**What is metaprogramming, in one precise sentence?**

Metaprogramming is writing code whose input or output is itself code — programs that read, generate, or transform programs (including themselves). The ordinary program is the "base level" that does the work; the metaprogram is the "meta level" that operates on the base level. A good answer immediately distinguishes the two levels and gives a concrete example (a decorator wrapping a function, a derive macro generating an `impl`, reflection inspecting a class).

## Question 2

**What is the single most important axis for classifying metaprogramming techniques?**

*When the meta level runs* — compile-time/build-time versus runtime. This timing determines almost everything else: performance (build-time work is free at runtime), safety (build-time errors are caught before shipping), and flexibility (runtime techniques can react to information only available while running). Macros, templates, annotation processors, and code generators are build-time; reflection, metaclasses, dynamic proxies, monkeypatching, and `eval` are runtime. A candidate who leads with this axis understands the field's structure.

## Question 3

**Distinguish introspection from intercession.**

Introspection is *observing* a program's structure at runtime: asking what type an object is, what fields or methods a class has, whether an annotation is present. It is read-only and relatively safe. Intercession is *modifying* structure or behavior at runtime: adding a method to a live class, replacing a function (monkeypatching), generating a proxy that intercepts every call. Introspection scales to large teams; intercession is powerful but creates action-at-a-distance and needs discipline. Both are forms of reflective metaprogramming.

## Question 4

**Distinguish generative from reflective metaprogramming.**

Generative metaprogramming *produces new code*: macros, code generators, templates, `#[derive]`. Its output is more code. Reflective metaprogramming *inspects or alters existing code/objects*: reflection, metaclasses, proxies. Many tools mix both — a framework might reflect over your class and generate a proxy — but the distinction helps classify what you're looking at. Combined with the compile-time/runtime axis, these two slices place any technique on a 2×2 map.

## Question 5

**What is homoiconicity, and why is Lisp the canonical example?**

Homoiconicity means a language's code is written in the same structure as its data. In Lisp, `(+ 1 2)` is literally a list of three elements; code *is* a list. Because of this, a Lisp program manipulates code using the exact same operations it uses on any data (list operations), so "writing code that writes code" is just "writing a function that builds a list." This makes Lisp macros the purest form of metaprogramming — there is no gap between "code" and "manipulable data." Most other languages bolt metaprogramming on with special machinery (reflection APIs, dedicated macro syntax) because their code and data have different representations.

## Question 6

**What is quoting and quasiquotation, and why are they needed?**

To manipulate code as data, you need a way to say "treat this as a value, don't run it" — that's quoting. In Lisp, `'(+ 1 2)` is the list, not the number 3. Quasiquotation extends this with splice points: ``` `(+ 1 ,x) ``` is the code `(+ 1 ...)` with the value of `x` inserted. This is the core mechanism of every macro system (Rust's `quote!` is the same idea); it's the bridge between "code" and "data you can build and transform programmatically."

## Question 7

**Why do languages differ so much in how much metaprogramming they allow?**

Because each made a deliberate bargain. Go minimizes metaprogramming (only `reflect` and `go generate`, no macros) to prioritize readability, greppability, and tooling — "what you read is what runs." Rust pushes metaprogramming to compile time (hygienic macros) for zero runtime cost and safety. Python maximizes runtime flexibility (mutable classes, metaclasses, monkeypatching, `eval`) for framework expressiveness. C++ uses templates and `constexpr` for compile-time computation. Lisp makes it the native idiom via homoiconicity. The position on the spectrum reflects what the language optimized for, not an accident.

## Question 8

**Name three famous frameworks and the metaprogramming technique each relies on.**

Spring/Hibernate (Java): annotations + runtime reflection + dynamic proxies. serde (Rust): `#[derive]` macros generating serialization code at compile time. Django/Rails: metaclasses and dynamic method generation at runtime. gRPC/protobuf: build-time code generation of typed stubs from a schema. Mocking libraries (Mockito, unittest.mock): runtime dynamic proxies. The point of the question is to confirm the candidate sees that everyday "magic" is metaprogramming with a specific, nameable mechanism underneath.

## Question 9

**What is the fundamental trade-off metaprogramming imposes?**

Generative power and DRY-ness versus comprehensibility, debuggability, and tooling. Metaprogramming lets you write a rule once and apply it everywhere, eliminating boilerplate — but generated, expanded, or rewritten code is harder to read, harder to step through in a debugger, and harder for IDEs to navigate. A mature answer frames this as a *budget* spent continuously, measured against the comprehension of the least experienced maintainer, not the author.

## Question 10

**What is multi-stage programming?**

Multi-stage programming (MSP) is structuring a program so that some computation runs at an earlier stage to *generate* the code that runs at a later stage, with the stages made explicit and ideally type-checked. C++ template metaprogramming, Rust `const fn` and macros, and Zig's `comptime` are practical points on this continuum (MetaML/MetaOCaml are the research roots). The mental model: part of the program's job is to write the rest of the program. It's the principled version of "do work early to make later work fast."

## Question 11

**Is self-modifying code the same as metaprogramming? Is it still used?**

Classic self-modifying code literally rewrote its own machine instructions in memory — historically for space savings or early JITs. It is essentially obsolete on modern hardware because it fights instruction caches, branch predictors, and security defenses (W^X: memory is writable *or* executable, not both). Genuine instruction rewriting today is confined to JIT compilers and a few specialized runtimes. When people say "self-modifying" now, they almost always mean ordinary runtime metaprogramming (a program reshaping its own objects/classes), not literal instruction rewriting. So: it's one historical corner of metaprogramming, not a synonym for it.

## Question 12

**Why prefer build-time metaprogramming over runtime when both are possible?**

Build-time work is paid once and produces zero runtime cost; errors are caught before shipping; the output is real code that's AOT-compilable and (if checked in) debuggable. Runtime metaprogramming costs something on every call, can fail in production, and is in tension with ahead-of-time compilation and tree-shaking. The guiding rule is to choose the *earliest stage that still has the information you need* — only push to runtime the parts that genuinely depend on runtime-only information (loaded plugins, config, actual data shapes).

---

## Language-Specific

## Question 13

**Rust:** Walk through what happens, stage by stage, when you write `#[derive(Serialize)]`.

At compile time, the attribute is read and dispatched to serde's procedural macro, which receives the struct's token stream, parses it, and *generates* an `impl Serialize for YourType` (a `serialize` method that visits each field). That generated impl is then type-checked and monomorphized like hand-written code. By the time the program runs, there is no reflection and no "magic" — just ordinary compiled, specialized code. This is closed-world, compile-time, generative metaprogramming, and it's why serde has zero runtime reflection cost. A strong answer notes that an error in the generated impl can surface confusingly far from the `#[derive]` line, which is why span/provenance handling matters.

## Question 14

**Rust:** What is macro hygiene and why does it matter?

Hygiene is the guarantee that identifiers a macro introduces cannot accidentally capture, or be captured by, identifiers in the user's code. Without hygiene (as in C's textual preprocessor), a macro that introduces a temporary variable `tmp` could clash with a user's `tmp`, producing silent bugs. Rust's `macro_rules!` and procedural macros are hygienic by construction, so expansions are safe even when names collide. This is one of the concrete reasons syntactic/hygienic macros are preferred over textual ones.

## Question 15

**Java:** What's the difference between an annotation with `SOURCE` retention and one with `RUNTIME` retention?

The retention policy declares *which stage consumes the annotation*. `SOURCE` retention means the annotation is visible only to the compiler and annotation processors (build-time) and is discarded before runtime — used for code generation and compile-time checks. `RUNTIME` retention means the annotation survives into the running program and is readable via reflection — used by frameworks like Spring that scan and act on annotations at startup. Choosing the wrong retention silently breaks the feature: a `SOURCE`-retained annotation is invisible to runtime reflection. This single distinction is the "when does the meta level run?" axis made concrete in the language.

## Question 16

**Java:** How do dynamic proxies work, and what's the classic gotcha?

`Proxy.newProxyInstance` generates a class *at runtime* that implements given interfaces and routes every method call through an `InvocationHandler`. Spring uses this (or CGLIB bytecode generation) to add transactions, logging, and AOP "around" your beans. The classic gotcha is *self-invocation*: when a method on the target object calls another method on the same object via `this`, the call goes to the real object, not the proxy, so any proxy-applied behavior (`@Transactional`, advice) on the inner method is silently skipped. This is a structural consequence of proxy-based intercession being a runtime wrapper rather than a language construct.

## Question 17

**Python:** What is a metaclass, and when do you actually need one?

A metaclass is the "class of a class" — it controls how classes themselves are constructed. When you write `class Foo(metaclass=Meta)`, Python calls `Meta` to build the `Foo` class object, letting you inspect or inject methods, register the class, validate it, or rewrite its namespace at class-creation time. Django models and SQLAlchemy's declarative base use metaclasses to turn declarations into full ORM machinery. You rarely *need* one — decorators and `__init_subclass__` cover most cases more simply — and the honest senior answer is "almost never write your own; use the framework's." Reaching for a metaclass when a class decorator would do is a yellow flag.

## Question 18

**Python:** Does the GIL or any language feature make `eval(user_input)` safe?

No. `eval`/`exec` run arbitrary code with the full privileges of the process; `eval("__import__('os').system('...')")` is remote code execution. Nothing about Python's runtime sandboxes it. The safe pattern, when you must evaluate user expressions, is a constrained, allow-listed evaluator built on `ast.parse` that permits only specific node types and operators — closing the injection class by construction. At scale this becomes a lint rule banning `eval`/`exec`/`compile` outright. A candidate who treats `eval` casually is a red flag.

## Question 19

**Go:** Why does Go deliberately omit macros, and what does it offer instead?

Go's designers prioritized readability, fast compilation, and tooling — "what you read is what runs." Macros would let code mean something other than what it textually says, hurting greppability, IDE navigation, and onboarding at scale. Instead, Go offers the `reflect` package for *runtime introspection* and `go generate` for *build-time code generation* that produces real, readable, checked-in `.go` files you can step through. The bargain: more boilerplate in exchange for predictability and tool-friendliness. This is the clearest example in the question set of metaprogramming policy being a deliberate language design choice.

## Question 20

**Go:** When would you use `reflect` versus `go generate` for the same problem (say, a serializer)?

Use `reflect` when you need to handle types not known at build time (open-world) or when the path is cold and flexibility matters — but it's slow per call and walks type metadata every time. Use `go generate` to *shift the work to build time*: emit a specialized, allocation-free encoder per type that does no reflection at runtime. The idiom encodes the staging trade-off: reflection for flexibility at the boundary, codegen for speed on hot paths, with the generated file being real source you can read and debug. A strong answer names the cost difference (runtime reflection overhead vs zero) and the visibility benefit of generated code.

## Question 21

**Lisp:** Why are Lisp macros considered more powerful than macros in most other languages?

Because of homoiconicity: Lisp code *is* data (lists), so a macro receives its arguments as ordinary lists of code and builds new code with the same list operations used for any data, via quasiquotation. There's no separate macro DSL, no special AST API — manipulating code is manipulating data. This makes Lisp macros able to introduce entirely new control structures and syntactic abstractions with minimal ceremony. Other languages' macros are powerful (Rust's are hygienic and AST-aware) but operate over a representation distinct from ordinary data, which is more machinery for the same core idea.

## Question 22

**C++:** How is template metaprogramming a form of compile-time metaprogramming, and what changed with `constexpr`?

Template metaprogramming computes with types and values *at compile time*: the compiler instantiates templates, and through specialization and recursion you can perform arbitrary computation (compute constants, generate specialized code per type via monomorphization, enforce constraints). Historically this was powerful but produced famously inscrutable errors and abused the type system to do value computation. `constexpr` (and later `consteval`/`if constexpr`) let you write *ordinary-looking imperative code* that runs at compile time, making compile-time computation far more readable than template recursion. Both are generative, compile-time metaprogramming; `constexpr` is the more humane interface to it.

---

## Tricky / Trap Questions

## Question 23

**"An annotation makes my class cacheable." True or false?**

False as stated. An annotation is *inert data* attached to code; by itself it does nothing. Something must *read* it — an annotation processor at build time or a reflection scan at runtime (e.g., a Spring proxy wired to `@Cacheable`). Many "why isn't my annotation working?" bugs are simply "nothing is reading it" (the framework isn't enabled, the bean isn't proxied, the retention is wrong). The trap catches candidates who conflate the label with the behavior. The correct framing: annotation = data; the reader = behavior; find the reader.

## Question 24

**"My reflection-based code works in dev but throws `ClassNotFoundException` in the native-image build." Why?**

Because closed-world AOT compilers (GraalVM native-image, aggressive tree-shakers, R8/ProGuard) strip code that appears unreachable — and code reached only by *name* (`Class.forName(s)`, reflective method lookup) looks dead to them. It works under a JIT (open world) and fails under AOT (closed world). The fixes are to supply reflection-config/keep-rules that re-declare the reachable names, or better, to replace the reflective lookup with build-time code generation so nothing is reached by name. This is the reflection-vs-AOT collision, and it's the dominant migration challenge in modern JVM ecosystems.

## Question 25

**"Build-time metaprogramming has no security implications since it's just compilation." True or false?**

False, and dangerously so. Macros, `build.rs`, annotation processors, and codegen plugins *execute arbitrary code during the build*, on developer machines and in CI, with access to environment variables, secrets, filesystem, and network. A malicious or compromised transitive build-time dependency is a supply-chain attack vector — structurally like npm install-script attacks. Most organizations review runtime dependencies but not build-time-executing ones, which is a real gap. Build-time metaprogramming must be sandboxed, hermetic, and dependency-reviewed.

## Question 26

**"Generated code is reviewed because we review every PR." Likely false — why?**

Because generated code is typically *trusted, not reviewed*: nobody reads the 400k lines `protoc` emits, and SAST/secret scanners often skip "generated" paths entirely — a blind spot. The trust boundary actually moves *upstream*: you review the schema and pin the generator version, and CI verifies that regeneration produces identical output (no drift, no hand-edits to "DO NOT EDIT" files). A candidate who claims line-by-line review of generated code either hasn't operated codegen at scale or is describing an unrealistic process.

## Question 27

**"`#define SQUARE(x) x*x` is fine." What's wrong?**

Textual macros don't understand expressions, so `SQUARE(a+b)` expands to `a+b*a+b`, which is `a + (b*a) + b`, not `(a+b)²`. And `SQUARE(i++)` increments twice. The naive fix (`((x)*(x))`) helps with precedence but not double-evaluation. The real lesson is that textual (preprocessor) macros operate on tokens with no scope, type, or hygiene awareness — exactly why hygienic/syntactic macros (Lisp, Rust) and `inline`/`constexpr` functions are preferred. The trap reveals whether the candidate understands *why* textual macros are the unsafe end of the spectrum.

## Question 28

**"We use only atomics and no locks, so it's lock-free." Wait — wrong topic. Try: 'We replaced reflection with codegen, so startup is instant.' Always true?**

Not necessarily. Codegen removes *runtime reflection* cost, which helps startup, but startup can still be dominated by other work (large static initializers, eager singletons, loading huge generated classes, JIT warm-up of generated code under a JVM). And codegen shifts cost to *build time*, which can balloon CI minutes and binary size. The honest answer measures rather than assumes: profile cold start to confirm reflection was the bottleneck, and watch the build/binary cost you traded for it. The trap catches candidates who treat "codegen" as a magic word for "fast."

## Question 29

**"Monkeypatching is just a Python thing and always works." True?**

False on both counts. Runtime intercession exists in many dynamic languages (Ruby, JavaScript), and even in Python it doesn't always work: C-extension types, classes using `__slots__`, and frozen/immutable types resist patching. Intercession is not universal even in flexible languages, and where it does work it creates action-at-a-distance that must be scoped, reversible, and documented. The trap reveals whether the candidate understands intercession as a capability with limits and risks rather than a free-for-all.

## Question 30

**"Reflection is slow, so it's always the wrong choice." True?**

False. Reflection is slow *per call*, which makes it a bad choice in hot loops — but it's perfectly appropriate at startup/config time, at the dynamic boundary (plugin loading, deserializing unknown shapes), and where flexibility genuinely requires open-world behavior. The disciplined pattern is to *cache* reflective lookups once (resolve a method handle or field accessor at startup) and reuse the cheap handle, or to push the work to build-time codegen when the world is closed. "Always wrong" is dogma; "wrong in hot paths, fine at boundaries, cache it" is judgment.

---

## Design / Scenario

## Question 31

**Design the serialization story for a new internal RPC framework. Where does the metaprogramming go?**

Strong answers reason about staging and the world model. Prefer *build-time code generation from a schema* (protobuf-style): closed-world, zero runtime reflection, AOT/native-image-friendly, fast cold start, and the generated stubs are real code that's debuggable and security-scannable. Govern it by trusting the schema + pinning the generator + a CI regeneration check (fail on drift). Reserve runtime reflection only for a genuinely dynamic boundary (e.g., decoding an unknown envelope), and confine it there to keep the world mostly closed. The candidate should explicitly weigh build cost vs runtime cost and mention provenance so on-call can debug a generated stub.

## Question 32

**Your JVM services have a 12-second cold start dominated by reflective classpath scanning, and you're moving to a serverless platform. What do you do?**

This is a reflection→AOT migration framed as a cost problem. The cost model: startup ms × invocations × instances — on serverless, that reflective tax is the dominant line item, paid every invocation. The fix is to shift wiring from runtime reflection to build-time generation: compile-time DI (Dagger/Micronaut/Spring-AOT), native-image where viable, and re-closing the world by enumerating every name-based reflection site and converting it to codegen or a declared keep-rule. The candidate should anticipate that reflection-assuming transitive dependencies will break, that the migration is a whole-dependency-graph effort, and that they must own keep-rule maintenance. Bonus: set per-platform policy (serverless mandates build-time wiring; the legacy monolith can keep runtime flexibility).

## Question 33

**A team wants to add a custom proc-macro / annotation-processor framework to your shared build platform. What's your review?**

Evaluate it as granting a *privilege*: build-time code execution runs on every developer's machine and in CI with access to secrets and the network — a supply-chain surface. Require it to be hermetic (no network, pinned, reproducible), reviewed and pinned as a dependency, and gated through security review. Ask what *capability* it needs: generative and type-checked (good) or arbitrary intercession (scrutinize). Ask about provenance: do its errors point back to human source? Demand a regeneration/determinism check if it emits checked-in code. The strong candidate treats the proposal as an access-control and supply-chain decision, not just a productivity feature.

## Question 34

**When would you choose Go's no-macro philosophy over Rust's compile-time macros for a new project, or vice versa?**

Looking for judgment about the language's bargain matching the team and problem. Go's restraint (no macros, `reflect` + `go generate`) suits large teams, fast onboarding, and codebases where greppability and "what you read is what runs" matter more than eliminating every line of boilerplate — at the cost of more verbosity. Rust's compile-time hygienic macros suit performance-critical, correctness-critical systems where zero-cost abstraction and compile-time guarantees justify the added power and the occasional inscrutable error. A candidate who says "Rust is always better because macros are powerful" or "Go is always better because it's simpler" is showing dogma; the right answer ties the choice to team size, performance needs, and tolerance for build-time complexity.

## Question 35

**Design a code-review/policy checklist for metaprogramming in a large organization.**

A mature checklist: every metaprogramming construct names its *stage* (build vs runtime) and its *capability* (introspect vs intercede vs execute-strings); `eval`/`exec` on untrusted input and native deserialization of untrusted bytes are banned by policy-as-code; build-time-executing dependencies go through dependency review and run hermetically; generated code is governed by input (reviewed schema + pinned generator + CI regeneration check) and included in security scanning; runtime reflection is cached and confined to boundaries, with keep-rules owned if AOT is in play; provenance is preserved so incidents are triagable; policy is set *per platform* (serverless vs monolith) because cost and threat models differ; and clever metaprogramming is calibrated to the least-experienced maintainer, with documented, owned escape hatches for exceptions. The signal is that the candidate treats metaprogramming as an organizational concern with cost, security, and governance dimensions — not just a coding technique.

## Question 36

**Someone proposes solving a boilerplate problem with a runtime metaclass that injects methods into every model class. Talk through whether you'd approve it.**

Start by questioning the premise: is metaprogramming warranted at all, or would a base class, a mixin, a class decorator, or `__init_subclass__` be simpler and more legible? If metaprogramming is justified, weigh stage (runtime intercession is the heaviest-capability, action-at-a-distance option) and prefer the smallest capability that works. Check provenance (can a failure in an injected method be traced to source?), the comprehension cost for the least-experienced maintainer, and whether the pattern is the framework's blessed idiom (Django-style) or a homegrown mechanism only the author understands. Approve a metaclass only when the boilerplate is large and repeated, the framework idiom calls for it, and it's documented; otherwise push to the simpler mechanism. The strong answer demonstrates that "can we metaprogram this?" and "should we?" are different questions.
