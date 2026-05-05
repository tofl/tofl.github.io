---
title: "Route 53 Health Checks Explained: Endpoint, Calculated, and CloudWatch Alarm Types"
---

## Route 53 Health Checks Explained: Endpoint, Calculated, and CloudWatch Alarm Types

When you're running applications on AWS, knowing whether your endpoints are actually healthy isn't just nice to have—it's fundamental to building resilient systems. Route 53, AWS's managed DNS service, gives you powerful tools to detect problems and automatically route traffic away from failing resources. At the heart of this capability sit health checks, and understanding their three distinct types is crucial for anyone building production-grade applications on AWS.

Health checks in Route 53 serve as your automatic sentinel, continuously monitoring your infrastructure and making split-second decisions about where traffic should flow. But not all health checks work the same way, and choosing the wrong type for your use case can lead to unnecessary costs, delayed failure detection, or worse—traffic flowing to broken services. This article walks you through each health check type, how they work, and when to use them.

### Understanding the Three Types of Route 53 Health Checks

Route 53 offers three fundamental types of health checks, each designed to solve a different monitoring challenge. Rather than thinking of them as completely separate tools, it's helpful to see them as building blocks that can work together to create sophisticated, multi-layered health monitoring strategies.

The three types are endpoint health checks (which actively probe your infrastructure), calculated health checks (which combine the results of other health checks), and CloudWatch alarm-based health checks (which tie DNS decisions to custom metrics). Most real-world applications use a combination of all three, layered strategically to catch different failure modes.

### Endpoint Health Checks: Active Probing and Direct Monitoring

Endpoint health checks are the workhorse of Route 53 health checking. They actively reach out to your infrastructure and probe it—testing whether a specific endpoint is responding as expected. This is the most direct form of health checking, and it's what you'll reach for when you want to monitor web servers, application servers, or any service that can respond to HTTP, HTTPS, or TCP requests.

When you create an endpoint health check, you specify a protocol (HTTP, HTTPS, or TCP), a hostname or IP address, a port, and optionally a path and a string to match in the response. Route 53 then dispatches health checker agents from regional locations around the world to your endpoint at regular intervals, collecting evidence about whether your service is alive and responding correctly.

The mechanics are straightforward but worth understanding. When a health checker sends a request to your endpoint, it's looking for a successful response within a specific timeout period. For HTTP and HTTPS, a successful response means receiving a 2xx or 3xx status code. For TCP, it simply means the connection completes successfully. If you provide a string to match, Route 53 additionally checks that the response body contains that exact string—a powerful feature for validating not just that your server is up, but that it's actually healthy and serving the right content.

Consider a practical scenario: you're running a microservice on an EC2 instance listening on port 8080. You might configure an endpoint health check like this:

```
Protocol: HTTP
Host: myapp.example.com
Port: 8080
Path: /health
String to match: "status":"ok"
```

Every 30 seconds (the default interval), Route 53 sends an HTTP request to `http://myapp.example.com:8080/health`, examines the response code, and looks for the JSON fragment `"status":"ok"` in the body. If all checks pass, the health check is considered healthy. If it fails, the health check begins tracking failures.

This brings us to an important concept: the failure threshold. By default, Route 53 considers a health check unhealthy after three consecutive failed checks. This means your endpoint can fail once or twice without triggering a failover, giving you resilience against transient network hiccups. You can adjust this threshold from 1 to 10 failed checks, depending on how aggressive you want your failure detection to be. If you're monitoring a flaky endpoint, a higher threshold might reduce false positives. If you're monitoring something that should never fail, a threshold of 1 gets you immediate action.

#### Checking Intervals and Fast Checks

By default, Route 53 performs endpoint health checks every 30 seconds. For many applications, this is perfectly adequate—your DNS records will update within 30 seconds of a real failure, and traffic will reroute accordingly. However, some applications demand faster detection, especially those serving critical workloads where every second of downtime matters.

Route 53 offers "fast" health checks that run every 10 seconds instead of 30. This tighter monitoring comes with a trade-off: you pay for it. Fast health checks cost more than standard health checks, so you'll want to reserve them for your most critical endpoints. In practice, fast health checks are often used in conjunction with calculated health checks or other mechanisms to create a multi-layered detection strategy, catching severe failures in the 10-second window while using slower, cheaper checks for secondary monitoring.

#### String Matching for Content Validation

The string matching feature deserves special attention because it's often underutilized. Many developers configure health checks to simply check that a web server returns a 200 status code, but that's often not enough. A broken application might still return 200 while serving garbage data, or a database connection pool might be exhausted but the load balancer is still up.

By specifying a string to match in the response body, you're moving toward application-level health checking rather than just infrastructure-level health checking. Your `/health` endpoint should do real work: check that database connections are available, verify that dependent services are reachable, and return a consistent string only when everything is actually working.

For example, your health endpoint might return:

```json
{
  "status": "healthy",
  "database": "connected",
  "cache": "connected",
  "version": "1.2.3"
}
```

You'd then configure Route 53 to match the string `"status":"healthy"`, and Route 53 won't consider the check passed unless that exact string appears in the response. This is a simple but surprisingly powerful form of semantic health checking.

#### Regional Health Checker Locations

Route 53 runs health checkers from multiple AWS regions around the world. When you create an endpoint health check, you can configure Route 53 to use health checkers from all regions, or you can select specific regions. This might seem like a minor detail, but it actually affects both your resilience and your costs.

If you enable health checking from all regions, you get multiple independent vantage points. If one regional health checker network suffers a temporary outage, the others will still be checking your endpoint. This protects you against false positives where a temporary connectivity issue between one region and your endpoint triggers a failover. However, checking from all regions means more requests hitting your endpoints and higher costs.

Some teams configure health checks to run from only a few regions—perhaps the regions closest to their application. This reduces costs and endpoint load, but it means you're getting fewer independent vantage points. There's no universally right answer; it depends on your risk tolerance and budget.

### Calculated Health Checks: Composing Health Intelligence

If endpoint health checks are like individual sensors, calculated health checks are like the control systems that make decisions based on multiple sensors. A calculated health check doesn't directly probe anything; instead, it examines the status of multiple child health checks and combines their results using simple logic to produce a final health status.

This is invaluable when you want to express complex health conditions. Maybe your application cluster is healthy if at least two out of three endpoints are responding, or you want to fail over only if multiple systems show problems simultaneously, or you want to require that all of several dependent services are healthy before you consider your endpoint good.

Creating a calculated health check involves specifying child health checks and a decision logic. You can combine child health checks using either AND logic (all children must be healthy) or OR logic (at least one child must be healthy), and you can optionally invert the result.

Consider a practical example: you're running a redundant application across three availability zones. Each AZ has an endpoint health check monitoring its local instance. You create a calculated health check with AND logic across all three child checks if you want to declare the application healthy only when all three AZs are up. Alternatively, if you want the application to be considered healthy as long as at least one AZ is available, you'd use OR logic.

This becomes particularly powerful when combined with Route 53's routing policies. You might have a calculated health check that's healthy if at least two of your three endpoints are up, and then use weighted routing to distribute traffic across your endpoints, but mark the entire endpoint set as unhealthy if fewer than two are responding. This gives you fine-grained control over failover behavior.

#### Building Multi-Level Health Hierarchies

You can nest calculated health checks, creating hierarchies of health logic. For instance, you might have:

- Primary health checks monitoring individual endpoints
- Calculated health checks at the region level (healthy if majority of endpoints in that region are up)
- A top-level calculated health check that evaluates whether the entire service is healthy across regions

This hierarchical approach lets you model complex applications and create sophisticated failover strategies without overwhelming your DNS configuration.

One important caveat: calculated health checks only examine the status of their child health checks. They don't perform any direct monitoring themselves. This means that if all your endpoint health checks are failing, your calculated health check will report as unhealthy—but it can't tell you why because it's not directly observing the failures. This is why you typically layer calculated health checks on top of endpoint or CloudWatch alarm health checks, not as replacements.

### CloudWatch Alarm-Based Health Checks: Metrics-Driven DNS

The third type of health check bridges Route 53 with CloudWatch, AWS's monitoring and observability service. A CloudWatch alarm-based health check lets you tie DNS decisions to custom metrics and alarms. Instead of Route 53 probing your endpoint directly, you configure Route 53 to watch a CloudWatch alarm, and that alarm's state drives whether the health check is considered healthy.

This is remarkably flexible. You might have a custom CloudWatch metric tracking your application's queue depth, error rate, or response latency. When that metric crosses a threshold, CloudWatch creates an alarm. Route 53 watches that alarm, and when it transitions to an ALARM state, Route 53 considers the health check unhealthy and can trigger failovers or route traffic elsewhere.

The advantage here is decoupling: your health decision logic can be as sophisticated as you want. You can use CloudWatch's advanced features like anomaly detection, composite alarms, and metric math. Your health checks aren't limited to simple yes/no decisions based on HTTP response codes; they can be based on actual application behavior and performance metrics.

A practical scenario: you're monitoring API response latency, and you've configured a CloudWatch alarm to trigger when the 99th percentile latency exceeds 500ms. You create a CloudWatch alarm-based health check tied to this alarm. When latency spikes significantly, the alarm triggers, Route 53 sees the alarm in ALARM state, and clients are routed to a geographically distant standby that still has good latency. This is much more sophisticated than simply checking whether the endpoint is up.

CloudWatch alarm-based health checks also allow you to monitor resources that Route 53 can't directly probe. You might have a Lambda function or a database that you can't (or don't want to) expose to HTTP probing. Instead, your application sends metrics to CloudWatch, you configure alarms on those metrics, and Route 53 watches the alarms. This gives you DNS-level routing decisions driven by deep insights into your application's health.

#### Alarm State and Health Check Status

CloudWatch alarms have three states: OK, ALARM, and INSUFFICIENT_DATA. When you create a CloudWatch alarm-based health check, you specify what Route 53 should consider as healthy. Typically, you'd say the health check is healthy when the alarm is in OK state and unhealthy when it's in ALARM state. However, you can also configure how Route 53 treats INSUFFICIENT_DATA state, which occurs when an alarm hasn't received enough data points to make a decision yet.

One important consideration: CloudWatch alarm-based health checks don't themselves verify that your endpoint is responding. They're purely metric-based. This means you might create an alarm-based health check that reports as healthy, but your endpoint is actually down because no one has updated the metric to reflect the failure. To prevent this scenario, it's common to combine alarm-based health checks with endpoint health checks or to ensure that your metrics are being updated regularly by running code that explicitly sends them.

### Pricing and Cost Considerations

Understanding health check costs is important for building cost-effective architectures. Route 53 charges per health check per month, with different rates for different types.

Standard endpoint health checks (30-second intervals) are the least expensive option. If you're running dozens of health checks, costs remain reasonable. Fast endpoint health checks (10-second intervals) cost more—roughly triple the price of standard checks—so you'll want to reserve them for critical endpoints where the faster detection justifies the cost.

Calculated health checks and CloudWatch alarm-based health checks cost less than endpoint health checks because they're not performing direct probing; they're just aggregating data or watching metrics. This makes them attractive for scenarios where you can model your health logic around existing metrics and alarms rather than requiring direct endpoint probing.

In practice, most applications use a mixed strategy: a few fast endpoint health checks on the most critical endpoints, standard endpoint checks on others, and calculated or alarm-based checks to combine them intelligently. This keeps costs manageable while providing good failure detection.

### Designing Resilient Health Check Architectures

Now that you understand the three types of health checks, how do you actually design your health check strategy? There's no one-size-fits-all answer, but some patterns have emerged from real-world applications.

For a typical three-tier application running across multiple availability zones, you might configure:

A set of endpoint health checks, one per endpoint you want to monitor. These might be running every 30 seconds on standard endpoints and every 10 seconds on your critical API endpoints. Each check probes a `/health` endpoint that validates database connectivity and dependent service availability.

A calculated health check at the availability zone level. This check uses OR logic across the endpoints in each AZ, declaring the AZ healthy if at least one endpoint is up. This protects against false positives if a single endpoint temporarily becomes unhealthy.

A top-level calculated health check using OR logic across the AZ-level checks, declaring your entire service healthy if at least one AZ is fully operational.

A CloudWatch alarm-based health check monitoring your application's error rate. If errors spike above a threshold, the alarm triggers, and Route 53 routes traffic away even if the endpoints are technically responding.

This combination gives you defense in depth: quick detection of complete endpoint failures (via endpoint checks), resilience against single-endpoint issues (via AZ-level aggregation), resilience against regional problems (via multi-region aggregation), and behavioral health monitoring (via CloudWatch alarms).

### Monitoring Your Health Checks

Remember that health checks themselves need to be monitored. Route 53 tracks metrics about your health checks in CloudWatch, including the percentage of health checkers that consider an endpoint healthy. You can set up alarms on these metrics to alert you if health check data quality degradation occurs—for instance, if health checkers in a particular region are consistently failing to reach your endpoint, it might indicate a network problem.

Additionally, remember that health checkers make requests to your endpoints. If you're running thousands of health checks or using fast checking on many endpoints, the aggregate traffic from health checkers can become significant. Some teams implement health check endpoints that bypass authentication or skip expensive operations, returning responses quickly without full application processing. This keeps health checks lightweight and prevents them from affecting your application's normal workload.

### Conclusion

Route 53 health checks are a sophisticated tool for building resilient, automatically healing DNS-based architectures. Endpoint health checks give you direct visibility into your infrastructure's responsiveness. Calculated health checks let you compose complex health decisions from simpler ones. CloudWatch alarm-based health checks tie DNS routing to application-level metrics and behavior. Rather than choosing one type, the most robust applications use all three, layered together to catch different failure modes and create redundant decision-making pathways.

When you're designing your Route 53 configuration, think about what you actually want to detect: Are you protecting against complete endpoint failures, or are you also trying to catch partial failures like increased latency or error rates? Do you need fast detection measured in seconds, or is 30-second detection adequate? Can you express your health logic in terms of existing CloudWatch metrics, or do you need direct endpoint probing? The answers to these questions will guide you toward the right combination of health check types for your workload.

With health checks properly configured, Route 53 becomes the nervous system of your distributed application, continuously gathering data and automatically making routing decisions that keep traffic flowing to healthy endpoints. That's a powerful foundation for building systems that stay up when things go wrong.
