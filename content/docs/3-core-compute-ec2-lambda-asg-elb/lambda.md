---
title: "6. Lambda"
type: docs
weight: 2
---

## AWS Lambda

Modern applications often need to run small, discrete pieces of logic in response to events — a user uploads a file, a message arrives in a queue, an HTTP request hits an API. Traditionally, this meant provisioning and maintaining servers to host that logic, even when it was idle. AWS Lambda eliminates that overhead entirely: you upload your code, define what triggers it, and AWS handles everything else — infrastructure, scaling, patching, and availability. You pay only for the compute time your code actually consumes, billed in 1ms increments. This model is called **serverless compute**, and Lambda is its cornerstone on AWS. [🔗](https://docs.aws.amazon.com/lambda/latest/dg/welcome.html)

Lambda is the **most heavily tested compute service on DVA-C02**. Understanding it deeply — not just what it does, but how it behaves under load, failure, and cold starts — is essential.

### Function Anatomy: Handler, Event, and Context

Every Lambda function has three core building blocks:

- **Handler** — the entry point AWS invokes. Its signature depends on the runtime, but in Python it looks like `def handler(event, context)`, in Node.js `exports.handler = async (event, context) => {}`. The handler name must match what you configure in the function settings.
- **Event** — a JSON object passed by the invoker. Its shape varies entirely by the trigger source: an S3 event looks nothing like an API Gateway event. Always consult the service-specific event format in the docs. [🔗](https://docs.aws.amazon.com/lambda/latest/dg/lambda-services.html)
- **Context** — a runtime object injected by Lambda itself, containing metadata like the function name, remaining execution time (`context.getRemainingTimeInMillis()`), request ID, and log stream name. It's read-only and useful for logging and timeout-aware logic.

### Supported Runtimes and Custom Runtimes

Lambda provides managed runtimes for the most common languages: Node.js, Python, Java, .NET, Ruby, and Go. AWS maintains these runtimes and patches them for security. If you need a language not on that list — or a specific version of one — you can supply a **custom runtime** by including a `bootstrap` executable in your deployment package that implements the Lambda Runtime API. [🔗](https://docs.aws.amazon.com/lambda/latest/dg/runtimes-custom.html) Alternatively, you can package your function as a **container image** (up to 10 GB) using a Lambda-provided base image, giving you full control over the runtime environment. [🔗](https://docs.aws.amazon.com/lambda/latest/dg/images-create.html)

### Invocation Types

How Lambda is called determines how it behaves around retries, errors, and response delivery. There are three models:

**Synchronous invocation** — the caller waits for the function to finish and receives the response directly. API Gateway, ALB, and the AWS SDK `RequestResponse` invocation type all work this way. If the function errors, the error is returned to the caller — Lambda does not retry. Retry logic is the caller's responsibility. [🔗](https://docs.aws.amazon.com/lambda/latest/dg/invocation-sync.html)

**Asynchronous invocation** — the caller hands the event to Lambda and gets an immediate `202 Accepted` without waiting for execution. Lambda queues the event internally and invokes the function. If it fails, Lambda retries **up to 2 additional times** (3 attempts total) with delays between attempts. After all retries are exhausted, the event can be sent to a **Dead Letter Queue (DLQ)** — an SQS queue or SNS topic — or routed via **Lambda Destinations**. Destinations are more flexible than DLQs: you can route both successes and failures to SQS, SNS, another Lambda function, or EventBridge, and the destination payload includes the original event plus the function response or error. S3 event notifications, SNS, and EventBridge all invoke Lambda asynchronously. [🔗](https://docs.aws.amazon.com/lambda/latest/dg/invocation-async.html)

**Event source mapping** — Lambda polls a data source on your behalf and batches records into function invocations. This applies to **SQS**, **Kinesis Data Streams**, and **DynamoDB Streams**. The key behaviors differ by source:

- *SQS*: Lambda polls and deletes messages only on success. On failure, the batch goes back to the queue and will be retried (up to the queue's visibility timeout and retention period). You can configure a DLQ on the SQS queue itself to capture poison-pill messages.
- *Kinesis and DynamoDB Streams*: records within a shard are processed in order. On failure, Lambda retries the batch until the records expire or you configure a bisect-on-error or destination-on-failure behavior. [🔗](https://docs.aws.amazon.com/lambda/latest/dg/invocation-eventsourcemapping.html)

### Concurrency: Reserved vs. Provisioned

Lambda scales by running multiple instances of your function simultaneously — one per concurrent request. By default, your account has a **regional concurrency limit** (1,000 by default, raisable via support). Within that pool, every function competes for capacity.

- **Reserved concurrency** — sets a hard cap on how many concurrent instances a specific function can run. This does two things: it protects other functions from being starved by a runaway function, and it guarantees a function never exceeds a set limit (useful for protecting a downstream database). Requests beyond the cap are throttled. [🔗](https://docs.aws.amazon.com/lambda/latest/dg/configuration-concurrency.html)
- **Provisioned concurrency** — pre-initializes a set number of execution environments so they are always warm and ready to respond with zero cold start latency. This is essential for latency-sensitive, synchronously invoked functions. It carries an additional cost. [🔗](https://docs.aws.amazon.com/lambda/latest/dg/provisioned-concurrency.html)

### Throttling and Exponential Backoff with Jitter

When Lambda is throttled — because concurrency is exhausted, reserved limits are hit, or you're in a burst scenario — it returns a `429 TooManyRequestsException`. **This is a cross-cutting pattern you must understand deeply**, because you will encounter it again with SQS, API Gateway, and DynamoDB.

The correct response to throttling is **exponential backoff with jitter**: after each failed attempt, wait 2ⁿ × base_delay before retrying, and add a small random component (jitter) to prevent a thundering herd of clients all retrying at the same instant. AWS SDKs implement this automatically for most retryable errors, but you need to understand when to rely on it and when to implement it yourself. [🔗](https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/)

For synchronous invocations (e.g., via API Gateway), throttled requests return a `429` to the end client — you must handle retries in your application or at the API Gateway level. For asynchronous invocations, Lambda queues the event and retries internally.

### Execution Environment Lifecycle and Cold Starts

When Lambda receives an invocation, it provisions an **execution environment** — a micro-VM that includes your runtime, code, and dependencies. This process has three phases:

- **Init phase** — Lambda downloads your code, starts the runtime, and runs any code outside your handler (global variable initialization, SDK client setup, DB connections). This happens once per new environment and is the source of **cold start latency**, which can range from a few hundred milliseconds to several seconds depending on runtime and package size.
- **Invoke phase** — Lambda calls your handler. Subsequent invocations that reuse the same warm environment skip the Init phase entirely.
- **Shutdown phase** — Lambda eventually freezes and terminates the environment after a period of inactivity.

**Cold starts matter** in latency-sensitive paths. Common mitigations: keep deployment packages small, avoid heavy imports, initialize SDK clients outside the handler (so they're reused across invocations), and use Provisioned Concurrency for critical functions. Java and .NET runtimes have notably longer cold starts than Python and Node.js. [🔗](https://docs.aws.amazon.com/lambda/latest/dg/lambda-runtime-environment.html)

> **Practical pattern:** Initialize your DynamoDB client, S3 client, and any DB connections at the top of the file (outside the handler). Lambda will reuse the same environment for many invocations, so these objects persist across calls — no need to reconnect on every request.

### Versions and Aliases

Lambda lets you publish immutable **versions** of your function. A version captures the code and configuration at that point in time and receives a numeric ARN (e.g., `arn:aws:lambda:...:function:my-function:3`). The unpublished, mutable state is always `$LATEST`.

**Aliases** are named pointers to one or two versions, with optional traffic weights. An alias like `prod` can point 90% of traffic to version 5 and 10% to version 6 — enabling **canary or blue/green deployments** without changing any downstream configuration. Aliases have their own ARNs and can be used in event source mappings and function URL configurations. [🔗](https://docs.aws.amazon.com/lambda/latest/dg/configuration-aliases.html)

### Layers and Deployment Packages

A **Lambda Layer** is a ZIP archive containing libraries, custom runtimes, or shared code that can be attached to multiple functions. Up to 5 layers per function are allowed. Layers are useful for keeping your deployment package small and sharing common dependencies (e.g., a shared utility library, or the AWS SDK for a language that doesn't include it by default). Layers are versioned and immutable. [🔗](https://docs.aws.amazon.com/lambda/latest/dg/chapter-layers.html)

Deployment packages can be either a **ZIP file** (up to 50 MB compressed, 250 MB unzipped) or a **container image** (up to 10 GB). Container images must implement the Lambda Runtime Interface and are stored in Amazon ECR. [🔗](https://docs.aws.amazon.com/lambda/latest/dg/gettingstarted-package.html)

### Lambda with VPC

By default, Lambda runs in an AWS-managed network and can reach the public internet and AWS public endpoints. If your function needs to reach resources inside a **VPC** — a private RDS instance, an ElastiCache cluster, an internal microservice — you can attach it to a VPC by specifying subnets and a security group.

Under the hood, Lambda creates an **Elastic Network Interface (ENI)** in your VPC. The historical drawback was a cold-start penalty (ENI creation took seconds), but AWS resolved this in 2020 with Hyperplane ENIs, which are shared and pre-provisioned. The main trade-off that remains: **VPC-attached Lambda functions lose default internet access**. If your function needs both VPC access and internet access, route internet-bound traffic through a **NAT Gateway** in a public subnet. For AWS service calls (S3, DynamoDB, etc.) from inside a VPC, use **VPC endpoints** to avoid NAT costs and keep traffic private. [🔗](https://docs.aws.amazon.com/lambda/latest/dg/configuration-vpc.html)

### Environment Variables and Encryption

Environment variables let you pass configuration to your function without hardcoding it. They're accessible at runtime via standard OS environment variable APIs (`os.environ` in Python, `process.env` in Node.js). By default, Lambda encrypts environment variables at rest using an AWS-managed KMS key. For additional security, you can use a **customer-managed KMS key** and optionally enable **encryption helpers** to encrypt sensitive values client-side before they're stored, decrypting them in the handler. [🔗](https://docs.aws.amazon.com/lambda/latest/dg/configuration-envvars.html)

### SSM Parameter Store Integration — A Common Exam Trap

A popular pattern is fetching configuration from **AWS Systems Manager Parameter Store** inside Lambda — database credentials, feature flags, API keys. Where you place that fetch call has significant performance and cost implications:

- **Outside the handler (at init time):** the parameter is fetched once when the environment initializes and cached for the lifetime of the warm environment. Efficient and cheap, but the function picks up config changes only when a new environment is initialized (cold start).
- **Inside the handler (per invocation):** the parameter is fetched fresh on every call. Always up to date, but adds latency and SSM API cost to every invocation.

The exam tests whether you understand this trade-off. For most use cases — secrets, connection strings — fetch at init time and use Parameter Store's TTL-based caching via the **AWS Parameters and Secrets Lambda Extension**, which caches values locally and refreshes them in the background. [🔗](https://docs.aws.amazon.com/systems-manager/latest/userguide/ps-integration-lambda-extensions.html)

### Lambda@Edge and CloudFront Functions

Lambda can be deployed at AWS edge locations to execute logic close to users via two offerings:

- **Lambda@Edge** — runs Node.js or Python functions at CloudFront edge nodes. Can inspect and modify requests and responses at four points in the CloudFront lifecycle: viewer request, origin request, origin response, viewer response. Supports longer execution (up to 5 seconds for viewer events, 30 seconds for origin events) and more memory. Good for auth, URL rewrites, A/B testing, and personalization. [🔗](https://docs.aws.amazon.com/lambda/latest/dg/lambda-edge.html)
- **CloudFront Functions** — lighter, faster, and cheaper. JavaScript only, sub-millisecond execution, runs only on viewer request/response events. Ideal for simple header manipulation, URL normalization, and token validation at massive scale. [🔗](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/cloudfront-functions.html)

### Function URLs

Lambda Function URLs provide a dedicated HTTPS endpoint for your function without needing API Gateway. You get a static URL in the format `https://<url-id>.lambda-url.<region>.on.aws`. They support IAM authentication or no auth (public), and can be attached to a function alias. Useful for simple webhooks or prototyping where API Gateway's routing and middleware features aren't needed. [🔗](https://docs.aws.amazon.com/lambda/latest/dg/lambda-urls.html)

### Key Limits to Memorize

These limits appear directly in exam questions:

| Limit | Value |
|---|---|
| Maximum execution timeout | 15 minutes |
| Maximum memory | 10,240 MB (10 GB) |
| vCPU allocation | Proportional to memory (1 vCPU at 1,769 MB) |
| Deployment package (ZIP, unzipped) | 250 MB |
| Deployment package (container image) | 10 GB |
| Layers per function | 5 |
| Concurrency (default regional) | 1,000 (soft limit) |
| Async retry attempts | 2 (3 total) |
| Environment variables | 4 KB total |

[🔗](https://docs.aws.amazon.com/lambda/latest/dg/gettingstarted-limits.html)