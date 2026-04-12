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

{{< qcm >}}
[
{
"question": "A developer is building a Lambda function that connects to a private RDS database inside a VPC. After deploying the function with VPC configuration, the function can reach the database but can no longer call an external third-party REST API over the internet. What is the most likely cause and solution?",
"answers": [
{
"answer": "VPC-attached Lambda functions lose default internet access. Add a NAT Gateway in a public subnet and route internet-bound traffic through it.",
"isCorrect": true,
"explanation": "When Lambda is attached to a VPC, it loses its default internet access. To restore it, internet-bound traffic must be routed through a NAT Gateway placed in a public subnet."
},
{
"answer": "The Lambda execution role is missing the AmazonVPCFullAccess policy.",
"isCorrect": false,
"explanation": "IAM policies on the execution role do not control network routing. The issue is architectural — VPC-attached functions have no direct internet route."
},
{
"answer": "Lambda functions inside a VPC cannot make outbound calls. An intermediary service such as SQS must be used.",
"isCorrect": false,
"explanation": "Lambda functions inside a VPC can make outbound calls — they just need a NAT Gateway to reach the public internet."
},
{
"answer": "Add a VPC endpoint for the third-party REST API.",
"isCorrect": false,
"explanation": "VPC endpoints are for AWS services, not arbitrary third-party APIs. A NAT Gateway is required for general internet access."
}
]
},
{
"question": "A Lambda function is invoked asynchronously by an S3 event notification. The function fails on every attempt. What is the default total number of invocation attempts Lambda will make before routing the event to a Dead Letter Queue?",
"answers": [
{
"answer": "1",
"isCorrect": false,
"explanation": "Lambda does not give up after the first attempt for asynchronous invocations. It retries automatically."
},
{
"answer": "2",
"isCorrect": false,
"explanation": "Lambda retries up to 2 additional times, meaning 3 total attempts, not 2."
},
{
"answer": "3",
"isCorrect": true,
"explanation": "For asynchronous invocations, Lambda retries up to 2 additional times after the initial attempt, for a total of 3 attempts before sending the event to a DLQ or Destination."
},
{
"answer": "5",
"isCorrect": false,
"explanation": "5 is not the retry count for Lambda async invocations. The correct total is 3 attempts."
}
]
},
{
"question": "A developer needs to share a common set of Python utility libraries across 20 Lambda functions without increasing each function's individual deployment package size. Which approach is most appropriate?",
"answers": [
{
"answer": "Create a Lambda Layer containing the shared libraries and attach it to each function.",
"isCorrect": true,
"explanation": "Lambda Layers are ZIP archives of shared code or libraries that can be attached to multiple functions (up to 5 per function), keeping individual deployment packages small."
},
{
"answer": "Package the shared libraries into each function's deployment ZIP individually.",
"isCorrect": false,
"explanation": "This increases every deployment package and creates duplication. It is the opposite of the recommended approach when sharing common dependencies."
},
{
"answer": "Store the libraries in an S3 bucket and download them at runtime inside the handler.",
"isCorrect": false,
"explanation": "Downloading dependencies at runtime on every invocation adds significant latency and is not a best practice for Lambda."
},
{
"answer": "Use Lambda Aliases to point all functions to a single shared version.",
"isCorrect": false,
"explanation": "Aliases are pointers to function versions, not a mechanism for sharing code or libraries across different functions."
}
]
},
{
"question": "Which of the following correctly describes the difference between Reserved Concurrency and Provisioned Concurrency in AWS Lambda?",
"answers": [
{
"answer": "Reserved Concurrency sets a maximum cap on concurrent executions for a function, while Provisioned Concurrency pre-warms execution environments to eliminate cold start latency.",
"isCorrect": true,
"explanation": "Reserved Concurrency limits how many concurrent instances a function can run (throttling excess requests). Provisioned Concurrency pre-initializes environments so they are always warm, eliminating cold starts."
},
{
"answer": "Reserved Concurrency eliminates cold starts, while Provisioned Concurrency limits concurrent executions.",
"isCorrect": false,
"explanation": "These definitions are reversed. Reserved Concurrency caps concurrency; Provisioned Concurrency pre-warms environments."
},
{
"answer": "Both Reserved and Provisioned Concurrency pre-warm execution environments but differ in cost.",
"isCorrect": false,
"explanation": "Only Provisioned Concurrency pre-warms environments. Reserved Concurrency solely controls the concurrency cap."
},
{
"answer": "Provisioned Concurrency is free and simply reserves capacity from the regional pool, while Reserved Concurrency incurs additional cost.",
"isCorrect": false,
"explanation": "It is Provisioned Concurrency that carries additional cost. Reserved Concurrency does not have a separate charge beyond standard Lambda pricing."
}
]
},
{
"question": "A Lambda function processing orders is invoked synchronously via API Gateway. Under sudden high traffic, Lambda starts returning errors to API Gateway. What error code does Lambda return when it is throttled, and what retry strategy should be implemented?",
"answers": [
{
"answer": "Lambda returns 503 Service Unavailable; the client should retry immediately.",
"isCorrect": false,
"explanation": "Throttling returns a 429 TooManyRequestsException, not 503. Immediate retries without backoff worsen the thundering herd problem."
},
{
"answer": "Lambda returns 429 TooManyRequestsException; the client should implement exponential backoff with jitter.",
"isCorrect": true,
"explanation": "Throttled Lambda invocations return a 429. The correct mitigation is exponential backoff with jitter, which spreads retries over time to avoid all clients retrying simultaneously."
},
{
"answer": "Lambda returns 429 TooManyRequestsException; Lambda will automatically retry the request on behalf of API Gateway.",
"isCorrect": false,
"explanation": "For synchronous invocations (including API Gateway), Lambda does not retry automatically. Retry logic is the caller's responsibility."
},
{
"answer": "Lambda returns 429 TooManyRequestsException; the request is automatically placed in Lambda's internal queue for later processing.",
"isCorrect": false,
"explanation": "Internal queuing applies to asynchronous invocations, not synchronous ones. A synchronous 429 is returned directly to the caller."
}
]
},
{
"question": "A developer wants to gradually roll out a new version of a Lambda function, sending 10% of production traffic to the new version while keeping 90% on the stable version. Which Lambda feature enables this?",
"answers": [
{
"answer": "Lambda Versions with weighted routing in Route 53.",
"isCorrect": false,
"explanation": "Route 53 is a DNS service and is not used to split traffic between Lambda versions. Lambda Aliases handle this natively."
},
{
"answer": "Lambda Aliases with traffic weighting between two versions.",
"isCorrect": true,
"explanation": "Lambda Aliases can point to two versions simultaneously with configurable traffic weights, enabling canary and blue/green deployments without changing downstream configurations."
},
{
"answer": "Lambda Layers with version pinning.",
"isCorrect": false,
"explanation": "Layers are for sharing code and libraries, not for routing traffic between function versions."
},
{
"answer": "Lambda $LATEST with a feature flag stored in SSM Parameter Store.",
"isCorrect": false,
"explanation": "$LATEST is the mutable unpublished state and does not provide traffic splitting. Feature flags can control behavior but are not the Lambda-native mechanism for canary deployments."
}
]
},
{
"question": "A Lambda function initializes a DynamoDB client and opens a database connection inside the handler function body. A senior engineer recommends moving these initializations outside the handler. What is the primary reason for this recommendation?",
"answers": [
{
"answer": "Lambda execution environments are reused across multiple invocations. Initializing clients outside the handler means they are created once during the Init phase and reused on subsequent warm invocations, reducing latency and connection overhead.",
"isCorrect": true,
"explanation": "Code outside the handler runs during the Init phase (cold start). On warm invocations, the environment is reused, so SDK clients and connections initialized globally persist across calls without needing to be recreated."
},
{
"answer": "Lambda bills separately for code executed inside versus outside the handler.",
"isCorrect": false,
"explanation": "Lambda billing is based on total execution time in 1ms increments, not on whether code runs inside or outside the handler."
},
{
"answer": "DynamoDB clients initialized inside the handler are not thread-safe.",
"isCorrect": false,
"explanation": "Thread safety is not the reason for this pattern. The reason is environment reuse and avoiding redundant initialization on every invocation."
},
{
"answer": "Environment variables are only accessible outside the handler function.",
"isCorrect": false,
"explanation": "Environment variables are accessible anywhere in the function code, both inside and outside the handler."
}
]
},
{
"question": "A developer is fetching a database password from SSM Parameter Store inside a Lambda function. The current implementation calls SSM on every invocation. Which approach should be used to reduce latency and API costs while still allowing configuration updates to propagate?",
"answers": [
{
"answer": "Move the SSM fetch outside the handler so the parameter is cached for the lifetime of the warm execution environment.",
"isCorrect": true,
"explanation": "Fetching at init time caches the value for all subsequent warm invocations in that environment, eliminating per-invocation SSM API calls and their associated latency and cost."
},
{
"answer": "Use the AWS Parameters and Secrets Lambda Extension, which caches the parameter locally and refreshes it in the background.",
"isCorrect": true,
"explanation": "The Parameters and Secrets Lambda Extension is specifically designed for this use case — it caches SSM values locally in the execution environment and handles TTL-based refresh automatically."
},
{
"answer": "Store the password directly in an environment variable in plain text.",
"isCorrect": false,
"explanation": "Storing secrets as plain-text environment variables is a security anti-pattern. SSM Parameter Store (or Secrets Manager) exists precisely to avoid this."
},
{
"answer": "Call SSM inside the handler but use connection pooling to reduce cost.",
"isCorrect": false,
"explanation": "Connection pooling applies to database connections, not to SSM API calls. Every in-handler SSM call incurs latency and cost regardless of pooling."
}
]
},
{
"question": "A company needs to run a Lambda function for a task that may take up to 20 minutes to complete. How should this be addressed?",
"answers": [
{
"answer": "Increase the Lambda memory to the maximum (10,240 MB), which also increases the timeout limit.",
"isCorrect": false,
"explanation": "Memory and timeout are independent settings. Increasing memory does not extend the maximum timeout beyond 15 minutes."
},
{
"answer": "This is not possible with Lambda. Refactor the task to run within 15 minutes or use an alternative compute service such as AWS Fargate or EC2.",
"isCorrect": true,
"explanation": "Lambda's maximum execution timeout is 15 minutes. A 20-minute task exceeds this hard limit. Long-running tasks should be handled by a container-based service like Fargate, EC2, or AWS Step Functions with appropriate activities."
},
{
"answer": "Set the Lambda timeout to 20 minutes in the function configuration.",
"isCorrect": false,
"explanation": "The maximum configurable timeout for Lambda is 15 minutes. Setting 20 minutes is not possible."
},
{
"answer": "Use Provisioned Concurrency to extend the execution timeout beyond 15 minutes.",
"isCorrect": false,
"explanation": "Provisioned Concurrency pre-warms execution environments to reduce cold starts. It has no effect on the maximum execution timeout."
}
]
},
{
"question": "A Lambda function is configured as an event source mapping consumer for an SQS queue. The function fails to process a batch of messages. What happens next?",
"answers": [
{
"answer": "Lambda immediately sends the batch to the configured Dead Letter Queue.",
"isCorrect": false,
"explanation": "A DLQ is only reached after messages exhaust the queue's visibility timeout and retention period. Lambda first makes the batch visible again for retry."
},
{
"answer": "Lambda deletes the failed messages from the queue to prevent duplicate processing.",
"isCorrect": false,
"explanation": "Lambda only deletes messages on successful processing. Failed batches are returned to the queue for retry."
},
{
"answer": "The batch becomes visible again in the SQS queue and will be retried until it is processed successfully or the message retention period expires.",
"isCorrect": true,
"explanation": "With SQS event source mappings, Lambda only deletes messages on success. On failure, the messages return to the queue after the visibility timeout and are retried. A DLQ on the SQS queue can capture poison-pill messages after repeated failures."
},
{
"answer": "Lambda retries the batch exactly 2 more times internally before discarding it.",
"isCorrect": false,
"explanation": "The 2-retry internal behavior applies to asynchronous invocations, not to SQS event source mappings, which rely on the queue's own visibility timeout and retention settings."
}
]
},
{
"question": "Which of the following correctly describes the difference between Lambda@Edge and CloudFront Functions?",
"answers": [
{
"answer": "Lambda@Edge supports Node.js and Python, can run up to 30 seconds for origin events, and can modify all four CloudFront lifecycle events. CloudFront Functions are JavaScript-only, run in sub-milliseconds, and only support viewer request and viewer response events.",
"isCorrect": true,
"explanation": "This accurately captures the key distinctions: Lambda@Edge offers more power and flexibility (languages, execution time, lifecycle events), while CloudFront Functions are lighter and cheaper but limited to viewer-side events and JavaScript."
},
{
"answer": "CloudFront Functions support all four CloudFront lifecycle events, while Lambda@Edge only supports origin request and origin response.",
"isCorrect": false,
"explanation": "This is reversed. Lambda@Edge supports all four events. CloudFront Functions only support viewer request and viewer response."
},
{
"answer": "Lambda@Edge and CloudFront Functions are interchangeable; the only difference is cost.",
"isCorrect": false,
"explanation": "They have significant functional differences: supported languages, execution duration limits, and which CloudFront lifecycle events they can intercept."
},
{
"answer": "CloudFront Functions can run for up to 5 seconds and support Python and JavaScript.",
"isCorrect": false,
"explanation": "CloudFront Functions are JavaScript-only and designed for sub-millisecond execution. The 5-second limit applies to Lambda@Edge viewer events."
}
]
},
{
"question": "A developer wants to deploy a Lambda function that uses a language runtime not natively supported by AWS. Which two options allow this? (Select TWO)",
"answers": [
{
"answer": "Create a custom runtime by providing a bootstrap executable that implements the Lambda Runtime API.",
"isCorrect": true,
"explanation": "Lambda supports custom runtimes via a bootstrap executable included in the deployment package. This executable must implement the Lambda Runtime API to receive and respond to invocations."
},
{
"answer": "Package the function as a container image stored in Amazon ECR.",
"isCorrect": true,
"explanation": "Lambda supports container images up to 10 GB. As long as the image implements the Lambda Runtime Interface, you have full control over the runtime environment, including unsupported languages."
},
{
"answer": "Use a Lambda Layer to install the unsupported runtime on top of an existing managed runtime.",
"isCorrect": false,
"explanation": "Layers are for shared libraries and code, not for installing alternate runtimes. A custom runtime via bootstrap or a container image is the correct approach."
},
{
"answer": "Select 'Custom' in the Lambda console runtime dropdown and provide the runtime binary as an environment variable.",
"isCorrect": false,
"explanation": "Custom runtimes require a bootstrap executable in the deployment package, not a binary provided as an environment variable."
}
]
},
{
"question": "What is the maximum size of all environment variables combined for a Lambda function?",
"answers": [
{
"answer": "1 MB",
"isCorrect": false,
"explanation": "1 MB far exceeds the actual limit for Lambda environment variables."
},
{
"answer": "4 KB",
"isCorrect": true,
"explanation": "Lambda enforces a 4 KB total size limit across all environment variables for a function. This is a commonly tested limit in the DVA-C02 exam."
},
{
"answer": "64 KB",
"isCorrect": false,
"explanation": "64 KB is not the correct limit. The actual maximum is 4 KB total for all environment variables."
},
{
"answer": "There is no size limit on environment variables.",
"isCorrect": false,
"explanation": "Lambda does enforce a hard limit of 4 KB total for environment variables."
}
]
},
{
"question": "A Lambda function needs to call Amazon S3 and DynamoDB from within a VPC. A developer wants to avoid traffic going through the public internet and minimize data transfer costs. What should they configure?",
"answers": [
{
"answer": "A NAT Gateway in a public subnet.",
"isCorrect": false,
"explanation": "A NAT Gateway enables internet access but routes traffic through the public internet, which is less private and incurs NAT processing costs. It is not the optimal solution for AWS service calls."
},
{
"answer": "VPC endpoints for S3 and DynamoDB.",
"isCorrect": true,
"explanation": "VPC endpoints (Gateway endpoints for S3 and DynamoDB) allow traffic from inside the VPC to reach these AWS services privately, without traversing the internet. This avoids NAT Gateway costs and keeps traffic within AWS's network."
},
{
"answer": "An Internet Gateway attached to the VPC.",
"isCorrect": false,
"explanation": "An Internet Gateway enables internet access for resources with public IPs, but Lambda in a VPC typically uses private subnets. VPC endpoints are the correct approach for AWS service access."
},
{
"answer": "AWS PrivateLink configured for each Lambda function.",
"isCorrect": false,
"explanation": "AWS PrivateLink is the underlying technology for interface VPC endpoints, but S3 and DynamoDB are accessed via Gateway VPC endpoints. The configuration is at the VPC level, not per-function."
}
]
},
{
"question": "A developer publishes a new version of a Lambda function. Which of the following statements about Lambda versions are correct? (Select TWO)",
"answers": [
{
"answer": "Published versions are immutable — the code and configuration cannot be changed after publication.",
"isCorrect": true,
"explanation": "Once a Lambda version is published, its code and configuration are frozen. Any changes must be made to $LATEST and then published as a new version."
},
{
"answer": "$LATEST represents the most recent unpublished, mutable state of the function.",
"isCorrect": true,
"explanation": "$LATEST is always the live, editable version of the function. Publishing creates an immutable snapshot with a numeric ARN."
},
{
"answer": "You can edit the code of a published version directly in the Lambda console.",
"isCorrect": false,
"explanation": "Published versions are immutable and cannot be edited. Edits must be made to $LATEST and a new version published."
},
{
"answer": "Aliases cannot be used with published versions; they only work with $LATEST.",
"isCorrect": false,
"explanation": "Aliases point to one or two published versions (not $LATEST by default) and enable traffic weighting for canary deployments."
}
]
},
{
"question": "A Kinesis Data Stream is configured as an event source for a Lambda function. The function is consistently failing when processing records from a specific shard. What behavior does Lambda exhibit by default in this scenario?",
"answers": [
{
"answer": "Lambda skips the failing batch and moves on to newer records in the shard.",
"isCorrect": false,
"explanation": "By default, Lambda does not skip failing batches for Kinesis streams. It retries the batch to preserve ordering within the shard."
},
{
"answer": "Lambda retries the failing batch until the records expire from the stream, blocking progress on that shard.",
"isCorrect": true,
"explanation": "For Kinesis Data Streams, records within a shard are processed in order. On failure, Lambda retries the batch until records expire, which can block all subsequent records in that shard. Bisect-on-error or destination-on-failure configurations can mitigate this."
},
{
"answer": "Lambda automatically moves the failing records to an SQS DLQ after 3 attempts.",
"isCorrect": false,
"explanation": "The 3-attempt automatic DLQ behavior applies to asynchronous Lambda invocations, not to Kinesis event source mappings. For Kinesis, you must explicitly configure a destination-on-failure."
},
{
"answer": "Lambda scales out additional concurrent instances to process the failing shard faster.",
"isCorrect": false,
"explanation": "Scaling out does not resolve a failing batch. The shard is blocked on the failing records until they are successfully processed or expire."
}
]
},
{
"question": "A team wants to expose a Lambda function as an HTTPS endpoint for a simple webhook integration. They want to avoid the complexity and cost of API Gateway. Which Lambda feature should they use?",
"answers": [
{
"answer": "Lambda@Edge with a CloudFront distribution.",
"isCorrect": false,
"explanation": "Lambda@Edge is for running logic at CloudFront edge nodes, not for exposing a simple HTTPS endpoint as a webhook."
},
{
"answer": "Lambda Function URLs.",
"isCorrect": true,
"explanation": "Lambda Function URLs provide a dedicated HTTPS endpoint directly for a Lambda function without requiring API Gateway. They are well-suited for simple webhooks and prototyping scenarios."
},
{
"answer": "An Application Load Balancer (ALB) target group pointing to the Lambda function.",
"isCorrect": false,
"explanation": "An ALB can invoke Lambda but introduces additional infrastructure and cost. Lambda Function URLs are the simpler, dedicated solution described in the question."
},
{
"answer": "A CloudFront Function with a Lambda origin.",
"isCorrect": false,
"explanation": "CloudFront Functions run lightweight JavaScript at edge nodes and are not the right tool for creating a direct HTTPS endpoint for Lambda."
}
]
},
{
"question": "Which of the following are valid destinations for Lambda Destinations when an asynchronous invocation fails? (Select TWO)",
"answers": [
{
"answer": "An SQS queue.",
"isCorrect": true,
"explanation": "Lambda Destinations support routing failed (and successful) asynchronous invocations to SQS queues, along with the original event and error details."
},
{
"answer": "An Amazon EventBridge event bus.",
"isCorrect": true,
"explanation": "EventBridge is one of the four supported destination types for Lambda Destinations, enabling rich event-driven routing of function outcomes."
},
{
"answer": "An Amazon RDS database.",
"isCorrect": false,
"explanation": "RDS is not a supported Lambda Destination target. Supported targets are SQS, SNS, another Lambda function, and EventBridge."
},
{
"answer": "An S3 bucket.",
"isCorrect": false,
"explanation": "S3 is not a supported Lambda Destination target. The supported targets are SQS, SNS, another Lambda function, and EventBridge."
}
]
},
{
"question": "A developer needs to understand Lambda cold starts. Which of the following statements accurately describe cold start behavior? (Select TWO)",
"answers": [
{
"answer": "Code and SDK clients initialized outside the handler are executed during the Init phase and reused on subsequent warm invocations.",
"isCorrect": true,
"explanation": "The Init phase runs global initialization code once per new execution environment. Warm invocations skip this phase, reusing the already-initialized resources."
},
{
"answer": "Java and .NET runtimes typically experience longer cold starts than Python and Node.js.",
"isCorrect": true,
"explanation": "Java and .NET have heavier runtime startup costs, resulting in notably longer cold starts compared to the lighter Python and Node.js runtimes."
},
{
"answer": "Cold starts occur on every Lambda invocation regardless of whether the execution environment is reused.",
"isCorrect": false,
"explanation": "Cold starts only occur when a new execution environment is provisioned. Warm invocations reuse an existing environment and skip the Init phase entirely."
},
{
"answer": "Increasing the Lambda memory setting to the maximum eliminates cold starts.",
"isCorrect": false,
"explanation": "Higher memory can marginally reduce cold start duration due to more CPU, but it does not eliminate cold starts. Provisioned Concurrency is the correct solution for eliminating cold start latency."
}
]
}
]
{{< /qcm >}}