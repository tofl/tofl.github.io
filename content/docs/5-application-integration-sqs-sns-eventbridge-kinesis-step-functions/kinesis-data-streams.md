---
title: "15. Kinesis Data Streams"
type: docs
weight: 5
---

## Kinesis Data Streams

Modern applications often generate data faster than any single consumer can process it — user clickstreams, IoT sensor readings, application logs, financial transactions. Amazon Kinesis Data Streams [🔗](https://docs.aws.amazon.com/streams/latest/dev/introduction.html) exists to solve exactly this problem: it lets you ingest large volumes of real-time data, durably store it, and allow one or more consumers to process it independently at their own pace. Unlike SQS, where a message is consumed and gone, Kinesis retains records in order for a configurable window, making it ideal for replay, auditing, and parallel processing by multiple consumers.

### Shards — The Core Capacity Unit

A Kinesis stream is made up of **shards** [🔗](https://docs.aws.amazon.com/streams/latest/dev/key-concepts.html), and every capacity and throughput decision starts here. Each shard provides:

- **1 MB/s ingestion** (write) throughput, up to 1,000 records/s
- **2 MB/s read** throughput (shared across all standard consumers on that shard)

You provision the number of shards when creating a stream, and you can resize by splitting or merging shards later. A stream with 5 shards can ingest up to 5 MB/s and serve up to 10 MB/s of reads. If your consumers start falling behind, adding shards is your scaling lever.

**On-demand mode** [🔗](https://docs.aws.amazon.com/streams/latest/dev/how-do-i-size-a-stream.html) is also available — Kinesis automatically manages shard count based on observed throughput, removing the need to capacity-plan upfront. This is convenient for variable workloads but costs more than provisioned mode.

### Records, Partition Keys, and Shard Assignment

Producers write **records** into the stream. Each record contains:

- **Data blob** — up to 1 MB of arbitrary bytes (base64-encoded in transit)
- **Partition key** — a string chosen by the producer
- **Sequence number** — assigned by Kinesis after ingestion, unique within a shard

The partition key is hashed (MD5) to determine which shard a record lands in. Records with the same partition key always go to the same shard, which preserves ordering for that key. For example, in a user event stream you might use `user_id` as the partition key — all events for a given user arrive in order on the same shard. To distribute load evenly, choose high-cardinality partition keys or add random suffixes where strict ordering isn't needed.

### Producers

There are three main ways to write data into a Kinesis stream:

- **AWS SDK (`PutRecord` / `PutRecords`)** [🔗](https://docs.aws.amazon.com/kinesis/latest/APIReference/API_PutRecords.html) — direct API calls, suitable for most application code. `PutRecords` batches up to 500 records per request, improving throughput and reducing costs.
- **Kinesis Producer Library (KPL)** [🔗](https://docs.aws.amazon.com/streams/latest/dev/developing-producers-with-kpl.html) — a higher-level library that handles batching, compression, and automatic retries. It aggregates small records into larger ones (aggregation) to maximize shard throughput. Best for high-throughput producer applications.
- **Kinesis Agent** [🔗](https://docs.aws.amazon.com/streams/latest/dev/writing-with-agents.html) — a Java-based agent installable on EC2 or on-premises servers. It monitors log files and automatically streams new entries. Useful for log ingestion without writing producer code.

### Consumers

Once data is in the stream, consumers read and process it. Kinesis supports several consumer models:

- **AWS SDK (`GetRecords`)** — the classic pull model. Each shard can serve up to 2 MB/s total across all consumers using this method, so multiple consumers share that budget and may see throughput degradation as you add more.
- **Kinesis Client Library (KCL)** [🔗](https://docs.aws.amazon.com/streams/latest/dev/developing-consumers-with-kcl.html) — a higher-level consumer library that handles shard enumeration, checkpointing (via DynamoDB), and failover. Each worker in a KCL application is assigned one or more shards; if a worker dies, another picks up its shards. KCL is the recommended approach for custom consumer applications that need reliability and horizontal scaling.
- **AWS Lambda** — configured as an event source mapping on the stream. Lambda polls the stream, batches records per shard, and invokes your function. You configure batch size and batch window. Lambda scales by adding concurrent invocations, one per shard.
- **Kinesis Data Firehose** — covered below.

#### Enhanced Fan-Out

Standard consumers share the 2 MB/s per-shard read throughput. If you have multiple consumers that each need full throughput, **Enhanced Fan-Out (EFO)** [🔗](https://docs.aws.amazon.com/streams/latest/dev/enhanced-consumers.html) is the answer. Each registered EFO consumer gets a **dedicated 2 MB/s per shard**, delivered via HTTP/2 push rather than polling. This eliminates read contention entirely and reduces latency. EFO incurs additional cost, so use it when you have multiple latency-sensitive consumers on the same stream.

### Data Retention

By default, records are retained for **24 hours**. You can extend this up to **365 days** [🔗](https://docs.aws.amazon.com/streams/latest/dev/kinesis-extended-retention.html). Longer retention allows you to reprocess historical data, recover from consumer bugs by replaying, or run new consumers against existing data without re-ingesting. Retention beyond 7 days incurs additional storage costs.

### Shard Splitting and Merging

As your traffic grows or shrinks, you can **split** a shard into two (doubling its capacity) or **merge** two adjacent shards into one (halving capacity and cost). [🔗](https://docs.aws.amazon.com/streams/latest/dev/kinesis-using-sdk-java-resharding.html) Note that after a reshard, the original shard still exists in a `CLOSED` state until all its data has been read — your consumers must handle both parent and child shards during transition. KCL handles this automatically; custom SDK consumers must account for it.

### Kinesis Data Firehose

Kinesis Data Firehose [🔗](https://docs.aws.amazon.com/firehose/latest/dev/what-is-this-service.html) is a fully managed delivery service that reads from a Kinesis Data Stream (or accepts records directly) and continuously loads data into a destination. Supported destinations include:

- **Amazon S3** — batched, optionally compressed and partitioned by time prefix
- **Amazon Redshift** — via an intermediate S3 `COPY` operation
- **Amazon OpenSearch Service** — for search and analytics
- **Third-party partners** — Datadog, Splunk, MongoDB, and others

Firehose handles buffering, batching, compression, encryption, and delivery retries automatically. You can optionally attach a Lambda function to transform records in flight (e.g., parsing JSON, enriching fields, filtering). There's no infrastructure to manage and no shard model — you pay per GB ingested.

A common pattern is: application → **Kinesis Data Streams** (real-time processing by Lambda or KCL) → **Firehose** (archival to S3 for long-term storage and batch analytics). This separates real-time processing from durable storage concerns.

### Kinesis vs SQS — Choosing the Right Tool

Both Kinesis and SQS decouple producers from consumers, but they serve different use cases:

| Concern | Kinesis Data Streams | SQS |
|---|---|---|
| Ordering | Per shard (by partition key) | FIFO queue only |
| Multiple consumers | Yes — all consumers read the same data | No — each message consumed once |
| Replay | Yes — within retention window | No |
| Throughput model | Shard-based, provisioned | Effectively unlimited, managed |
| Latency | ~200ms | Near real-time (ms) |
| Best for | Event streaming, log ingestion, analytics pipelines | Task queues, workload decoupling, job distribution |

Use Kinesis when you need **ordered, replayable streams** consumed by **multiple independent consumers**. Use SQS when you need **reliable, at-least-once delivery** of discrete tasks to a pool of workers where each task is processed exactly by one worker.