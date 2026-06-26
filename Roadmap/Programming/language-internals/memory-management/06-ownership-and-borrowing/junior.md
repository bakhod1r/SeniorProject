# Ownership & Borrowing — Junior Level

> **Topic:** [Ownership & Borrowing](README.md)
> **Focus:** The mental model of who owns a value, how values move, and how borrowing lets you read or write without taking ownership.

---

## Table of Contents

- [Introduction](#introduction)
- [Prerequisites](#prerequisites)
- [Glossary](#glossary)
- [Core Concepts](#core-concepts)
- [Real-World Analogies](#real-world-analogies)
- [Mental Models](#mental-models)
- [Code Examples](#code-examples)
- [Pros & Cons](#pros--cons)
- [Use Cases](#use-cases)
- [Best Practices](#best-practices)
- [Edge Cases & Pitfalls](#edge-cases--pitfalls)
- [Summary](#summary)

---

## Introduction

Every program that runs has to answer one question over and over: *who is responsible for this piece of memory, and when is it safe to free it?* Different languages answer differently.

- **C** says: *you* are responsible. You call `malloc`, you call `free`, and if you get it wrong you get crashes, leaks, or security holes.
- **Java, Go, Python, C#** say: *don't worry about it*. A garbage collector (GC) runs in the background, figures out what is unreachable, and frees it for you — at the cost of a runtime that pauses your program occasionally and uses extra memory.
- **Rust** introduced a third answer that this topic is about: *the compiler figures it out, at compile time, for free at runtime*. This system is called **ownership and borrowing**.

The headline idea: Rust gets the memory safety of a garbage collector **without a garbage collector**. There is no background thread, no pauses, no runtime overhead. The rules are checked while you compile, and once your program runs there is zero cost. People sometimes call this **"compile-time garbage collection"** or **static RAII**.

This junior page builds the intuition. You will not become a Rust expert here, but you will understand *why* ownership exists and *how* moving and borrowing work, which is the foundation everything else rests on.

## Prerequisites

You should be comfortable with:

- **Variables and scope** — the idea that a variable exists between `{` and `}` and that nested blocks have inner scopes.
- **The stack vs the heap** — the stack holds local variables and is automatically cleaned up when a function returns; the heap holds data whose size or lifetime is more flexible and must be explicitly managed.
- **Functions and passing arguments** — you call a function and hand it values.
- **Pointers / references in any language** — the notion that a variable can refer to data stored elsewhere.

You do *not* need to already know Rust. Code here is Rust, but kept simple and explained line by line.

## Glossary

- **Value** — a concrete piece of data: a number, a string, a struct instance.
- **Owner** — the variable that is responsible for a value's memory. When the owner goes away, the value is cleaned up.
- **Move** — transferring ownership from one variable to another. After a move, the old variable can no longer be used.
- **Copy** — duplicating a small, simple value (like an integer) so both variables hold independent data. No ownership transfer needed.
- **Borrow** — temporarily accessing a value through a *reference* without taking ownership. Written with `&`.
- **Shared reference (`&T`)** — a read-only borrow. You can look but not change.
- **Mutable reference (`&mut T`)** — a read-write borrow. You can change the value through it.
- **Scope** — the region of code where a variable is valid, usually delimited by `{ }`.
- **Drop** — the cleanup that runs automatically when an owner goes out of scope (Rust's destructor).
- **Borrow checker** — the part of the Rust compiler that enforces the ownership and borrowing rules.

## Core Concepts

### Rule 1 — Each value has exactly one owner

When you write `let s = String::from("hello");`, the variable `s` *owns* that string. There is exactly one owner. Not zero, not two — one.

### Rule 2 — Ownership moves; the old name becomes invalid

If you assign the value to another variable or pass it to a function, ownership **moves**. The original variable is now "empty" and the compiler refuses to let you use it.

```rust
let a = String::from("hi");
let b = a;          // ownership MOVES from a to b
// println!("{a}"); // COMPILE ERROR: value borrowed after move
println!("{b}");    // fine — b is the owner now
```

This feels strange at first. In most languages `let b = a;` just makes both names point at the same thing. In Rust, allowing both to be "owners" would mean *two* variables think they must free the same memory — a classic **double-free** bug. Rust prevents it by making the move invalidate `a`.

### Rule 3 — When the owner goes out of scope, the value is dropped

```rust
{
    let s = String::from("hello"); // s owns the string
    // ... use s ...
}                                  // s goes out of scope -> string is freed automatically
```

You never write `free`. The closing brace does it. This is deterministic: it happens at a known point in the code, every time, with no GC deciding "later."

### Borrowing — using a value without owning it

Moving everything around would be exhausting. Usually you just want to *read* or *modify* a value and give it back. That is **borrowing**, written with `&`:

```rust
fn length(s: &String) -> usize { // borrows s, does not own it
    s.len()
}

let text = String::from("hello");
let n = length(&text); // lend text to the function
println!("{text} has {n} chars"); // text is still usable here!
```

Two kinds of borrows exist, and one core rule governs them:

- **`&T`** — a **shared** (read-only) reference. You can have *many* at once.
- **`&mut T`** — a **mutable** (read-write) reference. You can have *only one*, and no shared ones at the same time.

The one-sentence rule: **either many readers, or one writer — never both at the same time.** This is sometimes called *aliasing XOR mutability*. It is the single most important rule in this whole topic, and it is what stops whole classes of bugs.

## Real-World Analogies

**A library book.** The library *owns* the book (Rule 1). When you check it out, ownership doesn't transfer — you *borrow* it (`&`). You must return it. If you lend it to a friend, you are sub-lending a borrow, not giving it away.

**A shared Google Doc.** Many people can *read* a doc at the same time with no problem (`&T`, many shared borrows). But you would not want two people typing into the same paragraph simultaneously — you'd get garbled text. The "one writer at a time" rule (`&mut T`) is exactly the aliasing-XOR-mutability rule, and the garbled text is exactly the kind of data race Rust prevents.

**Handing over a house key vs. a copy.** If you give someone *the* key and have none yourself, that's a **move** — you can no longer get in. If the key is cheap and you hand over a duplicate, that's a **Copy** — you both have one. Small values like integers are cheap to duplicate, so Rust copies them; big values like strings are moved.

**A hotel checkout.** When you leave the room (scope ends), housekeeping automatically cleans it (drop). You don't have to call them — checkout triggers it.

## Mental Models

**Ownership is a chain of custody.** At every moment, exactly one variable is "holding the evidence bag." When it hands off, it signs the form and stops being responsible. There is never confusion about who must clean up.

**Borrowing is a temporary loan with a deadline.** A reference is a promise: "I'll look at (or edit) your data, and I'll be done before you need it back." The borrow checker enforces the deadline.

**The compiler is a strict reviewer, not a runtime cop.** All of this is checked *before* your program runs. If it compiles, the rules hold forever at runtime with no checking and no overhead. Think of the borrow checker as a reviewer who refuses to merge unsafe code, rather than a guard standing inside the running program.

## Code Examples

### Move on function call

```rust
fn consume(s: String) {        // takes ownership
    println!("consumed {s}");
} // s dropped here

fn main() {
    let msg = String::from("bye");
    consume(msg);              // msg MOVED into consume
    // println!("{msg}");      // ERROR: msg was moved away
}
```

To keep using `msg`, borrow instead:

```rust
fn peek(s: &String) {          // borrows
    println!("peeking {s}");
}

fn main() {
    let msg = String::from("bye");
    peek(&msg);                // lend it
    peek(&msg);                // lend it again — fine
    println!("still have {msg}"); // still owned here
}
```

### Copy types don't move

```rust
fn main() {
    let x = 5;
    let y = x;        // COPY, not move — integers are cheap
    println!("{x} {y}"); // both valid: prints 5 5
}
```

Integers, booleans, chars, floats, and tuples of those are `Copy`. They are duplicated, so the original stays valid. Strings, vectors, and most structs are *not* `Copy` — they move.

### Many readers OR one writer

```rust
fn main() {
    let mut v = vec![1, 2, 3];

    let r1 = &v;       // shared borrow
    let r2 = &v;       // another shared borrow — OK, many readers
    println!("{r1:?} {r2:?}");

    let m = &mut v;    // mutable borrow — OK now, the shared ones are done
    m.push(4);
    println!("{m:?}");
}
```

If you tried to take `&mut v` *while* `r1` was still in use, the compiler would reject it: you cannot have a writer and a reader live at once.

## Pros & Cons

**Pros**

- **No garbage collector** — no pauses, no background thread, predictable performance.
- **Deterministic cleanup** — you know exactly when memory (and files, locks, sockets) is released.
- **Memory safety** — no double-frees, no use-after-free, no dangling pointers, caught at compile time.
- **Data-race freedom** — the aliasing-XOR-mutability rule rules out a whole class of concurrency bugs before the program runs.

**Cons**

- **Learning curve** — the rules are unfamiliar and the compiler is strict. Beginners spend time "fighting the borrow checker."
- **Some patterns are awkward** — things that are trivial with a GC (graphs with cycles, doubly linked lists) take more effort.
- **More upfront thinking** — you must decide *who owns what*, which feels like extra work until it becomes habit.

## Use Cases

Ownership-style memory management shines where you cannot afford a GC pause or a runtime:

- **Operating systems and embedded devices** — no room for a garbage collector.
- **Game engines and real-time systems** — a GC pause mid-frame is a visible stutter.
- **Browsers, databases, and infrastructure tools** — long-running, performance-critical, and security-sensitive.
- **WebAssembly** — small, fast binaries with no runtime baggage.

## Best Practices

- **Default to borrowing.** If a function only needs to read or temporarily modify a value, take `&T` or `&mut T`, not ownership. Take ownership only when the function truly needs to keep or consume the value.
- **Let scopes do the cleanup.** Don't fight the system trying to free things manually; arrange your scopes so values drop where you want.
- **Read move errors literally.** "value borrowed after move" means: you used a variable after its ownership left. The fix is usually to borrow instead of move, or to `.clone()` if you genuinely need two copies.
- **Reach for `.clone()` sparingly but without shame as a beginner.** Cloning makes an independent copy and sidesteps a move error. It costs performance, so you'll learn to remove unnecessary clones later — but early on it's a fine way to keep moving.

## Edge Cases & Pitfalls

- **"Why can't I use `a` after `let b = a;`?"** Because `String` moved. With an integer it would have copied and `a` would still work. The difference is whether the type is `Copy`.
- **Borrowing and then moving.** You cannot move a value while it's borrowed. Finish using the reference first.
- **Returning a reference to a local.** A function can't return `&` to a variable it created, because that variable is dropped when the function ends — the reference would dangle. The compiler stops you. (You'll learn the fix — lifetimes — at the middle level.)
- **`mut` is two different things.** `let mut x` means *you may reassign or mutate `x`*. `&mut x` means *a mutable borrow*. Both use the word "mut" but they are different ideas.

## Summary

Ownership is Rust's answer to "who frees this memory?" — decided by the compiler, enforced at compile time, free at runtime. The three rules: **one owner per value; ownership moves and invalidates the old name; the value drops when its owner leaves scope.** Borrowing lets you use a value without owning it: `&T` for shared read-only access (many allowed) and `&mut T` for exclusive read-write access (only one, and never alongside a shared borrow). That aliasing-XOR-mutability rule is what makes Rust memory-safe and data-race-free without a garbage collector. The cost is a learning curve; the reward is safety and speed at the same time.
