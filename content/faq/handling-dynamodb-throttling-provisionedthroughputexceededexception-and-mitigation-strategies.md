---
title: "Handling DynamoDB Throttling: ProvisionedThroughputExceededException and Mitigation Strategies"
---

## Handling DynamoDB Throttling: ProvisionedThroughputExceededException and Mitigation Strategies

DynamoDB throttling is one of those topics that feels abstract until you encounter it in production. Your application is humming along smoothly, and then suddenly requests start failing with cryptic error messages. Understanding what's happening—and more importantly, how to prevent and recover from it—is essential knowledge for any developer building on AWS.

In this article, we'll explore the mechanics of DynamoDB throttling, understand the exceptions you might encounter, dive into the root causes like hot partitions, and walk through practical mitigation strategies that actually work. By the end, you'll know not just how to handle these errors when they occur, but how to architect your solutions to avoid them in the first place.

### Understanding DynamoDB Throttling Basics

DynamoDB operates on a capacity model. When you create a table, you either provision a specific amount of read and write capacity (provisioned mode) or let AWS manage capacity automatically (on-demand mode). This capacity is measured in capacity units: read capacity units (RCUs) for reads and write capacity units (WCUs) for writes.

Think of capacity units like a water pipe. You've paid for a certain diameter of pipe, and water flows through at a certain rate. If someone opens the faucet too much, the flow exceeds what the pipe can handle, and pressure builds up. In DynamoDB's case, when you exceed your provisioned capacity, requests get throttled—they're rejected or delayed to prevent the service from becoming overloaded.

Throttling is AWS's way of enforcing fair-use policies and protecting the shared infrastructure. It's also your signal that your application's demand has exceeded your current capacity allocation. The key to managing throttling effectively is understanding both when it happens and why.

### ProvisionedThroughputExceededException vs. RequestLimitExceeded

Two exceptions commonly appear when DynamoDB can't handle your requests, and it's important to distinguish between them because they point to different underlying issues.

**ProvisionedThroughputExceededException** occurs when your application exhausts the read or write capacity you've explicitly provisioned for your table. You're making more requests than your allocated capacity can handle. This is the most common throttling scenario in provisioned-mode tables. When this exception is thrown, the request is rejected, and your application must handle the retry logic.

**RequestLimitExceeded**, by contrast, is a service-level throttling mechanism that AWS applies regardless of your provisioned capacity. Even if you have plenty of capacity remaining, AWS may throttle your requests if you exceed certain rate limits at the account or region level. These are harder limits that exist to protect the global DynamoDB infrastructure. In practice, most developers encounter ProvisionedThroughputExceededException far more frequently than RequestLimitExceeded.

It's worth noting that on-demand mode tables have their own throttling behavior. While they automatically scale capacity, they still enforce per-partition throughput limits. Hitting those limits triggers the same exception type, but for different reasons than provisioned-mode exhaustion.

### The Root Cause: Hot Partitions

Here's where things get interesting. Many developers encounter throttling even though their CloudWatch metrics show they're well within their provisioned capacity. The culprit is usually a hot partition.

DynamoDB distributes your table's data across multiple partitions behind the scenes. Each partition can support a maximum of 3,000 RCUs and 1,000 WCUs. If your access pattern concentrates too much traffic on a single partition, that partition gets throttled even though other partitions are underutilized. From your application's perspective, you're being throttled despite having plenty of table-level capacity.

Consider a real-world example: you're building a leaderboard for an online game. You might use the game name as the partition key and the player ID as the sort key. Now imagine your most popular game gets thousands of requests per second while lesser games get dozens. All traffic for the popular game hits the same partition, overwhelming it, while partitions for less popular games sit idle. You've created a hot partition.

Another common scenario involves time-based data. If your partition key includes a timestamp or date, all new writes cluster together, hitting the same partition. As time progresses, the hot spot moves, but at any given moment, you're concentrating write traffic.

The key insight is that provisioned capacity at the table level is divided evenly across partitions. If you provision 10,000 WCUs for a table and DynamoDB distributes it across 10 partitions, each partition gets roughly 1,000 WCUs. If your access pattern routes 5,000 WCUs worth of traffic to a single partition, that partition is throttled regardless of how much capacity remains in other partitions.

### Monitoring Throttling with CloudWatch

You can't fix what you can't see. CloudWatch metrics are your window into DynamoDB's behavior, and certain metrics are specifically designed to reveal throttling.

**ConsumedReadCapacityUnits** and **ConsumedWriteCapacityUnits** show you how much capacity your table actually consumed over a time period. By comparing these metrics to your provisioned capacity, you can see if you're approaching limits. CloudWatch breaks these down per minute, so spikes become visible.

**ThrottledRequests** (or more specifically, **UserErrors** and **SystemErrors** combined with throttle-related exceptions) directly indicates when your requests are being rejected. When you see this metric spike, it's a clear signal that capacity is being exceeded.

**ReadThrottleEvents** and **WriteThrottleEvents** provide separate tracking for each direction. These increment when a request is throttled due to capacity limits, not when an individual request is throttled (one event might represent multiple throttled requests).

You should also monitor **SuccessfulRequestLatency** alongside these metrics. Often, as you approach throttling limits, latency increases dramatically even before throttling becomes severe. This is your early warning sign.

Here's a practical approach: set up CloudWatch alarms on ConsumedReadCapacityUnits and ConsumedWriteCapacityUnits at 80% of your provisioned capacity. This gives you a buffer to react before throttling begins. Additionally, create alarms on ThrottledRequests with a threshold greater than zero—any throttling is worth investigating.

```
aws cloudwatch get-metric-statistics \
  --namespace AWS/DynamoDB \
  --metric-name ConsumedWriteCapacityUnits \
  --dimensions Name=TableName,Value=MyTable \
  --start-time 2024-01-15T00:00:00Z \
  --end-time 2024-01-15T01:00:00Z \
  --period 300 \
  --statistics Average,Maximum
```

This CLI command retrieves write capacity consumption over an hour in five-minute intervals, showing both average and peak usage. Looking at the maximum values helps you understand your actual demand spikes, which are often much higher than averages.

### Mitigation Strategy 1: Switching to On-Demand Mode

The simplest way to eliminate throttling from provisioned capacity limits is to stop provisioning capacity entirely. On-demand mode automatically scales your capacity up and down based on actual traffic, up to per-partition limits.

There are no capacity units to manage, no forecasting required, and throttling due to insufficient capacity essentially disappears. You pay for every read and write you perform, charged per request rather than per unit, which can be more expensive for consistent, predictable workloads but is ideal for unpredictable or bursty traffic.

The trade-off is cost. On-demand pricing is roughly 1.5-2x more expensive per request compared to provisioned capacity, assuming you'd normally utilize your provisioned capacity well. However, the operational simplicity and elimination of scaling decisions can be worth it, especially during rapid prototyping or for workloads with highly variable demand.

Switching to on-demand mode is straightforward. You can change a table's billing mode in the AWS Console or via the CLI without downtime:

```
aws dynamodb update-billing-mode \
  --table-name MyTable \
  --billing-mode PAY_PER_REQUEST
```

One important caveat: even on-demand tables respect per-partition limits. Each partition can still only handle 3,000 RCUs and 1,000 WCUs. If you have a severe hot partition issue, on-demand mode doesn't solve the underlying problem—you'll still see throttling. You'd need to redesign your access pattern to distribute traffic more evenly.

### Mitigation Strategy 2: Auto Scaling

Auto scaling keeps you in provisioned mode but automates capacity adjustments based on demand. You specify a minimum and maximum capacity, and AWS automatically scales between those bounds based on actual consumption.

The AWS Application Auto Scaling service monitors your ConsumedReadCapacityUnits and ConsumedWriteCapacityUnits metrics. When consumption crosses a target utilization threshold (70% by default), auto scaling kicks in. If consumption exceeds the target, it increases capacity; if consumption drops below a lower threshold, it decreases capacity.

Auto scaling shines for predictable but growing workloads. As your application gains users, capacity grows automatically. You're not throttled due to running out of capacity, and you're also not over-provisioned paying for unused capacity.

The implementation involves creating a scaling policy for your table:

```
aws application-autoscaling register-scalable-target \
  --service-namespace dynamodb \
  --resource-id table/MyTable \
  --scalable-dimension dynamodb:table:WriteCapacityUnits \
  --min-capacity 100 \
  --max-capacity 5000

aws application-autoscaling put-scaling-policy \
  --policy-name MyTableScaling \
  --service-namespace dynamodb \
  --resource-id table/MyTable \
  --scalable-dimension dynamodb:table:WriteCapacityUnits \
  --policy-type TargetTrackingScaling \
  --target-tracking-scaling-policy-configuration \
  TargetValue=70,PredefinedMetricSpecification={PredefinedMetricType=DynamoDBWriteCapacityUtilization}
```

The limitation of auto scaling is its reaction time. There's a delay between when consumption increases and when scaling occurs—typically several minutes. During sudden traffic spikes, you can still experience throttling before auto scaling adds capacity. This makes it less suitable for truly bursty or unpredictable workloads.

### Mitigation Strategy 3: Adaptive Capacity

Introduced by AWS to address the hot partition problem, adaptive capacity is a feature of DynamoDB that automatically increases capacity to hot partitions when it detects an uneven distribution of traffic.

If you have 10 partitions and one is consistently receiving more traffic than others, adaptive capacity detects this imbalance and temporarily boosts that partition's capacity, borrowing from underutilized partitions. This is done automatically and transparently—you don't configure anything.

However, adaptive capacity has limitations. It can temporarily accommodate uneven traffic patterns, but it's not a permanent solution for fundamentally poor partition designs. If your partition key naturally creates hot partitions (like using a timestamp as your partition key), adaptive capacity will help but won't eliminate throttling entirely. It buys you time and smooths out temporary spikes, but you should still aim to fix the underlying access pattern.

Adaptive capacity is enabled by default on all tables and requires no configuration. You can see it in action by monitoring the **ConsumedReadCapacityUnits** and **ConsumedWriteCapacityUnits** per partition in CloudWatch—you'll notice some partitions getting more capacity than others during uneven traffic.

### Mitigation Strategy 4: Exponential Backoff and Retry Logic

Even with all the above strategies, you might still encounter occasional throttling. The AWS SDK handles this automatically, but understanding the mechanism is valuable.

When the SDK receives a ProvisionedThroughputExceededException, it doesn't immediately return an error to your application. Instead, it automatically retries the request with exponential backoff. This means it waits a short time before retrying, and if that fails, it waits longer, then longer still, up to a maximum number of retries.

The backoff time grows exponentially: 50ms, 100ms, 200ms, 400ms, and so on, with random jitter added to prevent thundering herd problems (where many clients retry simultaneously, creating another spike). The default maximum retry count is typically 3 retries, giving the request about 10 seconds total to succeed before ultimately failing.

This automatic behavior is usually sufficient for transient throttling caused by temporary load spikes. Your application doesn't need to do anything—the SDK handles it transparently. However, it's important to understand that this retry logic does add latency. If you're being throttled even once, your p99 latencies will increase noticeably.

You can configure retry behavior in your SDK. In Python's boto3, for example:

```python
from botocore.config import Config

config = Config(
    retries = {
        'max_attempts': 5,
        'mode': 'adaptive'
    }
)

dynamodb = boto3.client('dynamodb', config=config)
```

The `adaptive` mode is particularly useful as it uses intelligent backoff strategies based on DynamoDB's response headers, which can be more efficient than standard exponential backoff.

If you want to implement custom retry logic (perhaps with different backoff strategies or additional business logic), you'd wrap DynamoDB calls in a retry handler. Generally though, the SDK's built-in behavior is well-tuned and recommended.

### Mitigation Strategy 5: Write Sharding for Hot Partitions

When you identify a structural hot partition issue that can't be solved by changing your partition key, write sharding is a clever technique that distributes writes across multiple logical items.

The basic idea is simple: instead of writing to a single item repeatedly, you write to multiple items and distribute the load among them. For example, if you're maintaining a counter of game players, instead of incrementing a single item (which becomes a hot partition), you maintain 10 counter items with random suffixes and increment one of them randomly.

Here's a concrete example. Without sharding:

```python
# This single item receives all writes, creating a hot partition
response = dynamodb.update_item(
    TableName='GameStats',
    Key={'GameId': {'S': 'game-123'}},
    UpdateExpression='ADD PlayerCount :inc',
    ExpressionAttributeValues={':inc': {'N': '1'}}
)
```

With write sharding:

```python
import random

# Distribute writes across 10 logical items
shard_id = random.randint(0, 9)

response = dynamodb.update_item(
    TableName='GameStats',
    Key={
        'GameId': {'S': 'game-123'},
        'ShardId': {'N': str(shard_id)}
    },
    UpdateExpression='ADD PlayerCount :inc',
    ExpressionAttributeValues={':inc': {'N': '1'}}
)
```

Now, instead of all writes hitting a single partition key value, they're distributed across 10 different items. Traffic is spread across 10 partitions (or at least, traffic for a single game is spread across 10 items within partitions).

Reading the aggregated value requires summing across all shards:

```python
# Read all shards and sum the results
total = 0
for shard_id in range(10):
    response = dynamodb.get_item(
        TableName='GameStats',
        Key={
            'GameId': {'S': 'game-123'},
            'ShardId': {'N': str(shard_id)}
        }
    )
    if 'Item' in response:
        total += int(response['Item']['PlayerCount']['N'])
```

This technique works well for write-heavy scenarios where you need high throughput to a small set of items. The trade-off is increased complexity and higher read costs when you need to aggregate values. It's not a silver bullet—you should consider it only when you've confirmed that a specific item or partition key value is a genuine bottleneck.

### Combining Strategies: A Holistic Approach

The most robust production systems use multiple mitigation strategies together rather than relying on a single approach.

A reasonable approach for a new application might be: start with on-demand mode if your budget allows, eliminating capacity concerns entirely. As your application matures and you understand your access patterns, switch to provisioned mode with auto scaling, targeting 70% utilization on average. Set CloudWatch alarms on throttled requests and consumed capacity. Monitor for hot partitions and design your partition keys with distribution in mind.

For an existing application experiencing throttling, your first step should be investigating whether it's a capacity problem or a hot partition problem. Look at ConsumedCapacityUnits metrics and compare them to provisioned capacity. If you're at 90%+ of provisioned capacity, add more capacity or enable auto scaling. If you're well below capacity but still being throttled, you have a hot partition—either redesign your partition key or implement write sharding.

The SDK's automatic retry logic and adaptive capacity will handle some transient issues, but they're not sufficient for systematic throttling. They're the safety net, not the solution.

### Conclusion

DynamoDB throttling is manageable once you understand its causes and the toolkit available to address it. The foundation is monitoring—knowing when you're being throttled and why. From there, you have multiple levers to pull: switching to on-demand billing, enabling auto scaling, improving partition key design to avoid hot partitions, leveraging adaptive capacity, or implementing write sharding for specific scenarios.

The key principle is that throttling is a signal from the system telling you something needs adjustment. The AWS SDK gives you some breathing room with automatic retries, but you should treat throttling as a trigger for architectural changes, not as an acceptable steady state.

Start by understanding your access patterns and designing partition keys that distribute traffic evenly. Monitor your table's metrics proactively with CloudWatch alarms. Choose your billing and scaling strategy based on your workload characteristics. And when throttling does occur—and in large systems, it eventually will—you'll have the knowledge to diagnose the cause and implement the appropriate fix.
