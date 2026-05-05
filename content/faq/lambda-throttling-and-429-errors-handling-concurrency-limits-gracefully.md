---
title: "Lambda Throttling and 429 Errors: Handling Concurrency Limits Gracefully"
---

## Lambda Throttling and 429 Errors: Handling Concurrency Limits Gracefully

AWS Lambda is built on a shared infrastructure model, which means your functions run within a carefully managed execution environment. One of the most important constraints you'll encounter in production is concurrency throttling. Understanding how and why Lambda throttles requests—and how to handle it gracefully—is essential for building reliable applications at scale. This article explores the mechanics of Lambda throttling, the distinction between different throttling scenarios, and the patterns you need to implement when things go wrong.

### Understanding Lambda Concurrency Limits

Before we dive into throttling itself, we need to establish what concurrency means in the Lambda world. Concurrency is simply the number of Lambda function instances that are executing simultaneously at any given moment. AWS imposes an account-level concurrency limit to ensure fair resource distribution across all customers in a region. By default, this limit is 1,000 concurrent executions per region, though you can request an increase by opening a support case.

This is where throttling enters the picture. When your Lambda function receives a request but there are no available execution environments—because you've already hit your concurrency limit—AWS must decide what to do. The answer depends on how you invoked the function.

### Synchronous Invocations and Immediate Rejection

When you invoke a Lambda function synchronously (the most common pattern, used by API Gateway, Application Load Balancer, and direct SDK calls), the caller expects a response. If Lambda has no available capacity, it cannot queue the request to be processed later—the caller is waiting on the line, so to speak. Instead, Lambda immediately returns an error: a `TooManyRequestsException` with an HTTP 429 status code.

This is a crucial distinction. The 429 error doesn't mean "your service is down" or "something went wrong in my code." It means "I received your request, but I don't have the capacity to process it right now." From the caller's perspective, this is a retriable error. The request wasn't processed, but it also wasn't rejected because of a bug or misconfiguration.

Let's look at how this surfaces in practice. When you use API Gateway to invoke a Lambda function synchronously, and throttling occurs, the client receives:

```
HTTP/1.1 429 Too Many Requests
Content-Type: application/json

{
  "message": "Throttling Exception"
}
```

The same applies when using an Application Load Balancer as the trigger. The ALB passes through the 429 response to the client.

### Asynchronous Invocations and Internal Queueing

Here's where things get interesting. When you invoke a Lambda function asynchronously—using SNS, SQS, S3 events, or explicit async invocation via the SDK—the behavior is fundamentally different. The caller doesn't wait for a response. Instead, AWS Lambda accepts the invocation and adds it to an internal queue. Your function will execute as soon as capacity becomes available.

This internal queue has its own limits and behavior. Lambda attempts to process queued requests with built-in retry logic. If your function fails during asynchronous invocation, Lambda retries automatically (twice, by default, though you can configure this). The key point is that throttling during asynchronous invocation is handled internally—the caller doesn't see an error immediately.

However, this doesn't mean throttling is invisible. If the internal queue grows too large or retries are exhausted, Lambda can still discard the event. To prevent silent failures, you should configure a Dead Letter Queue (DLQ) to capture events that ultimately couldn't be processed. This might be an SQS queue or an SNS topic.

### Account-Level vs. Reserved Concurrency

AWS provides two different concurrency limits, and they interact in important ways.

The **account-level concurrency limit** is a regional ceiling. Across all Lambda functions in a region, you can have at most 1,000 concurrent executions (by default). This is a shared resource pool. If one function uses 800 of those 1,000 slots, only 200 remain for all other functions in the region.

To protect critical functions from being starved by bursty traffic to other functions, you can allocate **reserved concurrency**. When you set a reserved concurrency value for a function—say, 100 concurrent executions—you guarantee that those 100 slots are reserved exclusively for that function. The account-level limit still applies; reserved concurrency is simply a subset of it carved out for a specific function.

There's also **provisioned concurrency**, which is different. Provisioned concurrency means Lambda keeps execution environments warm and ready to go, eliminating cold start latency. It's useful for latency-sensitive workloads, but it's a premium feature with associated costs.

When a function with reserved concurrency receives more requests than its reserved quota allows, those excess requests are throttled. Functions without reserved concurrency share the remaining account-level capacity on a first-come, first-served basis. If that shared pool is exhausted, they're throttled too.

### The 429 TooManyRequestsException

When synchronous throttling occurs, the SDK throws a `TooManyRequestsException`. The exact form depends on your language and SDK.

In Python with boto3, throttling might look like this:

```python
import boto3
from botocore.exceptions import ClientError

lambda_client = boto3.client('lambda')

try:
    response = lambda_client.invoke(
        FunctionName='my-function',
        InvocationType='RequestResponse',
        Payload=b'{"key": "value"}'
    )
except ClientError as e:
    if e.response['Error']['Code'] == 'TooManyRequestsException':
        print("Function is throttled. Implement backoff and retry.")
    else:
        print(f"Other error: {e}")
```

In Node.js with the AWS SDK v3, the pattern is similar:

```javascript
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";

const client = new LambdaClient({});

try {
    const command = new InvokeCommand({
        FunctionName: 'my-function',
        InvocationType: 'RequestResponse',
        Payload: JSON.stringify({ key: 'value' })
    });
    const response = await client.send(command);
} catch (error) {
    if (error.name === 'TooManyRequestsException') {
        console.log('Lambda is throttled. Retry with backoff.');
    } else {
        console.error('Other error:', error);
    }
}
```

The key insight is that catching `TooManyRequestsException` is the signal to back off and retry, not to fail immediately.

### How API Gateway Surfaces Throttling

When Lambda is throttled and you're invoking it through API Gateway, the client receives a 429 response. However, API Gateway itself also has throttling limits independent of Lambda. You might see a 429 from API Gateway before you ever hit Lambda throttling—API Gateway enforces rate limits and burst capacity at the gateway level.

The distinction matters for debugging. If a client is receiving 429 errors, you need to determine whether the bottleneck is:

1. **API Gateway throttling**: Check the API Gateway stage settings for rate limit and burst capacity. You can increase these limits.
2. **Lambda account-level concurrency**: Check CloudWatch metrics for your function. If invocation count is lower than error count, or if you see throttle metrics spiking, this is your culprit.
3. **Function-level reserved concurrency**: If a function has reserved concurrency set lower than the incoming load, it will be throttled even if account-level capacity exists.

### Application Load Balancer and Throttling

Application Load Balancer (ALB) integrates with Lambda as a target type. When you invoke a function through an ALB and Lambda returns a 429, the ALB passes this through to the client as-is. The ALB doesn't retry or buffer; it simply forwards the response.

This is different from how ALB handles backend instances in an Auto Scaling group, where the load balancer can route around unhealthy targets. With Lambda, there's nowhere else to route to—the function either has capacity or it doesn't.

### Exponential Backoff with Jitter

The industry-standard approach to handling 429 errors is exponential backoff with jitter. The idea is simple: when you get throttled, wait a bit before retrying. And with each successive retry, wait a little longer. The jitter component prevents the "thundering herd" problem, where multiple clients all retry at exactly the same time, causing another wave of throttling.

Here's a robust implementation in Python:

```python
import time
import random
import boto3
from botocore.exceptions import ClientError

lambda_client = boto3.client('lambda')

def invoke_with_backoff(function_name, payload, max_retries=5):
    for attempt in range(max_retries):
        try:
            response = lambda_client.invoke(
                FunctionName=function_name,
                InvocationType='RequestResponse',
                Payload=payload
            )
            return response
        except ClientError as e:
            if e.response['Error']['Code'] != 'TooManyRequestsException':
                raise
            
            if attempt == max_retries - 1:
                raise
            
            # Exponential backoff: 2^attempt seconds, plus jitter
            base_delay = 2 ** attempt
            jitter = random.uniform(0, base_delay * 0.1)
            delay = base_delay + jitter
            
            print(f"Throttled on attempt {attempt + 1}. Retrying in {delay:.2f}s")
            time.sleep(delay)
    
    raise Exception("Max retries exceeded")

# Usage
try:
    result = invoke_with_backoff('my-function', b'{"data": "test"}')
except Exception as e:
    print(f"Failed after retries: {e}")
```

And here's the equivalent in Node.js:

```javascript
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";

const client = new LambdaClient({});

async function invokeWithBackoff(functionName, payload, maxRetries = 5) {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            const command = new InvokeCommand({
                FunctionName: functionName,
                InvocationType: 'RequestResponse',
                Payload: JSON.stringify(payload)
            });
            return await client.send(command);
        } catch (error) {
            if (error.name !== 'TooManyRequestsException') {
                throw error;
            }
            
            if (attempt === maxRetries - 1) {
                throw error;
            }
            
            const baseDelay = Math.pow(2, attempt);
            const jitter = Math.random() * baseDelay * 0.1;
            const delay = (baseDelay + jitter) * 1000; // Convert to milliseconds
            
            console.log(`Throttled on attempt ${attempt + 1}. Retrying in ${(delay / 1000).toFixed(2)}s`);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
    
    throw new Error('Max retries exceeded');
}

// Usage
try {
    const result = await invokeWithBackoff('my-function', { data: 'test' });
    console.log('Success:', result);
} catch (error) {
    console.error('Failed after retries:', error);
}
```

Notice the pattern: we wait `2^attempt` seconds before the next retry, with a small amount of randomness added. The jitter ensures that if multiple clients are retrying simultaneously, they don't all slam the function at the same time.

### Monitoring and Observability

Throttling isn't always obvious unless you're looking for it. Lambda publishes throttling events to CloudWatch, but they can be easy to miss. You should instrument your code to log throttling events explicitly, as shown in the examples above.

Additionally, set up CloudWatch alarms for the `Throttles` metric on your Lambda function. This metric counts the number of invocation attempts that were throttled. A spike in throttles is often an early warning sign that you need to increase concurrency, add reserved concurrency to critical functions, or investigate unexpected traffic patterns.

For asynchronous invocations, monitor the Dead Letter Queue. If events are accumulating in your DLQ, it's a sign that throttling or other failures are preventing processing.

### Strategies to Prevent Throttling

While handling throttling gracefully is important, preventing it in the first place is better. Here are some practical strategies:

**Reserve concurrency for critical functions.** If certain functions are essential to your application (payment processing, authentication, etc.), allocate reserved concurrency to them. This guarantees capacity and prevents noisy neighbors from affecting them.

**Use asynchronous invocation where appropriate.** If a task doesn't need an immediate response, use SNS, SQS, or EventBridge to invoke Lambda asynchronously. This leverages Lambda's internal queueing and built-in retry logic.

**Implement queuing at the application level.** Rather than invoking Lambda directly when load is unpredictable, send events to SQS or SNS first. Let Lambda consume from these queues at its own pace. This decouples the producer from Lambda and prevents overwhelming it.

**Right-size your concurrency limits.** If you consistently hit your account-level limit, request an increase. AWS doesn't restrict increases arbitrarily; they're usually granted quickly for legitimate use cases.

**Use Lambda Provisioned Concurrency for predictable demand.** If you have scheduled events or known traffic patterns, provisioned concurrency keeps environments warm. It costs more, but eliminates cold starts and ensures capacity is always available.

### The Bigger Picture

Throttling is a natural consequence of sharing infrastructure at scale. Rather than viewing it as a failure, think of it as a useful signal. It tells you when demand exceeds capacity, giving you actionable data to optimize your architecture.

The combination of understanding throttling mechanics, implementing exponential backoff with jitter in your client code, and strategically using reserved concurrency creates a resilient system that degrades gracefully under load instead of failing catastrophically. Your applications will be more reliable, and your users will experience better service, even during traffic spikes.
