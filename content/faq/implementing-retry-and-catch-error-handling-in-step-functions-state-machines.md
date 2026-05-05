---
title: "Implementing Retry and Catch Error Handling in Step Functions State Machines"
---

## Implementing Retry and Catch Error Handling in Step Functions State Machines

Building resilient workflows is one of the most critical skills for modern cloud applications. AWS Step Functions provides two powerful mechanisms for handling failures: the Retry policy and the Catch block. While they might seem straightforward at first glance, mastering their nuances—especially how they interact with each other, how error matching works, and how to inject error context into fallback states—can mean the difference between a system that gracefully degrades and one that fails unpredictably.

In this article, we'll explore these error handling mechanisms in depth. You'll learn how to craft retry strategies that match your application's resilience needs, understand the subtleties of error classification, and build complete state machines that handle complex failure scenarios with elegance and control.

### Understanding Retry and Catch in Step Functions

Step Functions treats errors as a first-class concern in your state machine design. When a task fails—whether it's a Lambda invocation that throws an exception, a DynamoDB call that times out, or an external API that returns an error—your state machine doesn't simply collapse. Instead, Step Functions gives you structured mechanisms to decide what happens next.

The Retry policy tells Step Functions: "If this task fails with certain error types, try it again." Think of it as an automatic retry loop with sophisticated backoff strategies. The Catch block, by contrast, is more like exception handling in traditional programming. It says: "If this task fails and we've exhausted our retries, transition to a fallback state instead of failing the entire workflow."

These two mechanisms work together in a specific sequence that's crucial to understand. Retries execute first. Only after all retry attempts are exhausted—or if the error doesn't match any retry condition—does the state machine consider the Catch blocks. This ordering is fundamental to designing reliable workflows.

### Anatomy of a Retry Policy

Every Retry block in a Step Functions state machine follows a consistent structure. Let's examine each component:

```json
{
  "Retry": [
    {
      "ErrorEquals": ["States.TaskFailed", "States.Timeout"],
      "IntervalSeconds": 2,
      "MaxAttempts": 3,
      "BackoffRate": 2.0
    }
  ],
  "Catch": [
    {
      "ErrorEquals": ["States.ALL"],
      "Next": "HandleError"
    }
  ]
}
```

The **ErrorEquals** field is an array of error name patterns that trigger this retry rule. Step Functions provides predefined error codes like `States.TaskFailed`, `States.Timeout`, and `States.Runtime`. We'll dive deeper into error classification shortly.

The **IntervalSeconds** parameter sets the initial wait time between the first failed attempt and the first retry. If you set this to 2, Step Functions waits 2 seconds before retrying. This isn't just a courtesy to a failing service—it gives temporarily unavailable resources time to recover.

The **MaxAttempts** field caps the total number of retry attempts. If you set MaxAttempts to 3, Step Functions will try the task once, then retry up to 3 additional times, for a maximum of 4 total attempts. When MaxAttempts is 0, no retries occur for that error type.

The **BackoffRate** parameter enables exponential backoff. Each subsequent retry wait time is multiplied by this rate. If you start with IntervalSeconds of 2 and BackoffRate of 2.0, the retry intervals will be 2 seconds, then 4 seconds, then 8 seconds, and so on. This pattern is essential for resilience—it prevents overwhelming a recovering service with a flood of immediate requests.

### Fixed Interval Retry Strategy

The simplest retry strategy uses a fixed interval between attempts. This works well for transient failures that are likely to resolve quickly, such as a momentary network hiccup or a brief service blip.

```json
{
  "Comment": "Fixed interval retry for quick transient failures",
  "StartAt": "CallExternalAPI",
  "States": {
    "CallExternalAPI": {
      "Type": "Task",
      "Resource": "arn:aws:lambda:us-east-1:123456789012:function:CallAPI",
      "Retry": [
        {
          "ErrorEquals": ["States.TaskFailed"],
          "IntervalSeconds": 1,
          "MaxAttempts": 2,
          "BackoffRate": 1.0
        }
      ],
      "Catch": [
        {
          "ErrorEquals": ["States.ALL"],
          "Next": "LogFailure"
        }
      ],
      "End": true
    },
    "LogFailure": {
      "Type": "Task",
      "Resource": "arn:aws:lambda:us-east-1:123456789012:function:LogError",
      "End": true
    }
  }
}
```

In this example, if CallExternalAPI fails with a `States.TaskFailed` error, Step Functions immediately retries. It waits 1 second, then tries again. If the second attempt also fails, it waits another 1 second and tries a third time. After that third attempt fails, the retry policy is exhausted, and the Catch block activates, routing to LogFailure.

The BackoffRate of 1.0 means each interval is identical—no multiplication occurs. This is simple but not always ideal for backing off against a congested system.

### Exponential Backoff with Jitter

For more sophisticated scenarios, especially when dealing with services that might be overwhelmed, exponential backoff is the industry standard. Instead of hammering a failing service with requests at fixed intervals, exponential backoff gradually increases wait times, giving the service more breathing room.

```json
{
  "Comment": "Exponential backoff for API rate limiting and service recovery",
  "StartAt": "ProcessPayment",
  "States": {
    "ProcessPayment": {
      "Type": "Task",
      "Resource": "arn:aws:states:::lambda:invoke",
      "Parameters": {
        "FunctionName": "ProcessPaymentFunction",
        "Payload.$": "$"
      },
      "Retry": [
        {
          "ErrorEquals": ["States.TaskFailed", "Lambda.ServiceException"],
          "IntervalSeconds": 1,
          "MaxAttempts": 4,
          "BackoffRate": 2.0
        }
      ],
      "Catch": [
        {
          "ErrorEquals": ["States.ALL"],
          "Next": "EscalateFailure"
        }
      ],
      "End": true
    },
    "EscalateFailure": {
      "Type": "Task",
      "Resource": "arn:aws:lambda:us-east-1:123456789012:function:NotifyOps",
      "End": true
    }
  }
}
```

Here, the first retry waits 1 second. The second waits 2 seconds. The third waits 4 seconds. The fourth waits 8 seconds. By the time you've exhausted retries, you've given a struggling service a full 15 seconds to recover while respecting an exponential backoff pattern.

The BackoffRate of 2.0 is a common choice, though values between 1.5 and 2.0 are typical in production systems. A rate below 1.0 would mean intervals shrink over time, which defeats the purpose of backing off.

Now, why the mention of "jitter" in the heading? In systems with many concurrent workflows, if all retries happen at perfectly regular exponential intervals, you can create a thundering herd problem—thousands of requests hitting your service at exactly the same moment. AWS Step Functions doesn't have a built-in jitter parameter, but you can simulate it in your Lambda function by adding a small random delay before making the actual service call. Alternatively, some teams handle jitter at the service layer itself.

### Understanding Error Classification with ErrorEquals

One of the trickiest aspects of Step Functions error handling is understanding how errors are matched and classified. Step Functions recognizes several categories of errors, and how you specify them in ErrorEquals determines which retry or catch block applies.

**Predefined Error Codes** are built into Step Functions. These include:

`States.TaskFailed` matches any task failure that doesn't fit into more specific categories. This is a broad catch-all for when a task simply doesn't succeed.

`States.Timeout` is thrown when a task exceeds its heartbeat or timeout duration. For Lambda tasks, this happens if your function runs longer than its timeout setting or if Step Functions doesn't receive a heartbeat signal within the specified interval.

`States.Runtime` indicates an error in the Step Functions runtime itself—generally something you can't control and shouldn't retry.

`States.ALL` is a wildcard that matches any error, predefined or custom. Using `States.ALL` in a Catch block is like having a catch-all exception handler—it's useful for cleanup operations but can mask underlying issues.

Lambda-specific errors include `Lambda.ServiceException` (when the Lambda service itself is unavailable), `Lambda.Unknown` (when Lambda returns an unrecognized error), and `Lambda.TooManyRequestsException` (when you hit concurrency limits).

**Custom Error Codes** come from your application logic. When your Lambda function explicitly throws an error with a specific name, Step Functions captures that name and makes it available for matching. For example, your Lambda function might throw an error like this:

```javascript
// Inside your Lambda function
throw new Error('PaymentGatewayUnavailable');
```

Step Functions will see the error code as `PaymentGatewayUnavailable`, and you can reference it directly in ErrorEquals:

```json
{
  "Retry": [
    {
      "ErrorEquals": ["PaymentGatewayUnavailable"],
      "IntervalSeconds": 5,
      "MaxAttempts": 3,
      "BackoffRate": 2.0
    }
  ]
}
```

In Node.js Lambda functions, when you throw an Error object, the error code becomes the error's message. Here's a practical example:

```javascript
const AWS = require('aws-sdk');

exports.handler = async (event) => {
  try {
    const result = await someExternalAPI.call();
    return result;
  } catch (error) {
    if (error.code === 'TIMEOUT') {
      throw new Error('ExternalAPITimeout');
    } else if (error.code === 'RATE_LIMITED') {
      throw new Error('ExternalAPIRateLimited');
    } else {
      throw new Error('ExternalAPIUnknownError');
    }
  }
};
```

When Step Functions receives an error from a Lambda function, it extracts the error message and treats it as the error code. This means your Retry and Catch blocks can respond differently to different failure modes, rather than treating all Lambda failures identically.

One subtlety: error matching in Step Functions supports prefix-based matching. If you specify `ErrorEquals: ["CustomError"]`, it will match `CustomError`, `CustomErrorSubtype`, `CustomErrorAnother`, or any error that starts with `CustomError`. If you want exact matching, you need to be precise with your error names or use a fallback Catch block.

### Using ResultPath to Inject Error Context

When an error occurs and you transition to a Catch block, you often need information about what went wrong. The ResultPath parameter lets you control how error details are injected into the state's input, allowing your fallback state to make decisions based on what happened.

By default, when a Catch block catches an error, Step Functions doesn't automatically pass error information to the caught state. The input to the next state is whatever the original input was. If you want error details, you need to explicitly configure them using ResultPath and the special variables `$$.State.EnteredTime`, `$$.State.Name`, and the `Error` and `Cause` fields.

Actually, let me clarify: Step Functions provides error information through the catch error context. Here's how you capture it:

```json
{
  "StartAt": "FetchUserData",
  "States": {
    "FetchUserData": {
      "Type": "Task",
      "Resource": "arn:aws:lambda:us-east-1:123456789012:function:GetUser",
      "Retry": [
        {
          "ErrorEquals": ["States.TaskFailed"],
          "IntervalSeconds": 2,
          "MaxAttempts": 2,
          "BackoffRate": 2.0
        }
      ],
      "Catch": [
        {
          "ErrorEquals": ["States.ALL"],
          "ResultPath": "$.error",
          "Next": "HandleFetchError"
        }
      ],
      "End": true
    },
    "HandleFetchError": {
      "Type": "Task",
      "Resource": "arn:aws:lambda:us-east-1:123456789012:function:LogUserFetchError",
      "Parameters": {
        "originalInput.$": "$",
        "errorDetails.$": "$.error"
      },
      "End": true
    }
  }
}
```

In this example, when FetchUserData fails and the Catch block activates, the error details are captured in a variable called `Error` and `Cause` within the Step Functions execution context. The ResultPath of `$.error` tells Step Functions to place these error details at the path `$.error` in the state's input to the next state.

The error object typically contains two fields: `Error` (the error code) and `Cause` (a more detailed message or stack trace). Your Lambda function in HandleFetchError can now inspect `$.error.Error` to see what type of failure occurred and `$.error.Cause` for additional context.

Here's a practical Lambda function that leverages this:

```javascript
exports.handler = async (event) => {
  console.log('Original input:', event.originalInput);
  console.log('Error code:', event.errorDetails.Error);
  console.log('Error cause:', event.errorDetails.Cause);
  
  if (event.errorDetails.Error === 'States.Timeout') {
    // Handle timeout-specific logic
    return { action: 'escalate', reason: 'Function timed out' };
  } else if (event.errorDetails.Error === 'States.TaskFailed') {
    // Handle generic task failure
    return { action: 'retry_later', reason: event.errorDetails.Cause };
  } else {
    return { action: 'unknown_error', reason: event.errorDetails.Cause };
  }
};
```

If you set `ResultPath` to `null`, the error is discarded and the next state receives the original input unchanged. If you set it to `$`, the error object replaces the entire input. These options give you fine-grained control over data flow through your state machine.

### Building a Saga Pattern with Multiple Retries and Escalation

Let's now walk through a realistic scenario: an order processing workflow that involves multiple service calls, each with its own retry strategy, and eventual escalation if everything fails.

```json
{
  "Comment": "Order processing saga with retries and escalation",
  "StartAt": "ValidateOrder",
  "States": {
    "ValidateOrder": {
      "Type": "Task",
      "Resource": "arn:aws:lambda:us-east-1:123456789012:function:ValidateOrder",
      "Retry": [
        {
          "ErrorEquals": ["ValidationServiceTemporarilyUnavailable"],
          "IntervalSeconds": 1,
          "MaxAttempts": 2,
          "BackoffRate": 1.5
        }
      ],
      "Catch": [
        {
          "ErrorEquals": ["ValidationServiceTemporarilyUnavailable"],
          "Next": "SkipValidationAndProceed"
        },
        {
          "ErrorEquals": ["InvalidOrderFormat"],
          "ResultPath": "$.validationError",
          "Next": "RejectOrder"
        },
        {
          "ErrorEquals": ["States.ALL"],
          "ResultPath": "$.unexpectedError",
          "Next": "EscalateToOps"
        }
      ],
      "Next": "ReserveInventory"
    },
    "SkipValidationAndProceed": {
      "Type": "Pass",
      "Next": "ReserveInventory"
    },
    "ReserveInventory": {
      "Type": "Task",
      "Resource": "arn:aws:states:::lambda:invoke",
      "Parameters": {
        "FunctionName": "ReserveInventory",
        "Payload.$": "$"
      },
      "Retry": [
        {
          "ErrorEquals": ["InventoryServiceUnavailable"],
          "IntervalSeconds": 2,
          "MaxAttempts": 3,
          "BackoffRate": 2.0
        },
        {
          "ErrorEquals": ["InsufficientInventory"],
          "IntervalSeconds": 5,
          "MaxAttempts": 1,
          "BackoffRate": 1.0
        }
      ],
      "Catch": [
        {
          "ErrorEquals": ["InsufficientInventory"],
          "ResultPath": "$.inventoryError",
          "Next": "NotifyOutOfStock"
        },
        {
          "ErrorEquals": ["InventoryServiceUnavailable"],
          "ResultPath": "$.inventoryError",
          "Next": "EscalateToOps"
        }
      ],
      "Next": "ProcessPayment"
    },
    "ProcessPayment": {
      "Type": "Task",
      "Resource": "arn:aws:lambda:us-east-1:123456789012:function:ProcessPayment",
      "Retry": [
        {
          "ErrorEquals": ["PaymentGatewayTimeout", "PaymentGatewayRateLimited"],
          "IntervalSeconds": 3,
          "MaxAttempts": 4,
          "BackoffRate": 2.0
        },
        {
          "ErrorEquals": ["InsufficientFunds"],
          "IntervalSeconds": 60,
          "MaxAttempts": 1,
          "BackoffRate": 1.0
        }
      ],
      "Catch": [
        {
          "ErrorEquals": ["InsufficientFunds"],
          "ResultPath": "$.paymentError",
          "Next": "RefundAndNotifyCustomer"
        },
        {
          "ErrorEquals": ["PaymentGatewayTimeout", "PaymentGatewayRateLimited"],
          "ResultPath": "$.paymentError",
          "Next": "EscalateToOps"
        },
        {
          "ErrorEquals": ["States.ALL"],
          "ResultPath": "$.unexpectedPaymentError",
          "Next": "EscalateToOps"
        }
      ],
      "Next": "ConfirmOrder"
    },
    "ConfirmOrder": {
      "Type": "Task",
      "Resource": "arn:aws:lambda:us-east-1:123456789012:function:ConfirmOrder",
      "Retry": [
        {
          "ErrorEquals": ["DatabaseConnectionError"],
          "IntervalSeconds": 2,
          "MaxAttempts": 3,
          "BackoffRate": 1.5
        }
      ],
      "Catch": [
        {
          "ErrorEquals": ["States.ALL"],
          "ResultPath": "$.confirmationError",
          "Next": "EscalateToOps"
        }
      ],
      "Next": "OrderComplete"
    },
    "OrderComplete": {
      "Type": "Succeed"
    },
    "RejectOrder": {
      "Type": "Task",
      "Resource": "arn:aws:lambda:us-east-1:123456789012:function:SendRejectionEmail",
      "Parameters": {
        "orderId.$": "$.orderId",
        "reason.$": "$.validationError.Cause"
      },
      "End": true
    },
    "NotifyOutOfStock": {
      "Type": "Task",
      "Resource": "arn:aws:lambda:us-east-1:123456789012:function:SendOutOfStockNotification",
      "Parameters": {
        "orderId.$": "$.orderId",
        "reason.$": "$.inventoryError.Cause"
      },
      "End": true
    },
    "RefundAndNotifyCustomer": {
      "Type": "Task",
      "Resource": "arn:aws:lambda:us-east-1:123456789012:function:ProcessRefund",
      "Parameters": {
        "orderId.$": "$.orderId",
        "reason.$": "$.paymentError.Cause"
      },
      "End": true
    },
    "EscalateToOps": {
      "Type": "Task",
      "Resource": "arn:aws:lambda:us-east-1:123456789012:function:SendOpsAlert",
      "Parameters": {
        "orderId.$": "$.orderId",
        "validationError.$": "$.validationError",
        "inventoryError.$": "$.inventoryError",
        "paymentError.$": "$.paymentError",
        "unexpectedError.$": "$.unexpectedError"
      },
      "End": true
    }
  }
}
```

This state machine demonstrates several important patterns:

**Multiple retry strategies per state.** ReserveInventory has two Retry blocks. The first handles temporary unavailability with aggressive exponential backoff. The second handles insufficient inventory differently—it retries only once after a longer delay, recognizing that this error is less likely to resolve on its own.

**Ordered Catch blocks.** Catch blocks are evaluated top to bottom. The first matching block wins. In ProcessPayment, specific errors are caught first (InsufficientFunds, timeout errors), and only if none of those match does the fallback `States.ALL` catch apply.

**ResultPath for context.** Each Catch block uses ResultPath to inject error details into a specific path in the state input. This allows downstream states to understand what went wrong without having to look at CloudWatch logs.

**Escalation routing.** When retries are exhausted and no specific Catch block matches, errors flow to EscalateToOps, which gathers all accumulated error context and sends an alert. This is where human intervention might occur.

### The Interaction Between Retry and Catch

Understanding the sequence of retry and catch execution is crucial for designing reliable state machines. Here's how it works:

When a task fails, Step Functions first checks if the error matches any of the Retry block conditions. If it does, and if retry attempts haven't been exhausted, the task is retried after the specified interval. This continues until either the task succeeds or the MaxAttempts limit is reached.

Only after all retry attempts are exhausted does Step Functions evaluate the Catch blocks. At that point, if the error matches a Catch condition, the state machine transitions to the specified Next state. If it doesn't match any Catch condition, the entire execution fails.

```json
{
  "StartAt": "UnreliableTask",
  "States": {
    "UnreliableTask": {
      "Type": "Task",
      "Resource": "arn:aws:lambda:us-east-1:123456789012:function:Flaky",
      "Retry": [
        {
          "ErrorEquals": ["TemporaryFailure"],
          "IntervalSeconds": 1,
          "MaxAttempts": 2,
          "BackoffRate": 2.0
        }
      ],
      "Catch": [
        {
          "ErrorEquals": ["TemporaryFailure"],
          "Next": "RecoverFromTemporaryFailure"
        },
        {
          "ErrorEquals": ["PermanentFailure"],
          "Next": "HandlePermanentFailure"
        },
        {
          "ErrorEquals": ["States.ALL"],
          "Next": "HandleUnexpectedError"
        }
      ],
      "End": true
    },
    "RecoverFromTemporaryFailure": {
      "Type": "Pass",
      "Result": "Recovered from temporary failure",
      "End": true
    },
    "HandlePermanentFailure": {
      "Type": "Pass",
      "Result": "Handled permanent failure gracefully",
      "End": true
    },
    "HandleUnexpectedError": {
      "Type": "Pass",
      "Result": "Handled unexpected error",
      "End": true
    }
  }
}
```

In this example, if UnreliableTask throws a TemporaryFailure error, Step Functions will retry twice (with 1 second, then 2 second delays). If it still fails after two retries, it transitions to RecoverFromTemporaryFailure via the Catch block. Notice that we have a Catch block for TemporaryFailure—this is appropriate because even though retries are configured, we want a graceful recovery path if retries exhaust.

Conversely, if the task throws a PermanentFailure error, the Retry block won't match it, so Step Functions immediately jumps to the Catch block and transitions to HandlePermanentFailure.

### Practical Tips for Production Deployments

When designing error handling for production Step Functions, consider these practical guidelines:

**Start conservative with retry counts.** More retries mean longer workflow duration and higher costs. Three to four retry attempts with exponential backoff typically capture 95% of transient failures. Beyond that, you're usually wasting time and money.

**Match retry strategies to failure types.** Temporary service unavailability benefits from quick retries with exponential backoff. Rate limiting benefits from longer intervals. Authentication failures shouldn't retry at all—they'll just keep failing.

**Always have a Catch fallback.** Even if you don't expect a particular error, having a `States.ALL` catch block at the end ensures your workflow doesn't fail silently. At minimum, log the error for investigation.

**Use DLQs and observability.** When errors flow to EscalateToOps or similar states, log them to CloudWatch, send them to SNS, or queue them for manual review. Step Functions provides execution history, but centralized logging is invaluable for debugging.

**Test failure scenarios.** Before deploying, intentionally trigger different error conditions in your state machine. Verify that retries actually occur, that Catch blocks fire as expected, and that error context is properly injected.

**Document your error handling.** Add comments to your state machine definition explaining why certain errors are retried, what Catch blocks do, and where they route. Future you (and your teammates) will appreciate the clarity.

### Conclusion

Retry and Catch mechanisms in AWS Step Functions provide the building blocks for resilient, self-healing workflows. By understanding how ErrorEquals matches predefined and custom error codes, how ResultPath injects error context, and how retry attempts execute before Catch blocks evaluate, you can design state machines that gracefully handle transient failures while escalating genuine problems to appropriate handlers.

The key is thoughtful design: use fixed intervals for quick transient failures, exponential backoff for overwhelmed services, specific error matching for intelligent recovery, and always maintain a fallback path. With these tools and patterns, you'll build workflows that don't just fail better—they recover automatically and let you focus on building features instead of chasing production incidents.
