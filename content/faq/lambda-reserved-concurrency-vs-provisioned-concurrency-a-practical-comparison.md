---
title: "Lambda Reserved Concurrency vs Provisioned Concurrency: A Practical Comparison"
---

## Lambda Reserved Concurrency vs Provisioned Concurrency: A Practical Comparison

When you first deploy a Lambda function to production, everything feels straightforward. You write your code, configure memory, and deploy. But as traffic grows or your function becomes a critical part of your system, two powerful—and often misunderstood—Lambda features become essential: Reserved Concurrency and Provisioned Concurrency. These aren't just tuning knobs; they're fundamentally different tools that solve different problems, and understanding when and how to use them will dramatically improve your application's reliability and user experience.

### Understanding Lambda Concurrency at Its Core

Before diving into the specifics, let's establish what concurrency actually means in the Lambda world. Every AWS account has a regional concurrency limit—by default, 1,000 concurrent executions. When you invoke a Lambda function, it needs an execution environment: a container with your code, runtime, and allocated memory. AWS manages these environments for you, spinning them up on demand. Concurrency measures how many of these environments are actively executing code at the same moment.

If your function is handling HTTP requests and each invocation takes 100 milliseconds, a concurrent limit of 1,000 means you can theoretically handle 10,000 requests per second. But concurrency is about simultaneous executions, not throughput. If each request takes a full second, those same 1,000 concurrent slots only handle 1,000 requests per second. The distinction matters because Reserved and Provisioned Concurrency work with simultaneous executions, not requests-per-second.

### Reserved Concurrency: Setting a Hard Cap

Reserved Concurrency is the simpler concept of the two. When you enable it on a Lambda function, you're setting a maximum—a hard ceiling on how many execution environments that specific function can use at any given moment. Think of it as telling AWS: "This function gets no more than X concurrent executions, period."

Let's say you have an order processing function that writes to a database. Your database connection pool has 50 connections. If your Lambda function doesn't limit itself, and a traffic spike hits, AWS might provision 200 concurrent executions, each trying to grab a database connection. The connection pool exhausts immediately, downstream queries fail, and now your entire system is degraded. Reserved Concurrency prevents this disaster. By setting your order processor's reserved concurrency to 48, you ensure the connection pool never gets overwhelmed.

Reserved Concurrency works like this: if your function already has 48 concurrent executions running and a 49th invocation arrives, that invocation gets throttled. Lambda returns a 429 "Too Many Requests" response immediately. The invocation doesn't get queued; it's rejected outright. This is the crucial behavior that makes Reserved Concurrency so valuable for protecting downstream systems.

The cost model is straightforward—there's no charge for Reserved Concurrency itself. You pay only for actual executions. Reserved Concurrency is purely about setting a limit.

### Provisioned Concurrency: Pre-warming for Speed

Provisioned Concurrency solves a completely different problem: cold starts. When a Lambda function hasn't been invoked recently, AWS needs to create an execution environment from scratch. It downloads your code, initializes the runtime, executes your initialization code, and then finally runs your handler. This process typically takes between 100 milliseconds to several seconds, depending on your runtime, code size, and dependencies. For latency-sensitive applications like real-time APIs or interactive dashboards, this delay is unacceptable.

Provisioned Concurrency keeps a fleet of execution environments perpetually warm and ready to execute immediately. You specify a number—let's say 10—and AWS maintains 10 environments at all times, constantly recycling them to keep them fresh. When an invocation arrives, it lands in one of these pre-warmed environments and starts executing immediately. There's no initialization delay; you've essentially traded a tiny amount of extra cost for predictable sub-100-millisecond startup times.

The cost model here is different: you pay per hour for each unit of provisioned concurrency, regardless of whether those environments are executing code. If you provision 10 concurrent units for 30 days, you'll pay for 10 × 24 × 30 hours of provisioned concurrency, plus the normal per-invocation charges for actual executions. This makes it essential to right-size provisioned concurrency to your actual needs.

### When to Use Each One (Or Both)

Reserved Concurrency and Provisioned Concurrency answer different questions, and sometimes you need both.

**Use Reserved Concurrency when you need to protect a shared resource.** If your Lambda function talks to a database with limited connections, a third-party API with rate limits, or any downstream system with finite capacity, Reserved Concurrency is your protective barrier. It prevents your function from overwhelming those systems during traffic spikes. You're not trying to improve latency; you're trying to prevent cascading failures. E-commerce checkout flows, payment processors, and database writes often need Reserved Concurrency.

**Use Provisioned Concurrency when you need to eliminate cold starts.** If your application requires consistent, predictable latency—especially in the 10-100 millisecond range—Provisioned Concurrency is worth the cost. Real-time dashboards, interactive APIs, and edge-case handlers that get infrequent traffic but must respond fast are good candidates. A function that wakes up once an hour to process a batch probably doesn't need provisioned concurrency; an API endpoint that handles sporadic but time-critical requests absolutely does.

**Use both when you need cold-start elimination AND downstream protection.** This is a powerful combination. Consider a real-time analytics ingestion endpoint. You want to provision 20 concurrent environments to eliminate cold starts and maintain responsiveness. But your Elasticsearch cluster can only handle 50 concurrent writes, so you also set Reserved Concurrency to 45. The provisioned environments handle spikes efficiently, and if traffic somehow explodes, the reserved concurrency cap prevents your Elasticsearch cluster from drowning.

### Understanding Throttling Behavior

When a Lambda function hits its Reserved Concurrency limit, throttling kicks in immediately. The invocation doesn't wait in a queue; it fails with a synchronous 429 error or, for asynchronous invocations, gets sent to a dead-letter queue or automatically retried based on your event source configuration.

This is fundamentally different from hitting the account-level concurrency limit, which does queue invocations. If your account has 1,000 total concurrency and all are in use, AWS queues new invocations momentarily before timing out. But Reserved Concurrency throttling is harsh and immediate—there's no queue. This makes it essential to handle 429 errors gracefully in your client code.

For synchronous invocations, implement exponential backoff and retry logic. For asynchronous invocations from services like SQS or SNS, configure appropriate retry policies and dead-letter queues. And consider setting up CloudWatch alarms to alert you when Reserved Concurrency throttling occurs, because it's usually a sign you've either underestimated traffic or your downstream system is struggling.

### Cost Implications and Optimization

Cost optimization requires understanding the trade-offs. Reserved Concurrency has zero cost; Provisioned Concurrency costs money whether your function executes or not. This means provisioned concurrency only makes financial sense if your function invokes frequently enough that the cost per invocation is acceptable.

Here's a rough calculation. Provisioned Concurrency costs roughly $0.015 per unit-hour in most regions. If you provision 10 units, that's about $0.15 per hour, or roughly $1,080 per month. If your function invokes 10 million times per month, that's $0.00000108 per invocation in provisioned concurrency costs alone, which is negligible compared to the invocation cost. But if your function invokes only 100,000 times per month, that same provisioned concurrency costs $0.0108 per invocation—suddenly it's not efficient.

Reserved Concurrency costs nothing but potentially loses revenue if it causes throttling during traffic spikes. You need to balance the cost of increased concurrency (higher regional limits cost money) against the risk of throttling and degraded customer experience.

A practical approach: start with Reserved Concurrency only if your function has downstream dependencies that could break. Add Provisioned Concurrency only after profiling shows cold starts are a real problem. Use CloudWatch metrics to understand your actual concurrency usage patterns before making final decisions.

### Practical Scenario: E-Commerce Order Processing

Imagine you're building an order processing system. When customers place orders, a Lambda function writes to DynamoDB, sends to SQS for fulfillment, and calls a third-party shipping API. The shipping API can handle exactly 50 concurrent requests. A Black Friday surge hits, and 200 concurrent Lambda invocations are created. Without Reserved Concurrency, all 200 try to call the shipping API, which fails catastrophically.

You set Reserved Concurrency to 48, ensuring the shipping API stays within its limits. Invocations beyond 48 are throttled, but this is actually good—you'd rather fail fast and retry than overload the shipping service. Your clients implement exponential backoff, so orders eventually get processed as capacity opens up.

But there's a problem: during normal traffic, that order placement endpoint takes 500 milliseconds to execute, and customers notice the delay. You're getting complaints. You provision 5 concurrent environments, keeping 5 instances always warm. Now orders placed during normal traffic experience near-zero cold start time. The provisioned concurrency costs you about $540 per month, but the improved customer experience is worth it. The Reserved Concurrency (48 units) is still in place protecting the shipping API, and the Provisioned Concurrency (5 units) ensures good latency during baseline traffic.

### Practical Scenario: Batch Processing with Ephemeral Bursts

Now consider a different application: a nightly batch job that processes yesterday's logs. The function runs once per day, takes about 2 minutes per invocation, and doesn't interact with any resource-constrained downstream systems. Reserved Concurrency isn't needed because the function runs serially—there's only ever one invocation at a time. Provisioned Concurrency isn't needed because a 2-minute batch job doesn't care about a 200-millisecond cold start.

This function needs neither feature. You deploy it, let AWS manage the execution environment, and pay only for actual invocations. This is the simplicity that makes Lambda attractive.

### Monitoring and Alerting

Understanding your concurrency usage is critical. CloudWatch provides metrics you should monitor:

**ConcurrentExecutions** shows your actual concurrent usage at any moment. If this regularly approaches your Reserved Concurrency limit, you need more capacity or better throttling handling. **Throttles** explicitly counts how many invocations were throttled due to concurrency limits. Any throttles you didn't expect are a sign something's wrong. **Duration** helps you understand how long your function actually runs, which informs your concurrency calculations.

Set up CloudWatch alarms that trigger when throttles occur or when concurrent executions approach your reserved limit. Alert your team so they can investigate. Is traffic unexpectedly high? Is your function slower than expected? Is a downstream system struggling?

For Provisioned Concurrency, monitor **ProvisionedConcurrentExecutions** to see how many of your provisioned environments are actually in use. If this is consistently near zero, you're wasting money and should reduce provisioning. If it's consistently maxed out, you need more.

### Making the Decision: A Summary Framework

Deciding whether to use Reserved Concurrency, Provisioned Concurrency, both, or neither comes down to asking three questions:

First, does your function interact with a resource-constrained downstream system? Database pools, third-party APIs with rate limits, or other bottlenecks? If yes, Reserved Concurrency is necessary. Second, are cold starts causing customer-visible latency problems? Profile your function's performance and measure actual user impact. If cold starts exceed your latency budget, Provisioned Concurrency is worth the cost. Third, what's your invocation frequency? This determines whether Provisioned Concurrency makes financial sense.

With those answers, your path forward becomes clear. Most production functions use Reserved Concurrency for safety. Some also use Provisioned Concurrency for latency-critical paths. A few use neither because they're simple, lightweight, and not constrained by downstream resources.

### Conclusion

Reserved Concurrency and Provisioned Concurrency are both valuable tools, but they're fundamentally different. Reserved Concurrency is about setting a limit to protect downstream systems and prevent cascading failures. It's mandatory thinking in any system with shared resources. Provisioned Concurrency is about eliminating the latency penalty of cold starts, trading a predictable cost for predictable performance. It's essential for latency-sensitive applications but wasteful for batch jobs or infrequent functions.

The most sophisticated Lambda deployments use both strategically. Set Reserved Concurrency to protect your dependencies, then layer Provisioned Concurrency on top to eliminate cold starts for critical paths. Monitor your CloudWatch metrics obsessively so you understand actual usage patterns rather than guessing. This combination—reserved limits for safety, provisioned environments for speed, and constant monitoring for visibility—is what separates solid Lambda deployments from production-grade systems that scale reliably under pressure.
