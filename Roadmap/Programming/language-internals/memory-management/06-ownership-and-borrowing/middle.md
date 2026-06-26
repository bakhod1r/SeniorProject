# Ownership & Borrowing — Middle Level

> **Topic:** [Ownership & Borrowing](README.md)
> **Focus:** How the borrow checker actually works — lifetimes, the aliasing-XOR-mutability rule, non-lexical lifetimes, and the escape hatches for when the static rules are too strict.

---

## Table of Contents

- [Introduction](#introduction)
- [Prerequisites](#prerequisites)
- [Glossary](#glossary)
- [Core Concepts](#core-concepts)
- [Mental Models](#mental-models)
- [Code Examples](#code-examples)
- [Coding Patterns](#coding-patterns)
- [Pros & Cons](#pros--cons)
- [Use Cases](#use-cases)
- [Best Practices](#best-practices)
- [Edge Cases & Pitfalls](#edge-cases--pitfalls)
- [Summary](#summary)

---

## Introduction

At the junior level, ownership is "who frees the memory." At this level we open the hood. The borrow checker is a static analysis that proves, before your program runs, that **every reference is valid for exactly as long as it is used and no longer**. To do that it reasons about *lifetimes* — regions of code over which a reference stays alive — and enforces *aliasing XOR mutability*. This page explains those mechanisms, how the compiler infers most of them for you (elision, NLL), when you must write them down (explicit lifetime annotations), and the standard library tools that let you opt out of the static rules when they're genuinely too restrictive (`Box`, `Rc`/`Arc`, `RefCell`/`Cell`/`Mutex`).

The goal is that borrow-checker errors stop feeling random and start feeling like the compiler pointing at a real bug — or a real design decision you haven't made yet.

## Prerequisites

- The junior-level model: one owner, move semantics, drop on scope exit, `&T` vs `&mut T`.
- Comfort reading Rust function signatures.
- A working understanding of stack frames: why a value created inside a function is gone when the function returns.

## Glossary

- **Lifetime** — a region of the program for which a reference is valid. Written `'a`, `'b`, etc. Lifetimes are a *compile-time* concept; they do not exist at runtime.
- **Lifetime elision** — rules that let the compiler infer lifetimes so you don't have to write them in common cases.
- **Borrow checker** — the compiler pass that verifies references obey the rules.
- **NLL (non-lexical lifetimes)** — the modern borrow checker, where a borrow lasts only until its *last use*, not until the end of the lexical scope.
- **Dangling reference** — a reference to memory that has already been freed. The borrow checker makes these impossible in safe Rust.
- **Interior mutability** — mutating data through a shared (`&`) reference, made safe by moving the aliasing check to runtime (`RefCell`, `Cell`, `Mutex`).
- **`Box<T>`** — a pointer to a single heap allocation with single ownership.
- **`Rc<T>` / `Arc<T>`** — reference-counted shared ownership (`Rc` single-threaded, `Arc` atomic/thread-safe).
- **`Weak<T>`** — a non-owning reference-counted handle, used to break cycles.

## Core Concepts

### Lifetimes are regions, not durations

A lifetime is *not* "how long in seconds." It is a **region of code** — a set of program points — over which a reference must remain valid. The core safety property is one sentence:

> A borrow must not outlive the value it points to.

If you borrow `&x`, that reference's lifetime must end before `x` is dropped. The compiler checks this by comparing regions.

### Lifetime elision: why you rarely write `'a`

Most functions never mention lifetimes because three **elision rules** fill them in:

1. Each elided input reference gets its own distinct lifetime.
2. If there is exactly one input lifetime, it is assigned to all output references.
3. If there is a `&self` or `&mut self`, its lifetime is assigned to all output references.

So `fn first(s: &str) -> &str` is shorthand for `fn first<'a>(s: &'a str) -> &'a str`: the returned reference lives as long as the input. You only write lifetimes explicitly when elision can't decide — typically when a function takes *multiple* references and returns one, and the compiler can't tell which input the output borrows from.

```rust
// Ambiguous: does the result borrow from x or y? You must say.
fn longest<'a>(x: &'a str, y: &'a str) -> &'a str {
    if x.len() > y.len() { x } else { y }
}
```

The `'a` here means: "the returned reference is valid for the *shorter* of the regions that `x` and `y` are valid for." It's a constraint, not an instruction to allocate anything.

### Aliasing XOR mutability, formalized

At any program point, for any given value, you may have **either**:

- any number of shared references `&T` (readers), **or**
- exactly one mutable reference `&mut T` (a writer),

**but never both at once.** This is the rule that:

- prevents **data races** (a data race requires two accesses, at least one a write, with no synchronization — impossible if writes are exclusive),
- prevents **iterator invalidation** (you can't hold a `&` into a `Vec` while something else holds a `&mut` to push and reallocate it),
- enables aggressive optimization (the compiler knows a `&T` won't change underneath it).

### NLL — borrows end at last use

The original borrow checker tied a borrow to its lexical scope (the enclosing `{}`). **Non-lexical lifetimes** changed that: a borrow lasts only until its **last use**. This made huge numbers of correct programs compile.

```rust
let mut v = vec![1, 2, 3];
let first = &v[0];      // shared borrow starts
println!("{first}");    // ...last use of `first` here
v.push(4);              // OK under NLL: the shared borrow already ended
```

Under the old rules this was an error because `first` was "alive" until the end of the block. Under NLL the borrow is dead after the `println!`, so the `&mut` from `push` is fine.

## Mental Models

**The borrow checker is a theorem prover for "no dangling references."** It doesn't run your code; it proves a property about all possible runs. If it can't prove safety, it rejects — even if your particular execution would have been fine. That's why some valid programs are rejected: the checker is *sound* (never accepts unsafe code) but not *complete* (sometimes rejects safe code).

**Lifetimes flow like constraints in a system of inequalities.** Each `'a: 'b` ("`'a` outlives `'b`") is an inequality. The compiler solves the system; if there's no solution, you get a lifetime error. Writing annotations is supplying constraints the compiler couldn't infer.

**Interior mutability moves the proof from compile time to run time.** When you genuinely need shared-and-mutable, you don't break the rule — you *defer the check*. `RefCell` enforces aliasing XOR mutability at runtime and panics if you violate it, paying a small cost for flexibility the static checker can't give.

## Code Examples

### A lifetime error and its fix

```rust
fn dangling() -> &String {     // ERROR: missing lifetime / returns ref to local
    let s = String::from("hi");
    &s                         // s is dropped at the `}` — ref would dangle
}
```

The compiler rejects this because the returned reference would point at freed memory. Fixes: return the owned `String` (move it out), or take the data as a parameter and return a borrow of *that*:

```rust
fn first_word(s: &str) -> &str {   // elided: output borrows from input
    s.split(' ').next().unwrap_or("")
}
```

### Structs that hold references need lifetimes

```rust
struct Excerpt<'a> {
    part: &'a str,    // the struct cannot outlive the str it points into
}

fn main() {
    let novel = String::from("Call me Ishmael. Some years ago...");
    let first_sentence = novel.split('.').next().unwrap();
    let e = Excerpt { part: first_sentence }; // e tied to `novel`'s lifetime
    println!("{}", e.part);
} // novel dropped here; e already done — fine
```

### Box: single owner on the heap

```rust
let boxed: Box<i32> = Box::new(5);   // i32 lives on the heap, one owner
println!("{}", *boxed);              // deref to read
// boxed dropped at scope end -> heap freed
```

`Box` is the simplest escape hatch: it's needed for recursive types (a type that contains itself) and for owning a value whose size isn't known at compile time (trait objects, `Box<dyn Trait>`).

### Rc/Arc: shared ownership

```rust
use std::rc::Rc;

let a = Rc::new(String::from("shared"));
let b = Rc::clone(&a);     // both own it; refcount = 2 (no deep copy)
let c = Rc::clone(&a);     // refcount = 3
println!("count = {}", Rc::strong_count(&a)); // 3
// value freed only when the LAST Rc drops (count hits 0)
```

`Rc::clone` is cheap — it bumps a counter, it does not copy the string. Use `Arc` (atomic refcount) when sharing across threads; `Rc` is single-threaded only and the compiler enforces that.

### RefCell: interior mutability

```rust
use std::cell::RefCell;

let cell = RefCell::new(vec![1, 2, 3]);
cell.borrow_mut().push(4);            // mutate through a shared handle
println!("{:?}", cell.borrow());     // [1, 2, 3, 4]

// Violating the rule panics at RUNTIME, not compile time:
let _a = cell.borrow_mut();
// let _b = cell.borrow_mut();        // PANIC: already mutably borrowed
```

`Rc<RefCell<T>>` is the common combination for "shared, mutable, single-threaded" data (e.g., nodes in a tree you need to edit). The thread-safe analogue is `Arc<Mutex<T>>`.

## Coding Patterns

- **Take `&str`, not `&String`; `&[T]`, not `&Vec<T>`.** Borrowing the slice type makes functions accept more callers (string literals, sub-slices) and signals "I only read this."
- **Return owned data to break a borrow dependency.** If a returned reference would tangle lifetimes, returning an owned `String`/`Vec` decouples the caller. Measure before assuming the clone matters.
- **`Rc<RefCell<T>>` for shared-mutable single-threaded graphs; `Arc<Mutex<T>>` across threads.** This is the standard recipe when the static checker can't express your sharing.
- **`Weak<T>` for back-pointers.** In a parent→child tree where children also point to parents, make the child→parent edge a `Weak` so the `Rc` cycle can't leak.

## Pros & Cons

**Pros**

- Lifetimes make dangling references a *compile error*, with no runtime cost.
- Elision and NLL mean you write annotations rarely; the ergonomics are far better than the rules suggest.
- Escape hatches exist for every legitimate pattern — you are never truly stuck, you just pay a known cost.

**Cons**

- Lifetime annotations on complex APIs are genuinely hard to read and write.
- The checker rejects some safe programs (incompleteness), which can be frustrating.
- `RefCell` trades compile-time errors for *runtime panics* — you can ship a borrow bug that only fails in production.
- `Rc`/`Arc` cycles **leak** (covered below) because reference counting can't collect cycles.

## Use Cases

- **Parsers and zero-copy data structures** lean on lifetimes to hold references into a source buffer without copying it.
- **Tree and graph structures** use `Rc`/`Arc` + `RefCell`/`Mutex` + `Weak`.
- **Recursive enums** (linked lists, ASTs) require `Box` to have a finite, known size.
- **Concurrent shared state** uses `Arc<Mutex<T>>` as the default building block.

## Best Practices

- **Don't add lifetime annotations until the compiler asks.** Let elision work; reach for `'a` only when you get a "missing lifetime specifier" error, and read it as "tell me which input the output borrows from."
- **Prefer the static checker over `RefCell`.** Interior mutability is a tool, not a default. Every `RefCell` is a borrow check you moved to runtime — only do it when the compile-time version is genuinely impossible to express.
- **Audit `Rc` graphs for cycles.** If two `Rc`s can point at each other, you have a leak. Make one direction `Weak`.
- **Keep `&mut` borrows short.** Thanks to NLL, finishing with a mutable borrow quickly frees the value for other uses; long-lived `&mut` borrows are the usual cause of "cannot borrow as X" errors.

## Edge Cases & Pitfalls

- **`RefCell` double-borrow panic.** `borrow_mut()` while another borrow is live panics at runtime. This is the price of interior mutability; it can hide in conditional code paths.
- **`Rc` cycles leak memory.** `a → b → a` keeps both refcounts ≥ 1 forever; neither is ever freed. This is the one way to leak in safe Rust, and it's why `Weak` exists.
- **"Cannot return reference to temporary."** Returning `&` to something created inside the function (or to a temporary) is rejected; the value dies at the function boundary.
- **Self-referential structs.** A struct that holds a reference into *its own* field cannot be expressed with normal lifetimes (if it moves, the reference dangles). This is a real wall — the senior/professional pages cover `Pin` and why linked lists are hard.
- **`Cell` vs `RefCell`.** `Cell<T>` gives interior mutability by *replacing* the whole value (`get`/`set`, `T: Copy`), with no runtime borrow tracking and no panic risk; `RefCell<T>` hands out references and tracks borrows at runtime. Use `Cell` for small `Copy` values, `RefCell` when you need a reference to the inner data.

## Summary

The borrow checker proves, at compile time, that no reference outlives its referent and that aliasing XOR mutability holds everywhere. **Lifetimes** are the regions it reasons about; **elision** and **NLL** make most code annotation-free and accept far more correct programs than a naive scope-based rule would. When the static rules are too strict for a legitimate design, the standard library provides escape hatches with explicit costs: `Box` for heap single ownership, `Rc`/`Arc` for shared ownership (with `Weak` to break cycles), and `RefCell`/`Cell`/`Mutex` for interior mutability that moves the aliasing check to runtime. Knowing *which* tool to reach for — and what each one costs — is the core skill of an intermediate Rust engineer.
