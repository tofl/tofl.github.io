---
title: "Triggering AWS Lambda from DynamoDB Streams: A Hands-On Guide"
---

## Triggering AWS Lambda from DynamoDB Streams: A Hands-On Guide

Imagine you have a DynamoDB table storing user profiles, and every time a profile changes, you need to update a search index, send a notification, or sync data to another system. Manually polling the table would be inefficient and expensive. This is where DynamoDB Streams come in—they capture every modification to your table and can automatically trigger a Lambda function to handle it in real time.

DynamoDB Streams combined with Lambda event source mappings create a powerful, serverless pipeline for reacting to data changes. Understanding how to set this up correctly, configure the right parameters, and handle failures gracefully is essential for building robust applications on AWS. In this guide, we'll walk through everything you need to know to implement this pattern confidently.

### Understanding DynamoDB Streams

DynamoDB Streams capture item-level modifications in a DynamoDB table. When you enable a stream on a table, AWS automatically creates a stream that logs every put, update, and delete operation as it happens. The stream organizes these records into shards, similar to how Kinesis works—this architecture allows for parallel processing while maintaining the order of events for a given partition key.

Think of a DynamoDB Stream as an ordered log of changes. Each record in the stream represents a single modification and is available for consumption for up to 24 hours before it expires. This time window is important: it means if your Lambda function fails to process a record, you have a full day to retry it before the record becomes unavailable.

The magic happens when you connect a Lambda function as an event source. Lambda will automatically read from the stream, batch the records together (according to your configuration), and invoke your function with those records. Your function then processes them and reports success or failure back to Lambda.

### Choosing the Right StreamViewType

Before Lambda can even see the data, you need to decide what information should be captured in each stream record. This is where `StreamViewType` comes in. When you enable streams on a DynamoDB table, you must specify one of four options:

**KEYS_ONLY** captures only the key attributes of the modified item. This is the most lightweight option and is useful when you only need to know which item changed, not what changed about it. You might use this if your Lambda function will fetch the full item from DynamoDB anyway, or if you're tracking changes for audit purposes where you only need the identifier.

**NEW_IMAGE** includes the entire item as it appears after the modification. If you insert a new user profile or update an existing one, the stream record will contain all the current attributes. This is handy when you want to immediately work with the new state without additional database calls.

**OLD_IMAGE** contains the item as it was before the modification. This is less common but valuable when you need to detect what specifically changed, such as when enforcing data governance rules or generating audit trails that show "field X changed from Y to Z."

**NEW_AND_OLD_IMAGES** provides both the previous and current state of the item. This option gives you maximum information but also produces larger stream records and incurs higher costs. Use this when you genuinely need to compare before-and-after states, such as detecting price increases for cost control purposes.

Think about your use case carefully. If you're replicating changes to another system like OpenSearch, you probably want `NEW_IMAGE` or `NEW_AND_OLD_IMAGES`. If you're just triggering a workflow based on which items changed, `KEYS_ONLY` might suffice and will save you money.

### Enabling Streams on Your DynamoDB Table

Enabling streams is straightforward. Using the AWS CLI, you can enable a stream with:

```bash
aws dynamodb update-table \
  --table-name MyTable \
  --stream-specification StreamEnabled=true,StreamViewType=NEW_AND_OLD_IMAGES
```

In the AWS Management Console, navigate to your table's settings and look for the "Streams" section. You can enable streams there and choose your `StreamViewType` in a few clicks.

Once enabled, AWS creates a stream ARN that you'll use when configuring the Lambda event source mapping. The stream starts capturing changes immediately.

### Configuring the Event Source Mapping

An event source mapping is the bridge between DynamoDB Streams and Lambda. It tells Lambda how to read from the stream and what to do with the records. You can create this mapping via the AWS CLI or through the Lambda console.

Here's an example using the CLI:

```bash
aws lambda create-event-source-mapping \
  --event-source-arn arn:aws:dynamodb:us-east-1:123456789012:table/MyTable/stream/2024-01-15T10:00:00.000 \
  --function-name MyStreamProcessor \
  --enabled \
  --starting-position LATEST \
  --batch-size 100 \
  --maximum-batching-window-in-seconds 5 \
  --parallelization-factor 10
```

Let's break down these parameters, as they significantly affect how your function behaves:

**Starting Position** determines where in the stream Lambda begins reading. `LATEST` means it will only process records created after the mapping is established, which is typical for new deployments. `TRIM_HORIZON` reads from the oldest available record, useful if you're catching up on backlog. In practice, you'll almost always use `LATEST` unless you specifically need historical processing.

**Batch Size** controls how many stream records Lambda groups together before invoking your function. The default is 100, and the maximum is 1,000. A larger batch size means fewer invocations and lower costs but also more processing per invocation and higher memory usage. A smaller batch size means more invocations but faster response times. Consider your function's processing time and memory requirements when tuning this.

**Maximum Batching Window** (measured in seconds, up to 300) tells Lambda to wait that long after receiving the first record before invoking the function, even if it hasn't reached the batch size yet. This is useful for keeping latency low—you might set this to 5 seconds so that if you only have a handful of records, they're processed quickly rather than waiting for a full batch to accumulate.

**Parallelization Factor** is powerful and often underutilized. By default, Lambda processes one shard at a time per event source mapping. Setting a parallelization factor of, say, 10 means Lambda can process up to 10 shards in parallel. This dramatically increases throughput for high-volume tables. However, be aware that higher parallelization means more concurrent Lambda invocations, which consumes reserved concurrency faster and increases costs. Start conservative and increase based on monitoring.

**Batch Window** and **Batch Size** work together. Lambda will invoke your function when either condition is met: either the batch reaches your specified size, or the window expires. This hybrid approach balances latency and throughput elegantly.

### Understanding Lambda's Failure Handling and Retries

When Lambda invokes your function with stream records, the function either succeeds (returns normally) or fails (throws an exception). Here's where DynamoDB Streams' 24-hour retention window becomes critical.

By default, if your function fails, Lambda retries the batch indefinitely until the records expire from the stream after 24 hours. This automatic retry behavior is simple but can lead to problems: if your function has a persistent bug, it will retry hundreds of times, consuming concurrency and generating costs without ever succeeding.

To handle failures more intelligently, you can configure two important settings:

**Function Response Types** determine how Lambda interprets your function's return value. In `ReportBatchItemFailures` mode, your function should return an object indicating which specific records failed within the batch, allowing Lambda to retry only those records while considering others successful. This is far more nuanced than the default behavior of retrying the entire batch if anything fails.

Here's what a return value looks like in Node.js using `ReportBatchItemFailures`:

```javascript
exports.handler = async (event) => {
  const failedRecordIds = [];

  for (const record of event.Records) {
    try {
      const { eventName, dynamodb } = record;
      
      if (eventName === 'MODIFY' || eventName === 'INSERT') {
        const newImage = dynamodb.NewImage;
        // Process the record—perhaps sync to OpenSearch
        await syncToOpenSearch(newImage);
      }
    } catch (error) {
      console.error('Failed to process record:', record.eventID, error);
      failedRecordIds.push({
        itemId: record.eventID
      });
    }
  }

  return {
    batchItemFailures: failedRecordIds
  };
};
```

This approach means transient failures (a temporary network blip) get retried, but permanent failures don't cause you to retry forever. It's a significant improvement over default behavior.

**Bisect on Error** is another tool in your failure-handling arsenal. When enabled, if your Lambda function returns an error for a batch of records, Lambda automatically splits the batch in half and retries each half separately. This continues until the batch is reduced to a single record. The benefit is that if one "bad" record is poisoning the entire batch, Lambda will eventually isolate it and can skip it while continuing to process others.

You can enable bisect on error via the CLI:

```bash
aws lambda update-event-source-mapping \
  --uuid <mapping-uuid> \
  --function-response-types ReportBatchItemFailures \
  --bisect-batch-on-function-error true
```

**On-Failure Destinations** let you send records that ultimately couldn't be processed to a dead-letter queue for investigation. After records are retried until they expire or after a maximum number of retries, they can be sent to an SQS queue or SNS topic. This ensures you don't lose visibility into problems—the records are preserved for later analysis.

### IAM Permissions for Stream Processing

Your Lambda execution role needs specific permissions to read from the DynamoDB Stream. These are distinct from permissions to read the table itself. Here's what you need:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "dynamodb:GetRecords",
        "dynamodb:GetShardIterator",
        "dynamodb:DescribeStream",
        "dynamodb:ListStreams",
        "dynamodb:ListTables"
      ],
      "Resource": "arn:aws:dynamodb:region:account-id:table/TableName/stream/*"
    }
  ]
}
```

Breaking these down: `GetRecords` allows Lambda to retrieve the actual records from the stream. `GetShardIterator` enables Lambda to get a position in a shard from which to start reading. `DescribeStream` allows Lambda to inspect the stream's structure and current state. `ListStreams` lets Lambda discover which streams exist. `ListTables` is often included for completeness, though it's not strictly necessary for stream processing.

If your Lambda function needs to do anything beyond reading the stream—like calling DynamoDB again to fetch full items, or writing to another AWS service—you'll need additional permissions. In the OpenSearch example we'll see shortly, you'd also need permissions to write to the OpenSearch domain.

### Real-World Example: Replicating Changes to OpenSearch

Let's bring this together with a practical example. Suppose you have a DynamoDB table of products, and you want to keep an OpenSearch index in sync so you can offer full-text search capabilities to your users.

First, enable the stream on your products table:

```bash
aws dynamodb update-table \
  --table-name products \
  --stream-specification StreamViewType=NEW_AND_OLD_IMAGES,StreamEnabled=true
```

Your Lambda function would look something like this:

```javascript
const AWS = require('aws-sdk');
const { Client } = require('@opensearch-project/opensearch');

const opensearchClient = new Client({
  node: process.env.OPENSEARCH_ENDPOINT
});

exports.handler = async (event) => {
  const failedRecordIds = [];

  for (const record of event.Records) {
    try {
      const { eventName, dynamodb } = record;
      const newImage = dynamodb.NewImage;
      const oldImage = dynamodb.OldImage;

      if (eventName === 'INSERT' || eventName === 'MODIFY') {
        // Convert DynamoDB format to regular JSON
        const productData = unmarshallDynamoDBData(newImage);
        
        await opensearchClient.index({
          index: 'products',
          id: productData.productId,
          body: productData
        });

        console.log(`Indexed product ${productData.productId}`);

      } else if (eventName === 'REMOVE') {
        const oldData = unmarshallDynamoDBData(oldImage);
        
        await opensearchClient.delete({
          index: 'products',
          id: oldData.productId
        });

        console.log(`Deleted product ${oldData.productId}`);
      }

    } catch (error) {
      console.error('Failed to sync record:', record.eventID, error);
      failedRecordIds.push({
        itemId: record.eventID
      });
    }
  }

  return { batchItemFailures: failedRecordIds };
};

// Helper to convert DynamoDB's nested format to plain objects
function unmarshallDynamoDBData(ddbData) {
  const result = {};
  for (const [key, value] of Object.entries(ddbData)) {
    const type = Object.keys(value)[0];
    result[key] = value[type];
  }
  return result;
}
```

When you create the event source mapping:

```bash
aws lambda create-event-source-mapping \
  --event-source-arn arn:aws:dynamodb:us-east-1:123456789012:table/products/stream/2024-01-15T10:00:00.000 \
  --function-name product-opensearch-sync \
  --enabled \
  --starting-position LATEST \
  --batch-size 50 \
  --maximum-batching-window-in-seconds 5 \
  --parallelization-factor 5
```

Your Lambda function's execution role would need permissions like:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "dynamodb:GetRecords",
        "dynamodb:GetShardIterator",
        "dynamodb:DescribeStream",
        "dynamodb:ListStreams"
      ],
      "Resource": "arn:aws:dynamodb:us-east-1:123456789012:table/products/stream/*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "es:ESHttpPut",
        "es:ESHttpDelete"
      ],
      "Resource": "arn:aws:es:us-east-1:123456789012:domain/my-opensearch-domain/*"
    }
  ]
}
```

Now, whenever a product is created, modified, or deleted in DynamoDB, your Lambda function automatically syncs the change to OpenSearch. Your full-text search stays fresh with minimal latency, and you're leveraging the event-driven architecture that makes serverless applications efficient.

### Monitoring and Troubleshooting

Once your setup is live, keep an eye on CloudWatch metrics. Lambda publishes metrics like `Duration`, `Errors`, `Throttles`, and `ConcurrentExecutions`. For stream processing specifically, watch the `OffendingRecordCount` metric—if this climbs, it indicates records are consistently failing.

Also monitor the age of the oldest record in the stream using CloudWatch Insights queries. If records are approaching 24 hours old and your function hasn't processed them, it's a sign that retries are stalled or your function isn't keeping up with throughput.

Set up alarms for function errors and throttling. A throttled function means you need to increase reserved concurrency or tune your parallelization factor downward.

### Best Practices and Considerations

Always use `ReportBatchItemFailures` unless you have a specific reason not to. It's more resilient and gives you finer control over which records actually need retrying.

Start with conservative parallelization factor values and increase gradually as you validate the pattern works reliably. Higher parallelization is tempting for throughput, but it increases costs and concurrency consumption faster than you might expect.

Consider idempotency in your function logic. Because records can be retried, your function should handle the case where the same record is processed multiple times. In the OpenSearch example, reindexing the same document is idempotent, so this isn't a problem—but if you're incrementing counters or appending to lists, you need defensive logic.

Test failure scenarios during development. Intentionally throw errors in your function and observe how Lambda handles retries, backoff, and eventual delivery to dead-letter queues. Understanding this behavior prevents surprises in production.

### Conclusion

DynamoDB Streams with Lambda create a responsive, scalable pattern for reacting to data changes in real time. By understanding the stream view types, configuring event source mappings thoughtfully, implementing proper error handling with `ReportBatchItemFailures`, and securing everything with the right IAM permissions, you build systems that are both efficient and reliable.

The example of syncing DynamoDB changes to OpenSearch demonstrates the power of this architecture: your search index stays fresh without any polling, scheduled jobs, or manual synchronization logic. The same pattern applies to any scenario where you need to react to DynamoDB modifications—triggering notifications, updating derived data, enforcing business rules, or orchestrating complex workflows.

As you build with this pattern, remember that the 24-hour retention window on stream records gives you breathing room for failures, and features like bisect on error and on-failure destinations provide sophisticated failure handling. Start simple, monitor closely, and iterate based on real production behavior.
