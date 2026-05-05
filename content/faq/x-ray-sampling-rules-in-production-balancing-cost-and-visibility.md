---
title: "X-Ray Sampling Rules in Production: Balancing Cost and Visibility"
---

## X-Ray Sampling Rules in Production: Balancing Cost and Visibility

When you first enable AWS X-Ray in a production application, you're immediately confronted with a financial reality: tracing every request gets expensive fast. At the default 1% sampling rate, a moderately busy API handling 100,000 requests per day still generates 1,000 traces. Scale that to a high-volume service, and you're looking at tens of thousands of traces daily. Each trace incurs costs for storage, retrieval, and analysis. Yet sampling too aggressively blinds you to the very problems you need to catch—subtle performance issues, rare error conditions, and hard-to-reproduce bugs that only surface under specific circumstances.

The art of sampling lies in capturing the traces that matter most while keeping costs manageable. A well-designed sampling strategy doesn't just save money; it actually improves your observability by ensuring you're recording the signals worth investigating. This article walks you through the mechanics of X-Ray sampling rules, shows you how to implement targeted strategies for different request patterns, and explains how to monitor whether your rules are working as intended.

### Understanding the Cost of X-Ray Tracing

Before we talk about optimization, let's ground ourselves in what you're actually paying for. X-Ray charges based on the number of traces recorded and the amount of trace data stored. The default configuration samples 1% of requests, which might sound conservative until you multiply it across a real production workload.

Consider a typical e-commerce API that processes 10 million requests per month. At 1% sampling, that's 100,000 traces monthly. If each trace averages 10 kilobytes of data (a reasonable estimate for a multi-service call chain), you're storing approximately 1 gigabyte of trace data every month. Depending on your AWS region and retention policies, this translates to real costs that compound over time. For services running in high-traffic environments—payment processors, social platforms, or content delivery networks—these numbers explode quickly.

High-volume services have historically relied on a 5% sampling rate, thinking it provides better coverage. In practice, this can cost five times as much as the 1% default while still potentially missing rare but critical issues. A 5% sampling rate applied to a service handling one billion requests per month means 50 million traces recorded—a significant cloud bill before any queries or analysis happen.

The traditional approach—sampling uniformly across all requests—treats every request as equally important for observability purposes. This is where most teams start going wrong. A successful health check request returning instantly in 2 milliseconds doesn't need tracing at all. A user authentication failure that should never happen absolutely needs recording. A checkout operation that takes longer than expected deserves investigation. These requests demand different sampling strategies.

### The Mechanics of X-Ray Sampling Rules

AWS X-Ray evaluates sampling rules in a specific order, testing each request against rule conditions until a match is found. Understanding this evaluation flow is fundamental to building effective sampling strategies.

When a request arrives at your application, the X-Ray SDK consults the sampling rules configuration. Each rule specifies criteria for matching (HTTP method, URL path, service name, hostname, and other attributes) along with a sampling decision (sample at a fixed rate, or sample at a fixed rate up to a maximum number of requests per second). The SDK evaluates rules in order—your custom rules first, then the default rule. The first matching rule applies, and no further rules are evaluated.

This ordering matters enormously. If you place a broad rule early that matches many requests, subsequent more specific rules never get evaluated. A common mistake is putting a catch-all rule first, then wondering why your targeted rules don't work. Think of it like a series of if-then statements in code: once a condition matches, the rest of the logic is skipped.

X-Ray maintains a reservoir for each rule, which is a quota of traces allowed per second, independent of the sampling rate percentage. This is crucial for production systems. Imagine you set a rule to sample 100% of all authentication failures. If your authentication service suddenly starts failing catastrophically and you're handling 50,000 failed requests per second, would you really want to record all 50,000 traces? Probably not. The reservoir acts as a safety valve, capping the absolute volume of traces recorded even when sampling percentages say to capture everything.

### Designing Sampling Rules for Different Request Patterns

The key insight for effective sampling is this: different requests carry different information value. Your sampling strategy should reflect that reality.

**Sampling error paths at high rates** comes first in most strategies. When a request fails, it's inherently interesting. Failures are where bugs hide. If your application handles one million requests per hour but only 0.1% fail (1,000 failures), sampling those failures at 100% means recording 1,000 traces. That's a manageable volume even if it represents a much smaller percentage of your total traffic. The beauty here is that you're trading raw sampling percentage for intentional selectivity. Instead of sampling 1% of all requests and hoping some failures are included, you're targeting failures directly.

To capture error responses, you'd create a rule matching HTTP status codes in the 4xx and 5xx range. Here's a concrete example rule configured for errors:

```
{
  "ruleName": "error-sampling",
  "priority": 1,
  "version": 1,
  "reservoirSize": 1,
  "fixedRate": 1.0,
  "urlPath": "*",
  "host": "*",
  "httpMethod": "*",
  "serviceName": "*",
  "serviceType": "*",
  "resourceARN": "*"
}
```

This configuration samples errors at 100% with a reservoir of one trace per second—protecting you from trace explosion even if errors spike. The priority of 1 ensures this rule is evaluated before less important rules.

**Sampling slow requests** is another high-value pattern. A request that takes 5 seconds when the p99 latency is 500 milliseconds is anomalous and worth investigating. You might miss these slow outliers entirely if you're only sampling 1% of successful requests. Creating a rule that samples requests exceeding a latency threshold captures these performance degradations.

The challenge with latency-based sampling is that X-Ray doesn't natively support latency thresholds in the rule matcher—you need to sample on other characteristics correlated with slowness. In practice, teams often create rules for specific endpoint paths known to be computationally expensive (image processing endpoints, complex report generation, machine learning inference) and sample those more aggressively. This gives you 10% to 20% sampling on the operations most likely to experience performance issues.

**Sampling healthy, fast requests at minimal rates** handles the high-volume baseline traffic that isn't going wrong and isn't particularly interesting. A health check endpoint returning a 200 status in 5 milliseconds? Sample at 0.1% or even lower. Standard API calls for authenticated users performing normal operations? 1% is reasonable. These requests consume most of your request volume but provide the least diagnostic value. Sampling them sparsely keeps costs down while still giving you visibility into normal operations.

A complete sampling strategy might look like this: errors at 100%, specific slow endpoints at 15%, latency-sensitive operations like database queries at 5%, and everything else at 0.5%. This tiered approach dramatically reduces costs while increasing your chances of capturing important traces.

### Configuring Sampling Rules via API and Console

You can manage sampling rules through the AWS Management Console or programmatically via the X-Ray API. The console provides a visual interface; the API enables infrastructure-as-code approaches.

Using the console is straightforward. Navigate to the X-Ray service, find the sampling rules section, and click to create a new rule. You'll specify the rule name, priority, and matching criteria. The priority field determines evaluation order—lower numbers are evaluated first. Then you set the fixed sampling rate (a decimal between 0 and 1, where 0.05 means 5%) and the reservoir size (minimum traces per second, regardless of sampling rate).

For production systems, however, the API approach is preferable because it integrates with your infrastructure-as-code practices. Using the AWS CLI, you can create a rule like this:

```bash
aws xray create-sampling-rule \
  --cli-input-json file://sampling-rule.json
```

Where `sampling-rule.json` contains:

```json
{
  "SamplingRule": {
    "ruleName": "checkout-errors",
    "priority": 1,
    "version": 1,
    "reservoirSize": 5,
    "fixedRate": 1.0,
    "urlPath": "/api/checkout/*",
    "host": "*",
    "httpMethod": "POST",
    "serviceName": "*",
    "serviceType": "*",
    "resourceARN": "*",
    "attributes": {}
  }
}
```

This rule samples POST requests to checkout endpoints at 100% with a reservoir of five traces per second. If your checkout service suddenly experiences a spike, the reservoir prevents runaway tracing while still capturing all errors and normal transactions up to the five-per-second limit.

Updating rules via API also allows you to version control your sampling configuration. Store your rules in a Git repository alongside your infrastructure-as-code, deploy rule changes through CI/CD pipelines, and audit who changed what and when. This contrasts sharply with console-based management, where changes are made ad-hoc and difficult to track.

The X-Ray SDK periodically polls for updated sampling rules (typically every 5 seconds for services using the X-Ray daemon, or immediately for services using the X-Ray SDK Lambda layer). This means changes to your rules take effect across your fleet relatively quickly without requiring service restarts.

### Implementing Rules for Common Application Patterns

Different application architectures benefit from different sampling strategies. Let's walk through several concrete scenarios.

**For a microservices architecture handling user-facing requests**, your sampling strategy should distinguish between critical user paths and background operations. A user clicking "buy now" deserves full tracing if an error occurs. A background job that runs hourly and is not user-facing can be sampled much more sparsely. You might implement rules like this: all requests to authentication and payment endpoints at 100% for errors and 10% for success, all requests to user profile endpoints at 5%, all background job requests at 0.1%.

**For a high-frequency trading or real-time analytics platform**, where latency and performance are paramount, the sampling strategy shifts. You might sample all requests longer than 100 milliseconds at 50%, requests between 50-100 milliseconds at 5%, and requests under 50 milliseconds at 0.1%. This inverted approach—sampling longer requests more heavily—ensures you capture the performance outliers most relevant to system optimization.

**For a Lambda-based event processing system**, where requests are triggered by SQS, SNS, or DynamoDB Streams, you'd sample failed invocations at 100% and successful invocations based on execution duration. A Lambda function that normally completes in 500 milliseconds but suddenly takes 10 seconds on a particular invocation is worth tracing. You might set rules for different functions separately, giving priority sampling to the most critical business logic.

**For a REST API serving mobile clients**, where bandwidth and latency directly impact user experience, you'd sample based on client type and operation importance. Authentication requests: 100% for errors, 20% for success. Critical user actions (payments, account changes): 100% for errors, 5% for success. Informational requests (listing products, reading comments): 1% overall.

In each case, the common thread is this: identify the requests that matter most for your business and observability needs, and sample those preferentially. The requests that don't provide information value get sampled sparsely or not at all.

### Monitoring and Optimizing Your Sampling Rules

Implementing sampling rules is not a set-and-forget exercise. You need ongoing monitoring to ensure your rules are achieving their intended goals: capturing important traces while controlling costs.

Start by establishing baseline metrics. Before deploying new sampling rules, record your current X-Ray costs, the volume of traces recorded, and the distribution of trace counts across different paths and status codes. This baseline lets you quantify the impact of your changes.

The X-Ray console provides a sampling rules dashboard showing, for each rule, how many traces were sampled and what percentage of matched requests were actually traced. This discrepancy between your configured sampling rate and actual sampling rate reveals whether your reservoirs are binding. If a rule is configured to sample 10% but actual sampling is running at 3%, it means the reservoir is full and requests are being rejected even though they match the rule. This is often a sign you need to increase the reservoir size or reconsider your sampling percentages.

Use CloudWatch metrics to track X-Ray activity over time. X-Ray publishes metrics for received requests and sampled traces, allowing you to build dashboards monitoring sampling effectiveness. A metric showing that your error rule is capturing 100% of errors but only 10% of requests overall confirms your rule is working as intended.

Set up alerts for anomalies. If the volume of sampled traces suddenly spikes 10x, something is wrong—either your service is experiencing an outage (generating errors at high rates) or your sampling configuration is broken. An alert lets you investigate quickly rather than discovering the cost impact in your next bill.

Query your traces to understand what you're capturing. The X-Ray service map visualization shows you which services are being traced and at what rates. If one service has far more traces than others, investigate whether that's intentional or a sign of a misconfigured rule.

Periodically review and adjust. Run a monthly analysis: what percentage of your requests are being sampled? How is that distributed across different paths and status codes? Are there gaps—important requests that aren't being sampled? Are there redundancies—low-value requests being sampled at rates higher than necessary? Use these insights to refine your rules.

### Cost-Benefit Analysis: When to Sample More Aggressively

Deciding how aggressively to sample requires understanding the cost-benefit tradeoff specific to your situation. A small team building an internal tool has different constraints than a high-growth startup processing billions of requests.

The financial equation is straightforward: number of traces recorded multiplied by the per-trace cost (which varies by region but typically runs around $0.50 per million traces). If you record 100,000 traces monthly, that's roughly $0.05 per month—negligible. If you record 100 million traces monthly, that's around $50 per month—worth optimizing.

The observability value, however, is harder to quantify but equally important. More traces give you better coverage of your system's behavior. The question is whether that coverage is worth the cost, and which traces provide the most value.

Consider this scenario: your application serves 100 million requests per month. At a 1% sampling rate, you're recording 1 million traces monthly, costing roughly $0.50. An error occurs once per month that affects 1,000 users. With 1% sampling, your expected number of traces capturing that error is 10—likely enough to diagnose the issue, but not guaranteed. An aggressive sampling strategy capturing 10% of error responses might cost $10 monthly for traces but would almost certainly give you dozens of captures of that error, making diagnosis easier.

Conversely, if you're running a mature, stable system with excellent monitoring already in place and errors are rare, bumping your overall sampling rate from 1% to 5% might cost an additional $2-3 monthly but provide minimal additional value. In this case, optimizing further—moving toward 0.1% sampling with targeted elevation for errors—makes more sense.

The calculus also depends on your incident response capabilities. A team with on-call engineers ready to dive deep into trace data gets more value from aggressive sampling than a team without dedicated observability expertise. If diagnosing issues requires hours of trace analysis anyway, additional traces might accelerate that process.

Cost optimization for X-Ray tracing ultimately comes down to conscious allocation of your observability budget. Instead of sampling uniformly, identify what matters most and invest your tracing budget there.

### Avoiding Common Pitfalls

Several mistakes regularly snare teams as they optimize their sampling configurations.

**Setting rules in the wrong order** is perhaps the most common. If you create a broad rule with low priority (evaluated first) that matches many requests, more specific rules with higher priority numbers (evaluated later) are dead code. Always order rules from most specific to most general, with the default rule at the end.

**Ignoring reservoirs** leads to unexpectedly low sampling rates. A rule configured for 100% sampling with a reservoir of zero means no traces are recorded—the reservoir acts as an absolute cap. Teams often discover this when their errors aren't being traced despite a 100% error sampling rule. Always set meaningful reservoirs for production rules, typically at least 1-5 traces per second depending on your traffic.

**Sampling too sparsely on critical paths** creates blind spots. A payment processing system sampling transactions at 0.1% might handle 100,000 transactions daily but record only 100 traces. A rare but critical bug affecting every 10,000th transaction might never appear in your traces. Be more generous with sampling on genuinely critical operations.

**Forgetting to monitor rules after deployment** means you're flying blind. A rule that looks good in theory might behave unexpectedly in production as actual traffic patterns emerge. Regular monitoring and adjustment keeps your sampling effective.

**Not communicating rule changes** across teams creates confusion. If your platform team implements new sampling rules without notifying application teams, those teams might continue operating under outdated assumptions about trace availability. Document your sampling strategy and make it discoverable.

### Conclusion

X-Ray sampling represents one of the most misunderstood aspects of production observability on AWS. The default 1% sampling rate was designed as a conservative baseline suitable for evaluation, not optimization. Real production systems demand thoughtful sampling strategies that capture the traces that matter most while controlling costs.

Effective sampling rules recognize that not all requests are equal. Errors deserve high sampling rates because they're inherently interesting. Slow requests deserve elevated sampling to catch performance problems. Successful, fast operations deserve minimal sampling because they're unlikely to reveal issues. By implementing tiered sampling strategies—using the API for infrastructure-as-code management, setting appropriate priorities and reservoirs, and monitoring effectiveness over time—you create an observability system that gives you visibility where it matters without the runaway costs that trap teams using naive uniform sampling.

The path forward involves viewing your sampling configuration not as a one-time setup but as an ongoing optimization exercise. Start with error and slow request rules, establish baselines, monitor your actual sampling rates and costs, and refine your configuration based on the patterns emerging in your production environment. The goal isn't to trace everything; it's to trace the right things, the right way, at a cost that makes sense for your business.
