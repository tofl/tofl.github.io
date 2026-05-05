---
title: "Lambda Async Invocation: Retry Behavior and OnFailure/OnSuccess Destinations"
---

## Lambda Async Invocation: Retry Behavior and OnFailure/OnSuccess Destinations

When you drop a message into an SNS topic, trigger a Lambda function from S3 events, or schedule something with EventBridge, you're almost certainly dealing with asynchronous invocation. Unlike synchronous calls where the caller waits for a response, async invocation is a fire-and-forget model—the service that triggered your function doesn't stick around to see what happens. This architectural choice unlocks scalability, but it introduces complexity: what happens when your function fails? How many times does Lambda retry? Where do failed events go? Understanding Lambda's async invocation model, its retry mechanics, and the modern Destinations feature is crucial for building resilient, observable serverless applications.

### How Lambda's Async Invocation Works

When a service like S3, SNS, or EventBridge invokes a Lambda function asynchronously, the invocation doesn't happen immediately. Instead, Lambda places the event into an internal queue—think of it as a temporary holding area managed entirely by AWS. The calling service receives a 202 Accepted response almost instantly, meaning "I got your request and will process it soon." Meanwhile, Lambda workers pull events from this queue and execute your function.

This queue-based model is why async invocation scales so well. The calling service never has to wait for actual execution, and Lambda can control the rate at which it pulls from the queue, preventing your function from being overwhelmed by sudden traffic spikes. It also means that if your function is temporarily failing, events sit in the queue and Lambda can retry them according to its retry policy.

The internal queue is ephemeral and transparent to you—you can't directly access it or configure its size. It's simply part of Lambda's infrastructure. What you *can* control is what happens when events fail and how many times Lambda retries them.

### Automatic Retries: Two Chances to Succeed

By default, when a Lambda function invoked asynchronously returns an error (a non-zero exit code or an unhandled exception), Lambda automatically retries the invocation. But it doesn't retry indefinitely. Lambda gives your function exactly two automatic retries for a total of three attempts. The retries are not immediate—they're spaced out with exponential backoff.

The retry schedule looks like this: the first failure triggers a retry after a short delay (typically a few seconds), and if that fails, a second retry follows after a longer delay (typically up to about a minute). After the second retry fails, the event is considered exhausted from Lambda's retry perspective. This behavior is built-in and happens without any configuration on your part.

However, it's important to understand what "failure" means. A failure is when your Lambda function returns an error, either through an unhandled exception or by explicitly returning an error response. Timeouts also count as failures. But if your function completes successfully—even if you log warnings or return a non-error response—Lambda considers it a success and doesn't retry, regardless of whether your application logic actually handled the event correctly.

This distinction matters in practice. Imagine an S3 bucket triggering a Lambda that writes data to a database. If the database connection fails and your code throws an exception, Lambda retries. But if your code catches the exception, logs it, and returns normally, Lambda won't retry—even though the data never made it to the database. You have to build explicit error handling and triggering of retries into your application logic if you need more sophisticated error recovery.

### Controlling Retry Behavior with MaximumRetryAttempts and MaximumEventAge

While the default two retries work for many use cases, you can customize this behavior using two key settings: `MaximumRetryAttempts` and `MaximumEventAge`. These are configured on the event source mapping that connects your source service to your Lambda function.

`MaximumRetryAttempts` lets you specify how many times Lambda should retry after the initial invocation fails. You can set this to any value from 0 to 2 (the maximum). Setting it to 0 means Lambda won't retry at all—your function gets one shot, and if it fails, the event goes to your failure destination or is discarded. This is useful for scenarios where retrying doesn't make sense, like processing time-sensitive events that become stale quickly.

`MaximumEventAge` specifies the maximum age of an event (in seconds) before Lambda stops trying to process it, even if retries remain available. You can set this anywhere from 60 seconds to 86,400 seconds (one day). If an event sits in the queue longer than this window, Lambda discards it without invoking your function. This setting prevents your function from processing extremely stale events that may have triggered subsequent, fresher events anyway.

These settings work together. Imagine you're processing payment events that must be handled within 10 minutes or they're no longer relevant. You could set `MaximumEventAge` to 600 seconds. If an event arrives and your function keeps failing and retrying, but 10 minutes pass before it succeeds, Lambda stops trying and sends it to your failure destination. Meanwhile, you could set `MaximumRetryAttempts` to 0 if you want each payment event attempted exactly once with no retries, ensuring faster feedback.

### The Legacy DLQ vs. Modern Destinations

Historically, the only way to handle failed Lambda invocations was through a Dead Letter Queue (DLQ)—either an SQS queue or SNS topic. When Lambda exhausted its retries, it would send the original event to your configured DLQ. This worked, but it had limitations.

The first limitation was observability. With a DLQ, you received only the original event payload. You didn't know how many times Lambda had retried, when the retries occurred, what errors were encountered, or how long the event sat in the queue. Debugging was like finding a message in a bottle with no context.

The second limitation was flexibility. A DLQ is binary—either the function succeeded or it didn't. If you wanted different handling for different types of failures (retry exhausted, timeout, permission denied), you'd need to build complex logic inside your function to check error types and route them differently.

AWS addressed these shortcomings with Lambda Destinations, which work alongside or instead of DLQs. Destinations are configured at the event source mapping level and support four targets: SQS queues, SNS topics, EventBridge event buses, and other Lambda functions. When a Lambda invocation fails (either immediately or after retries are exhausted), the event is sent to your specified destination with a rich JSON envelope containing metadata about the invocation.

You can configure both an OnFailure destination and an OnSuccess destination. OnFailure destinations receive events when the Lambda invocation ultimately fails (after all retries). OnSuccess destinations receive events when the invocation succeeds. This isn't just for error handling—OnSuccess destinations enable powerful asynchronous workflows where your Lambda function processes something and then triggers downstream actions through a destination without the function itself orchestrating those actions.

### Understanding the Destination Payload Envelope

When an event is sent to a Destination, it's wrapped in a standard JSON envelope that includes the original event plus metadata. Here's what this envelope looks like:

```json
{
  "version": "1.0",
  "timestamp": 1635360000000,
  "requestContext": {
    "requestId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "functionArn": "arn:aws:lambda:us-east-1:123456789012:function:my-function",
    "condition": "RetryAttemptsExhausted",
    "approximateInvokeCount": 3
  },
  "responseContext": {
    "statusCode": 500,
    "functionError": "Unhandled",
    "logResult": "base64-encoded logs..."
  },
  "body": {
    "eventSource": "s3",
    "s3": {
      "bucket": {
        "name": "my-bucket"
      },
      "object": {
        "key": "path/to/object"
      }
    }
  }
}
```

The envelope's `requestContext` includes the function ARN, the request ID (useful for correlating with CloudWatch logs), the `condition` (which explains why it's being sent—"RetryAttemptsExhausted", "DeadLetterQueueFull", or for successful invocations, "Success"), and the `approximateInvokeCount` (how many times Lambda attempted the invocation). The `responseContext` provides the function's status code and error details, giving you visibility into *why* the invocation failed.

The actual event payload lives in the `body` field. If your function was triggered by S3, the `body` contains the original S3 event structure. This is crucial because downstream systems need the original event to understand what went wrong and potentially retry or remediate.

For OnSuccess destinations, the envelope still includes these contexts but the `condition` is "Success" and the `responseContext` contains the function's actual response payload (or status code 200 if no explicit response is returned).

### Choosing Destinations Based on Your Workflow

Selecting the right destination depends on how you want to handle failures and what happens next.

**SQS as a Destination** is ideal when you need a durable, scalable queue to handle retries or further processing. Failed events arrive in the SQS queue with the full envelope, and you can consume them at your own pace with worker Lambda functions, EC2 instances, or other consumers. SQS provides visibility into queue depth, allows for arbitrary long retention periods (up to 14 days), and integrates seamlessly with other AWS services. Use SQS when you need a buffer and the ability to scale independent of Lambda's retry behavior.

**SNS as a Destination** works well when you want to fan out failures or successful results to multiple subscribers. Perhaps payment processing failures should trigger both a notification to ops and a remediation Lambda. SNS lets you set this up without coupling your primary function to all those downstream systems. The tradeoff is that SNS delivers messages asynchronously to subscribers—if a subscriber's endpoint (like an SQS queue) is temporarily unavailable, SNS retries for a period and then discards the message.

**EventBridge as a Destination** is powerful when you're building event-driven architectures and want failures to become events in your broader event bus. EventBridge rules can route these failure events based on custom patterns, enabling sophisticated workflows like "if payment processing fails and the retry count is 2, trigger a notification Lambda, but if it's 1, silently retry." You get the full rule-matching and routing capabilities of EventBridge, making it ideal for complex orchestration.

**Lambda as a Destination** creates function-to-function chains. When a Lambda invocation fails, you could send it to another Lambda that logs details, issues alerts, or attempts remediation. This is useful for specialized error handling but requires that your destination function itself be reliable—if it also fails, the event is lost (unless you configure a destination for that function too, enabling deeper chaining).

### When to Use Destinations vs. DLQs

Both mechanisms can coexist, but they serve different purposes. A DLQ is a safety net—a simple, low-overhead place for events that ultimately fail. It's passive; events land there, and you periodically check what's in it. Destinations are active and observable; they enable you to respond immediately to failures with structured information.

For simple cases where you just need visibility into failures—perhaps to log them or alert on anomalies—a DLQ might be sufficient. For active failure handling, downstream workflows, or integration with other services, Destinations are the modern approach. Most new applications should prioritize Destinations, as they provide richer context and integrate more naturally with event-driven architectures.

### Practical Considerations

One subtlety worth mentioning: the two automatic retries happen relatively quickly (within a few minutes). If your function fails, you get retried almost immediately. This is fine for transient errors like temporary API unavailability, but if you need to retry much later (hours or days), you should handle that explicitly in your code or use a separate service like Step Functions to orchestrate retries with custom delays.

Another consideration is understanding what errors trigger retries. Function timeouts count as failures and trigger retries. Permission errors (like lacking IAM permissions to write to a DynamoDB table) also trigger retries—Lambda doesn't know your code *couldn't* execute due to permissions, so it retries hopefully. This means your function might exhaust retries due to a permission error while you're debugging why the logs show nothing. Always check your Lambda execution role and CloudWatch logs for permission-related errors.

When configuring destinations, remember that the destination must exist before you set it up in the event source mapping. Also, the Lambda execution role must have permission to write to the destination (e.g., `sqs:SendMessage` for an SQS destination). It's easy to miss these prerequisites and wonder why events aren't arriving.

### Putting It All Together: A Practical Example

Imagine you're building a system where S3 uploads trigger a Lambda that processes images and writes metadata to DynamoDB. Processing can fail for various reasons: the image format is invalid (a permanent error), DynamoDB is temporarily throttled (transient), or the Lambda times out (could be either).

You'd set `MaximumRetryAttempts` to 2 to allow for transient failures but avoid excessive retries for permanent errors. You'd configure an OnFailure destination pointing to an SQS queue where your ops team has a Lambda that processes failures—logging them, alerting, and, for some cases, initiating manual review. You might also configure an OnSuccess destination sending to an EventBridge event bus, where a rule matches successful events and triggers downstream notification to analytics or triggers another processing pipeline.

With this setup, transient DynamoDB issues cause automatic retries within minutes. If those retries exhaust, the event lands in your SQS queue with full context about what went wrong. Meanwhile, every successful image processing triggers an event that feeds into your analytics pipeline, giving you complete visibility and enabling automated responses to both success and failure.

### Conclusion

Lambda's asynchronous invocation model is straightforward on the surface—queue the event and retry on failure—but the details matter enormously for production systems. The default two retries suit many scenarios, but `MaximumRetryAttempts` and `MaximumEventAge` let you tune behavior for your specific needs. Destinations represent a significant improvement over legacy DLQs, providing rich context and enabling sophisticated failure handling and event-driven workflows.

The key takeaway is that async invocation success depends not just on your function's code but on how you configure retries and destinations. Spend time understanding the failure paths, the envelope structure, and the right destination choice for your architecture. When you get these elements right, you build systems that gracefully handle failures, provide deep observability, and scale reliably under real-world conditions.
