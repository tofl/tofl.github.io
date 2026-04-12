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

{{< qcm >}}
[
{
"question": "A developer is building an order processing workflow using AWS Step Functions. The workflow must ensure that each step is executed exactly once, maintain a full audit trail, and support executions lasting up to several days. Which workflow type should the developer choose?",
"answers": [
{
"answer": "Standard Workflow",
"isCorrect": true,
"explanation": "Standard Workflows provide exactly-once execution semantics, store full execution history in the console, and support durations of up to 1 year — making them ideal for long-running, auditable business processes like order processing."
},
{
"answer": "Express Workflow",
"isCorrect": false,
"explanation": "Express Workflows have at-least-once semantics (not exactly-once), are limited to 5 minutes, and store history in CloudWatch Logs only. They are designed for high-volume, short-duration event processing, not long-running auditable workflows."
}
]
},
{
"question": "A Step Functions state machine processes a large JSON document. A developer wants a specific Task state to only receive the 'customer' field from the input, rather than the entire document. Which ASL field should the developer configure?",
"answers": [
{
"answer": "InputPath",
"isCorrect": true,
"explanation": "InputPath accepts a JSONPath expression (e.g., $.customer) that selects which portion of the state's input is forwarded to the Task resource, allowing you to pass only a subset of the incoming JSON."
},
{
"answer": "OutputPath",
"isCorrect": false,
"explanation": "OutputPath filters the combined document (input + result) before passing it to the *next* state, not before sending data to the Task resource."
},
{
"answer": "ResultPath",
"isCorrect": false,
"explanation": "ResultPath controls where the Task's *result* is placed in the state's input JSON. It does not filter what is sent to the Task."
},
{
"answer": "Parameters",
"isCorrect": false,
"explanation": "Parameters lets you construct a new JSON object to pass to the Task, which is more powerful than InputPath but serves a different purpose — reshaping or enriching the input rather than simply selecting a sub-path."
}
]
},
{
"question": "A workflow's Task state invokes a Lambda function. The developer wants to retain the original state input while also storing the Lambda result under the key 'lambdaOutput' for downstream states. Which ASL field achieves this?",
"answers": [
{
"answer": "ResultPath set to $.lambdaOutput",
"isCorrect": true,
"explanation": "ResultPath specifies where in the current input document the Task result should be placed. Setting it to $.lambdaOutput attaches the result at that key while preserving all other fields in the original input."
},
{
"answer": "OutputPath set to $.lambdaOutput",
"isCorrect": false,
"explanation": "OutputPath filters the combined document before passing it to the next state. It selects a subset to forward, but does not control where the Task result is stored within the document."
},
{
"answer": "InputPath set to $.lambdaOutput",
"isCorrect": false,
"explanation": "InputPath selects which part of the input is sent to the Task resource. It has no effect on where the Task result is stored."
},
{
"answer": "ResultPath set to null",
"isCorrect": false,
"explanation": "Setting ResultPath to null discards the Task result entirely and passes the original input unchanged to the next state — the result is not stored anywhere."
}
]
},
{
"question": "A developer is designing a Step Functions workflow that calls a third-party payment provider. The payment provider processes requests asynchronously and will call back a webhook when the payment is complete, which could take minutes or hours. Which Task integration pattern should the developer use?",
"answers": [
{
"answer": ".waitForTaskToken",
"isCorrect": true,
"explanation": ".waitForTaskToken pauses the execution indefinitely and provides a unique token to the called service. The workflow only resumes when SendTaskSuccess or SendTaskFailure is called with that token — perfect for external callbacks with unpredictable wait times."
},
{
"answer": "RequestResponse",
"isCorrect": false,
"explanation": "RequestResponse moves on immediately after the API call returns, without waiting for the underlying work to complete. It cannot wait for an asynchronous callback from an external system."
},
{
"answer": ".sync",
"isCorrect": false,
"explanation": ".sync polls an AWS service job in the background until it completes. It works for AWS-managed jobs (e.g., ECS tasks, Glue jobs), not for external third-party callbacks."
}
]
},
{
"question": "Which of the following Step Functions state types can be used to run multiple independent branches simultaneously and wait for all of them to finish before continuing? (Select TWO)",
"answers": [
{
"answer": "Parallel",
"isCorrect": true,
"explanation": "The Parallel state runs multiple branches simultaneously, each being its own mini state machine, and waits for all branches to complete before transitioning to the next state."
},
{
"answer": "Map",
"isCorrect": true,
"explanation": "The Map state iterates over an array and runs the same set of states for each element in parallel, effectively processing multiple items simultaneously before proceeding."
},
{
"answer": "Choice",
"isCorrect": false,
"explanation": "The Choice state branches the workflow conditionally (like an if/else), but only one branch is taken — it does not run multiple branches in parallel."
},
{
"answer": "Task",
"isCorrect": false,
"explanation": "A Task state performs a single unit of work by calling one AWS service or resource. It does not manage concurrent branches."
},
{
"answer": "Wait",
"isCorrect": false,
"explanation": "The Wait state simply pauses execution for a fixed duration or until a timestamp. It has no concept of parallel execution."
}
]
},
{
"question": "A developer configures the following error handling on a Task state. The Lambda function throws a 'Lambda.TooManyRequestsException'. What happens after all retries are exhausted?",
"answers": [
{
"answer": "The execution transitions to the 'NotifyFailure' state, with error details injected at $.error in the input",
"isCorrect": true,
"explanation": "The Catch block with 'States.ALL' catches any error after retries are exhausted. The ResultPath of $.error injects the error details into the input at that key, and the Next field transitions the execution to 'NotifyFailure'."
},
{
"answer": "The execution immediately fails without transitioning to any state",
"isCorrect": false,
"explanation": "With a Catch block configured, Step Functions does not simply fail — it transitions to the designated fallback state after retries are exhausted."
},
{
"answer": "The execution retries indefinitely until success",
"isCorrect": false,
"explanation": "Retries are bounded by MaxAttempts. Once exhausted, Step Functions stops retrying and evaluates the Catch blocks."
},
{
"answer": "The execution transitions to 'NotifyFailure' but the error details are discarded",
"isCorrect": false,
"explanation": "The ResultPath of $.error ensures error details are preserved and injected into the input passed to the 'NotifyFailure' state — they are not discarded."
}
]
},
{
"question": "A developer wants to use Step Functions to write an item directly to a DynamoDB table as a step in a workflow, without invoking a Lambda function. Which Step Functions feature enables this?",
"answers": [
{
"answer": "SDK service integrations (direct integrations)",
"isCorrect": true,
"explanation": "Step Functions supports direct SDK integrations that allow Task states to call AWS services like DynamoDB, SNS, SQS, and others natively, eliminating the need for Lambda wrapper functions."
},
{
"answer": "Pass state with a DynamoDB payload",
"isCorrect": false,
"explanation": "The Pass state only passes or transforms JSON data within the state machine — it cannot make calls to external AWS services."
},
{
"answer": ".waitForTaskToken integration with DynamoDB Streams",
"isCorrect": false,
"explanation": ".waitForTaskToken is an integration pattern for waiting on callbacks, not a mechanism for directly writing to DynamoDB as a workflow step."
},
{
"answer": "Map state targeting DynamoDB",
"isCorrect": false,
"explanation": "The Map state iterates over arrays and runs states for each element — it is not itself a mechanism for calling DynamoDB. A Task state with DynamoDB integration inside a Map could work, but the Map state alone does not enable this."
}
]
},
{
"question": "An Express Workflow in Step Functions is processing millions of IoT sensor events daily. A developer notices that some Task states appear to execute more than once for the same event. Why can this happen, and what is the recommended mitigation?",
"answers": [
{
"answer": "Express Workflows have at-least-once execution semantics; Task states must be idempotent to handle duplicate executions safely",
"isCorrect": true,
"explanation": "Unlike Standard Workflows (exactly-once), Express Workflows guarantee at-least-once semantics. Duplicate executions of Task states are possible, so tasks must be designed to be idempotent — producing the same result even when called multiple times with the same input."
},
{
"answer": "This is a bug in the state machine definition; using .sync integration would prevent duplicate executions",
"isCorrect": false,
"explanation": "Duplicate executions are an inherent characteristic of Express Workflows, not a bug. Switching to .sync does not change the workflow's at-least-once semantics."
},
{
"answer": "Express Workflows should not be used for high-volume event processing",
"isCorrect": false,
"explanation": "High-volume, short-duration event processing is exactly the intended use case for Express Workflows. The at-least-once behavior is a known trade-off that must be handled through idempotent design."
},
{
"answer": "Enabling execution history in CloudWatch Logs will prevent duplicate state executions",
"isCorrect": false,
"explanation": "CloudWatch Logs provide observability for Express Workflows but have no effect on execution semantics. Logging does not prevent at-least-once behavior."
}
]
},
{
"question": "In Amazon States Language, what is the correct order in which Step Functions applies input/output processing fields for a Task state?",
"answers": [
{
"answer": "InputPath → Parameters → (Task executes) → ResultPath → OutputPath",
"isCorrect": true,
"explanation": "This is the precise processing pipeline defined by Step Functions. InputPath selects the relevant input slice, Parameters reshapes it, the Task runs with that data, ResultPath places the result in the document, and OutputPath filters the final payload before forwarding it."
},
{
"answer": "Parameters → InputPath → (Task executes) → OutputPath → ResultPath",
"isCorrect": false,
"explanation": "This order is incorrect. InputPath is applied before Parameters, and ResultPath is applied before OutputPath."
},
{
"answer": "InputPath → (Task executes) → Parameters → ResultPath → OutputPath",
"isCorrect": false,
"explanation": "Parameters is applied before the Task executes (it shapes the input sent to the Task), not after."
},
{
"answer": "InputPath → Parameters → (Task executes) → OutputPath → ResultPath",
"isCorrect": false,
"explanation": "ResultPath is applied before OutputPath. ResultPath places the Task result into the document first, then OutputPath filters the combined document."
}
]
},
{
"question": "A developer needs to implement a human approval step in a Step Functions workflow. When the workflow reaches the approval step, it should pause and wait until a manager approves or rejects the request via an internal tool. Which integration pattern and state type should be used?",
"answers": [
{
"answer": "Task state with .waitForTaskToken integration",
"isCorrect": true,
"explanation": ".waitForTaskToken pauses the execution indefinitely and provides a unique token. The internal approval tool calls SendTaskSuccess or SendTaskFailure with the token when the manager acts, resuming the workflow."
},
{
"answer": "Wait state with a fixed duration",
"isCorrect": false,
"explanation": "A Wait state pauses for a predetermined amount of time or until a timestamp — it cannot pause and resume based on an external human action."
},
{
"answer": "Task state with .sync integration",
"isCorrect": false,
"explanation": ".sync polls an AWS-managed job for completion. It cannot pause execution waiting for a human to perform an action in an external tool."
},
{
"answer": "Choice state evaluating an approval flag in DynamoDB",
"isCorrect": false,
"explanation": "A Choice state evaluates conditions on the current input at a single point in time — it does not pause execution and wait for an external event to occur."
}
]
},
{
"question": "A developer is configuring retry logic on a Task state. They want retries to start with a 2-second wait, double the wait after each attempt, and add randomness to avoid many concurrent executions retrying at the same moment. Which combination of Retry fields achieves this?",
"answers": [
{
"answer": "IntervalSeconds: 2, BackoffRate: 2.0, JitterStrategy: FULL",
"isCorrect": true,
"explanation": "IntervalSeconds sets the initial wait, BackoffRate of 2.0 doubles the interval after each attempt (exponential backoff), and JitterStrategy: FULL adds randomized jitter to prevent the thundering herd problem when many executions retry simultaneously."
},
{
"answer": "IntervalSeconds: 2, MaxAttempts: 3",
"isCorrect": false,
"explanation": "This configuration sets an initial wait and limits retries but applies no backoff multiplier and no jitter — retries would always wait exactly 2 seconds, and concurrent retries would still fire simultaneously."
},
{
"answer": "BackoffRate: 2.0, JitterStrategy: FULL (no IntervalSeconds)",
"isCorrect": false,
"explanation": "Without IntervalSeconds, the initial delay defaults to 1 second, which may not match the requirement. All three fields should be specified explicitly."
},
{
"answer": "IntervalSeconds: 2, BackoffRate: 1.0, JitterStrategy: FULL",
"isCorrect": false,
"explanation": "A BackoffRate of 1.0 means no increase in the wait interval between retries (the interval stays flat at 2 seconds). Exponential backoff requires a BackoffRate greater than 1.0."
}
]
},
{
"question": "Which Step Functions state type has NO 'Next' field of its own, and instead defines the next state within each individual branch rule?",
"answers": [
{
"answer": "Choice",
"isCorrect": true,
"explanation": "The Choice state evaluates conditions on the input and branches accordingly. It has no top-level Next field; instead, each branch rule (condition) specifies its own Next state."
},
{
"answer": "Parallel",
"isCorrect": false,
"explanation": "The Parallel state does have a Next field that specifies where execution continues after all branches complete."
},
{
"answer": "Map",
"isCorrect": false,
"explanation": "The Map state has a Next field that specifies where execution continues after all iterations complete."
},
{
"answer": "Task",
"isCorrect": false,
"explanation": "Task states have a Next field (or End: true) specifying the next state after the Task completes successfully."
}
]
},
{
"question": "A developer wants to launch an AWS Glue ETL job from a Step Functions Task state and have the workflow pause until the Glue job finishes before proceeding. Which integration suffix should be used in the resource ARN?",
"answers": [
{
"answer": ".sync",
"isCorrect": true,
"explanation": ".sync causes Step Functions to call the service, then poll in the background until the job completes. It is designed for longer-running AWS services like Glue jobs, ECS tasks, and SageMaker training jobs."
},
{
"answer": ".waitForTaskToken",
"isCorrect": false,
"explanation": ".waitForTaskToken is used when an external system or human must explicitly call back with a task token. Glue jobs can be waited on using the native .sync polling integration instead."
},
{
"answer": "RequestResponse (default, no suffix)",
"isCorrect": false,
"explanation": "RequestResponse returns as soon as the API call succeeds (i.e., the job is started), without waiting for the Glue job itself to finish. The workflow would immediately proceed to the next state."
}
]
},
{
"question": "A Step Functions workflow uses a Catch block with 'ResultPath': '$.error'. What is the effect of this configuration when a Task fails and the Catch block is triggered?",
"answers": [
{
"answer": "The error details are injected into the original input at the key 'error', and this combined document is passed to the fallback state",
"isCorrect": true,
"explanation": "ResultPath in a Catch block controls where error information is placed in the state's input before forwarding to the Next (fallback) state. '$.error' adds the error object at the 'error' key while preserving the rest of the input, so the fallback state has full context about what went wrong."
},
{
"answer": "The original input is discarded and only the error details are passed to the fallback state",
"isCorrect": false,
"explanation": "ResultPath merges the error into the existing input — it does not discard the original input. To discard everything except the error, you would need to combine ResultPath and OutputPath."
},
{
"answer": "The error details are logged to CloudWatch and the original input is passed unchanged",
"isCorrect": false,
"explanation": "ResultPath does not route data to CloudWatch. It places the error into the JSON document passed to the fallback state."
},
{
"answer": "The execution retries from the beginning of the state machine with error details in $.error",
"isCorrect": false,
"explanation": "Catch transitions to a specific fallback state (Next), not back to the start of the state machine."
}
]
},
{
"question": "Which of the following are valid terminal states in AWS Step Functions? (Select TWO)",
"answers": [
{
"answer": "Succeed",
"isCorrect": true,
"explanation": "Succeed is a terminal state that ends the execution successfully. No further transitions occur after a Succeed state."
},
{
"answer": "Fail",
"isCorrect": true,
"explanation": "Fail is a terminal state that ends the execution with an error and cause string, used to signal unrecoverable conditions."
},
{
"answer": "Pass",
"isCorrect": false,
"explanation": "Pass is not a terminal state — it forwards (and optionally transforms) its input to the next state and always has a Next field."
},
{
"answer": "Choice",
"isCorrect": false,
"explanation": "Choice is not a terminal state — it evaluates conditions and transitions to one of the defined branches."
},
{
"answer": "Wait",
"isCorrect": false,
"explanation": "Wait is not a terminal state — after the pause duration elapses, execution continues to the next state."
}
]
},
{
"question": "A developer needs to process each record in an array contained in the Step Functions input, applying the same transformation logic to every element. Which state type is best suited for this requirement?",
"answers": [
{
"answer": "Map",
"isCorrect": true,
"explanation": "The Map state iterates over an array in the input and runs the same set of states for each element, in parallel — equivalent to a distributed forEach. It is specifically designed for this pattern."
},
{
"answer": "Parallel",
"isCorrect": false,
"explanation": "Parallel runs a fixed set of pre-defined branches simultaneously. It cannot dynamically iterate over an array of variable length."
},
{
"answer": "Task with a Lambda function that loops internally",
"isCorrect": false,
"explanation": "While technically possible, embedding iteration logic inside Lambda re-introduces tight coupling and loses Step Functions' native parallelism, error handling, and audit trail for individual items."
},
{
"answer": "Choice with multiple branches",
"isCorrect": false,
"explanation": "Choice branches conditionally based on the current input value — it cannot iterate over an array."
}
]
},
{
"question": "What is the primary purpose of the 'Parameters' field in a Step Functions Task state, and how does it differ from 'InputPath'?",
"answers": [
{
"answer": "Parameters constructs a new JSON object (mixing literals and JSONPath references) to send to the Task, while InputPath simply selects a sub-path of the existing input",
"isCorrect": true,
"explanation": "InputPath is a single JSONPath expression that selects a portion of the input to forward as-is. Parameters is more powerful — it lets you build an entirely new JSON shape, injecting constants and referencing values from the input using the .$ suffix on field names."
},
{
"answer": "Parameters and InputPath are functionally identical; either can be used interchangeably",
"isCorrect": false,
"explanation": "They serve different purposes. InputPath selects a subset of the input, while Parameters lets you reshape and construct a new JSON object, which is more flexible."
},
{
"answer": "Parameters filters the Task result, while InputPath filters what is sent to the Task",
"isCorrect": false,
"explanation": "Parameters shapes the input sent to the Task (like InputPath), not the Task result. ResultPath and OutputPath deal with the Task result."
},
{
"answer": "InputPath constructs a new JSON object, while Parameters selects a sub-path",
"isCorrect": false,
"explanation": "This is reversed. InputPath selects a sub-path; Parameters constructs a new object."
}
]
},
{
"question": "A developer wants to start a child Step Functions state machine execution as a step within a parent workflow. Which Step Functions feature enables this pattern?",
"answers": [
{
"answer": "Step Functions service integration — a Task state can invoke another state machine",
"isCorrect": true,
"explanation": "Step Functions supports direct integration with itself, allowing a Task state in a parent workflow to start a child state machine execution. This enables nested and modular workflow composition."
},
{
"answer": "Parallel state with a nested state machine definition inline",
"isCorrect": false,
"explanation": "A Parallel state defines branches inline within the same state machine definition — it cannot reference and invoke a separately defined state machine."
},
{
"answer": "This is not supported; a Lambda function must be used to trigger the child state machine via the AWS SDK",
"isCorrect": false,
"explanation": "Step Functions natively supports invoking another state machine directly through its service integration, without needing a Lambda function as an intermediary."
},
{
"answer": "Wait state that polls until the child execution completes",
"isCorrect": false,
"explanation": "A Wait state pauses for a duration or timestamp — it cannot start or monitor another state machine execution."
}
]
}
]
{{< /qcm >}}