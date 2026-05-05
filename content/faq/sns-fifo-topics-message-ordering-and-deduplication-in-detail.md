---
title: "SNS FIFO Topics: Message Ordering and Deduplication in Detail"
---

## SNS FIFO Topics: Message Ordering and Deduplication in Detail

When you're building distributed systems on AWS, the order in which messages arrive can mean everything. Imagine processing an order: you need payment confirmation before inventory deduction, which must happen before shipment. In a standard publish-subscribe system, these events might arrive out of sequence, creating chaos. This is where SNS FIFO topics step in—they guarantee that messages within a logical group arrive in the exact order they were sent, and they prevent duplicates from cluttering your system. Understanding how to architect with SNS FIFO topics is crucial for building reliable, order-dependent workflows on AWS.

### Understanding SNS FIFO: The Fundamentals

SNS FIFO (First-In-First-Out) topics are a specialized variant of the standard SNS topic service designed specifically for applications that require strict message ordering and deduplication. Unlike standard SNS topics, which prioritize high throughput and are optimized for fanout to many subscribers, FIFO topics trade some of that throughput capacity for the guarantee that messages will be delivered in the order they arrive.

The core mechanism behind SNS FIFO ordering is the **message group ID**. When you publish a message to a FIFO topic, you must include a message group ID—a string identifier that logically groups related messages together. All messages published to the same message group ID are guaranteed to be delivered to each subscriber in the strict order they were sent. This is the foundation of everything else FIFO provides.

Think of message group IDs like checkout lanes in a grocery store. Each lane (group ID) processes customers (messages) in strict order—the first person to get in line is the first person to leave. However, if you have multiple lanes open, customers in different lanes can be processed in parallel. Similarly, different message group IDs can have their messages delivered concurrently, but within each group, order is ironclad.

### The Message Group ID: Organizing Messages for Order

The message group ID is not optional—it's a mandatory parameter when publishing to an SNS FIFO topic. This design ensures that every message is explicitly assigned to a logical sequence. The choice of what value to use for the message group ID is yours and should reflect your business logic.

In an e-commerce order fulfillment system, you might use the order ID as the message group ID. All events related to order 12345 (payment processed, inventory reserved, shipment created, delivery attempted) would share the same group ID. The SNS FIFO topic guarantees that subscribers receive these events in the exact sequence your application published them. This prevents a situation where a subscriber sees "shipment created" before "payment processed."

The message group ID is a string, and you can use any identifier that makes sense for your domain. Common patterns include customer IDs, order IDs, transaction IDs, or account IDs—essentially any natural identifier around which you want to enforce sequential processing.

It's worth noting that the throughput of a single message group ID is important to understand. Within a single message group, messages are processed sequentially, which means you won't get the parallel processing benefits that different group IDs can provide. If you make your message group ID too broad (like using a single ID for all messages), you lose the ability to process messages in parallel across different logical sequences.

### Throughput Limits: The Trade-Off for Ordering

SNS FIFO topics have explicit throughput limits that differ significantly from standard SNS topics. These limits are a direct consequence of the ordering guarantee—maintaining strict sequence requires more careful management of message flow.

An SNS FIFO topic can handle up to **300 messages per second** by default. If you need higher throughput, you can request an increase, and AWS can provision up to **3,000 messages per second**. This is substantially lower than the effectively unlimited throughput of standard SNS topics, which can scale to handle millions of messages per second across many topics.

However, this limit applies at the topic level, not per message group ID. This is an important distinction. If you have ten message groups publishing to the same FIFO topic, their combined message rate must not exceed your provisioned throughput. Each message group ID doesn't get its own separate quota—they all share the same pool.

In practical terms, this means you need to think carefully about your message volume and partition strategy when designing with FIFO topics. If you know you'll receive 5,000 messages per second total across all your order IDs, you'll need to request a throughput increase beyond the default 300 messages per second. You should request the increase preemptively, as provisioning can take time and you don't want to be throttled by AWS when your system is under load.

One way to mitigate throughput concerns is to use batching. Instead of publishing individual events, you can bundle related events into a single message and publish them together. This reduces the total message count while preserving order within each group.

### Deduplication: Eliminating Duplicate Messages

Network failures, retry logic, and distributed system hiccups can cause the same message to be published multiple times. Without deduplication, your subscribers might process the same order payment twice, apply the same discount twice, or create duplicate records. SNS FIFO topics address this with a built-in deduplication mechanism.

SNS FIFO topics maintain a **5-minute deduplication window**. Within this window, the system detects and suppresses duplicate messages. The deduplication check can work in two ways: content-based deduplication or explicit deduplication ID-based deduplication.

With **content-based deduplication**, SNS computes an SHA-256 hash of the message body and uses that hash to detect duplicates. If the same message body is published twice within the 5-minute window to the same message group ID, the second publish is suppressed and never delivered to subscribers. This approach requires no additional configuration—it works automatically once enabled on the topic.

The advantage of content-based deduplication is simplicity: you don't need to generate and manage deduplication IDs in your application code. The disadvantage is that it's quite strict. Two messages with identical content will be treated as duplicates, even if you intended them to be separate events. For example, if two customers place identical orders (same items, same quantities) at nearly the same time, content-based deduplication might suppress one of them if they happen to land in the same 5-minute window.

The more flexible alternative is **explicit deduplication ID-based deduplication**. When you publish a message to a FIFO topic, you can provide a deduplication ID—a unique identifier for that specific message. SNS tracks these IDs for 5 minutes and suppresses any message with a deduplication ID it has already seen, regardless of the message content.

Here's a practical example using the AWS SDK for Python (Boto3):

```python
import boto3
import hashlib

sns_client = boto3.client('sns')

# Publishing with an explicit deduplication ID
order_event = {
    'order_id': '12345',
    'action': 'payment_processed',
    'amount': 99.99
}

# Generate a unique ID for this event
dedup_id = f"{order_event['order_id']}-{order_event['action']}-{int(time.time() * 1000)}"

response = sns_client.publish(
    TopicArn='arn:aws:sns:us-east-1:123456789012:order-events.fifo',
    Message=json.dumps(order_event),
    MessageGroupId='order-12345',
    MessageDeduplicationId=dedup_id
)
```

With explicit deduplication IDs, you have full control over what counts as a duplicate. You decide whether two events are truly the same or merely similar. This is particularly valuable in scenarios where the same event structure might represent different business operations.

The deduplication window is exactly 5 minutes—no more, no less. After 5 minutes have elapsed since a message was first published, its deduplication ID is removed from the tracking system. A message with the same deduplication ID published more than 5 minutes later will not be deduplicated; it will be treated as a new message. This window is a deliberate design choice: it's long enough to catch most network retries and application-level retries, but not so long that it creates unbounded storage requirements for tracking IDs.

### Subscriber Constraints: Only FIFO Queues Need Apply

Here's a critical constraint that surprises many developers: SNS FIFO topics can only deliver messages to **SQS FIFO queues**. You cannot subscribe a standard SQS queue, Lambda function, HTTP endpoint, email address, or SMS number to an SNS FIFO topic.

This might seem like a limitation, but it's actually a thoughtful design decision. SNS FIFO is fundamentally about guaranteeing order. If you could deliver to a Lambda function directly, there's no guarantee the Lambda would process those invocations in order—Lambda is designed for concurrent, parallel execution. If you could deliver to HTTP endpoints, there's no guarantee about network or client ordering. By restricting subscriptions to SQS FIFO queues, AWS ensures that the ordering guarantee it makes to you is actually deliverable end-to-end.

SQS FIFO queues, by design, process messages in order and support the same message group ID concept as SNS FIFO topics. The two services were built to work together seamlessly. When you publish a message to an SNS FIFO topic with a group ID, and that topic has subscribed SQS FIFO queues, the message is delivered to those queues and they respect the same group ID ordering.

If you need to deliver to Lambda, standard SQS queues, or other endpoints, you have options. One approach is to use SQS FIFO as an intermediary: publish to SNS FIFO, subscribe an SQS FIFO queue, then have Lambda consume from that queue. Lambda can then invoke other services. The order is maintained up to the queue, and Lambda processes messages in the order they arrive in the queue (assuming you configure it to process one batch at a time).

### Costs and Practical Implications

SNS FIFO topics are priced identically to standard SNS topics on a per-message basis. There's no premium charge for the ordering and deduplication features. In most AWS regions, you pay roughly $0.50 per million messages published to SNS, whether they go to a standard or FIFO topic.

However, the lower throughput limits mean you might need to use multiple topics or partition your message groups differently than you would with standard topics. This can have indirect cost implications. If you're currently using one standard topic and need to switch to FIFO, you might find you need to increase your SQS queue capacity or adjust your architecture in ways that affect overall cost.

Additionally, remember that SNS charges for publishing and for subscriptions (in some regions), but not for the storage or deduplication tracking itself. The 5-minute deduplication window doesn't add to your costs—it's part of the service.

### A Complete Example: Order Fulfillment Workflow

Let's walk through a realistic order fulfillment scenario to see how SNS FIFO topics, message group IDs, deduplication, and the subscription model come together.

Imagine an e-commerce platform where orders must progress through several state transitions: payment processing, inventory reservation, order confirmation, shipment creation, and delivery. Each transition triggers an event that must happen in strict order. If the system processes "shipment created" before "payment processed," the order will be corrupted.

Here's the architecture:

- An SNS FIFO topic named `order-events.fifo` receives all order-related events.
- An SQS FIFO queue named `order-processing.fifo` subscribes to the topic.
- A Lambda function consumes messages from the queue and applies the state transitions.
- A second SQS FIFO queue named `fulfillment.fifo` subscribes to the same topic and feeds a separate fulfillment service.

When an order is placed, the ordering service publishes events:

```python
import boto3
import json
from datetime import datetime

sns = boto3.client('sns')

order_id = 'ORD-2024-001'
topic_arn = 'arn:aws:sns:us-east-1:123456789012:order-events.fifo'

events = [
    {'status': 'payment_initiated', 'amount': 150.00},
    {'status': 'payment_completed', 'amount': 150.00},
    {'status': 'inventory_reserved', 'sku': 'PROD-789', 'quantity': 2},
    {'status': 'order_confirmed', 'confirmation_code': 'CONF-12345'},
    {'status': 'shipment_created', 'tracking_number': 'TRK-987654'},
]

for i, event in enumerate(events):
    event['order_id'] = order_id
    event['timestamp'] = datetime.utcnow().isoformat()
    
    # Use order ID as the message group to ensure order
    # Use a combination of order ID and event index as dedup ID
    dedup_id = f"{order_id}-{i}-{event['status']}"
    
    sns.publish(
        TopicArn=topic_arn,
        Message=json.dumps(event),
        MessageGroupId=order_id,  # All events for this order are in the same group
        MessageDeduplicationId=dedup_id
    )
    
print(f"Published {len(events)} events for order {order_id}")
```

Each published message includes:
- **MessageGroupId**: Set to the order ID, ensuring all events for this order are processed sequentially.
- **MessageDeduplicationId**: A unique identifier combining the order ID, event index, and status. If the same event is published twice (due to a retry), SNS recognizes it within the 5-minute window and suppresses the duplicate.

The SQS FIFO queue `order-processing.fifo` receives these messages in order. A Lambda function consumes them:

```python
import json
import boto3

def lambda_handler(event, context):
    """
    Process order state transitions from SQS FIFO queue.
    Messages arrive in strict order per order ID.
    """
    
    for record in event['Records']:
        body = json.loads(record['body'])
        order_data = json.loads(body['Message'])  # SNS wraps the message in a JSON envelope
        
        order_id = order_data['order_id']
        status = order_data['status']
        
        # Process state transitions in order
        if status == 'payment_initiated':
            authorize_payment(order_id, order_data['amount'])
        elif status == 'payment_completed':
            confirm_payment(order_id, order_data['amount'])
        elif status == 'inventory_reserved':
            reserve_inventory(order_id, order_data['sku'], order_data['quantity'])
        elif status == 'order_confirmed':
            create_order_record(order_id, order_data['confirmation_code'])
        elif status == 'shipment_created':
            register_shipment(order_id, order_data['tracking_number'])
        
        print(f"Processed {status} for order {order_id}")
    
    return {'statusCode': 200, 'body': 'Events processed'}

def authorize_payment(order_id, amount):
    # Call payment processor
    pass

def confirm_payment(order_id, amount):
    # Update order database
    pass

def reserve_inventory(order_id, sku, quantity):
    # Update inventory system
    pass

def create_order_record(order_id, confirmation_code):
    # Write to order database
    pass

def register_shipment(order_id, tracking_number):
    # Notify fulfillment system
    pass
```

Because the SQS FIFO queue respects the message group ID from SNS, the Lambda function receives events for order ORD-2024-001 in the exact order they were published. It will never see "shipment_created" before "payment_completed." The deduplication ensures that if a network blip causes an event to be published twice, the duplicate is filtered out by SNS within the 5-minute window, so the Lambda function never sees it twice.

Meanwhile, the fulfillment service consumes from its own SQS FIFO queue subscribed to the same topic. It receives the same events in the same order, allowing it to coordinate fulfillment operations without worrying about out-of-order state changes.

If a second order (ORD-2024-002) is placed simultaneously, its events would use a different message group ID (the new order ID). SNS FIFO would process both orders' events concurrently—they wouldn't block each other—but within each order's sequence, strict ordering is maintained.

### Common Pitfalls and Design Considerations

When working with SNS FIFO, several design decisions require careful thought.

**Choosing the right message group ID** is paramount. If you use a single group ID for all messages (like "global"), you've essentially serialized your entire system—only one message is processed at a time. This defeats much of the benefit. Conversely, if you use a unique group ID for every message, you've lost ordering entirely. The sweet spot is using a group ID that represents a logical entity requiring order—an order ID, customer ID, transaction ID, or account ID.

**Understanding the shared throughput limit** is crucial. If you have multiple message group IDs publishing to the same FIFO topic, their combined rate counts toward the topic's throughput limit. If you publish 300 messages per second with group ID "customer-A" and another 300 with group ID "customer-B", you've exceeded the default limit and will be throttled. Plan your scaling and throughput requests accordingly.

**The 5-minute deduplication window** is both a feature and a constraint. It's long enough to catch most retries but not indefinite. If your application has long retry loops that exceed 5 minutes, you might see duplicates. Conversely, if you need to publish the same message again legitimately after 5 minutes, it will go through. Design your retry logic with this window in mind.

**Testing FIFO behavior** requires attention to the asynchronous nature of the system. Messages aren't processed instantaneously. If you publish a batch of messages and immediately check an external system for their effects, you might find the messages haven't been processed yet. Use proper polling, callbacks, or event-driven testing strategies.

**Cost optimization** with FIFO involves being intentional about message volume and structure. Batching related events into a single message reduces message count and throughput usage. However, if you batch too aggressively, you lose granular control over individual event processing. Strike a balance based on your specific use case.

### Conclusion

SNS FIFO topics are a powerful tool for building ordered, reliable distributed systems on AWS. By combining message group IDs for logical sequencing, deduplication to prevent duplicates, and the restriction to SQS FIFO subscribers, AWS has created a service that guarantees order end-to-end. The trade-off—lower throughput compared to standard topics—is deliberate and reflects the fundamental challenge of maintaining order in distributed systems.

The order fulfillment example demonstrates how these features work together in practice. Real-world scenarios like payment processing, inventory management, and state machines all benefit from the guarantees FIFO provides. As you design applications requiring ordered message delivery, understanding the nuances of message group IDs, deduplication windows, and subscriber constraints will enable you to build systems that are both reliable and performant. The key is thoughtful architecture: choosing the right partition key, anticipating your throughput needs, and designing subscribers to respect the ordering guarantee SNS FIFO provides.
