---
title: "Kinesis Client Library (KCL) Explained: Checkpointing, Leases, and DynamoDB"
---

## Kinesis Client Library (KCL) Explained: Checkpointing, Leases, and DynamoDB

When you first encounter Amazon Kinesis, the promise is elegant: a fully managed service that captures and processes streams of data at scale. But the moment you try to build a real consumer application, you discover an uncomfortable truth—managing shard assignments, handling failovers, and tracking which records you've already processed becomes surprisingly complex. This is where the Kinesis Client Library steps in. Rather than building all of this machinery yourself, KCL abstracts away the tedious coordination work and lets you focus on processing records. But understanding what's happening under the hood isn't just a nice-to-have; it's essential for building reliable, scalable stream processing pipelines and avoiding subtle gotchas that plague production systems.

### The Fundamental Problem KCL Solves

Imagine you've built a Kinesis stream that receives clickstream events from your application. You've decided to process these events with three worker processes running on different servers. How do you decide which worker consumes from which shard? What happens when a worker crashes midway through processing? How do you ensure that no record is processed twice, and no record is skipped entirely?

These are the questions KCL answers. At its core, KCL is a layer of coordination logic that sits between your application code and Kinesis. It provides automatic shard assignment to workers, automatic failover when workers die, and exactly-once processing semantics. The clever part is that it accomplishes all of this using nothing but DynamoDB as a shared coordination service. No additional infrastructure, no specialized coordination service—just DynamoDB tables.

### How KCL Assigns Shards to Workers: The Lease Mechanism

The heart of KCL's coordination is the lease table, a DynamoDB table that KCL creates and manages automatically. Each shard in your Kinesis stream has a corresponding item in this table, and that item represents the "lease" on that shard. Think of a lease like a short-term contract: a worker claims ownership of a shard for a limited time, and during that time, only that worker should be consuming from the shard.

When your KCL application starts, it looks at the Kinesis stream, counts the shards, and ensures the lease table has one item per shard. Each lease item contains essential metadata: the shard ID, the worker name (usually something like the hostname or a unique ID), a lease counter that increments each time the lease changes hands, and a timestamp indicating when the lease was last updated. By default, a lease is valid for 30 seconds, though this is configurable.

Here's how the system stays in sync: periodically (every 5 seconds by default), each worker checks the lease table and examines which leases it currently holds. If a worker holds a lease and hasn't renewed it in 30 seconds, any other worker is free to claim it. This is the failover mechanism in action. When Worker A crashes, its leases expire after 30 seconds, and Worker B or Worker C will notice the expired leases and claim them.

The lease mechanism is also how KCL balances load across workers. If you have 12 shards and 3 workers, KCL tries to distribute the shards evenly, aiming for each worker to own 4 shards. If a fourth worker joins the party, KCL rebalances, and workers begin claiming and surrendering leases until reaching a new equilibrium where each worker owns 3 shards. This rebalancing happens gradually and gracefully—KCL doesn't brutally yank leases away; instead, when a worker detects that it owns more than its fair share, it voluntarily releases some leases, and others claim them.

### Checkpointing: Tracking Your Progress Through the Stream

Now that we've solved the "which worker processes which shard" problem, we face the next challenge: how do we remember where we left off? Kinesis records have sequence numbers, and if you're processing them in a long-running application, you need to know which sequence number you've successfully processed so that if the worker restarts, it can pick up from where it left off rather than reprocessing old records.

This is where checkpointing comes in. A checkpoint is a record stored in DynamoDB that marks the sequence number of the last record a worker has successfully processed for a particular shard. KCL stores checkpoints in the same DynamoDB table as the leases (though in a slightly different part of the item structure).

The workflow is straightforward: your record processor handles a batch of records, and after processing them successfully, you call the checkpoint method. Under the hood, KCL updates the DynamoDB item for that shard, storing the sequence number of the last record you processed. Next time a worker (whether the same one or a replacement) claims that shard's lease, it reads the checkpoint and knows to start fetching records from the next sequence number.

It's crucial to understand the timing here. You should only checkpoint after you've successfully processed the records. If you checkpoint prematurely and then your worker crashes before actually processing those records, you'll have a gap—those records will be lost. Conversely, if you don't checkpoint, you'll reprocess records when the worker restarts, which might be acceptable (though inefficient) depending on your application's idempotency guarantees.

### The DynamoDB Table: Capacity Planning and Cost Implications

Because all the coordination logic—leases and checkpoints—lives in DynamoDB, the performance and cost characteristics of your lease table directly impact your KCL application. This is often an overlooked detail that bites developers in production.

By default, KCL creates a lease table with 4 write capacity units and 4 read capacity units in provisioned billing mode. For small applications with a handful of shards and workers, this is usually sufficient. But here's where it gets interesting: every time KCL renews a lease (which happens every few seconds), it's performing a DynamoDB write. Every time it checks for expired leases, it's performing reads. Every time you call checkpoint, that's a write. If you have many shards and frequent checkpoints, your lease table's write consumption can grow quickly.

Consider a realistic scenario: you have 100 shards, and each shard is owned by a worker. Every 5 seconds, KCL renews the lease for each shard it owns, which might be distributed across 20 workers. That's approximately 20 writes per 5-second interval per worker, or 4 writes per second. Additionally, each checkpoint is another write. If you're checkpointing every 10 records and your throughput is 10,000 records per second across all shards, you could have 1,000 checkpoints per second. Suddenly, 4 write capacity units is nowhere near enough.

The solution is to monitor your lease table's write consumption and scale accordingly. You can set the lease table to auto-scale using DynamoDB's auto-scaling feature, or you can provision it with enough capacity from the start based on your expected throughput. A practical rule of thumb is to estimate the write load (lease renewals plus checkpoints per second) and provision at least that much write capacity, plus a safety margin.

### KCL 1.x vs. 2.x: Enhanced Consuming with HTTP/2 and EFO

The Kinesis Client Library has evolved significantly between versions 1.x and 2.x, and understanding the differences matters because it affects how efficiently you consume from Kinesis.

In KCL 1.x, record retrieval is handled through the standard Kinesis API—you call GetRecords with a shard iterator, and you get back a batch of records. This approach works but has a notable limitation: Kinesis limits each shard to a maximum of 2 MB per second of read throughput. If multiple consumers are reading from the same shard (which shouldn't happen with KCL's lease mechanism, but could happen in other scenarios), they share that bandwidth. Additionally, GetRecords has a base cost per call, so frequent calls add up.

KCL 2.x introduced support for Enhanced Fan-Out (EFO), a Kinesis feature that uses HTTP/2 and server-push to deliver records to consumers with higher throughput (up to 4 MB per second per consumer per shard) and lower latency. Instead of the consumer polling for records, the Kinesis service pushes records to the consumer. This requires using the SubscribeToShard API rather than GetRecords.

The trade-off is cost: EFO has a per-shard-per-consumer fee on top of the standard Kinesis data transfer costs. For applications where latency is critical or throughput per shard is high, EFO is worth it. For applications with moderate throughput and latency tolerance, the standard polling approach is more economical.

KCL 2.x is also built on the AWS SDK for Java v2, which uses a non-blocking I/O model and is generally more efficient. It also offers better configuration options and improved documentation. Unless you have strong reasons to stick with KCL 1.x (legacy code, specific language support), migrating to 2.x is recommended.

### Handling Failover and Worker Recovery

One of KCL's greatest strengths is how elegantly it handles worker failures. Let's walk through a concrete scenario: you have three workers processing a 6-shard stream. Worker A owns shards 0 and 1, Worker B owns shards 2 and 3, and Worker C owns shards 4 and 5. Suddenly, Worker A crashes.

Here's what happens next, from the perspective of the lease table:

Within the next lease renewal interval (default 30 seconds), Worker B or Worker C will notice that the leases for shards 0 and 1 haven't been renewed. The lease items in DynamoDB still exist, but they're stale. KCL has a background thread that continuously scans the lease table looking for expired leases. Once it finds one, it attempts to claim it by updating the DynamoDB item with its worker ID and resetting the timestamp. If it succeeds (the conditional write succeeds), it now owns that lease.

Meanwhile, Worker B might have noticed the same expired leases and attempted to claim them too. But DynamoDB's conditional writes ensure that only one worker successfully updates each lease item. The winner is the one whose write succeeds first. The loser will be informed of the failure and will back off.

Once a worker has claimed a lease, the final step is reading the checkpoint. KCL fetches the checkpoint from the lease table, learns which sequence number was last processed, and asks Kinesis to start delivering records from the next sequence number. Processing resumes, unaware of the disruption.

This whole process happens automatically with no intervention required. Your application doesn't need to know about the failure or implement recovery logic. It's one of the elegant aspects of KCL's design.

### The Duplicate Processing Pitfall

Here's a scenario that catches many developers off-guard: your worker successfully processes a batch of records and is about to call checkpoint when it suddenly crashes. When a replacement worker claims the lease and reads the checkpoint, it finds that the checkpoint still points to an older sequence number because the checkpoint never got written. The replacement worker starts processing from that older sequence number again, and you end up processing the same records twice.

This is not a bug in KCL; it's a fundamental consequence of distributed computing. You can't guarantee that the checkpoint write will succeed before a failure occurs. The question is whether your application can tolerate reprocessing.

In KCL terminology, this is called "at-least-once" delivery semantics. Records are guaranteed to be delivered at least once, but might be delivered multiple times. If your application is idempotent—that is, processing the same record twice has the same effect as processing it once—then this is fine. For example, if you're setting a user's profile picture to a URL from a Kinesis record, reprocessing won't cause problems; the picture just gets set to the same URL again.

But if your application isn't idempotent (for example, if you're incrementing a counter), you need to handle deduplication explicitly. One approach is to store a deduplication key (like the record's sequence number) in a separate store and check it before processing. Another approach is to ensure that your DynamoDB updates are idempotent by using UpdateItem with conditional expressions. The key is to be deliberate about it rather than hoping the problem doesn't occur.

### Lease Starvation and Uneven Load Distribution

Normally, KCL's lease balancing mechanism works smoothly, but under certain conditions, you can encounter scenarios where the distribution becomes uneven. A worker might claim more leases than its fair share and hold onto them longer than expected. This is sometimes called lease starvation from the perspective of other workers that aren't getting a fair allocation.

This usually happens when lease renewal times are staggered or when there's contention on the lease table itself. If a worker is struggling with DynamoDB latency or is overloaded with record processing, it might not renew its leases promptly. Other workers see the leases as expired and try to claim them, creating thrashing where leases constantly change hands.

The preventative measures include ensuring adequate DynamoDB capacity, tuning the lease renewal interval and expiration duration to match your deployment characteristics, and monitoring the lease table's performance metrics. If you see high latency on lease table operations or see leases constantly changing hands in your logs, that's a signal to investigate.

### Handling Shard Splits and Merges

Kinesis allows you to split and merge shards dynamically, which presents a coordination challenge for consumers. When a shard is split, the parent shard closes, and two new child shards are created. KCL needs to detect this, stop consuming from the parent shard, and start consuming from the child shards.

KCL handles this by periodically fetching the shard list from Kinesis and comparing it to the lease table. If it detects new shards that don't have leases yet, it creates leases for them. If it detects shards that no longer exist in Kinesis, it marks them as closed. Your record processor can implement the IShardRecordProcessor interface (in KCL 2.x) which includes lifecycle methods like onShardEnded, allowing you to perform cleanup when a shard is closed.

The tricky part is that shards are hierarchical. The child shards might take some time to become available, and the parent shard's data isn't immediately transferred to the children. KCL handles this by maintaining the shard lineage in the lease table and ensuring that a worker doesn't move to consuming from child shards until the parent shard has been fully processed.

### Practical Configuration Tips

Getting KCL running requires some configuration decisions. The most important ones are the lease table name, the stream name, the initial position (whether to start from the beginning or the latest records), and the application name. The application name is used as part of the lease table name by default, so if you have multiple applications consuming from the same stream, use different application names to avoid collisions on the lease table.

You'll also want to tune the lease duration and renewal interval based on your deployment. Shorter lease durations mean faster failover but also more DynamoDB writes. Longer durations mean fewer writes but slower failover. The defaults (30 seconds for lease duration, 5 seconds for renewal) work well for most applications, but if you're processing a very high throughput or have an unstable environment, you might want to adjust.

Another important consideration is the record processor implementation. Your code should be prepared to handle records that arrive out of order (especially when shards are split or merged) and should fail gracefully if processing a particular batch fails. KCL will retry failed records according to its retry policy, but you should understand the semantics of what "failure" means to your processor.

### Monitoring and Troubleshooting

To effectively operate a KCL application, you need observability. The lease table is the single source of truth for your application's health. If leases are constantly changing hands, workers are crashing frequently, or DynamoDB operations are timing out, you'll see it reflected in lease table behavior.

CloudWatch metrics for the DynamoDB lease table (read and write throughput, latency) are invaluable. Additionally, KCL itself produces application logs that include information about lease acquisition, checkpointing, and record processing. Enable debug logging during development, but ensure that your production deployments log at an appropriate level to avoid overwhelming your logging system while still capturing errors and anomalies.

A useful troubleshooting technique is to examine the lease table directly. You can use the DynamoDB console or the AWS CLI to inspect the lease items and see which worker currently owns each lease, when the lease was last updated, and what the last checkpoint was. This gives you a clear picture of what's happening in your system.

### Putting It All Together: A Mental Model

To internalize how KCL works, it helps to think of the lease table as the central nervous system of your application. Every worker is constantly reading from and writing to the lease table, and DynamoDB is enforcing the ground truth of who owns which shard and what's been processed.

When a worker starts up, it scans the lease table to see what leases are available and tries to claim a fair share. It then begins consuming records from its assigned shards and checkpointing its progress. When it crashes, the leases automatically expire, and other workers claim them. When new workers join, existing workers voluntarily give up leases to rebalance. It's a self-healing, distributed system orchestrated entirely through conditional writes to a DynamoDB table.

Understanding this model helps you predict what will happen under various failure scenarios and why certain configuration choices matter. It also helps you debug issues when they arise, because you can reason about the sequence of events that led to the problem.

### Conclusion

The Kinesis Client Library is a masterclass in distributed systems engineering, elegantly solving the hard problems of shard assignment, failover, and progress tracking through clever use of DynamoDB. Rather than implementing these patterns yourself—which is error-prone and complex—KCL provides a battle-tested abstraction that handles the coordination transparently.

To use KCL effectively, you need to understand not just what it does, but why it does it that way. The lease table, the checkpoint mechanism, the failover semantics, and the DynamoDB capacity implications are all interconnected. By grasping these concepts, you can configure KCL appropriately for your workload, troubleshoot problems when they arise, and build reliable stream processing applications that scale.

As you build with KCL, keep in mind the tradeoffs: at-least-once delivery means you need idempotent processing, enhanced fan-out costs more but delivers higher throughput, and adequate DynamoDB capacity is non-negotiable for smooth operation. These aren't limitations of KCL; they're the natural consequences of building a scalable, fault-tolerant distributed system. Understanding them transforms KCL from a mysterious black box into a powerful tool you can reason about and control.
