# Abstraction — Interview Q&A

50 questions covering the spectrum from junior to staff.

---

## Section A — Basics (1-10)

**Q1. What is abstraction in OOP?**
A: The act of separating a contract (what something does) from its implementation (how it does it). In Java, expressed via interfaces, abstract classes, and the public/private boundary.

**Q2. What's the difference between abstraction and encapsulation?**
A: Encapsulation hides *internal state* via access modifiers. Abstraction hides *implementation choices* via well-designed APIs. They're complementary techniques toward the same goal.

**Q3. What is an abstract class?**
A: A class declared with the `abstract` keyword that cannot be instantiated directly. May contain abstract methods (no body) that subclasses must implement.

**Q4. What is an interface?**
A: A reference type that declares a set of methods (and possibly default implementations) but no instance state. Classes can implement multiple interfaces.

**Q5. Can an abstract class have a constructor?**
A: Yes. Subclass constructors call it via `super(...)`. The abstract class can't be instantiated directly, but its constructor still runs as part of subclass instantiation.

**Q6. Can an interface have a constructor?**
A: No. Interfaces have no instance state, so there's nothing to initialize. They can have static initializer blocks (since Java 8) for static state.

**Q7. Can an interface have fields?**
A: It can declare `public static final` constants (modifiers are implicit if omitted), but no instance fields.

**Q8. What's a default method?**
A: A method in an interface with a body, marked `default`. Java 8+ feature. Implementing classes inherit the default unless they override it.

**Q9. What's the difference between abstract method and default method?**
A: Abstract: no body, must be implemented by every concrete subclass. Default: has a body, may be overridden, otherwise inherited.

**Q10. When should you use abstract class vs interface?**
A: Abstract class when you have shared state or template methods. Interface when describing a capability or contract. Default to interfaces; use abstract classes when state sharing is the point.

---

## Section B — Design (11-20)

**Q11. What does "program to an interface, not an implementation" mean?**
A: Use the most general type that meets your needs in variable declarations, parameters, and return types. Lets implementations be swapped without breaking callers.

**Q12. What is the Strategy pattern?**
A: Encapsulate an algorithm as an interface with multiple implementations. Inject the chosen impl into the user. Common for sorting, validation, pricing strategies.

**Q13. What is the Template Method pattern?**
A: Parent class defines the algorithm skeleton (in a `final` method); subclasses fill in specific steps via abstract or hookable methods.

**Q14. What is the Bridge pattern?**
A: Separate two orthogonal axes of variation (e.g., Shape × Renderer) by composing them, avoiding a Cartesian explosion of subclasses.

**Q15. What is the Adapter pattern?**
A: Wrap one interface to look like another. Useful for integrating incompatible APIs.

**Q16. What is the Decorator pattern?**
A: Wrap an instance to add behavior while preserving its interface. Stack decorators to compose features (logging, caching, retry).

**Q17. What is the Facade pattern?**
A: Provide a simpler interface to a complex subsystem. The facade is itself an abstraction over the system's actual API.

**Q18. What is "leaky abstraction"?**
A: Joel Spolsky's term: every non-trivial abstraction reveals its underlying implementation in some edge case. Examples: TCP exposing networking failures, SQL exposing query optimizer differences.

**Q19. What is the Single Responsibility Principle (SRP) for interfaces?**
A: An interface should have one reason to change. If its methods serve unrelated purposes, split it. Aligns with Interface Segregation Principle (ISP).

**Q20. When does abstraction add cost without benefit?**
A: When there's only one implementation, or when callers must constantly downcast to use specific impl features. Premature abstraction.

---

## Section C — Java specifics (21-30)

**Q21. Can an abstract method be private?**
A: No. Private methods aren't visible to subclasses, so they can't be overridden, so abstract makes no sense.

**Q22. Can an abstract method be static?**
A: No. Static methods aren't dispatched polymorphically, so abstract has no meaning.

**Q23. Can an abstract method be final?**
A: No. `final` forbids overriding; `abstract` requires it. Contradictory.

**Q24. What's a functional interface?**
A: An interface with exactly one abstract method (SAM). Can be implemented with a lambda or method reference. Often annotated `@FunctionalInterface` for documentation/enforcement.

**Q25. Can an interface have private methods?**
A: Yes, since Java 9. Useful for sharing helper code among default methods without exposing it to implementers.

**Q26. Can an interface have static methods?**
A: Yes, since Java 8. Static methods on interfaces are scoped to the interface — `Comparator.naturalOrder()`, etc.

**Q27. What's a sealed interface?**
A: An interface that restricts which classes/interfaces can implement/extend it via a `permits` clause. Java 17+ feature.

**Q28. Can a class extend multiple abstract classes?**
A: No. Single inheritance for classes. Workaround: implement multiple interfaces with default methods.

**Q29. What happens if a class doesn't implement all abstract methods of its parent?**
A: The class itself must be declared `abstract`. Otherwise compile error.

**Q30. What's the diamond problem with default methods?**
A: When two interfaces provide conflicting default methods, the implementing class must explicitly resolve via `Interface.super.method()` or a custom override.

---

## Section D — Performance & internals (31-40)

**Q31. Is virtual dispatch expensive?**
A: Cold ~5 ns; hot/JIT-inlined ≈ 0 ns. The JIT devirtualizes monomorphic and bimorphic call sites.

**Q32. What is "monomorphic" dispatch?**
A: A virtual call site that has only ever seen one receiver class. The JIT can inline as if it were direct.

**Q33. What is "megamorphic" dispatch?**
A: A virtual call site that has seen 3+ different receiver classes. The JIT falls back to a vtable/itable lookup; no inlining.

**Q34. How does the JIT optimize abstract method calls?**
A: Inline cache + class hierarchy analysis. Usually devirtualizes monomorphic calls. Falls back to vtable lookup for megamorphic ones.

**Q35. Is `invokeinterface` slower than `invokevirtual`?**
A: Marginally — itable search vs vtable index. Both are cached after first call. Typically <10% difference, often imperceptible.

**Q36. How do lambdas compile to bytecode?**
A: Each lambda site emits `invokedynamic` to `LambdaMetafactory.metafactory`. At first call, a hidden class implementing the functional interface is generated.

**Q37. How fast is a lambda call after JIT?**
A: Approximately as fast as a direct method call (~1 ns). Earlier overhead is in the hidden-class generation.

**Q38. What is `MethodHandle`?**
A: A typed reference to a method, since Java 7. Used by `LambdaMetafactory`, `String concat`, and high-performance reflection alternatives.

**Q39. What are hidden classes?**
A: Classes loaded via `Lookup.defineHiddenClass` (Java 15+) that have no symbolic name and can be unloaded when their lookup is GC'd. Used internally for lambdas, dynamic proxies.

**Q40. Why might streams be slower than loops?**
A: Stream pipelines incur per-element abstraction (functional interfaces, intermediate state). The JIT often can't fuse the pipeline as tightly as a hand-written loop. For hot paths processing millions, loops can be faster.

---

## Section E — Open-ended (41-50)

**Q41. How would you abstract a payment system over multiple gateways (Stripe, PayPal, Adyen)?**
A: Define a `PaymentGateway` interface with `charge`, `refund`, `void`. Each gateway implements it. Use a factory or DI to choose at runtime. Document the contract: idempotency, retry semantics, error codes.

**Q42. When would you use a sealed interface over an open one?**
A: When the set of variants is known and finite (e.g., AST nodes, Result types, HTTP method enums). Sealed gives exhaustive pattern matching and prevents surprise variants.

**Q43. How do you avoid over-abstraction in a young codebase?**
A: Apply the rule of three. Wait until you have at least three concrete cases that need an abstraction. Until then, write concrete code.

**Q44. How does dependency injection rely on abstraction?**
A: DI frameworks substitute concrete instances at runtime. The user code declares dependencies via interfaces; the framework wires them. Without interfaces, DI degenerates into "passing arguments."

**Q45. What's the contract for `Comparable.compareTo`?**
A: Anti-symmetric (`a.compareTo(b) == -b.compareTo(a)`), transitive, consistent with equals (recommended). Returns negative/zero/positive.

**Q46. How do you test an abstract class?**
A: Write a contract test class. Each subclass extends the contract test and provides its concrete instance. Common pattern in JDK collections testing.

**Q47. Why is `Cloneable` considered a bad abstraction?**
A: It's a marker interface with no methods. The actual `clone()` is on `Object`, behaves strangely (shallow copy by default), and the contract is poorly specified. Effective Java recommends never using it.

**Q48. How would you abstract a logging library to allow swapping impls?**
A: Define a tiny `Logger` interface (`info`, `warn`, `error`). Production picks SLF4J/Logback. Tests use a recording impl. Don't depend on a specific framework's API in your code.

**Q49. What's the "interface segregation principle"?**
A: Clients should not be forced to depend on methods they don't use. Split fat interfaces into smaller role-based ones.

**Q50. How does pattern matching change abstraction in modern Java?**
A: It enables exhaustive dispatch over sealed types without the visitor pattern. Reduces boilerplate, gives compile-time safety, and is more readable than `instanceof` chains.

---

## Bonus — staff/architect level (51-55)

**Q51. How would you migrate a legacy system from concrete types to abstractions?**
A: Branch by abstraction. Step 1: introduce the interface. Step 2: have all consumers depend on the interface. Step 3: extract one concrete impl behind it. Step 4: add additional impls. Throughout, integration tests must keep passing.

**Q52. What are the trade-offs between an `enum` and a sealed type for representing variants?**
A: Enums are simpler, have built-in `values()`, and are runtime-known. Sealed types can carry per-variant data and richer behavior. Use enum for simple labels; sealed for typed variants with payloads.

**Q53. When would you choose `record` over an interface?**
A: Records are for data carriers — they auto-generate equals/hashCode/toString. If you only need data, use a record. If you need behavioral abstraction (multiple impls), use an interface.

**Q54. How does abstraction relate to evolvability?**
A: Abstraction makes *swap* easy (replace impl) but *evolve* harder (changing the contract breaks all impls). Choose carefully which axis you optimize for.

**Q55. What's your heuristic for "is this abstraction worth it"?**
A: Three signals: (1) at least two real implementations; (2) the contract is stable enough to last several iterations; (3) callers genuinely benefit from not knowing the impl. If any is missing, reconsider.

---

**Use this list:** answer aloud, mark ones you missed. Strong candidates can articulate *why* each rule exists, not just state it.
