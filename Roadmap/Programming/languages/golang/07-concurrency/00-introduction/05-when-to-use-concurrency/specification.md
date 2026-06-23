# When to Use Concurrency — Specification

## Table of Contents
1. [Introduction](#introduction)
2. [Canonical References](#canonical-references)
3. [Performance and Capacity Planning](#performance-and-capacity-planning)
4. [Queueing and Tail Latency](#queueing-and-tail-latency)
5. [Concurrent Design Patterns](#concurrent-design-patterns)
6. [Real-World Case Studies](#real-world-case-studies)
7. [Go-Specific Resources](#go-specific-resources)
8. [References](#references)

---

## Introduction

This file collects the bibliography for concurrency *design* — not just Go's implementation. The decisions made at the architectural level draw from queueing theory, capacity planning, distributed systems, and decades of production experience. The references below are starting points; many lead to entire fields.

---

## Canonical References

### Amdahl, 1967

Gene Amdahl, *Validity of the Single-Processor Approach to Achieving Large-Scale Computing Capabilities*, AFIPS 1967.

The original paper. Three pages. Read it.

### Gustafson, 1988

John Gustafson, *Reevaluating Amdahl's Law*, CACM 31(5), 1988.

The counter-argument. Also short.

### Little's law (1961)

John D. C. Little, *A Proof for the Queuing Formula: L = λW*, Operations Research 9(3), 1961.

Foundational queueing-theory result. Useful in capacity planning.

---

## Performance and Capacity Planning

### Books

- **Brendan Gregg, *Systems Performance: Enterprise and the Cloud*** (Prentice-Hall, 2nd ed. 2020). The performance engineer's bible. Linux-focused but applicable to Go.
- **Neil J. Gunther, *Guerrilla Capacity Planning*** (Springer, 2007). Practical capacity-planning techniques for unrealistic timelines.
- **Cary Millsap, *Optimizing Oracle Performance*** (O'Reilly, 2003). Database performance, but the methodology generalises.
- **Martin Kleppmann, *Designing Data-Intensive Applications*** (O'Reilly, 2017). System-design book covering concurrency, replication, partitioning.

### Papers

- David Patterson and John Hennessy, *Computer Architecture: A Quantitative Approach*. The standard textbook.
- Mor Harchol-Balter, *Performance Modeling and Design of Computer Systems: Queueing Theory in Action* (Cambridge, 2013). Excellent introduction to queueing models.

---

## Queueing and Tail Latency

### Papers

- Jeff Dean and Luiz André Barroso, *The Tail at Scale*, CACM 56(2), 2013. Google's seminal paper on tail latency. Read it.
- Ferran Alet et al., *Tail latency in batch systems*. Various.
- Jeff Dean, *Software Engineering Advice from Building Large-Scale Distributed Systems*: <https://research.google/pubs/pub44818/>

### Online

- Brendan Gregg's blog: <https://www.brendangregg.com/blog/>
- Martin Thompson, *Mechanical Sympathy* (concept and blog): <https://mechanical-sympathy.blogspot.com/>

---

## Concurrent Design Patterns

### Books

- **Maurice Herlihy and Nir Shavit, *The Art of Multiprocessor Programming*** (2nd ed., 2020). The textbook on shared-memory concurrent algorithms.
- **Brian Goetz et al., *Java Concurrency in Practice*** (2006). Java-focused but the patterns and analyses apply broadly.
- **Mara Bos, *Rust Atomics and Locks*** (O'Reilly, 2023). Modern treatment of concurrency primitives, applicable to Go conceptually.
- **Anthony Williams, *C++ Concurrency in Action*** (Manning, 2nd ed. 2019). Useful for understanding memory models and primitives.

### Talks

- Rob Pike, *Concurrency is not Parallelism*: <https://go.dev/blog/waza-talk>
- Rob Pike, *Go Concurrency Patterns*, Google I/O 2012.
- Sameer Ajmani, *Advanced Go Concurrency Patterns*, Google I/O 2013.

---

## Real-World Case Studies

### Papers

- *The Datacenter as a Computer* (Luiz André Barroso et al., 2nd ed.) — Google's view of large-scale systems.
- *Megastore: Providing Scalable, Highly Available Storage* — Google's scalable storage.
- *Dapper: A Large-Scale Distributed Systems Tracing Infrastructure* — Tracing for diagnosing concurrency.
- *Spanner: Google's Globally-Distributed Database* — Strong consistency at scale.

### Blog posts

- Cloudflare engineering blog: <https://blog.cloudflare.com/>
- DigitalOcean engineering blog: <https://www.digitalocean.com/blog>
- Stripe engineering blog: <https://stripe.com/blog/engineering>

These often contain detailed concurrency design write-ups.

---

## Go-Specific Resources

- **Sameer Ajmani, *Go Concurrency Patterns: Pipelines and cancellation***: <https://go.dev/blog/pipelines>
- **Katherine Cox-Buday, *Concurrency in Go*** (O'Reilly, 2017). The Go concurrency book.
- **The Go Blog**: <https://go.dev/blog/>
- **GopherCon talks**: search "GopherCon concurrency" on YouTube.
- **Dave Cheney, *High Performance Go*** (online materials).

---

## References

- Amdahl, *Validity of the Single-Processor Approach*, AFIPS 1967.
- Gustafson, *Reevaluating Amdahl's Law*, CACM 1988.
- Little, *A Proof for the Queuing Formula*, OR 1961.
- Dean and Barroso, *The Tail at Scale*, CACM 2013.
- Pike, *Concurrency is not Parallelism*: <https://go.dev/blog/waza-talk>
- Harchol-Balter, *Performance Modeling and Design of Computer Systems*, Cambridge 2013.
- Kleppmann, *Designing Data-Intensive Applications*, O'Reilly 2017.
- Herlihy and Shavit, *The Art of Multiprocessor Programming*, 2nd ed. 2020.
- Cox-Buday, *Concurrency in Go*, O'Reilly 2017.
- Gregg, *Systems Performance*, 2nd ed. 2020.
- Go documentation: <https://go.dev/doc/>
- Go blog: <https://go.dev/blog/>
- The Go Memory Model: <https://go.dev/ref/mem>
