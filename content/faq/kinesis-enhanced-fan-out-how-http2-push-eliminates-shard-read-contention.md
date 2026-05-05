---
title: "Kinesis Enhanced Fan-Out: How HTTP/2 Push Eliminates Shard Read Contention"
---

## Kinesis Enhanced Fan-Out: How HTTP/2 Push Eliminates Shard Read Contention

When you're building real-time data pipelines on AWS, few things are more frustrating than watching your consumer application starve for data. Imagine a scenario where you have multiple applications competing to read from the same Kinesis shard—each one fighting for bandwidth, each one experiencing unnecessary latency, each one forced to poll repeatedly just to check if there's anything new. This architectural limitation has plagued many organizations relying on standard Kinesis polling, until Enhanced Fan-Out (EFO) arrived to fundamentally change how data flows from shards to consumers.

Enhanced Fan-Out represents a paradigm shift in Kinesis architecture. Rather than having multiple consumers battle over a shared 2 MB/s bandwidth allocation, EFO gives each consumer its own dedicated 2 MB/s throughput, delivered proactively via HTTP/2 server push rather than waiting passively for polls. The result is lower latency, better scalability, and predictable performance—though this comes with additional cost considerations that we'll explore in detail.

Understanding when and how to use Kinesis Enhanced Fan-Out is essential for developers building production-grade streaming applications on AWS. This article walks through the architectural mechanics, practical implementation patterns, cost-benefit analysis, and decision criteria you'll need to make this technology work effectively in your systems.

### The Standard Kinesis Polling Model: Shared Bandwidth Under Pressure

To appreciate what Enhanced Fan-Out solves, let's first understand the constraints of standard Kinesis polling. When you consume data from Kinesis using the traditional `GetRecords` API, your application repeatedly polls shards for new records. This model has worked well for many years and remains the right choice in certain scenarios, but it comes with fundamental architectural limitations.

Each shard in a standard Kinesis stream provides 1 MB/s of write capacity and 2 MB/s of read capacity. This is where the contention problem emerges: that 2 MB/s is a shared pool. If you have one consumer application, it gets the full 2 MB/s. But if you have two consumers reading from the same shard—perhaps one service processing the data for analytics, another for real-time alerting—they must split that bandwidth. With five consumers, each gets approximately 400 KB/s. The limitation isn't artificial or arbitrary; it's tied directly to the shard's physical resources.

Beyond bandwidth sharing, the polling model introduces latency. Your consumer must make repeated API calls, waiting for the response on each request-response cycle. Even with optimized polling intervals, you're looking at latencies in the 200 millisecond range, and that's when everything is working smoothly. Under load or with network variability, latencies can stretch further.

The `GetRecords` API also imposes iterator limitations. Each shard has multiple iterators (up to 10,000 concurrent across the stream), and these iterators have a four-hour lifetime. While this rarely becomes a practical issue for most applications, it adds operational constraints that your code must manage.

### Introducing Enhanced Fan-Out: Dedicated Throughput and Server Push

Kinesis Enhanced Fan-Out changes the game by inverting the data delivery model. Instead of your application pulling data through repeated polling, the Kinesis stream pushes records to your consumer application as soon as they arrive. This is delivered via a persistent HTTP/2 connection, which allows the Kinesis service to send multiple messages asynchronously without waiting for your application to request them.

The most immediate consequence is bandwidth. With EFO, each registered consumer gets a dedicated 2 MB/s allocation per shard. If you have three EFO consumers reading from a single shard, you don't have contention—each one receives records at up to 2 MB/s simultaneously. This is a game-changer for multi-consumer architectures where different downstream systems need to process the same stream.

The second major improvement is latency. Because data is pushed rather than pulled, records reach your consumer within approximately 70 milliseconds, compared to the 200+ milliseconds typical of polling. This low-latency delivery is particularly valuable for use cases like real-time fraud detection, live notifications, or time-sensitive analytics where every millisecond matters.

Under the hood, this architecture relies on the `SubscribeToShard` API instead of the traditional `GetRecords`. The `SubscribeToShard` API establishes a persistent HTTP/2 connection with the Kinesis service. Once connected, records flow asynchronously down that connection as they arrive. Your application consumes from an event stream rather than making discrete API calls.

### The Registered Consumer Model: Organization and Limits

Enhanced Fan-Out introduces the concept of registered consumers. Unlike the polling model, where any application with proper IAM permissions can call `GetRecords`, EFO requires you to explicitly create and register a consumer within the stream. This adds a layer of management but provides important benefits around organization, monitoring, and quotas.

To use Enhanced Fan-Out, you first create a registered consumer using the `RegisterStreamConsumer` API. This operation associates a consumer name with your Kinesis stream and returns a consumer ARN. Your application then uses this consumer ARN when calling `SubscribeToShard`. The stream tracks which consumer is connected, allowing AWS to log usage per consumer, enforce dedicated throughput allocations, and provide granular CloudWatch metrics.

Each Kinesis stream supports a maximum of 20 registered consumers. This is an important architectural constraint. It means you can have at most 20 applications or logical components consuming from a single stream via Enhanced Fan-Out. In practice, this limit rarely becomes a blocker because 20 concurrent consumers is already a fairly sophisticated multi-consumer setup. However, it's worth considering in high-fan-out architectures. If you need more than 20 independent consumers, you might distribute them across multiple streams or use a message fan-out pattern downstream of Kinesis.

Registered consumers are independently manageable entities. You can view consumer details, including the consumer creation timestamp and the ARN. You can also deregister a consumer when it's no longer needed. AWS maintains consumer status information, showing whether a consumer is currently active (connected with an open subscription) or inactive.

### The SubscribeToShard API: HTTP/2 and Asynchronous Data Flow

The `SubscribeToShard` API is where the magic happens. This is the operation your application calls to subscribe to records from a specific shard using a registered consumer. The call is fundamentally different from `GetRecords` in how it handles data flow and connection management.

When you call `SubscribeToShard`, you provide the stream ARN, shard ID, and the consumer ARN. The API establishes an HTTP/2 connection and immediately begins streaming events down that connection. The Kinesis service encodes records and heartbeat messages into a series of events that arrive asynchronously.

HTTP/2 server push is the enabling technology here. Traditional HTTP/1.1 is fundamentally request-response: the client sends a request, the server responds, and the cycle repeats. HTTP/2 allows the server to push messages to the client without waiting for explicit requests. This is precisely what Kinesis needs to deliver data efficiently without polling overhead.

The event stream from `SubscribeToShard` includes several message types. The most common is `ResourceNotFoundException` for non-existent shards, or a series of events containing actual records. The stream also periodically sends heartbeat messages to keep the connection alive and confirm that the consumer is still connected. Your application must handle the asynchronous nature of these events—processing them as they arrive rather than waiting in a polling loop.

Most AWS SDKs abstract away the complexity of managing the HTTP/2 connection and event stream. In the Python boto3 SDK, for example, you use the event stream interface to iterate over records:

```python
import boto3

kinesis = boto3.client('kinesis')

response = kinesis.subscribe_to_shard(
    ConsumerARN='arn:aws:kinesis:us-east-1:123456789012:stream/my-stream/consumer/my-consumer',
    ShardId='shardId-000000000000',
    StartingPosition={
        'Type': 'LATEST'
    }
)

event_stream = response['EventStream']
for event in event_stream:
    if 'Records' in event:
        for record in event['Records']:
            print(f"Data: {record['Data']}")
            print(f"Sequence Number: {record['SequenceNumber']}")
```

The `StartingPosition` parameter tells Kinesis where to begin reading. You can use `LATEST` to start with newly arriving records, `TRIM_HORIZON` to start from the oldest available record, or `AT_SEQUENCE_NUMBER` to resume from a specific point—useful when you've checkpointed your processing progress.

### Latency and Throughput: The Performance Improvement

The shift from polling to server push has quantifiable performance benefits. Standard Kinesis polling typically introduces 200 milliseconds or more of latency between a record arriving in the stream and your consumer receiving it. This latency comes from polling intervals, network round-trip time, and the inherent inefficiency of repeated request-response cycles.

Enhanced Fan-Out reduces this to approximately 70 milliseconds. This isn't a minor improvement—it's more than a 2x reduction. For many applications, particularly those handling time-sensitive events, this difference is transformative. A fraud-detection system that can respond to suspicious activity 130 milliseconds sooner can take preventative action faster. A live leaderboard updating user rankings can refresh more frequently with lower perceived delay.

The throughput improvement is even more dramatic when you consider multi-consumer scenarios. With standard polling, adding a second consumer to a shard cuts each consumer's effective bandwidth in half. With EFO, the second consumer has a completely independent 2 MB/s allocation. If your use case involves multiple logical consumers sharing a shard, EFO eliminates the scaling bottleneck entirely.

It's worth noting that these latency figures are averages and depend on several factors: the size of records being pushed, the processing speed of your consumer application, and the overall load on the Kinesis service. Under normal circumstances, EFO latencies remain tightly clustered around 70 milliseconds. During traffic spikes, latencies can increase somewhat, but the dedicated throughput model prevents the kind of degradation you'd see under high load with polling.

### Pricing: Understanding the Cost Structure

Enhanced Fan-Out is not free, and understanding the pricing model is essential for making informed architectural decisions. Unlike the standard Kinesis pricing, which charges per shard-hour, EFO introduces per-consumer charges.

The primary cost components for Enhanced Fan-Out are:

Each registered consumer incurs a charge per shard-hour. As of the current pricing, this typically costs around $0.03 per shard-hour per consumer. This means that if you have one consumer reading from five shards, you pay for five shard-hours of EFO consumption. The charge applies whether the consumer is actively reading or merely registered. This is an important distinction—registering a consumer has an ongoing cost even if your application isn't actively processing records.

In addition to the per-shard-hour charge, you pay for the data delivered through the EFO connection. This is measured in gigabytes of data actually delivered to your consumer. The pricing is typically around $0.25 per GB delivered. This is separate from any data storage charges or standard GetRecords charges you might incur elsewhere.

To put this in perspective, consider a scenario with three registered consumers each reading from a ten-shard Kinesis stream, with an average of 1 GB/day of data delivered per consumer. The monthly cost would be:

- Per-shard-hour cost: 3 consumers × 10 shards × 24 hours/day × 30 days/month × $0.03/shard-hour = $6,480
- Per-GB cost: 3 consumers × 1 GB/day × 30 days/month × $0.25/GB = $22.50
- Total monthly cost: approximately $6,502.50

For a single consumer on the same ten-shard stream, the cost drops to approximately $2,160 per month (plus data charges). As you can see, the per-shard-hour cost dominates, making this a significant expense for multi-consumer scenarios with many shards.

Standard Kinesis pricing, by comparison, charges per shard-hour regardless of how many consumers read the data. With standard polling, that ten-shard stream would cost around $360 per month. The question becomes whether the reduced latency, eliminated contention, and improved throughput are worth the additional cost.

### When Enhanced Fan-Out Makes Economic and Architectural Sense

The decision to use Enhanced Fan-Out isn't simply technical—it's a cost-benefit calculation. There are clear scenarios where EFO is absolutely the right choice, others where standard polling remains optimal, and many gray areas where you need to evaluate your specific requirements.

**Enhanced Fan-Out is strongly justified when:**

You have multiple consumers sharing a shard and contention is already a problem. If you're building an architecture where different internal teams or external partners need independent access to the same data stream, EFO eliminates bandwidth sharing and provides guaranteed throughput to each. The cost of EFO becomes justified as soon as you'd otherwise need to either add more shards (multiplying the cost across all consumers) or suffer degraded performance.

Your application requires low latency as a core functional requirement. Real-time fraud detection, live notifications, time-critical alerting, and similar use cases genuinely benefit from the 70-millisecond latency that EFO provides. If your SLA or user experience depends on quick response times, paying for EFO is an investment in meeting your requirements, not just a nice-to-have optimization.

You're operating at high scale with numerous shards. As your stream grows larger and you need to scale to dozens or hundreds of shards, the per-shard-hour cost of EFO becomes more significant in absolute terms, but so do the benefits of eliminating polling overhead and the operational complexity of managing iterator lifecycles.

**Standard polling remains the right choice when:**

You have a single consumer reading from a stream. There's no contention to eliminate, and the cost of a registered consumer is unjustified. A single polling consumer will perform adequately for most workloads that don't have sub-100-millisecond latency requirements.

Your application has relatively lenient latency tolerance. If you're processing event data for long-term analytics, and records arriving 200 milliseconds later versus 70 milliseconds makes no functional difference, the cost of EFO isn't justified.

You're operating on a constrained budget. If your organization is cost-sensitive and you don't have a specific technical need for EFO's capabilities, standard polling is substantially cheaper.

**For gray-area scenarios, calculate the trade-off:**

Consider the actual cost of additional shards. If you need to add shards specifically to avoid contention under the polling model, the incremental cost of those shards might exceed the cost of EFO. For example, if adding a second consumer would require you to split your stream from five shards to ten shards, you'd be paying double your standard Kinesis costs. In this case, EFO's per-consumer surcharge might be cheaper in absolute terms.

Evaluate the operational impact of latency. Even if your application doesn't have hard latency requirements, reducing latency from 200ms to 70ms might enable better user experiences, faster incident response, or improved decision-making. Calculate whether this value justifies the additional cost in your specific business context.

### Implementation Patterns and Best Practices

Once you've decided Enhanced Fan-Out makes sense for your architecture, several implementation patterns emerge from real-world deployments.

The consumer registration pattern begins with creating a registered consumer before your application attempts to subscribe. This is typically done during infrastructure provisioning, not at application startup. You'd use the AWS CLI, CloudFormation, or the Terraform provider to register consumers as part of your deployment pipeline:

```bash
aws kinesis register-stream-consumer \
    --stream-arn arn:aws:kinesis:us-east-1:123456789012:stream/my-stream \
    --consumer-name my-consumer-app
```

This returns a consumer ARN that your application configuration should reference. Hardcoding the ARN in your application or retrieving it from configuration management (like Systems Manager Parameter Store) are both reasonable patterns.

The subscription management pattern requires your application to handle connection lifecycle properly. HTTP/2 connections can be interrupted by network issues, service updates, or client restarts. Your application should implement reconnection logic that gracefully handles connection drops and resumes reading from where it left off. Most SDK implementations provide built-in reconnection, but you should test failure scenarios to ensure your application recovers appropriately.

The record processing pattern is slightly different from polling because records arrive asynchronously. Rather than pulling a batch of records and processing them synchronously, you're consuming from an event stream. This works well with async/await patterns in languages like Python, JavaScript, or Go. Consider using a queue or buffer pattern if your downstream processing is slower than the rate records arrive, ensuring you don't lose records during temporary processing bottlenecks.

The checkpoint and resumption pattern is important for fault tolerance. When you successfully process a record, you should checkpoint the shard ID and sequence number to durable storage (DynamoDB, a database, or even S3). If your application crashes, you can resume from that checkpoint using `AT_SEQUENCE_NUMBER` rather than having to re-process records or losing your position entirely.

Error handling deserves special attention. The event stream from `SubscribeToShard` can throw exceptions (like `ResourceNotFoundException` if the shard or consumer is deleted). Your code should catch these gracefully, log them appropriately, and implement appropriate retry or fallback logic.

### Monitoring and Observability

Enhanced Fan-Out provides detailed CloudWatch metrics that allow you to monitor consumer health and performance. These metrics are per-consumer per-shard, giving you granular visibility into what's happening across your architecture.

The `GetRecords.IteratorAgeMilliseconds` metric shows how far behind your consumer is from the latest records. Under normal operation with EFO, this should be quite low (typically under a second) because records are pushed as they arrive. If this metric starts climbing, it indicates your consumer is falling behind—either because your processing logic is slow or because the consumer application is restarting frequently.

The `IncomingRecords` metric shows the count of records being read by your consumer. This is useful for capacity planning and for detecting when your stream is receiving unexpected volumes of data.

The `IncomingBytes` metric measures the actual data volume being delivered through your EFO connection. This directly correlates to the per-GB charges, so monitoring this metric helps you understand your EFO costs and detect unexpected traffic patterns.

You should also monitor consumer registration status through the `DescribeStreamConsumer` API. This shows whether a consumer is actively connected and has received heartbeats recently. A consumer that's registered but not currently connected indicates your application may not be running or may be experiencing connectivity issues.

### Troubleshooting Common EFO Issues

In practice, several issues emerge frequently with Enhanced Fan-Out deployments, and understanding how to diagnose and resolve them will save you time.

If your application can't connect to a shard, first verify that the consumer is registered and that you're using the correct consumer ARN. The ARN format is important—it should include the consumer name at the end. Double-check IAM permissions; your application needs `kinesis:SubscribeToShard` permission and `kinesis:DescribeStreamConsumer` to verify the consumer exists.

If records aren't flowing as expected, check whether the shard itself has active data. Use the standard `GetRecords` API as a quick verification that data is actually being put to the stream. Verify that your starting position is correct—if you're starting from `LATEST` and there's no new data arriving, you'll see an empty stream.

If connections are dropping frequently, examine network stability. The HTTP/2 connection is persistent, and network interruptions will cause it to close. Check whether your client is behind a proxy or firewall that might be dropping idle connections. Some proxies have aggressive timeout policies for long-lived connections; you may need to configure them to allow persistent HTTP/2 connections.

If you're seeing higher latencies than expected, first verify that your consumer is actively processing records efficiently. If your code is slow to process each record, records will queue up and latency will increase. Use metrics to distinguish between push latency (how quickly records are delivered by Kinesis) and end-to-end latency (which includes your processing time).

### Comparing EFO to Other Fan-Out Strategies

While Enhanced Fan-Out solves the multi-consumer contention problem elegantly, it's worth understanding how it compares to alternative architectures.

Adding more shards to your stream is the traditional way to increase overall throughput when multiple consumers are involved. If you split a stream from five shards to ten shards, you double the total read capacity available to all consumers combined. However, this approach increases your costs proportionally, and it doesn't improve latency. The standard polling model still applies. Adding shards also increases operational complexity—shard management, repartitioning logic, and iterator management all become more complex.

Using Amazon SQS or SNS as an intermediary fan-out layer is another pattern some architectures employ. You write data from Kinesis to an SQS queue or publish to an SNS topic, and multiple consumers read from those services. This works but adds latency, operational overhead, and additional costs. It's typically chosen when you have other reasons to use those services (like the durability guarantees of SQS or the multi-protocol support of SNS), not primarily for fan-out capabilities.

Lambda directly as a consumer is possible with Kinesis event source mappings. You can configure a Lambda function to be invoked when records arrive in your stream. However, Lambda has its own constraints around concurrency and execution duration, and you're paying per invocation. For high-volume streams, Lambda costs can exceed even EFO costs, and you're still managing the scaling and error handling complexity. Lambda works well for occasional processing, but dedicated applications with EFO are typically more cost-effective and performant for continuous consumption.

Enhanced Fan-Out stands out because it solves the multi-consumer contention problem directly at the Kinesis service level, without adding intermediary services or architectural layers. It's the most purpose-built solution for this specific pattern.

### Future Considerations and Architectural Evolution

As your streaming architecture evolves, keep several considerations in mind for Enhanced Fan-Out deployments.

Consumer scaling should be evaluated carefully. The 20-consumer-per-stream limit is fixed, so if you anticipate needing more than 20 independent logical consumers, you should design for stream multiplication early. This might mean sharding your data by customer, by geographic region, or by data type, with each shard group having its own stream.

Cost optimization becomes increasingly important as you scale. If you have a large number of shards and consumers, the monthly EFO bill can become substantial. Regularly review which consumers are truly active and which might be registered but unused. Implement automated deregistration for stale consumers. Consider whether some consumers might consolidate downstream processing to reduce the number of EFO subscriptions needed.

Hybrid consumption patterns can make sense in many organizations. Some consumers might use EFO for latency-critical use cases, while others use standard polling for less time-sensitive processing. This mixed approach allows you to optimize costs while meeting all requirements.

Integration with AWS services continues to evolve. Lambda consumers, Kinesis Data Analytics, and other managed services may gain EFO support or better integration patterns over time. Stay informed about these developments as they might simplify your architecture or provide cost improvements.

### Conclusion

Kinesis Enhanced Fan-Out fundamentally changes the economics and performance characteristics of multi-consumer streaming architectures. By providing dedicated throughput per consumer through HTTP/2 server push, EFO eliminates the shared bandwidth contention that plagues polling-based consumers while dramatically reducing latency.

The trade-off is cost. Enhanced Fan-Out is significantly more expensive than standard polling, and the per-shard-hour charges can add up quickly in large deployments. The key is recognizing when the technical benefits—low latency, no contention, predictable performance—justify the financial investment. For applications with multiple consumers sharing a stream, latency-critical requirements, or high-volume data processing, EFO is often the right choice. For simpler single-consumer use cases or cost-constrained deployments, standard polling remains appropriate.

The implementation details—registered consumers, the SubscribeToShard API, HTTP/2 event streams, and monitoring—are well-supported by the AWS SDK ecosystem. Most developers can implement EFO with relatively straightforward code changes, though proper error handling and connection management are essential for production robustness.

As you architect streaming applications on AWS, evaluate Enhanced Fan-Out as a core option rather than an afterthought. The combination of reduced latency, eliminated contention, and superior multi-consumer support makes it worth considering from the start of your design process, then making the final cost-benefit decision armed with knowledge of your specific requirements and constraints.
