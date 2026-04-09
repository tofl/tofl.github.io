---
title: "16. Step Functions"
type: docs
weight: 6
---

## Step Functions

Modern applications rarely do just one thing — they chain together multiple operations: validate input, write to a database, call an external API, send a notification, and handle failures at each step. The naive approach is to wire these steps together inside Lambda functions, where one function calls another and so on. This creates tightly coupled, fragile chains that are hard to debug, retry, or modify. AWS Step Functions solves this by letting you define your workflow as a **state machine** — a visual, auditable graph of steps and transitions that AWS manages for you. You describe *what* should happen and *in what order*; Step Functions handles the execution, retries, error handling, and state passing between steps. [🔗](https://docs.aws.amazon.com/step-functions/latest/dg/welcome.html)

### State Machine Concepts

A Step Functions workflow is called a **state machine**. When you start an execution, you provide an initial JSON input. That input travels through a series of **states** — each state does some work (or makes a decision, or waits) and then transitions to the next state. Each state can read from the current input, transform it, add results to it, and pass a modified version to the next state.

- **States** are the individual steps in your workflow. Each state has a `Type` and transitions to another state or ends the execution.
- **Transitions** define which state comes next. They can be unconditional ("always go to ProcessOrder") or conditional ("if payment failed, go to NotifyFailure").
- **Input/output** flows as JSON throughout the execution. Step Functions gives you precise control over what slice of JSON each state sees and what it passes forward — covered in detail below.

Every execution has an **execution history** stored automatically — a full audit trail of every state entered, every input/output, every retry, and every error. This is one of the most practically valuable features for debugging. [🔗](https://docs.aws.amazon.com/step-functions/latest/dg/concepts-amazon-states-language.html)

### State Types

Step Functions expresses workflows in the **Amazon States Language (ASL)**, a JSON-based definition format. [🔗](https://docs.aws.amazon.com/step-functions/latest/dg/concepts-amazon-states-language.html) There are seven state types, each serving a distinct purpose:

- **Task** — Does actual work by calling an AWS service or resource (a Lambda function, an ECS task, a DynamoDB operation, etc.). This is the workhorse state.
- **Choice** — Branches the workflow based on conditions evaluated against the current input. Equivalent to an if/else or switch statement. Has no `Next` field itself; each branch rule specifies its own `Next`.
- **Wait** — Pauses execution for a fixed duration or until a specific timestamp. Useful for scheduled retries or rate-limiting outbound API calls.
- **Parallel** — Runs multiple branches simultaneously and waits for all of them to complete before proceeding. Each branch is its own mini state machine.
- **Map** — Iterates over an array in the input and runs the same set of states for each element, in parallel. Think of it as a distributed `forEach`.
- **Pass** — Passes its input to its output, optionally injecting fixed data. Useful for reshaping JSON or injecting constants during development and testing.
- **Succeed / Fail** — Terminal states. `Succeed` ends the execution successfully. `Fail` ends it with an error and cause string, useful for explicitly signaling unrecoverable conditions.

### Standard vs Express Workflows

Step Functions offers two workflow types with meaningfully different trade-offs:

| | Standard | Express |
|---|---|---|
| Max duration | 1 year | 5 minutes |
| Execution semantics | **Exactly-once** | **At-least-once** |
| Pricing | Per state transition | Per execution duration + requests |
| Execution history | Full history in console | CloudWatch Logs only |
| Use case | Long-running, auditable business workflows | High-volume, short-duration event processing |

Standard workflows guarantee that each state is executed exactly once. They're suited for order processing, approval flows, and anything where idempotency per-step matters and you need a full audit trail.

Express workflows are optimized for high throughput and low cost at scale — think processing millions of IoT events or streaming records — but they have at-least-once semantics, so your Task states must be idempotent. [🔗](https://docs.aws.amazon.com/step-functions/latest/dg/concepts-standard-vs-express.html)

### Task Integration Patterns

When a Task state calls an external service, Step Functions supports three integration patterns that control how it waits for the result: [🔗](https://docs.aws.amazon.com/step-functions/latest/dg/concepts-service-integrations.html)

- **RequestResponse** (default) — Step Functions calls the service and immediately moves on once the API call returns a response. It does *not* wait for the underlying work to complete. Use this when the called service is fast and synchronous, or when you don't need to wait for its result.
- **.sync** (optimistic synchronization) — Step Functions calls the service and then *waits* for the job to complete, polling in the background. This is used for longer-running services like ECS tasks, Glue jobs, or SageMaker training jobs where the API call starts the work but the work itself takes time. The integration suffix in ASL is `arn:aws:states:::ecs:runTask.sync`.
- **.waitForTaskToken** — Step Functions pauses the execution indefinitely and hands a unique **task token** to the called service. Execution only resumes when something (a human, an external system, a callback) calls `SendTaskSuccess` or `SendTaskFailure` with that token. This is the pattern for human-approval workflows, third-party API callbacks, or any interaction that has an unpredictable wait time.

### Error Handling: Retry and Catch

Step Functions has first-class support for error handling built into Task, Map, and Parallel states, so you don't need to write retry logic inside your Lambda functions.

**Retry** allows you to automatically retry a state when it throws a specific error. You configure:
- `ErrorEquals` — which error names trigger this retry rule (e.g., `Lambda.ServiceException`, `States.TaskFailed`, or custom errors your Lambda raises)
- `MaxAttempts` — how many times to retry (default 3)
- `IntervalSeconds` — initial wait before the first retry
- `BackoffRate` — multiplier applied to the interval after each attempt (e.g., `2.0` for exponential backoff)
- `JitterStrategy` — set to `FULL` to add randomized jitter, preventing thundering herd when many executions retry simultaneously

**Catch** defines a fallback state to transition to if all retries are exhausted or if the error doesn't match any Retry rule. Each Catch block specifies `ErrorEquals` and a `Next` state, and can use `ResultPath` to inject the error details into the input before passing it to the fallback state — so your error-handling state knows exactly what went wrong.

```json
"Retry": [
  {
    "ErrorEquals": ["Lambda.ServiceException", "Lambda.TooManyRequestsException"],
    "IntervalSeconds": 2,
    "MaxAttempts": 3,
    "BackoffRate": 2.0,
    "JitterStrategy": "FULL"
  }
],
"Catch": [
  {
    "ErrorEquals": ["States.ALL"],
    "Next": "NotifyFailure",
    "ResultPath": "$.error"
  }
]
```

[🔗](https://docs.aws.amazon.com/step-functions/latest/dg/concepts-error-handling.html)

### Input/Output Processing

As JSON passes through your state machine, you frequently need to extract only the relevant part, prevent a Task's result from overwriting the entire input, or combine the result with existing data. Step Functions gives you four ASL fields to control this precisely: [🔗](https://docs.aws.amazon.com/step-functions/latest/dg/concepts-input-output-filtering.html)

- **InputPath** — A JSONPath expression that selects which portion of the state's input is sent to the Task resource. `$.order` would send only the `order` field to your Lambda, not the whole document.
- **Parameters** — Lets you construct a new JSON object (potentially mixing literal values with JSONPath references) to pass to the Task. More powerful than InputPath when you need to reshape the input or inject constants. Use `.$` suffix on field names to indicate a JSONPath value.
- **ResultPath** — Controls where the Task's result is placed in the state's input JSON. Set to `$.taskResult` to attach the result at that key while preserving the original input. Set to `null` to discard the result entirely. Without this, the Task's output *replaces* the entire input.
- **OutputPath** — A JSONPath filter applied to the combined document (input + result via ResultPath) before passing it to the next state. Lets you trim down the payload to only what subsequent states need.

The processing order is: `InputPath` → `Parameters` → *(Task executes)* → `ResultPath` → `OutputPath`. Understanding this pipeline is essential for the DVA-C02 exam, as questions frequently test whether you can predict what JSON reaches a given state.

### Service Integrations

Step Functions can directly call a wide range of AWS services without needing a Lambda function as a middleman — these are called **optimistic service integrations** or **SDK integrations**. [🔗](https://docs.aws.amazon.com/step-functions/latest/dg/concepts-service-integrations.html)

Common integrations relevant to DVA-C02:

- **Lambda** — Invoke a function synchronously or asynchronously. The most common Task type.
- **DynamoDB** — Put, get, update, or delete items directly. Eliminates the need for a Lambda wrapper just to write to a table.
- **SNS / SQS** — Publish a message or send to a queue as a step in the workflow. Useful for fan-out at a specific point in a process.
- **ECS (RunTask)** — Launch a containerized task and wait for it to complete with `.sync`.
- **API Gateway** — Call an HTTP endpoint directly, enabling integration with external services or internal microservices.
- **Step Functions** — Start a child state machine execution, enabling nested or modular workflow composition.

Using direct SDK integrations rather than Lambda wrappers reduces latency, cost, and operational complexity — and is a pattern AWS actively encourages.