# Reflection — Hands-On Tasks

> **Topic:** [Reflection](README.md)

---

## Introduction

This file is a structured set of exercises that take you from "I can call
`getattr`" to "I can build a cached, fast, secure reflective serializer and
reason about its native-image and module-system consequences." Every task is
small enough for one or two focused sessions, and they build on one another.
Attempt each before reading the hints — five minutes wrestling with Go's
settability panic teaches more than reading the rule.

How to use this file: read the task, write code, *run it* (and benchmark or
run under a sanitizer/race detector where noted), and only then check the
hints. Mark the self-check boxes when you can explain the result to someone
else, not when the program merely compiles. Sample solutions are intentionally
sparse — they appear only where the canonical answer teaches more than your
first attempt would.

## Table of Contents

- [Warm-Up](#warm-up)
- [Core](#core)
- [Advanced](#advanced)
- [Capstone](#capstone)

---

## Warm-Up

These rebuild the mental model. Short, but each introduces a primitive or
failure mode you'll reuse.

### Task 1: Introspect any object

**Problem.** In your language of choice, write `describe(obj)` that prints the
object's type name, every field name with its value, and every method name —
all discovered by reflection, with nothing hard-coded about the type. Test it
on two unrelated types.

**Constraints.**
- No hard-coded field/method names.
- Print fields and methods in separate sections.

**Hints (try without first).**
- Python: `type(obj).__name__`, `vars(obj)`, `inspect.getmembers(obj, inspect.ismethod)`.
- Go: `reflect.TypeOf` / `reflect.ValueOf`, loop `NumField()`, `NumMethod()`.
- Java: `getClass()`, `getDeclaredFields()`, `getDeclaredMethods()`.

**Self-check.**
- [ ] The same function works on two types you didn't special-case.
- [ ] You can explain the difference between the *type* handle and the *value*.

---

### Task 2: Read and write a field by string name

**Problem.** Given an object and a field name supplied as a *string at
runtime*, read the current value and set a new one. Then try a name that
doesn't exist and observe the failure.

**Constraints.**
- The field name must come from a variable, not a literal in the access.
- Handle the "field doesn't exist" case gracefully.

**Hints.**
- Python: `getattr` / `setattr` / `hasattr`.
- Java: `getDeclaredField(name)`, `setAccessible(true)`, `get` / `set`.
- Go: this one has a trap — see Task 4 before trying to *set*.

**Self-check.**
- [ ] You triggered a runtime (not compile-time) error with a bad name.
- [ ] You can explain why the compiler couldn't catch the bad name.

---

### Task 3: Call a method by string name

**Problem.** Build a tiny command dispatcher: given a handler object and a
command string, call the matching method (no arguments) by reflection. Map
three commands to three methods.

**Constraints.**
- No `if/switch` on the command string to pick the method — use reflection.
- Reject unknown commands with a clear error.

**Hints.**
- Python: `getattr(handler, cmd)()` guarded by `hasattr`.
- Java: `getMethod(cmd).invoke(handler)`.
- Go: `reflect.ValueOf(handler).MethodByName(cmd).Call(nil)`.

**Self-check.**
- [ ] Unknown commands fail with a message naming the command.
- [ ] You can articulate the security risk if `cmd` came from a network client.

---

## Core

These are the real mechanics: tags, settability, and the performance cliff.

### Task 4: Survive Go's settability rule

**Problem.** Write a Go function `setField(ptr interface{}, name string, value
interface{})` that sets an exported struct field by name. First write the
naive version that panics, observe the panic, then fix it. Also confirm what
happens with an *unexported* field.

**Constraints.**
- `ptr` is a pointer to a struct.
- Validate that the field exists, is settable, and the types match.

**Hints (try without first).**
- The naive `reflect.ValueOf(s).FieldByName(name).Set(...)` panics with
  "unaddressable value" because `s` is a copy.
- The fix is `reflect.ValueOf(ptr).Elem()` — reflect through the pointer.
- An unexported (lowercase) field returns `CanSet() == false` even with the
  pointer fix. There is no clean way around this in safe Go.

**Self-check.**
- [ ] You can explain *addressability* and *settability* in your own words.
- [ ] Your function refuses unexported fields and mismatched types cleanly.

<details>
<summary>Sparse solution sketch</summary>

```go
func setField(ptr interface{}, name string, value interface{}) error {
	v := reflect.ValueOf(ptr)
	if v.Kind() != reflect.Ptr || v.Elem().Kind() != reflect.Struct {
		return errors.New("ptr must be *struct")
	}
	f := v.Elem().FieldByName(name)
	if !f.IsValid() {
		return fmt.Errorf("no field %q", name)
	}
	if !f.CanSet() {
		return fmt.Errorf("field %q not settable (unexported?)", name)
	}
	val := reflect.ValueOf(value)
	if val.Type() != f.Type() {
		return fmt.Errorf("type mismatch: %s vs %s", val.Type(), f.Type())
	}
	f.Set(val)
	return nil
}
```
</details>

---

### Task 5: A tag-driven mini JSON encoder

**Problem.** Write a function that serializes a flat struct to JSON, using the
field's `json:"..."` tag as the key (falling back to the field name), and
honoring `,omitempty`. Compare your output to the standard library's
`json.Marshal` on the same struct.

**Constraints.**
- Read tags via reflection; don't hard-code keys.
- Support `string`, `int`, and `bool` fields; skip empty values for `omitempty`.

**Hints.**
- Go: `t.Field(i).Tag.Get("json")`; split on `,` to separate name from options.
- This is exactly the first thing `encoding/json` does per field.
- For "empty," check the zero value of the field's kind.

**Self-check.**
- [ ] Your output matches `json.Marshal` for a struct with renamed and
      `omitempty` fields.
- [ ] You can point to where in the real `encoding/json` source this logic
      lives.

---

### Task 6: Measure the reflection tax

**Problem.** Benchmark four ways to read a getter 10 million times: (a) direct
call, (b) cached reflective access, (c) uncached reflective access, and — in
Java — (d) a `MethodHandle` or `LambdaMetafactory` lambda. Record relative
times and allocation counts.

**Constraints.**
- Warm up the JIT (Java) before timing; use `go test -bench`, JMH, or `timeit`
  appropriately.
- Report both time *and* allocations where your tooling can.

**Hints.**
- Expect roughly: direct = 1×, cached invoke ≈ 10–30× (plus allocations),
  uncached ≈ 50–100×+. A constant `MethodHandle`/lambda should land near 1×.
- If your "cached" version isn't much faster than uncached, you're probably
  re-looking-up the handle inside the loop.
- Watch the allocation column — boxing is often the real cost, not cycles.

**Self-check.**
- [ ] Your numbers show caching helps but doesn't reach direct-call speed.
- [ ] (Java) Your `MethodHandle`/lambda version approaches direct speed and
      allocates near zero — and you can explain why.

---

### Task 7: Build a per-type cache

**Problem.** Take the encoder from Task 5 and add a per-type plan cache: the
first time a type is seen, reflect to build an ordered list of
`(key, fieldIndex, kind)`; thereafter, encode by iterating the cached plan
with no reflection of the *type structure*. Benchmark before and after.

**Constraints.**
- Cache keyed by the reflected type (`sync.Map` in Go, `ClassValue` in Java).
- Encoding a known type must not re-walk fields.

**Hints.**
- This mirrors `encoding/json`'s `cachedTypeFields`.
- Concurrency: the cache may be hit from many goroutines/threads — make it safe.

**Self-check.**
- [ ] Second and later encodes of a type are measurably faster than the first.
- [ ] The cache is concurrency-safe and you can explain how.

---

## Advanced

Where reflection meets the optimizer, the module system, and codegen.

### Task 8: `MethodHandle`/`LambdaMetafactory` accessor (Java)

**Problem.** Reflect once to find a getter, then use `LambdaMetafactory` to
synthesize a `Function<T,R>` that calls it directly. Use this in a serializer
hot path and benchmark against `Method.invoke`.

**Constraints.**
- The hot path must contain *no* reflective call — only the synthesized lambda.
- Get the `MethodType` wiring right (erased vs. instantiated signatures).

**Hints (try without first).**
- `MethodHandles.lookup().findVirtual(type, getter, MethodType.methodType(ret))`.
- `LambdaMetafactory.metafactory(...)` returns a `CallSite`; `getTarget().invoke()`
  yields the `Function`.
- Store the resulting `Function` per field; reuse it forever.
- If you see `WrongMethodTypeException`, your instantiated `MethodType` is off.

**Self-check.**
- [ ] The lambda path is ~10× faster than `Method.invoke` and barely allocates.
- [ ] You can explain why a *constant* handle inlines but a map-fetched one
      doesn't.

---

### Task 9: Reflect vs. generate

**Problem.** Implement the same serializer twice for one type: once reflective,
once code-generated (Go `go:generate`/`easyjson`-style by hand, Rust
`#[derive(Serialize)]`, or a C# source generator). Compare throughput,
startup/first-call latency, and (if applicable) binary/native-image size.

**Constraints.**
- Same output format from both implementations.
- Measure startup/first-call, not just steady-state throughput.

**Hints.**
- The generated version should win on steady-state speed *and* startup, and
  produce no runtime type metadata.
- In Rust there is no reflective option for arbitrary structs — that *is* the
  lesson; contrast `derive` against what Java/Go must do at runtime.

**Self-check.**
- [ ] You can state, with numbers, the trade you'd make for a long-lived server
      vs. a serverless function.
- [ ] You can explain why the generated version is friendlier to dead-code
      elimination / tree-shaking.

---

### Task 10: Trip and fix a module-system / native-image gap

**Problem.** (Java) Put a reflectively-accessed type in a *named module* whose
package isn't opened, and watch `setAccessible(true)` throw
`InaccessibleObjectException`. Fix it with a qualified `opens`. *Or* (GraalVM):
build a native image of a reflective app, omit the reflection config for one
path, and observe the runtime failure in the binary; then generate config with
the tracing agent and confirm the fix.

**Constraints.**
- Use the *declarative* fix (`opens` / `reflect-config.json`), not a broad
  `--add-opens ...=ALL-UNNAMED`.
- For GraalVM, exercise the failing path in a test, then via the agent.

**Hints.**
- JPMS: `opens com.example.model to com.example.serializer;`
- GraalVM: run under `-agentlib:native-image-agent=config-output-dir=...` with a
  workload that hits the path; merge runs for completeness.
- The failure appears *only* when the reflective path runs — happy-path tests
  miss it.

**Self-check.**
- [ ] You reproduced the failure and fixed it the declarative way.
- [ ] You can explain why a broad `--add-opens`/over-broad config is worse than
      a scoped one.

---

### Task 11: Harden a reflective dispatcher

**Problem.** Start from the Task 3 dispatcher, but now the command name comes
from an untrusted client. Demonstrate that a crafted name can reach a method
you didn't intend (e.g. one with a side effect), then rewrite it to be safe.

**Constraints.**
- Show the unsafe behavior concretely (don't just assert it).
- The safe version must not reflect on the client-supplied string at all.

**Hints.**
- The unsafe version lets any public method name through; pick one with an
  observable side effect to prove the point.
- The fix is an allow-list: `Map<String, Handler>` from action name to a known
  instance; reject unknowns. No reflection on input.
- Connect this to the real CVE family (deserialization, Log4Shell,
  Spring4Shell): attacker string + reflective invoke = RCE shape.

**Self-check.**
- [ ] You demonstrated an unintended invocation, then closed it.
- [ ] You can name the production CVE class this pattern belongs to.

---

## Capstone

### Task 12: A small, fast, safe serialization library

**Problem.** Combine everything into a mini serializer with: (1) tag-driven
keys and `omitempty`, (2) a concurrency-safe per-type plan cache, (3)
fast accessors (cached closures in Go, `LambdaMetafactory` lambdas in Java),
(4) a documented reflect-vs-generate decision, and (5) — if targeting
native-image/trimming — the reachability config or `[DynamicallyAccessedMembers]`
annotations needed to run as an AOT binary. Benchmark it against the standard
library.

**Constraints.**
- No reflection in the encoding hot path (only in the one-time plan build).
- Concurrency-safe cache; correct handling of unexported/private fields.
- Ship the AOT config if you target a native/trimmed build, and prove the
  binary runs the reflective paths.

**Stretch goals.**
- Add nested-struct and slice support by switching on `Kind` and recursing.
- Provide a codegen mode and compare it head-to-head with the reflective mode.
- Add a "keep rule" / native-image config and verify the shrunk/native artifact
  doesn't strip reflectively-used members.

**Self-check.**
- [ ] Steady-state speed is within a small factor of the standard library, and
      you can explain the remaining gap.
- [ ] First-call/startup cost is bounded and you know where it's spent.
- [ ] The library is safe against reflection on untrusted input (it never does
      it) and runs correctly as an AOT binary if you targeted one.
- [ ] You can defend, in one paragraph, when a user of your library should
      choose its reflective mode vs. its codegen mode.

---

## Self-Assessment Checklist

By the end you should be able to:

- [ ] Define reflection and split introspection from intercession.
- [ ] Read/write fields and invoke methods by string name in two languages.
- [ ] Explain and survive Go's addressability/settability rule.
- [ ] Drive behavior from struct tags / annotations.
- [ ] Quantify the reflection tax and reduce it with caching and (Java)
      `MethodHandle`/`LambdaMetafactory`.
- [ ] Articulate the reflect-vs-codegen trade and pick correctly per deployment.
- [ ] Diagnose and fix module-system (`opens`) and native-image reflection-config
      failures the declarative way.
- [ ] Recognize and shut down reflective dispatch on untrusted input.
