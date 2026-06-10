# Pass by Value / Pass by Reference — Professional

> **What?** The bytecode-level mechanics of argument passing: operand stack, local variable slots, the JVM calling convention, register allocation in C2, and how lambdas capture variables.
> **How?** Read with `javap -v -c`, observe stack pushes/pops and slot assignments.

---

## 1. Local variable slots

Each method has a *local variable array* sized at compile time. Parameters occupy the first slots:

```java
void m(int a, double b, String c) { ... }
```

Local variables (after frame setup):
```
slot 0: this (for instance methods)
slot 1: a (int)
slot 2: b (double, takes 2 slots — slot 2 and 3)
slot 4: c (String reference)
```

`double` and `long` take two slots each (since the JVM is 32-bit-flavored at the abstract machine level).

---

## 2. Argument push and call

```java
m(1, 2.0, "hi");
```

```
0: aload_0           // 'this'
1: iconst_1           // a = 1
2: ldc2_w 2.0         // b = 2.0 (two-slot push)
5: ldc "hi"           // c reference
7: invokevirtual #5   // m(IDLjava/lang/String;)V
10: return
```

Args are pushed onto the operand stack; `invokevirtual` pops them and copies to callee's local slots.

---

## 3. The JVM calling convention (abstract machine)

JVMS §6.5: when a method is invoked:
1. Args are popped from the operand stack.
2. A new stack frame is created for the callee.
3. The receiver (for non-static) goes to slot 0.
4. Args go to subsequent slots.
5. Return value (if any) is pushed onto the caller's stack on return.

This is the *abstract* machine. The JIT often elides the operand stack entirely, passing args via CPU registers.

---

## 4. C2's register allocation

For hot methods, C2 maps local slots to physical registers:
- Most-used parameters → registers
- Long-lived state → registers or stack
- Spills to stack only when registers run out

After JIT, parameter passing is as fast as direct CPU register use. The "operand stack" exists only conceptually.

---

## 5. Reference vs primitive pushing

For a primitive:
```
iconst_5         // push int 5
```

For a reference:
```
aload_3          // push reference from local slot 3
```

The bytecode `i*` opcodes are for ints; `a*` for references; `d*` for doubles; etc. Type safety is at the bytecode level.

---

## 6. Boxing in bytecode

```java
m(5);   // m(Integer)
```

```
0: aload_0
1: iconst_5
2: invokestatic Integer.valueOf:(I)Ljava/lang/Integer;
5: invokevirtual m
```

The `invokestatic Integer.valueOf` is the boxing call. This is the source of boxing cost.

---

## 7. Varargs in bytecode

```java
m(1, 2, 3);   // m(int...)
```

```
0: aload_0
1: iconst_3
2: newarray int
4: dup
5: iconst_0
6: iconst_1
7: iastore
8: dup
9: iconst_1
10: iconst_2
11: iastore
12: dup
13: iconst_2
14: iconst_3
15: iastore
16: invokevirtual m
```

Each call allocates a new `int[3]` and stores values. Allocation cost per call.

---

## 8. Lambda capture in bytecode

```java
int x = 5;
Runnable r = () -> System.out.println(x);
```

```
0: iconst_5
1: istore_1                 // x = 5
2: iload_1                   // load x
3: invokedynamic #5          // LambdaMetafactory.metafactory(...)
8: astore_2                  // r = ...
```

The `invokedynamic` calls the lambda metafactory, which generates a hidden class with `x` as a field. The hidden class's `run` method reads from that field.

---

## 9. The frame structure

Each method invocation creates a frame:
```
+---------------------+
| operand stack       |  (used during method execution)
+---------------------+
| local variables     |  (parameters + locals)
+---------------------+
| return address      |
+---------------------+
| previous frame ptr  |
+---------------------+
```

The frame is allocated on the JVM call stack. After return, frame is popped.

The JIT often elides the frame structure entirely for inlined methods.

---

## 10. Call site arguments and the stack

```java
m(a + b, c * d);
```

Bytecode:
```
0: iload_1     // a
1: iload_2     // b
2: iadd        // a + b
3: iload_3     // c
4: iload_4     // d
5: imul        // c * d
6: invokevirtual m
```

Arguments are computed left-to-right (per JLS §15.7.4). Each result is on the operand stack when the call happens.

---

## 11. Side effects in arguments

```java
m(x++, ++x);
```

Per JLS §15.7.4, arguments are evaluated left-to-right, side effects included:

```
0: iload_1       // load x (e.g., 0)
1: iinc 1, 1     // x = x + 1 (post-increment of first arg already pushed)
4: iinc 1, 1     // x = x + 1 (pre-increment of second arg)
7: iload_1       // load x (value: 2)
8: invokevirtual m
```

Result: `m` receives `(0, 2)`.

---

## 12. Method handle invocation

```java
MethodHandle mh = ...;
int result = (int) mh.invokeExact(arg1, arg2);
```

`MethodHandle.invokeExact` is a polymorphic signature method — the JVM treats each invocation as having the call site's specific signature. The bytecode is:

```
invokevirtual MethodHandle.invokeExact:(II)I
```

JIT inlines through the method handle, often producing direct calls.

---

## 13. Where the spec says it

| Topic                          | Source            |
|--------------------------------|-------------------|
| Method invocation               | JLS §15.12         |
| Argument evaluation             | JLS §15.7.4        |
| Method invocation expressions   | JLS §15.12.4       |
| Frame format                    | JVMS §2.6          |
| Operand stack                   | JVMS §2.6.2        |
| Local variables                 | JVMS §2.6.1        |
| `invoke*` opcodes               | JVMS §6.5          |
| `i*`/`a*`/`d*` load/store       | JVMS §6.5          |

---

**Memorize this**: bytecode passes args via the operand stack into local slots. JIT translates to registers. Boxing inserts `invokestatic Integer.valueOf` calls. Varargs allocates an array per call. Lambdas capture via `invokedynamic` + hidden classes. Read `javap -v` to see what your code does.
