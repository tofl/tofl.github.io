---
title: "Choosing Between Kinesis Data Streams and Kinesis Data Firehose"
---

## Choosing Between Kinesis Data Streams and Kinesis Data Firehose

Real-time data ingestion is a cornerstone of modern AWS architectures, but not all real-time use cases are created equal. AWS offers two closely related yet fundamentally different services under the Kinesis umbrella: Kinesis Data Streams and Kinesis Data Firehose. While their names suggest a family relationship, their operational characteristics, pricing models, and ideal use cases diverge significantly. Understanding when to choose each—or when to use them together—is essential for designing scalable, cost-effective data pipelines.

The confusion between these two services is understandable. Both sit at the front door of your data architecture, both handle streaming data, and both integrate with other AWS services. Yet making the wrong choice can leave you either paying for unused capacity, struggling with operational overhead, or missing latency requirements. This article will equip you with a clear mental model for selecting the right service.

### Understanding Kinesis Data Streams: The Flexible Foundation

Kinesis Data Streams is the foundational building block of AWS's real-time data processing ecosystem. Think of it as a highly scalable, durable message queue purpose-built for real-time analytics and streaming applications. Unlike traditional message queues, Kinesis Streams is designed specifically for scenarios where you need to ingest massive volumes of data continuously and process it with minimal latency.

At its core, Kinesis Data Streams organizes data into shards. Each shard provides a fixed throughput capacity: one shard supports up to 1,000 records per second or 1 MB per second of data ingestion. If you need higher throughput, you add more shards. This shard-based architecture gives you explicit control over your capacity—you're essentially provisioning exactly what you need, which translates directly into your costs.

The data you send to Kinesis Streams sits there, available for consumption, for a default of 24 hours. You can extend this retention period up to 365 days if your use case demands it. This retention window is powerful because it means your data is replayable. If a consumer crashes, you can replay the stream from where it left off. If you want to reprocess historical data with a new algorithm, it's sitting there waiting. This replayability is a defining characteristic that distinguishes Streams from Firehose.

Consuming data from Kinesis Streams requires you to write consumer applications. These consumers explicitly request records from the stream using the GetRecords API, and they're responsible for managing their own checkpointing and error handling. You might use the Kinesis Client Library (KCL) to simplify this, or the newer Enhanced Fan-Out feature with subscriptions, which pushes data to consumers rather than requiring them to pull it. This flexibility is both a strength and a responsibility—you have fine-grained control, but you own the operational burden.

The latency characteristics of Kinesis Streams are near real-time, typically in the range of 200 milliseconds from the time a record is added to the stream until it's available for consumption. For many applications—fraud detection, real-time analytics dashboards, recommendation systems—this sub-second latency is exactly what you need.

Pricing for Kinesis Streams is straightforward but consumption-based. You pay for the number of shards you provision, regardless of whether you're using all their capacity. You also pay for each million PUT requests and for data transferred out through Enhanced Fan-Out. This model works well when you have predictable, sustained traffic, but it can become expensive if your traffic is bursty or variable.

### Understanding Kinesis Data Firehose: The Managed Delivery Service

Kinesis Data Firehose takes a different philosophical approach. Rather than giving you low-level control over how data flows and how it's consumed, Firehose abstracts away those details and focuses on one primary goal: reliably delivering your data to a destination.

Firehose's supported destinations include Amazon S3, Amazon Redshift, Amazon OpenSearch Service, and third-party destinations like Splunk, Datadog, or New Relic. The service is fully managed—you don't write consumer code, you don't manage shards, and you don't worry about scaling. You point your data at Firehose, tell it where to send the data, and Firehose handles the rest.

The delivery mechanism is buffered. Firehose doesn't immediately send every record to its destination. Instead, it buffers records based on two parameters: a size threshold (default 128 MB for S3) and a time threshold (default 60 seconds minimum). When either threshold is reached, Firehose flushes the buffered records to the destination. This buffering approach is fundamentally different from Streams' immediate availability, and it introduces a minimum latency. Even with the smallest buffer settings, you're looking at a minimum 60-second window before data appears in your destination. In practice, with realistic buffer sizes and flush intervals, expect latencies in the range of several seconds to minutes.

This buffering strategy exists for a reason: it batches records together, which is far more cost-effective and efficient when writing to destinations like S3 or Redshift. Instead of making millions of individual requests, Firehose batches them into fewer, larger requests.

Data delivered by Firehose doesn't sit in Firehose itself waiting for reprocessing. Once Firehose successfully delivers data to your destination, it's gone from Firehose. If you need to replay or reprocess data, you replay it from the destination. This design choice simplifies the service and reduces costs—you're not paying for storage of data that's already been delivered.

The pricing model for Firehose is consumption-based in a different way than Streams. You pay for the volume of data ingested—specifically, per gigabyte of data delivered to the destination. There's no per-request charge and no shard provisioning. This makes Firehose extremely cost-effective for sustained, high-volume data flows where you're primarily concerned with moving data efficiently.

### Latency: A Critical Differentiator

The latency difference between these two services deserves special attention because it's often the deciding factor in architectural choices.

Kinesis Data Streams delivers records with approximately 200 milliseconds of latency, sometimes referred to as "near real-time." This is because records are immediately available for consumption once they're added to the stream. If you're building a fraud detection system that needs to flag suspicious transactions as they occur, or a stock trading algorithm that reacts to market changes, this latency profile is essential.

Kinesis Data Firehose, by contrast, has a minimum latency determined by its buffering strategy. The documented minimum time before records are flushed to the destination is 60 seconds. In real-world scenarios, depending on your buffer size configuration and data volume, you might see latencies ranging from a minute to several minutes. For some use cases—data warehouse loading, log aggregation for later analysis, bulk data exports—this latency is entirely acceptable. For others, it's disqualifying.

Understanding this difference prevents a common mistake: choosing Firehose for a use case that requires immediate action on incoming data, then wondering why your system feels sluggish.

### Architectural Patterns and When to Combine Both

Here's where things get interesting. These two services aren't necessarily competitors. In fact, many sophisticated AWS architectures combine them in a pattern that leverages the strengths of each.

The canonical pattern looks like this: Kinesis Data Streams serves as the central hub where all data lands initially. The stream provides the low-latency characteristics you need for immediate, real-time processing. Multiple consumers read from this stream—perhaps one consumer performs fraud detection (needing near-real-time latency), another builds an in-memory cache of recent events, and a third consumer is a Kinesis Firehose delivery stream that archives all the data to S3 for long-term storage and analysis.

This hybrid approach gives you the best of both worlds. You get the low latency and flexibility of Streams for real-time analytics and decision-making, while Firehose handles the persistent storage efficiently and at scale. It's common to see this pattern in financial services, IoT platforms, and high-throughput event processing systems.

Firehose also supports transformation through Lambda functions. As records flow through Firehose, you can apply transformations—filtering records, enriching them, reformatting them—before they land in the destination. This adds flexibility without requiring you to build a separate consumer application.

### Real-World Use Cases: When to Choose Each

**Choose Kinesis Data Streams when:**

Your application needs to consume data with very low latency and act on it immediately. Real-time fraud detection is a classic example—when a transaction occurs, you need to analyze it against recent patterns and make a decision within hundreds of milliseconds. Similarly, if you're building real-time dashboards, recommendation engines, or monitoring systems that alert on anomalies, Streams' 200-millisecond latency characteristic is often essential.

You need the ability to replay or reprocess data. Imagine you deploy a new analytics algorithm and want to backtest it against the last week of historical data. With Kinesis Streams, that data is still there in the stream (assuming you've configured sufficient retention). With Firehose, you'd need to have already archived the raw data to S3 to replay it.

You have multiple, diverse consumers that each need different views of the same data. One team might want to process transactions for fraud, another for reconciliation, a third for machine learning feature engineering. Kinesis Streams makes this fan-out pattern natural and efficient.

Your data volume is unpredictably bursty, and you prefer not to pay for idle provisioned capacity. With Streams' on-demand pricing mode (available as an alternative to provisioned mode), you pay only for what you use, though it costs more per request than provisioned mode.

**Choose Kinesis Data Firehose when:**

Your primary goal is reliably delivering data to a data warehouse, data lake, or analytics platform. If you're running a SaaS application and want to archive all user interactions to S3 for later analysis, Firehose is the simplest path. Similarly, if you need to load data into Redshift for analytics, Firehose handles batching and formatting automatically.

You want to minimize operational complexity and the need for custom code. Firehose is genuinely serverless—you don't write consumer code, you don't manage shards, and you don't think about scaling. You configure the destination and data transformation rules, then Firehose handles the rest.

You have sustained, high-volume data flows and want to optimize costs. Firehose's per-gigabyte pricing is extremely efficient when you're moving terabytes of data monthly.

Your use case doesn't require immediate, millisecond-scale latency. If data arriving 5 or 60 minutes later is acceptable, Firehose's buffering approach isn't a limitation—it's actually an advantage that reduces costs.

You're integrating with third-party monitoring or analytics platforms. Firehose has native integrations with services like Splunk, Datadog, and New Relic, making it trivial to set up log shipping and metrics collection.

### Pricing Considerations and Cost Optimization

Understanding the pricing models helps clarify the economic trade-offs between these services.

Kinesis Data Streams pricing depends on your capacity mode. In provisioned mode, you pay for each shard hour—approximately $0.036 per shard hour (prices vary by region). If you provision four shards to handle your peak traffic, you're paying for those four shards 24/7, even during quiet periods. You also pay $0.014 per million PUT requests and $0.014 per million GET requests. For high-throughput scenarios, the per-request charges are negligible compared to shard costs.

In on-demand mode, available as an alternative, you pay $0.40 per million PUT requests and $0.40 per million GET requests (again, prices vary by region). On-demand pricing is higher per request but eliminates the need to forecast capacity. If your traffic pattern is highly variable, on-demand can be more cost-effective. If your traffic is steady and predictable, provisioned mode is usually cheaper.

Kinesis Data Firehose pricing is simpler: approximately $0.029 per gigabyte of data delivered (prices vary by region and destination). There's no per-request charge, no provisioning, no hidden costs. If you're moving 1 TB of data per day, you know almost exactly what your monthly bill will be.

For cost comparison, imagine a scenario where you're ingesting 100 MB per second continuously. That's roughly 8.6 TB per day. With Firehose, you'd pay about $250 per month (8.6 TB/day × 30 days × $0.029/GB). With Kinesis Streams in provisioned mode, 100 MB/second requires 100 shards (since each shard handles 1 MB/second). At 100 shards × $0.036/hour × 730 hours/month, you'd pay about $2,628 per month. However, if your traffic is bursty and averages much lower, the per-request pricing of on-demand Streams might be more efficient.

The architectural choice between Streams and Firehose often involves this cost-benefit analysis, but it's inseparable from the latency and operational requirements of your use case.

### Making the Decision: A Practical Framework

When you're designing a new data pipeline or troubleshooting an existing one, use this decision framework:

Start with latency requirements. If you need sub-second decision-making or real-time alerting, Kinesis Data Streams is essentially mandatory. If your use case can tolerate latencies measured in minutes, Firehose is immediately attractive. The 60-second minimum buffer in Firehose is a hard constraint to understand.

Next, consider operational complexity. Are you comfortable writing and maintaining consumer applications, managing shard scaling, and handling failure scenarios? If not, Firehose's fully managed model is compelling. If you need fine-grained control and are comfortable with that responsibility, Streams provides it.

Evaluate your destination. If you're loading into S3, Redshift, or a supported third-party service, Firehose has native integrations that minimize work. If your destination is custom or unusual, Streams with a custom consumer might be necessary.

Consider data replay needs. If you might need to reprocess historical data with new business logic, Streams' retention window is valuable. If your use case processes data once and moves on, Firehose's simpler model works fine.

Finally, analyze costs in the context of your specific traffic patterns. For sustained, predictable, high-volume flows, Firehose is almost always cheaper. For bursty or variable traffic, the calculation is more nuanced.

Many teams find that the Streams + Firehose combination solves both problems elegantly. The slightly higher infrastructure cost is offset by the operational simplicity of having each service do what it does best.

### Key Differences at a Glance

Kinesis Data Streams is optimized for real-time, event-driven applications where consumers need immediate access to data and the ability to replay it. It requires consumer code and active management but provides unmatched flexibility and near-instantaneous latency.

Kinesis Data Firehose is optimized for reliable, scalable delivery of data to persistent storage and analytics platforms. It's fully managed, requires no consumer code, and is cost-effective for high-volume sustained flows, but it introduces buffering delays and data doesn't persist in the service itself.

Neither service is universally better—they're purpose-built for different problems. The right choice depends on your specific requirements around latency, operational overhead, cost, and architectural patterns.

### Conclusion

Choosing between Kinesis Data Streams and Kinesis Data Firehose isn't a matter of one being superior to the other. Instead, each service excels in different scenarios, and many sophisticated architectures benefit from using both in tandem.

Kinesis Data Streams is your tool for real-time, event-driven processing where low latency and data replay are essential. It puts you in control and gives you the flexibility to build any consumer pattern you need, though that flexibility comes with operational responsibility.

Kinesis Data Firehose is your tool for reliably moving high volumes of data to persistent destinations with minimal operational overhead. It trades immediate latency for simplicity, cost-efficiency, and peace of mind.

As you design your data pipelines, let your requirements guide you. Start by asking whether you need millisecond-level responsiveness and data replay. If yes, Streams is foundational. Ask whether you need to reliably load data into a destination with minimal operational burden. If yes, Firehose is your answer. And consider whether combining both in the canonical Streams + Firehose pattern solves your problem elegantly by giving you real-time processing where needed and efficient, managed delivery where needed.

Understanding these trade-offs—latency, operational complexity, cost, and persistence—will serve you well whether you're building a fraud detection system, a data lake, a real-time analytics platform, or anything in between.
