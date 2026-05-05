---
title: "SQS Batch Operations: SendMessageBatch and ReceiveMessageBatch for Efficiency"
---

## SQS Batch Operations: SendMessageBatch and ReceiveMessageBatch for Efficiency

Amazon Simple Queue Service (SQS) is a foundational service in the AWS ecosystem, sitting at the heart of many distributed systems that need reliable, decoupled message processing. But here's something many developers overlook: the way you interact with SQS can dramatically affect your application's performance, latency, and cost. That's where batch operations come in.

If you're sending or receiving messages one at a time, you're leaving significant performance on the table. SQS batch APIs—SendMessageBatch and ReceiveMessageBatch—let you handle multiple messages in a single request, slashing API overhead and giving your application the throughput it actually needs. This article will walk you through how batching works, why it matters, and how to implement it effectively in your code.

### Understanding SQS Batch Operations

At their core, SQS batch operations solve a fundamental problem: network latency and API call overhead. When you call `SendMessage` or `ReceiveMessage` individually, you're making a full round trip to AWS for each message. That might not sound like much, but at scale, those round trips become a bottleneck.

Batch APIs compress multiple operations into a single HTTP request. Instead of making ten separate API calls to send ten messages, you make one call that includes all ten messages. The response comes back in a single batch, giving you results for all of them at once. For applications handling thousands of messages per second, this difference is transformative.

The key constraint to remember is straightforward: both SendMessageBatch and ReceiveMessageBatch accept a maximum of 10 messages per request. This isn't arbitrary—it's AWS's way of balancing throughput capacity with request handling efficiency. Understanding this limit is critical for designing your batching strategy.

### The Cost Advantage

SQS billing is tied to API requests, not to the number of messages. Whether you send one message or ten messages in a single request, that's still one billable request. This creates an immediate cost optimization opportunity. If your application sends 10,000 messages per day, you could do that with 10,000 individual SendMessage calls (10,000 billable requests) or with 1,000 SendMessageBatch calls (1,000 billable requests). That's a tenfold reduction in your bill.

For applications operating at serious scale, this compounds rapidly. A system processing one million messages daily could reduce its API costs by 90% simply by switching to batching. That's not just a nice-to-have optimization—it's a fundamental efficiency principle.

### SendMessageBatch: Sending Messages Efficiently

Let's start with putting messages into the queue. SendMessageBatch lets you send up to ten messages in a single call, and each message can have its own attributes, delays, and metadata.

Here's what a basic SendMessageBatch call looks like in Python using boto3:

```python
import boto3
import json

sqs = boto3.client('sqs')
queue_url = 'https://sqs.us-east-1.amazonaws.com/123456789012/my-queue'

# Prepare a batch of messages
messages = [
    {
        'Id': '1',
        'MessageBody': json.dumps({'order_id': 1001, 'customer': 'Alice'}),
        'DelaySeconds': 0
    },
    {
        'Id': '2',
        'MessageBody': json.dumps({'order_id': 1002, 'customer': 'Bob'}),
        'DelaySeconds': 5
    },
    {
        'Id': '3',
        'MessageBody': json.dumps({'order_id': 1003, 'customer': 'Carol'}),
        'DelaySeconds': 0
    }
]

# Send the batch
response = sqs.send_message_batch(
    QueueUrl=queue_url,
    Entries=messages
)

print("Successful:", response['Successful'])
print("Failed:", response.get('Failed', []))
```

Notice the structure: each entry in the batch needs an `Id` (a unique identifier within this batch), a `MessageBody`, and optionally other attributes like `DelaySeconds`. The response comes back with separate lists for successful and failed messages, keyed by that same `Id`.

This is crucial: batch operations don't fail atomically. If you send ten messages and eight succeed while two fail, you get both sets back in the response. You need to handle partial failures. In the example above, the response includes a `Successful` list with entries that were queued and a `Failed` list containing entries that weren't, each marked with the original `Id` so you know exactly which message had the problem.

Here's the same operation in Node.js using the AWS SDK:

```javascript
const { SQSClient, SendMessageBatchCommand } = require('@aws-sdk/client-sqs');

const sqs = new SQSClient({ region: 'us-east-1' });
const queueUrl = 'https://sqs.us-east-1.amazonaws.com/123456789012/my-queue';

const messages = [
    {
        Id: '1',
        MessageBody: JSON.stringify({ order_id: 1001, customer: 'Alice' }),
        DelaySeconds: 0
    },
    {
        Id: '2',
        MessageBody: JSON.stringify({ order_id: 1002, customer: 'Bob' }),
        DelaySeconds: 5
    },
    {
        Id: '3',
        MessageBody: JSON.stringify({ order_id: 1003, customer: 'Carol' }),
        DelaySeconds: 0
    }
];

const command = new SendMessageBatchCommand({
    QueueUrl: queueUrl,
    Entries: messages
});

sqs.send(command).then(response => {
    console.log('Successful:', response.Successful);
    console.log('Failed:', response.Failed || []);
});
```

One important detail: you can attach message attributes to each message in the batch, allowing you to add metadata without bloating the message body. For example, if you wanted to tag certain messages with a priority level, you could include `MessageAttributes` in each entry. This is particularly useful when your consumer needs to filter or route messages based on metadata.

### ReceiveMessageBatch: Retrieving Messages Efficiently

On the consumer side, ReceiveMessageBatch lets you pull up to ten messages from the queue in one call. This is equally important for performance.

```python
import boto3
import json

sqs = boto3.client('sqs')
queue_url = 'https://sqs.us-east-1.amazonaws.com/123456789012/my-queue'

# Receive up to 10 messages
response = sqs.receive_message(
    QueueUrl=queue_url,
    MaxNumberOfMessages=10,
    WaitTimeSeconds=20  # Long polling
)

messages = response.get('Messages', [])

for message in messages:
    print(f"Message ID: {message['MessageId']}")
    print(f"Body: {message['MessageBody']}")
    print(f"Receipt Handle: {message['ReceiptHandle']}")
    
    # Process the message...
    
    # Delete it from the queue when done
    sqs.delete_message(
        QueueUrl=queue_url,
        ReceiptHandle=message['ReceiptHandle']
    )
```

A key concept here is the receipt handle. When you receive a message, SQS gives you a `ReceiptHandle`—a temporary token that proves you've received this specific message. You need that handle to delete the message later. Think of it as a claim ticket: the receipt handle is how you tell SQS "I've processed this message, remove it from the queue."

In Node.js:

```javascript
const { SQSClient, ReceiveMessageCommand, DeleteMessageCommand } = require('@aws-sdk/client-sqs');

const sqs = new SQSClient({ region: 'us-east-1' });
const queueUrl = 'https://sqs.us-east-1.amazonaws.com/123456789012/my-queue';

const receiveCommand = new ReceiveMessageCommand({
    QueueUrl: queueUrl,
    MaxNumberOfMessages: 10,
    WaitTimeSeconds: 20
});

sqs.send(receiveCommand).then(async (response) => {
    const messages = response.Messages || [];
    
    for (const message of messages) {
        console.log(`Message ID: ${message.MessageId}`);
        console.log(`Body: ${message.Body}`);
        
        // Process the message...
        
        // Delete it when done
        const deleteCommand = new DeleteMessageCommand({
            QueueUrl: queueUrl,
            ReceiptHandle: message.ReceiptHandle
        });
        
        await sqs.send(deleteCommand);
    }
});
```

Notice we're using `MaxNumberOfMessages: 10` to request a full batch. We're also using `WaitTimeSeconds: 20`, which enables long polling. Long polling is important for efficiency: instead of the queue immediately returning "no messages available," it waits up to 20 seconds for messages to arrive. This reduces empty polling cycles and saves API calls.

### Handling Partial Failures in Batches

Here's where batch operations require extra care. When you send a batch, individual messages can fail while others succeed. You must handle this explicitly.

Consider this scenario: you're sending ten order messages, but one has a malformed JSON body and one exceeds the SQS message size limit. Those two will be in the `Failed` list; the other eight will be in the `Successful` list. Your code needs to decide what to do with the failures—retry them, log them, send them to a dead-letter queue, or implement some other recovery strategy.

Here's a more robust Python example:

```python
import boto3
import json
import time

sqs = boto3.client('sqs')
queue_url = 'https://sqs.us-east-1.amazonaws.com/123456789012/my-queue'
dlq_url = 'https://sqs.us-east-1.amazonaws.com/123456789012/my-queue-dlq'

def send_messages_with_retry(messages, max_retries=3):
    to_send = [msg.copy() for msg in messages]
    attempt = 0
    
    while to_send and attempt < max_retries:
        attempt += 1
        print(f"Attempt {attempt}: sending {len(to_send)} messages")
        
        response = sqs.send_message_batch(
            QueueUrl=queue_url,
            Entries=to_send
        )
        
        # Handle successful messages
        successful_ids = {msg['Id'] for msg in response.get('Successful', [])}
        print(f"Successfully sent: {len(successful_ids)}")
        
        # Prepare failed messages for retry
        failed_messages = response.get('Failed', [])
        to_send = [msg for msg in to_send if msg['Id'] not in successful_ids]
        
        if not to_send:
            break
        
        # Log failures
        for failed in failed_messages:
            print(f"Message {failed['Id']} failed: {failed['Code']} - {failed['Message']}")
        
        # Back off before retry
        time.sleep(2 ** attempt)
    
    # Send remaining failures to DLQ
    if to_send:
        print(f"Giving up on {len(to_send)} messages, sending to DLQ")
        for msg in to_send:
            msg_copy = msg.copy()
            msg_copy['MessageBody'] = json.dumps({
                'original_message': json.loads(msg['MessageBody']),
                'reason': 'Failed to send after retries'
            })
            sqs.send_message(
                QueueUrl=dlq_url,
                MessageBody=msg_copy['MessageBody']
            )

# Example usage
messages = [
    {'Id': '1', 'MessageBody': json.dumps({'order_id': 1001})},
    {'Id': '2', 'MessageBody': json.dumps({'order_id': 1002})},
    {'Id': '3', 'MessageBody': json.dumps({'order_id': 1003})},
]

send_messages_with_retry(messages)
```

This example demonstrates a real-world pattern: try to send the batch, capture which messages failed, retry only the failures with exponential backoff, and eventually move stubborn failures to a dead-letter queue for manual inspection.

### The SDK's Transparent Batching

AWS SDKs also provide higher-level helpers that handle batching transparently. Rather than manually collecting ten messages and calling SendMessageBatch, you can use a resource-level interface that batches behind the scenes.

In boto3, the Queue resource makes this straightforward:

```python
import boto3
import json
from boto3.sqs.transfer_config import SQSTransferConfig

sqs = boto3.resource('sqs', region_name='us-east-1')
queue = sqs.Queue('https://sqs.us-east-1.amazonaws.com/123456789012/my-queue')

# Using the Queue.batch_entries context manager
with queue.batch_entries(max_messages=100, visibility_timeout=300) as batch:
    for i in range(25):
        batch.send_message(
            MessageBody=json.dumps({'order_id': 1000 + i})
        )
    # Messages are automatically sent in batches of up to 10
    # when you exit the context manager or reach 100 messages
```

This interface accumulates messages and automatically sends them in batches of ten when the context manager exits or when you've accumulated enough messages. You don't have to think about the batching logic—the SDK handles it. This is great for simplicity but gives you less control over timing and error handling compared to explicit batch calls.

For receiving, boto3's Queue resource provides iteration:

```python
# Receive and process messages indefinitely
for message in queue.receive_messages(MaxNumberOfMessages=10, WaitTimeSeconds=20):
    print(f"Processing: {message.body}")
    # Do work...
    message.delete()
```

This will continuously receive batches of up to ten messages and yield them one at a time. Again, it's clean and simple, but if you need granular control over batch handling or error recovery, the explicit client API gives you more visibility.

### Architectural Patterns for Batching

Batching isn't just a micro-optimization—it influences how you design your system. Here are a few patterns worth considering:

**The accumulator pattern** is useful when you're generating messages from an event stream. Rather than sending each event immediately, you collect events into a buffer, and when the buffer reaches ten messages or a timeout expires, you flush it as a batch. This requires a small amount of state management but provides excellent throughput.

**The fan-out and gather pattern** works well when you have many sources producing messages. Each producer sends to the queue independently (potentially using batching), and a single consumer or small pool of consumers reads messages in batches, processes them in parallel, and acknowledges them back to the queue.

**The priority batching pattern** separates high-priority and low-priority messages into different queues. High-priority messages are sent and received immediately (possibly with smaller batches), while low-priority messages accumulate into larger batches before processing. This gives you flexibility to trade latency for throughput.

### Message Size and Batch Limits

Be aware of the interaction between batch operations and message size limits. SQS has a maximum message size of 256 KB. If you're batching, each individual message still must be under this limit. The batch request itself has a size limit (around 256 KB as well), so you can't simply cram ten 250 KB messages into a batch—that would exceed the batch request size.

In practice, this means you need to be mindful of message sizes when designing your batch strategy. Small messages (a few hundred bytes to a few KB) batch beautifully. Large messages (say, 50 KB each) will limit how many you can truly batch together.

### Monitoring Batch Operations

When you adopt batching, your CloudWatch metrics change. API calls decrease (which is good for cost), but throughput and latency patterns shift. Monitor these metrics to understand the effect:

- **ApproximateNumberOfMessagesVisible** tells you how many messages are pending in the queue. Sudden increases might indicate your consumer isn't keeping up.
- **NumberOfMessagesSent** and **NumberOfMessagesReceived** show throughput. You'll see these increase with fewer individual API calls.
- **SendMessageBatch and ReceiveMessage operation counts** will decrease relative to traditional APIs, but your overall message throughput may increase.

A well-tuned batch implementation should show fewer API calls with higher message throughput, resulting in lower costs and better latency for your application.

### Common Pitfalls and How to Avoid Them

**Not handling partial failures** is the most common mistake. Developers often assume that if the SendMessageBatch call succeeds (returns HTTP 200), all messages were sent. That's incorrect. You must inspect the response and handle failures individually.

**Ignoring message ordering** is another subtle issue. SQS queues are designed to maintain FIFO order only if you're using a FIFO queue. Standard queues don't guarantee order. If your application requires strict message ordering, use an SQS FIFO queue and be aware that batching still works, but you'll need to manage order carefully.

**Blocking on batch operations** can degrade performance if you're not careful. If you accumulate messages and only send when you have ten, but your application only generates three messages per second, you might have significant latency while waiting to batch. Balance batch size against acceptable latency for your use case.

**Not cleaning up receipt handles** is a resource leak. Receipt handles stay valid until a message is acknowledged (deleted) or its visibility timeout expires. If your consumer receives messages but crashes before deletion, those messages will become visible again after the visibility timeout. This is actually good for fault tolerance, but be aware of it.

### Conclusion

SQS batch operations are a straightforward but powerful optimization. SendMessageBatch and ReceiveMessageBatch reduce your API call volume by an order of magnitude, directly lowering costs while improving throughput. The ten-message limit per batch is generous for most workloads, and the SDK provides both transparent batching helpers and low-level APIs for explicit control.

The key to effective batching is understanding that batch operations can have partial failures—you must handle each message's success or failure individually. Build robust error handling and retry logic into your batch operations, and consider using dead-letter queues for messages that repeatedly fail.

Start by identifying bottlenecks in your current SQS usage. If you're making many individual SendMessage or ReceiveMessage calls, switching to batch operations will immediately improve performance and reduce cost. The effort is modest, and the gains are real.
