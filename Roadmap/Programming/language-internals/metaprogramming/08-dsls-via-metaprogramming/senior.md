# DSLs via Metaprogramming — Senior Level

> **Topic:** [DSLs via Metaprogramming](README.md)
> **Focus:** Compile-checked, macro-based DSLs (Rust `html!`, `json!`, `sqlx::query!`), Ruby's `method_missing`/`instance_eval` machinery, and DSL design as an engineering discipline — error quality, leaky abstractions, and when *not* to build one.

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
13. [Cheat Sheet](#cheat-sheet)
14. [Summary](#summary)
15. [Further Reading](#further-reading)

---

## Introduction

> Focus: **When the DSL runs at *compile time* (macros) you can validate it before the program runs — but the cost is harder errors and tooling. How do you design a DSL whose errors speak the domain, and how do you know when to build one at all?**

The earlier tiers built DSLs that run at *runtime*: a fluent builder assembles a query as the program executes; an operator-overloaded expression tree is walked when you call `.sql()`. This tier crosses a fundamental line into **compile-time DSLs**, where the DSL is processed *before* your program runs:

- **Rust procedural and declarative macros.** `vec![1, 2, 3]`, `json!({ "k": v })` (serde_json), `html!` (Yew), and `sqlx::query!("SELECT ...")` all transform DSL syntax into real Rust code *at compile time*. The dramatic example is `sqlx::query!`, which connects to your database **during compilation** to verify the SQL is valid and the result columns match your structs. A typo in a column name becomes a *compile error*, not a 3 a.m. production incident.
- **Ruby's deep metaprogramming.** `method_missing`, `define_method`, `instance_eval`, and `instance_exec` are how Rails, RSpec, and Rake build their famously fluent DSLs. These run at runtime but reshape what objects respond to, dynamically.

The senior shift is not just learning more techniques — it is treating **DSL design as engineering with real costs**. A DSL is an interface you are imposing on every future reader and maintainer. The questions that matter at this level are: *Do the error messages speak the domain or leak the implementation? Does the abstraction leak under pressure? Does the IDE understand it? And — most important — should this have been a plain library at all?* Compile-time DSLs raise the stakes: they catch more bugs but produce the most baffling error messages in all of programming when they go wrong.

> 🎓 **Why this matters at the senior level:** You will *choose* whether your team adopts or builds a DSL, and you will own the consequences. The senior failure mode is building a clever DSL that the team cannot debug, that the IDE cannot navigate, and that turns a one-line fix into an archaeology expedition. Knowing the cost model — and the macro machinery behind compile-checked DSLs — is what lets you make that call well.

This page covers: macro-based DSLs and the spectrum from declarative `macro_rules!` to procedural macros, compile-time validation (`sqlx::query!`), how Ruby's `method_missing`/`instance_eval` power runtime DSLs, the technique-to-style mapping (which metaprogramming tool yields which DSL flavor), and the design discipline: error quality, leaky abstractions, IDE/tooling, and the "should this be a DSL?" decision. `professional.md` then grounds all of this in production systems (Gradle, SQLAlchemy, Compose) and their organizational trade-offs.

---

## Prerequisites

What you should know before reading this:

- **Required:** Everything in `junior.md` and `middle.md`: internal vs external DSLs, chaining/builders, blocks, operator overloading, expression trees, receiver-lambdas.
- **Required:** What an **AST** is and that compilers transform code through tree representations. We use this directly.
- **Required:** Reading-level comfort with Rust *or* Ruby (examples lean on both; you need not write either fluently).
- **Helpful but not required:** Exposure to Rust macros (`macro_rules!`, derive macros) or Ruby metaprogramming. We re-explain the relevant pieces.
- **Helpful but not required:** Having maintained a codebase built on a heavy DSL (Rails, Gradle) and felt the debugging pain firsthand.

You do **not** need to know:

- How to write a full procedural macro crate end to end (we sketch, not implement).
- Compiler internals beyond "macros transform token streams into ASTs."
- Type-theory formalisms; we reason about types operationally.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Compile-time DSL** | A DSL processed by a macro/compiler before the program runs; errors surface at build time. |
| **Declarative macro** | (Rust `macro_rules!`) pattern-matches token sequences and expands to code. Hygienic, limited. |
| **Procedural macro** | (Rust) a function that receives a `TokenStream` and returns one — arbitrary code generation; powers `html!`, `sqlx::query!`. |
| **Macro hygiene** | The guarantee that macro-introduced names do not collide with the caller's names. |
| **Token stream** | The lexed-but-not-yet-parsed sequence a macro operates on. |
| **Compile-time validation** | Checking the DSL's correctness during compilation (e.g. `sqlx::query!` validating SQL against a live DB). |
| **`method_missing`** | (Ruby) a hook invoked when an object receives a message it has no method for — the engine of dynamic DSLs. |
| **`define_method`** | (Ruby) defines a method at runtime from a name + block; used to generate DSL methods. |
| **`instance_eval` / `instance_exec`** | (Ruby) evaluate a block with `self` rebound to a chosen object; the block-DSL engine. |
| **Leaky abstraction** | When the DSL's implementation shows through — usually as an error in implementation terms, not domain terms. |
| **Error provenance** | Whether a DSL error points at the user's DSL code or at the library's internals. |
| **Spans** | (Rust macros) source-location metadata letting a macro point errors back at the user's tokens. |
| **`respond_to_missing?`** | (Ruby) the companion to `method_missing` that keeps reflection/`respond_to?` honest. |
| **Hygiene leak** | A bug where macro-introduced identifiers capture or are captured by user identifiers. |
| **Quasiquotation** | Building code templates with holes (`quote!`/`quasiquote` in Rust, `quote` in Lisp/Elixir) — the comfortable way to emit code from a macro. |

---

## Core Concepts

### 1. Macros Move the DSL to Compile Time

A runtime DSL builds and interprets data while the program runs. A **macro-based DSL** transforms *syntax into code* before the program runs. Rust's declarative `macro_rules!` is the gentle entry point:

```rust
macro_rules! hashmap {
    ( $( $key:expr => $val:expr ),* $(,)? ) => {{
        let mut m = std::collections::HashMap::new();
        $( m.insert($key, $val); )*
        m
    }};
}

let scores = hashmap! {
    "alice" => 10,
    "bob"   => 20,
};
```

The macro matched the `key => val` pattern and **expanded** it into real Rust (`m.insert(...)` per pair) at compile time. There is no runtime parser, no expression tree to walk — the DSL *became* ordinary code before the program ever ran. `vec![...]` and `json!{...}` (serde_json) work the same way at the declarative or procedural level.

### 2. Procedural Macros: Arbitrary Compile-Time Code Generation

When pattern matching is not enough, **procedural macros** receive a `TokenStream` (the raw tokens of the DSL) and return a `TokenStream` (the generated code). This is a full programmable transformation:

```rust
// usage (Yew):
html! {
    <div class="card">
        <h1>{ title }</h1>
        { for items.iter().map(render_item) }
    </div>
}
```

The `html!` proc-macro parses the JSX-like syntax, type-checks the expressions in `{ ... }`, and emits Rust that constructs a virtual DOM. Because it runs in the compiler, it can produce **compile errors** for malformed markup and can use **spans** to point those errors at the exact offending token in your source.

### 3. Compile-Time Validation: The `sqlx::query!` Superpower

The most striking compile-time DSL is `sqlx::query!`. It connects to a real database **during compilation** and checks the SQL:

```rust
let user = sqlx::query!(
    "SELECT id, name, age FROM users WHERE id = $1",
    user_id
)
.fetch_one(&pool)
.await?;

// user.name is &str, user.age is i32 — types INFERRED from the DB schema.
```

If you misspell `name`, reference a non-existent table, or mismatch a parameter type, the program **does not compile**. The macro also generates a struct whose field types come from the database's own type information. This is the apex of "the DSL catches bugs before runtime" — it pulls a class of errors all the way from production back to your build. The trade-off is explicit: you need DB access (or a cached `.sqlx` schema) at build time, and macro errors can be cryptic.

### 4. Ruby's Runtime Metaprogramming: `method_missing` and `instance_eval`

Ruby builds the most fluent runtime DSLs in mainstream use, and two hooks do most of the work.

**`method_missing`** turns *any* method name into behavior — the engine behind ActiveRecord's `find_by_email_and_status`:

```ruby
class Config
  def initialize; @settings = {}; end
  def method_missing(name, *args)
    if name.to_s.end_with?("=")
      @settings[name.to_s.chomp("=").to_sym] = args.first   # setter
    else
      @settings[name]                                        # getter
    end
  end
  def respond_to_missing?(name, include_private = false)
    true
  end
end

c = Config.new
c.timeout = 30        # method_missing("timeout=", 30)
c.timeout             # => 30
```

**`instance_eval`** runs a block with `self` rebound, which is how `do ... end` config DSLs drop the receiver prefix:

```ruby
def configure(&block)
  config = Config.new
  config.instance_eval(&block)    # block's `self` becomes `config`
  config
end

settings = configure do
  self.timeout = 30
  self.retries = 3
end
```

RSpec's `describe/it`, Rake's task blocks, and Rails routing all combine `instance_eval`/`instance_exec` (run a block in your object's context) with `define_method` (generate methods on the fly). The cost is the dark side of `method_missing`: a typo'd method name does not error — it silently becomes "missing method" behavior, and stack traces point into the metaprogramming machinery, not your DSL.

### 5. The Technique-to-Style Map

A senior carries a mental table of *which metaprogramming tool produces which DSL flavor*:

| Technique | Host examples | DSL style it yields | Validation |
|-----------|---------------|---------------------|------------|
| Method chaining / builder | everywhere | Fluent config/query skeleton | Runtime |
| Operator overloading | SQLAlchemy, pandas | Expression/query/math DSL | Runtime |
| Blocks + `instance_eval` | RSpec, Rake, Rails | Config/testing/build DSL | Runtime (weak) |
| Lambdas-with-receiver | Kotlin HTML, Gradle KTS, Ktor | Typed nested builder | Compile (types) |
| Declarative macros | `vec!`, `hashmap!` | Literal/collection DSL | Compile |
| Procedural macros | `html!`, `json!`, `sqlx::query!` | Markup/serialization/query DSL | Compile (strong) |
| `method_missing`/`define_method` | ActiveRecord | Dynamic, open-ended DSL | None (dynamic) |
| Decorators / reflection | Flask routes, Spring annotations | Declarative config DSL | Runtime/startup |

The right column is the crux: **macros buy you compile-time validation; dynamic Ruby buys you fluency at the cost of all static checking.** Choosing a technique is choosing where on the validation spectrum your DSL sits.

### 6. DSL Design Is Interface Design Under a Cost Model

At this tier the central skill is judgment. A DSL imposes a second language on every reader; it earns that cost only when it (a) is used often, (b) is read more than written, and (c) genuinely clarifies the domain. Three design properties decide whether a DSL is a gift or a liability:

- **Error provenance.** When something goes wrong, does the error name the *domain* mistake (`unknown column "naem"`) or leak the *implementation* (`NoneType has no attribute 'compile'`, or a 40-line macro-expansion trace)? This single property predicts how much a team will love or hate your DSL.
- **Leak resistance.** Under unusual input, does the abstraction hold, or must users suddenly understand the plumbing? Every DSL leaks *somewhere*; good ones leak gracefully (a documented escape hatch) rather than catastrophically (an unreadable stack trace).
- **Tooling.** Autocomplete, go-to-definition, type checking, formatting. A typed Kotlin builder gives all four; a `method_missing` DSL gives almost none. Tooling support is often the deciding factor for adoption.

---

## Real-World Analogies

**A pre-flight checklist vs. mid-flight troubleshooting.** Compile-time DSLs (`sqlx::query!`) are pre-flight: problems are caught on the ground, before takeoff. Runtime DSLs catch them mid-flight. Both are valuable, but a bug found at compile time is dramatically cheaper than one found in production — exactly why teams accept macro complexity.

**A concierge who answers questions you never explicitly taught them.** `method_missing` is a concierge who, asked anything, improvises a sensible response. Magical when the guest asks reasonable things; disastrous when they typo a request and the concierge confidently does the wrong thing without flagging it.

**A translator standing between a tourist and a local.** A DSL translates domain intent into implementation. A great translator (good error provenance) tells the tourist precisely what went wrong in their *own* language. A poor one shrugs and quotes the local's words verbatim — which is what a leaked stack trace does.

**A power tool with the guard removed.** Procedural macros are power tools: they generate arbitrary code and catch errors early, but their failure modes (hygiene leaks, incomprehensible expansion errors) can cut deep. The guard is good error spans and documentation.

---

## Mental Models

**Model 1: "Macros are functions from code to code."** A macro is `TokenStream -> TokenStream`: it consumes the DSL's syntax and emits real code, all before runtime. Read every macro DSL as "what code does this expand to?" — then you are reasoning about ordinary code.

**Model 2: "Validation lives on a spectrum, and the technique picks the point."** From "no checks ever" (`method_missing`) through "runtime checks" (fluent builders) to "compile-time, schema-verified" (`sqlx::query!`). Choosing a DSL technique is choosing where on this line bugs get caught.

**Model 3: "A DSL's quality is its worst error message."** Users judge a DSL not on its happy path — every DSL is pleasant when correct — but on what happens when they make a mistake. Design the error path first.

**Model 4: "Every abstraction leaks; design the leak."** You cannot prevent leaks; you can decide *how* it leaks. A documented `raw_sql()` escape hatch is a designed leak. A macro panic with no span is an undesigned one. Seniors design the leak deliberately.

**Model 5: "Two languages, one debugger."** When a DSL breaks, the user debugs in the *host* language, not the DSL. The further the stack trace is from the user's DSL code, the worse the experience. Minimize that distance.

---

## Code Examples

### Example 1: A declarative macro DSL with trailing-comma support (Rust)

```rust
macro_rules! routes {
    ( $( $method:ident $path:literal => $handler:expr ),* $(,)? ) => {{
        let mut r = Router::new();
        $( r.add(stringify!($method), $path, $handler); )*
        r
    }};
}

let router = routes! {
    GET  "/"        => home,
    GET  "/users"   => list_users,
    POST "/users"   => create_user,
};
```

The DSL reads like a routing table; the macro expands it to `r.add(...)` calls at compile time. `$(,)?` permits a trailing comma — a small courtesy that makes the DSL feel native. No runtime cost, and malformed entries fail to compile.

### Example 2: Compile-time-checked query (sqlx, conceptual)

```rust
// If the column "naem" does not exist, THIS LINE fails to compile.
let row = sqlx::query!(
    "SELECT id, naem FROM users WHERE id = $1",
    id
).fetch_one(&pool).await?;
//   error: no column found for name: naem
//          --> src/main.rs:3:5
```

The payoff: a class of bugs (schema drift, typos, type mismatches) is moved from runtime to build time. The price: the build needs database metadata, and when the macro *does* error, the message — while better than most — still lives partly in macro-expansion terms.

### Example 3: A Ruby DSL combining `instance_eval` + `define_method`

```ruby
class Pipeline
  def self.build(&block)
    p = new
    p.instance_eval(&block)
    p
  end

  def initialize; @steps = []; end

  def step(name, &body)
    @steps << [name, body]
    # generate a query-method per step: pipeline.has_validate?
    self.class.define_method("has_#{name}?") { @steps.any? { |n, _| n == name } }
  end

  def run(input)
    @steps.reduce(input) { |acc, (_, body)| body.call(acc) }
  end
end

pipe = Pipeline.build do
  step(:validate) { |x| raise "bad" unless x.is_a?(Integer); x }
  step(:double)   { |x| x * 2 }
end

pipe.run(21)         # => 42
pipe.has_double?     # => true   (method generated at build time)
```

This shows the Ruby pattern in full: `instance_eval` for the block DSL, `define_method` to generate methods reactively. It is fluent and powerful — and note the failure mode: a typo like `pipe.has_doubel?` raises `NoMethodError` deep in Ruby, not a domain-level "no such step."

### Example 4: Designing the leak — a safe escape hatch

```python
class Query:
    def where(self, expr): ...; return self
    def raw(self, sql_fragment, *params):
        """Documented escape hatch: when the expression DSL can't express
        something (a vendor-specific function), drop to raw SQL — but the
        params are still bound, so this stays injection-safe."""
        self._raw.append((sql_fragment, params))
        return self

q.where(User.age > 21).raw("age <@ int4range(?, ?)", 18, 65)
```

The senior move: the abstraction *will* leak (some SQL is inexpressible), so you design a leak that preserves the DSL's core guarantee (parameter binding) instead of letting users fall back to unsafe string concatenation.

---

## Pros & Cons

**Pros**

- **Compile-time DSLs catch bugs before runtime.** `sqlx::query!` turns production SQL errors into build errors — the single biggest payoff in this topic.
- **Macros eliminate runtime overhead.** The DSL becomes ordinary code at compile time; there is no parser or tree-walk at runtime.
- **Ruby-style dynamic DSLs are maximally fluent.** `method_missing`/`instance_eval` produce DSLs (RSpec, Rails) that read almost like prose.
- **Code generation reduces boilerplate dramatically.** A derive macro or `define_method` can replace hundreds of hand-written lines.

**Cons**

- **Macro errors are the worst in programming.** A malformed proc-macro invocation can produce expansion traces that are nearly unreadable.
- **Dynamic DSLs have no static safety.** `method_missing` means typos become silent or late `NoMethodError`s; IDEs cannot autocomplete or navigate.
- **Tooling and debuggability suffer.** Step-debugging generated or `method_missing`'d code is painful; stack traces point at machinery.
- **High build-time coupling (`sqlx`).** Needing the DB at compile time complicates CI and offline builds (mitigated by cached schema, but it is a cost).
- **Maintenance burden.** A custom macro or heavy metaprogramming layer is a mini-compiler your team now owns forever.

---

## Use Cases

- **Markup / UI at compile time:** Yew `html!`, Leptos `view!` — JSX-like DSLs that type-check expressions and emit virtual-DOM code.
- **Serialization literals:** serde_json `json!`, collection macros (`vec!`, `hashmap!`) — concise, compile-checked literal construction.
- **Compile-checked queries:** `sqlx::query!`, Diesel's query builder — SQL validated against the schema at build time.
- **Testing / behavior specs:** RSpec, minitest's spec DSL — `instance_eval` blocks + dynamic matchers.
- **Build & config:** Rake, Rails routing/initializers — Ruby block DSLs; conceptually mirrored by Gradle's typed Kotlin DSL.
- **Dynamic finders/ORMs:** ActiveRecord `find_by_*` — `method_missing` generating query methods on demand.

---

## Coding Patterns

**Pattern: expand to plain code, then reason about the plain code.** When writing or reviewing a macro DSL, mentally (or with `cargo expand`) produce the expansion and verify *that* is correct. The macro is just the generator.

**Pattern: attach spans so errors point at the user.** In Rust proc-macros, propagate source spans so a bad token reports *at the user's call site*, not at the macro's internals. This is the difference between a usable and a hated macro.

**Pattern: pair `method_missing` with `respond_to_missing?`.** Always implement both, or reflection, `respond_to?`, and `method()` lie — breaking duck-typing and tooling that depends on them.

**Pattern: define the escape hatch up front.** Assume the DSL cannot express everything; provide a documented, *safe* fallback (`raw(...)` with bound params) so users do not improvise unsafe ones.

**Pattern: generate methods, do not intercept, when you can.** `define_method` (concrete, introspectable, autocompletable) beats `method_missing` (invisible to tooling) whenever the set of methods is knowable up front.

**Pattern: keep the DSL surface small.** A focused DSL (a dozen well-named constructs) is learnable and maintainable; a sprawling one becomes a dialect only its author understands.

---

## Best Practices

- **Design the error path before the happy path.** Decide what each likely mistake reports, in domain terms, before you polish the fluent syntax. Users meet your DSL through its errors.
- **Prefer compile-time validation where the payoff is high.** For queries, schemas, and routes, catching errors at build time (macros, types) is worth real complexity. For one-off config, runtime is fine.
- **Make expansions visible.** Document how the macro expands (and point users to `cargo expand`); make `method_missing` behavior discoverable. A DSL nobody can see through is a DSL nobody can fix.
- **Respect the host's tooling.** Choose techniques that keep autocomplete and go-to-definition working (typed builders, `define_method`) over those that blind the IDE (`method_missing`) unless the fluency gain is decisive.
- **Write the "why not a plain library?" paragraph.** Before building a DSL, articulate what it buys over ordinary functions. If you cannot, build the functions.
- **Budget for the maintenance of a mini-compiler.** A macro crate or metaprogramming layer is long-lived infrastructure. Staff and document it accordingly.

---

## Edge Cases & Pitfalls

- **Macro hygiene leaks.** A macro that introduces an identifier (`let tmp = ...`) can collide with the user's `tmp`. Rust's hygiene mostly prevents this; hand-rolled or `unhygienic` cases can break subtly.
- **`method_missing` swallowing typos.** A misspelled DSL method silently routes to fallback behavior or raises late. Always implement `respond_to_missing?`, and consider whitelisting valid names.
- **`sqlx`/compile-time DB coupling.** CI without DB access fails unless you commit cached schema metadata. Plan the offline-build story before adopting.
- **Expansion-error illegibility.** A small mistake inside `html!`/`json!` can produce a wall of generated-code errors. Provide examples and, where possible, custom error messages with spans.
- **`instance_eval` rebinds `self` surprisingly.** Inside the block, `self` is no longer what the reader expects; references to outer instance variables and constants can resolve unexpectedly. Document the receiver explicitly.
- **Performance of dynamic dispatch.** Heavy `method_missing` use is slower than direct calls and defeats some JIT/inline-cache optimizations; hot paths should use generated concrete methods.
- **Two-implementation drift.** A DSL plus its escape hatch can encode the same operation two ways that disagree. Keep one canonical lowering.
- **Building a DSL for a problem that was a function.** The recurring senior pitfall: a clever macro/metaprogramming layer where three named functions would have been clearer, faster to onboard, and trivially debuggable.

---

## Cheat Sheet

| Idea | One-liner |
|------|-----------|
| Declarative macro | `macro_rules!` pattern-matches tokens → expands to code. |
| Procedural macro | `TokenStream -> TokenStream`; arbitrary compile-time codegen. |
| Compile-time validation | `sqlx::query!` checks SQL vs live DB at build time. |
| `method_missing` | Ruby hook → any method name becomes behavior (dynamic DSL). |
| `instance_eval` | Run a block with `self` rebound → prefix-free config blocks. |
| `define_method` | Generate methods at runtime (introspectable, unlike `method_missing`). |
| Validation spectrum | none (`method_missing`) → runtime → compile-time (macros). |
| Error provenance | Does the error name the domain or leak the implementation? |
| Design the leak | Provide a safe, documented escape hatch (`raw()` with bound params). |
| "Should this be a DSL?" | If a plain library is as clear, build the library. |

---

## Summary

The senior tier crosses into **compile-time DSLs**. Rust macros — declarative `macro_rules!` (`vec!`, `hashmap!`) and procedural macros (`html!`, `json!`, `sqlx::query!`) — transform DSL syntax into real code *before the program runs*, with `sqlx::query!` going furthest by validating SQL against a live database at compile time and inferring result types from the schema. On the runtime side, Ruby's `method_missing`, `define_method`, and `instance_eval`/`instance_exec` power the most fluent DSLs in mainstream use (RSpec, Rake, Rails) — at the cost of all static safety and tooling support.

The deeper lesson is that **DSL design is interface design under a cost model**. The technique you choose places the DSL on a *validation spectrum* from "no checks ever" (`method_missing`) to "compile-time, schema-verified" (`sqlx`). Three properties decide whether a DSL is a gift or a liability: **error provenance** (does it speak the domain or leak the implementation?), **leak resistance** (does the abstraction hold, and is the leak designed?), and **tooling** (autocomplete, navigation, type checking). The senior discipline is to design the error path first, prefer compile-time validation where the payoff is high, keep the host's tooling working, and — most often the right call — write the paragraph justifying the DSL over a plain library before building it. `professional.md` applies all of this to production systems and the organizational trade-offs of shipping a DSL to a whole company.

---

## Further Reading

- *The Little Book of Rust Macros* and the Rust Reference's macro chapters — declarative and procedural macros, hygiene, and spans.
- The `sqlx` README and design notes — how compile-time query checking and offline schema caching actually work.
- Paolo Perrotta, *Metaprogramming Ruby* — `method_missing`, `define_method`, `instance_eval`, and the DSLs they enable, explained mechanically.
- Martin Fowler, *Domain-Specific Languages* — the chapters on internal-DSL implementation patterns and on choosing whether to build one.
- Joe Armstrong / Lisp-tradition writing on macros — the original "code is data" framing that underlies every macro DSL.
