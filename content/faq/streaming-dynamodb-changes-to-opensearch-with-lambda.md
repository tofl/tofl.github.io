---
title: "Streaming DynamoDB Changes to OpenSearch with Lambda"
---

## Streaming DynamoDB Changes to OpenSearch with Lambda

When your application grows beyond simple key-value lookups, you inevitably face a familiar problem: users want to search your data. They want full-text search, fuzzy matching, filtering across multiple fields, and relevance scoring. DynamoDB, for all its strengths, doesn't excel at these search capabilities. That's where OpenSearch enters the picture.

The solution involves creating a real-time pipeline that mirrors your DynamoDB data into OpenSearch, keeping both systems in sync. Every time a record is created, updated, or deleted in DynamoDB, that change flows through Lambda to OpenSearch, maintaining a searchable index without requiring application code changes. This pattern is elegant, scalable, and has become a standard architectural approach for AWS applications that blend transactional and search workloads.

In this article, we'll build exactly that. We'll walk through enabling DynamoDB Streams, writing a Lambda function that consumes stream events, transforming data, making authenticated requests to OpenSearch, and handling the complexities that arise in real-world scenarios like retries and partial batch failures.

### Understanding the Architecture

Before writing code, let's establish what's happening at a high level. DynamoDB Streams capture changes to your table—insertions, updates, and deletions—and make them available as a time-ordered stream of records. Lambda can be configured as a consumer of these stream events, triggering automatically whenever changes occur.

The Lambda function acts as a translator and coordinator. It receives batch events from DynamoDB Streams, transforms each record into a format suitable for OpenSearch, and uses OpenSearch's bulk API to index multiple documents in a single request. OpenSearch, which is an open-source fork of Elasticsearch, provides full-text search, complex filtering, and relevance-based ranking that DynamoDB simply cannot offer.

This architecture creates what's sometimes called a "read replica" or "search index" pattern. Your DynamoDB table remains the system of record for transactional consistency, while OpenSearch becomes a specialized search view optimized for discovery and analytics.

### Enabling DynamoDB Streams

The first requirement is enabling DynamoDB Streams on your table. If your table already exists, you'll need to update it; if you're creating a new table, you can enable streams during creation.

When you enable streams, you specify a view type that determines what information appears in each stream record. The options are:

- **KEYS_ONLY** includes just the key attributes of the modified item
- **NEW_IMAGE** includes the entire item after the modification
- **OLD_IMAGE** includes the entire item before the modification
- **NEW_AND_OLD_IMAGES** includes both the before and after state

For our use case of indexing into OpenSearch, **NEW_IMAGE** is typically sufficient—we want the current state of each item to be indexed. If you're building audit trails or complex reconciliation logic, you might choose NEW_AND_OLD_IMAGES, but that increases storage and network overhead.

Using the AWS CLI, enabling streams on an existing table looks like this:

```bash
aws dynamodb update-table \
  --table-name Products \
  --stream-specification StreamEnabled=true,StreamViewType=NEW_IMAGE \
  --region us-east-1
```

Once enabled, DynamoDB begins capturing changes immediately. The stream exists for 24 hours, which gives your Lambda function a generous window to consume records even if it experiences temporary issues.

### Creating the Lambda Function with Stream Trigger

Next, create a Lambda function and configure it to consume from the DynamoDB Stream. The function's execution role needs permissions to read from the stream.

Here's the IAM policy required:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "dynamodb:GetRecords",
        "dynamodb:GetItem",
        "dynamodb:ListStreams",
        "dynamodb:ListDynamoDBStreams",
        "dynamodb:DescribeStream"
      ],
      "Resource": "arn:aws:dynamodb:us-east-1:123456789012:table/Products/stream/*"
    }
  ]
}
```

The Lambda function processes stream records in batches, typically between 10 and 100 records depending on configuration. Each record contains metadata about the change and the item data itself.

### Building the Lambda Handler

Now for the core logic. Here's a Node.js implementation that handles DynamoDB Stream events and indexes them into OpenSearch:

```javascript
const https = require('https');
const aws4 = require('aws4');
const { defaultProvider } = require('@aws-sdk/credential-provider-node');

const OPENSEARCH_DOMAIN = process.env.OPENSEARCH_DOMAIN;
const OPENSEARCH_REGION = process.env.OPENSEARCH_REGION;
const OPENSEARCH_INDEX = 'products';

exports.handler = async (event) => {
  console.log('Received event with', event.Records.length, 'records');
  
  const bulkPayload = [];
  
  for (const record of event.Records) {
    const streamRecord = record.dynamodb;
    
    // Extract the operation type
    const eventName = record.eventName; // INSERT, MODIFY, REMOVE
    
    if (eventName === 'REMOVE') {
      // For deletions, we add a delete operation to bulk request
      const item = streamRecord.Keys;
      bulkPayload.push({
        delete: {
          _index: OPENSEARCH_INDEX,
          _id: item.productId.S
        }
      });
    } else {
      // For inserts and updates, we add the document
      const item = transformItem(streamRecord.NewImage);
      
      bulkPayload.push({
        index: {
          _index: OPENSEARCH_INDEX,
          _id: item.productId
        }
      });
      bulkPayload.push(item);
    }
  }
  
  if (bulkPayload.length === 0) {
    return { statusCode: 200, message: 'No items to process' };
  }
  
  try {
    await indexToOpenSearch(bulkPayload);
    console.log('Successfully indexed', Math.floor(bulkPayload.length / 2), 'documents');
    return { statusCode: 200, message: 'Success' };
  } catch (error) {
    console.error('Error indexing to OpenSearch:', error);
    // Re-throw to trigger Lambda retry logic
    throw error;
  }
};

function transformItem(dynamodbItem) {
  // Convert DynamoDB attribute format to plain JavaScript object
  const item = {};
  
  for (const [key, value] of Object.entries(dynamodbItem)) {
    item[key] = unmarshallValue(value);
  }
  
  // Add a timestamp for sorting/filtering
  item.indexedAt = new Date().toISOString();
  
  return item;
}

function unmarshallValue(value) {
  // Handle DynamoDB type descriptors
  if (value.S) return value.S;           // String
  if (value.N) return Number(value.N);   // Number
  if (value.BOOL) return value.BOOL;     // Boolean
  if (value.NULL) return null;           // Null
  if (value.M) {                         // Map
    const obj = {};
    for (const [k, v] of Object.entries(value.M)) {
      obj[k] = unmarshallValue(v);
    }
    return obj;
  }
  if (value.L) {                         // List
    return value.L.map(unmarshallValue);
  }
  return value;
}

async function indexToOpenSearch(bulkPayload) {
  const credentials = await defaultProvider()();
  
  // Format bulk payload as NDJSON
  const body = bulkPayload
    .map(line => JSON.stringify(line))
    .join('\n') + '\n';
  
  // Create a signed request using AWS SigV4
  const options = {
    host: OPENSEARCH_DOMAIN,
    port: 443,
    path: '/_bulk',
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-ndjson',
      'Content-Length': Buffer.byteLength(body)
    }
  };
  
  // Sign the request
  const signed = aws4.sign(options, {
    accessKeyId: credentials.accessKeyId,
    secretAccessKey: credentials.secretAccessKey,
    sessionToken: credentials.sessionToken
  });
  
  return new Promise((resolve, reject) => {
    const req = https.request(signed, (res) => {
      let data = '';
      
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const response = JSON.parse(data);
          
          if (response.errors) {
            // Check for any errors in the bulk response
            const errors = response.items
              .map((item, idx) => ({
                idx,
                error: item.index?.error || item.delete?.error
              }))
              .filter(e => e.error);
            
            if (errors.length > 0) {
              console.error('Bulk indexing errors:', errors);
              reject(new Error(`Bulk indexing failed: ${errors.length} items failed`));
            } else {
              resolve(response);
            }
          } else {
            resolve(response);
          }
        } catch (e) {
          reject(e);
        }
      });
    });
    
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}
```

This implementation handles the essential mechanics: extracting stream records, building a bulk request, signing it with AWS SigV4 (required for OpenSearch domains secured with IAM), and parsing the response.

### Understanding the Event Types

DynamoDB Streams send three types of events, and your Lambda should handle each appropriately:

**INSERT** events occur when a new item is added to the table. You'll want to index the complete item into OpenSearch. In the code above, we treat INSERT the same as MODIFY—both result in an index operation that either creates or updates the OpenSearch document.

**MODIFY** events happen when an existing item is updated. The stream record includes only the attributes that changed (unless you configured the stream view type to include the full before and after states). When you receive a MODIFY event, re-index the entire item. This is why we specified NEW_IMAGE as the stream view type—it ensures each record contains the complete item state.

**REMOVE** events occur when items are deleted. When handling removal, you should delete the corresponding document from OpenSearch. In the code, we use the delete operation within the bulk API to remove documents.

It's critical that your OpenSearch document IDs match your DynamoDB item keys. In this example, we use the productId as the _id in OpenSearch. This ensures that updates and deletes reference the correct document.

### Authentication and IAM Permissions

If your OpenSearch domain is accessed via the public internet (which many development and small production instances are), you'll need to sign requests using AWS Signature Version 4 (SigV4). This provides authentication without requiring password management.

The Lambda execution role needs permissions to access OpenSearch. Here's the IAM policy:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "es:ESHttpPut",
        "es:ESHttpPost",
        "es:ESHttpDelete",
        "es:ESHttpGet"
      ],
      "Resource": "arn:aws:es:us-east-1:123456789012:domain/my-domain/*"
    }
  ]
}
```

The `aws4` npm package handles SigV4 signing. When you sign the request, include the credentials from your Lambda execution role, which are automatically available via the credential provider chain. The signed headers include an Authorization header that OpenSearch validates server-side.

### Using the Bulk API Efficiently

The OpenSearch bulk API is designed for high-throughput indexing. Instead of making one HTTP request per document, you batch multiple operations into a single request. This dramatically reduces overhead.

The bulk API uses NDJSON (newline-delimited JSON) format. Each line is a complete JSON object. For index operations, you provide two lines per document: a metadata line describing the operation, followed by the document itself. Delete operations require only the metadata line.

A bulk request might look like this:

```
{"index":{"_index":"products","_id":"prod-123"}}
{"productId":"prod-123","name":"Widget","price":29.99,"indexedAt":"2024-01-15T10:30:00Z"}
{"index":{"_index":"products","_id":"prod-456"}}
{"productId":"prod-456","name":"Gadget","price":49.99,"indexedAt":"2024-01-15T10:30:00Z"}
{"delete":{"_index":"products","_id":"prod-789"}}
```

Batch sizes matter for performance. DynamoDB Streams typically deliver between 10 and 100 records per Lambda invocation. In most cases, you can safely send all records in a single bulk request without worrying about OpenSearch's size limits. However, if you're using aggressive DynamoDB Streams batching settings, you might construct a bulk request with thousands of operations, which could hit OpenSearch timeouts. In that scenario, consider splitting large bulk payloads into chunks of 500 or 1000 operations.

### Handling Errors and Retries

Lambda automatically retries stream processing on failure. When your handler throws an error, Lambda re-invokes it with the same batch. The stream maintains the event order, ensuring that older changes are processed before newer ones.

However, not all errors are equal. An OpenSearch timeout should trigger a retry. A malformed request that causes a 400 error repeatedly will never succeed by retrying the same code. Distinguish between transient and permanent errors.

In the code example above, we extract individual item errors from the bulk response. OpenSearch returns a 200 status even if some items failed indexing. You must parse the response body to detect these partial failures. If you decide to fail the entire batch when individual items fail, the batch retries. Alternatively, you could log failed items and continue, accepting eventual consistency.

Here's how to implement more sophisticated error handling:

```javascript
async function indexToOpenSearch(bulkPayload) {
  const credentials = await defaultProvider()();
  
  const body = bulkPayload
    .map(line => JSON.stringify(line))
    .join('\n') + '\n';
  
  const options = {
    host: OPENSEARCH_DOMAIN,
    port: 443,
    path: '/_bulk',
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-ndjson',
      'Content-Length': Buffer.byteLength(body)
    }
  };
  
  const signed = aws4.sign(options, {
    accessKeyId: credentials.accessKeyId,
    secretAccessKey: credentials.secretAccessKey,
    sessionToken: credentials.sessionToken
  });
  
  return new Promise((resolve, reject) => {
    const req = https.request(signed, (res) => {
      let data = '';
      
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        // Non-2xx responses suggest a transient issue
        if (res.statusCode >= 500) {
          reject(new Error(`OpenSearch returned ${res.statusCode}`));
          return;
        }
        
        try {
          const response = JSON.parse(data);
          
          if (response.errors) {
            const failedItems = response.items
              .map((item, idx) => ({
                idx,
                error: item.index?.error || item.delete?.error
              }))
              .filter(e => e.error);
            
            // Log failures for debugging, but don't fail the batch
            if (failedItems.length > 0) {
              console.warn('Some items failed indexing:', failedItems);
            }
          }
          
          resolve(response);
        } catch (e) {
          reject(e);
        }
      });
    });
    
    req.on('error', reject);
    req.setTimeout(10000, () => {
      req.destroy();
      reject(new Error('OpenSearch request timeout'));
    });
    req.write(body);
    req.end();
  });
}
```

This version is more lenient with partial failures but strict about connection issues, which are genuinely transient.

### Handling Large-Scale Scenarios

As your application grows, you might face scenarios where DynamoDB Streams delivers hundreds of changes per second. A single Lambda function instance might struggle to keep up if indexing is slow or OpenSearch becomes a bottleneck.

Lambda's concurrency scaling handles this automatically—multiple function instances process stream batches in parallel. However, they all write to the same OpenSearch domain. OpenSearch has throughput limits measured in indexing requests per second. If Lambda is submitting bulk requests faster than OpenSearch can process them, you'll see failures.

To manage this, consider two approaches. First, increase OpenSearch's capacity by adding more data nodes. Second, implement backpressure by inserting delays when OpenSearch begins rejecting requests. You could also use a queue like SQS as an intermediate buffer, having Lambda publish events to SQS and a separate fleet of workers consume from SQS at a controlled pace.

For most applications, though, the default setup scales well. DynamoDB Streams batching and Lambda's built-in retry mechanism create a natural rate limiter.

### Deployment Considerations

When deploying this Lambda function, ensure:

- Environment variables for OPENSEARCH_DOMAIN and OPENSEARCH_REGION are set correctly. The domain value should be the full endpoint like `search-my-domain-abc123.us-east-1.es.amazonaws.com`.
- The function's timeout is set appropriately. With network I/O involved, a 60-second timeout is reasonable.
- Memory allocation is adequate. For typical batch sizes, 256 MB is sufficient, though 512 MB provides faster CPU and better performance.
- The DynamoDB Stream event source is properly configured with the stream ARN, batch size, and starting position set to LATEST.

When you create the event source mapping between the DynamoDB Stream and Lambda, choose LATEST as the starting position if you're deploying to existing tables. This avoids processing the entire historical backlog. For new tables, TRIM_HORIZON processes all available records.

### Testing Your Pipeline

Before deploying to production, validate the pipeline locally and in a test environment. Insert items into your test DynamoDB table, invoke the Lambda function manually with a test event, and verify that documents appear in OpenSearch.

A minimal test event looks like:

```json
{
  "Records": [
    {
      "eventID": "1",
      "eventVersion": "1.0",
      "dynamodb": {
        "Keys": {
          "productId": { "S": "test-123" }
        },
        "NewImage": {
          "productId": { "S": "test-123" },
          "name": { "S": "Test Product" },
          "price": { "N": "99.99" }
        }
      },
      "eventName": "INSERT",
      "eventSource": "aws:dynamodb"
    }
  ]
}
```

After invoking the function, query OpenSearch to confirm the document was indexed:

```bash
curl -X GET \
  "https://search-my-domain-abc123.us-east-1.es.amazonaws.com/products/_doc/test-123"
```

### Monitoring and Observability

CloudWatch Logs capture everything your Lambda function logs. Use structured logging to track how many records were processed, how many succeeded, and any errors encountered. CloudWatch Metrics track Lambda invocations, errors, and duration.

OpenSearch also provides monitoring. You can query the cluster health endpoint to understand index size, shard allocation, and any issues:

```bash
curl -X GET "https://search-my-domain-abc123.us-east-1.es.amazonaws.com/_cluster/health"
```

Consider setting up CloudWatch alarms for Lambda error rates. If errors spike, you want to know immediately. Similarly, monitor OpenSearch's indexing rate and available disk space.

### Conclusion

Building a real-time search capability by streaming DynamoDB changes to OpenSearch is a powerful pattern that enables modern search experiences without burdening your primary data store. The architecture is straightforward: DynamoDB Streams provide the change feed, Lambda orchestrates the transformation and delivery, and OpenSearch provides the search engine.

The implementation requires attention to detail—correctly formatting DynamoDB attributes, handling the three event types, signing requests with SigV4, and gracefully managing errors. But once in place, the system runs reliably, scales automatically, and keeps your search index synchronized with your transactional data.

From this foundation, you can extend the pattern further. Add filtering logic to index only certain items. Transform data during the indexing step to optimize for search relevance. Implement custom analyzers in OpenSearch to improve full-text matching. The core pipeline remains the same—a Lambda function bridging two complementary AWS services to create an application capability neither alone could provide.
