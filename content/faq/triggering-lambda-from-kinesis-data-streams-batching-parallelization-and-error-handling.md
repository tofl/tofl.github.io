---
title: "Triggering Lambda from Kinesis Data Streams: Batching, Parallelization, and Error Handling"
---

## Triggering Lambda from Kinesis Data Streams: Batching, Parallelization, and Error Handling

Kinesis Data Streams and Lambda are a powerful pair. You push data into Kinesis, and Lambda automatically processes it at scale. But there's real complexity lurking beneath that simplicity. How do you configure batch sizes? What happens when records fail? How many Lambda invocations can actually run in parallel? These aren't trivial questions, and getting them wrong can lead to silent data loss, processing bottlenecks, or runaway costs.

In this article, we'll walk through the complete picture of the Lambda-Kinesis integration. You'll understand how event source mappings work, how batching and parallelization interact, how errors are handled, and what metrics matter. By the end, you'll be able to configure this integration with confidence and troubleshoot problems when they arise.

### Understanding the Lambda Event Source Mapping for Kinesis

When you connect Lambda to a Kinesis stream, you're creating an event source mapping. This is AWS's way of saying: "Listen to this stream, pull records, and invoke Lambda with them." AWS doesn't push records to Lambda; instead, Lambda polls the stream on your behalf through a managed poller that runs in the AWS infrastructure.

Think of the event source mapping as the middleman. You configure it with rules about how to batch records, what to do when things go wrong, where to send failures, and more. The mapping itself doesn't process data—it orchestrates the flow between Kinesis and Lambda.

The event source mapping reads from one or more shards in your Kinesis stream. Each shard can be read by a separate consumer, and here's where it gets interesting: a single event source mapping can spawn multiple concurrent Lambda invocations, each processing its own batch. This is where parallelization enters the picture, and it's one of the most misunderstood aspects of the integration.

### Batch Size and Batching Window: Controlling Record Collection

The first knob you'll turn is batch size. When you configure a batch size of, say, 100 records, the event source mapping will collect up to 100 records from the Kinesis stream and pass them all to a single Lambda invocation. This batching is efficient—it reduces the number of Lambda invocations and lets your function process records in bulk, which is often faster than processing them one at a time.

Batch size ranges from 1 to 10,000 records, depending on your stream's configuration and data size. Larger batches reduce invocation overhead but increase latency and memory consumption per invocation. A typical starting point is somewhere between 50 and 500 records, depending on record size and your tolerance for latency.

But batch size alone isn't the complete picture. The batching window adds another dimension. The batching window is a time period, measured in seconds, that the event source mapping will wait before sending a batch—even if that batch isn't full. If you set a batch size of 100 and a batching window of 5 seconds, the mapping will send the batch as soon as it collects 100 records *or* after 5 seconds have elapsed, whichever comes first.

This is particularly useful for scenarios where traffic is bursty or low-volume. Without a batching window, a low-traffic stream might cause records to sit idle until the batch fills up, introducing unpredictable latency. With a batching window, you get a predictable upper bound on how long a record can sit before processing.

Here's a practical example. Imagine you're processing IoT sensor data. Sensors might send data sporadically—sometimes dozens per second, sometimes none for minutes. If you set batch size to 100 with no window, records might queue indefinitely during quiet periods. Adding a 5-second batching window ensures every record is processed within 5 seconds of arrival, even if the batch never fills.

### Parallelization Factor: Unlocking Concurrent Processing Per Shard

Now let's talk about the feature that truly unlocks scalability: the parallelization factor. This setting controls how many Lambda invocations can run *simultaneously* for a single shard.

By default, the parallelization factor is 1, meaning only one Lambda invocation processes a shard at a time. This preserves order within the shard—records are processed sequentially. But many applications don't need strict global ordering; they only care about ordering *per partition key*. That's where the parallelization factor comes in.

When you increase the parallelization factor to, say, 10, the event source mapping can invoke Lambda up to 10 times in parallel for the same shard, each with its own batch of records. This allows your stream to be processed much faster, even though records from the same shard are no longer processed strictly sequentially.

Here's the crucial detail: ordering is preserved *per partition key*, not per shard. Kinesis guarantees that all records with the same partition key go to the same shard, and they arrive in order within that shard. When the event source mapping parallelizes, it ensures that records with the same partition key always go to the same Lambda invocation. This means you can safely set parallelization factor to 10 and still process records with the same partition key in the order they arrived.

The maximum parallelization factor is 10 per shard. If you have multiple shards, each can have up to 10 concurrent invocations. So a stream with 4 shards and a parallelization factor of 10 can have up to 40 concurrent Lambda invocations running simultaneously. This is a game-changer for throughput.

Configuring parallelization factor is a trade-off. Higher values give you more concurrency and faster processing but consume more Lambda concurrency quota. If your Lambda function isn't heavily constrained on CPU or network, increasing the parallelization factor from 1 to 5 or 10 can be transformative for throughput.

### Starting Position: Where the Poller Begins

When you first create an event source mapping, the poller needs to know where to start reading from the stream. This is controlled by the starting position parameter, and it has profound implications for what data you'll process.

The most common starting positions are TRIM_HORIZON and LATEST. TRIM_HORIZON means the poller will start reading from the oldest record in the stream. This is useful when you're setting up a new consumer and want to catch up on backlogged data. Every record ever written (up to the stream's retention period) will eventually be processed.

LATEST, by contrast, means the poller starts from the newest record and processes only data that arrives *after* the mapping is created. Historical data is ignored. This is useful when you're adding a new Lambda function to an existing stream and don't need to reprocess everything—you only want to handle going forward.

There's also AT_TIMESTAMP, which lets you specify an exact point in time to start reading from. This is handy when you need to reprocess data from a specific hour or day, or when you're recovering from an outage and want to pick up from a known good timestamp.

In practice, be intentional about this choice. Many developers have accidentally set starting position to LATEST, thinking they'd process all historical data, then been surprised when nothing happens. Or they've set it to TRIM_HORIZON and gotten flooded with events from months ago. The starting position should align with your business logic: do you need historical data, or are you only interested in new data?

### Retry-Until-Expiration: Automatic Retry with an Upper Bound

When a Lambda invocation fails while processing a batch of Kinesis records, what happens? By default, the event source mapping retries processing that batch automatically, up to a maximum number of times. This is controlled by the maximum retry attempts parameter.

The mechanism works like this: if a batch fails, the event source mapping waits a bit, then invokes Lambda again with the same batch. If it fails again, it waits longer and retries again. This continues up to the maximum retry attempts you've configured. After exhausting retries, the batch is discarded (unless you've configured an on-failure destination, which we'll cover next).

The retry delay follows an exponential backoff pattern, so early retries happen quickly, but the delay grows as retries accumulate. This prevents hammering a Lambda function that's in a bad state.

The default maximum retry attempts is 2, meaning a batch can fail and be retried twice. But you can increase this to up to 100 if you want more resilience. This is useful for transient failures—maybe your Lambda function talks to a database that was briefly unavailable, and a retry 10 seconds later will succeed.

However, be careful not to confuse retries with unlimited processing. The event source mapping also enforces a maximum age for records. If a batch is too old—if it's been sitting in the stream for longer than the maximum record age setting (default 86,400 seconds, or 1 day)—it's dropped without processing, even if the Lambda function keeps failing. This prevents records from being retried indefinitely.

### Bisect on Error: Isolating the Poison Pill

Imagine this scenario: a batch of 100 records arrives at Lambda. The function processes records 1 through 99 just fine, but record 100 causes a crash—perhaps it has malformed JSON that the function doesn't expect. The entire batch fails, and all 100 records are retried.

On the retry, the same thing happens. Records 1–99 succeed, but record 100 crashes again. The batch fails, retries, fails again, retries again... you see the problem. Record 100 is a "poison pill"—a record that will never succeed—and it's blocking the entire batch.

This is where the bisect on error feature becomes essential. When enabled, bisect on error automatically splits a failed batch in half and tries processing each half separately. If the first half succeeds and the second half fails, the error is isolated to the second half. That half is split again, and the process repeats until the problematic record is isolated into its own batch.

Once a record is alone in a batch and still fails, it's usually removed and sent to the on-failure destination (if configured), or dropped. This way, a single bad record doesn't prevent the rest of the batch from being processed.

To enable bisect on error, you set the function response type to ReportBatchItemFailures and have your Lambda function use a structured response that indicates which individual records failed. Your function needs to implement this logic:

```python
def lambda_handler(event, context):
    failed_records = []
    
    for record in event['records']:
        try:
            # Process the record
            payload = json.loads(record['kinesis']['data'])
            process_record(payload)
        except Exception as e:
            print(f"Failed to process record {record['kinesis']['sequenceNumber']}: {e}")
            failed_records.append({
                'itemId': record['kinesis']['sequenceNumber']
            })
    
    return {
        'batchItemFailures': failed_records
    }
```

By returning a list of failed records, you tell the event source mapping exactly which records caused problems. It will then retry those records separately. This pattern is far superior to failing the entire batch or not reporting failures at all.

### On-Failure Destinations: Where Bad Records Go

Even with retries and bisect on error, some records will eventually fail permanently. What happens to them? By default, they're dropped. But in most production systems, you want to know about these failures so you can investigate and fix them.

This is where on-failure destinations come in. You can configure the event source mapping to send failed records to Amazon SQS or Amazon SNS when they exhaust all retries. The failed record, along with metadata about the error, is delivered to the destination for later analysis.

Sending failed records to SQS is particularly common. You create a dead-letter queue, configure it as the on-failure destination, and then set up a monitoring dashboard or Lambda function to periodically inspect the queue. When you find a failed record, you can debug it, fix your Lambda function, and manually replay the record if needed.

Using SNS as the destination is useful when you want to trigger an alert or notification immediately. You can configure an SNS topic with an email subscription, and every failed record triggers an email. For high-volume streams, this might be noisy, but for critical streams, it's valuable.

The on-failure destination includes not just the record data but also error information, so you have context about what went wrong. This is invaluable for debugging.

### Metrics and Monitoring: IteratorAge and Processing Lag

Understanding the health of your Lambda-Kinesis integration requires knowing what metrics matter. The most important one is IteratorAge, a CloudWatch metric that measures how far behind the event source mapping is from the tip of the stream.

IteratorAge is measured in milliseconds. A low value—measured in seconds—means your Lambda function is keeping up with the stream. A high value—hours or days—means records are piling up faster than Lambda can process them.

If you're seeing IteratorAge creep up over time, it's a sign that your Lambda function isn't fast enough for your stream's throughput, or you don't have enough parallelization factor. You can address this by optimizing your function (making it faster), increasing the parallelization factor (more concurrent invocations), or adding more shards to distribute the load.

Beyond IteratorAge, watch metrics like Lambda invocation errors, invocation duration, and concurrency. If invocation errors spike, your function might have a bug or an external dependency might be down. If duration increases, the function might be doing more work or hitting a slow resource.

Also pay attention to Lambda concurrency consumption. With a high parallelization factor and many shards, you can quickly consume a large portion of your account's Lambda concurrency quota. Monitor this to ensure you're not starving other workloads.

### IAM Permissions: What Lambda and the Event Source Mapping Need

For the event source mapping to work, two sets of permissions are required. First, the event source mapping itself needs permission to read from Kinesis. Second, your Lambda execution role needs permission to write to any on-failure destinations.

The event source mapping (not your Lambda function directly) reads from Kinesis. AWS manages this permission through a service-linked role. You don't typically need to configure this yourself, but it's good to understand that the mapping is the principal reading Kinesis, not the Lambda function.

Your Lambda function's execution role, on the other hand, doesn't need Kinesis permissions—it never reads from Kinesis directly. But if you've configured an on-failure destination, the function needs permission to write to that destination. For SQS, that's `sqs:SendMessage`. For SNS, it's `sns:Publish`.

Here's a minimal IAM policy for a Lambda function with an SQS dead-letter queue:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "sqs:SendMessage"
      ],
      "Resource": "arn:aws:sqs:region:account-id:my-dlq-queue"
    }
  ]
}
```

If your Lambda function accesses other services—a database, S3, CloudWatch Logs—you'll need permissions for those as well, but those are independent of the Kinesis integration.

### Putting It All Together: A Practical Example

Let's walk through a realistic scenario. Suppose you're building a system to process user activity events from a Kinesis stream. Events are JSON-encoded and include a user ID, event type, and timestamp. You want to process them quickly, but you also want to gracefully handle occasional bad records.

You'd start by creating a Lambda function that processes events:

```python
import json
import logging

logger = logging.getLogger()
logger.setLevel(logging.INFO)

def lambda_handler(event, context):
    failed_records = []
    
    for record in event['records']:
        try:
            # Decode the Kinesis record
            payload = json.loads(record['kinesis']['data'])
            
            # Validate the record
            user_id = payload.get('user_id')
            event_type = payload.get('event_type')
            timestamp = payload.get('timestamp')
            
            if not all([user_id, event_type, timestamp]):
                raise ValueError("Missing required fields")
            
            # Process the event (e.g., write to database, update analytics, etc.)
            process_user_event(user_id, event_type, timestamp)
            
            logger.info(f"Processed event for user {user_id}")
            
        except Exception as e:
            logger.error(f"Error processing record: {e}")
            failed_records.append({
                'itemId': record['kinesis']['sequenceNumber']
            })
    
    return {
        'batchItemFailures': failed_records
    }

def process_user_event(user_id, event_type, timestamp):
    # Placeholder for actual processing logic
    pass
```

Next, you'd create the event source mapping. Using the AWS CLI:

```bash
aws lambda create-event-source-mapping \
  --event-source-arn arn:aws:kinesis:us-east-1:123456789012:stream/user-events \
  --function-name ProcessUserEvents \
  --enabled \
  --batch-size 100 \
  --maximum-batching-window-in-seconds 5 \
  --parallelization-factor 5 \
  --starting-position LATEST \
  --maximum-record-age-in-seconds 604800 \
  --bisect-batch-on-function-error true \
  --function-response-types ReportBatchItemFailures \
  --on-failure-destination-config EventBridgeFailureInvocationRecord="arn:aws:sqs:us-east-1:123456789012:user-events-dlq"
```

This configuration:

- Batches up to 100 records or waits 5 seconds, whichever comes first
- Allows up to 5 concurrent Lambda invocations per shard
- Starts processing from new records (LATEST)
- Keeps retrying records for up to 1 week (604800 seconds)
- Automatically bisects batches when errors occur
- Sends permanently failed records to an SQS dead-letter queue

With this setup, your system is resilient. Bad records are isolated and sent to the DLQ. Your Lambda function reports which records failed, allowing fine-grained error handling. The parallelization factor gives you reasonable throughput without overshooting concurrency. And the batching window prevents records from sitting idle.

### Common Pitfalls and How to Avoid Them

One frequent mistake is setting the parallelization factor too high without understanding concurrency limits. If each Lambda invocation takes 10 seconds and you have 10 shards with a parallelization factor of 10, you're potentially reserving 100 concurrent invocations. If your account's concurrency limit is 1000, you're using 10% just for this one function. Monitor concurrency carefully.

Another pitfall is forgetting to implement the ReportBatchItemFailures response pattern. Without it, your function either succeeds entirely or fails entirely, and bisect on error can't work effectively. Always structure your error handling to identify individual failing records.

A third issue is setting a batching window that's too aggressive. A 60-second window might introduce unacceptable latency for time-sensitive applications. Choose your window based on your latency requirements, not arbitrary defaults.

Finally, don't neglect monitoring. IteratorAge is your canary. If it starts climbing, your system is falling behind. Investigate immediately rather than assuming it's a transient blip.

### Conclusion

The Lambda-Kinesis integration is powerful, but it's not a black box. Understanding batching, parallelization factor, retry behavior, bisect on error, and on-failure destinations transforms you from someone who "just connects Lambda to Kinesis" to someone who deliberately tunes the system for reliability and performance.

The key insights are these: batch size and window control latency and invocation frequency; parallelization factor unlocks throughput without breaking per-partition-key ordering; bisect on error isolates poison pills; on-failure destinations ensure you don't lose track of failures; and IteratorAge tells you whether you're keeping up.

As you build production systems with Kinesis and Lambda, keep these concepts close. They'll help you design integrations that are fast, reliable, and resilient.
