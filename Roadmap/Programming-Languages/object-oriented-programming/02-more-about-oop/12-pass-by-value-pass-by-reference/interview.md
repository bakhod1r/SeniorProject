# Pass by Value / Pass by Reference — Interview Q&A

50 questions on the famous Java semantics question.

---

## Section A — Basics (1-10)

**Q1. Is Java pass by value or pass by reference?**
A: Always pass by value. For reference types, the value passed is a reference (a pointer-like handle), not the object itself.

**Q2. Why is this confusing?**
A: For reference types, mutations through the parameter are visible to the caller (it points to the same object). This *looks* like pass-by-reference, but reassigning the parameter doesn't affect the caller.

**Q3. Can a method modify a primitive caller variable?**
A: No. Primitives are copied. The parameter is a separate local variable.

**Q4. Can a method modify an object the caller passed?**
A: Yes — by mutating the object. Both caller and callee share the reference.

**Q5. Can a method reassign a parameter to point to a new object?**
A: Yes, but the change isn't visible to the caller. The reassignment only affects the local copy of the reference.

**Q6. Does this work as a "swap"?**
```java
void swap(int a, int b) { int t = a; a = b; b = t; }
```
A: No. Pass by value — caller's variables are unchanged.

**Q7. Does this work for objects?**
```java
void swap(Object a, Object b) { Object t = a; a = b; b = t; }
```
A: No. Same reason — references are copied, reassignment is local.

**Q8. Why doesn't Java have pass-by-reference?**
A: Design choice for simplicity and safety. Reduces aliasing surprises. Encourages immutability and explicit returns.

**Q9. Are arrays passed by reference?**
A: No. They're reference types, so the reference is passed by value. Mutations to elements are visible; reassigning the parameter array isn't.

**Q10. Are records passed by reference?**
A: Same as any reference type — reference is passed by value. Records are immutable, so caller can't see changes (because there are none).

---

## Section B — Mechanism (11-20)

**Q11. What does the bytecode show for argument passing?**
A: Args are pushed onto the operand stack. The `invoke*` opcode pops them into the callee's local variable slots.

**Q12. Are arguments evaluated left-to-right?**
A: Yes (JLS §15.7.4).

**Q13. What if an argument has a side effect?**
A: Side effects happen during evaluation, in order. Arguments to the left are evaluated before arguments to the right.

**Q14. What about boxing?**
A: When passing a primitive to a parameter that expects a wrapper type (e.g., `Integer`), the compiler inserts an `Integer.valueOf` call. Cached for small values; allocates for large.

**Q15. What about varargs?**
A: The compiler creates an array containing the args. Each call allocates the array (unless escape analysis eliminates it).

**Q16. Are lambda captures by value or reference?**
A: Captures are by *value*. The captured variable must be effectively final (can't be reassigned after capture). The captured value is a snapshot.

**Q17. Can you pass `this` as an argument?**
A: Yes, like any reference. But beware leaking `this` from constructors — the partially-constructed instance can be observed.

**Q18. Are constructor parameters passed the same way?**
A: Yes. Constructor invocation uses `invokespecial`, but argument passing follows the same rules as method invocation.

**Q19. Are interface method calls different?**
A: Same rules. The dispatch (vtable vs itable) differs, but argument passing semantics don't.

**Q20. What does the JVM do with parameters in registers?**
A: At the bytecode level, parameters are in local slots. The JIT often allocates them to CPU registers per the platform's calling convention.

---

## Section C — Pitfalls (21-30)

**Q21. Why doesn't this work?**
```java
void replace(List<X> list) { list = new ArrayList<>(); }
```
A: Reassigning `list` only changes the local reference. Caller's variable is unaffected.

**Q22. How would you "replace" the caller's list?**
A: Return the new list:
```java
List<X> replace() { return new ArrayList<>(); }
caller's: list = replace();
```

**Q23. Why does this affect the caller?**
```java
void clear(List<X> list) { list.clear(); }
```
A: `clear()` mutates the underlying object. Both caller and callee see the same object; mutations are shared.

**Q24. How do you protect against caller-visible mutation?**
A: Defensive copy at the boundary, or use immutable types.

**Q25. How does pass-by-value affect "swap"?**
A: It doesn't work as expected. Either return the swapped values (record), or use a wrapper class.

**Q26. Are primitive wrapper types like `Integer` mutable?**
A: No. `Integer` is immutable. `AtomicInteger` is mutable.

**Q27. Why does `Integer x = 5; x++;` not "mutate" Integer?**
A: `x++` reassigns `x` to a new Integer (autoboxed from `intValue() + 1`). The original Integer is unchanged.

**Q28. What's the issue with passing a mutable input and storing it?**
A: The caller still has the reference and can mutate after construction. Defensive copy at the storage point.

**Q29. What about `null` as an argument?**
A: Passed by value (the null reference). Receiver gets null; cannot mutate or reassign for caller.

**Q30. Is this good API design?**
```java
void compute(Map<String, Integer> result) { ... }   // expects empty input, fills it
```
A: Often considered bad. Prefer returning a new map. Less surprising.

---

## Section D — Lambdas & generics (31-40)

**Q31. Can a lambda capture a mutable variable?**
A: Only effectively-final variables (cannot be reassigned after capture). For mutable state, use AtomicInteger or an array.

**Q32. Why are captures by value?**
A: Java's lambdas don't have closures over mutable state by design. Simplifies semantics; encourages functional style.

**Q33. What about `final int[] x = {0}`?**
A: The variable `x` is final (can't be reassigned). But `x[0]` is mutable. Lambdas can mutate `x[0]`.

**Q34. Does generics affect parameter passing?**
A: No. Erasure means parameters are passed as `Object` (or bound). Pass-by-value semantics unchanged.

**Q35. What about generic methods with type inference?**
A: Same — passed by value, type-erased.

**Q36. Are static methods passed parameters the same way?**
A: Yes. The only difference: no `this` parameter.

**Q37. What about `this` for instance methods?**
A: `this` is passed implicitly as the receiver. Behaves like an additional argument from the JVM's view.

**Q38. Is `this` reassignable?**
A: No. `this` is final.

**Q39. What about methods with thrown exceptions?**
A: Exception throwing doesn't affect argument passing. Args are evaluated and bound before the method body executes.

**Q40. What if argument evaluation throws?**
A: Per JLS §15.7.4, evaluation stops at the first exception. Subsequent arguments don't evaluate. The method isn't called.

---

## Section E — Real-world (41-55)

**Q41. How would you implement an "out" parameter in Java?**
A: Use a wrapper class (mutable) or return a record. Records are cleaner for multiple outputs.

**Q42. How would you mock-modify an integer parameter for testing?**
A: You can't. Wrap in `AtomicInteger` or pass a record. Or rethink the API.

**Q43. Why is `Integer i = 1000; m(i); System.out.println(i);` tricky?**
A: `i` itself isn't modified. But if `m` receives the same `Integer` reference and stores it elsewhere, the storage holds the same object. Boxing/unboxing complicates the mental model.

**Q44. What's the "alias" problem?**
A: Multiple references pointing to the same mutable object. Mutations are visible everywhere. Defensive copies prevent surprise.

**Q45. How does immutability help with pass-by-value confusion?**
A: Immutable objects can't be mutated. Caller doesn't have to fear the method changing state. Records make this trivial.

**Q46. How does Project Valhalla affect this?**
A: Value classes have no identity — they're like primitives. Pass-by-value semantics are even clearer.

**Q47. Can frameworks bypass pass-by-value?**
A: Reflection can rewrite fields directly. But that bypasses normal method-call semantics; it's a different mechanism.

**Q48. Is there any way to get true pass-by-reference in Java?**
A: Closest approximation: pass a wrapper object whose mutable fields the callee can update. But that's still pass-by-value of the wrapper reference.

**Q49. Why does this feel like pass-by-reference for objects?**
A: Because mutations are visible. The mental shortcut "objects passed by reference" is partly correct for *mutations* but wrong for *reassignments*. The precise truth: references passed by value.

**Q50. How would you teach this concept?**
A: Show three cases: (1) primitive — caller unaffected, (2) object mutation — caller sees change, (3) parameter reassignment — caller doesn't see. The third is the disambiguator.

---

## Bonus — staff (51-55)

**Q51. Why does Java not have a `ref` keyword like C#?**
A: Design philosophy: simpler semantics, encourage immutability and clear data flow. Avoid the aliasing issues that arise with shared mutable state.

**Q52. How does pass-by-value interact with concurrency?**
A: Each thread sees its own parameter values. But if both reference the same object, mutations are visible across threads (with proper synchronization).

**Q53. Can you write a Java function that swaps two numbers?**
A: Not directly with primitives or immutable wrappers. Workarounds: return two values via record, use mutable wrappers, modify a passed-in array.

**Q54. What's an "alias-free" function?**
A: A function whose parameters don't share state with each other or with the caller's other variables. Pure functions over immutable types are alias-free; methods that take mutable inputs may not be.

**Q55. How does pattern matching change anything about parameter passing?**
A: Nothing fundamental. Pattern matching is a way to test and bind values; the underlying parameter passing is still by value.

---

**Use this list:** mix questions across sections. Strong candidates show all three behaviors clearly: primitives, object mutation, parameter reassignment.
