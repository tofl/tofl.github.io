---
title: "Kinesis Producer Library (KPL) vs PutRecords API: When to Use Each"
---

## Kinesis Producer Library (KPL) vs PutRecords API: When to Use Each

When you're streaming data into Amazon Kinesis Data Streams, you face an immediate architectural decision: should you use the straightforward AWS SDK's PutRecords API to send your records directly, or should you introduce the Kinesis Producer Library (KPL) as an intermediary? This choice has real consequences for cost, latency, throughput, and operational complexity. Understanding when each approach makes sense is crucial for building efficient, scalable streaming applications.

The core tension you're navigating is this: the PutRecords API gives you simplicity and direct control, while the KPL gives you optimization under the hood—but at the cost of added latency and complexity. Neither is universally "better." Instead, your use case, traffic patterns, and performance requirements should drive the decision.

### Understanding Kinesis Pricing and Shard Capacity

Before diving into the technical differences, it's important to understand Kinesis's pricing model, because it's the economic engine behind the KPL's entire value proposition.

Kinesis Data Streams charges you per shard, and each shard provides a guaranteed 1 MB per second ingestion capacity and 1,000 records per second throughput. When you use the PutRecords API, each record you send—no matter how small—counts against both of these limits. If you're sending records that are, say, 100 bytes each, you're using only a tiny fraction of your shard's bandwidth but still consuming one of your 1,000 records-per-second quota.

This is where KPL becomes economically interesting. By aggregating multiple small records into a single larger payload before sending it to Kinesis, KPL helps you saturate your shard's bandwidth capacity and avoid wasting your records-per-second quota. If you can batch ten 100-byte records into one 1 KB aggregate before sending, you've reduced your records-per-second pressure by a factor of ten, which directly reduces the number of shards you need.

### The Kinesis Producer Library: How It Works

The KPL is a client-side library that sits between your application and Kinesis. Rather than sending each record immediately, it buffers records in memory, collects them into batches, and periodically sends those batches as larger aggregated payloads. This buffering and aggregation is transparent to your code—you call the KPL's `addUserRecord()` method, and the library handles the rest asynchronously.

Here's a simplified conceptual flow: your application calls KPL with a record, the KPL buffers it, waits (by default) up to 100 milliseconds or until it has accumulated enough records, then sends an aggregate to Kinesis. On the consuming side, a KCL consumer (Kinesis Client Library) automatically deaggregates the records so your business logic never sees the aggregation—it's a transparent optimization.

This asynchronous architecture is a key feature. When you call `addUserRecord()`, the method returns immediately with a future representing the eventual success or failure of that record's delivery. Your application code doesn't block waiting for Kinesis to acknowledge each record. Instead, the KPL manages retries, batching, and error handling in the background.

### KPL Features in Detail

The KPL bundles several powerful features that work in concert:

**Record Aggregation** is the headline feature. The KPL uses a special aggregation format (defined by AWS) that allows multiple logical records to be packed into a single physical Kinesis record. This format is essential because on the consumption side, the KCL and other deaggregation libraries know how to unwrap it. Without this standardized format, a consumer wouldn't know that one physical record actually contains ten logical records.

**Automatic Batching** works alongside aggregation. The KPL doesn't just aggregate records; it also batches the PutRecord or PutRecords API calls themselves. So you might end up sending fifty aggregates in a single PutRecords request, further reducing API overhead. This is configurable—you can tune the batch size, the maximum buffering time, and the maximum record size before the KPL flushes to Kinesis.

**Automatic Retries** are built in. If a record fails to send due to transient errors (throttling, temporary service unavailability), the KPL will retry with exponential backoff. You don't need to wrap the library in try-catch-retry logic; it's handled for you. This is particularly valuable in bursty traffic patterns where you might briefly exceed your shard's capacity.

**Compression** is optional but powerful. The KPL can compress aggregated records before sending them to Kinesis, reducing bandwidth usage. Since you're already paying per MB ingested, compression directly reduces your cost.

**Asynchronous Processing** means your application isn't blocked while records are batched and sent. Latency-sensitive applications can call `addUserRecord()` and immediately move on, with the library handling delivery in the background.

### The KPL Aggregation Format and Consumer Complexity

Here's where things get interesting from a consumer perspective: the KPL uses a specific binary aggregation format that Kinesis doesn't natively understand. When you send an aggregated record to Kinesis, a consumer reading from the stream sees a single large record, not the ten or a hundred logical records inside it.

This is why AWS provides the Kinesis Client Library (KCL) for Java. The KCL automatically deaggregates KPL records, so your code processes logical records without caring about the aggregation layer. If you're consuming with KCL in Python, Node.js, or Go, the respective language implementations also handle deaggregation.

However, if you're consuming records with the plain AWS SDK (not using KCL), you need to manually deaggregate. AWS provides deaggregation libraries for various languages, but if you're using a language without an official library, you'd need to implement deaggregation yourself by parsing the binary format. This complexity is a significant consideration if your consumer ecosystem is heterogeneous.

Consider this scenario: you have a team using the KPL in Java to produce records, but another team consumes with a custom Lambda function using the SDK directly. That Lambda function will receive aggregated records and needs to know how to unwrap them. This is entirely possible, but it's an additional operational concern that doesn't exist if you use the plain PutRecords API.

### Latency Introduced by KPL Buffering

The KPL introduces buffering latency, and this is the primary trade-off against its benefits. When you send a record via `addUserRecord()`, it doesn't immediately go to Kinesis. Instead, it sits in the KPL's buffer, waiting for one of two conditions to be met: either the buffer reaches a configurable maximum size, or a configurable amount of time (RecordMaxBufferedTime) elapses.

The default RecordMaxBufferedTime is 100 milliseconds. This means that, in the worst case, a record can sit in the buffer for up to 100 ms before being flushed to Kinesis. For low-latency applications, this is non-trivial. If your use case demands records to reach downstream consumers within milliseconds, the KPL's buffering might introduce unacceptable delay.

You can reduce RecordMaxBufferedTime to lower this latency. Setting it to 10 milliseconds instead of 100 milliseconds would reduce maximum buffering latency by 90 percent. However, there's a trade-off: shorter buffering windows mean fewer records per batch, which means less aggregation benefit and potentially higher API costs. It's a tuning lever that depends entirely on your requirements.

For applications that are latency-sensitive but not microsecond-sensitive—say, a real-time analytics pipeline where 50 milliseconds of added latency is acceptable—the KPL's latency profile is often tolerable. For applications where every millisecond matters, or where you have strict SLA requirements, you might choose the simplicity and predictability of the direct SDK approach.

### Language Support and Operational Considerations

The KPL is primarily a Java library, but AWS also provides a C++ implementation. If you're building in Java or using a JVM language like Scala or Kotlin, integrating the KPL is straightforward—it's just a Maven or Gradle dependency.

The C++ version is more complex. The KPL for Java actually wraps a C++ daemon that handles the heavy lifting of buffering, batching, and aggregation. When you add the Java KPL to your application, it starts this daemon process. The Java library communicates with the daemon over a local socket, sending records to be buffered and receiving responses about success or failure.

This architecture is clever—it means the buffering and batching logic is fast and efficient—but it also means you're running an additional process. If you're deploying to containers or serverless environments like Lambda, this adds operational complexity. You need to ensure the daemon is properly initialized, handle process lifecycle, and be aware that it's consuming memory and CPU alongside your application.

For languages outside Java and C++, there's no official KPL. You could use the Java library from Scala or Kotlin, or you could use the AWS SDK directly. Many teams in Python, Go, or Node.js find that the plain SDK approach is simpler than trying to integrate a Java-based library, even when they could theoretically do so.

### Direct SDK PutRecords API Approach

The alternative is to use the AWS SDK's PutRecords API directly. This API allows you to send up to 500 records in a single request, with a maximum payload size of 5 MB. It's synchronous—your code blocks until Kinesis acknowledges the request—and the SDK returns immediately with success or failure information.

The PutRecords API doesn't do aggregation. If you send 500 records of 100 bytes each, you've made a request for 50 KB of data, and you've used 500 of your 1,000 records-per-second quota. The bandwidth utilization might be reasonable, but the records-per-second quota pressure is higher than if you'd aggregated those records before sending.

However, the simplicity is appealing. There's no daemon process, no buffering latency, no consumer-side deaggregation complexity. Your code is straightforward: build a batch of records, call PutRecords, handle the response, move on.

### Practical Code Examples

Let's look at how these approaches differ in practice.

Using the KPL in Java:

```java
import software.amazon.kinesis.producer.KinesisProducer;
import software.amazon.kinesis.producer.KinesisProducerConfiguration;

KinesisProducerConfiguration config = new KinesisProducerConfiguration()
    .setRecordMaxBufferedTime(100);

KinesisProducer producer = new KinesisProducer(config);

// Add a record; this returns immediately
ListenableFuture<UserRecordResult> future = producer.addUserRecord(
    "my-stream",
    "partition-key-" + System.currentTimeMillis(),
    ByteBuffer.wrap("my-data".getBytes())
);

// Optionally, add a callback to handle success or failure
Futures.addCallback(future, new FutureCallback<UserRecordResult>() {
    public void onSuccess(UserRecordResult result) {
        System.out.println("Record sent successfully");
    }
    public void onFailure(Throwable throwable) {
        System.err.println("Failed to send record: " + throwable.getMessage());
    }
});

// Application continues; delivery happens asynchronously
```

Using the SDK directly with PutRecords:

```java
import software.amazon.awssdk.services.kinesis.KinesisClient;
import software.amazon.awssdk.services.kinesis.model.PutRecordsRequest;
import software.amazon.awssdk.services.kinesis.model.PutRecordsResponse;
import software.amazon.awssdk.services.kinesis.model.PutRecordsRequestEntry;

KinesisClient client = KinesisClient.builder().build();

List<PutRecordsRequestEntry> records = new ArrayList<>();
for (int i = 0; i < 100; i++) {
    records.add(PutRecordsRequestEntry.builder()
        .data(SdkBytes.fromString("record-" + i, StandardCharsets.UTF_8))
        .partitionKey("partition-key-" + (i % 10))
        .build());
}

PutRecordsRequest request = PutRecordsRequest.builder()
    .streamName("my-stream")
    .records(records)
    .build();

PutRecordsResponse response = client.putRecords(request);

// Handle response synchronously
if (response.failedRecordCount() > 0) {
    System.out.println("Some records failed; implement retry logic");
}

client.close();
```

The KPL code is asynchronous and fire-and-forget (with optional callbacks), while the SDK code is synchronous and requires you to handle the response immediately.

### Decision Criteria: KPL vs SDK

So when should you reach for the KPL, and when is the plain SDK appropriate?

**Choose the KPL if:** You're sending high volumes of small records (typically under 1 KB) and want to minimize per-shard costs or reduce the number of shards needed. Your application can tolerate the added latency of buffering—typically 50 to 100 milliseconds. You're developing in Java or a JVM language and your consumer ecosystem can handle the aggregation format (or you'll use KCL for consumption). You have bursty traffic patterns and want automatic retry logic without implementing it yourself. The operational overhead of running an additional daemon process is acceptable in your deployment environment.

**Choose the plain SDK if:** Your records are already large (multiple KB) and you're already saturating shard bandwidth. Latency must be minimal and predictable—you can't tolerate the buffering that KPL introduces. You're building in a language where integrating the KPL is awkward or impossible. Your consumers are diverse or non-standard, and handling deaggregation would be complex. You want the simplest possible code path and can handle retries and batching in your application layer. You're deploying to serverless environments like Lambda where process lifecycle management is fraught.

A concrete example: imagine you're building a clickstream processor. Each click event is roughly 500 bytes, and you're receiving around 100 clicks per second. With the plain SDK, you'd use roughly 100 of your 1,000 records-per-second quota per second, meaning you'd comfortably fit within a single shard's capacity. The KPL could batch your clicks into aggregates, potentially allowing you to process twice the volume on the same shard. If you're expecting future growth or operating in a cost-conscious environment, the KPL's investment pays off.

Contrast that with a low-volume data collection scenario where you're sending one 10 KB event every five seconds. You're using maybe 0.2 records per second and 40 KB per second of bandwidth. The KPL adds no real value here—your shard is underutilized anyway, and the buffering latency is an unnecessary complication.

### Configuration and Tuning

If you decide to use the KPL, understanding its configuration options is crucial. The key knobs are:

**RecordMaxBufferedTime** controls the maximum time a record can sit in the buffer. Measured in milliseconds, the default is 100. Lowering this reduces latency but decreases aggregation efficiency.

**RecordsPerBatch** controls how many records the KPL tries to batch together before sending. Higher values mean better aggregation but more memory usage and potentially higher per-request latency.

**MaxRecordSize** specifies the maximum size of a single logical record. Records larger than this are rejected, which is a safety valve to prevent accidentally sending huge individual records.

**RequestTimeout** controls how long the library waits for Kinesis to acknowledge a request. This affects retry behavior—if Kinesis is slow to respond, the KPL might time out and retry even though the request eventually succeeds.

Tuning these is application-specific. A high-frequency, low-latency system might use RecordMaxBufferedTime of 10 and prioritize responsiveness. A batch-oriented system that cares more about throughput than latency might use 500 and maximize aggregation. There's no one-size-fits-all configuration.

### Monitoring and Troubleshooting

With the KPL, you lose some visibility into what's happening between your application code and Kinesis. The library handles buffering, batching, and retries, which is great for simplicity but can make troubleshooting harder if things go wrong.

The KPL provides metrics that you can expose to CloudWatch. Record latency, aggregation metrics, and retry counts are all available. If you're seeing unexpected latency, monitoring these metrics can help you determine whether it's the KPL's buffering, network issues, or throttling.

With the plain SDK, everything is explicit. You see exactly when you send records, how the response looks, and whether there are failures. This transparency can be valuable for debugging, especially during initial development.

### Hybrid Approaches

It's worth noting that you don't have to choose one approach for your entire system. A common pattern is to use the KPL for high-volume producers where efficiency matters, and the plain SDK for lower-volume or latency-critical producers. Both write to the same stream, both can be consumed by the same consumer (especially if using KCL), and both work well together.

### Conclusion

The KPL and the plain SDK PutRecords API represent different points on the trade-off curve between simplicity and efficiency. The KPL shines when you're moving significant volumes of small records and can afford the latency overhead—it can dramatically reduce your per-shard cost and allow you to build scalable systems with fewer shards. The SDK is the right choice when simplicity, minimal latency, or operational ease are paramount.

Neither choice is permanent. As your requirements evolve, you can measure your actual traffic patterns, costs, and latency characteristics, then adjust accordingly. The key is understanding what each tool optimizes for and choosing the one that aligns with your constraints and priorities.
