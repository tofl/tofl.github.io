---
title: "Kafka Producer Semantics: At-Least-Once, At-Most-Once, and Exactly-Once Delivery"
---

## Kafka Producer Semantics: At-Least-Once, At-Most-Once, and Exactly-Once Delivery

When you send a message to Apache Kafka, you're asking a deceptively simple question: "Will this message make it to the topic?" The answer, as it turns out, depends entirely on how you configure your producer. Build a feature-tracking system without thinking through delivery guarantees, and you might lose critical events. Optimize too aggressively for throughput and accept at-most-once semantics, and you'll face angry customers discovering missing data. Getting this right is foundational to building reliable event-driven systems on AWS Managed Streaming for Kafka (MSK).

This article walks you through the three delivery semantics that Kafka producers support, shows you exactly how to configure them, and helps you understand the real-world trade-offs between durability, throughput, and complexity. Whether you're building financial transaction pipelines, user analytics systems, or real-time recommendations, understanding these guarantees will make you a more effective engineer.

### Understanding Kafka's Three Delivery Semantics

At its core, a delivery semantic describes what happens to a message after you call `send()` on your Kafka producer. Will it definitely arrive? Might it disappear? Could it show up twice? Kafka gives you three options, each with different guarantees and performance characteristics.

**At-most-once** means your message might never reach the broker, but if it does, it will appear exactly once to downstream consumers. This is the fastest but least reliable approach. **At-least-once** guarantees your message will reach the broker, but it might appear multiple times if the producer retries a send that actually succeeded but whose acknowledgment was lost. **Exactly-once** ensures your message arrives precisely once — no duplicates, no losses — and represents the gold standard that most production systems strive for.

These semantics matter because Kafka lives at the boundary between your application and your data. What the producer sends becomes the source of truth for every consumer downstream. Get it wrong, and you're either losing critical events or seeing phantom duplicates that wreak havoc on your calculations.

### The `acks` Parameter: Your First Control Point

The most fundamental lever you have as a Kafka producer is the `acks` configuration parameter. This single setting determines how many in-sync replicas must acknowledge a write before the broker tells your producer, "Your message is safely stored."

When you set `acks=0`, your producer doesn't wait for any acknowledgment at all. It fires a message at the broker and immediately moves on, optimistic that everything will work out. This is at-most-once delivery at its fastest. You'll get the highest throughput imaginable — your producer never blocks — but if a broker crashes the instant your message arrives, it's gone forever. Kafka never even persists it to disk. You'd only use this mode for non-critical telemetry where losing a few data points matters less than latency.

With `acks=1`, the leader broker receives your message, persists it to its local log, and sends back an acknowledgment. Your producer waits for this acknowledgment before considering the send successful. This is the default and strikes a balance. If a broker crash happens immediately after the leader acknowledges but before replication completes, a replica promoted to leader won't have your message, and downstream consumers will miss it. This is technically at-least-once in theory, but with a risk of loss under specific failure modes, making it practically somewhere in between.

When you set `acks=all` (or equivalently `acks=-1`), the broker waits until all in-sync replicas have written your message before sending an acknowledgment. This is the safest setting. If a broker crashes after acknowledging, every remaining in-sync replica has the message. You won't lose data even in multi-broker failures, as long as at least one in-sync replica survives. The trade-off is obvious: latency increases because the producer now waits for multiple brokers to confirm receipt.

Here's what this looks like in practice. Consider a Python producer configured with different `acks` values:

```python
from kafka import KafkaProducer
import json

# At-most-once: Fire and forget
producer_at_most_once = KafkaProducer(
    bootstrap_servers=['msk-broker-1:9092'],
    acks=0,
    value_serializer=lambda v: json.dumps(v).encode('utf-8')
)

# At-least-once (default): Wait for leader
producer_at_least_once = KafkaProducer(
    bootstrap_servers=['msk-broker-1:9092'],
    acks=1,
    value_serializer=lambda v: json.dumps(v).encode('utf-8')
)

# Safer: Wait for all in-sync replicas
producer_safest = KafkaProducer(
    bootstrap_servers=['msk-broker-1:9092'],
    acks='all',
    value_serializer=lambda v: json.dumps(v).encode('utf-8')
)
```

In Java, the equivalent configuration looks like this:

```java
Properties props = new Properties();
props.put("bootstrap.servers", "msk-broker-1:9092");
props.put("key.serializer", "org.apache.kafka.common.serialization.StringSerializer");
props.put("value.serializer", "org.apache.kafka.common.serialization.StringSerializer");

// For at-most-once
props.put("acks", "0");

// For at-least-once
props.put("acks", "1");

// For maximum durability
props.put("acks", "all");

KafkaProducer<String, String> producer = new KafkaProducer<>(props);
```

The `acks` parameter alone gets you most of the way there, but it doesn't solve the duplicate problem inherent in at-least-once semantics. That's where idempotence enters the picture.

### Idempotent Producers: Eliminating Duplicates

An idempotent producer is one that automatically deduplicates messages on the broker side. If you send the same message twice due to a retry, the broker will store it only once. This is a game-changer because it lets you safely retry failed sends without worrying about creating duplicates.

To enable idempotence, you set `enable.idempotence=true`. This enables a few mechanisms under the hood. The producer assigns each message a sequence number, and the broker tracks these sequences per producer and partition. If a message arrives with a sequence number the broker has already seen, it acknowledges the message without storing it again. The broker also implicitly sets `acks=all` and `retries` to a high value, ensuring that messages are sent reliably.

Here's how you enable it in Python:

```python
from kafka import KafkaProducer

producer = KafkaProducer(
    bootstrap_servers=['msk-broker-1:9092'],
    enable_idempotence=True,
    value_serializer=lambda v: json.dumps(v).encode('utf-8')
)

# Even if we retry, the message appears exactly once
message = {"user_id": 123, "event": "purchase", "amount": 99.99}
producer.send('purchases', value=message)
```

And in Java:

```java
Properties props = new Properties();
props.put("bootstrap.servers", "msk-broker-1:9092");
props.put("key.serializer", "org.apache.kafka.common.serialization.StringSerializer");
props.put("value.serializer", "org.apache.kafka.common.serialization.StringSerializer");
props.put("enable.idempotence", "true");

KafkaProducer<String, String> producer = new KafkaProducer<>(props);
```

The catch is scope. Idempotence works within a single producer instance and partition. It guarantees that messages from your producer won't create duplicates within a partition, but it doesn't prevent duplicates across partitions or from different producer instances. If you have multiple producer instances sending to the same topic, each will deduplicate within its own sequence, but if producer A sends message 1 and then crashes while producer B also sends message 1, both copies will exist. For many use cases this is fine — you can deduplicate at the consumer level or rely on application logic to handle occasional duplicates.

However, if you need stronger guarantees that span multiple partitions or topics, you need transactions.

### Kafka Transactions: Exactly-Once Across Partitions

Transactions in Kafka let you write to multiple partitions atomically, all succeeding or all failing together. This is critical when you need exactly-once semantics across your entire system, not just within a single partition.

Here's a common scenario: You're processing a financial transaction. You need to debit an account in one topic, credit another account in a second topic, and record the transaction in a third topic. Without transactions, if your producer sends the debit message successfully but crashes before sending the credit, you've lost money. With transactions, either all three messages commit together or none of them do.

To use transactions in Python:

```python
from kafka import KafkaProducer
import json

producer = KafkaProducer(
    bootstrap_servers=['msk-broker-1:9092'],
    transactional_id='financial-processor-1',
    value_serializer=lambda v: json.dumps(v).encode('utf-8')
)

transaction_id = "txn-12345"

try:
    producer.begin_transaction()
    
    # Send debit
    producer.send('debits', value={"account": "A", "amount": 100})
    
    # Send credit
    producer.send('credits', value={"account": "B", "amount": 100})
    
    # Record transaction
    producer.send('transactions', value={"from": "A", "to": "B", "amount": 100})
    
    producer.commit_transaction()
except Exception as e:
    producer.abort_transaction()
    print(f"Transaction failed: {e}")
```

The equivalent Java code:

```java
Properties props = new Properties();
props.put("bootstrap.servers", "msk-broker-1:9092");
props.put("key.serializer", "org.apache.kafka.common.serialization.StringSerializer");
props.put("value.serializer", "org.apache.kafka.common.serialization.StringSerializer");
props.put("transactional.id", "financial-processor-1");
props.put("enable.idempotence", "true");

KafkaProducer<String, String> producer = new KafkaProducer<>(props);

try {
    producer.beginTransaction();
    
    producer.send(new ProducerRecord<>("debits", "A", "{\"amount\": 100}"));
    producer.send(new ProducerRecord<>("credits", "B", "{\"amount\": 100}"));
    producer.send(new ProducerRecord<>("transactions", null, "{\"from\": \"A\", \"to\": \"B\", \"amount\": 100}"));
    
    producer.commitTransaction();
} catch (Exception e) {
    producer.abortTransaction();
    System.err.println("Transaction failed: " + e.getMessage());
}
```

Transactions require a `transactional_id` which uniquely identifies your producer. This ID allows Kafka to handle producer failures gracefully. If your producer crashes mid-transaction, Kafka remembers the transaction ID and can clean up or complete the transaction on recovery. The transactional ID should be unique per producer instance and stable across restarts if you're using a managed environment.

Under the hood, Kafka uses a transaction coordinator (similar to the consumer group coordinator) to manage transaction state. When you commit, all messages in the transaction are written atomically from the consumer's perspective. Transactions also implicitly enable idempotence, so you get deduplication for free.

The downside of transactions is latency and throughput. Coordinating across multiple partitions and maintaining transaction state adds overhead. You'll see higher latency per message and lower maximum throughput compared to non-transactional producers. Use transactions when correctness is more important than speed — financial systems, inventory management, order processing.

### Understanding `min.insync.replicas` and Its Interaction with `acks=all`

When you set `acks=all`, the broker waits for all in-sync replicas to acknowledge before confirming the write. But what defines "in-sync"? This is where `min.insync.replicas` (or `min.isr`) enters the picture.

`min.insync.replicas` is a broker configuration, typically set at the topic level. It specifies the minimum number of in-sync replicas that must exist for a topic before the broker will accept writes. If a replica falls behind (due to network issues, slow disk, or broker overload), it's considered out-of-sync and removed from the in-sync replica set. If the in-sync replica set shrinks below `min.insync.replicas`, the broker stops accepting writes entirely, throwing a `NotEnoughReplicasException`.

This sounds harsh, but it's actually a safety feature. Imagine you have a three-broker cluster with replication factor 3 and `min.insync.replicas=2`. If one broker goes down, you still have two in-sync replicas, so writes continue. If a second broker goes down, you drop to one in-sync replica, which is less than your minimum, so writes are rejected. This prevents you from writing data that's only on one replica — if that replica fails, your data is lost.

Here's how you'd set `min.insync.replicas` on an MSK topic using the AWS CLI:

```bash
# Create a topic with min.insync.replicas=2
aws kafka create-topic \
  --cluster-arn arn:aws:kafka:us-east-1:123456789012:cluster/my-cluster/12345678-1234-1234-1234-123456789012 \
  --topic-name orders \
  --partitions 3 \
  --replication-factor 3 \
  --config MinimumInSyncReplicas=2
```

Or if you're using the `kafka-configs` CLI tool (running from an EC2 instance or client within the VPC):

```bash
kafka-configs.sh --bootstrap-server localhost:9092 \
  --entity-type topics \
  --entity-name orders \
  --alter \
  --add-config min.insync.replicas=2
```

The interplay between `acks`, `min.insync.replicas`, and replication factor shapes your durability. With `acks=all` and `min.insync.replicas=2` on a three-replica topic, you're guaranteed that at least two replicas have your message before the producer gets an acknowledgment. This protects against single-broker failures. If you need to survive two broker failures, you'd want `min.insync.replicas=3`.

The trade-off is availability. A higher `min.insync.replicas` means it's easier to dip below the minimum when brokers are unhealthy. You might find yourself in a situation where writes are blocked because too many replicas are out-of-sync. When configuring production MSK clusters, finding the right balance between durability and availability is essential.

### Throughput vs. Durability Trade-offs

Configuring producer semantics always involves a triangle of concerns: throughput, latency, and durability. You can optimize for any two, but not all three simultaneously.

`acks=0` gives you maximum throughput and minimum latency, but zero durability guarantees. It's appropriate only for scenarios where occasional data loss is acceptable — non-critical monitoring metrics, debug logs, analytics that tolerate missing samples.

`acks=1` with no idempotence offers good throughput and reasonable latency with a moderate durability guarantee. You're protected against broker crashes that happen after the leader acknowledges, but you risk losing data if the leader itself crashes immediately. This is the sweet spot for many use cases where you can tolerate occasional message loss under catastrophic failure scenarios.

`acks=1` with `enable.idempotence=true` adds deduplication at minimal performance cost. The overhead is light — just sequence number tracking on the broker side. You get at-least-once semantics with automatic duplicate removal within a partition, making this a popular choice for event-driven applications that can't afford duplicates but also can't afford the latency hit of `acks=all`.

`acks=all` with `min.insync.replicas=2` (or higher) provides strong durability. You won't lose data unless multiple brokers fail simultaneously. The cost is latency — you're waiting for multiple brokers to acknowledge each write. In practice, with modern hardware and networks, this might only add 10-20ms per message, which is acceptable for many applications but not for ultra-low-latency systems.

`acks=all` combined with transactions and idempotence gives you the strongest guarantees: exactly-once semantics, strong durability, and atomicity across partitions. This is the configuration you'd use for financial transactions, order processing, or any system where correctness is paramount. The throughput will be the lowest of all configurations, but that's often acceptable when you're processing high-value operations.

Here's a practical comparison. Imagine you're building an order processing system:

For the order intake topic where you're just receiving orders and can tolerate occasional duplicates that you'll deduplicate later, `acks=1` with `enable.idempotence=true` makes sense.

For the fulfillment topic where inventory updates must be exactly-once and atomically reflected across warehouse systems, `acks=all` with `min.insync.replicas=2` and transactions becomes necessary.

For the analytics topic where you're computing aggregate metrics and can absorb occasional data loss, `acks=1` without idempotence is sufficient.

### Configuring Producers on AWS Managed Streaming for Kafka

AWS MSK abstracts away much of the infrastructure complexity, but you still control these semantics through producer configuration. When you launch an MSK cluster, you define broker configurations that set defaults for topics. However, you typically configure semantics in your producer application code rather than cluster-wide.

For example, to create an MSK cluster that's optimized for durability, you might use the AWS Console to set:

- Auto scaling enabled to add capacity when brokers experience high load
- Encryption in transit and at rest for compliance
- Enhanced monitoring to catch issues early

Then in your producer code, you'd set the semantic guarantees. Here's what a well-configured Python producer for an MSK cluster might look like:

```python
from kafka import KafkaProducer
from kafka.errors import KafkaError
import json

producer = KafkaProducer(
    bootstrap_servers=['msk-broker-1.example.com:9092', 'msk-broker-2.example.com:9092'],
    acks='all',
    retries=3,
    max_in_flight_requests_per_connection=1,
    enable_idempotence=True,
    compression_type='snappy',
    value_serializer=lambda v: json.dumps(v).encode('utf-8')
)

def send_order(order_data):
    future = producer.send('orders', value=order_data)
    try:
        record_metadata = future.get(timeout=10)
        print(f"Message sent to topic {record_metadata.topic}, "
              f"partition {record_metadata.partition}, "
              f"offset {record_metadata.offset}")
    except KafkaError as e:
        print(f"Failed to send message: {e}")
        raise

# Usage
order = {
    "order_id": "ORD-001",
    "customer_id": 123,
    "items": [{"sku": "ABC", "qty": 2}],
    "total": 49.99
}

send_order(order)
```

Notice a few details here. Setting `max_in_flight_requests_per_connection=1` ensures that the producer never has more than one request in flight at a time. This guarantees ordering within a partition — important when you need messages to be processed in the exact order you sent them. Without this, Kafka's retry logic could cause messages to arrive out of order (for example, message 1 fails and is retried, but message 2 was already sent and succeeds first).

Also observe that we're calling `future.get(timeout=10)` to wait for the send to complete. This is different from fire-and-forget. The future gives us access to record metadata (topic, partition, offset) and lets us handle errors synchronously.

### Comparing with Kinesis Data Streams

AWS also offers Kinesis Data Streams, which is often compared with MSK. While Kinesis is simpler to operate and fully managed by AWS, it has different delivery semantics. Kinesis guarantees at-least-once delivery by default — every record is written to every shard replica and persisted for 24 hours. You don't have fine-grained control over the durability trade-off like you do with Kafka.

Kinesis also doesn't support true transactions across shards the way Kafka does. You can write to a single shard atomically, but writing to multiple shards requires application-level coordination.

The advantage of Kinesis is simplicity. You don't have to think about `acks`, `min.insync.replicas`, or idempotence. The disadvantage is inflexibility. If you have specific latency, throughput, or semantic requirements, Kinesis might not fit. Kafka, especially through MSK, lets you dial in exactly the guarantees you need.

For example, if you're building a system that needs sub-second latency with at-most-once semantics (perhaps a real-time gaming leaderboard where occasional data loss is acceptable), Kafka's `acks=0` gives you this directly. Kinesis doesn't support this mode — it always persists everything.

Conversely, if you need zero-configuration durability and can tolerate Kinesis's pricing model and throughput limitations, Kinesis is a fine choice.

### Best Practices for Production Deployments

Based on decades of collective industry experience with event streaming, a few patterns emerge for production systems:

Start with `enable.idempotence=true` and `acks='all'` as your defaults unless you have a specific reason not to. Idempotence is cheap and eliminates an entire class of bugs. `acks='all'` gives you durability without the complexity of transactions.

Always set `min.insync.replicas` to at least 2 for production topics. This prevents you from accidentally creating single-replica situations where a broker failure means data loss. If you can afford it, consider 3 for critical topics.

Avoid transactional producers unless you genuinely need atomicity across multiple topics. They add latency and complexity, and most use cases can work around the occasional duplicate with idempotence and consumer-side deduplication.

Monitor your producer metrics. Track the number of failed sends, the latency distribution, and the batch sizes. MSK integrates with CloudWatch, giving you visibility into broker metrics. Use this data to inform your configuration choices.

Test your disaster scenarios. If a broker fails, will your system continue working? If an entire rack of brokers goes down, what happens? Set up chaos engineering experiments on a staging MSK cluster to validate your assumptions about durability and failover behavior.

Document your semantic choices. A year from now, when someone asks why a particular topic uses `acks=1`, you should be able to point to a comment explaining the reasoning. This prevents accidental configuration changes that break correctness.

### Conclusion

Kafka producer semantics are the foundation of reliable event-driven systems. The `acks` parameter, idempotent producers, transactions, and `min.insync.replicas` configuration work together to let you choose exactly the durability and performance characteristics your application needs.

At-most-once delivery with `acks=0` is for non-critical telemetry. At-least-once delivery with `acks=1` or `acks=all` combined with idempotence is the practical choice for most applications. Exactly-once semantics with transactions is reserved for systems where correctness is non-negotiable, even at the cost of throughput.

When configuring MSK in production, there's no universally "correct" answer. A real-time analytics pipeline has different requirements than a financial transaction processor. The art of building systems on Kafka is understanding your requirements, mapping them onto the available semantic options, and configuring your producers accordingly. Start conservative with strong durability guarantees, measure the impact on your latency and throughput, and optimize from there. With these knobs in hand, you can build systems that are fast, reliable, and appropriate for whatever problems you're solving.
