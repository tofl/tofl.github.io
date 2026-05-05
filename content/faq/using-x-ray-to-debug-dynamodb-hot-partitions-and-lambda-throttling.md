---
title: "Using X-Ray to Debug DynamoDB Hot Partitions and Lambda Throttling"
---

## Using X-Ray to Debug DynamoDB Hot Partitions and Lambda Throttling

When things go wrong in a distributed AWS application, the symptoms are often clear: requests are slow, errors are climbing, and your users are frustrated. But pinpointing *why* these problems occur is where many developers get stuck. You might see elevated latency in CloudWatch metrics, but which operation is actually slow? Is it your DynamoDB write, your Lambda function, or the network between them? This is where AWS X-Ray becomes indispensable.

X-Ray is AWS's distributed tracing service, and it excels at one thing: showing you exactly what happened to a request as it traveled through your entire system. Unlike CloudWatch metrics, which tell you *that* something is wrong, X-Ray tells you *what* is wrong and often hints at *why*. In this guide, we'll explore how to use X-Ray to identify the specific performance bottlenecks that plague serverless applications—particularly DynamoDB hot partitions and Lambda throttling—and how to correlate these findings with other AWS observability tools to arrive at actionable insights.

### Understanding X-Ray Basics and Service Maps

Before diving into specific troubleshooting scenarios, let's establish a foundation. X-Ray works by collecting trace data from your application and AWS services as requests flow through your system. Each request generates a trace, which is composed of segments and subsegments. A segment represents a unit of work (like a Lambda invocation), while subsegments represent downstream calls (like a DynamoDB query or an HTTP call to another service).

The magic happens when you visualize these traces in the X-Ray console. You'll see a service map that shows how your services communicate with each other. More importantly, you'll see timing breakdowns that reveal exactly how long each operation took. The service map itself provides high-level insights—you can quickly spot which services are communicating with which—but the real diagnostic power lies in drilling down into individual traces.

X-Ray is not enabled by default on all AWS services. For Lambda, you need to enable active tracing, either through the console, infrastructure-as-code, or the AWS CLI. For DynamoDB, X-Ray integration is built in, but you need to ensure your application's IAM role has permissions to write traces. Similarly, your application code needs to use the X-Ray SDK to instrument custom code or external service calls.

### Setting Up X-Ray for Lambda and DynamoDB

To start collecting meaningful trace data, you'll need to enable X-Ray tracing on your Lambda functions and ensure your DynamoDB calls are instrumented. For Lambda, this is straightforward: go to your function's configuration and enable active tracing. This allows Lambda to send trace data to X-Ray automatically.

For custom code and AWS SDK calls within Lambda, you'll want to use the X-Ray SDK for your language of choice. For Node.js, for example, you'd install the aws-xray-sdk-core package and patch your AWS SDK client. Here's a minimal example:

```javascript
const AWSXRay = require('aws-xray-sdk-core');
const AWS = require('aws-sdk');

const dynamodb = AWSXRay.client(new AWS.DynamoDB.DocumentClient());

exports.handler = async (event) => {
  const params = {
    TableName: 'Orders',
    Item: {
      orderId: event.orderId,
      amount: event.amount,
      timestamp: Date.now()
    }
  };

  try {
    await dynamodb.put(params).promise();
    return { statusCode: 200, body: 'Order created' };
  } catch (error) {
    console.error('DynamoDB error:', error);
    throw error;
  }
};
```

By wrapping the DynamoDB client with `AWSXRay.client()`, every operation will automatically generate subsegments in your X-Ray traces. This allows X-Ray to measure the duration of each DynamoDB call and collect metadata about the operation.

Similarly, for Python, you'd use the aws-xray-sdk package:

```python
from aws_xray_sdk.core import xray_recorder
from aws_xray_sdk.core import patch_all
import boto3

patch_all()

dynamodb = boto3.resource('dynamodb')

def lambda_handler(event, context):
    table = dynamodb.Table('Orders')
    
    response = table.put_item(
        Item={
            'orderId': event['orderId'],
            'amount': event['amount'],
            'timestamp': int(time.time() * 1000)
        }
    )
    
    return {'statusCode': 200, 'body': 'Order created'}
```

The `patch_all()` function automatically instruments boto3 calls, eliminating the need to manually wrap each client.

### Identifying DynamoDB Hot Partitions Through X-Ray Traces

A hot partition in DynamoDB occurs when write or read traffic is concentrated on a small number of partition keys. This causes those partitions to throttle while other partitions sit idle. The problem is particularly insidious because CloudWatch metrics show you aggregate throughput, masking the fact that specific partitions are maxed out.

Here's where X-Ray shines. When you examine a trace for a slow DynamoDB write, X-Ray shows you not just that the operation was slow, but also includes the partition key value in the trace metadata. This is crucial for root cause analysis.

Let's walk through a concrete scenario. Imagine you're running an e-commerce platform where customers place orders. Your Orders table uses `customerId` as the partition key. One particular customer—say, a major retailer testing your system—is placing orders at a much higher rate than others. This creates a hot partition.

When you invoke the Lambda function and monitor it in X-Ray, you'll see something like this in the trace details:

- The Lambda segment shows the total invocation time is 850ms
- The DynamoDB put_item subsegment shows 800ms
- The DynamoDB subsegment includes an annotation with the partition key: `customerId: CUSTOMER-12345`

Now, if multiple invocations of this same Lambda show consistently high DynamoDB latency, all annotated with the same or a small set of `customerId` values, you've identified your hot partition.

To add custom annotations to your traces—like the partition key—you can use the X-Ray SDK's annotation features:

```javascript
const AWSXRay = require('aws-xray-sdk-core');

const segment = AWSXRay.getSegment();

exports.handler = async (event) => {
  const customerId = event.customerId;
  
  if (segment) {
    segment.addAnnotation('customerId', customerId);
    segment.addMetadata('orderDetails', {
      amount: event.amount,
      timestamp: new Date().toISOString()
    });
  }

  // DynamoDB call here
  const params = {
    TableName: 'Orders',
    Item: { customerId, amount: event.amount }
  };

  await dynamodb.put(params).promise();
  
  return { statusCode: 200 };
};
```

Annotations are indexed and searchable, making it easy to filter traces by specific values. Once you've added the partition key as an annotation, you can use the X-Ray filter expression to show only traces for that hot partition:

```
service("Orders") AND annotation("customerId", "CUSTOMER-12345")
```

This immediately reveals patterns: if all traces for that customer show high DynamoDB latency while traces for other customers are fast, you're definitely looking at a hot partition.

### Diagnosing Lambda Throttling with X-Ray

Lambda throttling happens when your function's concurrency limit is reached. AWS queues additional invocations, delaying their start time. The symptom is a spike in invocation latency that doesn't correlate with the function's actual execution time. This is notoriously tricky to diagnose because the delay happens *before* your function code even starts executing.

X-Ray makes this visible. When you examine a trace for a throttled Lambda invocation, you'll notice a gap between the timestamp when the invocation was received and when the function code actually began. This gap represents the time the invocation spent in the queue waiting for a concurrent execution slot to become available.

Let's say your Lambda function processes messages from an SQS queue. During a traffic spike, the SQS queue generates hundreds of invocations, but your Lambda concurrency is set to 100. The first 100 invocations run concurrently, but the rest wait. In X-Ray, this manifests as a trace where the function's `start_time` is much later than the trace's `timestamp`.

To observe this pattern, look at the trace timeline in the X-Ray console:

1. **Trace received at 10:15:32.100**
2. **Lambda segment starts at 10:15:33.750** (a 1.65-second delay!)
3. **Function code executes in 150ms**
4. **Total user-perceived latency: ~1.8 seconds**

Without X-Ray, you'd see only the total latency. With X-Ray, you immediately understand that the function itself was fast, but the invocation was queued for nearly two seconds.

To get more granular visibility into throttling, you can add custom instrumentation:

```javascript
const AWSXRay = require('aws-xray-sdk-core');

exports.handler = async (event, context) => {
  const segment = AWSXRay.getSegment();
  
  // Record when function execution actually begins
  const executionStart = Date.now();
  const queueWaitTime = executionStart - context.getRemainingTime() 
    - (event.requestContext?.requestTimeEpoch || 0);
  
  if (segment) {
    segment.addMetadata('performance', {
      queueWaitTimeMs: queueWaitTime,
      remainingTimeMs: context.getRemainingTime()
    });
  }

  // Your function logic here
  
  return { statusCode: 200 };
};
```

This gives you explicit visibility into queue wait time, which you can then correlate with concurrency metrics from CloudWatch.

### Correlating X-Ray Traces with CloudWatch Metrics

X-Ray traces are invaluable, but they're most powerful when combined with CloudWatch metrics. Here's why: a single X-Ray trace shows you what happened to one request. But to understand a systemic problem, you need to see patterns across many requests. CloudWatch metrics provide this aggregate view.

Let's build on our hot partition example. You see in X-Ray that trace after trace for `customerId: CUSTOMER-12345` shows high DynamoDB latency. Now, flip to CloudWatch and look at the DynamoDB metrics for the Orders table. Specifically, examine `ConsumedWriteCapacityUnits`. If you see that the table is consistently at or above its provisioned write capacity (or if you're using on-demand billing, you can look at `UserErrors` metric with a filter for ProvisionedThroughputExceededException), you've confirmed the hot partition is causing throttling.

Further, you can create a CloudWatch Insights query to correlate the traces you've seen in X-Ray with the logs generated by your Lambda function:

```
fields @timestamp, @duration, customerId, @message
| filter customerId = "CUSTOMER-12345"
| stats avg(@duration) as avgDuration, max(@duration) as maxDuration by customerId
```

This query shows you the average and maximum duration for orders from that customer, giving you a quantitative sense of the problem's severity.

Similarly, for Lambda throttling, you can use CloudWatch Insights to find invocations with high initialization overhead (which often correlates with throttling):

```
fields @timestamp, @duration, @initDuration
| stats avg(@duration) as avgDuration, avg(@initDuration) as avgInit
| filter avgDuration > 1000
```

### Practical Walkthrough: Slow DynamoDB Write Revealing a Hot Partition

Let's work through a complete scenario to tie everything together. Suppose you're running a real-time notification system. Your NotificationEvents table uses `userId` as the partition key. Traffic is generally healthy, but you've noticed occasional spikes where DynamoDB writes timeout.

**Step 1: Enable X-Ray and Instrumentation**

First, ensure your Lambda function has active tracing enabled and the X-Ray SDK is integrated:

```javascript
const AWSXRay = require('aws-xray-sdk-core');
const AWS = require('aws-sdk');

const dynamodb = AWSXRay.client(new AWS.DynamoDB.DocumentClient());

exports.handler = async (event) => {
  const segment = AWSXRay.getSegment();
  
  const userId = event.userId;
  segment?.addAnnotation('userId', userId);
  segment?.addAnnotation('eventType', event.eventType);
  
  try {
    await dynamodb.put({
      TableName: 'NotificationEvents',
      Item: {
        userId,
        eventTimestamp: Date.now(),
        eventType: event.eventType,
        data: event.data
      }
    }).promise();
    
    return { statusCode: 200 };
  } catch (error) {
    segment?.addError(error);
    throw error;
  }
};
```

**Step 2: Observe Failures in X-Ray**

When timeouts occur, navigate to the X-Ray console and filter for error traces:

```
service("NotificationService") AND http.status >= 400
```

Examine a few of these error traces. You'll see that the DynamoDB put_item call took 30+ seconds before timing out. Note the `userId` values in the annotations.

**Step 3: Identify the Pattern**

As you examine multiple error traces, you notice that most of them have the same or a very small set of `userId` values. For example, `userId: USER-BROADCAST` appears in 80% of the failed traces.

**Step 4: Correlate with CloudWatch**

Jump to CloudWatch and check the DynamoDB metrics for the NotificationEvents table. Look at `ConsumedWriteCapacityUnits` over the same time period. You'll see sharp spikes that correspond to the timeouts you saw in X-Ray. If you're using provisioned capacity, these spikes exceed your provisioned write throughput.

Check your DynamoDB table configuration. You realize that USER-BROADCAST is a system account used for broadcasting notifications to all users. Every notification sent by this account creates a separate write to the NotificationEvents table with the same partition key, flooding that single partition.

**Step 5: Implement a Solution**

Now that you've identified the root cause, you can fix it. Options include:

- Using a composite partition key (e.g., `userId + notificationId`) to distribute writes across multiple partitions
- Implementing write sharding by adding a random suffix to the partition key
- Using a time-series database better suited to high-write scenarios
- Implementing a batching strategy to write fewer but larger items

With X-Ray, you've transformed a vague "DynamoDB timeouts" problem into a specific, understandable issue with a clear solution.

### Advanced X-Ray Features for Performance Analysis

Beyond basic trace examination, X-Ray offers several advanced features worth exploring. The **X-Ray service map** provides a visual overview of your architecture and shows latency between services. If you notice a thick red line between Lambda and DynamoDB, that's a visual cue that something is slow. The service map also calculates the error rate between services, helping you identify which boundaries have problems.

The **trace analytics** feature uses machine learning to automatically detect anomalies in your traces. If the average latency for a particular operation suddenly increases, X-Ray will flag it. This is particularly useful for catching problems before they become critical.

**Sampling** is another important consideration. By default, X-Ray samples only a fraction of requests (typically 1 request per second plus 5% of additional requests). This is fine for high-volume applications and reduces costs, but if you're trying to debug an intermittent hot partition issue, you might temporarily increase the sampling rate to capture more data. You can configure sampling rules in the X-Ray console.

For applications with strict compliance or performance requirements, you might also configure **encryption** for X-Ray data at rest. This is handled transparently by AWS and doesn't affect your trace collection.

### Best Practices for X-Ray-Driven Troubleshooting

To get the most value from X-Ray, establish a few practices. First, **instrument at the right granularity**. Don't just rely on automatic instrumentation; add custom annotations for business-critical identifiers like user IDs, account IDs, or request types. These make filtering and pattern-matching much easier when diagnosing issues.

Second, **use meaningful naming for custom segments and subsegments**. Instead of a subsegment called "query," call it "getUserProfile" or "checkInventory." When you're scrolling through traces, descriptive names help you quickly understand what each operation does.

Third, **record relevant metadata alongside annotations**. Annotations are searchable but limited in size; metadata is not searchable but can contain more detailed information. Use annotations for filtering (like partition keys) and metadata for context (like the full request payload or response status).

Fourth, **combine X-Ray with other observability tools**. X-Ray is powerful, but it's not a replacement for CloudWatch Logs or Metrics. Use X-Ray to identify *which* requests are problematic, then use CloudWatch Logs to understand *why* they're problematic, and CloudWatch Metrics to quantify the *scale* of the problem.

### Conclusion

AWS X-Ray transforms distributed application troubleshooting from a guessing game into a systematic process. By showing you exactly how long each operation took and which services communicate with which, X-Ray cuts through the noise to reveal the true bottlenecks in your system.

When you encounter DynamoDB hot partitions, X-Ray shows you the specific partition key values causing problems. When Lambda throttling strikes, X-Ray reveals the queue wait time that users are experiencing. And by correlating X-Ray traces with CloudWatch metrics and logs, you gain a complete picture of what went wrong and why.

The key to effective X-Ray usage is instrumenting your code intentionally, adding annotations for searchable identifiers, and developing a habit of consulting X-Ray traces when performance issues arise. Combine this with the other observability tools in the AWS ecosystem, and you'll build a formidable capability for maintaining and debugging complex serverless applications. Start small—enable tracing on one function, add a few annotations for critical business values, and let X-Ray guide your troubleshooting process. The insights you gain will be well worth the effort.
