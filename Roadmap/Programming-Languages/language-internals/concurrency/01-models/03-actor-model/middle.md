# Actor Model — Middle Level

> **Topic:** [Actor Model](README.md)
> **Focus:** become/behavior, supervision, ask vs tell, routing, lifecycle

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
11. [Clean Code](#clean-code)
12. [Best Practices](#best-practices)
13. [Edge Cases & Pitfalls](#edge-cases--pitfalls)
14. [Common Mistakes](#common-mistakes)
15. [Tricky Points](#tricky-points)
16. [Test Yourself](#test-yourself)
17. [Tricky Questions](#tricky-questions)
18. [Cheat Sheet](#cheat-sheet)
19. [Summary](#summary)
20. [What You Can Build](#what-you-can-build)
21. [Further Reading](#further-reading)
22. [Related Topics](#related-topics)
23. [Diagrams & Visual Aids](#diagrams--visual-aids)

---

## Introduction

At the junior level you learned that an actor is a unit of computation that owns its state, has a mailbox, and reacts to messages one at a time. That definition is correct, but it leaves out everything that makes the actor model practical for real systems. A production actor is not just a function plus a queue: it is a process with a lifecycle, a behavior that can change at runtime, a parent that watches over it, and a place inside a routing topology that distributes load across siblings.

The middle level is where the actor model stops feeling like "an object with a queue" and starts feeling like "a tiny operating-system process." You think about supervision the way a kernel author thinks about init: who restarts whom, in what order, with what backoff. You think about behaviors the way a state-machine designer thinks about states: each behavior is a node, each message handler is a transition. You think about the mailbox the way a network engineer thinks about a TCP buffer: bounded or unbounded, lossy or reliable, fair or priority-ordered.

You also confront the central tension of mature actor work: should the actor be typed or untyped? Erlang and Elixir treat actors as inherently dynamic, because their hot-code-reload story depends on processes being able to accept any message at any time. Akka and Pekko on the JVM moved aggressively toward typed actors (Akka Typed, then Pekko Typed) because the JVM has compilers and IDEs that benefit from static guarantees. Orleans on .NET split the difference with virtual actors called grains that look like normal interface calls but execute under actor rules. Each tradeoff is defensible; none is universal.

This document walks you through the patterns that separate someone who has read about actors from someone who has shipped an actor system. We cover `become` and behavior switching, stash and unstash, the difference between `ask` and `tell`, supervision strategies, OTP behaviors, routing topologies, lifecycle hooks, and the mistakes that look harmless until you scale past ten thousand actors. The examples are runnable; the explanations assume you already understand the junior material and want to know how the pieces fit together when traffic shows up.

---

## Prerequisites

Before reading this document you should be comfortable with the following ideas. If any of them feel new, pause and review the junior level first; this material builds directly on it.

- The basic actor model: actors own state, communicate only via messages, and process messages one at a time.
- The difference between asynchronous message passing and synchronous method calls.
- Why shared mutable state and locks are problematic in concurrent code.
- The notion of a mailbox as a FIFO queue.
- At least one of the following ecosystems at a beginner level: Erlang/OTP, Elixir, Akka, Pekko, Orleans, Proto.Actor, or Ray actors.
- The vocabulary of concurrency: race condition, deadlock, starvation, backpressure.
- Basic finite-state-machine concepts: states, transitions, events.
- Some exposure to the actor-tree mental model (parent, child, supervisor).

You do not need to be an expert in distributed systems, formal verification, or the lambda calculus. We will introduce the terms as needed and link to the senior document for the deep dives.

---

## Glossary

| Term | Meaning |
| --- | --- |
| Become | Operation that replaces an actor's current message handler with a new one, effectively transitioning to a new state. |
| Stash | Temporary holding area for messages an actor cannot handle in its current behavior; replays them later via unstash. |
| Ask | Request-reply pattern: send a message and receive a future or promise that completes with the reply. |
| Tell | Fire-and-forget pattern: send a message and do not wait for any reply. |
| Supervision strategy | Policy that decides how a parent reacts when a child fails: restart, stop, resume, or escalate. |
| gen_server | OTP behavior for generic server processes with synchronous call, asynchronous cast, and info callbacks. |
| gen_statem | OTP behavior for state machines, providing explicit state names and event-driven transitions. |
| Behavior | In Akka Typed and Pekko Typed, a value describing how the actor handles its next message; new behavior is returned from each handler. |
| Dispatcher | Component that schedules actors onto threads; controls concurrency, throughput, and isolation. |
| Typed actor | Actor whose message type is statically known and checked by the compiler, restricting what messages it can receive. |

---

## Core Concepts

### Become and behavior switching

A junior actor has one `receive` block that handles every message. A middle-level actor recognizes that real systems are state machines, and that hard-coding state transitions inside a single mega-handler with nested `if` statements is a recipe for bugs.

The `become` operation lets an actor swap out its message handler at runtime. After `become(newHandler)`, the next message is processed by `newHandler` instead of the original one. In Akka classic this looks like `context.become(receiveActive)`. In Akka Typed and Pekko Typed each handler returns the next `Behavior[T]`, so behavior switching is the normal flow rather than a special operation. In Erlang you achieve the same effect by tail-calling a different `loop/N` function from inside your receive loop.

Behavior switching is how you implement finite state machines as actors. A connection actor might begin in `Disconnected`, become `Connecting` when it receives `Connect`, become `Connected` on successful handshake, and become `Closing` when asked to shut down. Each state has its own handler, each handler knows only the transitions it cares about, and the type of the actor never changes from the outside.

The mental model is: behavior is data. A handler is a function from message to next behavior. The actor's identity stays constant; only its current behavior moves through the state space.

### Stash and unstash

When an actor is in a transient state, some messages are not yet handleable. A `Connecting` actor that receives a `Send` message before the handshake completes cannot fulfill it, but it also should not drop it or fail. The actor stashes the message: pushes it onto an internal holding area. When the actor transitions to `Connected`, it unstashes, replaying the buffered messages into its mailbox so they are handled with the new behavior.

Stash is implemented in Akka via the `Stash` trait or the typed `StashBuffer`. In Erlang you typically achieve the same effect by selectively receiving only certain message tags, leaving the others in the mailbox; `gen_statem` has explicit postpone semantics. The principle is universal: when a message arrives early, you neither drop it nor let it block the state transition.

Stash has a capacity. An unbounded stash is a memory leak waiting to happen. A bounded stash forces you to decide what happens when the buffer is full: typically the actor crashes and the supervisor takes over, which is fine because the supervisor can rebuild state more cleanly than the actor can patch around overflow.

### Ask versus tell

`Tell` (in Erlang `!`, in Akka `actorRef ! Msg`) is fire-and-forget. You send a message and return immediately. No reply, no acknowledgment, no future. This is the default and should be the default. Tell is asynchronous, non-blocking, and composes naturally with the actor model.

`Ask` is request-reply. You send a message and receive a future or promise that resolves with the reply. Internally, ask creates a one-shot temporary actor whose only job is to receive the reply, complete the future, and die. Ask is convenient when you need a result, but it has sharp edges:

- Ask requires a timeout. Without one, a future that never completes blocks whatever code is awaiting it forever.
- Ask creates a temporary actor per call. At high volume this is allocation pressure and GC churn.
- Ask outside an actor is fine. Ask from inside an actor while blocking on the result is a deadlock waiting to happen, because the asking actor cannot process any other message while it waits.
- Ask makes failures into timeouts. If the target actor crashes, the ask completes with a timeout rather than a clear error, which can hide real bugs.

The mature pattern is: tell by default, ask only at the boundary between actor and non-actor code, never block inside an actor on an ask result. If you need a reply inside an actor, send a message and treat the eventual response as another message rather than a future.

### Typed versus untyped actors

The original actor model and Erlang's implementation are untyped. An actor accepts any term, pattern-matches it inside receive, and ignores or fails on unknown shapes. This dynamism is the price you pay for hot code reload: a process running version 1 of the code must be able to receive a message added in version 2 without the compiler having any say.

The JVM ecosystem moved in the opposite direction. Akka Typed and Pekko Typed make the actor's message type a generic parameter: `ActorRef[Command]` means "this actor accepts only `Command` messages." The compiler checks every `tell` and rejects mismatches. This catches huge classes of bugs at build time and makes refactoring safe.

The cost is loss of dynamism. You cannot send a freshly-defined message to a typed actor without the compiler knowing about it. Hot code reload becomes harder. Cross-version compatibility requires explicit `Codec` or `Adapter` patterns.

Orleans takes a different path. Grains are typed interfaces; you call them like methods. The runtime intercepts the call, queues it as a message, and runs the grain's implementation on a single-threaded turn. The type system sees a normal interface; the runtime delivers actor semantics.

The choice is rarely about correctness and almost always about ecosystem norms. Erlang's hot-reload story is irreplaceable; Akka Typed's compile-time safety is irreplaceable; Orleans's "actors as methods" is irreplaceable for teams that already think in C# interfaces. Pick the model that matches your team's mental habits.

### Supervision strategies

A supervisor is an actor whose children are actors. When a child crashes, the supervisor decides what to do. The decision is governed by a supervision strategy.

- **One-for-one**: only the failing child is restarted. The siblings continue unaffected. Use this when children are independent.
- **One-for-all**: when one child fails, all siblings are stopped and restarted. Use this when children share state or a logical session that becomes inconsistent if any single child resets.
- **Rest-for-one**: the failing child and all children started after it are restarted; earlier siblings continue. Use this when there is a dependency order among children.
- **Escalate**: the supervisor fails too, passing the problem up to its own parent. Use this when the failure indicates a fault the supervisor cannot handle, such as a configuration error.

In addition to which children to restart, the strategy specifies how often. A typical policy is "restart up to N times in M seconds; after that, escalate." This prevents an infinite restart loop when the child is doomed regardless.

The supervisor never inspects the crashed child's state. It assumes the crash means the state is corrupt and starts from clean state. This is the "let it crash" philosophy: defensive coding is replaced by simple coding plus supervision.

### Hot code reload in Erlang/OTP

Erlang processes can run new code without stopping. The runtime keeps both the old and new versions of a module loaded. When a process makes a fully-qualified call (`Module:function/N` instead of a local call), the runtime dispatches to the latest version. A process is "upgraded" when it crosses such a boundary.

This works precisely because Erlang is untyped at the message level. A `gen_server` callback module can be replaced, and the next time the server's loop calls `Module:handle_call/3`, it picks up the new implementation. State migration is handled by the `code_change/3` callback, which transforms the old state structure into the new one.

Hot reload is not a casual feature: it is the reason telecom systems built on Erlang have nine-nines availability. It requires discipline (every callback must be a fully-qualified call, state must be transformable, releases must be packaged with `relup` instructions), but for systems that cannot tolerate downtime it is unmatched.

### OTP behaviours

OTP (Open Telecom Platform) is the standard library of patterns that ship with Erlang. The most important pieces are the behaviours, which are essentially interfaces with built-in process lifecycles:

- **gen_server**: a generic server. You implement `init/1`, `handle_call/3` (synchronous), `handle_cast/2` (asynchronous), `handle_info/2` (out-of-band), and `terminate/2`. The behaviour handles the receive loop, timeouts, system messages, and integration with supervisors.
- **gen_statem**: a generic state machine. You define state names, and each state has a handler that receives events and returns the next state. Supports postpone (stash), timeouts per state, and complex transition logic.
- **gen_event**: a generic event manager. Multiple handlers attach to one manager; events broadcast to all handlers. Useful for logging and notification.
- **supervisor**: a generic supervisor with declarative child specifications.

Using a behaviour means you write only the parts unique to your problem; the lifecycle, message-loop, and supervisor integration come for free. This is the difference between rolling your own actor and using OTP: OTP is decades of telecom production experience encoded as reusable scaffolding.

### Akka receive partial functions vs typed Behavior API

In Akka classic, an actor's receive is a `PartialFunction[Any, Unit]`. You pattern-match on incoming messages and execute side effects. The "any" is the cost: the compiler cannot help you, and adding a new message type means searching every receive in your codebase.

Akka Typed replaced this with `Behavior[T]`, where `T` is the message type. Each handler receives a `T` and returns the next `Behavior[T]`. Behaviors are values, not methods. You build them with combinators: `Behaviors.receive((ctx, msg) => ...)`, `Behaviors.same`, `Behaviors.stopped`, `Behaviors.setup(ctx => ...)`. State transitions become explicit returns of new behaviors.

The Typed API also formalizes the lifecycle: signals like `PostStop`, `PreRestart`, and `Terminated` are received through a separate signal handler. This makes supervision composable: a behavior can wrap another behavior and add error handling.

### Routing

A single actor processes one message at a time. To get parallelism you need many actors. A router is an actor (or actor-shaped abstraction) that fans incoming messages out across a pool of workers.

- **Round-robin**: each message goes to the next worker in sequence. Simple, fair, good for stateless workloads.
- **Broadcast**: every message goes to every worker. Used for cache invalidation, configuration updates, scatter-gather queries.
- **Consistent hash**: each message has a key; the router hashes the key and routes to the worker responsible for that hash range. Used when each worker owns part of the state, so that messages about the same entity always reach the same worker.
- **Scatter-gather**: send the same query to N workers in parallel, return the first valid response (or aggregate results). Used for redundant queries against replicas.
- **Random**: each message goes to a randomly chosen worker. Cheap and surprisingly effective for uniform workloads.
- **Smallest-mailbox**: route to the worker with the fewest pending messages. Adapts to skew but requires inspecting mailbox sizes.

Routers are themselves actors and follow actor rules: they process one routing decision at a time. For very high throughput you typically use a router pool with multiple routing actors, or use a lock-free routing strategy that does not require a coordinating actor at all.

### Lifecycle hooks

Every actor has a lifecycle: it is created, it processes messages, eventually it stops. Several callbacks expose this lifecycle:

- **preStart** (Akka classic) / `setup` (Akka Typed) / `init/1` (gen_server): runs before the first message. Initialize state, open connections, schedule periodic tasks.
- **postStop**: runs after the actor stops. Close resources, flush state, notify dependencies.
- **preRestart**: runs before a supervisor restarts the actor due to a crash. Defaults to calling postStop on the old instance.
- **postRestart**: runs after the restart, on the new instance. Defaults to calling preStart.
- **terminate/2** (gen_server): runs when the server exits for any reason. Receives the exit reason.

The middle-level mistake is treating these hooks as guaranteed runs. `postStop` runs only if the actor stops cleanly; a node crash skips it. `preRestart` is your last chance to clean up before the new instance takes over; if your initialization assumes a clean slate, do that cleanup here. Treat lifecycle hooks as best-effort, and idempotently re-establish state in startup rather than relying on shutdown for cleanup.

### Common middle mistakes

- **Blocking I/O inside an actor**: if your `handle_call` does a synchronous database query that takes 500 ms, the actor's throughput drops to 2 messages per second. Use async I/O, delegate to a worker pool, or use `Future` and pipe the result back as a message.
- **Unbounded mailbox**: by default many actor systems use unbounded mailboxes. If producers outpace the consumer, the mailbox grows until you run out of memory. Configure bounded mailboxes with a clear overflow policy.
- **Synchronous `ask` with no timeout**: an ask that never completes blocks the awaiter forever. Always specify a timeout, and treat timeouts as real errors, not transient noise.
- **Shared mutable state via closures**: when an actor schedules a callback or spawns a future, the closure captures `this`. Mutating fields from inside the callback breaks the single-threaded actor guarantee. The rule: callbacks must send messages, not mutate state.
- **Forgetting that ask creates a temporary actor**: at high volume, ask is allocation-heavy. Use tell with a reply-to address for hot paths.
- **Leaking children**: if a parent forgets to stop a child, the child lives until the parent itself stops. Periodic cleanup or explicit lifecycle management matters when you create many short-lived children.

---

## Real-World Analogies

| Concept | Analogy |
| --- | --- |
| Become / behavior switching | A receptionist switching from "morning shift" rules to "evening shift" rules without changing seat. |
| Stash | A waiter setting orders aside when the kitchen is busy and re-handing them in once the kitchen is ready. |
| Ask | Sending a registered letter with a return receipt; you cannot move until the receipt arrives. |
| Tell | Dropping a postcard in the mailbox; you walk away immediately. |
| Supervision strategy | A floor manager deciding whether to send one waiter home, all the waiters home, or close the restaurant. |
| One-for-one | Replacing the broken light bulb, leaving the rest alone. |
| One-for-all | Reseating all guests at a table because one chair broke and the table layout depends on chair positions. |
| Hot code reload | Replacing a worker's manual while the worker keeps working, with a clear page-turn point. |
| gen_server | A pre-printed reception desk with slots for "synchronous requests," "asynchronous announcements," and "background news." |
| Consistent-hash routing | A bank lobby where customers with names A-F always go to teller 1, G-L to teller 2, and so on. |

---

## Mental Models

**Behavior as a state in a state machine.** Each `become` is a transition. The handler is the transition function. The actor's identity is the machine; its current behavior is its current state. This frees you from nested `if` chains and lets the type or pattern of the handler describe the state.

**Supervision as containment.** A supervisor is a fence around a failure. Inside the fence the child can crash freely; outside the fence the rest of the system is undisturbed. You do not try to prevent crashes; you contain them.

**Mailbox as a backpressure boundary.** Every mailbox is a buffer between a fast producer and a slow consumer. If you do not bound the buffer, the only feedback the producer gets is "out of memory." If you do bound it, you can apply backpressure: reject, drop, or pause the producer.

**Routing as horizontal parallelism.** One actor is sequential. N actors with a router are concurrent. The router is the cost you pay for parallelism: it must make routing decisions fast enough not to be the bottleneck.

**Lifecycle as a contract.** Startup, shutdown, restart, and supervised restart all give your actor a chance to acquire and release resources. Treating these hooks as a contract means you reason explicitly about what state must exist before and after each phase.

---

## Code Examples

### Example 1: Bank-account actor in Erlang gen_server

```erlang
-module(bank_account).
-behaviour(gen_server).

-export([start_link/1, deposit/2, withdraw/2, balance/1, stop/1]).
-export([init/1, handle_call/3, handle_cast/2, handle_info/2,
         terminate/2, code_change/3]).

-record(state, {id :: binary(), balance :: non_neg_integer()}).

%% Public API

start_link(AccountId) ->
    gen_server:start_link(?MODULE, AccountId, []).

deposit(Pid, Amount) when Amount > 0 ->
    gen_server:cast(Pid, {deposit, Amount}).

withdraw(Pid, Amount) when Amount > 0 ->
    gen_server:call(Pid, {withdraw, Amount}, 5000).

balance(Pid) ->
    gen_server:call(Pid, balance, 5000).

stop(Pid) ->
    gen_server:stop(Pid).

%% Callbacks

init(AccountId) ->
    {ok, #state{id = AccountId, balance = 0}}.

handle_call({withdraw, Amount}, _From, State) ->
    case State#state.balance >= Amount of
        true ->
            NewBalance = State#state.balance - Amount,
            {reply, {ok, NewBalance}, State#state{balance = NewBalance}};
        false ->
            {reply, {error, insufficient_funds}, State}
    end;
handle_call(balance, _From, State) ->
    {reply, {ok, State#state.balance}, State}.

handle_cast({deposit, Amount}, State) ->
    {noreply, State#state{balance = State#state.balance + Amount}}.

handle_info(_Info, State) ->
    {noreply, State}.

terminate(_Reason, _State) ->
    ok.

code_change(_OldVsn, State, _Extra) ->
    {ok, State}.
```

Notice that `deposit` is a `cast` (fire-and-forget) while `withdraw` and `balance` are `call`s (synchronous request-reply with timeout). The actor processes one message at a time, so there is no concurrent mutation of `balance`.

### Example 2: Bank-account actor in Akka Typed (Scala)

```scala
import akka.actor.typed._
import akka.actor.typed.scaladsl._

object BankAccount {
  sealed trait Command
  final case class Deposit(amount: Long) extends Command
  final case class Withdraw(amount: Long, replyTo: ActorRef[WithdrawResult]) extends Command
  final case class GetBalance(replyTo: ActorRef[Long]) extends Command

  sealed trait WithdrawResult
  final case class Ok(newBalance: Long) extends WithdrawResult
  case object InsufficientFunds extends WithdrawResult

  def apply(id: String, initialBalance: Long = 0L): Behavior[Command] =
    Behaviors.setup { ctx =>
      ctx.log.info("Account {} starting", id)
      account(id, initialBalance)
    }

  private def account(id: String, balance: Long): Behavior[Command] =
    Behaviors.receive { (ctx, msg) =>
      msg match {
        case Deposit(amount) if amount > 0 =>
          account(id, balance + amount)

        case Withdraw(amount, replyTo) =>
          if (balance >= amount) {
            replyTo ! Ok(balance - amount)
            account(id, balance - amount)
          } else {
            replyTo ! InsufficientFunds
            Behaviors.same
          }

        case GetBalance(replyTo) =>
          replyTo ! balance
          Behaviors.same

        case _ =>
          Behaviors.unhandled
      }
    }
}
```

The behavior is a value. Every state transition is a returned `Behavior[Command]`. The message type is checked by the compiler, and the `replyTo` field gives us request-reply without `ask`.

### Example 3: Bank-account grain in Orleans (C#)

```csharp
public interface IBankAccountGrain : IGrainWithStringKey
{
    Task DepositAsync(long amount);
    Task<WithdrawResult> WithdrawAsync(long amount);
    Task<long> GetBalanceAsync();
}

public sealed record WithdrawResult(bool Success, long NewBalance, string? Error);

public sealed class BankAccountGrain : Grain, IBankAccountGrain
{
    private readonly IPersistentState<AccountState> _state;

    public BankAccountGrain(
        [PersistentState("account", "accountStore")] IPersistentState<AccountState> state)
    {
        _state = state;
    }

    public async Task DepositAsync(long amount)
    {
        if (amount <= 0) throw new ArgumentOutOfRangeException(nameof(amount));
        _state.State.Balance += amount;
        await _state.WriteStateAsync();
    }

    public async Task<WithdrawResult> WithdrawAsync(long amount)
    {
        if (amount <= 0) throw new ArgumentOutOfRangeException(nameof(amount));
        if (_state.State.Balance < amount)
            return new WithdrawResult(false, _state.State.Balance, "insufficient funds");

        _state.State.Balance -= amount;
        await _state.WriteStateAsync();
        return new WithdrawResult(true, _state.State.Balance, null);
    }

    public Task<long> GetBalanceAsync() => Task.FromResult(_state.State.Balance);

    public sealed class AccountState
    {
        public long Balance { get; set; }
    }
}
```

The grain looks like a normal C# class; Orleans turns each method call into a queued, single-threaded turn. The runtime decides when to activate and deactivate the grain, and the state is persisted automatically.

### Example 4: Supervisor restart on crash (Akka Typed, Scala)

```scala
import akka.actor.typed._
import akka.actor.typed.scaladsl._
import scala.concurrent.duration._

object SupervisedAccount {
  def apply(id: String): Behavior[BankAccount.Command] =
    Behaviors.supervise(BankAccount(id))
      .onFailure[Throwable](
        SupervisorStrategy.restartWithBackoff(
          minBackoff = 100.millis,
          maxBackoff = 5.seconds,
          randomFactor = 0.2
        ).withMaxRestarts(10)
      )
}
```

If `BankAccount` throws, the supervisor restarts it with exponential backoff and gives up after ten restarts. The caller sees nothing except a brief unavailability window during the restart.

### Example 5: Round-robin router across N account workers (Akka Typed, Scala)

```scala
import akka.actor.typed._
import akka.actor.typed.scaladsl._
import akka.actor.typed.scaladsl.Routers

object TransactionDispatcher {
  sealed trait Command
  final case class Process(transactionId: String, accountId: String, amount: Long) extends Command

  def apply(poolSize: Int): Behavior[Command] =
    Behaviors.setup { ctx =>
      val worker = Behaviors.receive[Process] { (innerCtx, msg) =>
        innerCtx.log.info("Worker processing {}", msg.transactionId)
        Behaviors.same
      }
      val pool = Routers.pool(poolSize)(worker).withRoundRobinRouting()
      val router = ctx.spawn(pool, "transaction-router")

      Behaviors.receiveMessage { msg =>
        router ! msg
        Behaviors.same
      }
    }
}
```

The router distributes incoming `Process` messages across `poolSize` worker actors using round-robin. Each worker processes one message at a time; combined, they process `poolSize` messages in parallel.

### Example 6: Become / behavior switching for a connection state machine (Erlang)

```erlang
-module(connection).
-export([start/0, loop/1]).

start() ->
    spawn(?MODULE, loop, [disconnected]).

loop(disconnected) ->
    receive
        {connect, Target} ->
            io:format("Connecting to ~p~n", [Target]),
            loop(connecting);
        Other ->
            io:format("Ignored ~p in disconnected state~n", [Other]),
            loop(disconnected)
    end;
loop(connecting) ->
    receive
        connected ->
            loop(connected);
        {connect_failed, Reason} ->
            io:format("Connect failed: ~p~n", [Reason]),
            loop(disconnected)
    end;
loop(connected) ->
    receive
        {send, Data} ->
            io:format("Sending ~p~n", [Data]),
            loop(connected);
        disconnect ->
            loop(disconnected)
    end.
```

Each state is a clause of `loop/1`. The tail call `loop(NewState)` is Erlang's equivalent of `become`. There is no nested `if`; each state's clause shows exactly which messages are valid and what they cause.

---

## Pros & Cons

**Pros at the middle level.**

- Supervision turns crashes from catastrophes into routine events.
- Behavior switching expresses state machines cleanly without nested conditionals.
- Routers give you horizontal parallelism with minimal coordination.
- Stash lets you defer messages without dropping them.
- OTP behaviours encode decades of production wisdom as reusable scaffolding.
- Typed actors catch a large class of bugs at compile time.
- Hot code reload (in Erlang) keeps systems up across upgrades.

**Cons at the middle level.**

- `Ask` is convenient and dangerous; misuse causes deadlocks and resource leaks.
- Unbounded mailboxes silently mask backpressure problems until OOM.
- Typed actors and hot reload are in tension; pick your tradeoff explicitly.
- Routers add a layer; for some workloads they become the bottleneck.
- Supervisors require thought; the wrong strategy can hide bugs or amplify them.
- Lifecycle hooks are best-effort; you cannot rely on `postStop` for critical cleanup.

---

## Use Cases

- **Financial accounts and ledgers** where each account is an actor and concurrent operations on the same account are serialized for free.
- **IoT gateways** where each device is a long-lived actor that buffers, deduplicates, and forwards.
- **Game servers** where each player or room is an actor and the game tick is just another message.
- **Telecom signaling** where call control is a state machine and reliability matters more than throughput.
- **Workflow engines** where each workflow instance is a stateful actor and supervisors restart failed steps.
- **Trading systems** where each order book is an actor and matching is sequential by definition.

---

## Coding Patterns

**Behavior-per-state.** Define one behavior function per state. Each function pattern-matches only the messages valid in that state. Use `become` (or return the new behavior) to transition. This eliminates nested `if` and makes invalid transitions obvious.

**Reply-to in the message.** Instead of `ask`, include a `replyTo` field in the request and treat the reply as a message. The replying actor sends to `replyTo`; the requester handles the reply as just another message. This avoids futures and integrates with the actor's mailbox.

**Stash on transient state.** If a behavior cannot handle a message because the actor is mid-transition, stash it. On state change, unstash. Bound the stash and treat overflow as a crash.

**Router with consistent hash for per-entity actors.** When work is partitioned by entity (account, user, room), route by consistent hash so messages about the same entity always reach the same actor. This makes the per-entity actor effectively a serializer for that entity.

**Supervisor with backoff.** Restart with exponential backoff to avoid restart storms. Cap the number of restarts and escalate when the cap is hit.

**Lifecycle setup, message handler, signal handler.** In typed APIs, use `setup` for initialization, `receiveMessage` for normal traffic, `receiveSignal` for lifecycle events. Keep them separate and clear.

---

## Clean Code

- Name messages as commands or events: `Deposit`, `Withdrawn`. Avoid generic names like `Msg1`.
- Group all message types into a sealed hierarchy or behaviour-specific module. Make the protocol visible.
- Keep handlers small. If a handler exceeds twenty lines, extract pure helper functions.
- Document each behavior with the messages it accepts and the transitions it can perform.
- Never let an actor's class fields be mutated from outside; the field is the actor's private state.
- Use `Behaviors.same` (or equivalent) liberally; only return a new behavior when the state truly changes.

---

## Best Practices

- Default to `tell`. Reach for `ask` only at the boundary between actor and non-actor code.
- Bound every mailbox. The default unbounded mailbox is a memory leak waiting to happen.
- Use supervision strategies that match the failure semantics. One-for-one for independent children, one-for-all for tightly coupled siblings.
- Restart with backoff; never restart in a tight loop.
- Make actor initialization idempotent. Restarts will happen, and they will run your init again.
- Treat lifecycle hooks as best-effort. Critical cleanup belongs in your persistence layer, not in `postStop`.
- Use routers for parallelism, not for load balancing across slow consumers. If consumers are slow, fix them or add backpressure.
- Use consistent-hash routing whenever work has an entity key; round-robin is for stateless work.

---

## Edge Cases & Pitfalls

- **Restart erases in-memory state.** If your actor caches data, the cache evaporates on restart. Either persist the data or accept the cold start.
- **Stash overflow.** If you stash too much, the actor crashes. Choose a reasonable bound and have the supervisor recover.
- **Ask timeout swallows real errors.** When the target crashes, the ask completes with timeout, not the underlying exception. Use death-watch (Terminated signal) to detect target failure.
- **Self-tell from inside a handler.** Sending a message to yourself is fine, but it goes to the back of the mailbox. If you need ordered processing, do not interleave self-tells with external messages without reasoning about ordering.
- **Scheduler skew.** Routers assume the dispatcher fairly schedules workers. If one worker is starved (CPU-bound, GC pause), the router's load-balancing falls apart.
- **Closure capture in scheduled tasks.** A `scheduler.scheduleOnce(d, () => someField = ...)` captures `this`. The callback runs on a thread that is not the actor's dispatcher; mutating `someField` breaks single-threaded semantics. Always send a message instead.
- **Hot reload mid-message.** During code change, a message in the mailbox might be handled by old code while the next is handled by new code. State migration via `code_change/3` must handle both shapes.
- **Cross-actor transactions.** Single-actor mutations are atomic; multi-actor transactions are not. You need a saga, a coordinator, or persistent journals to coordinate.

---

## Common Mistakes

- Blocking I/O inside a handler, killing throughput.
- Using ask everywhere because it feels familiar, creating futures-on-futures and hard-to-trace failures.
- Forgetting timeouts on ask, leaving callers hanging.
- Unbounded mailboxes that mask producer/consumer mismatch until OOM.
- Storing references to other actors as closures and mutating shared state from callbacks.
- Treating supervisors as exception handlers rather than failure isolators.
- Restarting on every crash with no backoff, causing restart storms.
- Mixing typed and untyped actors without an explicit adapter pattern.
- Putting business logic in the router instead of the workers.
- Forgetting `code_change/3` and breaking hot reload.

---

## Tricky Points

- **`Behaviors.same` versus returning a new behavior.** `same` is an optimization; it tells the runtime nothing changed. Returning a fresh behavior with the same handler causes an unnecessary allocation. Use `same` whenever the behavior truly hasn't changed.
- **`PreRestart` runs on the dying instance.** It is your last chance to clean up the old state. After `PreRestart`, a fresh instance is created and `setup` runs again.
- **Stash is per-behavior, not per-actor.** When you become a new behavior, the stash is still there. You must explicitly unstash; otherwise the messages stay buffered.
- **Routers are actors too.** A naive router with a slow routing decision becomes a bottleneck. Routing strategy matters as much as worker count.
- **Ask creates a temporary actor.** At high QPS, ask is allocation-heavy and lights up the GC. Prefer tell with `replyTo`.
- **Erlang's `gen_server:call` is a synchronous ask under the hood.** The same warnings apply: it blocks the caller and uses a hidden monitor reference.

---

## Test Yourself

1. Why does `become` exist? Couldn't an actor just check its state field in every handler?
2. When should you use `one-for-all` instead of `one-for-one`?
3. What is the difference between Akka Typed `Behaviors.same` and returning a brand-new behavior with the same handler?
4. Why is `ask` discouraged inside an actor?
5. What goes wrong if your mailbox is unbounded and your producer is faster than your consumer?
6. Sketch a state machine for a TCP-like connection using `become` or returned behaviors.
7. Why does Erlang stay untyped at the message level, and what would it lose by adding compile-time type checks?
8. Implement a stash-based actor that buffers messages while waiting for a database lookup.
9. When would you choose consistent-hash routing over round-robin?
10. What is the supervisor strategy for a pool of independent workers, and what is the strategy for a tightly coupled team of workers that share session state?

---

## Tricky Questions

1. You have an actor that crashes intermittently. You change its supervisor to restart it ten times per second. Customers report that data is missing. What likely happened?
2. An ask-from-actor inside a handler hangs forever even though the target is alive. What is the most likely cause?
3. You add a new message variant to a typed actor's protocol. The codebase compiles. Six hours later, production logs show "unhandled message" warnings. Explain.
4. Your router distributes evenly under load testing but unevenly in production. What attributes of the production workload could cause this?
5. You implement `postStop` to flush a write-behind cache. After a node crash you find the cache was not flushed. Why? What should you change?
6. You upgrade an Erlang gen_server with hot reload. The new version expects a new state shape. After upgrade, the server crashes. What did you forget?
7. Two actors send each other `ask` requests inside their handlers. Both hang. Why?
8. You convert an Akka classic actor to Akka Typed and notice throughput dropped. What might be slower?

---

## Cheat Sheet

```
Tell (!)           -> async, fire-and-forget, always prefer
Ask (?)            -> request-reply with future, needs timeout, costs allocation

Behaviors.same     -> keep current behavior, no allocation
Behaviors.stopped  -> stop the actor cleanly
Behaviors.setup    -> initialization block, runs at start and on restart

Supervision:
  one-for-one      -> restart the failed child only
  one-for-all      -> restart all siblings
  rest-for-one     -> restart failed child and later siblings
  escalate         -> bubble up to parent's supervisor

Routing:
  round-robin      -> uniform stateless workloads
  consistent-hash  -> per-entity routing, sticky workers
  broadcast        -> fan-out updates
  scatter-gather   -> parallel queries, aggregate results

Lifecycle:
  preStart / setup -> initialize
  postStop         -> cleanup (best-effort)
  preRestart       -> cleanup on dying instance
  postRestart      -> rebuild on new instance

OTP behaviours:
  gen_server       -> generic server (call/cast/info)
  gen_statem       -> state machine with postpone, timeouts
  gen_event        -> event manager, multiple handlers
  supervisor       -> declarative child specs

Common mistakes:
  - blocking I/O inside actor
  - unbounded mailbox
  - ask without timeout
  - mutating shared state from callbacks
  - restart with no backoff
```

---

## Summary

The middle level of the actor model is where the simple idea of "objects with mailboxes" turns into the practical discipline of building reliable concurrent systems. You stop thinking of an actor as a function and start thinking of it as a process with a lifecycle, a current behavior, a supervised relationship to its parent, and a place inside a routing topology. You learn that `become` is how state machines are expressed; that `stash` is how transient states avoid dropping messages; that `tell` should be your default and `ask` a carefully bounded exception; that supervision strategies are the operational policy that turns crashes into normal events rather than catastrophes.

You also confront the tradeoffs that no junior tutorial spends much time on. Typed actors give you compiler-checked protocols but cost you the dynamism that makes hot reload possible. Routers give you horizontal parallelism but become bottlenecks if you put logic in them. Lifecycle hooks are best-effort and cannot replace proper persistence. Mailboxes that look free become OOM time bombs without explicit bounds.

The path from middle to senior is paved with these tradeoffs becoming explicit. Once you can name the supervision strategy you would use for a given failure mode, justify the routing choice for a given workload, and explain why `ask` is dangerous from inside an actor, you have moved beyond reading about actors and into using them well.

---

## What You Can Build

- A bank-account service with per-account actors, supervised in pools, sharded by consistent hash.
- An IoT ingestion pipeline where each device is an actor and routers dispatch incoming telemetry.
- A chat server where each room is an actor and a router fans out new connections.
- A workflow engine where each workflow instance is a stateful actor with state-per-step behaviors.
- A trading order book where matching is sequential per book and books are sharded across actors.
- A telemetry aggregator that uses gen_event to fan an incoming metric across multiple handlers.
- A game server where each player is an actor and game tick is a broadcast message from a coordinator.

---

## Further Reading

- *Designing for Scalability with Erlang/OTP* by Cesarini and Vinoski.
- *Akka in Action, Second Edition* by Roes, Bakker, Sanders, and Williams.
- The Akka Typed and Pekko Typed documentation.
- The Orleans documentation on grains, persistence, and streams.
- Joe Armstrong's *Making Reliable Distributed Systems in the Presence of Software Errors*.
- The Erlang `gen_statem` user's guide.
- Articles on the let-it-crash philosophy and supervision trees.

---

## Related Topics

- [Actor Model — Junior Level](junior.md): foundational definitions and the simplest examples.
- [Actor Model — Senior Level](senior.md): distributed actors, sharding, persistence, and cluster failure modes.
- Concurrency Models: CSP, Software Transactional Memory, dataflow, async/await.
- Supervision trees and the "let it crash" philosophy.
- Event sourcing and CQRS, which pair naturally with actor-based persistence.
- Backpressure and bounded mailboxes.
- Finite state machines as a design technique.

---

## Diagrams & Visual Aids

**Behavior switching as a state machine:**

```
   [Disconnected] --connect--> [Connecting] --connected--> [Connected]
        ^                            |                          |
        |                            |                          |
        +---------connect_failed-----+                          |
        |                                                       |
        +-----------------disconnect----------------------------+
```

**Supervision tree:**

```
                 [SystemSupervisor]
                  /              \
        [AccountSupervisor]   [RouterSupervisor]
          /     |     \              |
   [Acct A] [Acct B] [Acct C]   [Router]
                                    |
                          [W1] [W2] [W3] [W4]
```

**Router fan-out:**

```
  Producer --> [Router] --round-robin--> [Worker 1]
                  |                       [Worker 2]
                  +---------------------> [Worker 3]
                                          [Worker 4]
```

**Ask pattern (sequence):**

```
  Caller            TempActor          Target
    |                  |                  |
    |--ask(req)------->|                  |
    |                  |--tell(req)------>|
    |                  |                  |
    |                  |<--tell(reply)----|
    |<--future done----|                  |
                       (TempActor stops)
```

**Lifecycle:**

```
  setup -> handler -> handler -> ... -> stop -> postStop
                          |
                       crash
                          |
                      preRestart
                          |
                       (new instance)
                          |
                       setup -> handler -> ...
```

**Mailbox with bounded capacity:**

```
  Producers --> [   |   |   |   |   |   ] --> Actor
                 ^^^                  ^^^
                 head                 tail
                 (oldest)            (newest)
            full -> reject / drop / backpressure
```

These diagrams are intentionally simple. The point is to internalize the shapes: a state machine, a tree, a fan-out, a request-reply with a temporary, a lifecycle with optional restart, a bounded queue with overflow behavior. Once these shapes are second nature, the middle-level material becomes a vocabulary rather than a checklist, and the senior material starts to make sense.
