---
title: "Implementing Canary Deployments with Route 53 Weighted Routing"
---

## Implementing Canary Deployments with Route 53 Weighted Routing

Deploying new application versions while keeping your service running smoothly is one of the toughest challenges in production environments. You want to validate that your changes work correctly before exposing them to all your users, but you can't afford downtime. This is where canary deployments come in—a strategy that releases new code to a small subset of traffic first, monitors for issues, and gradually rolls out to everyone if all looks good.

While many developers think of canary deployments as an application-layer concern, Route 53 weighted routing offers a powerful DNS-level approach that's elegant, simple, and worth understanding. In this article, we'll explore how to use Route 53's weighted routing policy to implement canary and blue/green deployments, walk through a practical example, and compare this technique with other AWS approaches like Application Load Balancer weighted target groups and CodeDeploy.

### Understanding Route 53 Weighted Routing

Route 53, AWS's managed DNS service, lets you control traffic distribution by assigning weights to DNS records. When you create multiple weighted records for the same domain name, Route 53 distributes incoming DNS queries among them based on their relative weights. Think of it like a lottery where each record gets a ticket, and the number of tickets determines how often its name is chosen.

For example, if you create two A records for `api.example.com` pointing to different endpoints with weights of 90 and 10 respectively, approximately 90% of DNS resolutions will return the first endpoint while 10% return the second. This distribution happens at the DNS layer, making it a coarse-grained but highly effective way to control traffic flow.

What makes this approach particularly valuable for canary deployments is its simplicity and independence from application infrastructure. You don't need to modify your application code or configure load balancer rules. You simply create new DNS records, assign weights, and let Route 53 handle the traffic split. When you're ready to complete the rollout or rollback, you adjust the weights or delete records—operations that are atomic and immediate from a DNS perspective.

### The Canary Deployment Pattern with Route 53

A canary deployment using Route 53 weighted routing follows a predictable pattern. You start with your production endpoint receiving 100% of traffic. When you're ready to deploy a new version, you create a new endpoint (perhaps in the same region, a different region, or an entirely separate infrastructure stack) and add a new weighted DNS record pointing to it with minimal weight—say 5% or 10%.

You then monitor metrics from both the old and new endpoints: error rates, latency, application-specific metrics, and business metrics. If everything looks healthy, you gradually increase the weight on the new version while decreasing the weight on the old one. This might follow a pattern like 90/10, then 70/30, then 50/50, then 20/80, and finally 0/100. At each step, you pause and monitor before proceeding. If you detect problems at any stage, you immediately shift traffic back to the old version by adjusting weights.

The beauty of this pattern is that it's entirely DNS-driven. Your application servers don't need to know they're part of a canary deployment. They just serve requests. Route 53 handles all the traffic steering.

### Setting Up Your First Weighted Routing Records

Let's walk through a concrete example. Suppose you have an API running at `old-api.example.com` (perhaps an IP address, an Application Load Balancer, or a CloudFront distribution), and you've deployed a new version at `new-api.example.com`. You want to gradually shift traffic from the old to the new.

First, create a weighted record set in Route 53 for your main domain name pointing to the old endpoint:

```
Name: api.example.com
Type: A (or CNAME, depending on your endpoint type)
Set ID: old-version
Weight: 100
Value: old-api.example.com (or its IP address)
TTL: 60
```

Note the Set ID—this is required for weighted routing and should uniquely identify this record. The TTL (time to live) is set low at 60 seconds, which we'll discuss in more detail shortly.

Now, deploy your new version and create a second record:

```
Name: api.example.com
Type: A (or CNAME)
Set ID: new-version
Weight: 5
Value: new-api.example.com (or its IP address)
TTL: 60
```

You now have two records for the same name. Route 53 will distribute traffic roughly 95/5 between them. When a client makes a DNS query for `api.example.com`, Route 53's weighted routing algorithm picks one of the two records based on their weights and returns that answer.

### The Critical Role of Low TTL Values

Here's something that catches many developers off guard: DNS caching. When you make a DNS query, the result gets cached at multiple layers—your operating system's resolver, your company's DNS resolver, your ISP's resolver, and sometimes even in your application itself. If your TTL is high (say, 3600 seconds or one hour), changing Route 53 weights will have no immediate effect on existing connections or even new connections from cached-result users.

For canary deployments, you need a low TTL. A TTL of 60 seconds is typical. This means DNS results are cached for only one minute, so your weight changes propagate across the internet relatively quickly. The tradeoff is increased DNS query load—more queries hitting Route 53—but this is usually negligible and Route 53 is designed to handle it.

During your canary period, keep the TTL low. Once you've completed your rollout and are confident in the new version, you can increase the TTL back to a more conservative value to reduce DNS query overhead.

One subtlety: clients that make a DNS query and cache the result won't necessarily connect to a different backend immediately when you change weights. They'll keep using the cached IP address until that cache expires. This is why the TTL matters—it controls how quickly your weight changes actually affect traffic distribution. In practice, with a 60-second TTL and typical client behavior, you'll see the shift in traffic within a few minutes.

### Implementing a Gradual Rollout

Let's walk through a realistic canary rollout scenario. You're deploying a new version of your API and want to follow this schedule:

1. Start with 5% traffic to the new version (5/95 split)
2. Monitor for 10 minutes
3. Increase to 25% traffic to the new version (25/75 split)
4. Monitor for 10 minutes
5. Shift to 50/50
6. Monitor for 10 minutes
7. Shift to 100% on new version

To implement this, you simply update the weights in Route 53. Using the AWS CLI, you'd do something like:

```bash
aws route53 change-resource-record-sets \
  --hosted-zone-id Z1234567890ABC \
  --change-batch '{
    "Changes": [
      {
        "Action": "UPSERT",
        "ResourceRecordSet": {
          "Name": "api.example.com",
          "Type": "A",
          "SetId": "old-version",
          "Weight": 95,
          "TTL": 60,
          "ResourceRecords": [{"Value": "10.0.1.100"}]
        }
      },
      {
        "Action": "UPSERT",
        "ResourceRecordSet": {
          "Name": "api.example.com",
          "Type": "A",
          "SetId": "new-version",
          "Weight": 5,
          "TTL": 60,
          "ResourceRecords": [{"Value": "10.0.2.100"}]
        }
      }
    ]
  }'
```

This command updates both records in a single batch operation. The key point is that you're changing the Weight fields. When this change is applied, Route 53 immediately begins distributing traffic according to the new weights.

### Monitoring During Your Canary Period

Changing weights is only half the battle. You need to monitor both endpoints to detect problems early. CloudWatch is your friend here. Set up dashboards that show:

**Error rates and status codes**: Compare 4xx and 5xx rates between old and new versions. A sudden spike in errors on the new version is a clear signal to roll back.

**Latency and performance**: Monitor p50, p95, and p99 latencies. If the new version is significantly slower, your users will notice.

**Business metrics**: Depending on your application, monitor conversion rates, checkout completion times, or other metrics that directly impact your users.

**Resource utilization**: Check CPU, memory, and disk usage on both endpoints. A memory leak in the new version might not cause immediate errors but will degrade performance over time.

You can create custom CloudWatch alarms that trigger if error rates exceed a threshold. Some teams integrate these alarms with their deployment automation to trigger automatic rollbacks.

Here's a practical approach: set up a CloudWatch dashboard that displays key metrics for both the old and new versions side by side. Before advancing to the next weight step, visually inspect the dashboard for red flags. This human-in-the-loop approach is slower than fully automated rollouts but provides an extra safety net against deploying broken code.

### Rollback Strategies

One of the biggest advantages of Route 53 weighted routing for canary deployments is that rollback is instantaneous. If something goes wrong during your canary period, you don't need to wait for application servers to restart or load balancers to drain connections. You simply change the weights back:

```bash
aws route53 change-resource-record-sets \
  --hosted-zone-id Z1234567890ABC \
  --change-batch '{
    "Changes": [
      {
        "Action": "UPSERT",
        "ResourceRecordSet": {
          "Name": "api.example.com",
          "Type": "A",
          "SetId": "old-version",
          "Weight": 100,
          "TTL": 60,
          "ResourceRecords": [{"Value": "10.0.1.100"}]
        }
      },
      {
        "Action": "UPSERT",
        "ResourceRecordSet": {
          "Name": "api.example.com",
          "Type": "A",
          "SetId": "new-version",
          "Weight": 0,
          "TTL": 60,
          "ResourceRecords": [{"Value": "10.0.2.100"}]
        }
      }
    ]
  }'
```

After a few seconds (less than your TTL), DNS caches will refresh and traffic will flow back to the old version. New clients will immediately connect to the old endpoint, and even existing clients will eventually reconnect to it as DNS caches expire.

Note that setting a weight to 0 doesn't delete the record—it just means Route 53 won't return it during DNS resolution. You can keep it around for a bit longer before deleting it, giving you a window to re-enable it if needed.

### Comparing Route 53 Weighted Routing with Other Approaches

Route 53 weighted routing isn't the only way to implement canary deployments on AWS. Understanding how it compares to alternatives helps you choose the right tool for your situation.

**Application Load Balancer (ALB) with weighted target groups**: An ALB sits in front of your application servers and can distribute traffic among target groups with configurable weights. This approach is more fine-grained than Route 53 because it operates at the application layer. The ALB sees actual connections and can make routing decisions based on application-level information. It's excellent if you have multiple versions running in the same environment (same region, same VPC) because there's no DNS caching layer to worry about. The downside is added complexity—you need to manage the ALB, its health checks, and target group configurations. ALB is typically better for shifting traffic between different ports or paths on the same host, while Route 53 is better for shifting between entirely different endpoints.

**CodeDeploy with traffic control**: AWS CodeDeploy is a deployment service that can automatically shift traffic between old and new application versions according to a configured strategy (Canary, Linear, or All-at-once). CodeDeploy can work with various backends and handles the mechanics of traffic shifting for you. If you're already using CodeDeploy, this is often your best choice because it integrates with your deployment pipeline and handles rollbacks as part of the deployment process. The tradeoff is that CodeDeploy adds operational overhead—you need to set up CodeDeploy agents on your servers and integrate it with your deployment workflow.

**Route 53 geolocation or latency-based routing**: While not weighted routing, Route 53 also offers geolocation routing (route based on user location) and latency-based routing (route to the endpoint with lowest latency). These are useful for other scenarios but don't give you the fine-grained traffic control that weighted routing provides.

For a canary deployment where you're shifting traffic between two independent endpoints that might be in different regions or entirely different infrastructure, Route 53 weighted routing is often the simplest and most elegant choice. It requires minimal operational overhead, works across any type of endpoint, and provides instant rollback capabilities.

### Practical Considerations and Best Practices

When implementing canary deployments with Route 53 weighted routing, keep these practical points in mind.

**Plan your endpoints carefully**: Your old and new versions need to be accessible via separate DNS names or IP addresses. If you're running them in EC2, you might have separate load balancers or even separate VPCs. If you're using containers or Fargate, you might have separate service endpoints. The key is that both versions need to be live and accessible simultaneously during your canary period.

**Use consistent identifiers**: Set IDs should be descriptive and consistent across deployments. Use names like "old-version" and "new-version" or "stable" and "canary". This makes your Route 53 record sets easier to understand and manage.

**Consider DNS propagation delays**: While your Route 53 weights change immediately, DNS propagation takes time. Different parts of the internet will start using the new weights at different times. This is why the TTL matters—it controls how quickly the change propagates. Don't be alarmed if you don't see an immediate 50/50 split when you change weights to 50. Give it a couple of minutes for caches to refresh.

**Maintain health checks on endpoints**: While Route 53 weighted routing doesn't require health checks for this pattern to work, it's wise to have health checks on your endpoints so that if the old or new version becomes completely unavailable, Route 53 can stop routing traffic to it. You can combine weighted routing with health checks for extra safety.

**Automate your monitoring**: Manual monitoring during canary periods is error-prone. Set up CloudWatch alarms and dashboards before you start, and consider using AWS Lambda functions or other automation to detect problems and even trigger rollbacks automatically based on predefined thresholds.

**Plan your DNS records cleanup**: After your canary period is complete and you're confident in the new version, don't forget to remove the old version's DNS record and ideally decommission the old endpoint. Leaving dead records around creates confusion and potential security risks.

### A Complete Example Walkthrough

Let's tie everything together with a complete example. Imagine you have a REST API currently running at `api-old.example.com` (an ALB endpoint) and you've deployed a new version at `api-new.example.com`. You want to perform a canary deployment.

**Step 1: Initial setup** — Create a Route 53 hosted zone for `example.com` if you haven't already. Then create the weighted records:

```
Record 1:
  Name: api.example.com
  Type: CNAME (since both endpoints are ALB addresses)
  SetId: old-version
  Weight: 100
  TTL: 60
  Value: api-old.example.com

Record 2:
  Name: api.example.com
  Type: CNAME
  SetId: new-version
  Weight: 0
  TTL: 60
  Value: api-new.example.com
```

With the new version at weight 0, all traffic still flows to the old version, but the DNS record exists and is ready to receive traffic.

**Step 2: Begin the canary** — Update weights to 90/10:

```bash
# Update old-version weight to 90
aws route53 change-resource-record-sets --hosted-zone-id Z1234567890ABC \
  --change-batch '{...weight: 90...}'

# Update new-version weight to 10
aws route53 change-resource-record-sets --hosted-zone-id Z1234567890ABC \
  --change-batch '{...weight: 10...}'
```

**Step 3: Monitor** — Open your CloudWatch dashboard. Watch error rates, latency, and business metrics on both endpoints for 10-15 minutes. Check your application logs and traces for any anomalies.

**Step 4: Progress** — If all metrics look good, shift to 50/50. Monitor for another 10-15 minutes.

**Step 5: Complete** — Shift to 100/0. The new version now receives all traffic.

**Step 6: Cleanup** — After a waiting period (say, 24 hours), delete the old-version DNS record. You can also decommission the old infrastructure.

If at any point during steps 3-5 you notice errors or problems, simply shift back to 100/0 on the old version. The change is instant at the DNS layer.

### Common Pitfalls and How to Avoid Them

**Not adjusting TTL low enough**: Keep TTL at 60 seconds during canary periods. Anything higher and your weight changes won't propagate quickly.

**Forgetting about DNS caching in application code**: Some applications cache DNS responses internally. If your app caches DNS for 10 minutes, Route 53 weight changes won't affect it. Check your application's DNS client configuration.

**Monitoring only aggregate metrics**: If your old endpoint serves 90% of traffic and your new endpoint serves 10%, an aggregate error rate of 5% might be hiding a 50% error rate on the new endpoint. Always compare metrics per-endpoint, not in aggregate.

**Rushing through canary steps**: The whole point of a canary deployment is to catch problems early. Give each step time to stabilize before moving forward. A 15-minute wait at each step is reasonable for most applications.

**Not having a clear rollback plan**: Before you start, decide who will make rollback decisions and what metrics trigger a rollback. Don't figure this out in the middle of a deployment.

### Combining Route 53 Weighted Routing with Health Checks

For added reliability, you can configure Route 53 health checks on your endpoints. A health check periodically queries an endpoint (typically an HTTP endpoint that returns 200 OK for healthy and non-200 for unhealthy) and reports the status to Route 53.

You can then configure your weighted records to use these health checks. If a health check fails, Route 53 will stop returning that record in DNS responses, effectively removing it from rotation. This provides automatic failover if your endpoint becomes completely unavailable.

```
Record:
  Name: api.example.com
  Type: CNAME
  SetId: new-version
  Weight: 50
  TTL: 60
  Value: api-new.example.com
  HealthCheckId: abcd1234  # Route 53 health check ID
```

With health checks enabled, if your new version endpoint becomes unavailable, Route 53 will automatically route all traffic to the old version. This is a safety net against cascading failures.

### Transitioning from Route 53 Weighted Routing to Production

Once your canary deployment is complete and you're confident in the new version, you have a few options.

The simplest is to remove the old version record entirely. Now your DNS record is back to having a single weighted record, which means 100% of traffic goes to the new version. You can then decommission the old infrastructure.

Alternatively, if you want to keep the old version running as a fallback or for other purposes, you can keep both records but adjust the weights to reflect your new reality. For example, keep the old version at weight 1 and new version at weight 99, so that 1% of traffic still goes to the old version. This can be useful for gradual resource deallocation or if you want to keep the old version running for a while as a safety net.

### Monitoring and Observability Beyond CloudWatch

While CloudWatch is essential, consider complementing it with other AWS services for better visibility during canary deployments.

**X-Ray**: AWS X-Ray provides distributed tracing across your application. During a canary period, X-Ray can help you understand request flows and identify latency hotspots or failures that might not be obvious in aggregate metrics.

**CloudWatch Logs**: Aggregate logs from both old and new version endpoints in CloudWatch Logs. Use Logs Insights to query logs from both endpoints simultaneously, looking for error patterns or differences in behavior.

**Application Performance Monitoring (APM)**: If you're using an APM tool like AWS X-Ray, Datadog, New Relic, or another vendor, integrate it with your canary deployment. Many APM tools can detect anomalies automatically and alert you to problems before they become serious.

### Scaling Considerations

One subtle but important consideration: when you shift traffic to a new version during a canary deployment, you're distributing load across two endpoints. If you're shifting from a highly optimized old version to a new version that hasn't been tuned yet, the new version might struggle even at 10% traffic if your endpoint sizing assumptions are off.

Before starting a canary deployment, ensure your new endpoint is sized appropriately for the traffic level you're shifting to it. If you're starting with 10% traffic, your new endpoint should be able to handle 10% of your total traffic load without falling over. If you're uncertain, start with an even lower percentage like 2-5%.

### Conclusion

Route 53 weighted routing offers an elegant, DNS-driven approach to canary and blue/green deployments that deserves a place in your deployment toolkit. Its simplicity—no application changes, no load balancer reconfigurations, just DNS weight adjustments—makes it particularly attractive for teams deploying across different infrastructure or regions.

The key to success is understanding how DNS caching affects traffic distribution (keep your TTL low), having a solid monitoring strategy in place before you start, and respecting the gradual nature of the canary pattern. By following the practices outlined here—starting with small traffic percentages, monitoring carefully at each step, and maintaining a clear rollback strategy—you can deploy new versions with confidence.

Whether you choose Route 53 weighted routing, ALB weighted target groups, CodeDeploy traffic shifting, or another approach depends on your specific infrastructure and requirements. But if you need a straightforward, low-overhead way to shift traffic between independent endpoints, Route 53 weighted routing is hard to beat. Master it, and you'll have a powerful tool for safe, zero-downtime deployments.
