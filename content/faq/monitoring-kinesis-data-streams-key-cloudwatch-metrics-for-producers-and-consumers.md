---
title: "Monitoring Kinesis Data Streams: Key CloudWatch Metrics for Producers and Consumers"
---

## Monitoring Kinesis Data Streams: Key CloudWatch Metrics for Producers and Consumers

Building real-time streaming applications is exciting—until something goes wrong and you're staring at a production incident with no visibility into what's happening. Kinesis Data Streams is a powerful service for ingesting and processing continuous data, but like any distributed system, it requires proper observability to operate reliably. The good news is that AWS CloudWatch provides deep metrics that tell you exactly what's happening inside your streams. Understanding these metrics—and knowing which ones matter most—is essential for anyone operating Kinesis in production.

In this article, we'll explore the CloudWatch metrics that give you real visibility into your Kinesis streams. We'll start with producer metrics that show you whether data is flowing in successfully, move to consumer metrics that reveal how fast you're processing that data, and then dive into the operational scenarios you'll encounter in the real world: detecting bottlenecks, scaling decisions, and building robust alarms.

### Understanding the Kinesis Metrics Landscape

Kinesis streams generate CloudWatch metrics across three levels: stream-level metrics, shard-level metrics, and consumer application metrics. Stream-level metrics are the default—you get them automatically and at no additional cost. Shard-level metrics require explicit enablement and carry a small additional charge, but they're invaluable when you need to debug performance issues or detect hot shards that are struggling under load.

The metrics fall naturally into two categories: those that help you understand what's entering your stream (producer metrics) and those that tell you how fast it's being consumed (consumer metrics). Neither group tells the complete story alone, but together they paint a clear picture of your streaming pipeline's health.

### Producer-Side Metrics: What's Coming In

From the producer's perspective, three metrics matter most: whether records are arriving successfully, how much data those records contain, and whether you're hitting throughput limits.

**IncomingRecords** counts the number of records successfully put into your stream during the measurement period (typically one minute by default). This is your most basic sanity check—if this metric is zero when you expect records, something upstream is broken. In a real scenario, imagine you have an application sending clickstream events to a Kinesis stream. If IncomingRecords suddenly drops to zero, you know either the event generation stopped or the producers are encountering errors.

**IncomingBytes** measures the total data volume flowing in, expressed in bytes. While IncomingRecords tells you how many things arrived, IncomingBytes tells you how large they are collectively. This matters because Kinesis pricing and throughput limits are tied to bytes, not record count. You could have thousands of tiny records or hundreds of massive records—the bytes metric shows the actual resource consumption. A producer sending large JSON documents with embedded media will have a very different IncomingBytes signature than one sending small event markers.

**WriteProvisionedThroughputExceeded** is the alarm bell for producers. This counter increments when a PutRecord or PutRecords call is throttled because you've exceeded your shard's provisioned write capacity. By default, each shard supports 1,000 records per second or 1 MB per second, whichever limit is hit first. When this metric is non-zero, your producers are getting rejected and failing. This is critical to detect because applications often don't handle throttling gracefully—they might drop data, retry in ways that compound the problem, or crash entirely.

**PutRecord.Success** is less commonly discussed but equally important: it's the count of successful write operations. While WriteProvisionedThroughputExceeded tells you about failures, PutRecord.Success confirms that writes are working. If you see IncomingRecords increasing but PutRecord.Success not matching, you're definitely experiencing throttling or other errors.

### Consumer-Side Metrics: How Fast Are You Processing?

Consumer metrics reveal the lag between when data arrives in the stream and when your application processes it. This is where the most critical observability happens.

**GetRecords.IteratorAgeMilliseconds** is perhaps the single most important consumer metric in Kinesis. This measures the age of the record at the head of a shard's iterator—in plain English, it tells you how far behind your consumer is. If this metric is 0, you're processing records almost instantly. If it's 300,000 milliseconds (five minutes), your consumer is processing data from five minutes ago, which means there's a five-minute lag in your pipeline. 

Consider a real-world scenario: you're processing financial transactions and need to flag fraudulent activity in near-real-time. A high IteratorAgeMilliseconds means fraudulent transactions sit undetected for that duration. Or imagine a monitoring system where anomalies need to be detected within seconds—a large iterator age means your alerts arrive too late to be useful.

The reason this metric matters so much is that it directly measures latency from the consumer's perspective. Your Kinesis stream itself isn't slow—it's just that your consumer can't keep up with the incoming rate. This metric immediately tells you whether you need to scale your consumer application or the stream itself.

**GetRecords.Success** counts successful read operations. Like its producer counterpart PutRecord.Success, this confirms that your consumer application is actually retrieving records from the stream. A zero value (or near-zero) suggests your consumer isn't even trying to read, which might indicate the application is crashed or not running.

**ReadProvisionedThroughputExceeded** is the consumer equivalent of WriteProvisionedThroughputExceeded. It counts GetRecords calls that were throttled due to exceeding read capacity. Each shard supports up to 5 read requests per second by default (though each request can return up to 10 MB of data or 10,000 records, so the effective throughput is usually limited by data volume rather than request count). When this metric is elevated, your consumer is being throttled by the stream.

### Enhanced Shard-Level Metrics: Seeing Beyond the Average

Stream-level metrics give you an overview, but they're averages across all shards. If you have 10 shards and one of them is struggling while the others are fine, stream-level metrics might show everything looks okay—you've just averaged out the problem.

Shard-level metrics break down metrics by individual shard. You enable them in the Kinesis console or via the AWS CLI with a command like:

```bash
aws kinesis enable-stream-encryption \
  --stream-name my-stream \
  --region us-east-1
```

Actually, that command enables encryption. To enable enhanced monitoring, you'd use:

```bash
aws kinesis enable-enhanced-monitoring \
  --stream-name my-stream \
  --shard-level-metrics ALL \
  --region us-east-1
```

The ALL parameter enables all available shard-level metrics. You can also select specific metrics to reduce cost. Once enabled, every metric available at the stream level is now available broken down by shard.

The cost is modest—typically a few dollars per month per stream—but the operational value is immense. Suddenly you can ask questions like "which shard is getting all the traffic?" or "is the throttling happening uniformly or concentrated in one shard?"

### Detecting and Debugging Hot Shards

A "hot shard" is one that receives disproportionate traffic, exhausting its throughput quota while other shards remain underutilized. Hot shards are a common problem with Kinesis and indicate an issue with your partition key strategy.

Here's how to detect them: first, enable shard-level metrics as described above. Then look at IncomingRecords and IncomingBytes broken down by shard. If one shard receives significantly more traffic than others, you've found your hot shard. For instance, if you have four shards and one receives 70% of the traffic while the others split the remaining 30%, that's a hot shard problem.

Hot shards typically arise from poor partition key choices. If your partition key has low cardinality (few distinct values) or is skewed in distribution, records with certain keys will always hash to the same shard. A classic example: if you use user ID as a partition key but one user generates vastly more traffic than others, their records concentrate in one shard. Another mistake is using a timestamp as the partition key—all records within a given time window hash to the same shard, creating a sequential bottleneck.

To identify the root cause, examine your partition key strategy. The ideal partition key has high cardinality and even distribution. If you're using user ID, ensure no single user dominates traffic. If you're using time-based data, compose your partition key from multiple attributes (like user ID + timestamp or region + user ID) to spread the load.

Once you've identified a hot shard, the immediate fix is usually resharding. You can increase the number of shards to spread the load, or you can restructure your partition key to distribute traffic more evenly. Resharding is a bit involved—you create new shards, migrate your consumer to read from both old and new shards, and eventually close the old shards—but it's a one-time operational task that solves the problem.

### Scaling Decisions: Provisioned vs. On-Demand

Kinesis offers two capacity modes: provisioned and on-demand. Understanding when to scale (and how) hinges on interpreting your metrics correctly.

In **provisioned mode**, you specify the number of shards and pay for that capacity regardless of whether you use it. Each shard gives you 1,000 records per second and 1 MB per second write capacity, and 5 read requests per second (with up to 10 MB per request). When you hit these limits, you get throttling and the corresponding metrics increment.

If you're seeing WriteProvisionedThroughputExceeded or ReadProvisionedThroughputExceeded metrics regularly, it's time to scale up. Calculate how many additional shards you need based on your metrics. If you're hitting the 1,000 records per second limit on a single shard and need 2,000 records per second, add another shard. If you're at 1.5 MB per second on a shard (exceeding the 1 MB limit), again, add capacity.

In **on-demand mode**, Kinesis automatically scales your shards based on traffic. You pay per million records ingested and per million records retrieved, rather than for provisioned capacity. On-demand mode is ideal if your traffic patterns are unpredictable or spike dramatically. The tradeoff is cost—on-demand is more expensive per-unit at high volumes, but it eliminates the operational overhead of managing capacity.

The decision between provisioned and on-demand should be driven by your traffic patterns and operational tolerance. Predictable, steady traffic with rare spikes? Provisioned mode is likely cheaper and operationally simpler. Highly variable traffic or rapid growth where you don't want to constantly manage resharding? On-demand is worth the extra cost.

Interestingly, you can switch between modes. If you started in provisioned mode and discovered you prefer on-demand, you can make the switch. Similarly, if on-demand is costing too much as your traffic stabilizes, you can move back to provisioned.

### Building Effective CloudWatch Alarms

Metrics are only useful if you act on them. CloudWatch alarms translate metrics into notifications, telling you when something needs attention.

Start with **IteratorAgeMilliseconds**. Set an alarm when this metric exceeds a threshold meaningful for your use case. If you need near-real-time processing, an alarm at 10 seconds (10,000 milliseconds) makes sense. If you're processing daily analytics batches, 1 hour might be acceptable. The point is to know when your consumer can't keep up.

Create an alarm for **WriteProvisionedThroughputExceeded** and **ReadProvisionedThroughputExceeded**. These should trigger immediately—even a single throttled request is a sign your stream needs more capacity. You want to be notified the moment it happens, not after hours of degradation.

Monitor **IncomingRecords** with anomaly detection. CloudWatch can learn your normal traffic patterns and alert you when traffic deviates significantly from the baseline. This catches situations where upstream producers crash or disconnect unexpectedly.

For consumer applications, create alarms on **GetRecords.Success** that trigger if the metric remains zero for several minutes—this suggests your consumer is dead or not running.

A practical alarm setup might look like this conceptually: alert when WriteProvisionedThroughputExceeded is greater than zero in a two-minute period, or when IteratorAgeMilliseconds exceeds 30,000 milliseconds for more than five minutes. These thresholds are examples; adjust them based on your requirements.

### Practical Operational Scenarios

Let's walk through a few scenarios you might encounter in production, showing how metrics guide troubleshooting.

**Scenario 1: Data is arriving but processing is slow.** You notice IncomingRecords and IncomingBytes are high and stable, but IteratorAgeMilliseconds is climbing. The stream itself is fine; the problem is downstream. Your consumer application either doesn't have enough resources or has inefficient code. Scale your consumer workers, optimize the processing logic, or both. The stream metrics tell you to look at the consumer, not at Kinesis.

**Scenario 2: Producers are getting throttled intermittently.** WriteProvisionedThroughputExceeded is non-zero, but not constantly. Check your shard-level metrics—is one shard getting disproportionate traffic? If so, you have a hot shard and need to fix your partition key. If load is even across shards, you simply don't have enough capacity, and adding shards will help.

**Scenario 3: ReadProvisionedThroughputExceeded is high but IteratorAgeMilliseconds is low.** Your consumer is being throttled on read requests, but it's keeping up with processing. This is less critical than it sounds—you're hitting the five-reads-per-second limit on requests, not data throughput. Solutions include increasing the batch size (each GetRecords request retrieves more data), using enhanced consumers or Lambda, or accepting that you need to add shards.

**Scenario 4: Everything looks fine but you suspect a problem.** Use CloudWatch Insights to query your logs alongside metrics. Write queries like "find all records where processing time exceeded 100ms" or "count of errors by error type." Metrics give you the what; logs tell you the why.

### Tying It All Together

Effective Kinesis monitoring isn't about tracking every metric—it's about knowing which ones matter and what they tell you. IncomingRecords and IncomingBytes show you what's arriving. WriteProvisionedThroughputExceeded tells you whether producers can keep up. IteratorAgeMilliseconds reveals whether consumers are keeping pace. ReadProvisionedThroughputExceeded indicates consumer throughput constraints.

Enable shard-level metrics to find hot shards, and use them to validate that your partition key strategy is distributing traffic evenly. Build alarms that notify you of real problems—throttling, high lag, or missing traffic—rather than alarms on every metric.

The metrics themselves are just numbers, but they're numbers that tell the story of your streaming pipeline. Learn to read that story, and you'll spend less time firefighting and more time building features that actually matter.
