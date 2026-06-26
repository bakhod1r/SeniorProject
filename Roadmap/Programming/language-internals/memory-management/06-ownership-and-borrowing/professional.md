# Ownership & Borrowing — Professional Level

> **Topic:** [Ownership & Borrowing](README.md)
> **Focus:** Production patterns at the boundary of the safe model — `unsafe` and its invariants, raw pointers, `Pin` and self-referential/`async` types, FFI ownership transfer, and the engineering discipline of building sound abstractions.

---

## Table of Contents

- [Introduction](#introduction)
- [Prerequisites](#prerequisites)
- [Glossary](#glossary)
- [Core Concepts](#core-concepts)
- [unsafe and the Soundness Contract](#unsafe-and-the-soundness-contract)
- [Pin and Self-Referential Types](#pin-and-self-referential-types)
- [FFI and Ownership Across the Boundary](#ffi-and-ownership-across-the-boundary)
- [Code Examples](#code-examples)
- [Coding Patterns](#coding-patterns)
- [Best Practices](#best-practices)
- [Edge Cases & Pitfalls](#edge-cases--pitfalls)
- [Summary](#summary)

---

## Introduction

Professional Rust lives in two worlds. Most code stays in the safe, borrow-checked world where the previous pages apply. But real systems have a boundary layer: places where you talk to C, implement a data structure the borrow checker can't model, build a self-referential type, or hand a Rust-allocated buffer to a kernel. At that boundary you write `unsafe`, take on the obligations the compiler was discharging for you, and re-expose a *safe* API on top. This page is about doing that correctly and the specific tools involved — raw pointers, `unsafe`, `Pin`, and FFI ownership transfer.

The professional skill here is not writing `unsafe` — it's writing the *smallest possible* `unsafe` core, stating its invariants precisely, and proving (to a reviewer, in comments and tests) that the safe wrapper can never violate them. The standard library is the model: `Vec`, `String`, `Rc`, `Mutex`, and `HashMap` are all safe APIs over `unsafe` cores. Your job is to do the same in your own crate.

## Prerequisites

- Senior-level understanding of ownership as a design choice and its trade-offs vs GC.
- Comfort with `Box`, `Rc`/`Arc`, `RefCell`/`Mutex`, lifetimes, and `Send`/`Sync`.
- Reading-level familiarity with C calling conventions and `malloc`/`free`.

## Glossary

- **`unsafe`** — a keyword that unlocks five extra abilities (deref raw pointers, call `unsafe` fns, access `static mut`/unions, implement `unsafe` traits). It does **not** turn off the borrow checker.
- **Raw pointer (`*const T` / `*mut T`)** — a pointer with no lifetime, no aliasing guarantees, and no automatic cleanup; dereferencing one requires `unsafe`.
- **Soundness** — the property that no safe code using your API can trigger undefined behavior, no matter how it's called.
- **Undefined behavior (UB)** — operations the compiler assumes never happen (data races, use-after-free, invalid values); their presence makes the whole program meaningless.
- **`Pin<P>`** — a wrapper guaranteeing the pointee won't be moved, enabling self-referential types.
- **`Unpin`** — an auto-trait marking types that are safe to move even when pinned (most types).
- **FFI (Foreign Function Interface)** — calling between Rust and another language (usually C) across the ABI boundary.

## Core Concepts

### `unsafe` narrows trust; it does not remove checks

A common misconception: `unsafe` disables the borrow checker. It does not. Borrow checking, lifetimes, and move semantics still apply inside an `unsafe` block. What `unsafe` adds is five specific superpowers, the most important being **dereferencing raw pointers** and **calling `unsafe` functions**. The contract is: *the compiler can no longer prove safety here, so you assert that you have.* Every `unsafe` block is a promise you make to the compiler and to every future reader.

### Raw pointers escape the ownership model entirely

`*const T` and `*mut T` carry no lifetime and no aliasing rules. You can have a `*mut` and a `*const` to the same data simultaneously — the borrow checker won't object, because raw pointers are outside its purview. This is exactly what makes them necessary (building linked lists, FFI) and exactly what makes them dangerous (you now manually uphold what the borrow checker used to guarantee).

### The safe/unsafe boundary is an abstraction boundary

The discipline: confine `unsafe` to a small module, define the invariants that make it sound, and expose only safe functions that *cannot* break those invariants regardless of input. If a caller can cause UB through your safe API, your API is **unsound** — and that's a bug in *your* code, not theirs, even if they passed something unusual.

## unsafe and the Soundness Contract

When you write `unsafe`, you adopt the obligations the borrow checker was handling:

1. **No use-after-free** — raw pointers must point to live memory when dereferenced.
2. **No data races** — if multiple threads touch the data, you provide the synchronization the borrow checker used to require.
3. **Valid values** — never produce a `bool` that isn't 0/1, an invalid `char`, an uninitialized reference, etc.
4. **Aliasing discipline** — if you create a `&mut T` from a raw pointer, no other live reference may alias it; violating this is UB even if "nothing bad seems to happen."

The professional practice is to write a `// SAFETY:` comment above every `unsafe` block stating *why* each obligation holds. Reviewers should be able to verify soundness from that comment alone. Tools help: **Miri** (an interpreter that detects UB, including aliasing violations under Stacked/Tree Borrows) should run in CI on any crate with `unsafe`; ThreadSanitizer catches data races; fuzzing exercises the safe wrapper against adversarial inputs.

## Pin and Self-Referential Types

Recall the model's hard edge: a struct holding a reference into its own field breaks when moved, because the move copies the bytes to a new address while the internal pointer still points at the old one — instant dangling pointer. Normal Rust forbids constructing such a type safely.

`Pin<P>` is the solution. Pinning a value *promises it will never move again*, so internal self-pointers stay valid. The key pieces:

- `Pin<&mut T>` / `Pin<Box<T>>` — a pointer through which you cannot get a `&mut T` (and thus cannot `mem::swap` or move the pointee) unless `T: Unpin`.
- `Unpin` — an auto-trait. Almost every type is `Unpin` (moving it is fine even when "pinned," so pinning is a no-op). Only genuinely self-referential types (or those built from them) are `!Unpin`.

**Why this matters in practice: `async`.** When the compiler transforms an `async fn` into a state machine, that state machine often holds references *across `.await` points* into its own local variables — it is self-referential. That's why `Future`s are polled through `Pin<&mut Self>`: once a future has started, it must not move, or its internal references would dangle. Most professionals never write `Pin` by hand, but they encounter it the moment they touch the internals of an async runtime, implement a custom `Future`, or build an intrusive linked list. Understanding *why* `poll` takes `Pin` demystifies a large swath of async error messages.

## FFI and Ownership Across the Boundary

The ABI boundary has no concept of ownership, lifetimes, or `Drop`. When a value crosses it, you must define *which side owns the memory* and ensure it is freed by the **same allocator** that allocated it. Rust's allocator and C's `malloc` are not interchangeable; freeing a Rust `Box` with C `free` (or vice versa) is UB.

Standard ownership-transfer patterns:

- **Rust gives C a value, C returns it for cleanup.** Use `Box::into_raw` to leak the `Box` into a raw pointer (relinquishing Rust's automatic drop), hand the pointer to C, and provide an `extern "C"` free function that does `Box::from_raw` to reclaim ownership and drop it. The pointer must round-trip back to *Rust* to be freed.
- **Rust borrows C's memory.** Receive a `*const T`/`*mut T`, wrap accesses in `unsafe`, and *do not* free it — C owns it. Encode the borrow's validity window in the safe wrapper's lifetime if possible.
- **C strings.** `CString` owns a NUL-terminated buffer for handing to C; `CStr` borrows one C gives you. Never let a `CString`'s pointer outlive the `CString` — a classic dangling-pointer FFI bug.

The contract must be documented on both sides: who allocates, who frees, what the lifetime is, and whether the pointer may be null. Mismatched ownership assumptions across FFI are among the most common and most severe real-world memory bugs.

## Code Examples

### Box::into_raw / from_raw for FFI ownership transfer

```rust
#[repr(C)]
pub struct Counter { value: u64 }

// Rust allocates, hands ownership to C as a raw pointer.
#[no_mangle]
pub extern "C" fn counter_new() -> *mut Counter {
    Box::into_raw(Box::new(Counter { value: 0 })) // leak: Rust won't drop it
}

#[no_mangle]
pub extern "C" fn counter_inc(c: *mut Counter) {
    // SAFETY: caller guarantees `c` came from counter_new and is still live,
    // and that no other thread mutates it concurrently.
    let c = unsafe { &mut *c };
    c.value += 1;
}

// Ownership returns to Rust to be freed by the RIGHT allocator.
#[no_mangle]
pub extern "C" fn counter_free(c: *mut Counter) {
    if c.is_null() { return; }
    // SAFETY: `c` came from counter_new (Box::into_raw); reclaim and drop it.
    unsafe { drop(Box::from_raw(c)); }
}
```

### A sound safe wrapper over an unsafe core

```rust
pub struct Stack<T> {
    ptr: *mut T,   // raw, manually managed buffer
    len: usize,
    cap: usize,
}

impl<T> Stack<T> {
    pub fn push(&mut self, val: T) {
        if self.len == self.cap { self.grow(); }
        // SAFETY: len < cap after grow(), so ptr.add(len) is in-bounds and
        // uninitialized; write (not assign) avoids dropping garbage.
        unsafe { self.ptr.add(self.len).write(val); }
        self.len += 1;
    }
    // grow(), pop(), Drop omitted — each carries its own SAFETY reasoning.
}
// The PUBLIC api (push/pop) is safe: no caller input can cause UB.
```

The point: `unsafe` lives inside, the surface is safe, and each `unsafe` block names the invariant it relies on. This is precisely how `Vec` is built.

### Pin appears when you touch Future internals

```rust
use std::pin::Pin;
use std::future::Future;
use std::task::{Context, Poll};

struct Delay { /* fields, possibly self-referential after async transform */ }

impl Future for Delay {
    type Output = ();
    // poll takes Pin<&mut Self>: once polled, Self must not move,
    // or any self-references created across .await points would dangle.
    fn poll(self: Pin<&mut Self>, _cx: &mut Context<'_>) -> Poll<()> {
        Poll::Ready(())
    }
}
```

## Coding Patterns

- **`into_raw` / `from_raw` round-trips for ownership handoff.** Anytime ownership leaves Rust's drop machinery (FFI, manual data structures), pair the leak with a reclaim through the same type. Never free across allocators.
- **Newtype wrappers to enforce FFI invariants.** Wrap a raw handle in a struct with a `Drop` impl that calls the correct free function, so the resource is released exactly once, deterministically — RAII over a C resource.
- **`MaybeUninit<T>` for staged initialization.** When building buffers or FFI out-params, use `MaybeUninit` to handle uninitialized memory soundly instead of conjuring invalid values.
- **`PhantomData` to carry lifetimes/ownership the compiler can't see.** When a struct logically owns or borrows something only reachable through a raw pointer, `PhantomData<&'a T>` or `PhantomData<T>` re-attaches the borrow checker's reasoning (drop check, variance).

## Best Practices

- **Minimize and localize `unsafe`.** Smallest blocks, one module, behind a safe API. The ratio of safe-surface to unsafe-core should be high.
- **Write a `// SAFETY:` comment on every `unsafe` block** stating which invariant makes it sound. No comment, no merge.
- **Run Miri in CI** for any crate with `unsafe`; add ThreadSanitizer for concurrent code and a fuzzer for parsers/FFI surfaces. Miri catches aliasing UB that "works on my machine."
- **Define FFI ownership contracts explicitly and symmetrically.** Document who allocates, who frees, nullability, and lifetime on both sides. Provide a Rust-side free function for anything Rust allocates.
- **Don't write `Pin` by hand unless you're implementing a runtime primitive.** Use `Box::pin`, `pin!`, or `async`/`await`, which handle pinning correctly. Reach for manual `Pin` only when building futures, streams, or intrusive structures.
- **Prove soundness against *all* inputs, not just your tests.** A safe API is unsound if *any* caller can cause UB. Think adversarially about your own interface.

## Edge Cases & Pitfalls

- **`unsafe` that "works" but is UB.** Creating two `&mut` to the same data via raw pointers may run fine for years and then miscompile under a new optimizer, because UB lets the compiler assume it never happens. Miri exists to catch this; "it passed tests" is not soundness.
- **Freeing across allocators.** `Box::from_raw` on a pointer C `malloc`'d, or C `free` on a `Box::into_raw` pointer, is UB. Memory must be freed by the allocator that produced it.
- **Dangling `CString` pointers.** `let p = CString::new("x")?.as_ptr();` — the `CString` is a temporary that drops at the semicolon, leaving `p` dangling. Keep the `CString` alive for as long as C uses the pointer.
- **`Drop` plus raw pointers = double-free risk.** If a type both implements `Drop` to free a raw buffer and is `Copy`/cloned shallowly, you can free twice. Manual memory types must control their copy/clone semantics carefully.
- **Moving a `!Unpin` value.** Constructing a self-referential type and then moving it (e.g., returning it by value before pinning) reintroduces the dangling-self-pointer bug `Pin` was meant to prevent. Pin *before* the references are established and never expose a path to move it.
- **`mem::forget` and leaks vs UB.** Leaking memory is *safe* in Rust (it's not UB), so `Drop` is not guaranteed to run (`mem::forget`, `Rc` cycles, panics during drop). Don't write `unsafe` code whose soundness *depends* on a destructor running.

## Summary

Professional Rust is defined by how it handles the boundary where the safe model ends. `unsafe` doesn't disable the borrow checker; it grants raw-pointer and `unsafe`-call powers in exchange for you upholding the soundness contract — no use-after-free, no data races, valid values, correct aliasing — documented per block and verified with Miri. `Pin` resolves the self-referential limitation that makes linked lists and `async` futures hard, which is why `Future::poll` takes `Pin<&mut Self>`. FFI strips away ownership entirely, so you transfer it explicitly with `into_raw`/`from_raw`, always freeing through the allocator that allocated, and wrap C resources in RAII newtypes. The throughline is engineering discipline: a small, audited, well-documented `unsafe` core under a large safe surface — exactly how the standard library is built, and exactly what production crates must do.
