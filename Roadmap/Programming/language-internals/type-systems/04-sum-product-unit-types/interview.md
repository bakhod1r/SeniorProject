# Sum, Product & Unit Types — Interview Questions

> **Topic:** [Sum, Product & Unit Types](README.md)

---

## Introduction

These questions probe whether a candidate truly understands algebraic data types — not as "the enum syntax in my favorite language," but as the two fundamental ways to combine types (AND/product, OR/sum), the two identity types (Unit and Void), the arithmetic that governs them, and the engineering payoffs (exhaustiveness, "make illegal states unrepresentable," `Option`/`Result` replacing null and exceptions).

A strong candidate distinguishes product from sum instantly, reaches for the "count the inhabitants" trick to reason about equivalence, knows that exhaustiveness checking is the killer feature and *why* it requires a closed variant set, and can name the trade-off they're making (the expression problem) rather than treating sums as universally superior. A weaker candidate conflates `void` with the empty type, thinks `null` and `Option` are the same thing with different syntax, or can't say why a struct-with-flags is worse than a sum. The questions move from conceptual foundations, to language-specific surfaces (Rust, Haskell, TypeScript, Swift, Java), to traps where the obvious answer is wrong, to design scenarios.

## Table of Contents

- [Conceptual / Foundational](#conceptual--foundational)
- [Language-Specific](#language-specific)
  - [Rust (enums)](#rust-enums)
  - [Haskell (ADTs)](#haskell-adts)
  - [TypeScript (discriminated unions)](#typescript-discriminated-unions)
  - [Swift (enums)](#swift-enums)
  - [Java (sealed + records)](#java-sealed--records)
- [Tricky / Trap Questions](#tricky--trap-questions)
- [Design Scenarios](#design-scenarios)
- [Cheat Sheet](#cheat-sheet)
- [Further Reading](#further-reading)

---

## Conceptual / Foundational

## Question 1

**What is the difference between a product type and a sum type?**

A **product type** holds several values **at once** — it has field A **and** field B (and C…). Structs, tuples, records, and field-bearing classes are products. A **sum type** holds **exactly one** of several alternatives — it is A **or** B **or** C. Tagged unions, variants, discriminated unions, Rust/Swift enums, and Haskell `data` declarations are sums. The names come from counting inhabitants: a product's count is the **product** of its fields' counts (`|A × B| = |A| × |B|`), a sum's count is the **sum** of its variants' counts (`|A + B| = |A| + |B|`). The practical distinction: products bundle data that always travels together; sums model "one of N kinds," states, and choices.

## Question 2

**What are the Unit and Void types, and why do they matter?**

The **Unit type** has exactly **one** inhabitant (`()` in Rust/Haskell/OCaml). It's the identity of product (`A × Unit ≅ A`) and represents "no meaningful information" — what a function returns when called for its effect. The **Void type** (also Never/bottom/Nothing) has **zero** inhabitants — you can never construct one. It's the identity of sum (`A + Void ≅ A`) and marks code that never produces a value (a function that always loops or always throws). They matter because they complete the algebra: with `1` and `0` plus `+` and `×`, the type system becomes a semiring, and the standard library's shapes (`Option = 1 + A`, `bool = 1 + 1`) fall out. Watch the name trap: C/Java/JS `void` is Unit-like, *not* the zero-value Void.

## Question 3

**Why is exhaustiveness checking the "killer feature" of sum types?**

Because the compiler **proves you handled every case**, and turns adding a variant into a compiler-generated to-do list. When you pattern match over a closed sum, the compiler verifies no variant is unhandled; if you later add a variant, every non-exhaustive match *fails to compile* and points you at the exact site. That converts a class of runtime bugs ("forgot to handle the new case, crashed in production") into compile-time errors found during the very refactor that introduced the new case. It requires the variant set to be **closed** (known at the definition site) — which is exactly why native sums enable it and "faked" sums (open interface hierarchies) can't: the compiler doesn't know the complete list.

## Question 4

**Explain the algebra of types: the formulas and what each means.**

```
|A × B|   = |A| × |B|     product → multiply (struct/tuple)
|A + B|   = |A| + |B|     sum → add (enum/variant)
|Unit|    = 1             one value (identity of ×)
|Void|    = 0             zero values (identity of +)
|A -> B|  = |B| ^ |A|     functions are exponentials
```

Treating a type as a set and counting inhabitants, these obey ordinary arithmetic. Two types with equal cardinality are **isomorphic** (losslessly convertible). Function types are exponentials because a function must pick one of `|B|` outputs for each of `|A|` inputs (`bool -> bool` has `2^2 = 4` functions). The exponent laws map to idioms: currying is `(A×B)->C ≅ A->(B->C)` (`c^(ab) = (c^b)^a`), and pattern matching is `(A+B)->C ≅ (A->C)×(B->C)` (a function out of a sum is one handler per variant).

## Question 5

**Show that `Option<A>` (Maybe) is `1 + A`, and use it to explain why nested options are a smell.**

`Option<A>` is `enum { None, Some(A) }`: the `None` variant carries no data (a Unit-like `1`) and `Some` carries an `A`, so `|Option<A>| = 1 + |A|`. Then `Option<Option<A>>` is `1 + (1 + A) = 2 + A` — it has **two** distinct "empty-ish" values, `None` and `Some(None)`. That's the smell: you now have two ways to say "nothing," which almost always indicates an ambiguity you didn't intend. `flatten` is the function that collapses `2 + A` back to `1 + A` by merging the two empties.

## Question 6

**What does "make illegal states unrepresentable" mean? Give an example.**

It means designing types so that invalid combinations *can't be constructed*, instead of allowing them and defending with runtime checks. Classic example: modeling a connection as `struct { connected: bool, socket: Option<Socket>, retries: u32 }` lets you build the nonsense state `connected: true, socket: None`. Replace it with a sum:

```
enum Connection {
    Disconnected,
    Connecting { attempts: u32 },
    Connected  { socket: Socket },
}
```

Now `Connected` *always* has a socket and `Disconnected` *can't* have one — the illegal states don't get rejected at runtime, they can't be written down. The type *is* the validation, and a whole category of `if`-checks and bugs disappears.

## Question 7

**Why is `null` called the "billion-dollar mistake," and how do sum types fix it?**

`null` makes every reference type an *implicit, unchecked* sum: a `T` is secretly `T + null`, but the `+ null` is invisible to the type system, so the compiler can't force you to handle the absent case — you find out at runtime with a null-pointer exception. Tony Hoare, who introduced it, called it his billion-dollar mistake for the failures it caused. Sum types fix it by making the same `1 + T` **explicit and checked**: `Option<T>`/`Maybe T` adds an explicit `None` variant you *must* pattern match, and a plain `T` then *guarantees presence*. Same information, now visible to the type checker — and `Option` composes (`map`, `and_then`, `?`) where null forces nested defensive `if`s.

## Question 8

**Tagged vs untagged unions — what's the difference and why does it matter for safety?**

A **tagged union** (an ADT/sum) stores a hidden **discriminant** recording which variant is currently active; pattern matching reads that tag and gives you only the matching variant's data. An **untagged union** (a C `union`) stores overlapping members with **no tag** — nothing records which member is valid, so reading the wrong member reinterprets raw bytes and corrupts your program. The tag is the entire difference between safe and unsafe: ADTs make it impossible to read a `Circle` as a `Rectangle`; C unions happily let you, with undefined behavior.

## Question 9

**What is the expression problem, and which way do sum types lean?**

The expression problem is the difficulty of adding both new **variants** (kinds of data) and new **operations** (functions over them) without editing existing code or losing type safety. **Sum types make operations cheap and variants expensive**: a new operation is one new function (exhaustiveness-checked, touching nothing), but a new variant forces an edit to *every* function (each match grows an arm — though the compiler lists them). **Object-oriented interfaces invert it**: a new variant is one new class, but a new operation forces an edit to every class. Neither is universally better; you choose based on which axis — cases or operations — is volatile in your system.

## Question 10

**How do you fake sum types in a language without them, and what do you lose?**

In Go you use an interface plus a type switch; in pre-`sealed` Java you use an abstract base class with subclasses and often the visitor pattern; in C you use a struct with a manual tag field plus a union. What you lose is **exhaustiveness checking**: because the variant set is open (any code can add a new implementor/subclass), the compiler can't verify you handled every case. Add a new variant, forget a case, and you discover it at runtime (a `panic`/`default`/`UnsupportedOperationException`) rather than at compile time. You also lose the concise data definition and often pay a vtable/heap-allocation cost.

---

## Language-Specific

### Rust (enums)

## Question 11

**How does a Rust `enum` differ from a C `enum`, and how is it laid out in memory?**

A C `enum` is just a named integer — a sum of fieldless variants. A Rust `enum` is a full **tagged union**: each variant may carry data of different types, so it's a sum of products. In memory it's a **discriminant plus space for the largest variant's payload** (`size ≈ tag + max(payload)`, with alignment). When a payload has unused bit patterns, Rust applies **niche optimization** and stores the tag in those patterns for free — `Option<&T>` is the same size as `&T` because the null pointer encodes `None`. A fieldless Rust enum degenerates to exactly a C enum (a bare integer).

## Question 12

**What is `!` (the never type) in Rust, and where do you see it?**

`!` is Rust's **Void/bottom** type — zero inhabitants, uninhabitable. You see it as the return type of functions that never return normally: `panic!`, `std::process::exit`, and infinite `loop {}` all have type `!`. Because `!` can coerce to *any* type (there's a unique function `Void -> A`, the "absurd"), an expression of type `!` fits anywhere — which is why `let x: u32 = if c { 5 } else { panic!() };` typechecks: the `panic!()` arm is `!`, coercible to `u32`. It's the type-level statement "control never reaches here."

## Question 13

**Why does Rust require `Box` (or another pointer) in a recursive enum like a linked list or tree?**

Because the size must be finite and known at compile time. `enum List { Cons(i32, List), Nil }` would need to contain itself, making its size infinite (a `Cons` contains a `List` which contains a `Cons`…). `Box<List>` is a pointer of fixed size pointing to a heap-allocated `List`, so `enum List { Cons(i32, Box<List>), Nil }` has a finite size (int + pointer). The *set* of values is still infinite (lists of any length); the *representation size* is finite thanks to the indirection.

### Haskell (ADTs)

## Question 14

**Read this declaration aloud and explain it: `data Shape = Circle Double | Rectangle Double Double`.**

It declares a sum type `Shape` with two variants. `Circle` is a constructor taking one `Double` (the radius); `Rectangle` is a constructor taking two `Double`s (width and height). The `|` separates the alternatives — a `Shape` value is *either* a `Circle` *or* a `Rectangle`, never both. Each constructor is itself a product of its fields. Cardinality-wise, `Shape` is `|Double| + |Double|²` (a sum of products). You consume it by pattern matching: `area (Circle r) = pi*r*r; area (Rectangle w h) = w*h`, and GHC with `-Wincomplete-patterns` warns if you miss a case.

## Question 15

**What is the difference between `data`, `newtype`, and a record in Haskell?**

`data` declares a general ADT (sums and/or products). `newtype` declares a **single-constructor, single-field** type that is `×`-isomorphic to its inner type but is a *distinct type* with **zero runtime cost** (it's erased to the inner representation) — used for giving `String` the identity `UserId` or `Email`, so the compiler refuses to mix them. A **record** is product syntax that also generates named field accessors: `data Point = Point { x :: Double, y :: Double }` gives you `x` and `y` as functions. `newtype` is for distinct identity with no overhead; records are for products with named fields.

## Question 16

**What is `Either`, and how does it relate to `Maybe` and error handling?**

`Either a b = Left a | Right b` is the canonical two-variant sum: `Left` conventionally carries an error/alternative and `Right` carries a success (mnemonic: "right" = correct). It's `|a| + |b|` algebraically and is the error-handling counterpart to Rust's `Result<b, a>`. `Maybe a = Nothing | Just a` (`1 + a`) only says "present or absent" — no information about *why* it's absent — whereas `Either e a` carries the error value `e`. Both are sum types replacing exceptions/null; you chain them with `fmap`/`>>=` so failures short-circuit.

### TypeScript (discriminated unions)

## Question 17

**What makes a TypeScript union a *discriminated* union, and how does narrowing work?**

A discriminated (tagged) union is a union of object types that share a common **literal-typed field** — the discriminant, e.g. `kind: "circle" | "square"`. When you `switch` (or `if`) on that field, TypeScript **narrows** the type within each branch: inside `case "circle":` the value is known to be the `circle` member, so `.radius` is accessible and `.side` is not. The literal field plays the role of the runtime tag, and narrowing is TypeScript's compile-time pattern matching. Without a shared discriminant field, TS can't narrow a general union safely.

## Question 18

**How do you get exhaustiveness checking in TypeScript, given that `switch` doesn't enforce it by default?**

Use the `never` type as an exhaustiveness guard. Add a `default` branch that assigns the value to a `never`-typed parameter:

```typescript
function assertNever(x: never): never { throw new Error("unreachable"); }
switch (shape.kind) {
  case "circle": return /* ... */;
  case "square": return /* ... */;
  default: return assertNever(shape);
}
```

If every variant is handled, `shape` is narrowed to `never` (the Void type) in `default`, and the call typechecks. If you add a variant and forget its case, `shape` is now a non-`never` type that isn't assignable to `never` — a **compile error** pinpointing the gap. This is the Void/Never type doing real work to bolt exhaustiveness onto a language that doesn't enforce it natively.

### Swift (enums)

## Question 19

**What are associated values and raw values in Swift enums, and how do they differ?**

**Raw values** give each case a fixed underlying constant of a single type: `enum Direction: Int { case north = 0, east = 1, ... }` — every case maps to one `Int`, and you get `init?(rawValue:)`/`.rawValue`. **Associated values** let each case carry *different* payload data: `enum Barcode { case upc(Int, Int, Int, Int); case qr(String) }` — a `upc` carries four ints, a `qr` carries a string. Raw values are the "C enum" flavor (a sum of labeled constants); associated values are the full ADT flavor (a sum of products). A Swift enum can have one or the other, not both.

## Question 20

**Swift's `switch` over an enum must be exhaustive. What are the implications of using `default` / `@unknown default`?**

Because Swift enforces exhaustiveness, a `switch` over an enum must cover every case or include a `default`. Using `default` to cover "the rest" silences the check: if you add a case later, the switch still compiles (routing the new case to `default`), so you lose the compiler's help. For enums from *other modules* (which may add cases in future versions) Swift provides `@unknown default`, which still requires you to handle all *currently known* cases explicitly and only catches genuinely-future ones — giving you a warning when a known case is missing while staying forward-compatible. Best practice: spell out all cases for your own enums; reserve `@unknown default` for library enums.

### Java (sealed + records)

## Question 21

**How do `sealed` interfaces and `record` classes give Java native algebraic data types?**

`record` gives concise **product** types: `record Point(double x, double y) {}` is an immutable data carrier with generated constructor, accessors, `equals`/`hashCode`/`toString`. `sealed` gives **closed sums**: `sealed interface Shape permits Circle, Rectangle {}` fixes the complete set of implementors, so the compiler knows every variant. Combined with **pattern matching in `switch`**, you get exhaustiveness: a `switch` over a sealed type needs no `default` because `javac` can verify all permitted types are covered, and forgetting one is a compile error. Together, `sealed` + `record` + switch patterns are native ADTs in mainstream Java — making the visitor pattern obsolete for closed hierarchies.

## Question 22

**Before `sealed`, how did Java model sum types, and what was wrong with it?**

The two classic approaches were an **abstract base class / interface with subclasses** plus `instanceof` chains, and the **visitor pattern**. The `instanceof` approach had no exhaustiveness — the hierarchy was open, so any new subclass could appear and `instanceof` chains silently failed to handle it at runtime. The visitor pattern *recovered* exhaustiveness by hand (every visitor must implement a method per node type, so adding a node forces a compile error in every visitor), but at the cost of heavy boilerplate, double dispatch, and a structure inverted from the data. Both leaned the wrong way on the expression problem for operation-heavy code (like ASTs). `sealed` fixes this by letting the compiler close the hierarchy and check exhaustiveness directly.

---

## Tricky / Trap Questions

## Question 23

**Is C's `void` the same as the empty/Void type?**

No — this is the most common trap. C/Java/JS `void` means "this function returns *no useful value* but does return" — it behaves like the **Unit** type (exactly one value: nothing-in-particular). The true empty type has **zero** values and can never be produced; it marks code that *never returns at all*. In modern languages it's Rust's `!`, TypeScript's `never`, Kotlin's `Nothing`, Haskell's `Void`. So "void" the keyword is Unit-flavored; the zero-value type is a different beast entirely.

## Question 24

**How many values does `Option<Option<bool>>` have, and can you name them?**

Five. By the algebra: `Option<bool> = 1 + 2 = 3`, so `Option<Option<bool>> = 1 + 3 = 4`... wait — recount: `bool = 2`, `Option<bool> = 1 + 2 = 3`, `Option<Option<bool>> = 1 + 3 = 4`. The four values are: `None`, `Some(None)`, `Some(Some(false))`, `Some(Some(true))`. (The trap is candidates who say five by double-counting, or who don't realize `Some(None)` and `None` are *distinct* — that distinction is exactly the nested-option smell, `2 + A`.)

## Question 25

**A teammate replaces a `(bool, bool)` field with a 4-variant enum and says "it's a totally different type now." Are they right?**

Not in terms of information. `(bool, bool)` has `2 × 2 = 4` inhabitants and the 4-variant enum has `1+1+1+1 = 4`, so they're **isomorphic** — there's a lossless, reversible mapping, and the refactor preserves exactly the same information. They *are* different types in that the compiler won't auto-convert between them and the enum's named variants are more readable, but no information was added or lost. The algebra (`2×2 = 4 = 1+1+1+1`) is the receipt that the change is information-preserving.

## Question 26

**You add a catch-all `_ => ...` arm to a match over your own enum "to be safe." What did you just give up?**

You gave up **exhaustiveness protection** for that match. The wildcard makes the match exhaustive *forever*, so when you later add a new variant, the compiler will *not* flag this site — it silently routes the new variant to the catch-all, which is often wrong. The whole value of a closed sum is that the compiler forces you to revisit every match when variants change; a wildcard over your own sum opts out of that. Spell out the cases instead, and reserve wildcards for genuinely open situations or truly uniform handling.

## Question 27

**Does a sum type's size depend on which variant is currently active?**

No. A sum value reserves space for the **largest** variant plus the discriminant, regardless of which variant it currently holds. So a `Result<(), [u8; 1_000_000]>` is about a megabyte even when it's the `Ok(())` value, because at runtime it *could* be the big `Err`. This is why you **box the fat variant** (`Result<(), Box<[u8; 1_000_000]>>`) to shrink the sum to "tag + pointer." Candidates who think size varies by active variant are picturing dynamic allocation that isn't there.

## Question 28

**"`Option` is just `null` with extra syntax." True or false, and why?**

False. The information is the same (`1 + T`), but the *guarantees* differ fundamentally. With `null`, the `+ null` is invisible to the type checker, so a plain `T` might secretly be null and nothing forces you to check — failures are deferred to runtime. With `Option<T>`, "absent" is an explicit variant the compiler *makes* you handle, and a plain `T` is *guaranteed* non-absent. Plus `Option` **composes** (`map`, `and_then`, `?`, `unwrap_or`) into pipelines, whereas null forces nested defensive checks. It's the difference between an unchecked, invisible failure mode and a checked, explicit, composable one.

## Question 29

**Why can Go's interface-based "sum types" not be exhaustively checked, while Rust enums can?**

Because Go interfaces are **open**: any type in any package can implement an interface, so the set of "variants" is never closed — the compiler cannot know the complete list at the `switch v := s.(type)` site, so it can't prove you covered them all (hence the mandatory `default`). Rust enums are **closed**: every variant is declared at the `enum` definition, the compiler knows the full set, and it can verify a `match` covers all of them and reject one that doesn't. Exhaustiveness *requires* a closed variant set; open extensibility and exhaustiveness are fundamentally in tension (that's the expression problem).

## Question 30

**`A × (B + C)` versus `A × B + A × C` — are these the same type? What's the practical point?**

They're **isomorphic** (distributivity of the type algebra: `A × (B + C) ≅ A×B + A×C`), so they hold identical information. Concretely: "a struct with a shared field `A` plus a two-way choice `(B + C)`" is equivalent to "a two-variant sum where each variant carries the shared field `A`." The practical point is that it's a legitimate, information-preserving **refactoring** — you can factor a shared field out of variants or push it into each, and the algebra guarantees you lost nothing. You then choose between them on ergonomics (less repetition vs self-contained variants), not on capability.

---

## Design Scenarios

## Question 31

**Design the type for a payment that can be a credit card, cash, or a gift voucher. Walk through your reasoning.**

This is a textbook sum — "a payment is *one of* these kinds" — and each kind carries different data, so it's a sum of products:

```rust
enum Payment {
    Card    { number: CardNumber, expiry: Expiry, cvv: Cvv },
    Cash    { tendered: Money },
    Voucher { code: VoucherCode, remaining: Money },
}
```

Reasoning: the word "or" in the spec signals a sum, not a struct-with-flags. Each variant carries *exactly* the data that payment method needs and nothing else — a `Cash` payment can't accidentally have a `cvv`, a `Card` can't have a voucher `code`. Processing is an exhaustive match, so adding a future method (say `Crypto`) makes every payment-handling site fail to compile until updated. I'd use newtypes (`Money`, `CardNumber`) so units and IDs can't be mixed, and smart constructors so a `CardNumber` is always valid by construction.

## Question 32

**Model the lifecycle of an order (created → paid → shipped → delivered, with possible cancellation). Why a sum over a struct-with-status-enum-and-nullable-fields?**

```rust
enum Order {
    Created   { items: Vec<Item> },
    Paid      { items: Vec<Item>, payment_id: PaymentId },
    Shipped   { items: Vec<Item>, payment_id: PaymentId, tracking: Tracking },
    Delivered { items: Vec<Item>, payment_id: PaymentId, delivered_at: Timestamp },
    Cancelled { reason: CancelReason },
}
```

The alternative — `struct Order { status: Status, payment_id: Option<PaymentId>, tracking: Option<Tracking>, ... }` — allows **illegal states**: `status: Created` with a non-null `tracking`, or `status: Shipped` with a null `payment_id`. The sum makes each state carry *exactly* its valid data, so "shipped but unpaid" or "created but tracked" can't be constructed. Transitions become functions like `fn ship(o: Order::Paid) -> Order::Shipped` (or typestate), and exhaustive matching ensures every state is handled. The struct-with-flags pushes correctness into runtime `if`-checks scattered everywhere; the sum pushes it into the type, once.

## Question 33

**You're designing an AST for a small language. Which way does the expression problem push you, and why?**

Toward **sum types with pattern matching**. An AST has a relatively *stable set of node kinds* (literals, binary ops, conditionals, function calls) but an *ever-growing set of operations* over them — evaluation, pretty-printing, type-checking, constant folding, optimization passes, code generation. Sum types make new operations cheap: each pass is a new function (or fold algebra) over the closed node set, exhaustiveness-checked, touching no existing code. The cost (new node kinds force edits to every pass) is acceptable because node kinds change rarely, and when they do, the compiler hands you the list of passes to update. If instead the node set were volatile and operations fixed, I'd reconsider toward an interface/visitor design — but for compilers, the operation axis dominates, so sums win decisively.

## Question 34

**Design an error-handling strategy for a service: when do you use `Result`/`Either`, and when an exception/panic?**

Use **`Result`/`Either` for expected, recoverable failures that are part of the function's contract** — "file not found," "validation failed," "request timed out," "record doesn't exist." Model the error set as a sum (`enum DbError { NotFound, Timeout, Conflict(Id) }`) so callers handle it exhaustively, propagate with `?`/`try`, and convert across module boundaries with `From`. Use **panic/exception for bugs and truly unrecoverable conditions** — invariant violations, "this can't happen," out-of-memory, programmer errors — where unwinding/crashing is the right response and there's no sensible recovery. The principle: errors in the *return type* for things the caller should reason about; unwinding for things that mean the program is in an invalid state. Don't `Result`-ify a logic bug, and don't `throw` an ordinary expected failure.

## Question 35

**A struct has 30 mostly-independent optional fields (like a config object). A colleague wants to turn it into a giant sum type "to make illegal states unrepresentable." Good idea?**

Probably not — this is a case where sums are the *wrong* tool. Thirty independent optionals is genuinely a **product of optionals**, not a choice among variants; forcing it into a sum would mean enumerating up to `2^30` combinations, which is absurd and unmaintainable. "Make illegal states unrepresentable" applies when fields are *correlated* (one field's presence depends on another) — then a sum captures the correlation. For *independent* optionals there are no illegal combinations to eliminate, so a struct-with-optionals is the honest, readable model. The senior judgment is recognizing that the methodology has a domain: it pays off for correlated state and state machines, and over-applying it produces unreadable type-Tetris. I'd push for sums only where actual cross-field invariants exist, and leave the genuinely independent options as a product.

---

## Cheat Sheet

```
+--------------------------------------------------------------+
| Sum / Product / Unit / Void — Must-Know                      |
+--------------------------------------------------------------+
| PRODUCT = AND  struct/tuple   |A×B| = |A|·|B|                |
| SUM     = OR   enum/variant   |A+B| = |A|+|B|                |
| UNIT = 1 value ()  (id of ×)  VOID = 0 values ! (id of +)    |
| FUNCTION A->B = exponential   |A->B| = |B|^|A|               |
|                                                              |
| Option<A> = 1 + A   Result<T,E> = T + E   bool = 1 + 1       |
| Option<Option<A>> = 2 + A  (two empties → flatten)          |
|                                                              |
| KILLER FEATURE: exhaustiveness — compiler proves every case |
|   handled; needs a CLOSED variant set (why native sums win) |
|                                                              |
| MAKE ILLEGAL STATES UNREPRESENTABLE                         |
|   flags+nullables → sum; smart constructor; newtype;        |
|   parse-don't-validate; typestate                           |
|                                                              |
| null = invisible unchecked T+null (billion-$ mistake)       |
| Option = explicit checked composable 1+T                    |
| throw = invisible error channel; Result = T+E in return type|
|                                                              |
| TAGGED (ADT, safe) vs UNTAGGED (C union, unsafe)            |
| EXPRESSION PROBLEM: sums → new OP cheap, new VARIANT costly  |
|                     interfaces → the opposite               |
|                                                              |
| TRAPS: C `void` is UNIT not VOID; wildcard kills exhaustive |
|   check; sum size = biggest variant; Option ≠ null          |
+--------------------------------------------------------------+
```

---

## Further Reading

- "Null References: The Billion Dollar Mistake" — Tony Hoare's talk.
- *Domain Modeling Made Functional* — Scott Wlaschin. "Make illegal states unrepresentable," in depth.
- "Parse, Don't Validate" — Alexis King.
- *Thinking with Types* — Sandy Maguire. The algebra of types and exponentials.
- "The Expression Problem" — Philip Wadler's original note.
- The Rust Book, "Enums and Pattern Matching"; the Swift Language Guide, "Enumerations"; the Java tutorials on sealed classes and record/pattern matching in `switch`.
- *Programming in Haskell* — Graham Hutton. ADTs, `data`/`newtype`/records, `Maybe`/`Either`.
- "Compiling Pattern Matching to Good Decision Trees" — Luc Maranget (how exhaustiveness is decided).
