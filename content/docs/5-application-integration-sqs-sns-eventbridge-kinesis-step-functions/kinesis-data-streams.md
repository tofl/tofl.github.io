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

{{< qcm >}}
[
{
"question": "A company is building a real-time analytics pipeline that ingests user clickstream events. Multiple independent teams need to consume the same events simultaneously for different purposes (fraud detection, personalization, and reporting). Which AWS service is most appropriate for this use case?",
"answers": [
{
"answer": "Amazon SQS Standard Queue",
"isCorrect": false,
"explanation": "SQS messages are consumed once and deleted — multiple consumers cannot independently read the same message. SQS is designed for task queues, not multi-consumer event streaming."
},
{
"answer": "Amazon Kinesis Data Streams",
"isCorrect": true,
"explanation": "Kinesis retains records for a configurable window and allows all consumers to read the same data independently at their own pace, making it ideal for multiple concurrent consumers on the same event stream."
},
{
"answer": "Amazon SQS FIFO Queue",
"isCorrect": false,
"explanation": "FIFO queues guarantee ordering but still follow the same single-consumer model — each message is consumed once. They are not designed for multi-consumer event streaming."
},
{
"answer": "Amazon Kinesis Data Firehose",
"isCorrect": false,
"explanation": "Firehose is a delivery service targeting destinations like S3 or Redshift. It does not support multiple independent consumers processing the same records in real time."
}
]
},
{
"question": "A Kinesis Data Stream is configured with 4 shards. What is the maximum ingestion (write) throughput for this stream?",
"answers": [
{
"answer": "2 MB/s",
"isCorrect": false,
"explanation": "2 MB/s is the read throughput per shard, not the write throughput. With 4 shards, write capacity is 4 × 1 MB/s = 4 MB/s."
},
{
"answer": "4 MB/s",
"isCorrect": true,
"explanation": "Each shard provides 1 MB/s of ingestion throughput. A stream with 4 shards can therefore ingest up to 4 MB/s in total."
},
{
"answer": "8 MB/s",
"isCorrect": false,
"explanation": "8 MB/s would be the total read throughput (4 shards × 2 MB/s), not the write throughput."
},
{
"answer": "4,000 records/s",
"isCorrect": false,
"explanation": "Each shard supports up to 1,000 records/s for writes, so 4 shards allow up to 4,000 records/s — but the question asks for MB/s throughput, and 4 MB/s is the correct answer for that metric."
}
]
},
{
"question": "A developer is writing records to a Kinesis Data Stream using `user_id` as the partition key. What is the effect of this choice?",
"answers": [
{
"answer": "All records are distributed evenly across all shards regardless of user.",
"isCorrect": false,
"explanation": "Partition keys are hashed (MD5) to determine the target shard. The same partition key always maps to the same shard, so records for the same user are NOT spread across shards."
},
{
"answer": "All events for a given user are routed to the same shard, preserving per-user ordering.",
"isCorrect": true,
"explanation": "Kinesis hashes the partition key to determine the shard. Using `user_id` ensures all events for a given user land on the same shard in order. This guarantees per-user ordering at the cost of potential hot shards if traffic is skewed."
},
{
"answer": "Records are replicated to all shards for redundancy.",
"isCorrect": false,
"explanation": "Kinesis does not replicate records across shards. Each record is assigned to exactly one shard based on the MD5 hash of its partition key."
},
{
"answer": "The sequence number is derived from the user_id.",
"isCorrect": false,
"explanation": "Sequence numbers are assigned by Kinesis after ingestion and are unique within a shard. They are not derived from the partition key."
}
]
},
{
"question": "A team uses the Kinesis Producer Library (KPL) to write data to a stream. Which capabilities does KPL provide that the raw `PutRecord` API does not? (Select TWO)",
"answers": [
{
"answer": "Automatic record aggregation to maximize shard throughput",
"isCorrect": true,
"explanation": "KPL aggregates multiple small records into a single Kinesis record, allowing producers to exceed the 1,000 records/s per-shard limit in terms of logical records while staying within the 1 MB/s and 1,000 API-record/s limits."
},
{
"answer": "Built-in batching and automatic retries",
"isCorrect": true,
"explanation": "KPL handles batching (grouping multiple records into a single API call) and retries failed records automatically, reducing the amount of producer-side error handling code required."
},
{
"answer": "Ability to write records larger than 1 MB",
"isCorrect": false,
"explanation": "The 1 MB per-record size limit is enforced by Kinesis regardless of the producer. KPL does not bypass this limit."
},
{
"answer": "Fan-out delivery to multiple consumers simultaneously",
"isCorrect": false,
"explanation": "Fan-out is a consumer-side feature (Enhanced Fan-Out). KPL is a producer library and has no control over how many consumers read the stream."
}
]
},
{
"question": "An operations team wants to stream new entries from application log files on EC2 instances into Kinesis Data Streams without writing any producer code. Which option should they use?",
"answers": [
{
"answer": "Kinesis Client Library (KCL)",
"isCorrect": false,
"explanation": "KCL is a consumer-side library used to read and process records from a stream. It is not used for log file ingestion."
},
{
"answer": "Kinesis Agent",
"isCorrect": true,
"explanation": "Kinesis Agent is a Java-based agent installable on EC2 or on-premises servers. It monitors log files and automatically streams new entries to Kinesis Data Streams without requiring custom producer code."
},
{
"answer": "AWS SDK PutRecords API",
"isCorrect": false,
"explanation": "PutRecords requires writing application code to read the log files and call the API. The team specifically wants to avoid writing producer code."
},
{
"answer": "Kinesis Data Firehose with a Lambda transform",
"isCorrect": false,
"explanation": "Firehose can receive data but does not monitor local log files on EC2 instances. Kinesis Agent is the purpose-built solution for this scenario."
}
]
},
{
"question": "A Kinesis Data Stream has 3 shards and uses standard (polling) consumers. Three separate consumer applications each use `GetRecords` to read from the stream. What read throughput does each consumer receive per shard?",
"answers": [
{
"answer": "2 MB/s per shard per consumer",
"isCorrect": false,
"explanation": "2 MB/s per shard is the total shared budget for all standard consumers. With three consumers, the throughput is divided among them."
},
{
"answer": "Approximately 667 KB/s per shard per consumer, as the 2 MB/s budget is shared",
"isCorrect": true,
"explanation": "Standard consumers share the 2 MB/s per-shard read throughput. With three consumers polling the same shard, each receives roughly 2 MB/s ÷ 3 ≈ 667 KB/s, potentially causing throughput degradation."
},
{
"answer": "1 MB/s per shard per consumer",
"isCorrect": false,
"explanation": "1 MB/s is the write (ingestion) throughput per shard, not the read throughput. Read throughput is 2 MB/s shared."
},
{
"answer": "6 MB/s in total, as consumers read in parallel",
"isCorrect": false,
"explanation": "Standard consumers do not get additive throughput. The 2 MB/s per shard is a shared ceiling regardless of how many standard consumers are reading."
}
]
},
{
"question": "A company has four latency-sensitive consumer applications that must each receive the full read throughput from a Kinesis stream. Which feature should they enable?",
"answers": [
{
"answer": "Increase the shard count to 4",
"isCorrect": false,
"explanation": "Adding shards increases write capacity and distributes data, but does not give each consumer dedicated per-shard read throughput. Standard consumers would still share the budget."
},
{
"answer": "Enhanced Fan-Out (EFO)",
"isCorrect": true,
"explanation": "Enhanced Fan-Out gives each registered consumer a dedicated 2 MB/s per shard via HTTP/2 push, eliminating read contention between consumers. It is the correct solution when multiple latency-sensitive consumers need full throughput."
},
{
"answer": "Increase data retention to 7 days",
"isCorrect": false,
"explanation": "Data retention controls how long records are available for replay. It has no impact on concurrent read throughput for multiple consumers."
},
{
"answer": "Use the Kinesis Agent on each consumer host",
"isCorrect": false,
"explanation": "Kinesis Agent is a producer tool for streaming log files. It is not used to improve consumer read throughput."
}
]
},
{
"question": "A developer needs to build a reliable consumer application that automatically handles shard enumeration, checkpointing, and failover when a worker instance crashes. Which consumer approach is recommended?",
"answers": [
{
"answer": "AWS SDK GetRecords with manual DynamoDB checkpointing",
"isCorrect": false,
"explanation": "While technically feasible, this requires significant custom code to replicate what KCL provides out of the box. It is not the recommended approach."
},
{
"answer": "Kinesis Client Library (KCL)",
"isCorrect": true,
"explanation": "KCL handles shard enumeration, checkpointing (via DynamoDB), and automatic failover. If a worker dies, KCL redistributes its shards to other workers. It is the recommended approach for custom consumer applications requiring reliability and horizontal scaling."
},
{
"answer": "Kinesis Data Firehose",
"isCorrect": false,
"explanation": "Firehose is a managed delivery service to destinations like S3 or Redshift. It is not a general-purpose consumer framework for custom processing logic."
},
{
"answer": "Kinesis Producer Library (KPL)",
"isCorrect": false,
"explanation": "KPL is a producer-side library. It has nothing to do with consuming or processing records from a stream."
}
]
},
{
"question": "A Lambda function is configured as an event source mapping for a Kinesis Data Stream with 6 shards. How does Lambda scale its invocations to process the stream?",
"answers": [
{
"answer": "Lambda invokes a single function instance that polls all shards sequentially.",
"isCorrect": false,
"explanation": "Lambda scales by parallelizing across shards, not by polling them sequentially with a single instance."
},
{
"answer": "Lambda scales by adding concurrent invocations, one per shard.",
"isCorrect": true,
"explanation": "When using Kinesis as an event source, Lambda polls the stream and invokes one concurrent function execution per shard. With 6 shards, up to 6 concurrent Lambda invocations can run simultaneously."
},
{
"answer": "Lambda scales based on the number of records per batch, regardless of shard count.",
"isCorrect": false,
"explanation": "While batch size is configurable, the concurrency model is shard-based. Lambda's parallelism is bounded by the number of shards, not the batch size."
},
{
"answer": "Lambda automatically splits shards to match the reserved concurrency limit.",
"isCorrect": false,
"explanation": "Lambda cannot modify Kinesis shard configuration. Shard splitting is a separate operation performed on the stream itself."
}
]
},
{
"question": "What is the default data retention period for Amazon Kinesis Data Streams, and what is the maximum retention period available?",
"answers": [
{
"answer": "Default: 24 hours; Maximum: 7 days",
"isCorrect": false,
"explanation": "The default is 24 hours, but the maximum retention period is 365 days, not 7 days. Retention beyond 7 days incurs additional storage costs."
},
{
"answer": "Default: 7 days; Maximum: 365 days",
"isCorrect": false,
"explanation": "The default retention period is 24 hours, not 7 days."
},
{
"answer": "Default: 24 hours; Maximum: 365 days",
"isCorrect": true,
"explanation": "Kinesis Data Streams retains records for 24 hours by default. This can be extended up to 365 days, enabling replay, auditing, and running new consumers against historical data. Retention beyond 7 days incurs additional cost."
},
{
"answer": "Default: 24 hours; Maximum: 30 days",
"isCorrect": false,
"explanation": "The maximum retention period is 365 days, not 30 days."
}
]
},
{
"question": "A Kinesis Data Stream shard is split into two child shards. What happens to the original (parent) shard?",
"answers": [
{
"answer": "The parent shard is immediately deleted.",
"isCorrect": false,
"explanation": "The parent shard is not deleted immediately. It remains in a CLOSED state so that consumers can finish reading any records that were written before the split."
},
{
"answer": "The parent shard enters a CLOSED state and remains until all its data has been consumed.",
"isCorrect": true,
"explanation": "After a split, the parent shard moves to CLOSED state. Consumers must read the remaining data from the parent before reading from the child shards. KCL handles this automatically; custom SDK consumers must handle this transition explicitly."
},
{
"answer": "The parent shard continues to accept new writes in parallel with the child shards.",
"isCorrect": false,
"explanation": "A CLOSED shard no longer accepts new writes. All new records are routed to the child shards after the split."
},
{
"answer": "Records on the parent shard are automatically migrated to the child shards.",
"isCorrect": false,
"explanation": "Kinesis does not migrate existing records from parent to child shards. The parent retains its records until they expire or are consumed."
}
]
},
{
"question": "Which of the following are valid destinations for Kinesis Data Firehose? (Select TWO)",
"answers": [
{
"answer": "Amazon S3",
"isCorrect": true,
"explanation": "S3 is a primary Firehose destination. Firehose delivers data in batches, optionally with compression and time-based partitioning."
},
{
"answer": "Amazon DynamoDB",
"isCorrect": false,
"explanation": "DynamoDB is not a supported Firehose destination. Firehose supports S3, Redshift (via S3 COPY), OpenSearch, and third-party partners like Datadog and Splunk."
},
{
"answer": "Amazon Redshift",
"isCorrect": true,
"explanation": "Redshift is a supported destination. Firehose first delivers data to an intermediate S3 bucket, then issues a COPY command to load it into Redshift."
},
{
"answer": "Amazon RDS",
"isCorrect": false,
"explanation": "Amazon RDS is not a supported Firehose destination. Firehose is designed for analytical and search destinations, not relational databases."
}
]
},
{
"question": "A developer wants to transform records in flight as they pass through Kinesis Data Firehose — for example, parsing JSON fields and enriching each record before it lands in S3. What is the correct approach?",
"answers": [
{
"answer": "Use a KCL consumer application to transform records before forwarding to Firehose.",
"isCorrect": false,
"explanation": "While technically possible to chain services, Firehose natively supports attaching a Lambda function for in-flight transformation. No additional consumer layer is needed."
},
{
"answer": "Attach an AWS Lambda function to the Firehose delivery stream for record transformation.",
"isCorrect": true,
"explanation": "Firehose supports attaching a Lambda function that is invoked to transform records in flight before delivery. This is the purpose-built mechanism for use cases like JSON parsing, field enrichment, or filtering."
},
{
"answer": "Enable Enhanced Fan-Out on the Firehose stream.",
"isCorrect": false,
"explanation": "Enhanced Fan-Out is a Kinesis Data Streams consumer feature. It does not apply to Firehose and does not enable record transformation."
},
{
"answer": "Configure a Firehose processing rule using AWS Step Functions.",
"isCorrect": false,
"explanation": "Firehose does not integrate with Step Functions for in-flight transformation. Lambda is the supported transformation mechanism."
}
]
},
{
"question": "A team is deciding between Amazon Kinesis Data Streams and Amazon SQS for a new workload. They need each job to be processed by exactly one worker from a pool of consumers, with no ordering requirement and no need to replay messages. Which service best fits this use case?",
"answers": [
{
"answer": "Amazon Kinesis Data Streams in on-demand mode",
"isCorrect": false,
"explanation": "Kinesis is designed for ordered, replayable event streaming consumed by multiple independent consumers. For single-worker task distribution with no replay need, SQS is more appropriate."
},
{
"answer": "Amazon SQS Standard Queue",
"isCorrect": true,
"explanation": "SQS is the right choice for task queues where each message is processed by exactly one worker. It provides reliable at-least-once delivery, effectively unlimited throughput, and requires no shard management."
},
{
"answer": "Amazon Kinesis Data Firehose",
"isCorrect": false,
"explanation": "Firehose is a delivery service to destinations like S3 or Redshift, not a general-purpose task queue for workload distribution to workers."
},
{
"answer": "Amazon Kinesis Data Streams with a single shard",
"isCorrect": false,
"explanation": "Using Kinesis for simple task distribution adds unnecessary complexity (shard management, retention costs) and the at-most-once-per-worker guarantee is not natively enforced. SQS is the appropriate tool."
}
]
},
{
"question": "A `PutRecords` API call is made with 100 records. The call returns HTTP 200, but some records have an `ErrorCode` in the response. What does this indicate?",
"answers": [
{
"answer": "The entire batch failed; no records were ingested.",
"isCorrect": false,
"explanation": "PutRecords uses partial success semantics. A 200 response does not mean all records succeeded — only that the API call itself completed. Individual records may have failed."
},
{
"answer": "Some records were successfully ingested and others failed; the response contains per-record success or failure details.",
"isCorrect": true,
"explanation": "PutRecords supports partial success. The HTTP 200 response indicates the API call was received, but each record entry in the response must be checked individually for an ErrorCode to determine which records need to be retried."
},
{
"answer": "The stream is throttling writes; all records must be retried.",
"isCorrect": false,
"explanation": "Throttling would affect individual records and be indicated by error codes like ProvisionedThroughputExceededException on specific entries, not a blanket failure of the entire batch."
},
{
"answer": "The ErrorCode is informational only and can be ignored.",
"isCorrect": false,
"explanation": "ErrorCode fields indicate that specific records failed to be ingested. They must not be ignored — the producer is responsible for retrying those records."
}
]
},
{
"question": "Which statement correctly describes the difference between Kinesis Data Streams on-demand mode and provisioned mode?",
"answers": [
{
"answer": "On-demand mode requires manually splitting and merging shards; provisioned mode does this automatically.",
"isCorrect": false,
"explanation": "This is the opposite of reality. In on-demand mode, Kinesis automatically manages shard count. In provisioned mode, the operator manually splits and merges shards."
},
{
"answer": "On-demand mode automatically adjusts shard count based on observed throughput; provisioned mode requires manually managing shard count.",
"isCorrect": true,
"explanation": "On-demand mode removes the need for capacity planning by scaling shards automatically. Provisioned mode gives full control but requires the operator to split or merge shards as traffic changes. On-demand is more convenient but costs more."
},
{
"answer": "On-demand mode is cheaper than provisioned mode in all scenarios.",
"isCorrect": false,
"explanation": "On-demand mode costs more than provisioned mode. It is more convenient for variable workloads but should be evaluated against provisioned mode on a cost basis."
},
{
"answer": "Provisioned mode supports Enhanced Fan-Out; on-demand mode does not.",
"isCorrect": false,
"explanation": "Enhanced Fan-Out is a consumer feature available regardless of whether the stream uses provisioned or on-demand capacity mode."
}
]
},
{
"question": "A developer is designing a data pipeline with the following requirements: real-time processing by a Lambda function AND long-term archival to S3 for batch analytics. What is the recommended architecture?",
"answers": [
{
"answer": "Lambda reads from SQS and writes to S3 directly.",
"isCorrect": false,
"explanation": "SQS does not support multiple consumers reading the same message. This pattern would not allow both real-time processing and archival to read the same events independently."
},
{
"answer": "Application → Kinesis Data Streams (consumed by Lambda) → Kinesis Data Firehose → S3",
"isCorrect": true,
"explanation": "This is the canonical pattern. Kinesis Data Streams handles real-time processing by Lambda (and other consumers), while Firehose reads from the same stream to batch and archive data to S3. This cleanly separates real-time and storage concerns."
},
{
"answer": "Application → Kinesis Data Firehose → Lambda → S3",
"isCorrect": false,
"explanation": "While Firehose supports Lambda for in-flight transformation, it is primarily a delivery service and does not support multiple independent consumers for real-time processing in the same way Kinesis Data Streams does."
},
{
"answer": "Application → S3 → Lambda (S3 event trigger) → Kinesis Data Streams",
"isCorrect": false,
"explanation": "Writing to S3 first introduces significant latency and defeats the real-time requirement. This is the reverse of the recommended data flow."
}
]
},
{
"question": "A Kinesis Data Stream receives records using `order_id` as the partition key. The stream has 10 shards but nearly all traffic is from a single high-volume merchant, causing one shard to be overwhelmed. What is the best way to address this hot shard problem?",
"answers": [
{
"answer": "Enable Enhanced Fan-Out to distribute writes across shards.",
"isCorrect": false,
"explanation": "Enhanced Fan-Out is a consumer-side feature that provides dedicated read throughput. It has no effect on how records are distributed across shards on the write side."
},
{
"answer": "Add a random suffix to the partition key to distribute records across more shards.",
"isCorrect": true,
"explanation": "Adding a random suffix (or using a higher-cardinality key) causes the MD5 hash to map records to different shards, distributing the load more evenly. This trades strict per-order ordering for better throughput distribution."
},
{
"answer": "Increase the data retention period to reduce per-shard load.",
"isCorrect": false,
"explanation": "Data retention controls how long records are available, not how load is distributed across shards. It has no effect on the hot shard problem."
},
{
"answer": "Switch to Kinesis Data Firehose, which has no shard model.",
"isCorrect": false,
"explanation": "While Firehose has no shard model, switching to it changes the architecture fundamentally and removes real-time multi-consumer capabilities. The correct fix is addressing the partition key strategy."
}
]
}
]
{{< /qcm >}}