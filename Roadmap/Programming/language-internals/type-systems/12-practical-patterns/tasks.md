# Practical Type-System Patterns — Tasks & Exercises

> **Topic:** [Practical Type-System Patterns](README.md)

---

## Introduction

These exercises build the muscle that separates engineers who *describe* type patterns from those who *reach for them by reflex*. Each task starts from a real, recognizable bug and asks you to redesign the types so the bug becomes impossible. Do them in a language you can compile — the lesson lands when the compiler *rejects* your wrong code, not when you read about it.

Work in tiers. Junior tasks drill the three core habits (illegal states, parse-don't-validate, explicit absence). Middle tasks build newtypes, smart constructors, and typed builders. Senior tasks construct typestate and phantom-type machinery and then ask you to judge whether it was worth it. Each task has a **self-check** (how to know you're done), a **hint** (read it only when stuck), and sparse **solutions** at the end for a representative subset.

> Rule of the page: after every "fix," try to *write the original bug* in your new design. If it compiles, you haven't fixed it — you've decorated it.

## Table of Contents

- [Junior Tasks](#junior-tasks)
- [Middle Tasks](#middle-tasks)
- [Senior Tasks](#senior-tasks)
- [Stretch / Professional Tasks](#stretch--professional-tasks)
- [Self-Check Summary](#self-check-summary)
- [Selected Solutions](#selected-solutions)

---

## Junior Tasks

### Task J1 — Kill the impossible state

You're given (TypeScript):

```ts
interface FetchState { loading: boolean; data?: User; error?: string }
```

A bug shipped where a component showed both a spinner *and* stale data because `loading` and `data` were both set. Redesign `FetchState` so that combination cannot be expressed.

- **Self-check:** Try to construct a value that is "loading and has data." It should be a *compile error*. A `switch` over your new type should be exhaustive (adding a case forces every handler to update).
- **Hint:** A discriminated union with a literal `status` tag, where `data` lives *only* on the success case.

### Task J2 — Turn validation into parsing

Given:

```ts
function isValidAge(n: number): boolean { return Number.isInteger(n) && n >= 0 && n < 150; }
function birthdayMessage(age: number): string { /* assumes age is valid */ ... }
```

`birthdayMessage` takes a raw `number` and three callers forgot to validate first. Redesign so `birthdayMessage` can *only* receive a validated age.

- **Self-check:** Calling `birthdayMessage(rawNumber)` with an unvalidated number must fail to compile. The only way to obtain the validated type is through one parsing function.
- **Hint:** A branded `Age` type minted only by `parseAge(n: number): Age | null`.

### Task J3 — Make absence explicit

This Java-ish code crashes with an NPE when the user isn't found:

```java
User findUser(int id) { /* returns null when not found */ }
String name = findUser(42).getName();   // 💥
```

Change the signature so the caller is *forced* to handle the not-found case.

- **Self-check:** After your change, `findUser(42).getName()` should not compile (or should require an explicit unwrap/default). The "not found" path must be visible in the type.
- **Hint:** Return `Optional<User>` (Java), `User?` (Kotlin/Swift), or `Option<User>` (Rust). Force a `map`/`orElse`/`match`.

### Task J4 — Exhaustive handling that catches a new case

Given a `Shape` union with `circle` and `square`, write an `area` function that the compiler will *reject* if a third shape (`triangle`) is later added without handling it.

- **Self-check:** Add a `triangle` case to the union *without* touching `area`. The build must fail, pointing at `area`.
- **Hint:** In TypeScript, a `default:` branch with `const _exhaustive: never = shape;`. In Rust/Haskell/Swift, exhaustiveness is on by default.

### Task J5 — Spot the lying types

Review this snippet and list every place the type system has been *switched off*:

```ts
function handle(payload: any) {
  const user = payload.user as User;
  return user!.email!.toLowerCase();
}
```

Rewrite it to parse `payload` into a `User` and handle missing fields honestly.

- **Self-check:** No `any`, no `as User`, no `!` in your version. An invalid payload returns/throws explicitly rather than crashing later.
- **Hint:** Type the parameter as `unknown`, narrow it, and parse into `User | null`.

---

## Middle Tasks

### Task M1 — Newtype the id mix-up

You have a function `transfer(from: number, to: number, amount: number)`. A bug swapped `from` and `to` in one caller and money went the wrong way. Introduce types so `from` and `to` can't be confused with each other *or* with `amount`.

- **Self-check:** Passing an `AccountId` where `Amount` is expected (or swapping two ids whose roles differ) must be a compile error where the types differ. At minimum, `Amount` cannot be passed where an `AccountId` is expected.
- **Hint:** Distinct newtypes/brands: `AccountId` and `Cents`. (Two `AccountId`s in the *same* position can still be swapped — note where the type system can and can't help, and consider named parameters or a `Transfer { from, to }` struct for the rest.)

### Task M2 — Smart constructor with a sealed door

In a language of your choice, implement a `NonEmptyList<T>` whose constructor is private, exposed only via a factory that returns `Option`/`Result`/nullable. Then write a `head()` that returns `T` (not `Option<T>`) — because the list is provably non-empty.

- **Self-check:** You cannot construct an empty `NonEmptyList` from outside the module. `head()` returns `T` with no optionality and no runtime emptiness check.
- **Hint:** Rust: private field + `fn new(v: Vec<T>) -> Option<NonEmptyList<T>>`. Haskell: don't export the constructor.

### Task M3 — Units of measure

Model `Meters` and `Feet` as distinct types. Provide `metersToFeet` / `feetToMeters` conversions. Make a function `runwayLength(m: Meters)` reject a `Feet` value.

- **Self-check:** `runwayLength(Feet(1000))` is a compile error. The only way to pass feet is to convert explicitly and visibly.
- **Hint:** Two newtypes wrapping `f64`/`number`; conversions are the *only* bridge.

### Task M4 — Sanitized vs Raw string (stop the XSS)

Implement `Raw` and `Sanitized` string types. `escapeHtml(raw: Raw): Sanitized` is the only producer of `Sanitized`. `renderToPage(html: Sanitized)` is the only sink. Show that rendering a raw user string is a compile error.

- **Self-check:** `renderToPage(userInput as Raw)` fails to compile. `renderToPage(escapeHtml(userInput))` succeeds. Grep proves `as Sanitized` appears only inside `escapeHtml`.
- **Hint:** Brand the two string types; mint `Sanitized` only inside the escaper.

### Task M5 — Typed builder, required fields

Build a `HttpRequestBuilder` where `url` and `method` are required but `headers` is optional. `build()` must be callable *only* after both required setters have run.

- **Self-check:** `builder.url("/x").build()` is a compile error (method not set). `builder.url("/x").method("GET").build()` compiles. Setting `headers` is optional and doesn't gate `build`.
- **Hint:** Track presence in type parameters (`Builder<HasUrl, HasMethod>`); constrain `build`'s receiver to `Builder<true, true>`.

### Task M6 — Validated vs Unvalidated form

Tag a form with its validation status. `validate(form: Unvalidated<SignupForm>): Validated<SignupForm> | null`. `submit(form: Validated<SignupForm>)`. Show that an unvalidated form can't be submitted.

- **Self-check:** `submit(rawForm)` and `submit(unvalidatedForm)` fail to compile. The only path to `submit` runs through `validate`.
- **Hint:** Phantom tag (`__validated`) or a wrapper type carrying the status.

---

## Senior Tasks

### Task S1 — Typestate connection

Implement a `Connection` with states `Closed` and `Open`. `open()` is available only on `Closed` and returns `Connection<Open>`; `read()`/`write()` only on `Open`; `close()` only on `Open` and returns `Connection<Closed>`. In Rust, make transitions consume `self`.

- **Self-check:** `read()` on a `Connection<Closed>` is a compile error (method absent, not a runtime throw). After `close()`, the old open handle is unusable (in Rust, moved away). You cannot `open()` twice.
- **Hint:** Phantom state param + `PhantomData` (Rust); per-state `impl` blocks; transitions take `self` by value.

### Task S2 — Session-types-lite handshake

Encode a three-step protocol: `sendHello` → `recvAck` → `send(data)`. Each step is available only after the previous one. Calling them out of order must not compile.

- **Self-check:** `recvAck` before `sendHello` is a compile error. `send` before `recvAck` is a compile error. The happy-path sequence compiles.
- **Hint:** Phantom states `Start`/`AwaitingAck`/`Ready`; each method returns the next-state type.

### Task S3 — Capability token

Implement a `DbWriteCap` token, obtainable only via `authenticate(user) -> Option<DbWriteCap>`. `deleteAll(cap: &DbWriteCap)` requires it. Show `deleteAll` is unreachable without authenticating.

- **Self-check:** `deleteAll` cannot be called without first obtaining a `DbWriteCap`. The token can't be minted outside its module (private constructor/field).
- **Hint:** A struct with a private unit field; only `authenticate` constructs it.

### Task S4 — Type-driven development drill

Pick a function `mergeUsers(a: User, b: User) -> Result<User, Conflict>`. Write the signature, leave the body a typed hole (`todo!()`, `undefined`, `_`), and record what the compiler tells you it expects. Refine the hole step by step, letting the types narrow the implementation.

- **Self-check:** You can describe how each refinement *removed* wrong implementations from what the compiler would accept. The final body typechecks and you reached it by following the holes, not guessing.
- **Hint:** In Haskell use typed holes (`_`); in Rust `todo!()` and read the inferred expected type; narrow the return type if it admits too many implementations.

### Task S5 — The "when NOT to" judgment write-up

Take Task S1's typestate `Connection`. Now imagine the protocol grows to *nine* states with several conditional transitions. Write a short decision memo: would you keep full typestate, partially apply it, or fall back to a runtime state field plus tests? Justify using the cost model (read time, error legibility, refactor friction, bus factor, change frequency).

- **Self-check:** Your memo names at least four cost factors, takes a clear position, and identifies the *specific* signal that would flip your decision (e.g. "if the protocol changes more than monthly, drop full typestate"). There's no single right answer — the reasoning is graded.
- **Hint:** Reference the senior-page idea that cleverness is shared comprehension capital; optimize for the error message and the next reader.

---

## Stretch / Professional Tasks

### Task P1 — Boundary layer

Build a small service with a `boundary/parse.ts` (or equivalent) that is the *only* place raw request JSON becomes domain types (`UserId`, `Email`, `User`). The core (`saveUser(user: User)`) must be unable to receive unparsed data.

- **Self-check:** No domain function accepts `any`/`unknown`/raw strings. All validation lives in one module. Passing raw JSON to `saveUser` is a compile error.

### Task P2 — Re-parse across the wire

Simulate two services. Service A serializes `Money` to a plain number; Service B must *re-parse* it into its own `Cents` before use. Show that B treating the deserialized number as `Cents` *without* parsing is a type error.

- **Self-check:** B's code path forces a `parseCents` call on every inbound amount. A malformed amount from A is rejected at B's boundary, not deep in B's logic.

### Task P3 — The ratchet

Take a file with three `strictNullChecks` violations. Turn the flag on, grandfather the existing three with tracked suppressions, and write (or describe) a CI check that fails on a *new* violation but tolerates the old ones.

- **Self-check:** Today's CI is green. Introducing a *fourth* violation fails CI. Fixing one of the original three is allowed and reduces the count.

---

## Self-Check Summary

| Task | You're done when… |
|------|-------------------|
| J1 | "loading + data" cannot be constructed; switch is exhaustive. |
| J2 | `birthdayMessage(rawNumber)` won't compile; one parse function mints `Age`. |
| J3 | not-found path is forced by the type; no NPE possible. |
| J4 | adding a case breaks the build at the handler. |
| J5 | no `any`/`as`/`!`; invalid payload fails explicitly. |
| M1 | `Amount` can't be passed where an id is expected. |
| M2 | empty `NonEmptyList` is unconstructable; `head()` returns `T`. |
| M3 | passing `Feet` where `Meters` is required won't compile. |
| M4 | raw string can't reach `renderToPage`; `as Sanitized` only in escaper. |
| M5 | `build()` unreachable until required setters run. |
| M6 | unvalidated form can't be submitted. |
| S1 | `read()` absent on closed connection; stale handle unusable. |
| S2 | out-of-order protocol steps don't compile. |
| S3 | `deleteAll` unreachable without authenticating. |
| S4 | each refinement provably shrank the valid-implementation space. |
| S5 | memo cites ≥4 cost factors and a decision-flipping signal. |
| P1 | core can't receive unparsed data; one parse module. |
| P2 | B must re-parse; raw number can't be used as `Cents`. |
| P3 | new violation fails CI; old ones tolerated and decreasing. |

---

## Selected Solutions

### Solution J1

```ts
type FetchState =
  | { status: "loading" }
  | { status: "success"; data: User }
  | { status: "error"; message: string };

function render(s: FetchState): string {
  switch (s.status) {
    case "loading": return "Spinner";
    case "success": return `Hi ${s.data.name}`;   // data exists only here
    case "error":   return `Error: ${s.message}`;
  }
}
```

Trying `{ status: "loading", data: someUser }` is a compile error — `loading` has no `data` field. The illegal "loading + data" state is gone from the type.

### Solution J2

```ts
type Age = number & { readonly __brand: "Age" };

function parseAge(n: number): Age | null {
  return Number.isInteger(n) && n >= 0 && n < 150 ? (n as Age) : null;
}
function birthdayMessage(age: Age): string { return `You are ${age}!`; }

const a = parseAge(input);
if (a !== null) birthdayMessage(a);   // ✅
// birthdayMessage(input);            // ❌ number is not Age
```

### Solution M2 (Rust)

```rust
pub struct NonEmptyList<T> { head: T, tail: Vec<T> }   // fields private

impl<T> NonEmptyList<T> {
    pub fn new(mut items: Vec<T>) -> Option<NonEmptyList<T>> {
        if items.is_empty() { return None; }
        let head = items.remove(0);
        Some(NonEmptyList { head, tail: items })
    }
    pub fn head(&self) -> &T { &self.head }   // no Option — provably present
}
```

Outside the module you cannot build a `NonEmptyList` directly (private fields), so `head()` is total.

### Solution M4 (TypeScript)

```ts
type Raw = string & { readonly __s: "raw" };
type Sanitized = string & { readonly __s: "sanitized" };

function escapeHtml(raw: Raw): Sanitized {           // the ONLY producer
  return raw.replace(/&/g, "&amp;").replace(/</g, "&lt;")
            .replace(/>/g, "&gt;").replace(/"/g, "&quot;") as Sanitized;
}
function renderToPage(html: Sanitized) { /* insert into DOM */ }

const input = "<script>alert(1)</script>" as Raw;
// renderToPage(input);              // ❌ Raw is not Sanitized
renderToPage(escapeHtml(input));     // ✅
```

### Solution S1 (Rust, abridged)

```rust
use std::marker::PhantomData;
struct Closed; struct Open;
struct Connection<S> { fd: i32, _s: PhantomData<S> }

impl Connection<Closed> {
    fn new() -> Self { Connection { fd: -1, _s: PhantomData } }
    fn open(self) -> Connection<Open> { Connection { fd: connect_fd(), _s: PhantomData } }
}
impl Connection<Open> {
    fn read(&self) -> Vec<u8> { read_fd(self.fd) }
    fn close(self) -> Connection<Closed> { close_fd(self.fd); Connection { fd: -1, _s: PhantomData } }
}
// let c = Connection::<Closed>::new(); c.read();  // ❌ no read on Closed
// let o = c.open(); let c2 = o.close(); o.read(); // ❌ o moved by close()
# fn connect_fd() -> i32 { 0 }
# fn read_fd(_: i32) -> Vec<u8> { vec![] }
# fn close_fd(_: i32) {}
```

### Solution S3 (Rust)

```rust
mod auth {
    pub struct DbWriteCap(());                 // private field: unconstructable outside
    pub fn authenticate(is_admin: bool) -> Option<DbWriteCap> {
        if is_admin { Some(DbWriteCap(())) } else { None }
    }
}
fn delete_all(_cap: &auth::DbWriteCap) { /* destructive */ }

fn main() {
    if let Some(cap) = auth::authenticate(true) {
        delete_all(&cap);          // ✅ only reachable after authenticate
    }
    // delete_all(&auth::DbWriteCap(())); // ❌ private field, can't mint
}
```

### Solution sketch S5 (decision memo, abbreviated)

> **Decision:** partial typestate. Keep compile-time enforcement for the two genuinely dangerous transitions (the ones a past incident came from); model the remaining seven states as a runtime `enum` field validated by a small state-transition function plus exhaustive tests.
>
> **Cost factors weighed:** (1) *error legibility* — nine type-parameter states produce diagnostics teammates can't read; (2) *refactor friction* — adding a state would touch every `impl`; (3) *change frequency* — this protocol's spec is still moving, so type churn would dominate; (4) *bus factor* — only one engineer is fluent in the full encoding.
>
> **Signal that would flip me to full typestate:** the protocol stabilizing (no spec change for two quarters) *and* a second maintainer becoming fluent. Until then, the simpler design ships and stays maintainable — the cleverest type is not the right type here.
