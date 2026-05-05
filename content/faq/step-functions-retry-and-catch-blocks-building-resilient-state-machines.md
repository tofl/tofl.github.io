---
title: "Step Functions Retry and Catch Blocks: Building Resilient State Machines"
---

## Step Functions Retry and Catch Blocks: Building Resilient State Machines

Distributed systems are inherently unpredictable. A Lambda function might timeout, an API call could fail temporarily, or a database might experience a brief outage. When you're orchestrating complex workflows across multiple AWS services using Step Functions, you need a robust strategy for handling these inevitable failures. Unlike simple queue-based architectures where dead-letter queues (DLQs) provide a safety net, Step Functions state machines require you to build resilience directly into the workflow definition itself through retry and catch blocks.

This approach is more powerful than it might initially seem. Rather than simply parking failed messages in a queue, you gain fine-grained control over how your workflow responds to specific error conditions, how many times it should retry, and where execution should be rerouted when recovery isn't possible. Understanding how to use the Retry and Catch fields effectively is essential for building production-grade workflows that fail gracefully rather than catastrophically.

### Understanding the Resilience Challenge in Orchestrated Workflows

Before diving into the mechanics of retry and catch blocks, let's establish why they matter. Imagine you've built a Step Functions state machine that processes orders. The workflow calls Lambda to validate the order, then invokes an external API to check inventory, then processes payment through another service, and finally sends a confirmation email. If the API call to check inventory times out occasionally due to network latency, should the entire workflow fail? Probably not. Should you retry immediately? Probably not—a brief pause might allow the service to recover.

This is where retry policies come in. Similarly, if the payment processing service is temporarily unavailable, you might want to route the workflow to a fallback state that attempts a different payment method or notifies a human rather than simply failing. That's what catch blocks enable.

The key insight is that Step Functions treats error handling as first-class workflow logic. You declare your resilience strategy upfront in the state machine definition, making it transparent, auditable, and testable.

### The Retry Field: Automatic Recovery with Exponential Backoff

The Retry field tells a state to automatically re-execute itself if it fails with a matching error. Rather than immediately bubbling the error up to the workflow level, Step Functions will pause, then try again. You can control exactly how many times it retries, how long it waits between attempts, and how aggressively that wait time increases.

A basic retry block looks deceptively simple:

```json
{
  "Type": "Task",
  "Resource": "arn:aws:lambda:us-east-1:123456789012:function:ProcessPayment",
  "Retry": [
    {
      "ErrorEquals": ["States.TaskFailed"],
      "MaxAttempts": 2,
      "BackoffRate": 2.0,
      "IntervalSeconds": 1
    }
  ],
  "End": true
}
```

Let's unpack what happens here. If the Lambda function returns an error matching `States.TaskFailed`, the state machine will automatically retry the task. The first attempt fails, then it waits 1 second. The second attempt fails, it waits 2 seconds (1 × 2.0). A third attempt occurs after that wait. If it fails again, since `MaxAttempts` is set to 2 (meaning 2 retries after the initial attempt, for 3 total attempts), the error propagates upward.

#### ErrorEquals: Matching the Right Errors

The `ErrorEquals` field is essentially a pattern matcher. It specifies which errors should trigger the retry. Step Functions provides several predefined error names:

**States.ALL** matches any error that occurs in the state. This is a catch-all that you should use sparingly, typically only as a last resort, because it will retry on every conceivable error including those you might not expect.

**States.TaskFailed** matches any error thrown by a Lambda function or other task that's not a timeout or state machine internal error. This is the most common choice for handling application-level failures.

**States.Timeout** specifically matches timeout errors—cases where a task didn't complete within its timeout window. This is crucial because you might want different retry behavior for timeouts versus other failures.

Beyond these predefined names, you can specify custom error names. If your Lambda function explicitly throws an error with a specific code—say, `InsufficientFunds`—you can match that exact error:

```json
{
  "ErrorEquals": ["InsufficientFunds", "ServiceUnavailable"]
}
```

This approach lets you apply different retry strategies to different types of failures. You might aggressively retry on `ServiceUnavailable` but only attempt once on `InsufficientFunds` since retrying won't fix an account that legitimately lacks funds.

#### BackoffRate and IntervalSeconds: Controlling the Timing

When a retry occurs, Step Functions waits before attempting again. The `IntervalSeconds` parameter sets the initial wait time. The `BackoffRate` then multiplies that interval for each subsequent retry, creating an exponential backoff pattern.

With `IntervalSeconds: 1` and `BackoffRate: 2.0`, the waits would be: 1 second, 2 seconds, 4 seconds, 8 seconds, and so on. Exponential backoff is crucial in distributed systems because it prevents the thundering herd problem—if a service is overloaded and causing failures, hammering it with immediate retries only makes things worse. By backing off exponentially, you give the service time to recover.

However, exponential backoff can grow unboundedly. After ten retries with a backoff rate of 2, you'd be waiting over 15 minutes before the next attempt. That's where `MaxDelaySeconds` comes in.

#### MaxDelaySeconds and MaxAttempts: Setting Boundaries

`MaxAttempts` specifies the total number of retry attempts (not including the initial attempt). If you set `MaxAttempts: 3`, Step Functions will make the initial attempt, then up to 3 more attempts, for a maximum of 4 total attempts.

`MaxDelaySeconds` caps the wait interval between retries. If your backoff calculation would result in a 30-second wait but you've set `MaxDelaySeconds: 10`, it will only wait 10 seconds. This prevents exponential backoff from creating unreasonably long delays.

```json
{
  "ErrorEquals": ["States.TaskFailed"],
  "IntervalSeconds": 2,
  "BackoffRate": 2.0,
  "MaxAttempts": 4,
  "MaxDelaySeconds": 30
}
```

In this example, the waits between retries would be: 2, 4, 8, 16 seconds (capped by the 30-second max). After 4 retries, if the task still fails, the error propagates.

#### JitterStrategy: Reducing Synchronized Failures

When multiple Step Functions executions hit the same issue simultaneously—say, a service restart—they might all retry at the same moment, creating a synchronized spike that further stresses the service. The `JitterStrategy` field addresses this by adding randomness to the wait intervals.

Setting `JitterStrategy: "EQUAL"` adds randomness up to the calculated interval, while `JitterStrategy: "FULL"` adds randomness up to the maximum delay. For a service under stress, jitter can be the difference between recovery and cascading failure.

```json
{
  "ErrorEquals": ["States.TaskFailed"],
  "IntervalSeconds": 1,
  "BackoffRate": 2.0,
  "MaxAttempts": 3,
  "JitterStrategy": "EQUAL"
}
```

### The Catch Field: Routing Errors to Alternative Paths

Retry is about recovery through repetition. But sometimes, a task will never succeed no matter how many times you try. A Lambda function might be invoked with genuinely invalid input. A service might be permanently unavailable. In these cases, you need the Catch field, which routes execution to an alternative state when specified errors occur.

A catch block is similar in structure to a retry block:

```json
{
  "Type": "Task",
  "Resource": "arn:aws:lambda:us-east-1:123456789012:function:ProcessPayment",
  "Catch": [
    {
      "ErrorEquals": ["InsufficientFunds"],
      "Next": "HandleInsufficientFunds"
    }
  ],
  "End": true
}
```

If the Lambda function throws an `InsufficientFunds` error, execution jumps to a state named `HandleInsufficientFunds` instead of failing. You could define that state to, for example, request an alternative payment method or notify a support team.

The power of Catch becomes apparent when combined with Retry. You can retry a task several times, and if it still fails after exhausting retries, Catch can route the error to a recovery handler:

```json
{
  "Type": "Task",
  "Resource": "arn:aws:lambda:us-east-1:123456789012:function:CheckInventory",
  "Retry": [
    {
      "ErrorEquals": ["States.TaskFailed"],
      "IntervalSeconds": 1,
      "BackoffRate": 2.0,
      "MaxAttempts": 2
    }
  ],
  "Catch": [
    {
      "ErrorEquals": ["States.ALL"],
      "Next": "UseDefaultInventory"
    }
  ],
  "End": true
}
```

Here, the CheckInventory Lambda is called. If it fails, it automatically retries twice with exponential backoff. If it still fails after those retries, execution moves to `UseDefaultInventory`, perhaps a state that uses cached or fallback inventory data instead of real-time data.

#### The ResultPath Parameter: Transforming Error Information

When a Catch block routes execution to another state, you often want information about the error to be available in the state machine's context. The `ResultPath` parameter lets you capture this.

```json
{
  "Catch": [
    {
      "ErrorEquals": ["ServiceUnavailable"],
      "Next": "LogAndRetry",
      "ResultPath": "$.error"
    }
  ]
}
```

With `ResultPath: "$.error"`, the error information is stored in a field called `error` in the state's input for the next state. If you want to discard the error and pass the original input forward, you can use `"ResultPath": null`. This is useful when you're handling the error in the fallback state and don't need to expose the error details.

### Multiple Retry and Catch Blocks: Granular Error Handling

Step Functions lets you define multiple retry and catch blocks, each with different error patterns. This is where you build truly sophisticated error handling:

```json
{
  "Type": "Task",
  "Resource": "arn:aws:lambda:us-east-1:123456789012:function:ComplexTask",
  "Retry": [
    {
      "ErrorEquals": ["States.Timeout"],
      "IntervalSeconds": 2,
      "BackoffRate": 2.0,
      "MaxAttempts": 2,
      "MaxDelaySeconds": 10
    },
    {
      "ErrorEquals": ["ServiceUnavailable", "ThrottlingException"],
      "IntervalSeconds": 1,
      "BackoffRate": 3.0,
      "MaxAttempts": 4
    },
    {
      "ErrorEquals": ["States.TaskFailed"],
      "IntervalSeconds": 5,
      "BackoffRate": 1.0,
      "MaxAttempts": 1
    }
  ],
  "Catch": [
    {
      "ErrorEquals": ["InvalidInput"],
      "Next": "HandleInvalidInput"
    },
    {
      "ErrorEquals": ["States.ALL"],
      "Next": "HandleUnexpectedError"
    }
  ],
  "End": true
}
```

Here, timeouts are retried twice with modest backoff, service unavailability is retried four times with aggressive backoff (hoping the service recovers), and generic task failures are retried just once with no backoff. Then, specific input validation errors are routed to one handler, and any remaining errors fall through to a generic handler.

The order matters. Step Functions evaluates Retry blocks in the order they're listed and uses the first match. Similarly, Catch blocks are evaluated in order. Always order them from most specific to most general, ending with `States.ALL` as a catch-all if needed.

### Predefined Error Names and Custom Errors

Step Functions recognizes several predefined error codes that you should understand:

**States.Runtime** covers runtime errors in the state machine execution itself, such as missing variables or invalid JSON path expressions. These are uncommon in normal operation but can occur if your state machine definition has bugs.

**States.TaskFailed** is the bucket for task-level failures—your Lambda threw an error, your API call returned an error, your DynamoDB operation failed, etc. This is by far the most common error you'll encounter.

**States.Timeout** fires when a task doesn't complete within its timeout window (set via the `TimeoutSeconds` parameter on the state).

**States.ALL** matches absolutely any error. It's a useful fallback but should typically be your last resort in a Catch block after handling more specific errors.

Custom errors come from your application code. When your Lambda function explicitly throws an error with a specific code, Step Functions captures that code. In Node.js, you might do:

```javascript
throw new Error('InsufficientFunds');
```

Or with a more structured approach:

```javascript
class InsufficientFundsError extends Error {
  constructor(message) {
    super(message);
    this.name = 'InsufficientFunds';
  }
}

throw new InsufficientFundsError('Account balance is insufficient');
```

Step Functions will read the error name and match it against your `ErrorEquals` patterns. This gives you the ability to create domain-specific error handling strategies at the workflow level.

### Standard vs. Express Workflows: Reliability Implications

Step Functions offers two workflow types, and they have different reliability characteristics that affect how you should think about retry and catch.

**Standard workflows** use the exactly-once delivery model. When you invoke a task, it executes exactly once, and Step Functions maintains a durable record of execution. If a network glitch occurs between the task's successful completion and Step Functions receiving the result, Step Functions will wait and retry until it gets confirmation. This means retry and catch blocks in Standard workflows can rely on the assumption that, from the perspective of the task itself, each attempt is discrete and independent.

**Express workflows** use the at-least-once delivery model. Tasks might execute more than once if there's any uncertainty about completion. This has important implications: your tasks should be idempotent, meaning they produce the same result regardless of whether they're called once or multiple times. If a task is not idempotent—say, it deducts money from an account each time it runs—Express workflows can be problematic without careful idempotency token management.

When designing retry strategies for Express workflows, keep idempotency front and center. A task that's safe to retry multiple times is safe in an Express workflow. A task that has side effects that shouldn't be duplicated needs either idempotency tokens or should run in a Standard workflow.

### Building a Real-World Example

Let's tie this together with a complete example. Imagine an order processing workflow:

```json
{
  "Comment": "Order processing workflow with resilience",
  "StartAt": "ValidateOrder",
  "States": {
    "ValidateOrder": {
      "Type": "Task",
      "Resource": "arn:aws:lambda:us-east-1:123456789012:function:ValidateOrder",
      "Retry": [
        {
          "ErrorEquals": ["States.TaskFailed"],
          "IntervalSeconds": 1,
          "BackoffRate": 2.0,
          "MaxAttempts": 1
        }
      ],
      "Catch": [
        {
          "ErrorEquals": ["InvalidOrderData"],
          "Next": "RejectOrder",
          "ResultPath": "$.validationError"
        }
      ],
      "Next": "CheckInventory"
    },
    "CheckInventory": {
      "Type": "Task",
      "Resource": "arn:aws:lambda:us-east-1:123456789012:function:CheckInventory",
      "TimeoutSeconds": 10,
      "Retry": [
        {
          "ErrorEquals": ["States.Timeout"],
          "IntervalSeconds": 2,
          "BackoffRate": 2.0,
          "MaxAttempts": 2,
          "MaxDelaySeconds": 10
        },
        {
          "ErrorEquals": ["ServiceUnavailable"],
          "IntervalSeconds": 3,
          "BackoffRate": 2.0,
          "MaxAttempts": 3
        }
      ],
      "Catch": [
        {
          "ErrorEquals": ["OutOfStock"],
          "Next": "NotifyOutOfStock"
        },
        {
          "ErrorEquals": ["States.ALL"],
          "Next": "UseDefaultInventory"
        }
      ],
      "Next": "ProcessPayment"
    },
    "ProcessPayment": {
      "Type": "Task",
      "Resource": "arn:aws:lambda:us-east-1:123456789012:function:ProcessPayment",
      "Retry": [
        {
          "ErrorEquals": ["States.TaskFailed"],
          "IntervalSeconds": 1,
          "BackoffRate": 2.0,
          "MaxAttempts": 2,
          "JitterStrategy": "EQUAL"
        }
      ],
      "Catch": [
        {
          "ErrorEquals": ["InsufficientFunds"],
          "Next": "RequestAlternatePayment"
        },
        {
          "ErrorEquals": ["PaymentGatewayError"],
          "Next": "RetryPaymentLater"
        },
        {
          "ErrorEquals": ["States.ALL"],
          "Next": "PaymentFailed"
        }
      ],
      "Next": "SendConfirmation"
    },
    "SendConfirmation": {
      "Type": "Task",
      "Resource": "arn:aws:sns:us-east-1:123456789012:SendOrderConfirmation",
      "Retry": [
        {
          "ErrorEquals": ["States.TaskFailed"],
          "IntervalSeconds": 5,
          "BackoffRate": 1.5,
          "MaxAttempts": 2
        }
      ],
      "Catch": [
        {
          "ErrorEquals": ["States.ALL"],
          "Next": "LogConfirmationFailure"
        }
      ],
      "Next": "OrderComplete"
    },
    "RejectOrder": {
      "Type": "Pass",
      "Result": "Order was rejected due to validation failure",
      "End": true
    },
    "NotifyOutOfStock": {
      "Type": "Pass",
      "Result": "Customer notified of out-of-stock items",
      "Next": "OrderComplete"
    },
    "UseDefaultInventory": {
      "Type": "Pass",
      "Result": "Using cached inventory data",
      "Next": "ProcessPayment"
    },
    "RequestAlternatePayment": {
      "Type": "Pass",
      "Result": "Requesting alternative payment method",
      "End": true
    },
    "RetryPaymentLater": {
      "Type": "Wait",
      "Seconds": 300,
      "Next": "ProcessPayment"
    },
    "PaymentFailed": {
      "Type": "Pass",
      "Result": "Payment processing failed",
      "End": true
    },
    "LogConfirmationFailure": {
      "Type": "Pass",
      "Result": "Confirmation email could not be sent, logged for manual review",
      "End": true
    },
    "OrderComplete": {
      "Type": "Pass",
      "Result": "Order processed successfully",
      "End": true
    }
  }
}
```

This workflow demonstrates several patterns:

The ValidateOrder state has a minimal retry (just one attempt) because validation failures don't improve with retries. But it catches validation-specific errors separately from generic failures.

CheckInventory has different retry strategies for timeouts versus service unavailability, recognizing that they often require different approaches. If it fails after retries, it either notifies about stock issues or uses default inventory, allowing the workflow to continue.

ProcessPayment has exponential backoff with jitter, appropriate for a critical operation where synchronized retries could cause problems. It catches domain-specific errors (InsufficientFunds) separately from transient failures (PaymentGatewayError).

SendConfirmation uses a modest backoff with minimal retries, because if the order is already paid, the workflow shouldn't be blocked indefinitely by a communication failure.

### Error Handling Best Practices

As you design your workflows, keep these principles in mind:

**Match errors specifically.** Avoid relying on `States.ALL` too early. Order your catch blocks from most specific to most general so that errors are handled appropriately rather than falling into a generic bucket.

**Think about idempotency.** If you're retrying a task that modifies state (like charging a payment), ensure the operation is truly idempotent or implement idempotency keys to prevent duplicate side effects.

**Use timeouts judiciously.** Set `TimeoutSeconds` on tasks that might hang. A timeout combined with a specific retry policy for `States.Timeout` can be more effective than waiting indefinitely for a response.

**Consider exponential backoff for transient failures.** When retrying due to service unavailability or throttling, exponential backoff with jitter is typically better than immediate retries. It reduces load on the struggling service and gives it time to recover.

**Log errors for observability.** Even when you handle an error gracefully via a catch block, log it somewhere for later analysis. CloudWatch Logs and X-Ray integration with Step Functions makes this straightforward.

**Test failure scenarios.** In development, deliberately cause failures to verify that your retry and catch logic behaves as expected. Use Step Functions' local testing capabilities or inject failures into test Lambda functions.

**Monitor retry attempts.** CloudWatch metrics and X-Ray traces show how often retries are occurring. High retry rates might indicate that your backoff strategy isn't giving services enough time to recover, or that a transient issue is actually more fundamental.

### Conclusion

Retry and catch blocks are the foundation of resilient Step Functions workflows. They allow you to express failure handling logic declaratively in your state machine definition, making it transparent and testable. Retry handles transient failures through configurable automatic retries with exponential backoff. Catch routes errors to alternative paths when recovery isn't possible, enabling graceful degradation.

The combination of these two mechanisms gives you fine-grained control over how your workflows respond to the inevitable failures of distributed systems. By thoughtfully configuring ErrorEquals patterns, backoff rates, maximum attempts, and catch handlers, you can build workflows that not only survive failures but respond intelligently to them. This is what separates fragile workflows from robust, production-ready orchestrations.
