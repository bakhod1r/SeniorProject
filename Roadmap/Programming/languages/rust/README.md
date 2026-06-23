# Rust Roadmap

- Roadmap: https://roadmap.sh/rust

## 1. Introduction
- 1.1 What is Rust?
- 1.2 Why use Rust?
- 1.3 Environment Setup
- 1.4 Installing Rust and Cargo
- 1.5 IDEs and Rust Toolchains
- 1.6 Rust REPL (Rust Playground)

## 2. Language Basics

### 2.1 Syntax and Semantics
- 2.1.1 Variables, DataTypes and Constants
- 2.1.2 Control Flow and Constructs
- 2.1.3 Functions and Method Syntax
- 2.1.4 Pattern Matching & Destructuring

### 2.2 Constructs
- 2.2.1 Enums
- 2.2.2 Traits
- 2.2.3 Structs
- 2.2.4 Impl Blocks

### 2.3 Data Structures
- 2.3.1 Integers
- 2.3.2 Floats
- 2.3.3 Boolean
- 2.3.4 Character
- 2.3.5 String
- 2.3.6 Tuple
- 2.3.7 Array
- 2.3.8 Vector
- 2.3.9 Hashmap
- 2.3.10 Hashset
- 2.3.11 LinkedList
- 2.3.12 Stack
- 2.3.13 Queue
- 2.3.14 Binary Heap

## 3. Ownership System
- 3.1 Ownership Rules & Memory Safety
- 3.2 Borrowing, References and Slices
- 3.3 Deep Dive: Stack vs Heap

## 4. Advanced Topics
- 4.1 BTreeMap
- 4.2 BTreeSet
- 4.3 RC
- 4.4 Arc
- 4.5 Mutex
- 4.6 RwLock
- 4.7 Channels

## 5. Error Handling
- 5.1 Option and Result Enumerations
- 5.2 Propagating Errors and `?` Operator
- 5.3 Custom Error Types and Traits

## 6. Modules & Crates
- 6.1 Code Organization & Namespacing
- 6.2 Dependency Management with Cargo
- 6.3 Publishing on Crates.io

## 7. Testing
- 7.1 Unit & Integration Testing
- 7.2 Mocking & Property Based Testing

## 8. Concurrency & Parallelism
- 8.1 Threads, Channels and Message Passing
- 8.2 Atomic Operations & Memory Barriers
- 8.3 Futures and Async/Await Paradigm

## 9. Traits & Generics
- 9.1 Trait Definitions & Implementations
- 9.2 Trait Bounds and Associated Types
- 9.3 Generics & Type-Level Programming

## 10. Lifetimes & Borrow Checker
- 10.1 Explicit Lifetime Annotations
- 10.2 Lifetime Elision Rules
- 10.3 Covariant & Contravariant Lifetimes

## 11. Macros & Metaprogramming
- 11.1 Declarative Macros with `macro_rules!`
- 11.2 Procedural Macros & Custom Derive
- 11.3 Domain Specific Languages (DSLs)

## 12. Ecosystem and Libraries

### 12.1 Web Development
- 12.1.1 Axum
- 12.1.2 Actix
- 12.1.3 Leptos
- 12.1.4 Loco
- 12.1.5 Rocket

### 12.2 Asynchronous Programming
- 12.2.1 Tokio
- 12.2.2 async-std
- 12.2.3 smol

### 12.3 Networking
- 12.3.1 reqwest
- 12.3.2 hyper
- 12.3.3 quinn

### 12.4 Serialization / Deserialization
- 12.4.1 Serde
- 12.4.2 json-rust
- 12.4.3 toml-rust

### 12.5 Database and ORM
- 12.5.1 Diesel
- 12.5.2 sqlx
- 12.5.3 rusqlite

### 12.6 Cryptography
- 12.6.1 rust-crypto
- 12.6.2 sodiumoxide
- 12.6.3 ring

### 12.7 CLI Utilities
- 12.7.1 structopt
- 12.7.2 clap
- 12.7.3 termion

### 12.8 Game Development
- 12.8.1 bevy
- 12.8.2 fyrox
- 12.8.3 ggez
- 12.8.4 macroquad
- 12.8.5 wgpu-rs

### 12.9 GUI Development
- 12.9.1 tauri
- 12.9.2 gtk-rs
- 12.9.3 relm

### 12.10 Embedded and Systems
- 12.10.1 embedded-hal
- 12.10.2 rppal
- 12.10.3 nrf-hal

### 12.11 WebAssembly (WASM)
- 12.11.1 wasm-bindgen
- 12.11.2 wasm-pack
- 12.11.3 wasmer

## 13. Debugging
- 13.1 rust-gdb
- 13.2 rust-lldb

## 14. Performance and Profiling
- 14.1 Criterion.rs
- 14.2 Documenting with `rustdoc`
