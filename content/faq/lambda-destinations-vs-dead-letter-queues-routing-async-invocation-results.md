---
title: "Lambda Destinations vs Dead Letter Queues: Routing Async Invocation Results"
---

## Lambda Destinations vs Dead Letter Queues: Routing Async Invocation Results

When you invoke a Lambda function asynchronously, you're essentially firing and forgetting—your application doesn't wait for the function to complete before moving on. This is powerful for handling spiky workloads, decoupling components, and building event-driven architectures. But what happens when something goes wrong? Or what if you need to capture successful results for downstream processing? That's where Lambda Destinations and Dead Letter Queues come in.

For years, Dead Letter Queues were the only option developers had for capturing failed async invocations. They remain widely used and supported, but they're increasingly being superseded by Lambda Destinations—a more flexible, modern approach that handles both success and failure scenarios. Understanding both mechanisms, when to use each, and how to migrate between them is essential for building reliable serverless applications on AWS.

### Understanding Asynchronous Lambda Invocations

Before diving into destinations and DLQs, let's clarify what "asynchronous" means in the Lambda context. When you invoke a Lambda function asynchronously, you're not waiting for a response. Common triggers include S3 bucket events, SNS topic messages, SQS queue messages, or EventBridge rules. Your invoking service or application gets an immediate acknowledgment, and Lambda processes the invocation in the background.

This decoupling is beautiful for resilience and scalability, but it introduces a new problem: visibility. If something breaks deep in the async invocation chain, how do you know? How do you recover? That's where these two mechanisms differ in important ways.

### Dead Letter Queues: The Legacy Approach

A Dead Letter Queue (DLQ) is an SQS queue or SNS topic that receives events after Lambda has exhausted all retry attempts on a failed async invocation. Think of it as a collection point for messages that couldn't be processed successfully.

When you configure a DLQ for a Lambda function, you're telling AWS: "If this function fails to process an invocation after retrying twice, send the original event to this queue." The DLQ receives only the original event that triggered the Lambda function, not any information about what went wrong or what the Lambda function was doing when it failed.

AWS Lambda automatically retries failed async invocations twice before sending them to the DLQ. This means your function gets three total attempts—the initial invocation plus two retries—with exponential backoff between attempts.

Let me give you a concrete example. Imagine you have a Lambda function that processes image uploads from an S3 bucket. When an object is uploaded, S3 invokes your Lambda asynchronously. If your function fails (due to a timeout, an unhandled exception, or any other error), AWS retries twice. If all three attempts fail, the original S3 event goes to your configured DLQ.

Here's how you'd configure a DLQ using the AWS CLI:

```bash
aws lambda update-function-configuration \
  --function-name image-processor \
  --dead-letter-config TargetArn=arn:aws:sqs:us-east-1:123456789012:my-dlq
```

The DLQ target can be an SQS queue ARN or an SNS topic ARN. That's it—those are your only two options with DLQs.

The payload that lands in your DLQ is the original triggering event, unchanged. If S3 triggered your Lambda with a bucket notification event, the DLQ message contains exactly that S3 event. This is useful for replaying failed invocations, but it tells you nothing about why the invocation failed or what the function was attempting to do.

### Lambda Destinations: The Modern Approach

Lambda Destinations represent a significant evolution in how you capture and route async invocation outcomes. Instead of only capturing failures in a single queue, Destinations let you route both successful and failed invocations to different targets, with much richer payload information.

When you configure a Destination for a Lambda function, you specify routing rules: where to send successful invocations and where to send failed ones. Each rule maps to a target resource, which can be an SQS queue, SNS topic, EventBridge event bus, or another Lambda function. This flexibility opens up powerful architectural patterns that simply aren't possible with DLQs.

The real power of Destinations lies in the payload structure. Instead of just the original event, the Destination message includes the original event, the response (on success), error information (on failure), and additional context about the invocation. This gives you complete visibility into what happened.

Let's look at the payload structure for a successful invocation routed to a Destination. Here's what lands in your target:

```json
{
  "version": "1.0",
  "timestamp": "2024-01-15T14:32:18.123Z",
  "requestContext": {
    "requestId": "e1d3f3f7-6c3e-4a8c-91f4-abc123def456",
    "functionArn": "arn:aws:lambda:us-east-1:123456789012:function:image-processor:1",
    "approximateInvokeCount": 1,
    "traceId": "Root=1-65a5c612-1a2b3c4d5e6f7g8h9i0j1k2l"
  },
  "responsePayload": {
    "statusCode": 200,
    "message": "Image processed successfully",
    "processedUrl": "s3://bucket/processed/image-123.jpg"
  }
}
```

Notice the `responsePayload` key—that's the actual return value from your Lambda function. For a failed invocation, you'd see something different:

```json
{
  "version": "1.0",
  "timestamp": "2024-01-15T14:32:18.123Z",
  "requestContext": {
    "requestId": "e1d3f3f7-6c3e-4a8c-91f4-abc123def456",
    "functionArn": "arn:aws:lambda:us-east-1:123456789012:function:image-processor:1",
    "approximateInvokeCount": 1,
    "traceId": "Root=1-65a5c612-1a2b3c4d5e6f7g8h9i0j1k2l"
  },
  "requestPayload": {
    "Records": [
      {
        "s3": {
          "bucket": {
            "name": "my-bucket"
          },
          "object": {
            "key": "uploads/image-123.jpg"
          }
        }
      }
    ]
  },
  "responsePayload": {
    "errorMessage": "Unable to connect to image processing service",
    "errorType": "ServiceUnavailableException",
    "stackTrace": ["..."]
  }
}
```

Notice that failed invocations include both the original `requestPayload` and the error details in `responsePayload`. This is invaluable for debugging and recovery.

Configuring a Destination looks similar to a DLQ but offers more options. Using the AWS CLI:

```bash
aws lambda put-function-event-invoke-config \
  --function-name image-processor \
  --maximum-event-age 3600 \
  --maximum-retry-attempts 2 \
  --destination-config OnSuccess={Type=EventBridge,Destination=arn:aws:events:us-east-1:123456789012:event-bus/default},OnFailure={Type=SQS,Destination=arn:aws:sqs:us-east-1:123456789012:dlq-queue}
```

This configuration tells Lambda: route successful invocations to an EventBridge event bus and failed invocations to an SQS queue. You're splitting success and failure into different paths, each optimized for different downstream processing.

### Key Differences at a Glance

The gap between DLQs and Destinations is more than just cosmetic. DLQs capture only failed invocations after retries are exhausted. They provide only the original triggering event, with no information about the failure or the function's response. Your only target options are SQS or SNS.

Destinations, by contrast, capture both successful and failed invocations—making them useful for observability and event-driven patterns beyond simple error handling. The payload includes the original event, the function's response or error details, and request context. And you can route to SQS, SNS, EventBridge, or Lambda itself.

This means Destinations enable patterns that DLQs simply can't support. You could route successful image processing results to EventBridge for further processing, while routing failures to an SQS queue for manual review. You could invoke a different Lambda function on success to update a DynamoDB table with the processing result. These architectural patterns become natural with Destinations but require workarounds with DLQs.

### Retry Behavior and Configuration

Both DLQs and Destinations respect the same underlying retry logic for Lambda async invocations. Lambda retries failed invocations twice by default, but you can customize this behavior using event invoke configuration.

When using Destinations, you can explicitly configure the maximum number of retries and the maximum age of an event. Here's how:

```bash
aws lambda put-function-event-invoke-config \
  --function-name my-function \
  --maximum-retry-attempts 0 \
  --maximum-event-age 300
```

This configuration tells Lambda not to retry at all and to discard events older than 300 seconds. This is useful if you want immediate feedback on failures or if your function is processing time-sensitive data.

With DLQs, the retry behavior is fixed—always two retries. You can't customize it. This inflexibility is another reason Destinations are considered the modern approach.

### When Failures Don't Reach Your DLQ or Destination

It's important to understand that both DLQs and Destinations receive invocations that have already failed and exhausted retries. But there's a category of failures that never reach either: throttling.

If your Lambda function is throttled due to hitting concurrency limits, that invocation doesn't fail in the traditional sense. Instead, it's discarded by the invoking service (like S3 or SQS). AWS Lambda doesn't consider this a function-level failure, so the invocation never gets to your DLQ or Destination.

This is a subtle but critical point. For event sources where you can't afford to lose events, you need other strategies. SQS queues, for example, have built-in retry logic that keeps messages until they're successfully processed or explicitly deleted. SNS with SQS fanout provides similar guarantees.

### Setting Up Destinations in Practice

Let's walk through a practical example. Imagine you're building an order processing system where a Lambda function processes order events from an SQS queue. You want to route successful orders to an SNS topic for downstream fulfillment, and failures to a separate SQS queue for investigation.

First, you'd create the target resources: an SNS topic for successful orders and an SQS queue for failures. Then configure the Destination:

```bash
aws lambda put-function-event-invoke-config \
  --function-name process-orders \
  --destination-config \
    OnSuccess='{
      Type=SNS,
      Destination=arn:aws:sns:us-east-1:123456789012:orders-processed
    }' \
    OnFailure='{
      Type=SQS,
      Destination=arn:aws:sqs:us-east-1:123456789012:orders-failed
    }'
```

Now when your `process-orders` Lambda function runs asynchronously, successful invocations send the response payload to the SNS topic, while failed ones go to the SQS queue. This enables a clean separation of concerns: the fulfillment team subscribes to the SNS topic, while the support team monitors the failed queue.

### Configuring DLQs in Practice

For comparison, here's the same scenario using a DLQ:

```bash
aws lambda update-function-configuration \
  --function-name process-orders \
  --dead-letter-config TargetArn=arn:aws:sqs:us-east-1:123456789012:orders-dlq
```

Now only failed orders go to the `orders-dlq` queue. Successful orders produce no output—they're simply processed and the response is discarded. If you need downstream processing of successful orders, you'd have to add that logic inside the Lambda function itself, routing to SNS or another service from within the code.

This illustrates why Destinations are more flexible: they enable clean separation of concerns at the Lambda invocation level, not just in error handling.

### IAM Permissions for Destinations and DLQs

Both mechanisms require appropriate IAM permissions. Your Lambda execution role needs permission to send messages to the destination resource.

For a Destination sending to SQS:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "sqs:SendMessage",
      "Resource": "arn:aws:sqs:us-east-1:123456789012:my-destination-queue"
    }
  ]
}
```

For an SNS Destination:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "sns:Publish",
      "Resource": "arn:aws:sns:us-east-1:123456789012:my-destination-topic"
    }
  ]
}
```

DLQs require similar permissions. If your DLQ is an SQS queue, the Lambda execution role needs `sqs:SendMessage`. If it's an SNS topic, it needs `sns:Publish`.

### Monitoring and Observability

Both Destinations and DLQs integrate with CloudWatch Logs and can be monitored through CloudWatch Metrics. When an invocation is routed to a Destination (success or failure), it counts toward Lambda's invocation metrics. Similarly, messages in a DLQ can be monitored like any other SQS or SNS resource.

The advantage of Destinations is that you get richer payload information, which makes debugging easier. When a message lands in your failure Destination, it includes the error message, error type, and stack trace. With a DLQ, you only have the original event, so you'd need to reconstruct what went wrong by reviewing function logs.

### Migration Path from DLQs to Destinations

If you're currently using DLQs and want to migrate to Destinations, the path is straightforward but requires careful testing. Start by configuring a Destination alongside your existing DLQ:

```bash
aws lambda put-function-event-invoke-config \
  --function-name my-function \
  --destination-config \
    OnFailure='{
      Type=SQS,
      Destination=arn:aws:sqs:us-east-1:123456789012:new-failure-destination
    }' \
  --dead-letter-config TargetArn=arn:aws:sqs:us-east-1:123456789012:old-dlq
```

Wait—you can't do this. Lambda doesn't allow you to use both Destinations and DLQs simultaneously on the same function configuration. You have to choose one or the other.

So the migration strategy is different. You configure the Destination on the function, but keep the DLQ in place for a grace period. Any existing messages in the DLQ continue to be processed by your error handling code. New failures route to the Destination. Once you're confident the Destination is working correctly and your downstream systems are handling the new payload format, you can remove the DLQ configuration.

Here's the sequence:

1. Create target resources for your Destination (SQS queue, SNS topic, etc.)
2. Configure Destination on the function using `put-function-event-invoke-config`
3. Test with a subset of traffic or in a non-production environment
4. Update your downstream processing logic to handle the Destination payload format
5. Gradually roll out to production
6. Once stable, remove the DLQ configuration

This gradual approach minimizes the risk of losing visibility into function failures during the transition.

### Choosing Between Destinations and DLQs

In most new projects, you should use Destinations. They're more flexible, more informative, and enable cleaner architectural patterns. The only reason to stick with DLQs is if you have legacy systems tightly integrated with the DLQ pattern or if you're constrained by older tooling that only understands SQS or SNS.

Use Destinations if you need to route both successes and failures, if you want to invoke downstream Lambdas based on invocation outcomes, or if you need EventBridge integration. Use Destinations if you want rich error information for debugging.

Use DLQs only if you're maintaining existing code that depends on them, or if your organization has specific constraints that prohibit Destinations. And even then, consider whether a migration to Destinations might simplify your architecture.

### Real-World Scenarios

Let's consider a few scenarios to cement understanding.

**Scenario 1: Image Processing Pipeline**

You have a Lambda function that processes images uploaded to S3. Successful processing should trigger notifications to users and update a metadata database. Failed processing should alert your operations team.

With Destinations, you could route successful invocations to an EventBridge event bus that fans out to both SNS (for user notifications) and another Lambda (for database updates). Failed invocations route to an SQS queue monitored by your ops dashboard.

With DLQs, you'd only capture failures. You'd need to implement the success handling logic inside the Lambda function itself, or use S3 event filtering to route successful results to another Lambda. This couples your invocation outcome handling to business logic, making the architecture harder to understand and maintain.

**Scenario 2: Order Processing with Compliance Logging**

Your order processing Lambda must log all invocations—successes and failures—to a compliance audit queue for regulatory purposes. This is a perfect Destination use case.

You configure two Destinations: OnSuccess routes to an SQS compliance queue, OnFailure routes to the same queue. Both payloads include complete request and response information for the audit trail.

With DLQs, you could only capture failures to the audit queue. Successful orders would need to be logged inside the function, introducing compliance logic into business code.

**Scenario 3: Machine Learning Inference with Feedback Loop**

Your Lambda function runs ML inference on data. You want to route successful predictions to a feature store and create a feedback loop where failures trigger retraining.

With Destinations, success routes to the feature store, failure routes to an SQS queue that a separate system consumes to generate retraining datasets. The failure Destination includes the input data and error information, perfect for understanding why the model failed.

With DLQs, you'd struggle. The DLQ only has the original input, no model output or error context. You'd need extensive logging inside the function.

### Event Invoke Configuration in Different Languages

While we've focused on CLI examples, you'll also configure Destinations and DLQs through Infrastructure-as-Code tools like CloudFormation or Terraform.

In CloudFormation, a Destination configuration looks like:

```yaml
Resources:
  MyFunctionEventInvokeConfig:
    Type: AWS::Lambda::EventInvokeConfig
    Properties:
      FunctionName: my-function
      Qualifier: LIVE
      MaximumEventAge: 3600
      MaximumRetryAttempts: 2
      DestinationConfig:
        OnSuccess:
          Type: EventBridge
          Destination: !GetAtt MyEventBus.Arn
        OnFailure:
          Type: SQS
          Destination: !GetAtt MyFailureQueue.Arn
```

With Terraform, you'd use `aws_lambda_function_event_invoke_config`:

```hcl
resource "aws_lambda_function_event_invoke_config" "example" {
  function_name = aws_lambda_function.my_function.function_name
  
  maximum_event_age       = 3600
  maximum_retry_attempts  = 2
  
  destination_config {
    on_failure {
      type            = "SQS"
      destination_arn = aws_sqs_queue.my_queue.arn
    }
    
    on_success {
      type            = "EventBridge"
      destination_arn = aws_cloudwatch_event_bus.my_bus.arn
    }
  }
}
```

These Infrastructure-as-Code approaches are highly preferable to CLI commands for production systems. They make your configuration version-controlled, testable, and reproducible.

### Troubleshooting Common Issues

**Messages not appearing in Destination**: Check that the Lambda execution role has permission to send to the destination resource. Also verify that the function is actually being invoked asynchronously. Synchronous invocations don't use Destinations.

**DLQ messages piling up**: This usually indicates a systemic problem with the function. Check function logs for the root cause. You might also check if the function is hitting throttling limits (which won't send messages to the DLQ). Consider implementing exponential backoff in your error handling code.

**Different payload structure than expected**: If you're migrating from DLQ to Destinations, your downstream processors expect the Destination payload format. The original event is now nested in `requestPayload`. Update your message parsing logic accordingly.

**EventBridge Destination not receiving messages**: Verify that the EventBridge rule's target is configured correctly. Also check that your Lambda execution role has `events:PutEvents` permission on the event bus.

### Best Practices

Always use `maximum-event-age` to ensure that stale events aren't processed hours later. Set it based on how fresh your data needs to be. For real-time systems, 300 seconds is reasonable. For batch-like workloads, 3600 seconds or more might be appropriate.

Log the Destination payload in your downstream processors. This helps with debugging and creates an audit trail of what Lambda actually returned. Don't assume the payload will always match your code's expectations—defensive parsing is your friend.

Monitor the Destination queue or topic for message volume. A sudden spike in failures should trigger an alert. Set up CloudWatch alarms on queue depth or message age so you catch problems quickly.

Consider whether you need both success and failure routing. If you only care about failures, a single OnFailure Destination is sufficient. If you're implementing complex workflows based on outcomes, make sure you've thought through the entire event flow before implementing.

### Conclusion

Lambda Destinations represent a meaningful evolution in how AWS handles asynchronous invocation outcomes. They provide richer information, more flexible routing, and cleaner architectural patterns than the legacy Dead Letter Queue approach. For any new Lambda-based application, Destinations should be your default choice for capturing and routing invocation outcomes.

That said, DLQs remain valid and useful, particularly for error-only scenarios where simpler tooling is available. The key is understanding the tradeoffs: DLQs are simpler but less flexible and informative, while Destinations require slightly more setup but unlock more sophisticated patterns.

As you build serverless systems, think about what happens after the Lambda invocation completes. Do you need to capture successes? Do different outcomes need different handling? Do you need rich error context for debugging? These questions point you toward Destinations. If you only need basic failure capture and your downstream systems are simple, DLQs might suffice. But in most modern architectures, Destinations are worth the modest additional complexity.
