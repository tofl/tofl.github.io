---
title: "Designing Partition Keys in Kinesis Data Streams: Avoiding Hot Shards"
---

## Designing Partition Keys in Kinesis Data Streams: Avoiding Hot Shards

When you first start working with Amazon Kinesis Data Streams, the partition key seems straightforward: you pick a value that identifies your data, send it along with your record, and Kinesis handles the rest. But that simplicity hides a critical design decision that can make or break your streaming application. Choose the wrong partition key, and you'll find yourself hitting throughput limits on some shards while others sit idle—a phenomenon known as a "hot shard." In this article, we'll explore how partition keys work in Kinesis, why hot shards emerge, and the practical techniques to prevent them.

### Understanding Partition Keys and Shard Distribution

Every record you put into a Kinesis stream must include a partition key—a string that Kinesis uses to determine which shard receives that record. Think of the partition key as an address label on a package. Kinesis needs to know which delivery route (shard) that package should travel on.

Internally, Kinesis applies an MD5 hash function to your partition key. This hash produces a 128-bit value that falls somewhere within a range from 0 to 2^128 minus 1. Each shard in your stream owns a contiguous segment of this hash range. When Kinesis hashes your partition key, it maps the resulting value to the owning shard and routes your record there. This deterministic mapping means that all records with the same partition key always go to the same shard—which is essential when you need to preserve ordering within a logical stream of data.

For example, imagine you're building a real-time order processing system. If you use the customer ID as your partition key, all orders from that customer will always arrive at the same shard in the exact sequence they were sent. This ordering guarantee is powerful and sometimes essential. However, that same guarantee becomes a liability if your partition key cardinality is low or unevenly distributed.

### The Hot Shard Problem: Why It Happens

A hot shard occurs when the load—the number of records or total bytes flowing through your stream—concentrates on one or a small number of shards while others remain underutilized. This happens when your partition key design creates an imbalance in how records map to shards.

The classic scenario is low cardinality. Imagine you're collecting telemetry from a multi-tenant application with fifty thousand customers, but at any given moment, only three major enterprise customers generate 80% of the traffic. If you use the customer ID as your partition key, those three customers will hash to their respective shards, and those shards will bear almost all the load. Your stream might have ten shards total, but effectively you're only using three of them. Each of those three shards hits its provisioned throughput limit much faster than the others, and you'll see the CloudWatch metric `WriteProvisionedThroughputExceeded` firing on those specific shards.

Another scenario involves using a low-cardinality field like a boolean flag, a status code, or a small enum as your partition key. If you're using `true` or `false` as a partition key, all records with `true` go to one shard and all records with `false` go to another. If your data isn't perfectly balanced between these states, one shard becomes a hot shard.

A third variation happens with time-based partition keys. Some developers use timestamps or date strings as partition keys, thinking this will spread the load over time. But if you're using a coarse timestamp (for instance, just the hour), all records within an hour hash to the same shard, creating a temporary hot shard during high-traffic periods. Only when the clock ticks to a new hour does the load shift to a new shard.

### How Partition Keys Map to Shards

To design better partition keys, you need to understand the mapping mechanism more deeply. When you create a Kinesis stream, AWS allocates hash key ranges to each shard. For a stream with four shards, the 128-bit hash space is divided into four roughly equal segments. Shard 0 might own hashes from 0 to 2^128/4, Shard 1 from 2^128/4 to 2^128/2, and so on.

When Kinesis hashes your partition key using MD5, it produces a value that falls into one of these ranges. The shard owning that range receives the record. The critical insight is that this mapping is deterministic and based on statistical distribution. MD5 is designed to produce output that appears random and uniformly distributed across its output space. In theory, if your partition keys are random and independent, the load should distribute evenly across shards.

In practice, however, partition keys often aren't random. They reflect real-world distributions. User IDs might follow a Zipfian distribution (a few power users generate disproportionate traffic). Geographic regions might be skewed. Timestamps are not uniformly distributed if traffic has patterns. All of these factors can create hot shards despite the MD5 hashing algorithm doing exactly what it's supposed to do.

### Detecting Hot Shards with CloudWatch Metrics

Before you can fix a hot shard problem, you need to detect it. AWS CloudWatch provides several metrics at the shard level that reveal uneven load distribution.

The most direct metrics are `IncomingRecords` and `IncomingBytes`, both measured per shard. These metrics show you the volume of records and data flowing through each individual shard. If you pull these metrics for all your shards and graph them together, a healthy stream shows roughly parallel lines for all shards. A hot shard problem shows one or two shards spiking much higher than the others. CloudWatch allows you to visualize these metrics per shard (using the Shard ID dimension), making uneven distribution immediately obvious.

Another critical metric is `WriteProvisionedThroughputExceeded`. This counter increments every time a shard rejects a `PutRecord` or `PutRecords` request because it has exhausted its provisioned throughput. If you see this metric firing on some shards but not others, you have a hot shard. A healthy stream might never trigger this metric, or it might do so briefly during a legitimate traffic spike affecting all shards equally.

Additionally, examine `GetRecords.IteratorAgeMilliseconds` on the consumer side. If some shards have much higher iterator age than others, it suggests records are piling up on certain shards because the consumer can't keep up with the uneven arrival rate, which often points to a producer-side hot shard issue.

Setting up CloudWatch alarms on `WriteProvisionedThroughputExceeded` per shard is a good practice for production streams. These alarms should trigger when the metric exceeds zero on any shard, signaling that you need to investigate your partition key design or increase provisioned throughput.

### Technique 1: Random Suffixes for High-Cardinality Base Keys

One of the simplest ways to prevent hot shards when you don't strictly need per-key ordering is to add randomness to your partition key. If your primary identifier is a customer ID, instead of using just the customer ID as the partition key, append a random suffix.

Here's a practical example using Python and the boto3 SDK:

```python
import random
import json
import boto3

kinesis = boto3.client('kinesis')

def put_event_with_random_suffix(stream_name, event_data, customer_id):
    # Add a random suffix to spread the load
    random_suffix = str(random.randint(0, 99))
    partition_key = f"{customer_id}#{random_suffix}"
    
    response = kinesis.put_record(
        StreamName=stream_name,
        Data=json.dumps(event_data),
        PartitionKey=partition_key
    )
    
    return response
```

By appending a random number from 0 to 99, you're effectively multiplying the cardinality of your partition key by 100. If you had ten major customers with high traffic, instead of records from each customer concentrating on ten shards, they now spread across up to 1,000 logical groupings (ten customers × 100 suffixes). With enough shards in your stream, this distributes the load much more evenly.

The trade-off is that records from the same customer no longer arrive in order. If you retrieve events for a customer, they'll be scattered across multiple shards, and you'll need to sort them by timestamp after consuming them. For many use cases—analytics, aggregation, or real-time dashboards—this is perfectly acceptable. Order is only essential when you're doing sequential processing where each event depends on the previous one.

### Technique 2: Composite Partition Keys

Another approach is to use a composite partition key that combines multiple attributes. Instead of relying solely on a field with low cardinality, you blend it with other data.

Consider a scenario where you're processing user activity events and you want to maintain order per user. But your top 1% of users generates 50% of the traffic. A simple user ID partition key creates hot shards. Instead, you could composite the user ID with the activity type:

```python
def put_user_activity(stream_name, user_id, activity_type, event_data):
    partition_key = f"{user_id}#{activity_type}"
    
    response = kinesis.put_record(
        StreamName=stream_name,
        Data=json.dumps(event_data),
        PartitionKey=partition_key
    )
    
    return response
```

Now records for the same user still go to the same logical group, but different activity types for that user might hash to different shards. This preserves some ordering (per user per activity type) while spreading the load better. The effectiveness depends on the cardinality of your secondary attributes. If you have ten activity types and ten thousand users, you've increased your effective cardinality tenfold.

The key principle here is that you're trading granularity of ordering for better load distribution. You maintain ordering at a level that's still meaningful for your business logic, while reducing the risk of hot shards.

### Technique 3: Time-Based Bucketing

For use cases where you're processing large volumes of similar events and ordering isn't critical, time-based bucketing can help. Instead of using a static identifier, you incorporate a time component that changes at regular intervals.

For example, you might use a partition key that combines an entity ID with a time bucket:

```python
import time
import json

def put_event_with_time_bucket(stream_name, entity_id, event_data, bucket_seconds=60):
    # Create a time bucket (e.g., partition key changes every 60 seconds)
    time_bucket = int(time.time() / bucket_seconds) * bucket_seconds
    partition_key = f"{entity_id}#{time_bucket}"
    
    response = kinesis.put_record(
        StreamName=stream_name,
        Data=json.dumps(event_data),
        PartitionKey=partition_key
    )
    
    return response
```

With this approach, events from the same entity within the same time window hash to the same shard (preserving some locality), but every sixty seconds, the partition key changes, shifting traffic to potentially different shards. This is particularly useful for scenarios where you're aggregating metrics over time windows anyway. Your consumers can process events from a time window and don't need events from different time windows to arrive in strict order.

The bucket size is configurable. Smaller buckets (ten or thirty seconds) distribute load more evenly but reduce ordering guarantees further. Larger buckets (five or ten minutes) preserve more ordering but might still create temporary hot shards during uneven traffic within a bucket.

### The Ordering vs. Throughput Trade-off

Throughout these techniques, you'll notice a recurring theme: you're sacrificing some level of ordering guarantee to achieve better load distribution. This trade-off is fundamental and worth understanding deeply.

Kinesis provides a strong ordering guarantee at the shard level: all records with the same partition key arrive at the same shard and are processed in the exact order they were sent. This is phenomenally useful for scenarios like maintaining a ledger, processing a sequence of state changes, or enforcing business rules that depend on previous events.

However, if you don't actually need that degree of ordering, you're paying a hidden cost: hot shards. A streaming system under a hot shard constraint can't scale linearly. You hit the provisioned throughput limit of individual shards, not the aggregate capacity of your stream.

Here's the critical question to ask yourself: what level of ordering does your application actually require?

Do you need global ordering (all events across all entities in sequence)? Very few applications need this, and it's essentially impossible to achieve in a distributed stream without severe performance penalties.

Do you need per-entity ordering (all events for a given user or customer in sequence)? This is common and valuable. Many applications can achieve good load distribution while maintaining this level of ordering by using the entity ID as the partition key alone and accepting that some entities might be hot keys.

Do you need per-entity-per-activity ordering (all events for a user doing a specific thing in sequence)? This is still fairly fine-grained and often achievable with composite keys.

Do you need ordering at all? Many analytics and aggregation workloads can accept events out of order and achieve great performance by using random partition keys or other load-spreading techniques.

Honestly assessing your actual ordering requirements opens up design options. Too many developers default to strict per-entity ordering without questioning whether they need it, and they end up overconstraining their system unnecessarily.

### When Hot Shards Aren't a Design Problem

It's worth noting that not every instance of uneven load distribution is a problem. If your provisioned throughput is comfortable, and you're nowhere near the `WriteProvisionedThroughputExceeded` threshold on any shard, then perhaps your "hot shard" isn't actually limiting your throughput. The metric is uneven, but the system is working fine.

Conversely, if you scale up your stream to have enough shards such that even your hot keys are distributed adequately, you might not need to redesign your partition keys at all. If 80% of traffic comes from three customers but you have thirty shards, those three customers might hash to different shards most of the time, and the system works without special tricks.

The hot shard problem becomes acute when you have limited shards and high cardinality concentration. In that scenario, you must redesign. But if you have flexibility in shard count or if your traffic pattern is more balanced than expected, sometimes the simplest solution is just to provision more shards.

### Real-World Example: Multi-Tenant Event Processing

Let's walk through a concrete scenario to tie these concepts together. Imagine you're building an event processing platform for multiple SaaS customers. Each customer sends events from their application, and you need to process them in real time for aggregation, alerting, and analytics.

Your initial design uses the customer ID as the partition key. This preserves ordering per customer, which seems good—if a customer's events are processed in order, their aggregates are correct.

```python
def put_customer_event(stream_name, customer_id, event_data):
    partition_key = customer_id
    
    response = kinesis.put_record(
        StreamName=stream_name,
        Data=json.dumps(event_data),
        PartitionKey=partition_key
    )
    
    return response
```

You launch with a ten-shard stream and things work great initially. But as you grow, you onboard three major enterprise customers who generate enormous event volumes. Suddenly, you see `WriteProvisionedThroughputExceeded` firing on three shards while the other seven are mostly idle. You're constrained by those three customers' traffic despite having seven other shards.

Now you have options. You could increase to fifty shards, but that's expensive and you're over-provisioning for the other customers. Instead, you redesign the partition key. Since customer events are primarily consumed by that specific customer's analytics pipeline, you don't actually need global ordering across all customers—you just need per-customer ordering.

You update your code to use a composite key:

```python
def put_customer_event_with_load_balancing(stream_name, customer_id, event_type, event_data):
    partition_key = f"{customer_id}#{event_type}"
    
    response = kinesis.put_record(
        StreamName=stream_name,
        Data=json.dumps(event_data),
        PartitionKey=partition_key
    )
    
    return response
```

If your major customers have diverse event types (page views, clicks, purchases, errors, etc.), the load from each customer now spreads across multiple shards. Your consumer logic becomes slightly more complex—you need to gather events for a customer from multiple shards and sort them by timestamp—but your throughput issues evaporate.

On the consumer side, you're probably using a Kinesis consumer library or a managed service like Lambda. You'd need to ensure that your aggregation logic handles out-of-order events correctly, likely by buffering events for a time window and sorting them before processing.

This real-world adjustment demonstrates the principle: you didn't abandon ordering entirely, you just adjusted the granularity from global to per-customer-per-event-type, and that was enough to eliminate the hot shard bottleneck.

### Monitoring and Alerting Best Practices

Detecting hot shards proactively is part of building reliable streaming systems. Beyond the basic CloudWatch metrics, consider these practices:

Create a custom metric or dashboard that shows the coefficient of variation (standard deviation divided by mean) of `IncomingRecords` across all shards. A coefficient of variation close to zero means all shards are handling similar loads. As it increases, it indicates more imbalance. Setting an alarm when this metric exceeds a threshold can alert you before you hit throughput limits.

Track `IteratorAgeMilliseconds` per shard on your consumers. If one shard's iterator age is consistently much higher than others, records are piling up there, which often correlates with a producer-side hot shard or a consumer-side processing bottleneck on that shard.

Periodically review your partition key choices as your traffic patterns evolve. A partition key that was well-distributed when you launched might become problematic as your customer base grows. Regularly analyzing which partition keys contribute most to your traffic volume helps you identify potential hot shards before they become critical.

### Moving Forward

Hot shards are a constraint imposed by the need to provide ordering guarantees. They're not a bug in Kinesis; they're a natural consequence of deterministic partition key hashing. The solution lies in carefully choosing your partition key strategy based on your actual ordering requirements and your traffic patterns.

Start by assessing what level of ordering your application truly needs. Then choose a partition key strategy that provides that ordering while distributing load as evenly as possible. Use CloudWatch metrics to verify that your distribution is balanced. And be prepared to adjust as your traffic patterns evolve.

The techniques covered here—random suffixes, composite keys, and time-based bucketing—are your toolkit for preventing hot shards. None is universally superior; each is suited to different scenarios. The best choice depends on your specific ordering requirements, cardinality distribution, and traffic patterns. By understanding these tradeoffs and actively monitoring your stream, you can build Kinesis-based systems that scale smoothly and perform reliably under load.
