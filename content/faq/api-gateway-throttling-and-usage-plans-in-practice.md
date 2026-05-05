---
title: "API Gateway Throttling and Usage Plans in Practice"
---

## API Gateway Throttling and Usage Plans in Practice

Every API has limits—that's just reality. Whether you're protecting your backend infrastructure, preventing abuse, or simply managing costs, understanding how API Gateway throttles requests is crucial knowledge for any developer building on AWS. Too many requests hit your backend simultaneously, and you'll either face cascading failures or an unexpectedly massive bill. Too restrictive a throttle, and legitimate users bounce away frustrated. The sweet spot? That's what we're exploring today.

API Gateway's throttling system is deceptively elegant. On the surface, it looks simple: requests come in, some get through, others get rejected with a 429 status code. But beneath that surface lies a layered architecture with multiple throttling points, burst capacity versus rate capacity, and sophisticated quota mechanisms tied to usage plans and API keys. Understanding these layers isn't just academic—it directly impacts how you architect scalable, reliable APIs that handle real-world traffic patterns gracefully.

### Understanding the Throttling Hierarchy

AWS API Gateway enforces throttling at multiple levels, and thinking of these as nested layers helps clarify how they interact. At the broadest level sits account-level throttling, which protects the entire AWS region. Nested within that is per-API stage throttling, which protects individual stages of your API. Finally, at the most granular level, usage plans and API keys apply method-level throttling and quota constraints to specific API operations and consumers.

Think of it like traffic management in a city. Account-level throttling is the city's overall capacity—if too many cars enter from all directions, the entire city grinds to a halt. Per-stage throttling is like managing traffic into a specific neighborhood—you can tighten controls there without affecting other districts. Usage plans are like individual driver permits—they specify exactly how much certain drivers can use the system.

### Account-Level Throttling: The Baseline

By default, API Gateway allows your AWS account to handle 10,000 requests per second across all APIs and stages in a given region. This isn't a hard wall; it's more accurate to say that this is your *rate capacity*—the sustained level of requests the system will consistently handle. But what about sudden spikes? That's where *burst capacity* comes in. API Gateway permits brief bursts up to 5,000 requests per second on top of your sustained rate, giving you a total momentary capacity of 15,000 requests per second. This burst window is typically a matter of seconds—it's designed to absorb temporary traffic spikes from legitimate traffic patterns, not to provide unlimited headroom indefinitely.

These account-level limits are regional, not global. If you operate in `us-east-1` and `eu-west-1`, each region has its own 10,000 RPS sustained capacity and 5,000 RPS burst. This design reflects AWS's own capacity planning—they want to ensure no single account can monopolize an entire region's resources.

What happens when you hit these limits? API Gateway returns HTTP 429 (Too Many Requests) responses with a `Retry-After` header, giving clients guidance on when to retry. The requests that trigger 429 responses are tracked in CloudWatch metrics under the `Throttle` metric, which we'll explore in detail later.

### Per-API Stage Throttling: Fine-Grained Control

Account-level limits are essential, but they're often too coarse. Imagine you have three APIs in production: a critical payment service, a reporting engine, and an experimental feature. You don't want the experimental feature consuming half your account's throttle budget during a load test, starving the payment service. That's where per-stage throttling comes in.

You can override the default throttling settings on a per-stage basis through the stage settings in API Gateway. Instead of relying purely on the account-level 10,000 RPS sustained rate, you can explicitly set `rateLimit` (in requests per second) and `burstLimit` (in requests per second) for any stage. These values cannot exceed the account-level limits, but they allow you to partition your capacity more intelligently.

For example, you might configure your payment API's production stage with `rateLimit: 5000` and `burstLimit: 2500`, reserving 5,000 of your 10,000 account RPS for this critical service. Your reporting engine might get `rateLimit: 3000` and `burstLimit: 1500`. The experimental feature gets `rateLimit: 2000` and `burstLimit: 500`. Now, even if the experimental feature gets hammered, it can only consume up to 2,500 RPS during bursts, leaving room for your critical services.

Setting these limits is straightforward through the AWS Management Console, CloudFormation, or the AWS CLI. Here's how you'd configure it via the AWS CLI:

```bash
aws apigateway update-stage \
  --rest-api-id abc123 \
  --stage-name prod \
  --patch-operations \
    op=replace,path=/*\/throttle\/rateLimit,value=5000 \
    op=replace,path=/*\/throttle\/burstLimit,value=2500
```

The `*` wildcard applies these settings to all resources and methods in the stage. You could also be more granular with paths like `/*/*/throttle/rateLimit` to target specific resources.

### Usage Plans and API Keys: Method-Level Control

While per-stage throttling partitions capacity across your APIs, usage plans and API keys push throttling down to the method level and, more importantly, to the consumer level. This is where API Gateway transforms from a simple request router into a sophisticated API management platform.

A usage plan is essentially a contract that specifies what a consumer (often identified by an API key) is allowed to do. It defines three things: throttle settings (rate and burst limits for that consumer), quota limits (maximum number of requests in a time period), and which API stages the consumer can access.

Here's a practical scenario: you're building a SaaS platform with a free tier and a premium tier. All free-tier users share a usage plan that throttles them to 100 requests per second with a burst of 50, and limits them to 1 million requests per month. Premium users get a different usage plan: 1,000 requests per second sustained, 500 burst, and 100 million requests per month. Each user gets an API key tied to their usage plan, and as they make requests, their consumption is tracked against both the throttle limits and the quota.

To set this up, you'd first create the usage plans:

```bash
aws apigateway create-usage-plan \
  --name free-tier \
  --description "Free tier - limited throughput" \
  --throttle-settings rateLimit=100,burstLimit=50 \
  --quota-settings limit=1000000,period=MONTH
```

Then create API keys for users:

```bash
aws apigateway create-api-key \
  --name user-123-key \
  --enabled
```

Finally, associate the API key with the usage plan:

```bash
aws apigateway create-usage-plan-key \
  --usage-plan-id <plan-id> \
  --key-id <key-id> \
  --key-type API_KEY
```

Once configured, requests must include the API key (typically via the `x-api-key` header or a query parameter, depending on your API configuration) to be evaluated against the usage plan's throttle and quota settings. Requests without a key, or with an invalid key, are rejected before reaching your backend.

The interesting wrinkle: when both per-stage throttling and usage plan throttling apply, the more restrictive limit wins. If your stage is set to 5,000 RPS but a usage plan specifies 100 RPS, that consumer sees 100 RPS. This layering allows API Gateway to enforce both account-wide fairness and individual consumer fairness.

### Quota Tracking and Monthly Limits

Quotas differ from throttling in a critical way. Throttling is about rate—how fast requests flow at any given moment. Quotas are about volume—how much total consumption is allowed in a time period, typically a month.

Imagine a usage plan with a 1 million request-per-month quota. API Gateway tracks every request from API keys associated with that plan, accumulating them toward the limit. When a consumer hits the quota, subsequent requests are rejected with a 429 response, just like throttling, but the reason is quota exhaustion rather than rate violation.

The quota clock resets on the calendar month (not a rolling 30-day window). On the first of each month, counters reset to zero. This simplicity is both a feature and a limitation—it means month-end can be chaotic as customers rush to use remaining quota before the reset, but it also makes billing predictable and quota management straightforward.

One subtlety: quota is tracked at the usage plan level, not the API key level. If you have one usage plan with ten API keys, they share the same quota pool. All ten keys combined can make 1 million requests per month. If you want per-key quotas, you need separate usage plans per key, which doesn't scale well. This is actually a strength—it encourages API designers to think about fair-share semantics and shared resource management, rather than over-provisioning isolated quotas.

### The ThrottledException and Client Handling

When API Gateway throttles a request, the client receives an HTTP 429 response with specific headers and, optionally, a response body. Understanding this response format is essential for building robust clients.

The response includes a `Retry-After` header specifying how long (in seconds) the client should wait before retrying. Critically, this is guidance, not a guarantee—it's calculated based on the current throttle bucket state, but the actual recovery time might be different depending on how traffic patterns evolve. A well-behaved client should at least respect this header as a lower bound.

The response body is typically minimal. You might see something like:

```json
{
  "message": "Rate exceeded",
  "x-amzn-RequestId": "abc123def456"
}
```

The `x-amzn-RequestId` is valuable for debugging—you can correlate it with CloudWatch logs to trace exactly which request was throttled and why.

Handling 429 responses client-side requires more sophistication than simply retrying immediately. The standard approach is *exponential backoff with jitter*. The idea is straightforward: when throttled, wait a random amount of time with exponentially increasing bounds, then retry. This prevents the thundering herd problem where many clients all retry simultaneously after a throttle event, which would just cause more throttling.

Here's a conceptual example in pseudo-code:

```
function requestWithBackoff(operation, maxRetries = 5):
  for attempt in range(maxRetries):
    try:
      response = makeRequest(operation)
      if response.status != 429:
        return response
      
      # Exponential backoff: wait 2^attempt seconds plus random jitter
      baseDelay = 2 ^ attempt
      jitter = random(0, baseDelay)
      delaySeconds = baseDelay + jitter
      
      # Respect the Retry-After header if present
      if response.headers['Retry-After']:
        delaySeconds = max(delaySeconds, parseInt(response.headers['Retry-After']))
      
      sleep(delaySeconds)
    except Exception as e:
      # Handle other errors
      raise e
  
  # All retries exhausted
  throw new MaxRetriesExceededException()
```

The jitter is crucial—it prevents coordinated retry storms. If you have 1,000 throttled clients all backing off for exactly 2 seconds, they'll all retry at once and trigger another throttle event. Adding random jitter spreads those retries across time, reducing collision.

Different AWS SDKs implement this differently, but modern versions of the SDK (boto3, JavaScript SDK v3, etc.) include built-in retry logic with exponential backoff and jitter. If you're building on top of those SDKs, you might get reasonable defaults automatically. If you're making raw HTTP requests or using an older SDK, implementing your own backoff is non-negotiable.

### Monitoring Throttling with CloudWatch Metrics

Understanding what's happening requires visibility, and API Gateway integrates deeply with CloudWatch to provide it. Several metrics are particularly relevant for throttling analysis.

The `Count` metric tracks the total number of requests reaching API Gateway for a given API, stage, or method. It's your baseline for understanding traffic volume.

The `Throttle` metric tracks how many requests were rejected due to throttling—either account-level, per-stage, or usage plan throttling. This is your early warning system. A sudden spike in `Throttle` might indicate a traffic surge, a client-side bug causing request floods, or a competitor's reconnaissance activity.

The `4XXError` metric includes 429 responses triggered by throttling, but also includes 400 Bad Request, 403 Forbidden, and other client-side errors. To isolate throttling specifically, filter on the 429 status code if your monitoring tool supports it.

Finally, `5XXError` metrics track server-side errors from your backend integration, which can be correlated with `Throttle` metrics to understand if throttling is preventing errors downstream.

Fetching these metrics via the AWS CLI looks like:

```bash
aws cloudwatch get-metric-statistics \
  --namespace AWS/ApiGateway \
  --metric-name Throttle \
  --dimensions Name=ApiName,Value=my-api \
                Name=Stage,Value=prod \
  --start-time 2024-01-01T00:00:00Z \
  --end-time 2024-01-02T00:00:00Z \
  --period 300 \
  --statistics Sum,Average
```

The `--period` parameter sets the granularity—300 seconds means data points every 5 minutes. Smaller periods give finer detail but might show more noise; larger periods smooth out spikes but can hide brief problems.

Setting up CloudWatch alarms on throttle metrics is wise. If throttling exceeds a threshold (say, more than 100 requests per minute), it signals that your API might be hitting capacity limits and needs investigation or scaling.

### Service Quotas and Requesting Increases

The account-level 10,000 RPS rate and 5,000 RPS burst limits aren't truly hard walls—they're service quotas, and AWS allows you to request increases if you can justify them.

Requesting a quota increase is a formal process. You navigate to the Service Quotas console, find the API Gateway service, locate the quota you want to increase (like "API Gateway request rate"), and submit a request with a reason. AWS reviews it and either approves or denies based on your account history and AWS capacity.

The process takes anywhere from hours to days, so planning ahead is essential. If you're deploying a marketing campaign that will drive a 2x traffic surge next month, requesting a quota increase now is wise. Waiting until traffic actually arrives and hitting the limit means your API fails under load while your request is processed.

It's also worth noting that even if your request is approved, AWS might stage the increase. They might grant you 12,000 RPS today and another 8,000 next week, rather than immediately jumping to 20,000. This protects both your account (sudden huge traffic could expose bugs) and AWS infrastructure.

### Cost Implications and Capacity Planning

Here's a fact that surprises many developers: throttled requests cost money. API Gateway pricing is based on the number of requests processed, not the number of requests successfully delivered. A request that's rejected with a 429 response still counts toward your monthly bill.

This changes your cost calculus significantly. If you're throttling 10,000 requests per day due to under-provisioning, and those requests cost $0.00035 each, that's $3.50 per day wasted on requests that never reached your backend and provided no value. Worse, if those requests trigger client-side retries, the cost multiplies. A request retried three times due to throttling costs 3x as much as a request that succeeds on the first try.

This incentivizes proper capacity planning. Before deploying to production, load test your API with realistic traffic patterns. Use tools like Apache JMeter or AWS Elastic Load Testing to simulate concurrent users and request patterns. Monitor when throttling starts occurring and establish your actual capacity ceiling. Then, set per-stage throttle limits well below that ceiling—not at it—to provide headroom for burst traffic.

A practical approach: if your load test shows you can sustainably handle 2,000 RPS on your payment API before backend response times degrade, set per-stage throttling to 1,500 RPS. This gives you 25% headroom. If you expect 20% traffic growth over the next quarter, set it to 1,600 RPS and plan a quota increase request for later in the quarter.

Cost also influences your usage plan pricing model. A competitor building a freemium API might price the free tier at 50 RPS with a 10 million request/month quota. That's ambitious—it means each free user can only average about 4.7 requests per second over a month, or they'll hit quota. But those throttled requests still cost you even though you're not charging the user. Factoring in throttled request costs when pricing tiers is essential to ensure the math works.

### Putting It All Together: A Practical Architecture

Let's ground this in a real scenario. You're building an analytics API that different teams within your company will use. The platform team manages infrastructure. The data science team needs high throughput for training jobs. The product team needs reliable, lower-volume access for dashboard queries.

Your architecture might look like this:

You set account-level expectations at the regional level: 10,000 RPS sustained, 5,000 RPS burst. You're confident this won't be exceeded based on historical usage of other APIs.

For your analytics API's production stage, you set per-stage throttling to 8,000 RPS sustained and 4,000 RPS burst. This reserves 20% of account capacity for other APIs.

You create three usage plans: "data-science" (2,000 RPS, 1,000 burst, unlimited monthly quota), "product-dashboard" (500 RPS, 250 burst, unlimited monthly quota), and "external-partners" (100 RPS, 50 burst, 10 million requests/month quota).

You configure the data science team's API keys to use the data-science usage plan. During their nightly model training run, they can burst up to 2,000 RPS momentarily, but their sustained rate is capped at 2,000 RPS. This is enough for their batch jobs without starving other users.

The product dashboard team uses the product-dashboard plan. Their queries are more interactive and lower volume—500 RPS sustained is plenty, and if a report suddenly needs to fetch more data, the 250 RPS burst provides relief.

External partners use the external-partners plan. You trust them, but you also want to ensure no single partner can monopolize your API. They're rate-limited to 100 RPS, and across all partners combined, you're limiting consumption to 10 million requests per month. If they exceed that, it's probably a bug or an unexpected spike in their consumption, and it's fair to pause them until you've discussed the increase.

Your monitoring strategy focuses on the `Throttle` metric per usage plan. If you see data science throttled more than 100 times per day, you know they're hitting their limit and either need more capacity or need to batch their requests more efficiently. If you see external partners throttled frequently, you reach out to understand their usage pattern.

You set up a CloudWatch alarm: if the payment API stage ever sees more than 10 throttled requests per minute, it pages your on-call engineer. This prevents silent failures that damage user trust.

### Conclusion

API Gateway's throttling system is sophisticated, but it's designed around a clear principle: fair sharing of resources. At the account level, AWS ensures no single account monopolizes a region. At the per-stage level, you ensure no single API starves your others. At the usage plan level, you ensure no single consumer dominates your service.

Understanding these layers, respecting the ThrottledException with proper exponential backoff, monitoring diligently with CloudWatch, and planning capacity thoughtfully are hallmarks of production-grade API design. The details matter—whether you're setting burst capacity, respecting Retry-After headers, or factoring throttled request costs into your pricing models. Master these mechanics, and you'll build APIs that scale gracefully, cost-effectively, and reliably, even under unexpected load.
