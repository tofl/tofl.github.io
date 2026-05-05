---
title: "Resharding Kinesis Streams: Shard Splitting, Merging, and Consumer Impact"
---

## Resharding Kinesis Streams: Shard Splitting, Merging, and Consumer Impact

Amazon Kinesis Data Streams is a powerful service for ingesting, processing, and analyzing real-time data at scale. But like any distributed system, it requires thoughtful capacity planning. What happens when your application suddenly experiences a traffic spike and a single shard becomes a bottleneck? Or conversely, when your throughput demand drops and you're paying for more shards than you actually need? The answer lies in resharding—the practice of dynamically adjusting your stream's shard count to match current demand.

Resharding is deceptively subtle. On the surface, it seems straightforward: split a shard when you need more capacity, merge shards when you don't. But beneath that surface lies important machinery around shard state transitions, parent-child relationships, and the critical requirement that consumers preserve record ordering. Misunderstanding these mechanics can lead to lost records, duplicate processing, or violations of ordering guarantees that your application may depend on.

In this guide, we'll walk through the complete picture of resharding Kinesis streams. We'll explore when and why you'd reshape, dive into the APIs that power it, unpack what happens inside your stream during these transitions, and see exactly how consumers—both those using the Kinesis Client Library and those using the raw SDK—must handle the complexity to maintain correctness.

### Understanding Kinesis Shards and Capacity

Before we discuss resharding, let's ground ourselves in what a shard is and how it relates to throughput.

A Kinesis Data Stream is composed of one or more shards, and each shard provides a baseline capacity of 1 MB/second of read throughput and 1,000 records per second of write throughput. If you need to ingest more data than a single shard can handle, you add more shards. Each shard is independent, and records are distributed across shards based on a partition key that you provide when putting records into the stream.

The partition key determines which shard receives a record. Kinesis uses the partition key's hash value to route the record. This means that all records with the same partition key go to the same shard—which is crucial for ordering, as we'll see later. If you have a hot partition key (many records with the same key), that can overwhelm a single shard even if your overall throughput is modest.

### When to Split Shards

You split a shard when you need to increase throughput. The most common scenarios are:

**Increased overall throughput demand** occurs when your application's data production grows. You might start with two shards processing 2 MB/second total, but during peak hours, your publishers send 4 MB/second. You need to split existing shards to accommodate this growth.

**Hot shard problems** arise when one shard receives disproportionate traffic because many records share the same partition key. If your application uses user ID as the partition key and one popular user generates significant traffic, their records all land on one shard, potentially exceeding that shard's 1 MB/second limit while other shards sit idle. Splitting that shard doesn't directly solve the problem—both child shards will still receive records from that same user—but it increases the throughput available to that partition key's data.

**Scaling during peak traffic** happens predictably in many applications. A retail platform might see traffic spike during sales events, or a SaaS platform might have peak hours each day. Rather than permanently over-provisioning, you can increase shard count during peaks and decrease it afterward.

### When to Merge Shards

You merge shards when you want to reduce costs or consolidate under-utilized capacity.

**Cost optimization** is straightforward: each shard has a per-hour cost. If your traffic drops permanently or seasonally, merging shards reduces your bill. You might merge four shards back into two if your peak demand is gone.

**Over-provisioning after traffic drops** can happen after you've split during peak demand. If you increased from two to four shards during a promotion, you may want to merge back down once the promotion ends.

**Consolidating low-utilization shards** occurs when several shards are collectively underutilized. If you have four shards but your application only uses 1.5 MB/second of combined capacity, merging them reduces operational overhead and cost.

### The SplitShard API

The `SplitShard` API operation takes a stream name, a shard ID, and a new hash key value that becomes the division point. Let's look at a concrete example.

Imagine you have a stream called `user-events` with one shard. Its shard ID might be `shardId-000000000000`. That shard's hash key range spans the entire space of possible hash values—let's say `0` to `4294967295` (a 32-bit range is common, though AWS uses a 128-bit range in practice; we'll simplify for clarity).

To split this shard, you call:

```bash
aws kinesis split-shard \
  --stream-name user-events \
  --shard-to-split shardId-000000000000 \
  --new-starting-hash-key 2147483648
```

This tells Kinesis: "Split `shardId-000000000000` at the hash key `2147483648`." The result is two child shards:

- One child shard handles hash keys from `0` to `2147483647`
- Another child shard handles hash keys from `2147483648` to `4294967295`

The original shard (`shardId-000000000000`) transitions to the `CLOSED` state. It cannot receive new records—all new writes go to the child shards. However, consumers can still read from the closed shard until all its records are consumed. This is essential for maintaining ordering.

The operation is asynchronous. It returns immediately, but the stream transitions through states. You can check progress with:

```bash
aws kinesis describe-stream --stream-name user-events
```

The output will show both the parent shard in `CLOSED` state and the two new child shards in `ACTIVE` state. After all data has been read from the parent shard and a retention period has passed, Kinesis automatically removes the parent shard from the stream's shard list.

### The MergeShard API

The `MergeShard` operation is conceptually the inverse of splitting. It combines two adjacent shards into one. Two shards are "adjacent" if their hash key ranges are contiguous with no gap between them.

For example, if you have two shards:

- Shard A: hash keys `0` to `2147483647`
- Shard B: hash keys `2147483648` to `4294967295`

You can merge them with:

```bash
aws kinesis merge-shards \
  --stream-name user-events \
  --shard-to-merge shardId-000000000001 \
  --adjacent-shard-to-merge shardId-000000000002
```

Both parent shards transition to `CLOSED` state. A new child shard takes over their combined hash key range. Like splitting, this is asynchronous, and all existing records remain readable until they're consumed.

### Parent Shards and the CLOSED State

Understanding the lifecycle of a shard during resharding is critical. When you split or merge, the original shards become parents and enter the `CLOSED` state. A closed shard exhibits specific behavior:

It cannot receive new records. The Kinesis service refuses any `PutRecord` or `PutRecords` request targeting a closed shard. New writes go only to active (child) shards.

It can be read from until all its records are consumed. This is the key design decision that preserves ordering. Consumers don't lose access to the shard's data; they must drain it before transitioning to child shards.

It remains visible in stream descriptions and shard lists while it contains unconsumed data, then is removed after a retention period once all data has been read.

This state machine is elegant but requires consumers to understand it. A naive consumer that ignores closed shards would never read the final records from a parent shard, potentially losing data and breaking ordering.

### Parent-Child Shard Relationships and Ordering Preservation

This is where resharding becomes genuinely interesting. Kinesis guarantees that all records with the same partition key are delivered in order—but only if consumers handle resharding correctly.

When you split a shard, the partition key's hash value determines which child shard(s) will eventually receive that partition key's future records. But the parent shard still contains all the historical records with that partition key. To maintain order, a consumer must:

1. Read all records from the parent shard
2. Only then start reading from the appropriate child shard(s)

If a consumer jumps straight to a child shard after a split, it misses records from the parent. This breaks the ordering guarantee.

Similarly, when you merge two shards into one, the child shard will eventually receive records from both partition key ranges. A consumer reading from both parents must finish draining both before reading from the child, otherwise records from one parent could be read out of order relative to records from the child.

AWS tracks these relationships explicitly in the shard structure. Each shard has:

- `ParentShardId`: the ID of the shard it was derived from (if applicable)
- `AdjacentParentShardId`: the ID of the other parent shard (only for merge results)
- `SequenceNumberRange`: the range of sequence numbers in this shard, with a `EndingSequenceNumber` that marks where the shard's data ends

Using this metadata, a consumer can build a tree of shard dependencies and ensure it processes parents before children.

### How the Kinesis Client Library Handles Resharding

The Kinesis Client Library (KCL) is a managed consumer abstraction that handles resharding transparently. If you're using KCL (the Java, Python, Node.js, or Go version), you get this behavior for free.

KCL maintains an internal understanding of shard relationships. When it detects a closed shard with unconsumed data, it continues reading from it. When a closed shard is fully consumed, KCL automatically transitions to the appropriate child shard(s). This happens invisibly to your record processor—you simply implement a callback that processes records as they arrive, and KCL ensures they come in the correct order, even across resharding events.

Under the hood, KCL uses DynamoDB (or Kinesis itself, in newer versions) to track its position in each shard using a lease-based system. When resharding occurs, KCL updates leases to reflect the new shard structure. Multiple instances of your application can run concurrently, and KCL ensures each shard is processed by only one instance at a time, coordinating through the lease table.

The practical implication is straightforward: if you're using KCL, resharding is largely invisible. Your application continues processing records in order without modification.

### Custom SDK Consumers and Manual Resharding Handling

If you're using the raw Kinesis SDK (boto3 in Python, the AWS SDK for Java, etc.) rather than KCL, you have full responsibility for handling resharding correctly. This is more complex but also more flexible.

Here's a simplified conceptual approach:

First, you must query the stream to get its current shards using `DescribeStream`. This returns all active and closed shards with their metadata, including parent shard IDs and sequence number ranges.

Second, build a shard hierarchy. For each shard, determine its parents. For example, if a shard has a `ParentShardId`, follow that reference. If it has both `ParentShardId` and `AdjacentParentShardId`, it's a result of a merge and depends on two parents.

Third, implement shard processing in dependency order. Don't process a shard until all its parents have been fully consumed. One common pattern is to track shard processing state (e.g., "not started," "in progress," "finished") and only move a shard to "in progress" once its parents are "finished."

Fourth, read records from a shard using `GetRecords` with a shard iterator. Each call to `GetRecords` returns a batch of records and a new iterator (or `null` if the shard is exhausted). Track your position using the iterator or by storing the last sequence number processed.

Here's a simplified pseudocode example:

```python
import boto3
import time

kinesis = boto3.client('kinesis')
stream_name = 'user-events'
shard_statuses = {}  # Track which shards we've finished

def get_all_shards():
    """Fetch current shards from the stream."""
    response = kinesis.describe_stream(StreamName=stream_name)
    return response['StreamDescription']['Shards']

def can_process_shard(shard_id, shards_dict):
    """Check if all parent shards have been consumed."""
    shard = shards_dict[shard_id]
    parent_id = shard.get('ParentShardId')
    adjacent_parent_id = shard.get('AdjacentParentShardId')
    
    if parent_id and shard_statuses.get(parent_id) != 'FINISHED':
        return False
    if adjacent_parent_id and shard_statuses.get(adjacent_parent_id) != 'FINISHED':
        return False
    
    return True

def process_shard(shard_id, shards_dict):
    """Read all records from a shard."""
    shard = shards_dict[shard_id]
    
    # Get an initial shard iterator
    shard_iterator_response = kinesis.get_shard_iterator(
        StreamName=stream_name,
        ShardId=shard_id,
        ShardIteratorType='TRIM_HORIZON'  # Start from oldest record
    )
    shard_iterator = shard_iterator_response['ShardIterator']
    
    shard_statuses[shard_id] = 'IN_PROGRESS'
    
    while shard_iterator:
        # Get records
        records_response = kinesis.get_records(
            ShardIterator=shard_iterator,
            Limit=100
        )
        
        records = records_response['Records']
        for record in records:
            # Process the record (your business logic here)
            print(f"Processing: {record['Data']}")
        
        shard_iterator = records_response.get('NextShardIterator')
        
        # Avoid throttling
        time.sleep(0.1)
    
    shard_statuses[shard_id] = 'FINISHED'

def main():
    """Main consumer loop."""
    processed_shards = set()
    
    while True:
        shards = get_all_shards()
        shards_dict = {shard['ShardId']: shard for shard in shards}
        
        # Find shards we can process
        for shard in shards:
            shard_id = shard['ShardId']
            if shard_id not in processed_shards and can_process_shard(shard_id, shards_dict):
                process_shard(shard_id, shards_dict)
                processed_shards.add(shard_id)
        
        # Check if we're done (all shards processed)
        if len(processed_shards) == len(shards_dict) and all(
            s.get('SequenceNumberRange', {}).get('EndingSequenceNumber') is not None
            for s in shards_dict.values()
        ):
            break
        
        # Wait before checking again
        time.sleep(5)

if __name__ == '__main__':
    main()
```

This example is simplified—production code would handle edge cases like shard iterator expiration, error retries, and checkpointing—but it illustrates the core logic: respecting parent-child relationships, tracking completion, and only processing a shard once its dependencies are satisfied.

### A Concrete AWS CLI Example

Let's walk through a complete example of splitting a shard using the AWS CLI.

First, describe your stream to see its current state:

```bash
aws kinesis describe-stream --stream-name user-events
```

You'll see output like:

```json
{
  "StreamDescription": {
    "StreamName": "user-events",
    "StreamARN": "arn:aws:kinesis:us-east-1:123456789012:stream/user-events",
    "StreamStatus": "ACTIVE",
    "Shards": [
      {
        "ShardId": "shardId-000000000000",
        "HashKeyRange": {
          "StartingHashKey": "0",
          "EndingHashKey": "4294967295"
        },
        "SequenceNumberRange": {
          "StartingSequenceNumber": "49590338271490256608559692538361294095544909552521936898"
        }
      }
    ]
  }
}
```

You have one shard with ID `shardId-000000000000`. To split it, call:

```bash
aws kinesis split-shard \
  --stream-name user-events \
  --shard-to-split shardId-000000000000 \
  --new-starting-hash-key 2147483648
```

This returns immediately (or throws an error if the operation is invalid). Now check the stream again:

```bash
aws kinesis describe-stream --stream-name user-events
```

Shortly, you'll see three shards:

```json
{
  "StreamDescription": {
    "StreamName": "user-events",
    "StreamStatus": "ACTIVE",
    "Shards": [
      {
        "ShardId": "shardId-000000000000",
        "HashKeyRange": {
          "StartingHashKey": "0",
          "EndingHashKey": "4294967295"
        },
        "SequenceNumberRange": {
          "StartingSequenceNumber": "49590338271490256608559692538361294095544909552521936898",
          "EndingSequenceNumber": "49590338271490256608559692539206982734238325220699598818"
        }
      },
      {
        "ShardId": "shardId-000000000001",
        "HashKeyRange": {
          "StartingHashKey": "0",
          "EndingHashKey": "2147483647"
        },
        "SequenceNumberRange": {
          "StartingSequenceNumber": "49590338271490256608559692539206982734238325220699598819"
        },
        "ParentShardId": "shardId-000000000000"
      },
      {
        "ShardId": "shardId-000000000002",
        "HashKeyRange": {
          "StartingHashKey": "2147483648",
          "EndingHashKey": "4294967295"
        },
        "SequenceNumberRange": {
          "StartingSequenceNumber": "49590338271490256608559692539206982734238325220699598819"
        },
        "ParentShardId": "shardId-000000000000"
      }
    ]
  }
}
```

Notice that the original shard now has an `EndingSequenceNumber`, indicating it's closed. The two new shards reference it as their parent via `ParentShardId`. Both child shards start with the same sequence number (one higher than the parent's ending number), representing the division point.

Future records will go to child shards based on their partition key's hash. But records already in the parent shard must be read from there. A well-behaved consumer will read all records from the parent before moving to children.

To verify that a shard is fully consumed, you check whether you've received an `EndingSequenceNumber` from a `GetRecords` call (a closed shard has one) and whether you've read past it.

### Monitoring and Alerting for Resharding Needs

In practice, you don't manually trigger resharding by constantly polling stream metrics. Instead, you'd monitor CloudWatch metrics and set up alarms to alert you when resharding is needed.

Key metrics to watch include `IncomingRecords` and `IncomingBytes` to see overall throughput, and `GetRecords.IteratorAgeMilliseconds` to detect backlog. When iterator age climbs, it means your consumers are falling behind—a sign you need more shards.

You might also set up automatic scaling using AWS Application Auto Scaling, which can increase or decrease shard count based on metrics like `IncomingRecords` or a custom CloudWatch metric you publish. This removes the manual burden of monitoring and splitting shards.

### Important Caveats and Gotchas

Resharding has some important limitations worth knowing:

You cannot split a shard into more than two shards in a single operation. If you need to increase capacity significantly, you must split multiple times or split multiple shards in parallel.

You cannot merge more than two shards at once. Merges work only on adjacent shards.

You can perform a limited number of resharding operations per stream per 24-hour period. AWS allows 10 operations per 24 hours for on-demand billing, though you can request a limit increase. For provisioned billing, limits are higher. Check the current quotas in your AWS account.

Resharding is not instantaneous. The old shard closes and the new shards open, but there's a window—typically seconds to a few minutes—where the old shard is closed but still being read by consumers. If a consumer crashes during this window, it must resume from its last checkpoint, not from the beginning.

Cost changes when you reshard. More shards cost more money. Fewer shards cost less. Always factor in the throughput you're paying for versus what you're using.

### Practical Tips for Production

When planning resharding in production, consider these practices:

Monitor continuously, not reactively. Set up CloudWatch alarms so you're alerted before a shard becomes saturated, not after.

Use on-demand billing if your traffic is unpredictable. On-demand Kinesis charges per gigabyte of data written and read, with no per-shard hourly cost. If your traffic is highly variable, it can be more economical than paying for provisioned shards you might not use.

Test resharding in non-production environments first. Understand how your consumers behave during resharding events. Does an unexpected closed shard break anything? Does your consumer resume correctly after a failure during resharding?

Communicate resharding plans to teams that depend on your Kinesis stream. If your stream is critical to data pipelines, downstream teams should know when shards will change.

Implement proper checkpointing if using custom consumers. Store your position (shard ID and sequence number) durably, so you can resume correctly after failures.

Use the Kinesis Client Library if you can. It handles resharding automatically, reducing operational complexity and the risk of bugs.

### Conclusion

Resharding is a critical operational skill for managing Kinesis Data Streams at scale. The mechanics—splitting for increased throughput, merging for cost optimization, and managing the parent-child relationships to preserve ordering—are straightforward in principle but require careful implementation in practice.

If you're using the Kinesis Client Library, resharding is largely transparent. Your consumers handle the transitions automatically, and you can focus on your business logic. If you're building custom consumers with the raw SDK, understanding shard hierarchies, the closed state, and dependency ordering becomes crucial. A subtle mistake here can result in lost records or ordering violations that are difficult to debug.

The key takeaway is this: resharding is not something that happens to your stream in isolation. It's deeply connected to how your consumers read data. A well-designed consumer respects parent-child relationships, drains closed shards completely, and only moves to new shards once their dependencies are satisfied. With this understanding, you can confidently scale your Kinesis streams to meet production demand while maintaining the ordering guarantees your applications depend on.
