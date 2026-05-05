---
title: "Configuring AWS SDK Retry Behavior: Standard, Adaptive, and Legacy Modes"
---

## Configuring AWS SDK Retry Behavior: Standard, Adaptive, and Legacy Modes

When working with AWS services, your code will occasionally encounter transient errors—network hiccups, service throttling, temporary unavailability. Rather than failing immediately, the AWS SDKs can automatically retry failed requests. However, not all retries are created equal. The way your SDK handles retries has profound implications for your application's resilience, latency, and resource consumption. Understanding the three retry modes available in modern AWS SDKs, and knowing how to configure them appropriately, is essential for building robust applications.

### Understanding Retry Behavior and Why It Matters

Before diving into the specific modes, let's establish why retry configuration is so important. When you make a request to an AWS service, several things can go wrong. Some failures are permanent—an invalid API key, a malformed request—and retrying won't help. But many failures are transient: the service is briefly overwhelmed, your network connection dropped momentarily, or AWS performed a routine maintenance operation. In these cases, retrying the request after a brief delay often succeeds.

The naive approach would be to retry immediately and as many times as possible. But that's counterproductive. If the DynamoDB table you're querying is throttled because of excessive throughput, hammering it with retries will only make the problem worse. A well-designed retry strategy needs to be intelligent—it should back off gradually, give the service time to recover, and ultimately protect the infrastructure from being crushed by retry storms.

The AWS SDKs implement different retry strategies through what's called "retry modes," and your choice of mode directly affects how your application behaves under stress.

### The Three Retry Modes Explained

The AWS SDKs support three distinct retry modes: legacy, standard, and adaptive. Each represents a different philosophy about how to balance resilience with resource efficiency.

#### Legacy Mode

Legacy mode is the older retry behavior, maintained primarily for backward compatibility. In legacy mode, the SDK retries requests up to a fixed number of times (typically three attempts, meaning up to two retries) with exponential backoff. The backoff calculation is straightforward: each retry waits for a duration that grows exponentially, often doubling between attempts.

Legacy mode is relatively simple but has a critical limitation: it doesn't account for service-side signals about capacity or load. If a service tells you it's overloaded, legacy mode doesn't adjust its retry strategy accordingly. It will keep retrying according to its fixed schedule regardless of whether the service is actually recovering. This can contribute to cascading failures when an AWS service experiences a brief outage—thousands of client applications retry simultaneously, overwhelming the service further.

Legacy mode is rarely the right choice for new applications. It's available mainly to ensure that existing code continues to work as expected.

#### Standard Mode

Standard mode represents AWS's recommended approach for most applications. It improves upon legacy mode in several important ways. First, it supports a higher default retry count (up to three retries by default, totaling four attempts). Second, it implements smarter retry logic that recognizes certain error types as non-retryable and fails fast rather than wasting time on doomed requests.

Standard mode uses exponential backoff with jitter, a technique that adds randomness to the wait time between retries. Jitter prevents the "thundering herd" problem where thousands of clients all retry at exactly the same moment, creating a synchronized spike in traffic. By spreading retries across time, jitter helps prevent overwhelming a recovering service.

The standard mode also recognizes a broader class of errors as retryable. For example, it understands that certain HTTP status codes (like 429 for throttling) are transient and should trigger a retry, while others (like 400 for bad request) are permanent and should fail immediately.

#### Adaptive Mode

Adaptive mode is the most sophisticated option and represents the future of AWS SDK retry behavior. Unlike standard and legacy modes, adaptive mode implements token bucket rate limiting on the client side. This is a crucial distinction.

In adaptive mode, the SDK maintains a virtual token bucket. Each successful request consumes tokens, and the bucket refills over time at a baseline rate. When a request fails with a retryable error, the SDK adjusts its token bucket parameters based on the error it received. If the error suggests the service is overloaded, the SDK reduces its token consumption rate, effectively throttling itself to prevent overwhelming the service further.

This creates a feedback loop: the client's retry behavior becomes responsive to actual service conditions rather than operating on a fixed schedule. If the service recovers quickly, the token bucket refills normally and the client resumes normal throughput. If the service remains stressed, the client continues to back off, waiting longer between attempts. This mechanism is far more effective at preventing retry storms and helping services recover from temporary overloads.

Adaptive mode also typically allows more retries than standard mode (up to eight retries by default), because the token bucket mechanism ensures that excessive retries won't happen in practice. The token bucket limits how much traffic you can send even if you're technically allowed to retry.

### Comparing the Three Modes

To clarify the differences, consider this scenario: a DynamoDB table becomes temporarily throttled because of a sudden traffic spike. A standard mode client might make four attempts within the span of a few seconds, none of which succeed, and then give up. An adaptive mode client, in contrast, would sense the throttling error, reduce its token bucket rate, wait significantly longer between retries, and give the table more time to recover.

Standard mode excels for applications with predictable, steady-state traffic patterns and occasional transient errors. Adaptive mode excels for applications that need to coexist peacefully with other clients and services, especially in environments where resource contention is possible.

### Configuring Retry Modes

Now that we understand what each mode does, let's explore how to configure them. AWS SDKs provide multiple ways to specify retry behavior: environment variables, client configuration, and per-request overrides.

#### Environment Variables

The simplest way to set a default retry mode for your entire application is through environment variables. The `AWS_RETRY_MODE` environment variable accepts three values: `legacy`, `standard`, or `adaptive`.

```bash
export AWS_RETRY_MODE=adaptive
```

Once set, every AWS SDK client you create in your application will use that retry mode unless explicitly overridden. Similarly, you can control the maximum number of retry attempts using the `AWS_MAX_ATTEMPTS` environment variable:

```bash
export AWS_MAX_ATTEMPTS=5
```

This tells the SDK to try up to five times total (meaning up to four retries). Setting these environment variables is particularly useful in containerized environments where you want consistent behavior across all instances of your application.

#### Python Configuration with Boto3

For Python developers using boto3, retry configuration happens at the client level. You can specify retry behavior when creating a client by passing a `Config` object:

```python
import boto3
from botocore.config import Config

# Create a client with adaptive retry mode and custom max attempts
retry_config = Config(
    retries={
        'mode': 'adaptive',
        'max_attempts': 5
    }
)

dynamodb = boto3.client('dynamodb', config=retry_config)
```

This configuration is explicit and takes precedence over environment variables. It allows you to have different retry strategies for different AWS services within the same application. For instance, you might use adaptive mode for DynamoDB (where throughput is a common constraint) but standard mode for S3 (where retries are rarely necessary).

You can also configure retries at a higher level that applies to all clients:

```python
from botocore.session import Session
from botocore.config import Config

session = Session()
session.set_config_variable('retries', {
    'mode': 'adaptive',
    'max_attempts': 5
})

# All clients created from this session will use the retry config
dynamodb = session.create_client('dynamodb')
s3 = session.create_client('s3')
```

If you need even finer control, you can specify retry behavior in a botocore configuration file located at `~/.aws/config`:

```ini
[default]
retries =
    mode = adaptive
    max_attempts = 5
```

Boto3 respects this file automatically, so you don't need to change your code—environment variables and configuration files work transparently.

#### Node.js Configuration with AWS SDK v3

JavaScript developers using the AWS SDK for JavaScript v3 have similarly flexible options. Configuration happens at the client level through the `retryStrategy` and related parameters:

```javascript
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { StandardRetryStrategy } from "@aws-sdk/util-retry";

const client = new DynamoDBClient({
  region: "us-east-1",
  retryStrategy: new StandardRetryStrategy(async () => 3), // 3 max attempts
});
```

For adaptive mode, the SDK v3 provides the `AdaptiveRetryStrategy`:

```javascript
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { AdaptiveRetryStrategy } from "@aws-sdk/util-adaptive-retry";

const client = new DynamoDBClient({
  region: "us-east-1",
  retryStrategy: new AdaptiveRetryStrategy(async () => 5), // 5 max attempts
});
```

Alternatively, you can rely on environment variables. The Node.js SDK v3 respects `AWS_RETRY_MODE` and `AWS_MAX_ATTEMPTS`, so you don't need to configure anything in code if you're setting these at the environment level.

#### Java Configuration with AWS SDK v2

In Java, retry configuration is typically set through the `ClientConfiguration` object:

```java
import software.amazon.awssdk.core.client.config.ClientOverrideConfiguration;
import software.amazon.awssdk.core.retry.RetryMode;
import software.amazon.awssdk.services.dynamodb.DynamoDbClient;

ClientOverrideConfiguration overrideConfig = ClientOverrideConfiguration.builder()
    .retryMode(RetryMode.ADAPTIVE)
    .maxAttempts(5)
    .build();

DynamoDbClient dynamoDb = DynamoDbClient.builder()
    .overrideConfiguration(overrideConfig)
    .build();
```

Java also respects the environment variables, so if you're running in an environment where `AWS_RETRY_MODE=adaptive` is already set, you don't need to configure anything in code.

### When to Override Default Retry Behavior

While the default retry configuration is sensible for most use cases, situations arise where you need to customize it.

If you're implementing a request handler that has a hard time constraint—for instance, an API endpoint that must respond within 100 milliseconds—you might want to reduce `max_attempts` to avoid spending too much time on retries. A single failed request with three retries could easily exceed your latency budget, whereas failing fast and returning an error to the client might be preferable.

Conversely, if you're running a batch job that processes millions of records and latency is not a concern, you might increase `max_attempts` to give transient errors more opportunities to resolve. A batch job that completes in 10 minutes versus 11 minutes is rarely a concern, but a batch job that fails outright because it gave up too quickly is a real problem.

Different AWS services also have different characteristics. Services like S3 are highly available and rarely experience transient errors, so aggressive retry behavior is unnecessary. Services like DynamoDB, which can experience throttling when provisioned capacity is exceeded, benefit from more sophisticated retry strategies that can adapt to load.

Some applications implement custom retry logic on top of the SDK's built-in behavior. For example, you might wrap SDK calls in your own retry loop with custom backoff logic, circuit breakers, or fallback strategies. When doing this, be aware that you're now responsible for avoiding retry storms and cascading failures. The SDK's retry mechanisms exist partly to protect the broader AWS infrastructure, so overriding them without careful thought can cause problems.

### Understanding Retryable vs. Non-Retryable Errors

Not every error should trigger a retry. Some errors are permanent and will never succeed no matter how many times you try. The SDK automatically classifies errors into these categories, but understanding which errors are considered retryable helps you design better error handling.

Transient errors that trigger retries include throttling errors (HTTP 429), temporary service unavailability (HTTP 503), request timeout errors, and connection errors. These errors indicate that the infrastructure is stressed or temporarily unavailable, but the underlying request was valid and might succeed if tried again later.

Permanent errors that do not trigger retries include authentication failures (invalid credentials), authorization failures (insufficient permissions), malformed requests (invalid parameters), and resource not found errors. These errors indicate a problem with the request itself rather than the service state, so retrying won't help.

There's a gray area with some errors. For instance, a 500 error (Internal Server Error) is sometimes transient and sometimes permanent, depending on the service and the specific situation. The SDK's error classification logic tries to be intelligent about this, but it's not perfect. This is another reason why understanding your workload is important.

### Best Practices for Retry Configuration

Given the flexibility of retry configuration, here are some practical guidelines for making good choices:

Start with adaptive mode as your default. It's the most sophisticated option and is designed to handle a wide variety of scenarios gracefully. Unless you have a specific reason to use standard or legacy mode, adaptive is your safest bet.

Use environment variables for consistency across environments. Rather than hardcoding retry configuration in your application code, set `AWS_RETRY_MODE` and `AWS_MAX_ATTEMPTS` in your environment. This allows you to adjust retry behavior without redeploying your code, which is especially valuable when you're responding to incidents or running experiments.

Consider reducing max_attempts for latency-sensitive operations. If an operation has a strict latency requirement, configure it with fewer max_attempts or consider using standard mode instead of adaptive. Remember that adaptive mode's token bucket can cause retries to take longer than expected if the service is under stress.

Increase max_attempts for batch and asynchronous operations. When latency is not critical, more retries give transient errors a better chance of resolving. This is particularly important for applications that process large volumes of data and can't afford to fail on individual records.

Monitor retry behavior in production. Most AWS services provide CloudWatch metrics that show throttling, errors, and retries. By monitoring these metrics, you can understand whether your retry configuration is helping or hurting your application's performance. If you're seeing high retry rates with low success rates, your configuration might be too aggressive.

Avoid implementing custom retry logic on top of the SDK's retries unless you have a very specific need. The SDK's retry mechanisms are carefully designed to balance resilience with the health of AWS infrastructure. If you implement your own retries, you risk creating retry storms or cascading failures.

### Troubleshooting Retry Issues

When applications experience problems related to retries, the symptoms are usually high latency or excessive errors. If your application's latency has suddenly increased, check whether you're in adaptive mode with a high max_attempts. The token bucket might be throttling you due to previous errors. Looking at CloudWatch metrics for your DynamoDB tables or other services can reveal whether throttling is happening.

If you're seeing cascading failures where one service's problems cause another service to fail, your retry configuration might be too aggressive. In these situations, reducing max_attempts or switching from adaptive mode to standard mode can help contain the blast radius of an outage.

Conversely, if you're seeing transient errors that could have been recovered from but weren't, your max_attempts might be too low. Increasing it slightly often resolves the issue.

When debugging retry behavior, enable debug logging in your SDK. This shows the actual HTTP requests and responses, including which requests were retried and why. This visibility is invaluable when troubleshooting retry-related issues.

### Conclusion

Configuring AWS SDK retry behavior is not a one-time task but an important aspect of building resilient, production-grade applications. The three retry modes—legacy, standard, and adaptive—represent increasing levels of sophistication, with adaptive mode offering the best balance of resilience and efficiency through token bucket rate limiting.

By understanding the differences between these modes, using environment variables and configuration objects to set them appropriately, and monitoring retry behavior in production, you can ensure that your applications gracefully handle transient failures while protecting both themselves and the broader AWS infrastructure from retry storms. Start with adaptive mode as your default, adjust based on your specific operational requirements, and always monitor the results.
