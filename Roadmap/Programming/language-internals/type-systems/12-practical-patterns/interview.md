# Practical Type-System Patterns — Interview Questions

> **Topic:** [Practical Type-System Patterns](README.md)

---

## Introduction

These questions probe whether a candidate can *use* a type system as an engineering tool — not whether they can recite type theory. The strong candidate treats types as a way to make bugs impossible: they reach for sum types to kill illegal states, they parse at boundaries instead of re-validating, they newtype to prevent id mix-ups, and they know that the cleverest type is rarely the right one. The weak candidate types `string` and `int` everywhere and catches bugs at runtime.

A great answer here is concrete: it names the pattern, shows the failure it prevents, writes a few lines of code, and — crucially — states the *cost* and when *not* to use it. Engineering judgment is the signal we're listening for. The questions move from conceptual foundations, through language-specific surfaces (TypeScript, Rust, Haskell, Java, Swift), into traps where the textbook answer is wrong, and finally to design scenarios that reveal whether the candidate has actually shipped type-driven code.

## Table of Contents

- [Conceptual / Foundational](#conceptual--foundational)
- [Language-Specific](#language-specific)
  - [TypeScript](#typescript)
  - [Rust](#rust)
  - [Haskell](#haskell)
  - [Java](#java)
  - [Swift](#swift)
- [Tricky / Trap Questions](#tricky--trap-questions)
- [Design Questions](#design-questions)

---

## Conceptual / Foundational

## Question 1

**Q: What does "make illegal states unrepresentable" mean, and give an example.**

It means designing your types so that combinations of values your program should never be in *cannot be written down*. The classic example is request state modeled as `{ isLoading: boolean; data?: T; error?: string }` — that's 2×2×2 = 8 representable states but only 3 valid ones (loading, loaded, failed). The bag-of-flags version lets you be "loading and already have data" or "have both data and error," which are nonsense states that cause UI flicker and crashes. The fix is a sum type: `{ status: "loading" } | { status: "loaded"; data: T } | { status: "failed"; error: string }`. Now only the three valid states exist; the nonsense ones can't be constructed. You cannot have a bug in a state you cannot type. The deeper point is that defensive `if` checks for "impossible" states disappear because the impossible states are gone from the type.

## Question 2

**Q: Explain "parse, don't validate."**

A *validate* function checks input and returns a boolean or throws, but hands back the *same untyped value* — so the validity lives only in the programmer's memory, and every downstream caller must remember to re-check (or forget to). A *parse* function checks input and returns a *new, richer type* — `parseEmail(s: string): Email | null` — so the validity is encoded in the type. After parsing, the rest of the code holds an `Email` and *cannot* re-check because there's nothing to re-check; the type is the proof. This eliminates an entire class of re-validation bugs and "did someone already check this?" uncertainty. It also concentrates all validation at the boundary, giving you one place to audit and test. The slogan is Alexis King's; the implementation is smart constructors plus newtypes.

## Question 3

**Q: What is a newtype, and how does it differ from a type alias?**

A newtype is a distinct type wrapping a single underlying value — `struct UserId(u64)` in Rust, `newtype UserId = UserId Int` in Haskell. It is a genuinely *different* type, so passing a `UserId` where an `OrderId` is expected is a compile error, even though both wrap `u64`. A type *alias* (`type UserId = number` in TS) is merely a *synonym* — `UserId` and `number` are interchangeable, so it provides documentation but *zero* safety. The trap is thinking an alias gives you type safety; it doesn't. To get the safety, you need a real distinct type: a newtype in nominal languages, or a *branded* type in structural languages like TypeScript. Newtypes are usually zero-cost — they compile away to the underlying representation.

## Question 4

**Q: What is a smart constructor and what does it guarantee?**

A smart constructor is a validating factory function paired with a *private* raw constructor, so the only way to obtain a value of the type is through the factory — which validates. In Haskell, you don't export the data constructor, only `mkEmail :: String -> Maybe Email`. Because there's no other door, every `Email` in the program is *provably* valid. The guarantee: any function accepting that type can drop defensive checks entirely, because an invalid value of the type cannot exist. It's "parse, don't validate" enforced at the construction site — the type's constructor *is* the parser, and it's the only entrance.

## Question 5

**Q: What's the difference between `Option`/`Maybe` and a nullable type, and why are both better than bare null?**

Both make absence *explicit in the type* so the compiler forces you to handle it, instead of `null` hiding silently inside every type and crashing at runtime. `Option<T>`/`Maybe a` is a sum type with `Some(x)`/`None` (`Just x`/`Nothing`) — you must pattern-match to get the value, so you can't forget the empty case; it also nests and composes (`Option<Option<T>>` is meaningful). A nullable type (`String?` in Kotlin, `string | null` in TS, `String?` in Swift) marks the *same* type as possibly-null and forces narrowing before use, but is flatter and language-built-in. Both beat bare null because both make the "nothing" case a compile-time obligation rather than a runtime surprise — eliminating the null-pointer/NPE/`undefined is not a function` crash that is the most common bug in software history.

## Question 6

**Q: What is a phantom type and what is it good for?**

A phantom type is a type parameter that appears in a type's signature but is not used by any runtime field — `struct Connection<State> { socket: Socket, _state: PhantomData<State> }`. The `State` parameter carries no data and costs zero bytes; it exists purely to let the compiler distinguish `Connection<Open>` from `Connection<Closed>` and offer different methods on each. It's the vehicle for typestate (encoding a state machine in types), for units of measure, for validation status (`Form<Validated>` vs `Form<Unvalidated>`), and for capabilities. The key property: it adds compile-time information at *zero runtime cost* — same bytes, different type.

## Question 7

**Q: What is the typestate pattern?**

Typestate encodes an object's *state* in its *type* so that the set of available methods changes with the state, making invalid-state calls a compile error. `Connection<Open>` has `read()`; `Connection<Closed>` doesn't — so calling `read()` on a closed connection isn't a runtime check that throws, it's a method that *isn't there*. Transitions are methods that consume the receiver and return the new-state type (`fn close(self) -> Connection<Closed>`). It lifts "make illegal states unrepresentable" from data to *behavior*: the protocol "open before read, can't read after close" is enforced by the compiler. In Rust, consuming `self` makes the old-state handle disappear, so the guarantee is airtight; in structural languages it's advisory (a stale handle can be reused).

## Question 8

**Q: When should you NOT reach for an elaborate type-system pattern?**

When the cost exceeds the benefit. Concretely: when the rule changes faster than you can maintain the type; when the type's error messages would cost more debugging time than the bug it prevents; when only one person on the team can read or maintain it (bus factor); when the value genuinely has no rules (a free-text comment doesn't need a `Comment` newtype); or when a simple runtime check plus a unit test communicates the constraint to more people more clearly. Over-typing is a real failure mode — juniors under-type, seniors sometimes over-type. The mature answer treats type cleverness as shared comprehension capital to be spent on high-misuse, high-cost surfaces (auth, money, public APIs) and economized elsewhere. The goal is shipped, maintainable, correct software, not maximal type theater.

## Question 9

**Q: How do discriminated unions and exhaustiveness checking work together?**

A discriminated (tagged) union is a sum type with a literal tag field (`status`, `kind`) you switch on. Exhaustiveness checking is the compiler verifying your `switch`/`match` handles *every* case. Together they give a powerful refactoring property: when you *add* a new case to the union, every `switch` that doesn't handle it becomes a compile error pointing at exactly the code to update. Compare to a plain `string` status with `if/else` chains — add a new status and code silently falls through the `else`, a quiet bug. The union turns "I hope I updated every place" into "the compiler listed every place." In TS you enforce it with a `never` default branch; Rust and Haskell check exhaustiveness by default.

## Question 10

**Q: What does "push checks left" mean in the context of type-driven design?**

It means moving the moment a bug is caught earlier in time — from runtime (on a user's machine, in production, mid-incident) to compile-time (on your machine, in the build, with a precise location). The same bug costs radically different amounts depending on where it surfaces. Every type-system pattern here is a way to drag a failure leftward: a null deref becomes a compile error via non-nullable types; a wrong-id mix-up becomes a compile error via newtypes; a wrong-state call becomes a compile error via typestate. Good type design is largely the art of relocating failures from runtime to compile-time.

---

## Language-Specific

### TypeScript

## Question 11

**Q: Why doesn't a plain `type UserId = number` prevent mixing up ids in TypeScript, and how do you fix it?**

Because TypeScript uses *structural* typing and a type alias is just a synonym — `UserId` *is* `number`, so it's interchangeable with any other `number`, including `OrderId`. To force a distinction you create a *branded* type: intersect the underlying type with a unique marker that never exists at runtime, e.g. `type UserId = number & { readonly __brand: "UserId" }`. Now `UserId` and `OrderId` are structurally different (different brand strings), so passing one for the other is a compile error. You mint a branded value with an `as` cast inside a single controlled constructor (`parseUserId`) and nowhere else — the brand is purely compile-time and erased at runtime.

## Question 12

**Q: What does `satisfies` do that a type annotation doesn't?**

`satisfies` checks that a value conforms to a type *without widening* the value's inferred type. With `const x: Record<string, Color> = {...}`, accessing a property gives you `Color` (widened). With `const x = {...} satisfies Record<string, Color>`, the *shape* is checked against `Record<string, Color>`, but `x.primary` retains its narrow literal type (`"green"`). So you get validation (the annotation's benefit) *and* precise inference (the no-annotation benefit) at once. It's the right tool when you want to verify an object matches a contract but still use the exact literal types of its members downstream.

## Question 13

**Q: What are `as const`, template literal types, and how do they combine for typed routes?**

`as const` freezes a literal into its narrowest type — `["GET","POST"] as const` is a readonly tuple of the literals `"GET"` and `"POST"`, not `string[]`. Template literal types build string types from interpolation — `` type Route = `/users/${string}` ``. Combined, you derive a precise union from a runtime array: `const ROUTES = ["GET /users","POST /users"] as const; type Route = typeof ROUTES[number];` gives a type of exactly those two string literals, sharing a single source of truth with the runtime array. A function `handle(r: Route)` then rejects any string not in the set — typed routes/keys with no duplication.

## Question 14

**Q: When would you use `Pick`, `Omit`, and `Partial` instead of writing the type by hand?**

When you want a type *derived* from another so they can't drift. `Partial<User>` makes all fields optional (a patch/update DTO). `Pick<User, "id" | "email">` selects a subset (a public-facing view). `Omit<User, "passwordHash">` removes fields (a safe-to-serialize shape). The win is a single source of truth: change `User` and all derived types follow automatically, instead of editing five parallel interfaces and forgetting one. These are mapped types under the hood; combined with conditional types and `infer`, they let you compute related types from a base instead of hand-maintaining them.

### Rust

## Question 15

**Q: How does Rust make a typestate guarantee airtight where structural languages can't?**

By consuming `self` on state transitions. A transition method takes the receiver *by value* (`fn open(self) -> Connection<Open>`), so after `conn.open()` the original `Connection<Closed>` is *moved away* and no longer exists — the borrow checker forbids using it. This means you cannot hold a stale handle in the old state; the only `Connection` you have is the new-state one. In a structural language like TypeScript, returning a `Conn<Open>` doesn't destroy the old `Conn<Closed>`, so a caller could still use the stale handle — typestate there is advisory, a guide rather than a guarantee. Move semantics are what make Rust's protocol enforcement absolute.

## Question 16

**Q: Why do you need `PhantomData` for a phantom type parameter in Rust?**

Rust requires every generic parameter on a struct to be *used*, otherwise it's a compile error ("parameter `State` is never used"). A phantom type parameter, by definition, isn't used by any real field. `PhantomData<State>` is a zero-sized marker that "uses" the parameter for the compiler's bookkeeping without occupying any memory. It also tells the compiler how the type behaves with respect to variance and the `Send`/`Sync` auto-traits — and getting that wrong (e.g. `PhantomData<*const State>` vs `PhantomData<State>` vs `PhantomData<fn() -> State>`) can cause surprising trait-inference errors, so it's worth understanding which form you want.

## Question 17

**Q: How do `Option` and `Result` replace null and exceptions in Rust, and why is that better?**

Rust has no null and no exceptions for recoverable errors. Absence is `Option<T>` (`Some`/`None`); fallibility is `Result<T, E>` (`Ok`/`Err`). Both are sum types you must pattern-match (or handle via `?`, `unwrap`, combinators), so the compiler *forces* you to deal with the missing/error case — you can't accidentally dereference nothing or ignore an error. This is better than null because there's no silent "this might be absent" hiding in every type, and better than unchecked exceptions because the failure is visible *in the function signature* (`-> Result<T, E>`), making every caller's obligation explicit and the control flow local and inspectable.

### Haskell

## Question 18

**Q: Show how a smart constructor is enforced by Haskell's module system.**

You define the newtype and *don't* export its data constructor — only the type name and a validating factory:

```haskell
module Email (Email, mkEmail, unEmail) where
newtype Email = Email String          -- constructor NOT in the export list
mkEmail :: String -> Maybe Email
mkEmail s = if isValid s then Just (Email s) else Nothing
unEmail :: Email -> String
unEmail (Email s) = s
```

Outside this module, the `Email` constructor is invisible, so the *only* way to obtain an `Email` is `mkEmail`, which validates. The module boundary is the privacy mechanism that seals every door except the validating one. Every `Email` in the whole program is therefore provably valid.

## Question 19

**Q: How does a phantom type parameter encode validation state in Haskell?**

You add a type parameter that no constructor uses: `newtype Form a = Form FormData`. The `a` is phantom. You then provide functions that move between *tagged* versions: `parseForm :: FormData -> Form Unvalidated`, `validate :: Form Unvalidated -> Either Error (Form Validated)`, and `save :: Form Validated -> IO ()`. Since `save` demands `Form Validated`, you cannot pass it a `Form Unvalidated` — the workflow "parse then validate then save" is enforced by the phantom tag, while `Form Validated` and `Form Unvalidated` share one runtime representation (`FormData`). It's the typestate pattern in a language with no objects.

### Java

## Question 20

**Q: How do you model "make illegal states unrepresentable" in modern Java?**

With *sealed interfaces* and records (Java 17+), plus pattern-matching `switch`. Instead of a class with nullable fields and boolean flags, you write `sealed interface FetchState permits Loading, Loaded, Failed {}` with `record Loading() implements FetchState`, `record Loaded(User user) implements FetchState`, `record Failed(String error) implements FetchState`. Now only the valid states exist, `Loaded` carries its `User` non-null, and a `switch` over the sealed type is *exhaustively* checked — add a permitted case and the switch won't compile until handled. Before sealed types, Java forced you into nullable fields or a visitor pattern; sealed interfaces give Java genuine sum types and the exhaustiveness that makes them powerful.

## Question 21

**Q: How does `Optional<T>` help, and what's the common misuse?**

`Optional<T>` makes absence explicit in a return type — `Optional<User> findUser(...)` signals "might be empty" and forces the caller to call `.map`, `.orElse`, `.isPresent`, etc., instead of silently returning `null` and risking an NPE. The common misuses: using `Optional` for *fields* (it's not `Serializable` and adds overhead; nullable fields or proper modeling are preferred), passing `Optional` as a *parameter* (overload or accept the value), and calling `.get()` without checking (recreating the NPE you were avoiding). `Optional` is best as a *return type* that documents and enforces the "no result" case at API boundaries.

### Swift

## Question 22

**Q: How do Swift optionals and `guard let` implement "make absence explicit"?**

Swift has no implicit null: a `String` is always present, and `String?` (sugar for `Optional<String>`) is the only way to express "maybe a string." You can't use the value until you *unwrap* it — via `if let`, `guard let`, `??`, optional chaining, or (riskily) force-unwrap `!`. `guard let user = user else { return }` unwraps-or-bails at the top of a function, after which `user` is a non-optional `User` for the rest of the scope — a clean "make absence explicit then eliminate it early" pattern. Failable initializers (`init?`) make Swift newtypes into smart constructors: `Email(raw)` returns `Email?`, `nil` on invalid input, so the only `Email` you can hold is a parsed one.

## Question 23

**Q: How do Swift enums with associated values give you sum types?**

A Swift `enum` case can carry associated data, making it a true sum type: `enum FetchState { case loading; case loaded(User); case failed(String) }`. Exactly one case holds at a time, each carrying its own payload, and a `switch` over the enum is exhaustively checked — you must handle every case or the compiler complains. This is the idiomatic way to make illegal states unrepresentable in Swift: model UI/request state, parser results, and domain events as enums rather than structs with optional fields and flags. Pattern-matching with `case .loaded(let user)` binds the payload only in the branch where it exists.

---

## Tricky / Trap Questions

## Question 24

**Q: A teammate uses `type Email = string` and says "now emails are type-safe." Are they?**

No. That's a type *alias* — `Email` is just a synonym for `string`, fully interchangeable with any string. It provides documentation and nicer signatures but *zero* enforcement: any string passes where `Email` is expected, and there's no guarantee the string is a valid email. For actual safety you need a *distinct* type the compiler treats as separate — a branded type (`string & { __brand: "Email" }`) minted only by a validating `parseEmail`. The trap catches people because the alias *looks* like it should help. Test it: try passing a raw, unvalidated string to a function expecting `Email`; if it compiles, you have no safety.

## Question 25

**Q: You have a `parseEmail(s): Email | null`. A teammate writes `if (isEmail(s)) { use(s as Email) }` instead. What's wrong?**

It splits the validity check (`isEmail`) from the type production (`as Email`), so they can *drift apart*. If `isEmail`'s logic and the `Email` brand's intended invariant ever diverge — someone tightens one and forgets the other — you'll mint an `Email` that doesn't actually satisfy the current rule, and the `as` cast silently lies to the compiler. The whole point of parse-don't-validate is to keep the check and the type-production in *one place* (`parseEmail`) so they cannot disagree. The `as`-cast-after-a-boolean-guard pattern reintroduces the gap that parsing was meant to close.

## Question 26

**Q: Does using `Option<T>` everywhere eliminate null-pointer bugs?**

It eliminates *unhandled* absence — you can't dereference an `Option` without confronting the `None` case. But it doesn't eliminate the *logical* bug of mishandling absence: calling `.unwrap()`/`.get()`/force-unwrap (`!`) on a `None`/`nil` re-creates the crash, just at a spot you chose. And it doesn't fix bugs where the *wrong* default is used (`option.unwrap_or(0)` masking a real error). `Option` moves the absence from invisible-and-silent to visible-and-mandatory-to-handle; it's up to you to handle it *correctly*. The pattern prevents *forgetting*, not *mishandling*.

## Question 27

**Q: Your `Connection<Open>` / `Connection<Closed>` typestate works in Rust but a TypeScript port still lets people call `read` on a closed connection. Why?**

Because TypeScript has no move semantics. In Rust, the transition method consumes `self`, so after `conn.close()` the old `Connection<Open>` is moved away and the borrow checker forbids touching it — the only handle you have is `Connection<Closed>`. In TypeScript, `close(c)` returns a new `Conn<Closed>` but does *not* destroy the original `c: Conn<Open>`; a caller can still hold and use the stale `c`. So TS typestate is *advisory* — it guides correct usage and catches the obvious wrong call (passing a `Conn<Closed>` where `Conn<Open>` is required) but cannot prevent reuse of an outdated handle. The guarantee strength depends on whether the language can *consume* the old state.

## Question 28

**Q: Is a newtype always zero-cost?**

Usually, but not always — it depends on the language and how the wrapper is used. In Rust, Haskell, and Kotlin (`@JvmInline value class`), a single-field newtype is erased to the underlying representation with no overhead. In TypeScript, a *branded* type is purely compile-time and erased entirely. But a Swift `struct` wrapper or a Java *non*-inline wrapper class can introduce an allocation/indirection, and even Kotlin's `value class` boxes in some situations (when used as a nullable, as a generic type argument, etc.). And in any language, if you *add* runtime validation or extra fields, it's no longer zero-cost. The right answer is "zero-cost in the common cases for nominal languages and TS brands, but verify for your language and usage if it's hot."

## Question 29

**Q: You added a new case to a discriminated union and your local build is green with exhaustive switches everywhere. Is it safe to deploy?**

Within your codebase, yes — exhaustiveness guarantees every local handler was updated. Across a *version/service boundary*, no. An already-deployed consumer (an old mobile app, a sister service on the previous release) doesn't know the new case and may crash, drop, or misroute it. Local exhaustiveness proves *your current code* handles every case *it knows about*; it says nothing about old code running elsewhere. For sum types that cross versions or the wire, you must design explicit unknown-case handling (a `default`/`unknown` branch at the boundary) so old consumers degrade gracefully. The guarantee is local; the wire is not.

## Question 30

**Q: `as`, `!`, and `any` in TypeScript — what's the cost of using them?**

Each one switches the proof checker *off* at that spot. `as` (and `as any`) tells the compiler "trust me, this is that type" with no verification — if you're wrong, the bug surfaces at runtime exactly where you suppressed the check. `!` (non-null assertion) asserts a value isn't null without proving it — a runtime crash if it is. `any` is worst: it's contagious, and every value derived from an `any` loses all checking, silently spreading unsafety. They're sometimes necessary (interop, a genuinely-known invariant the compiler can't see), but each is a hole in the guarantees you're building, and should carry a comment justifying why it's safe. Prefer narrowing (`if (x)`), `unknown` + parsing, and `satisfies` over these escape hatches.

---

## Design Questions

## Question 31

**Q: Design the type for an order lifecycle: draft → submitted → paid → shipped, where each phase allows different operations.**

Model each phase as a distinct type and make transitions return the next phase. Two solid approaches: (1) a **sum type** `Order = Draft(...) | Submitted(...) | Paid(...) | Shipped(...)` with operations as functions that pattern-match and return the next variant — works in any language, exhaustively checked, but doesn't prevent calling `ship` on a `Draft` value directly (the function just returns an error/`Result`). (2) **Typestate** with phantom states `Order<Draft>` / `Order<Submitted>` / etc., where `submit(self) -> Order<Submitted>`, `pay(self) -> Order<Paid>`, `ship(self) -> Order<Shipped>` each consume `self`; then `ship` literally doesn't exist on `Order<Draft>` — a compile error, not a runtime one. Choose (2) in Rust where moves make it airtight and the lifecycle is stable and high-value; choose (1) where the language lacks moves, the states change often, or simplicity matters more. State the tradeoff explicitly — that's the signal.

## Question 32

**Q: Design types to prevent SQL injection / XSS at the type level.**

Introduce distinct types for trust level: `Raw` (untrusted, from users) and `Sanitized`/`SqlSafe` (validated/escaped). Make the dangerous sink accept *only* the safe type: `function renderToPage(html: Sanitized)` and `function execute(sql: SqlSafe)`. The *only* way to produce the safe type is through an escaping/parameterizing function — `escapeHtml(raw: Raw): Sanitized`, or a parameterized-query builder that yields `SqlSafe`. Now interpolating a raw user string into HTML or SQL is a *compile error*, because `Raw` isn't assignable to `Sanitized`. You can't forget to escape, because the type system won't let unescaped data reach the sink. This is parse-don't-validate applied to security: the escaping step is the parser, and the safe type is the proof. The residual risk is the single `as Sanitized` cast inside the escaper — keep it confined and tested.

## Question 33

**Q: Design a builder that won't compile until all required fields are set.**

Use a typed builder whose type parameters track which required fields are present, and make `build()` available only when they're all set. In TS: `class Builder<HasUrl extends boolean, HasMethod extends boolean>` where `url()` returns `Builder<true, HasMethod>`, `method()` returns `Builder<HasUrl, true>`, and `build(this: Builder<true, true>): Request` — the `this`-type constraint makes `build` unreachable until both are `true`. In Rust, encode it with phantom marker types and per-state `impl` blocks, consuming `self` on each setter. The result: `builder.url("/x").build()` is a *compile* error (method not set), not a runtime "missing field" exception. Note the cost — it's more verbose and can confuse readers unfamiliar with the technique, so reserve it for builders where forgetting a field is genuinely high-cost.

## Question 34

**Q: You're designing a `Money` type used across three microservices. What do you do?**

Inside each service, a newtype/branded `Money` (with `amount: Cents` and `currency`) prevents `cents + dollars` mix-ups and accidental float arithmetic. But a type guarantee is *local to a process* — on the wire, `Money` is just bytes. So: (1) define the wire contract *once* in a shared schema (protobuf/OpenAPI) and **codegen** each service's base type from it, so they can't drift. (2) At every boundary, *re-parse* incoming `Money` through a validating constructor — never trust a deserialized value, even from a sister service. (3) Layer the local newtype on top of the generated type for in-process safety. (4) For currency, make mixing currencies a typed error or require explicit conversion. The key insight to articulate: the guarantee ends at the wire and must be reconstructed at each boundary; codegen prevents drift; deserialized data is untrusted until parsed.

## Question 35

**Q: A team wants to encode a 9-state protocol with conditional types and 30 transition methods in typestate. How do you advise them?**

Push back and apply the cost model. Nine states tracked as type parameters risks combinatorial explosion and signatures/error messages no one can read; 30 transitions is a lot of surface for the compiler to produce cryptic diagnostics on. Ask: how often does this protocol change? (If weekly, the type churn will dominate.) Who maintains it? (If one person, that's a bus factor.) What's the cost of the bug it prevents vs. the cost of every teammate's comprehension and every refactor's friction? Often the better engineering is a *simpler* type (e.g. a runtime state field plus a small typestate for the two or three genuinely dangerous transitions) backed by tests. The senior judgment is that the cleverest type is rarely the right one; optimize for the error message and the next reader. If they proceed, insist on triggering and reading the actual compiler errors first — if those are incomprehensible, the design has failed regardless of correctness.

## Question 36

**Q: How would you incrementally introduce these patterns into a legacy codebase full of `any` and nullable-everything?**

Don't rewrite — ratchet. (1) Turn on the stricter check (e.g. TS `strictNullChecks`, or `mypy`/Sorbet) but grandfather existing violations with a tracked baseline / `@ts-expect-error` so today's CI is green. (2) Make CI *fail on new* violations while tolerating old ones — the count can only decrease. (3) Burn down the baseline opportunistically: whenever you touch a file, fix its violations. (4) Introduce newtypes starting at the *highest-risk* ids — the one that's been mixed up in a past incident, money, auth tokens — not everywhere at once. (5) Build the boundary/parsing layer at the most exposed entry points first. The principle is *monotonic improvement during normal work*: type safety only ever increases, no big-bang migration that stalls. Track the debt explicitly so "we should type this someday" becomes a burn-down with an owner.
