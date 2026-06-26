# What Metaprogramming Is — Tasks & Exercises

> **Topic:** [What Metaprogramming Is](README.md)

---

## Introduction

These exercises build the one skill this topic exists to teach: **seeing metaprogramming for what it is, and placing any technique on the two organizing axes** — *when does the meta level run?* (compile/build-time vs runtime) and *what does it do?* (generate code vs inspect/alter existing code). You'll classify real-world magic, build tiny metaprograms in several languages, reason about staging and cost, and confront the security and governance angles.

They are ordered roughly junior → professional. Each task has a **self-check box**, a **hint** (collapsed in spirit — read it only if stuck), and a **sparse solution sketch** (the idea, not a full copy-paste answer). Do the classification tasks even if you skip the coding ones — classification is the load-bearing skill.

How to use this page:

- Try each task before reading the hint.
- For coding tasks, *run* your code and watch the stage you expected actually happen.
- For the "open the output" tasks, genuinely open the generated/expanded code — that habit demystifies the whole field.

---

## Section A — Classification (do all of these)

### Task A1 — Place 12 techniques on the 2×2 map

- [ ] For each technique, write down two answers: **stage** (compile/build-time or runtime) and **kind** (generative or reflective): (1) Python decorator, (2) Rust `#[derive(Debug)]`, (3) Java runtime reflection, (4) C preprocessor `#define`, (5) `go generate`, (6) Python metaclass, (7) Java dynamic proxy, (8) C++ template, (9) `eval`/`exec`, (10) protobuf stub generation, (11) Python monkeypatching, (12) Lisp macro.

**Hint:** Ask "did it finish before the program ran, or is it happening live?" and "does it make new code, or inspect/alter existing code?" Some (decorators, metaclasses, proxies) are *both* generative and reflective.

**Solution sketch:** build-time/generative: `#[derive]`, `#define`, `go generate`, C++ template, protobuf gen, Lisp macro. runtime/reflective: Java reflection, monkeypatching. runtime/generative: `eval`/`exec`. runtime/both: decorator, metaclass, dynamic proxy.

### Task A2 — Find the reader

- [ ] Take three annotations/decorators you've used (e.g. `@app.route`, `@Override`, `@Transactional`). For each, name *what reads it* and *at which stage*. State what happens if nothing reads it.

**Hint:** An annotation is inert data. The behavior comes from a reader: an annotation processor (build) or a reflection scan / proxy (runtime).

**Solution sketch:** `@app.route` → the framework's router, at import/startup (runtime). `@Override` → the compiler (build-time check; does nothing at runtime). `@Transactional` → a Spring proxy at runtime. If nothing reads an annotation, it's a no-op — a common "my annotation is ignored" bug.

### Task A3 — Closed-world vs open-world

- [ ] Classify each as relying on a *closed world* (all types known at build) or an *open world* (types appear at runtime): serde derive, a plugin system loading `.so`/`.jar` files at runtime, gRPC stub generation, Java native deserialization, Rust monomorphized generics. Note which ones are compatible with AOT/native-image without keep-rules.

**Hint:** Open-world techniques reach code by name at runtime; closed-world techniques have everything visible at build.

**Solution sketch:** closed (AOT-friendly): serde derive, gRPC gen, monomorphized generics. open (needs reflection/keep-rules, AOT-hostile): runtime plugin loading, native deserialization.

---

## Section B — Build Tiny Metaprograms

### Task B1 — Introspection (any language)

- [ ] Write a function that takes *any* object and prints its type name, its fields, and its method names — without knowing the type in advance. (Python: `vars`, `dir`, `type`. Go: `reflect`. Java: `getClass().getDeclaredFields/Methods`.)

**Self-check:** Pass it two completely different classes and confirm it works on both with no per-type code.

**Hint:** This is pure runtime introspection — the same mechanism a JSON serializer or a DI container's scan uses.

**Solution sketch (Python):**
```python
def describe(obj):
    print(type(obj).__name__)
    print(vars(obj))
    print([m for m in dir(obj) if not m.startswith("_")])
```

### Task B2 — A logging decorator (runtime, generative+reflective)

- [ ] Write a decorator/wrapper that logs each call (name + args) to a function, then forwards to the original. Apply it to two functions.

**Self-check:** The decorated function still returns the right value; the log line appears on every call.

**Hint:** The decorator takes a function *as data*, returns a new function that wraps it. It runs once (at import/definition); the wrapper runs per call.

**Solution sketch (Python):**
```python
def log_calls(f):
    def w(*a, **k):
        print(f"calling {f.__name__} {a}")
        return f(*a, **k)
    return w
```

### Task B3 — Reflection-driven test runner (Java or Python)

- [ ] Define a `@Test` annotation/marker. Write a runner that, given a class, *finds every method marked as a test* and calls it — using reflection. This is JUnit/pytest in miniature.

**Self-check:** Add a non-test method; confirm the runner ignores it. Add a second test; confirm both run.

**Hint:** Java: `RUNTIME` retention + `getDeclaredMethods()` + `isAnnotationPresent` + `invoke`. Python: a decorator that tags `func._is_test = True`, then iterate `dir`.

**Solution sketch:** loop over the class's methods; for each, check the marker; if present, `invoke`/call it.

### Task B4 — Compile-time generation (Rust derive OR Go generate)

- [ ] **Rust:** add `#[derive(Debug, Clone)]` to a struct and use both. Then run `cargo expand` (install `cargo-expand`) and *read the generated impls.* **Go:** use `//go:generate stringer -type=...` on an int enum, run `go generate`, and *open the generated `_string.go` file.*

**Self-check:** You can point to the exact generated function that printing/cloning/`String()` calls.

**Hint:** The whole point is to *see* that "magic" is just ordinary generated code with no runtime reflection.

**Solution sketch:** the expanded `impl Debug` is a `write!` over each field; the `stringer` output is a `switch`/array mapping enum values to name strings.

### Task B5 — A homoiconic macro (Lisp) or a quasiquote demo

- [ ] In a Lisp (Clojure, Common Lisp, Scheme), write a `my-unless` macro using quasiquotation that expands to an `if`. Macroexpand it and confirm the expansion.

**Self-check:** `(macroexpand '(my-unless cond body))` shows the `if` form you expected; the macro behaves like an inverted `if`.

**Hint:** Backquote builds a code template; comma splices in arguments. The macro returns *code* (a list), which the compiler then runs.

**Solution sketch (Common Lisp):**
```lisp
(defmacro my-unless (c body) `(if ,c nil ,body))
```

---

## Section C — Staging & Cost Reasoning

### Task C1 — Predict the stage from the symptom

- [ ] For each symptom, say whether the metaprogramming is build-time or runtime, and why: (a) "the error points at code I never wrote, during `cargo build`"; (b) "the error is a `NoSuchMethodError` thrown when a user clicks a button"; (c) "the build takes 4 minutes longer after adding this crate"; (d) "the first request after deploy is slow, then it's fast."

**Hint:** Build-time symptoms appear during compilation/CI; runtime symptoms appear while serving. (d) is JIT warm-up / reflective startup.

**Solution sketch:** (a) build-time (macro/template). (b) runtime (reflection). (c) build-time (heavy generation/monomorphization). (d) runtime (reflective scan + JIT warm-up).

### Task C2 — The CapEx/OpEx multiplication

- [ ] A service has a 300ms reflective cold start. It runs as a serverless function invoked 50 million times/day, and the platform bills per-invocation including startup. Estimate the daily startup time spent. Then argue what changes if you move wiring to build-time codegen (assume cold start drops to 10ms).

**Self-check:** You produced a concrete number and a one-line argument tying it to the AOT migration.

**Hint:** 0.3s × 50M = total startup-seconds/day. Compare to 0.01s × 50M.

**Solution sketch:** ~15,000,000 startup-seconds/day (~174 machine-days) vs ~500,000 (~5.8 days) — a ~30× reduction. This is precisely why the industry shifts reflection to build-time generation (native-image, Spring-AOT, Dagger).

### Task C3 — Reflection → AOT break

- [ ] Write (or describe) a snippet that loads a class by name from config (`Class.forName(...)` or equivalent) and instantiates it. Explain why this works under a JIT but can fail under GraalVM native-image / aggressive tree-shaking, and give two fixes.

**Hint:** Closed-world optimizers strip code reached only by name.

**Solution sketch:** the optimizer sees no static reference to the class → marks it dead → strips it → `ClassNotFoundException` at runtime. Fix 1: reflection-config/keep-rule re-declaring the name. Fix 2 (better): replace the reflective lookup with build-time code generation so nothing is reached by name.

---

## Section D — Security & Governance

### Task D1 — Turn an `eval` RCE into a safe evaluator

- [ ] Start from `def compute(expr): return eval(expr)`. Demonstrate (in writing) why `compute("__import__('os').system('echo pwned')")` is remote code execution. Then implement a constrained evaluator using `ast.parse` that allows only numbers and `+ - *`, and reject everything else.

**Self-check:** Your evaluator computes `"2*3+4"` correctly and raises on anything containing a call, name, or attribute access.

**Hint:** Walk the AST; allow only `Constant` and `BinOp` with an allow-listed operator set; raise on any other node type.

**Solution sketch:** recursive `ev(node)` over `ast.parse(expr, mode="eval").body`; a dict mapping `ast.Add/Mult/Sub` to `operator` functions; raise `ValueError` for unsupported nodes. No `eval`, no arbitrary code possible.

### Task D2 — Build-time supply-chain threat model

- [ ] List everything a malicious `build.rs` (Rust) or `setup.py` (Python) or annotation processor could do during your CI build. Then propose three controls that bound the risk.

**Hint:** Build-time code runs with the privileges of the build environment.

**Solution sketch:** threats — read CI secrets/env vars, exfiltrate over the network, modify the produced artifact, plant a backdoor. controls — hermetic/network-restricted build sandbox; pin + vendor + dependency-review every build-time-executing dependency; reproducible-build verification so tampering is detectable.

### Task D3 — Generated-code governance in CI

- [ ] Design the CI guarantee that a `protoc`/`buf`/`stringer` pipeline's checked-in output always matches its schema. Write the two-step check.

**Self-check:** A hand-edit to a generated "DO NOT EDIT" file, or a stale stub after a schema change, fails CI.

**Hint:** Regenerate in CI and diff.

**Solution sketch:**
```bash
go generate ./...          # or: buf generate
git diff --exit-code       # non-empty diff → fail: drift or hand-edit detected
```
Trust = reviewed schema + pinned generator version + this determinism check. Also: include generated files in SAST.

### Task D4 — Write a metaprogramming policy (one page)

- [ ] Draft an organization-wide policy answering: which techniques are allowed; which are banned outright; how build-time dependencies are reviewed; how generated code is governed; how runtime reflection is handled under AOT; and how the policy differs for a serverless platform vs a long-lived monolith.

**Hint:** Reuse the professional-level material: ban `eval`/native-deserialization of untrusted input; govern codegen by input; per-platform cost/threat models.

**Solution sketch:** banned: `eval`/`exec` and native deserialization of untrusted input (lint-enforced). build-time deps: dependency-review gate + hermetic sandbox. codegen: review schema + pin generator + CI regen check + SAST coverage. reflection: cache + confine to boundaries + own keep-rules under AOT. per-platform: serverless mandates build-time wiring; monolith may keep runtime flexibility. escape hatches: documented, with named owners.

---

## Section E — Synthesis / Challenge

### Task E1 — Same feature, three stages

- [ ] Pick one feature — say, "make any struct printable as a debug string." Implement or sketch it three ways: (1) runtime reflection (Go `reflect` / Python `vars`), (2) compile-time generation (Rust `#[derive(Debug)]` / Go codegen), (3) a textual macro (C `#define`, and note why it's the worst). For each, state stage, kind, cost, and one failure mode.

**Self-check:** You can articulate why (2) is usually best (zero runtime cost, AOT-friendly, debuggable output) and why (3) is the unsafe end (no scope/type/hygiene awareness).

**Hint:** This is the whole topic in one exercise: the same goal sits at different points on both axes with different trade-offs.

**Solution sketch:** (1) runtime/reflective — flexible, open-world, slow per call, fails by reflecting a type that's been stripped under AOT. (2) build-time/generative — zero runtime cost, AOT-safe, errors can point at generated code (mitigate with spans). (3) build-time/generative but textual — token substitution, no hygiene; classic `SQUARE(a+b)` precedence/double-eval bugs.

### Task E2 — Demystify a real framework

- [ ] Pick one framework you use (Spring, Django, serde, gRPC, a mocking library). Write a paragraph identifying every metaprogramming technique it uses and the stage each runs at. Then state how you would debug a failure that originates in its "magic."

**Hint:** Frameworks *compose* techniques across stages. Read the framework as a staging diagram.

**Solution sketch (Spring):** annotations (data) + runtime classpath-scan reflection (discovery) + dynamic proxies/bytecode-gen (transactions, AOP) + increasingly build-time AOT. Debug by: identifying which layer the failure is in (is the bean proxied? is the annotation read? is self-invocation bypassing the proxy?), reading provenance (stack trace into `$Proxy...`), and reproducing at the boundary.

### Task E3 — The "should we?" decision

- [ ] You have 200 model classes that each need an identical `to_dict()` method. Write a short decision memo: would you use a base class, a class decorator, a metaclass, codegen, or hand-written methods? Justify by stage, capability (smallest blast radius), and maintainer comprehension.

**Self-check:** Your memo separates "*can* we metaprogram this?" from "*should* we?", and picks the simplest mechanism that works.

**Hint:** Prefer the smallest capability and the most legible mechanism. A metaclass is the heaviest, action-at-a-distance option — reserve it for when the framework idiom demands it.

**Solution sketch:** a base class or mixin is usually the simplest and most legible (no metaprogramming at all). If the field set must be derived dynamically, a class decorator or `__init_subclass__` beats a metaclass on comprehension. Codegen wins if you also need zero runtime cost and AOT-friendliness. Reach for a metaclass only if you're inside a framework that already uses one (Django-style) — and document it. The senior signal is choosing the *least* magic that solves the problem.
