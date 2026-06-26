# Practical Type-System Patterns — Senior Level

> **Focus:** Typestate, phantom types, session-types-lite, type-driven development, and TypeScript's advanced utility/conditional/template-literal machinery — encoding *protocols* and *workflows* in types, plus the judgment to know when the cleverness pays and when it doesn't.

> **Topic:** [Practical Type-System Patterns](README.md)

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Real-World Analogies](#real-world-analogies)
6. [Mental Models](#mental-models)
7. [Code Examples](#code-examples)
8. [Pros & Cons](#pros--cons)
9. [Use Cases](#use-cases)
10. [Coding Patterns](#coding-patterns)
11. [Best Practices](#best-practices)
12. [Edge Cases & Pitfalls](#edge-cases--pitfalls)
13. [Summary](#summary)

---

## Introduction

> Focus: **How do you make calling a method in the wrong state a compile error? How do you encode an entire protocol — "you must open before you read, and read before you close" — so the compiler enforces the sequence?**

The middle page made *values* safe: ids that can't be confused, emails that are always valid, money that can't be added to distance. This page makes *behavior* safe. The technique is **typestate**: encode an object's state in its *type*, so that the set of available methods changes as the state changes — and calling a method that's invalid in the current state simply doesn't compile.

A `Connection<Open>` has a `read()` method; a `Connection<Closed>` does not. A `File<Unopened>` has `open()` but not `read()`; calling `read()` on an unopened file isn't a runtime check that throws — it's a method that *isn't there*. The state machine of your object lives in the type system, and the compiler walks the machine for you. This is the same idea as the typed builder from the middle page, generalized to arbitrary protocols.

The vehicle for typestate is the **phantom type**: a type parameter that appears in the type signature but carries no runtime data. `Connection<Open>` and `Connection<Closed>` are the *same bytes* at runtime; the `Open`/`Closed` tag exists only to steer the compiler. Phantom types are how you attach compile-time-only information — a state, a capability, a unit, a permission level — to a value at zero runtime cost.

Layered on top is **type-driven development**: a workflow where you write the *types* first, leave the implementations as holes, and let the holes guide you to the implementation. The types become a specification the compiler helps you satisfy.

And finally, the **judgment**. Every technique here can be over-applied into an unreadable mess. A senior engineer knows that a type encoding a six-state protocol with conditional types is sometimes brilliant and sometimes a liability your teammates will curse. This page treats *when not to* as a first-class topic — the same wisdom the metaprogramming material teaches about when a macro or a clever abstraction costs more than it saves.

> 🎓 **Why this matters for a senior:** You design the APIs others build on. A typestate API makes an entire class of usage errors *impossible* for every future caller — but a *too-clever* one makes the API unapproachable and the error messages incomprehensible. The senior skill is not knowing the most powerful pattern; it's choosing the pattern whose power-to-readability ratio fits the team and the lifetime of the code.

---

## Prerequisites

- **Required:** The middle page's newtypes, smart constructors, branded types, and typed builders.
- **Required:** Comfortable with generics, type parameters, and bounded/constrained generics.
- **Required:** Some Rust ownership/move semantics, or comfort reading them — Rust typestate relies on consuming `self`.
- **Helpful:** TypeScript's conditional types, mapped types, and `infer` (we use them).
- **Helpful:** Exposure to the idea of a finite state machine and to session types / protocol typing.

You do **not** need: dependent types, full session-type theory, or compiler-internals knowledge.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Typestate** | A pattern where a value's *state* is part of its *type*, so the available operations change with the state and invalid transitions don't compile. |
| **Phantom type** | A type parameter present in a type's signature but not used by any runtime field. Carries compile-time-only information (state, unit, capability). |
| **State machine in types** | Encoding the states and transitions of an FSM as types and state-changing methods. |
| **Session types** | A type discipline describing the *sequence and shape* of a communication protocol (send then receive then close). "Session-types-lite" = applying the idea to local APIs. |
| **Type-driven development** | Writing types first and using compiler-reported "holes" (typed gaps) to guide implementation. Associated with Idris and Haskell's typed holes. |
| **Typed hole** | A placeholder in an expression whose *expected type* the compiler reports, telling you what you must produce next. |
| **Consuming `self`** | A method that takes ownership of the receiver (`fn open(self) -> ...`), so the old-state value is *gone* after the transition — you can't reuse a stale state. |
| **Mapped type** | A TypeScript type that transforms each property of another type: `{ [K in keyof T]: ... }`. |
| **Conditional type** | A TypeScript type-level `if`: `T extends U ? X : Y`. |
| **Template literal type** | A TS type built from string literals and interpolation: `` `/users/${string}` ``. |
| **`satisfies`** | A TS operator: check a value conforms to a type *without widening* its inferred type. |
| **Capability** | A token type that grants permission to perform an operation; holding the type *is* the authorization. |

---

## Core Concepts

### 1. Phantom types: compile-time tags, zero runtime cost

A phantom type parameter appears in the type but not in any field:

```rust
use std::marker::PhantomData;

struct Connection<State> {
    socket: Socket,
    _state: PhantomData<State>,   // zero-sized; State carries no data
}

struct Open;
struct Closed;
```

`Connection<Open>` and `Connection<Closed>` have *identical* runtime representation — a `Socket`. `PhantomData<State>` occupies zero bytes. The `State` parameter exists purely so the compiler can distinguish them and offer different methods. That's the whole trick: **attach a fact to a value that the compiler tracks and the CPU never sees.**

### 2. Typestate: methods that only exist in the right state

Define methods on *specific* states, and make transitions return the new-state type:

```rust
impl Connection<Closed> {
    fn open(self) -> Connection<Open> { /* ... */ }   // only Closed can open
}
impl Connection<Open> {
    fn read(&self) -> Vec<u8> { /* ... */ }           // only Open can read
    fn close(self) -> Connection<Closed> { /* ... */ } // consumes self
}

let conn = Connection::<Closed>::new();
let conn = conn.open();      // Closed -> Open
let data = conn.read();      // ✅ Open has read
let conn = conn.close();     // Open -> Closed (conn is moved)
// conn.read();              // ❌ read doesn't exist on Connection<Closed>
```

The key is that `open`/`close` **consume `self`** (take it by value). After `conn.open()`, the old `Connection<Closed>` is *gone* — moved away — so you can't accidentally hold a stale handle in the wrong state. The compiler enforces the protocol: open before read, can't read after close, can't open twice.

### 3. Session-types-lite: a protocol as a type sequence

Generalize typestate to a multi-step protocol. A handshake "send hello → receive ack → send data → close" becomes a chain of types where each step's method returns the next step's type:

```rust
struct Handshake<Step>(Conn, PhantomData<Step>);
struct Start; struct AwaitingAck; struct Ready;

impl Handshake<Start> {
    fn send_hello(self) -> Handshake<AwaitingAck> { /* ... */ }
}
impl Handshake<AwaitingAck> {
    fn recv_ack(self) -> Handshake<Ready> { /* ... */ }
}
impl Handshake<Ready> {
    fn send(self, msg: &[u8]) -> Handshake<Ready> { /* ... */ }
}
```

You physically cannot call `send` before `recv_ack` before `send_hello`. The protocol's grammar is in the types; an out-of-order call is a type error. This is the local, lightweight cousin of full session types.

### 4. Capabilities as types

A token type can represent *authorization*. Holding a `AdminToken` is the proof you're allowed to perform admin actions; the function signature demands it:

```rust
struct AdminToken(());  // only obtainable via authentication

fn delete_user(_cap: &AdminToken, id: UserId) { /* ... */ }
```

`delete_user` cannot be called without an `AdminToken`, and an `AdminToken` can only be minted by the auth module. The capability flows through the type system as a permission slip — you can't forget the check because the check is the *type*.

### 5. Type-driven development: let the holes guide you

Write the type signature, leave the body as a hole, and ask the compiler what's needed:

```haskell
mergeUsers :: User -> User -> Either Conflict User
mergeUsers a b = _            -- typed hole

-- compiler: "hole _ :: Either Conflict User; in scope: a :: User, b :: User, ..."
```

The hole's reported type (`Either Conflict User`) and the in-scope bindings tell you exactly what you must construct from what you have. You refine the hole step by step, the types narrowing the space of valid implementations until — often — there's essentially one thing that typechecks. The slogan: **make the type precise enough that the implementation writes itself.**

### 6. TypeScript's type-level machinery

TS gives you a small functional language *at the type level*. The everyday tools:

- **Mapped + utility types:** `Partial<T>`, `Required<T>`, `Readonly<T>`, `Pick<T, K>`, `Omit<T, K>`, `Record<K, V>` — derive related types instead of hand-writing them.
- **Conditional types + `infer`:** `type ElementType<T> = T extends (infer U)[] ? U : never;` — compute types from types.
- **Template literal types:** `` type Route = `/users/${number}` | `/posts/${string}`; `` — typed routes and keys.
- **`as const`:** freeze a literal into its narrowest type so `["GET","POST"] as const` is a tuple of literal strings, not `string[]`.
- **`satisfies`:** verify a value matches a type *without* losing the precise inferred type — the best of annotation and inference.

```ts
const routes = {
  home: "/",
  user: "/users/:id",
} satisfies Record<string, `/${string}`>;
// routes.user is still the literal "/users/:id", AND the shape was checked
```

### 7. The judgment axis: power vs readability

Every pattern here trades safety for cognitive load. The senior question is *where on that curve does this code belong?*

- A two-state typestate (`Open`/`Closed`) is cheap and obviously worth it.
- A ten-state typestate with conditional-type transitions may produce error messages no teammate can read and refactors only you can do.
- A deeply conditional TS utility type can be a maintenance hazard the team routes around.

The metaprogramming material's "when not to" wisdom applies verbatim: the cleverest version is rarely the right version. Optimize for the *reader* — the colleague debugging this at 2 a.m. who didn't write it. If the type error message is incomprehensible, you've over-built. A simpler type plus a runtime check and a test is sometimes the better engineering choice.

---

## Real-World Analogies

| Concept | Real-world thing |
|---------|------------------|
| **Phantom type** | A wristband color at a festival. The wristband adds no weight, but it determines which gates open for you. |
| **Typestate** | A vending machine's physical state: the "dispense" lever is mechanically locked until coins are inserted. The button literally isn't pressable in the wrong state. |
| **Consuming `self`** | A used boarding pass — once you've gone through the gate, the pass is taken; you can't re-use the old one to walk a different path. |
| **Session-types-lite** | An assembly line where station N can only receive work that has passed station N−1. Out-of-order parts physically don't fit. |
| **Capability as a type** | A keycard. The function (door) opens only when you present the card type; possession of the card *is* the permission. |
| **Type-driven development** | A jigsaw puzzle where the hole's shape tells you exactly which piece fits — you're guided by the gap, not guessing. |
| **`satisfies`** | A tailor checking a suit fits the customer without restitching it into a generic size. |
| **Over-engineered types** | A door with seven sequential locks "for security" that everyone props open because it's unusable. |

---

## Mental Models

### The "the compiler walks your state machine" model

Draw your object's finite state machine: states as nodes, transitions as edges. Typestate maps each *node* to a type and each *edge* to a method that consumes the from-state and returns the to-state. Methods valid only in a state live on that state's type. Once you've drawn the FSM, the type design is mechanical — and the compiler then refuses every edge you didn't draw. The illegal-states-unrepresentable idea from the junior page, lifted from *data* to *behavior*.

### The "types as a shrinking search space" model

A loose type (`User -> User`) admits astronomically many implementations, most wrong. Each refinement — adding `Either Conflict`, splitting into `ValidatedUser`, returning `NonEmptyList` — *removes* wrong implementations from the space the compiler will accept. Type-driven development is the deliberate shrinking of that space until the remaining region is small enough that the right implementation is obvious. The type is doing your reasoning.

### The "readability budget" model

Treat type cleverness as spending from a fixed budget the whole team shares. A `Connection<Open>` costs almost nothing — everyone gets it. A nested conditional-mapped-template-literal type costs a lot — only you and one other person can maintain it. Spend the budget where the safety payoff is highest (protocols people *will* misuse, money, security) and economize everywhere else. Going over budget doesn't crash the program; it crashes your teammates' velocity.

---

## Code Examples

### Rust — full typestate file handle

```rust
use std::marker::PhantomData;

struct Unopened; struct Opened; struct ClosedState;

struct File<S> { fd: i32, _s: PhantomData<S> }

impl File<Unopened> {
    fn new() -> File<Unopened> { File { fd: -1, _s: PhantomData } }
    fn open(self, path: &str) -> File<Opened> {
        let fd = sys_open(path);
        File { fd, _s: PhantomData }
    }
}
impl File<Opened> {
    fn read(&self) -> Vec<u8> { sys_read(self.fd) }
    fn write(&mut self, data: &[u8]) { sys_write(self.fd, data) }
    fn close(self) -> File<ClosedState> {
        sys_close(self.fd);
        File { fd: -1, _s: PhantomData }
    }
}

fn main() {
    let f = File::<Unopened>::new();
    let f = f.open("/etc/hosts");
    let _ = f.read();              // ✅
    let f = f.close();
    // f.read();                   // ❌ File<ClosedState> has no read()
    // File::<Unopened>::new().read(); // ❌ unopened has no read()
}
# fn sys_open(_: &str) -> i32 { 0 }
# fn sys_read(_: i32) -> Vec<u8> { vec![] }
# fn sys_write(_: i32, _: &[u8]) {}
# fn sys_close(_: i32) {}
```

The protocol "open → (read/write)* → close" is enforced entirely by which methods exist on which state, and by `open`/`close` consuming `self` so stale handles can't linger.

### TypeScript — typestate without ownership (return-the-next-type)

TS has no move semantics, so typestate is approximated by returning a new typed handle and trusting callers to use the latest one:

```ts
type Open = { readonly _tag: "open" };
type Closed = { readonly _tag: "closed" };

interface Conn<S> { _s: S; }

function connect(): Conn<Open> { return { _s: { _tag: "open" } }; }
function send(c: Conn<Open>, msg: string): Conn<Open> { /* ... */ return c; }
function close(c: Conn<Open>): Conn<Closed> { return { _s: { _tag: "closed" } }; }

const c = connect();
send(c, "hi");
const c2 = close(c);
// send(c2, "late");   // ❌ Conn<Closed> not assignable to Conn<Open>
```

The caveat: nothing stops you reusing the *old* `c` after `close` (no move). This is the cost of structural typing without ownership — typestate is a *guide*, not an absolute guarantee, in TS.

### TypeScript — template literal types for typed routes

```ts
type HttpMethod = "GET" | "POST" | "PUT" | "DELETE";
type Path = `/${string}`;
type Endpoint = `${HttpMethod} ${Path}`;

const routes = ["GET /users", "POST /users", "DELETE /users/:id"] as const;
type Route = (typeof routes)[number];   // exactly those three literals

function handle(e: Endpoint) { /* ... */ }
handle("GET /users");      // ✅
// handle("PATCH /users"); // ❌ PATCH not in HttpMethod
```

### TypeScript — conditional + mapped types for a typed event map

```ts
type Events = {
  click: { x: number; y: number };
  keypress: { key: string };
  close: {};
};

// A handler map derived from the event map — no hand-duplication:
type Handlers = { [K in keyof Events]: (payload: Events[K]) => void };

function emit<K extends keyof Events>(type: K, payload: Events[K]) { /* ... */ }
emit("click", { x: 1, y: 2 });    // ✅ payload type checked against the key
// emit("click", { key: "a" });   // ❌ wrong payload for "click"
```

### TypeScript — `satisfies` to keep narrow inference

```ts
type Color = "red" | "green" | "blue";

// Without satisfies, `palette.primary` would widen to string.
const palette = {
  primary: "green",
  accent: "blue",
} satisfies Record<string, Color>;

const p: Color = palette.primary;   // ✅ still the literal "green"
```

### Haskell — phantom type for validation state

```haskell
{-# LANGUAGE GADTs, KindSignatures #-}
data Unvalidated
data Validated

newtype Form a = Form FormData     -- `a` is phantom

parseForm :: FormData -> Form Unvalidated
parseForm = Form

validate :: Form Unvalidated -> Either Error (Form Validated)
validate (Form d) = if ok d then Right (Form d) else Left BadForm

save :: Form Validated -> IO ()    -- can ONLY accept validated forms
save (Form d) = persist d
```

`save` cannot be passed a `Form Unvalidated`; the phantom `a` enforces the workflow, with `Form Validated` and `Form Unvalidated` sharing one runtime representation.

### Rust — capability token

```rust
struct DbWriteCap(());

fn authenticate(user: &User) -> Option<DbWriteCap> {
    if user.is_admin { Some(DbWriteCap(())) } else { None }
}
fn delete_all(_cap: &DbWriteCap) { /* destructive */ }

fn main() {
    let user = current_user();
    if let Some(cap) = authenticate(&user) {
        delete_all(&cap);     // ✅ only reachable with the capability
    }
    // delete_all(&DbWriteCap(())); // ❌ can't mint outside this module if field private
}
# struct User { is_admin: bool }
# fn current_user() -> User { User { is_admin: true } }
```

---

## Pros & Cons

| Aspect | Pros | Cons |
|--------|------|------|
| **Protocol safety** | Out-of-order or wrong-state calls become compile errors — entire bug classes vanish for all callers. | Designing the state types correctly takes real upfront effort and FSM thinking. |
| **Runtime cost** | Phantom types are zero-sized; typestate compiles to the same code as the unsafe version. | None at runtime; the cost is at design and reading time. |
| **API misuse-resistance** | A typestate API teaches itself: autocomplete shows only valid next methods. | Error messages for advanced types can be cryptic, especially in TS/Rust generics. |
| **Type-driven dev** | Types act as a checked spec; the compiler co-authors the implementation. | Requires a language with good typed holes / inference to feel natural. |
| **Guarantee strength** | In Rust (with `self`-consumption), the guarantee is airtight. | In structural langs (TS), typestate is advisory — stale handles can be reused. |
| **Maintainability** | Encodes intent permanently and machine-checked. | Over-engineered types are a liability: hard to read, hard to change, intimidating to teammates. |

---

## Use Cases

- **Resource protocols:** files, sockets, connections, transactions, locks — open/use/close sequences that must not be violated.
- **Builders with mandatory steps:** "you must set `url` and `method` before `send`," generalized to multi-step construction.
- **Network/IPC handshakes:** TLS-like negotiations, login flows, multi-message protocols — session-types-lite.
- **Authorization:** capability tokens threading permissions through the type system.
- **Workflow/state machines:** order lifecycle (draft → submitted → paid → shipped), where each phase exposes different operations.
- **Validation pipelines:** `Form<Unvalidated>` → `Form<Validated>` so persistence accepts only validated data.
- **Typed APIs in TS:** routes, event maps, config schemas via template-literal/mapped/conditional types and `satisfies`.

When to **prefer a simpler approach** (judgment): a state machine with one or two transitions used in a single file; a protocol that changes frequently (the type churn outweighs the safety); a team unfamiliar with the technique where a clear runtime check plus a test communicates better.

---

## Coding Patterns

### Pattern 1: phantom-state newtype + per-state impls

`struct T<S> { data: D, _s: PhantomData<S> }`, then `impl T<StateA>` / `impl T<StateB>` with state-specific methods. Transitions consume `self`.

### Pattern 2: consume `self` on transition

Always take `self` by value for state-changing methods so the old-state handle is moved away and can't be misused.

### Pattern 3: derive types, don't duplicate them (TS)

Use `Pick`/`Omit`/`Partial`/mapped types to compute `CreateUserDto` from `User`, `UpdateUserDto` from `Partial<User>`, etc. One source of truth.

### Pattern 4: `as const` + indexed access for literal unions

```ts
const STATUSES = ["draft", "live", "archived"] as const;
type Status = (typeof STATUSES)[number];   // "draft" | "live" | "archived"
```

Single source for both the runtime array and the type.

### Pattern 5: type-first, holes-second

Write the signature, leave the body as `todo!()`/`undefined`/`_`, read the expected type, fill incrementally. Let the compiler narrow the space.

### Pattern 6: keep the clever type behind a simple facade

If a powerful conditional type is genuinely needed, hide it behind a clearly-named alias or helper so call sites read simply and only the definition is complex.

---

## Best Practices

- **Model the FSM first, then map it to types.** Don't grow typestate ad hoc; draw the states and transitions, then translate mechanically.
- **Consume `self` (or move) on every transition** in languages that support it — this is what makes the guarantee airtight rather than advisory.
- **Reserve heavy machinery for high-misuse, high-cost surfaces.** Protocols people *will* get wrong, money, security, public APIs. Don't typestate a throwaway internal helper.
- **Optimize for the error message.** Before shipping a clever type, *trigger* the error and read it as a newcomer would. If it's incomprehensible, simplify.
- **Prefer `satisfies` over `as`** in TS to check conformance without throwing away inference or lying to the compiler.
- **Derive related types** with utility/mapped types instead of hand-maintaining parallel definitions that drift.
- **Document the protocol the types encode.** A short comment ("states: Closed→Open→Closed; read only when Open") helps the next reader who can't reverse-engineer the FSM from the impls.
- **Know when to stop.** The metaprogramming "when not to" rule applies: if a simpler type plus a unit test conveys the constraint and the team understands it faster, that's the better engineering. Cleverness is a cost, not a virtue.

---

## Edge Cases & Pitfalls

- **Structural typestate is advisory, not airtight.** In TS, returning a `Conn<Closed>` doesn't *destroy* the old `Conn<Open>` — a caller can still use the stale handle. Document this; don't claim a Rust-grade guarantee.
- **`PhantomData` variance and `Send`/`Sync` surprises (Rust).** The phantom parameter affects auto-trait inference and variance. `PhantomData<*const T>` vs `PhantomData<T>` behave differently; get it wrong and you'll see baffling `Send`/`Sync` errors. Use `PhantomData<fn() -> State>` for invariant tag types when unsure.
- **Combinatorial state explosion.** Tracking *k* independent boolean facts as type parameters yields 2^k states and unreadable signatures. If you reach that, a runtime state field is often clearer.
- **Cryptic error messages.** Deep conditional/mapped types in TS produce errors like `Type 'X' is not assignable to type '...50 lines...'`. This is a real maintenance cost; weigh it.
- **Type-level computation compile-time blowup.** Recursive conditional types and large template-literal unions can slow the TS compiler dramatically or hit recursion limits. Measure build time.
- **Serialization erases phantom state.** A `File<Open>` serialized and deserialized loses its `Open` tag — the wire is untyped. Re-establish state via parsing/constructors on the way back in.
- **Over-abstraction lock-in.** A too-clever type becomes load-bearing; only its author can change it, and refactors stall. This is the same trap metaprogramming warns about — the abstraction outlives the cleverness budget.
- **Phantom types don't add runtime checks.** They steer the *compiler*. If you also need a runtime guarantee (e.g. data from an untyped boundary), you still need a runtime check at that boundary; the phantom only protects the typed region.

---

## Summary

- **Typestate** lifts "make illegal states unrepresentable" from data to *behavior*: encode an object's state in its type so the available methods change with the state and wrong-state calls don't compile (`Connection<Open>` has `read`, `Connection<Closed>` doesn't).
- **Phantom types** are the vehicle: a type parameter with no runtime field, carrying compile-time-only information (state, unit, capability) at zero runtime cost.
- In Rust, **consuming `self`** on transitions makes the guarantee airtight — the stale-state handle is moved away. In structural languages like TS, typestate is *advisory* (stale handles can be reused).
- **Session-types-lite** generalizes typestate to multi-step protocols; each step returns the next step's type, so out-of-order calls are type errors.
- **Capabilities as types** thread authorization through the type system — holding the token type *is* the permission.
- **Type-driven development** writes types first and uses typed holes to guide the implementation, shrinking the space of valid programs until the right one is nearly forced.
- **TypeScript's type-level machinery** — mapped/conditional/template-literal types, `Pick`/`Omit`/`Partial`, `as const`, `satisfies` — lets you derive typed routes, event maps, and DTOs from a single source instead of hand-maintaining parallel definitions.
- The senior **judgment**: every technique here trades safety for cognitive load. Spend the readability budget where misuse is likely and costly (protocols, money, security, public APIs); economize elsewhere. Optimize for the error message and the next reader. The metaprogramming "when not to" wisdom holds — the cleverest type is rarely the right one, and a simpler type plus a test is often the better engineering choice.
