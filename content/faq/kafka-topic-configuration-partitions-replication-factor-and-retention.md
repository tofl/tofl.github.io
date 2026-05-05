---
title: "Kafka Topic Configuration: Partitions, Replication Factor, and Retention"
---

## Kafka Topic Configuration: Partitions, Replication Factor, and Retention

When you first create a Kafka topic on Amazon Managed Streaming for Apache Kafka (MSK), the decisions you make about partitions, replication, and retention shape everything that follows. These aren't just theoretical settings—they directly impact your cluster's throughput, fault tolerance, data durability, and operational costs. Get them wrong, and you might find yourself with a bottleneck you can't easily fix, or worse, data loss during a failure.

This article walks you through the practical decision-making process for configuring Kafka topics. We'll explore the tradeoffs, work through real examples, and show you exactly how to implement these configurations using the CLI tools available in your MSK environment.

### Understanding Partitions: The Foundation of Parallelism

Partitions are the core unit of parallelism in Kafka. Each partition holds an ordered sequence of messages, and only one consumer within a consumer group can read from any given partition at a time. This design means that the number of partitions directly determines the maximum level of parallelism for your consumers.

Let's think about a concrete scenario. Imagine you're building an e-commerce platform that processes customer events—purchases, clicks, searches—at a rate of 100,000 events per second. If you create a topic with just one partition, only a single consumer instance can process these events, and that consumer needs to handle all 100,000 events per second. That's a lot of pressure on one machine. But if you create the same topic with ten partitions, you can deploy ten consumer instances, each processing roughly 10,000 events per second. The load distributes nicely.

However, more partitions isn't always better. Each partition requires memory and disk resources on your brokers, network bandwidth for replication, and overhead during leadership election if a broker fails. If you create 1,000 partitions when you only need ten, you're wasting resources and potentially slowing down cluster operations.

The practical approach is to estimate your throughput needs and the per-consumer processing capacity. If you expect to process 100 MB/s of data and each consumer can handle 10 MB/s, you need at least ten partitions. A common rule of thumb is to slightly overshoot this number—perhaps fifteen or twenty—to account for growth and uneven distribution. You can always add more partitions later, though you'll need to be aware of rebalancing impacts.

Let's look at creating a topic with a specific number of partitions using the `kafka-topics.sh` script, which is typically located in the Kafka binaries directory on your MSK brokers:

```bash
kafka-topics.sh --bootstrap-servers <broker-list> \
  --create \
  --topic events \
  --partitions 10 \
  --replication-factor 3
```

In this example, we're creating a topic called `events` with 10 partitions and a replication factor of 3 (we'll discuss replication in the next section). The `bootstrap-servers` parameter should point to your MSK brokers—typically a comma-separated list of broker endpoints.

Once a topic is created, you can increase the number of partitions, though this operation triggers a consumer rebalance. Existing messages are not redistributed across the new partitions; only new messages will be distributed to the new partitions. This asymmetry can occasionally cause subtle bugs if your application assumes even data distribution.

### Replication Factor: Your Safety Net Against Failure

The replication factor determines how many copies of each partition exist across your cluster. A replication factor of 1 means each partition exists on exactly one broker—if that broker fails, the data is gone. A replication factor of 2 means two brokers hold copies, and a replication factor of 3 means three brokers hold copies.

In production environments, 3 is the industry standard. Here's why: with a replication factor of 3, your topic can survive the simultaneous failure of any two brokers and still maintain availability. If you lose two brokers in a three-node cluster, the third broker still has copies of all partitions, and the cluster continues operating. This is grounded in the mathematics of fault tolerance—with three replicas, you can tolerate floor((3-1)/2) = 1 broker failure and maintain a quorum. With two replicas, you can only tolerate zero failures and maintain a write-quorum, which is risky.

When you write data to Kafka, one broker is designated as the leader for each partition, and the other replicas are called followers. The leader handles all reads and writes, while followers passively replicate the data. This architecture ensures consistency and simplicity—Kafka doesn't have to coordinate writes across multiple leaders.

### The Producer's Perspective: `acks` and `min.insync.replicas`

Here's where it gets interesting from a producer's standpoint. When you produce a message, you need to specify how many in-sync replicas (ISRs) must acknowledge the write before the producer considers it successful. This is controlled by the `acks` configuration on the producer side.

`acks=1` means the leader acknowledges the write immediately, without waiting for followers. This is fast but risky—if the leader crashes before the followers replicate the message, you lose data.

`acks=all` (or `acks=-1`) means the leader waits for all in-sync replicas to acknowledge the write. This is slower but safer. However, "all in-sync replicas" is key—the number of required acknowledgments is determined by the `min.insync.replicas` setting on the topic.

If you set `min.insync.replicas=2` on a topic with a replication factor of 3, then `acks=all` means at least 2 replicas must acknowledge. If your topic has a replication factor of 3 but you set `min.insync.replicas=1`, then `acks=all` only guarantees one replica has the data, which defeats the purpose.

For production systems handling important data, a common pattern is:

- Replication factor of 3
- `min.insync.replicas=2`
- Producer configured with `acks=all`

This ensures that every write is acknowledged only after being replicated to at least two brokers. You can lose one broker and still have copies on two others.

To set these configurations when creating a topic:

```bash
kafka-topics.sh --bootstrap-servers <broker-list> \
  --create \
  --topic critical-events \
  --partitions 10 \
  --replication-factor 3 \
  --config min.insync.replicas=2
```

The `--config` flag lets you set broker-side topic configurations. You can pass multiple `--config` flags to set several configurations at once.

### Retention: Keeping the Right Data for the Right Duration

Kafka doesn't delete messages automatically. Without retention configuration, your topics will grow indefinitely, consuming disk space until your cluster runs out of storage. Retention policies let you automatically delete old messages, freeing space while keeping recent data available.

Kafka offers two retention mechanisms: time-based and size-based. Time-based retention deletes messages older than a specified duration. Size-based retention deletes messages when the partition size exceeds a threshold. Both can be configured simultaneously—messages are deleted when either condition is met.

For many applications, time-based retention is more intuitive. Imagine a mobile analytics topic where you want to keep the last seven days of data for real-time dashboards and re-processing. You'd set `retention.ms=604800000` (7 days in milliseconds):

```bash
kafka-topics.sh --bootstrap-servers <broker-list> \
  --create \
  --topic mobile-events \
  --partitions 20 \
  --replication-factor 3 \
  --config retention.ms=604800000
```

Size-based retention is useful when you're more concerned about disk space than time. If you know your topic grows at 1 GB per hour and you have 100 GB of available disk space per partition, you might set `retention.bytes` to 90 GB to maintain a safety margin:

```bash
kafka-topics.sh --bootstrap-servers <broker-list> \
  --create \
  --topic high-volume-stream \
  --partitions 50 \
  --replication-factor 3 \
  --config retention.bytes=96636764160
```

The value is in bytes, so 90 GB = 96,636,764,160 bytes.

You can combine both policies:

```bash
kafka-topics.sh --bootstrap-servers <broker-list> \
  --create \
  --topic dual-retention-topic \
  --partitions 15 \
  --replication-factor 3 \
  --config retention.ms=2592000000 \
  --config retention.bytes=10737418240
```

This topic retains messages for 30 days or until the partition reaches 10 GB, whichever comes first.

Be thoughtful about retention settings. Too aggressive, and you lose data you might need. Too lenient, and you bloat your storage costs. A common pattern is to use time-based retention aligned with your operational needs—perhaps seven days for real-time systems, thirty days for analytics, or even longer if you're using Kafka as a long-term event store.

### Log Compaction: Keeping State Current

Time- and size-based retention policies delete old messages unconditionally. But sometimes you want to retain only the latest value for each key, preserving a snapshot of current state without keeping the entire history. That's where log compaction comes in.

Log compaction is enabled per-topic and works on keyed messages. The compaction process scans the log, identifies duplicate keys, and deletes older versions, keeping only the latest value for each key. This is invaluable for topics that represent state—user profiles, configuration settings, or account balances.

Imagine a user profile topic where you emit an event every time a customer updates their address, phone number, or preferences. Without compaction, you'd have dozens of versions of each user's profile in the log. With compaction enabled, the log shrinks to contain only the latest profile for each user ID.

To enable log compaction:

```bash
kafka-topics.sh --bootstrap-servers <broker-list> \
  --create \
  --topic user-profiles \
  --partitions 10 \
  --replication-factor 3 \
  --config cleanup.policy=compact
```

You can also combine compaction with time- or size-based retention:

```bash
kafka-topics.sh --bootstrap-servers <broker-list> \
  --create \
  --topic user-profiles \
  --partitions 10 \
  --replication-factor 3 \
  --config cleanup.policy=compact \
  --config retention.ms=2592000000
```

This configuration compacts the log while also deleting messages older than 30 days.

Log compaction has one subtle behavior worth understanding: even after compaction, Kafka doesn't immediately delete old versions. Instead, it marks them for deletion during the next compaction cycle. The `min.compaction.lag.ms` setting controls how long Kafka waits before considering a message eligible for compaction. The default is 0, meaning messages are eligible immediately, but you might increase this if you need a grace period for late-arriving data.

### Modifying Topic Configuration After Creation

One of the nice aspects of Kafka topic configuration is that many settings can be modified after creation without recreating the topic. This means you can adjust your strategy based on real-world behavior.

You can use the `--alter` flag with `kafka-topics.sh` to modify existing topics:

```bash
kafka-topics.sh --bootstrap-servers <broker-list> \
  --alter \
  --topic events \
  --config retention.ms=1209600000
```

This command changes the retention time on the `events` topic to 14 days. The change takes effect immediately for new messages, though existing messages beyond the retention window are cleaned up according to the new policy.

Similarly, you can adjust `min.insync.replicas`:

```bash
kafka-topics.sh --bootstrap-servers <broker-list> \
  --alter \
  --topic critical-events \
  --config min.insync.replicas=3
```

However, some configurations cannot be changed after topic creation and require recreation. The partition count is not one of them—you can increase partitions:

```bash
kafka-topics.sh --bootstrap-servers <broker-list> \
  --alter \
  --topic events \
  --partitions 20
```

But you cannot decrease the partition count. The replication factor is more nuanced. You can modify it, but the operation is complex and involves reassigning partitions across brokers. For practical purposes, if you need a different replication factor, it's often simpler to create a new topic and migrate consumers.

The general principle is: settings that affect message content and ordering (partitions, replication) are harder to change, while operational settings (retention, compaction policy, min.insync.replicas) are flexible.

### Practical Configuration Strategy

Bringing this all together, here's how you might approach configuring a production topic:

Start with your throughput and failure tolerance requirements. For a 100 MB/s event stream where you need to process events in parallel, estimate that each consumer can handle 10 MB/s. That suggests 10-15 partitions. For a replication factor, choose 3 if you have at least 3 brokers in your cluster (which is standard for production MSK clusters). Set `min.insync.replicas=2` to ensure durability.

For retention, align with your operational needs. Event streams might retain 7-30 days. State topics (using compaction) might retain 30+ days. Cost-sensitive pipelines might use size-based retention instead.

Here's a realistic example:

```bash
kafka-topics.sh --bootstrap-servers broker1:9092,broker2:9092,broker3:9092 \
  --create \
  --topic purchase-events \
  --partitions 12 \
  --replication-factor 3 \
  --config min.insync.replicas=2 \
  --config retention.ms=604800000 \
  --config cleanup.policy=delete
```

And for a state topic:

```bash
kafka-topics.sh --bootstrap-servers broker1:9092,broker2:9092,broker3:9092 \
  --create \
  --topic customer-state \
  --partitions 8 \
  --replication-factor 3 \
  --config min.insync.replicas=2 \
  --config cleanup.policy=compact \
  --config retention.ms=2592000000
```

Remember that these settings should be informed by your actual usage patterns. Start with conservative estimates, monitor your cluster's behavior, and adjust as needed. The flexibility of Kafka's configuration system means you're never locked into your initial choices.

### Conclusion

Effective Kafka topic configuration balances competing concerns: parallelism through partitions, durability through replication, and cost management through retention. There's no one-size-fits-all answer, but understanding the tradeoffs lets you make informed decisions aligned with your application's needs.

Partitions enable horizontal scaling, but too many create operational overhead. A replication factor of 3 with `min.insync.replicas=2` and `acks=all` producers provides strong durability. Retention policies—whether time-based, size-based, or compaction-based—keep your storage costs manageable while preserving data you need. And the ability to modify most configurations after creation means you can evolve your setup as requirements change.

As you build on MSK, start with these principles, monitor your actual throughput and resource utilization, and refine your configuration accordingly. The CLI examples in this article give you the tools to implement these decisions; the judgment about which settings suit your specific workload comes with experience and observation.
