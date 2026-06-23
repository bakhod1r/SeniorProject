---
comments: true
---

# Go Roadmap

- Roadmap: https://roadmap.sh/golang

## [1. Introduction to Go](01-introduction-to-go/01-why-use-go/junior.md)
- [1.1 Why use Go](01-introduction-to-go/01-why-use-go/junior.md)
- [1.2 History of Go](01-introduction-to-go/02-history-of-go/junior.md)
- [1.3 Setting up the Environment](01-introduction-to-go/03-setting-up-environment/junior.md)
- [1.4 Hello World in Go](01-introduction-to-go/04-hello-world/junior.md)
- [1.5 `go` command](01-introduction-to-go/05-go-command/junior.md)

## [2. Language Basics](02-language-basics/01-variables-and-constants/01-var-vs-short-declaration/junior.md)

### [2.1 Variables & Constants](02-language-basics/01-variables-and-constants/01-var-vs-short-declaration/junior.md)
- [2.1.1 `var` vs `:=`](02-language-basics/01-variables-and-constants/01-var-vs-short-declaration/junior.md)
- [2.1.2 Zero Values](02-language-basics/01-variables-and-constants/02-zero-values/junior.md)
- [2.1.3 `const` and `iota`](02-language-basics/01-variables-and-constants/03-const-and-iota/junior.md)
- [2.1.4 Scope and Shadowing](02-language-basics/01-variables-and-constants/04-scope-and-shadowing/junior.md)

### [2.2 Data Types](02-language-basics/02-data-types/01-boolean/junior.md)
- [2.2.1 Boolean](02-language-basics/02-data-types/01-boolean/junior.md)
- [2.2.2 Numeric Types](02-language-basics/02-data-types/02-numeric-types/junior.md)
  - [2.2.2.1 Integers (Signed, Unsigned)](02-language-basics/02-data-types/02-numeric-types/01-integers/junior.md)
  - [2.2.2.2 Floating Points](02-language-basics/02-data-types/02-numeric-types/02-floating-points/junior.md)
  - [2.2.2.3 Complex Numbers](02-language-basics/02-data-types/02-numeric-types/03-complex-numbers/junior.md)
- [2.2.3 Runes](02-language-basics/02-data-types/03-runes/junior.md)
- [2.2.4 Strings](02-language-basics/02-data-types/04-strings/junior.md)
  - [2.2.4.1 Raw String Literals](02-language-basics/02-data-types/04-strings/01-raw-string-literals/junior.md)
  - [2.2.4.2 Interpreted String Literals](02-language-basics/02-data-types/04-strings/02-interpreted-string-literals/junior.md)
- [2.2.5 Type Conversion](02-language-basics/02-data-types/05-type-conversion/junior.md)
- [2.2.6 Commands & Docs](02-language-basics/02-data-types/06-commands-and-docs/junior.md)

### [2.3 Composite Types](02-language-basics/03-composite-types/01-arrays/junior.md)
- [2.3.1 Arrays](02-language-basics/03-composite-types/01-arrays/junior.md)
- [2.3.2 Slices](02-language-basics/03-composite-types/02-slices/junior.md)
  - [2.3.2.1 Capacity and Growth](02-language-basics/03-composite-types/02-slices/01-capacity-and-growth/junior.md)
  - [2.3.2.2 `make()`](02-language-basics/03-composite-types/02-slices/02-make/junior.md)
  - [2.3.2.3 Slice to Array Conversion](02-language-basics/03-composite-types/02-slices/03-slice-to-array-conversion/junior.md)
  - [2.3.2.4 Array to Slice Conversion](02-language-basics/03-composite-types/02-slices/04-array-to-slice-conversion/junior.md)
- [2.3.3 Strings](02-language-basics/03-composite-types/03-strings/junior.md)
- [2.3.4 Maps](02-language-basics/03-composite-types/04-maps/junior.md)
  - [2.3.4.1 Comma-Ok Idiom](02-language-basics/03-composite-types/04-maps/01-comma-ok-idiom/junior.md)
- [2.3.5 Structs](02-language-basics/03-composite-types/05-structs/junior.md)
  - [2.3.5.1 Struct Tags & JSON](02-language-basics/03-composite-types/05-structs/01-struct-tags-and-json/junior.md)
  - [2.3.5.2 Embedding Structs](02-language-basics/03-composite-types/05-structs/02-embedding-structs/junior.md)

### [2.4 Conditionals](02-language-basics/04-conditionals/01-if/junior.md)
- [2.4.1 `if`](02-language-basics/04-conditionals/01-if/junior.md)
- [2.4.2 `if-else`](02-language-basics/04-conditionals/02-if-else/junior.md)
- [2.4.3 `switch`](02-language-basics/04-conditionals/03-switch/junior.md)

### [2.5 Loops](02-language-basics/05-loops/01-for-loop/junior.md)
- [2.5.1 `for` loop](02-language-basics/05-loops/01-for-loop/junior.md)
- [2.5.2 `for range`](02-language-basics/05-loops/02-for-range/junior.md)
  - [2.5.2.1 Iterating Maps](02-language-basics/05-loops/02-for-range/01-iterating-maps/junior.md)
  - [2.5.2.2 Iterating Strings](02-language-basics/05-loops/02-for-range/02-iterating-strings/junior.md)
- [2.5.3 `break`](02-language-basics/05-loops/03-break/junior.md)
- [2.5.4 `continue`](02-language-basics/05-loops/04-continue/junior.md)
- [2.5.5 `goto` (discouraged)](02-language-basics/05-loops/05-goto/junior.md)

### [2.6 Functions](02-language-basics/06-functions/01-functions-basics/junior.md)
- [2.6.1 Functions Basics](02-language-basics/06-functions/01-functions-basics/junior.md)
- [2.6.2 Variadic Functions](02-language-basics/06-functions/02-variadic-functions/junior.md)
- [2.6.3 Multiple Return Values](02-language-basics/06-functions/03-multiple-return-values/junior.md)
- [2.6.4 Anonymous Functions](02-language-basics/06-functions/04-anonymous-functions/junior.md)
- [2.6.5 Closures](02-language-basics/06-functions/05-closures/junior.md)
- [2.6.6 Named Return Values](02-language-basics/06-functions/06-named-return-values/junior.md)
- [2.6.7 Call by Value](02-language-basics/06-functions/07-call-by-value/junior.md)

### [2.7 Pointers](02-language-basics/07-pointers/01-pointers-basics/junior.md)
- [2.7.1 Pointers Basics](02-language-basics/07-pointers/01-pointers-basics/junior.md)
- [2.7.2 Pointers with Structs](02-language-basics/07-pointers/02-pointers-with-structs/junior.md)
- [2.7.3 With Maps & Slices](02-language-basics/07-pointers/03-with-maps-and-slices/junior.md)
- [2.7.4 Memory Management](02-language-basics/07-pointers/04-memory-management/junior.md)
  - [2.7.4.1 Garbage Collection](02-language-basics/07-pointers/04-memory-management/01-garbage-collection/junior.md)

## [3. Methods and Interfaces](03-methods-and-interfaces/01-methods-vs-functions/junior.md)
- [3.1 Methods vs Functions](03-methods-and-interfaces/01-methods-vs-functions/junior.md)
- [3.2 Pointer Receivers](03-methods-and-interfaces/02-pointer-receivers/junior.md)
- [3.3 Value Receivers](03-methods-and-interfaces/03-value-receivers/junior.md)
- [3.4 Interfaces Basics](03-methods-and-interfaces/04-interfaces-basics/junior.md)
- [3.5 Empty Interfaces](03-methods-and-interfaces/05-empty-interfaces/junior.md)
- [3.6 Embedding Interfaces](03-methods-and-interfaces/06-embedding-interfaces/junior.md)
- [3.7 Type Assertions](03-methods-and-interfaces/07-type-assertions/junior.md)
- [3.8 Type Switch](03-methods-and-interfaces/08-type-switch/junior.md)
- [3.9 Method Sets Deep](03-methods-and-interfaces/09-method-sets-deep/junior.md)
- [3.10 Interface Internals (`iface`, `eface`, `itab`)](03-methods-and-interfaces/10-interface-internals/junior.md)
- [3.11 Method Dispatch](03-methods-and-interfaces/11-method-dispatch/junior.md)
- [3.12 Common Interfaces (`io.Reader`, `fmt.Stringer`, `error`)](03-methods-and-interfaces/12-common-interfaces/junior.md)
- [3.13 Interface Best Practices](03-methods-and-interfaces/13-interface-best-practices/junior.md)
- [3.14 Interface Anti-Patterns](03-methods-and-interfaces/14-interface-anti-patterns/junior.md)
- [3.15 Method Values & Method Expressions](03-methods-and-interfaces/15-method-values-and-expressions/junior.md)
- [3.16 Methods on Defined Types](03-methods-and-interfaces/16-methods-on-defined-types/junior.md)
- [3.17 Sealed Interfaces](03-methods-and-interfaces/17-sealed-interfaces/junior.md)
- [3.18 Cross-Package Methods](03-methods-and-interfaces/18-cross-package-methods/junior.md)
- [3.19 Struct Method Promotion](03-methods-and-interfaces/19-struct-method-promotion/junior.md)

## [4. Generics](04-generics/01-why-generics/junior.md)
- [4.1 Why Generics?](04-generics/01-why-generics/junior.md)
- [4.2 Generic Functions](04-generics/02-generic-functions/junior.md)
- [4.3 Generic Types / Interfaces](04-generics/03-generic-types-interfaces/junior.md)
- [4.4 Type Constraints](04-generics/04-type-constraints/junior.md)
- [4.5 Type Inference](04-generics/05-type-inference/junior.md)
- [4.6 Generic Constraints Deep](04-generics/06-generic-constraints-deep/junior.md)
- [4.7 Generic Performance (monomorphization vs dictionary)](04-generics/07-generic-performance/junior.md)
- [4.8 Generics vs Interfaces](04-generics/08-generics-vs-interfaces/junior.md)
- [4.9 Generic Data Structures](04-generics/09-generic-data-structures/junior.md)
- [4.10 Generic Limitations](04-generics/10-generic-limitations/junior.md)

## [5. Error Handling](05-error-handling/01-error-handling-basics/junior.md)
- [5.1 Error Handling Basics](05-error-handling/01-error-handling-basics/junior.md)
- [5.2 `error` interface](05-error-handling/02-error-interface/junior.md)
- [5.3 `errors.New`](05-error-handling/03-errors-new/junior.md)
- [5.4 `fmt.Errorf`](05-error-handling/04-fmt-errorf/junior.md)
- [5.5 Wrapping/Unwrapping Errors](05-error-handling/05-wrapping-unwrapping-errors/junior.md)
- [5.6 Sentinel Errors](05-error-handling/06-sentinel-errors/junior.md)
- [5.7 `panic` and `recover`](05-error-handling/07-panic-and-recover/junior.md)
- [5.8 Stack Traces & Debugging](05-error-handling/08-stack-traces-debugging/junior.md)
- 5.9 `errors.Is` vs `errors.As` Deep
- 5.10 Custom Error Types
- 5.11 `errors.Join` (Go 1.20+)
- 5.12 Error Design Best Practices
- 5.13 Don't Just Check, Handle

## [6. Code Organization](06-code-organization/01-modules-and-dependencies/01-go-mod-init/junior.md)

### [6.1 Modules & Dependencies](06-code-organization/01-modules-and-dependencies/01-go-mod-init/junior.md)
- [6.1.1 `go mod init`](06-code-organization/01-modules-and-dependencies/01-go-mod-init/junior.md)
- [6.1.2 `go mod tidy`](06-code-organization/01-modules-and-dependencies/02-go-mod-tidy/junior.md)
- [6.1.3 `go mod vendor`](06-code-organization/01-modules-and-dependencies/03-go-mod-vendor/junior.md)

### [6.2 Packages](06-code-organization/02-packages/01-package-import-rules/junior.md)
- [6.2.1 Package Import Rules](06-code-organization/02-packages/01-package-import-rules/junior.md)
- [6.2.2 Using 3rd Party Packages](06-code-organization/02-packages/02-using-3rd-party-packages/junior.md)
- [6.2.3 Publishing Modules](06-code-organization/02-packages/03-publishing-modules/junior.md)

### 6.3 Project Layout
### 6.4 Internal Packages
### 6.5 Workspaces (`go.work`)
### 6.6 Dependency Injection (Wire, fx, manual)
### 6.7 Architecture Patterns (Clean, Hexagonal, DDD)
### 6.8 Module Versioning (semver, v2+)
### 6.9 Private Modules (GOPRIVATE)

## [7. Concurrency](07-concurrency/01-goroutines/01-overview/junior.md)

### 7.0 Introduction
- 7.0.1 What is Concurrency (Concurrency vs Parallelism)
- 7.0.2 CSP Model (Communicating Sequential Processes)
- 7.0.3 Go Runtime & GMP Scheduler
- 7.0.4 Go Memory Model (happens-before)
- 7.0.5 When to Use Concurrency (and when not to)

### [7.1 Goroutines](07-concurrency/01-goroutines/01-overview/junior.md)
- [7.1.1 Overview (creation & syntax)](07-concurrency/01-goroutines/01-overview/junior.md)
- 7.1.2 Goroutines vs OS Threads
- 7.1.3 Stack Growth
- 7.1.4 Runtime Management
- 7.1.5 Best Practices
- 7.1.6 Common Pitfalls

### [7.2 Channels](07-concurrency/02-channels/01-buffered-vs-unbuffered/junior.md)
- [7.2.1 Buffered vs Unbuffered](07-concurrency/02-channels/01-buffered-vs-unbuffered/junior.md)
- [7.2.2 Select Statement](07-concurrency/02-channels/02-select-statement/junior.md)
- [7.2.3 Worker Pools](07-concurrency/02-channels/03-worker-pools/junior.md)
- 7.2.4 Channel Direction
- 7.2.5 Nil Channels
- 7.2.6 Closing Channels
- 7.2.7 Range over Channels

### [7.3 `sync` Package](07-concurrency/03-sync-package/01-mutexes/junior.md)
- [7.3.1 Mutexes](07-concurrency/03-sync-package/01-mutexes/junior.md)
- [7.3.2 WaitGroups](07-concurrency/03-sync-package/02-waitgroups/junior.md)
- 7.3.3 Once
- 7.3.4 Cond
- 7.3.5 Pool
- 7.3.6 Map
- 7.3.7 Atomic (`sync/atomic`)

### [7.4 `context` Package](07-concurrency/04-context-package/01-deadlines-and-cancellations/junior.md)
- [7.4.1 Deadlines & Cancellations](07-concurrency/04-context-package/01-deadlines-and-cancellations/junior.md)
- [7.4.2 Common Usecases](07-concurrency/04-context-package/02-common-usecases/junior.md)
- 7.4.3 Context Values
- 7.4.4 Context Tree
- 7.4.5 Context Internals

### [7.5 Concurrency Patterns](07-concurrency/05-concurrency-patterns/01-fan-in/junior.md)
- [7.5.1 fan-in](07-concurrency/05-concurrency-patterns/01-fan-in/junior.md)
- [7.5.2 fan-out](07-concurrency/05-concurrency-patterns/02-fan-out/junior.md)
- [7.5.3 pipeline](07-concurrency/05-concurrency-patterns/03-pipeline/junior.md)
- [7.5.4 Race Detection](07-concurrency/05-concurrency-patterns/04-race-detection/junior.md)
- 7.5.5 Future / Promise
- 7.5.6 Broadcast Pattern
- 7.5.7 N-Barrier
- 7.5.8 Push & Pull

### 7.6 Errgroup & `x/sync`
- 7.6.1 `errgroup.Group`
- 7.6.2 `semaphore.Weighted`
- 7.6.3 `singleflight.Group`

### 7.7 Goroutine Lifecycle & Leaks
- 7.7.1 Goroutine Lifecycle
- 7.7.2 Detecting Leaks (`runtime.NumGoroutine`, `pprof`)
- 7.7.3 Preventing Leaks
- 7.7.4 pprof Tools

### 7.8 Deadlock, Livelock, Starvation
- 7.8.1 Deadlock
- 7.8.2 Livelock
- 7.8.3 Starvation

### 7.9 Channel Internals
- 7.9.1 `hchan` Struct
- 7.9.2 Runtime Behavior
- 7.9.3 Buffer Mechanics
- 7.9.4 Send / Receive Flow

### 7.10 Scheduler Deep-Dive
- 7.10.1 GMP Model
- 7.10.2 Preemption (Go 1.14+)
- 7.10.3 `GOMAXPROCS` Tuning
- 7.10.4 Work Stealing
- 7.10.5 Syscall Handling

### 7.11 Advanced Channel Patterns
- 7.11.1 or-done-channel
- 7.11.2 tee-channel
- 7.11.3 bridge-channel
- 7.11.4 Generator
- 7.11.5 Rate Limiter
- 7.11.6 Handshaking

### 7.12 Lock-Free Programming
- 7.12.1 CAS-based Algorithms
- 7.12.2 ABA Problem
- 7.12.3 Lock-Free Data Structures (queue, stack)
- 7.12.4 Memory Fences
- 7.12.5 Lock-Free vs Wait-Free

### 7.13 Testing Concurrent Code
- 7.13.1 Race Detector Deep-Dive
- 7.13.2 Deterministic Testing
- 7.13.3 `sync.WaitGroup` in Tests
- 7.13.4 Mocking Time
- 7.13.5 Concurrent Fuzzing

### 7.14 Performance Tuning
- 7.14.1 `GOMAXPROCS`
- 7.14.2 `GOGC`
- 7.14.3 `runtime.LockOSThread`
- 7.14.4 Profiling Concurrent Code
- 7.14.5 Scheduler Tracing

### 7.15 Concurrency Anti-Patterns
- 7.15.1 Unlimited Goroutines
- 7.15.2 Mutex Copying
- 7.15.3 Channel Close Violations
- 7.15.4 Premature Optimization
- 7.15.5 Wait-for-Empty-Channel
- 7.15.6 Sleep-for-Sync

### 7.16 Time-based Concurrency
- 7.16.1 `time.Ticker`
- 7.16.2 `time.AfterFunc`
- 7.16.3 Timer Leaks
- 7.16.4 Exponential Backoff
- 7.16.5 Debounce / Throttle

### 7.17 Goroutine Pools (3rd-party)
- 7.17.1 `ants`
- 7.17.2 `tunny`
- 7.17.3 `workerpool`
- 7.17.4 When to Use Pools

### 7.18 Production Patterns
- 7.18.1 Backpressure
- 7.18.2 Dynamic Worker Scaling
- 7.18.3 Batching
- 7.18.4 Graceful Shutdown
- 7.18.5 Drain Pattern
- 7.18.6 Steady-State

### 7.19 Pipeline Production Patterns
- 7.19.1 Error Propagation
- 7.19.2 Cancellation Propagation
- 7.19.3 Fan-out within Pipeline
- 7.19.4 Batching Stages
- 7.19.5 Fan-in/Fan-out within Pipeline

### 7.20 Cancellation Deep
- 7.20.1 Cooperative vs Force Cancellation
- 7.20.2 Partial Cancellation
- 7.20.3 Cleanup Ordering

### 7.21 Concurrent Data Structures
- 7.21.1 TTL Caches
- 7.21.2 LRU Concurrent
- 7.21.3 Concurrent Skip List
- 7.21.4 Concurrent Trees
- 7.21.5 Copy-on-Write
- 7.21.6 Concurrent Counters
- 7.21.7 Concurrent Bloom Filter

### 7.22 Memory Ordering & Barriers
- 7.22.1 Hardware Memory Barriers
- 7.22.2 Acquire / Release Semantics
- 7.22.3 Sequential Consistency
- 7.22.4 Cache Coherence
- 7.22.5 False Sharing

### 7.23 Concurrency in stdlib
- 7.23.1 `net/http` Server Concurrency
- 7.23.2 `database/sql` Connection Pool
- 7.23.3 `sync.Pool` Internals
- 7.23.4 Runtime Internals
- 7.23.5 `time` Package Concurrency

### 7.24 Primitives Decision Guide
- 7.24.1 Channel vs Mutex
- 7.24.2 Mutex vs Atomic
- 7.24.3 When to Use `sync.Cond`
- 7.24.4 Decision Tree

### 7.25 Famous Bugs & Postmortems
- 7.25.1 Cloudflare Incidents
- 7.25.2 Uber Incidents
- 7.25.3 Dropbox Incidents
- 7.25.4 GitHub Incidents
- 7.25.5 Twitter Incidents

### 7.26 Modern Features
- 7.26.1 `sync.OnceFunc` (Go 1.21+)
- 7.26.2 Structured Concurrency
- 7.26.3 Future Proposals

### 7.27 Real-World Case Studies
- 7.27.1 Kubernetes Scheduler
- 7.27.2 etcd Raft
- 7.27.3 gRPC Stream
- 7.27.4 Docker Concurrency
- 7.27.5 Prometheus Concurrency
- 7.27.6 Postgres Driver

## [8. Standard Library](08-standard-library/01-io-and-file-handling/junior.md)
- [8.1 I/O & File Handling](08-standard-library/01-io-and-file-handling/junior.md)
- [8.2 `flag`](08-standard-library/02-flag/junior.md)
- [8.3 `time`](08-standard-library/03-time/junior.md)
- [8.4 `encoding/json`](08-standard-library/04-encoding-json/junior.md)
- [8.5 `os`](08-standard-library/05-os/junior.md)
- [8.6 `bufio`](08-standard-library/06-bufio/junior.md)
- [8.7 `slog`](08-standard-library/07-slog/junior.md)
- [8.8 `regexp`](08-standard-library/08-regexp/junior.md)
- [8.9 `go:embed` for embedding](08-standard-library/09-go-embed/junior.md)
- [8.10 `net` (TCP/UDP)](08-standard-library/10-net/junior.md)
- [8.11 `net/http` Internals](08-standard-library/11-net-http-internals/junior.md)
- [8.12 `encoding/*` (binary, csv, xml, gob)](08-standard-library/12-encoding/junior.md)
- [8.13 `crypto/*` (tls, hmac, aes, rsa)](08-standard-library/13-crypto/junior.md)
- [8.14 `io`, `io/fs`](08-standard-library/14-io-fs/junior.md)
- [8.15 `text/template`, `html/template`](08-standard-library/15-templates/junior.md)
- [8.16 `sort`, `slices`, `maps` (Go 1.21+)](08-standard-library/16-sort-slices-maps/junior.md)
- [8.17 `container/*` (heap, list, ring)](08-standard-library/17-container/junior.md)

## 9. Testing & Benchmarking
- 9.1 `testing` package basics
- 9.2 Table-driven Tests
- 9.3 Mocks and Stubs
- 9.4 `httptest` for HTTP Tests
- 9.5 Benchmarks
- 9.6 Coverage
- 9.7 Subtests (`t.Run`)
- 9.8 `TestMain`
- 9.9 Parallel Tests (`t.Parallel`)
- 9.10 Test Helpers (`t.Helper`)
- 9.11 Golden Files
- 9.12 Fuzzing (Go 1.18+)
- 9.13 Integration Tests (testcontainers-go)
- 9.14 E2E Tests
- 9.15 Mocking Libraries (testify, gomock, mockery)
- 9.16 Property-Based Testing
- 9.17 Benchmark Deep (`b.RunParallel`, allocs)

## 10. Ecosystem & Popular Libraries

### 10.1 Building CLIs
- 10.1.1 Cobra
- 10.1.2 urfave/cli
- 10.1.3 bubbletea

### 10.2 Web Development
- 10.2.1 `net/http` (standard)
- 10.2.2 Frameworks (Optional)
  - 10.2.2.1 gin
  - 10.2.2.2 echo
  - 10.2.2.3 fiber
  - 10.2.2.4 beego
- 10.2.3 gRPC & Protocol Buffers

### 10.3 ORMs & DB Access
- 10.3.1 pgx
- 10.3.2 GORM

### 10.4 Logging
- 10.4.1 Zerolog
- 10.4.2 Zap

### 10.5 Realtime Communication
- 10.5.1 Melody
- 10.5.2 Centrifugo

### 10.6 Configuration (viper, koanf)
### 10.7 Validation (go-playground/validator)
### 10.8 HTTP Client (resty, retryablehttp)
### 10.9 Migrations (golang-migrate, goose)
### 10.10 Caching (bigcache, freecache, ristretto)
### 10.11 Background Jobs (asynq, machinery)
### 10.12 Message Queues (Sarama, NATS, RabbitMQ)
### 10.13 Observability (OpenTelemetry, Prometheus)
### 10.14 Cloud SDKs (AWS, GCP, Azure)
### 10.15 GraphQL (gqlgen)
### 10.16 Workflow Engines (Temporal, Cadence)

## 11. Go Toolchain and Tools

### 11.1 Core Go Commands
- 11.1.1 `go run`
- 11.1.2 `go build`
- 11.1.3 `go install`
- 11.1.4 `go fmt`
- 11.1.5 `go mod`
- 11.1.6 `go test`
- 11.1.7 `go clean`
- 11.1.8 `go doc`
- 11.1.9 `go version`

### 11.2 Code Generation / Build Tags
- 11.2.1 `go generate`
- 11.2.2 Build Tags

### 11.3 Code Quality and Analysis
- 11.3.1 `go vet`
- 11.3.2 `goimports`
- 11.3.3 Linters
  - 11.3.3.1 revive
  - 11.3.3.2 staticcheck
  - 11.3.3.3 golangci-lint

### 11.4 Security
- 11.4.1 govulncheck

### 11.5 Performance and Debugging
- 11.5.1 pprof
- 11.5.2 trace
- 11.5.3 Race Detector

### 11.6 Deployment & Tooling
- 11.6.1 Cross-compilation
- 11.6.2 Building Executables

### 11.7 `go work` (Workspaces)
### 11.8 Debugging with Delve (`dlv`)
### 11.9 `go tool` Suite (objdump, compile, link, nm)
### 11.10 Live Reload (air, reflex)
### 11.11 Build Tools (mage, task)

## 12. Advanced Topics
- 12.1 Memory Mgmt. in Depth
- 12.2 Escape Analysis
- 12.3 Reflection
- 12.4 Unsafe Package
- 12.5 Build Constraints & Tags
- 12.6 CGO Basics
- 12.7 Compiler & Linker Flags
- 12.8 Plugins & Dynamic Loading
- 12.9 Assembly (Plan9 syntax)
- 12.10 `linkname` Directive
- 12.11 PGO (Profile-Guided Optimization, Go 1.21+)
- 12.12 Runtime Hooks (`runtime/trace`, finalizers)
- 12.13 `plugin` Package

## 13. Performance Engineering
- 13.1 CPU Profiling
- 13.2 Memory Profiling
- 13.3 Mutex / Block Profiling
- 13.4 Benchmarking Strategy
- 13.5 Optimization Workflow
- 13.6 pprof Deep
- 13.7 trace Tool

## 14. Production & Operations
- 14.1 Graceful Shutdown
- 14.2 Health Checks
- 14.3 Readiness / Liveness
- 14.4 Configuration Management
- 14.5 Secrets Management
- 14.6 Feature Flags
- 14.7 Deployment Strategies

## 15. Observability
- 15.1 `slog` Deep
- 15.2 Prometheus Metrics
- 15.3 OpenTelemetry
- 15.4 Distributed Tracing
- 15.5 Correlation IDs
- 15.6 Structured Logging
- 15.7 Error Tracking

## 16. Security in Go
- 16.1 TLS Config
- 16.2 JWT
- 16.3 OAuth
- 16.4 Secure Headers
- 16.5 OWASP Go
- 16.6 govulncheck Deep
- 16.7 Input Validation
- 16.8 Crypto Best Practices

## 17. Design Patterns in Go
- 17.1 Functional Options
- 17.2 Builder Pattern
- 17.3 Strategy Pattern
- 17.4 Decorator Pattern
- 17.5 Adapter Pattern
- 17.6 Factory Pattern
- 17.7 Observer Pattern
- 17.8 Singleton Pattern
- 17.9 Iterator Pattern
- 17.10 Facade Pattern
- 17.11 Proxy Pattern
- 17.12 Chain of Responsibility Pattern
- 17.13 Command Pattern
- 17.14 State Pattern
- 17.15 Object Pool Pattern
- 17.16 Pub/Sub Pattern
- 17.17 Futures & Promises Pattern
- 17.18 Registry Pattern
- 17.19 Composite Pattern
- 17.20 Fail-Fast Pattern

## 18. Architecture Patterns
- 18.1 Clean Architecture
- 18.2 Hexagonal Architecture
- 18.3 Domain-Driven Design (DDD)
- 18.4 CQRS
- 18.5 Event Sourcing
- 18.6 Onion Architecture

## 19. Microservices
- 19.1 Service Discovery
- 19.2 Circuit Breaker
- 19.3 Retries & Backoff
- 19.4 Bulkheads
- 19.5 Saga Pattern
- 19.6 API Gateway
- 19.7 Service Mesh Basics

## 20. Database Patterns
- 20.1 Connection Pool Tuning
- 20.2 Transactions
- 20.3 Prepared Statements
- 20.4 sqlc
- 20.5 sqlx
- 20.6 GORM Deep
- 20.7 pgx Deep
- 20.8 Database Migrations

## 21. API Design
- 21.1 REST Design
- 21.2 gRPC Deep
- 21.3 GraphQL Design
- 21.4 OpenAPI / Swagger
- 21.5 Versioning
- 21.6 Pagination
- 21.7 Rate Limiting
- 21.8 Error Responses

## 22. Distributed Systems
- 22.1 Raft Consensus
- 22.2 Distributed Locks
- 22.3 Leader Election
- 22.4 Eventual Consistency
- 22.5 Distributed Transactions
- 22.6 Clock & Time
- 22.7 Gossip Protocols

## 23. Cloud-Native Go
- 23.1 Kubernetes Operators
- 23.2 controller-runtime
- 23.3 Custom Resources (CRD)
- 23.4 Helm Charts
- 23.5 Service Mesh
- 23.6 Serverless Go

## 24. Runtime & Internals
- 24.1 Runtime Source Dive
- 24.2 Scheduler Source
- 24.3 GC Source
- 24.4 Memory Allocator
- 24.5 `runtime` Package Deep
- 24.6 Go Runtime Architecture

## 25. Go Source Reading
- 25.1 `net/http` Source
- 25.2 `sync` Source
- 25.3 `runtime` Source
- 25.4 `context` Source
- 25.5 `database/sql` Source
- 25.6 `encoding/json` Source
