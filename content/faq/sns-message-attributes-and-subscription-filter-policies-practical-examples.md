---
title: "SNS Message Attributes and Subscription Filter Policies: Practical Examples"
---

## SNS Message Attributes and Subscription Filter Policies: Practical Examples

Imagine you're building an e-commerce platform where different parts of your system need to react to different events. When a customer places an order, your payment processing service springs into action. When payment completes, your fulfillment team gets notified. When the package ships, the customer receives an email. All these events flow through the same SNS topic, but each service cares about only certain messages. Without a filtering mechanism, you'd be wasting resources processing irrelevant events, and your code would be cluttered with conditional logic.

This is exactly where SNS message attributes and subscription filter policies shine. They let you decouple publishers and subscribers while ensuring each subscriber receives only the messages it actually needs. In this guide, we'll explore how these features work together, examine real-world patterns, and walk through the code that makes it all happen.

### Understanding SNS Message Attributes

Before we talk about filtering, let's understand what message attributes are. When you publish a message to an SNS topic, you can attach structured metadata alongside your message body. These attributes are key-value pairs that describe the message without forcing subscribers to parse the message content itself.

Each attribute has three components: a name, a data type, and a value. The name is what you'll reference in your filter policies—something like `EventType` or `OrderAmount`. The data type tells SNS how to interpret the value: it could be a string, a number, or binary data. This matters because filter policies can apply type-specific operators like numeric comparisons.

Here's what a complete message attribute looks like in the AWS SNS API:

```json
{
  "Name": "EventType",
  "DataType": "String",
  "StringValue": "order.created"
}
```

For a number, the structure is similar:

```json
{
  "Name": "OrderAmount",
  "DataType": "Number",
  "StringValue": "149.99"
}
```

Notice that even for numbers, the value goes in `StringValue`. SNS will parse and interpret it based on the `DataType` you specify. There's also `BinaryValue` available if you're sending binary data, though this is less common in typical pub-sub scenarios.

You can attach multiple attributes to a single message. SNS imposes a limit of 10 message attributes per publish call, which is generous enough for most use cases. Keep in mind that message attributes count toward your message size limits, so while they're lightweight, extremely large attribute values aren't ideal.

### Building a Real-World Example: E-Commerce Event Routing

Let's ground this in reality. Suppose you're architecting the event system for an online marketplace. Your system publishes different types of events to a central SNS topic:

- `order.created` when a customer submits an order
- `payment.processed` when payment clears
- `shipment.dispatched` when the package leaves the warehouse
- `shipment.delivered` when it arrives at the customer

Different downstream systems need to react to these events. Your payments service wants to know about `payment.processed` events. Your email service cares about `order.created` and `shipment.delivered`. Your analytics system wants everything. Using message attributes and filter policies, you can route each event type to exactly the right subscribers without duplicating topic subscriptions.

### Publishing Messages with Attributes

Let's look at how you'd publish these events. Here's a Python example using the boto3 library:

```python
import boto3
import json

sns = boto3.client('sns')

def publish_order_event(order_id, customer_id, total_amount, event_type):
    message_body = {
        'order_id': order_id,
        'customer_id': customer_id,
        'total_amount': total_amount,
        'timestamp': '2024-01-15T10:30:00Z'
    }
    
    response = sns.publish(
        TopicArn='arn:aws:sns:us-east-1:123456789012:OrderEvents',
        Message=json.dumps(message_body),
        Subject='Order Event',
        MessageAttributes={
            'EventType': {
                'DataType': 'String',
                'StringValue': event_type
            },
            'OrderAmount': {
                'DataType': 'Number',
                'StringValue': str(total_amount)
            },
            'CustomerTier': {
                'DataType': 'String',
                'StringValue': 'premium' if total_amount > 500 else 'standard'
            }
        }
    )
    
    return response

# Publishing an order creation event
publish_order_event('ORD-12345', 'CUST-67890', 599.99, 'order.created')
```

In this example, we're attaching three attributes to each published message:

- `EventType` tells subscribers what kind of event this is
- `OrderAmount` is a numeric attribute we can use for range filtering
- `CustomerTier` demonstrates conditional attributes—we calculate it based on order value

Each attribute has a name, a data type, and a value. The beauty of this approach is that subscribers don't need to deserialize your entire JSON message body to decide whether they care about it. SNS evaluates the attributes before sending the message to the subscriber.

Here's the equivalent in Node.js using the AWS SDK:

```javascript
const AWS = require('aws-sdk');
const sns = new AWS.SNS();

async function publishOrderEvent(orderId, customerId, totalAmount, eventType) {
  const messageBody = {
    order_id: orderId,
    customer_id: customerId,
    total_amount: totalAmount,
    timestamp: new Date().toISOString()
  };
  
  const customerTier = totalAmount > 500 ? 'premium' : 'standard';
  
  const params = {
    TopicArn: 'arn:aws:sns:us-east-1:123456789012:OrderEvents',
    Message: JSON.stringify(messageBody),
    Subject: 'Order Event',
    MessageAttributes: {
      'EventType': {
        DataType: 'String',
        StringValue: eventType
      },
      'OrderAmount': {
        DataType: 'Number',
        StringValue: totalAmount.toString()
      },
      'CustomerTier': {
        DataType: 'String',
        StringValue: customerTier
      }
    }
  };
  
  try {
    const result = await sns.publish(params).promise();
    console.log('Message published:', result.MessageId);
  } catch (error) {
    console.error('Publishing failed:', error);
  }
}

publishOrderEvent('ORD-12345', 'CUST-67890', 599.99, 'order.created');
```

Both examples follow the same pattern: structure your message body however you like, then attach descriptive attributes that will help filter the message at the subscription level.

### Subscription Filter Policies Explained

Now comes the magic. When you subscribe to an SNS topic, you can define a filter policy that acts as a gatekeeper. SNS evaluates each published message against this policy before delivering it to the subscriber. If the message matches the policy, the subscriber receives it. If it doesn't match, the message is silently dropped for that subscriber.

A filter policy is a JSON document that specifies conditions on message attributes. The simplest filter policy matches a single attribute value:

```json
{
  "EventType": ["order.created"]
}
```

This policy means "only send me messages where the EventType attribute equals 'order.created'". The square brackets indicate that multiple values can match; SNS treats it as a logical OR. So this policy would also match multiple event types:

```json
{
  "EventType": ["order.created", "order.cancelled"]
}
```

This says: "send me messages where EventType is either order.created OR order.cancelled".

You can combine multiple attributes with implicit AND logic:

```json
{
  "EventType": ["order.created"],
  "CustomerTier": ["premium"]
}
```

This means: "send me messages where EventType is order.created AND CustomerTier is premium". This filters down to only premium customers' order creation events.

### Advanced Filter Policy Operators

SNS supports operators beyond simple equality. For numeric attributes, you can use comparison operators:

```json
{
  "OrderAmount": [{"numeric": [">", 100]}]
}
```

This matches any message where OrderAmount is greater than 100. The numeric operator accepts a range of comparison operators: `>`, `>=`, `<`, `<=`, and `=`.

You can also use numeric ranges:

```json
{
  "OrderAmount": [{"numeric": [">=", 50, "<=", 500]}]
}
```

This matches messages where OrderAmount is between 50 and 500 inclusive.

For string attributes, SNS provides prefix matching:

```json
{
  "EventType": [{"StringStartsWith": ["order."]}]
}
```

This matches any EventType that starts with "order."—so it would match order.created, order.cancelled, order.refunded, and any other event beginning with that prefix.

You can also use exact string matching explicitly:

```json
{
  "EventType": [{"StringEquals": ["payment.processed"]}]
}
```

Though in practice, the simple array syntax `["payment.processed"]` is equivalent and more readable.

### Putting It All Together: A Complete E-Commerce Example

Let's construct a realistic scenario. Your system has four subscribers to the OrderEvents topic, each with different needs.

**The Email Service** cares about order creation and shipment delivery:

```json
{
  "EventType": [{"StringStartsWith": ["order.created"]}, {"StringStartsWith": ["shipment.delivered"]}]
}
```

Wait, that syntax isn't quite right. Let me correct that. When you have multiple potential matching criteria, you need to structure it properly:

```json
{
  "EventType": ["order.created", "shipment.delivered"]
}
```

This works, but if you want to use operators on the same attribute, you need a different approach. Actually, the cleanest way to express "EventType matches order.created OR shipment.delivered" is the simple array notation above.

**The Payments Service** only wants payment events:

```json
{
  "EventType": ["payment.processed", "payment.failed"]
}
```

**The Fulfillment Service** only cares about order creation, and only for orders above a certain amount:

```json
{
  "EventType": ["order.created"],
  "OrderAmount": [{"numeric": [">=", 100]}]
}
```

**The Analytics Service** wants everything and uses an empty filter policy or no filter policy at all:**

```json
{}
```

An empty policy matches all messages—it's the default behavior.

Now let's see how you'd configure these subscriptions in code. Using Python:

```python
import boto3
import json

sns = boto3.client('sns')

topic_arn = 'arn:aws:sns:us-east-1:123456789012:OrderEvents'

# Email Service subscription
email_queue_arn = 'arn:aws:sqs:us-east-1:123456789012:EmailServiceQueue'
email_policy = {
    "EventType": ["order.created", "shipment.delivered"]
}

response = sns.subscribe(
    TopicArn=topic_arn,
    Protocol='sqs',
    Endpoint=email_queue_arn,
    Attributes={
        'FilterPolicy': json.dumps(email_policy)
    }
)
print(f"Email service subscription created: {response['SubscriptionArn']}")

# Payments Service subscription
payments_queue_arn = 'arn:aws:sqs:us-east-1:123456789012:PaymentsServiceQueue'
payments_policy = {
    "EventType": ["payment.processed", "payment.failed"]
}

response = sns.subscribe(
    TopicArn=topic_arn,
    Protocol='sqs',
    Endpoint=payments_queue_arn,
    Attributes={
        'FilterPolicy': json.dumps(payments_policy)
    }
)
print(f"Payments service subscription created: {response['SubscriptionArn']}")

# Fulfillment Service subscription
fulfillment_queue_arn = 'arn:aws:sqs:us-east-1:123456789012:FulfillmentQueue'
fulfillment_policy = {
    "EventType": ["order.created"],
    "OrderAmount": [{"numeric": [">=", 100]}]
}

response = sns.subscribe(
    TopicArn=topic_arn,
    Protocol='sqs',
    Endpoint=fulfillment_queue_arn,
    Attributes={
        'FilterPolicy': json.dumps(fulfillment_policy)
    }
)
print(f"Fulfillment service subscription created: {response['SubscriptionArn']}")

# Analytics Service subscription (receives everything)
analytics_queue_arn = 'arn:aws:sqs:us-east-1:123456789012:AnalyticsQueue'

response = sns.subscribe(
    TopicArn=topic_arn,
    Protocol='sqs',
    Endpoint=analytics_queue_arn
)
print(f"Analytics service subscription created: {response['SubscriptionArn']}")
```

And in Node.js:

```javascript
const AWS = require('aws-sdk');
const sns = new AWS.SNS();

const topicArn = 'arn:aws:sns:us-east-1:123456789012:OrderEvents';

async function setupSubscriptions() {
  try {
    // Email Service subscription
    const emailPolicy = {
      "EventType": ["order.created", "shipment.delivered"]
    };
    
    let response = await sns.subscribe({
      TopicArn: topicArn,
      Protocol: 'sqs',
      Endpoint: 'arn:aws:sqs:us-east-1:123456789012:EmailServiceQueue',
      Attributes: {
        'FilterPolicy': JSON.stringify(emailPolicy)
      }
    }).promise();
    
    console.log('Email service subscription:', response.SubscriptionArn);
    
    // Payments Service subscription
    const paymentsPolicy = {
      "EventType": ["payment.processed", "payment.failed"]
    };
    
    response = await sns.subscribe({
      TopicArn: topicArn,
      Protocol: 'sqs',
      Endpoint: 'arn:aws:sqs:us-east-1:123456789012:PaymentsServiceQueue',
      Attributes: {
        'FilterPolicy': JSON.stringify(paymentsPolicy)
      }
    }).promise();
    
    console.log('Payments service subscription:', response.SubscriptionArn);
    
    // Fulfillment Service subscription
    const fulfillmentPolicy = {
      "EventType": ["order.created"],
      "OrderAmount": [{"numeric": [">=", 100]}]
    };
    
    response = await sns.subscribe({
      TopicArn: topicArn,
      Protocol: 'sqs',
      Endpoint: 'arn:aws:sqs:us-east-1:123456789012:FulfillmentQueue',
      Attributes: {
        'FilterPolicy': JSON.stringify(fulfillmentPolicy)
      }
    }).promise();
    
    console.log('Fulfillment service subscription:', response.SubscriptionArn);
    
    // Analytics Service subscription (no filter = receives all messages)
    response = await sns.subscribe({
      TopicArn: topicArn,
      Protocol: 'sqs',
      Endpoint: 'arn:aws:sqs:us-east-1:123456789012:AnalyticsQueue'
    }).promise();
    
    console.log('Analytics service subscription:', response.SubscriptionArn);
    
  } catch (error) {
    console.error('Subscription setup failed:', error);
  }
}

setupSubscriptions();
```

At this point, you've configured your topic to intelligently route messages. When you publish an order.created event with OrderAmount of 250, it will be delivered to the email service, the fulfillment service, and the analytics service—but not to the payments service. When you publish a payment.processed event, only the payments service and analytics service receive it.

### Advanced Filter Policy Patterns

Real-world use cases often require more sophisticated filtering. Let's explore some practical patterns you'll encounter.

**Excluding Messages**: You can use a negation operator to exclude certain messages:

```json
{
  "EventType": [{"anything-but": ["order.cancelled", "order.refunded"]}]
}
```

This matches any EventType except the ones listed. It's useful when you want everything except a few specific cases.

**Matching Message Attributes that May Not Exist**: By default, if a published message doesn't include a particular attribute, the filter policy is evaluated as if the attribute is absent. A policy checking for a specific value won't match messages missing that attribute. If you want to match messages whether or not an attribute exists, you can use the `exists` operator:

```json
{
  "EventType": [{"exists": true}]
}
```

This matches only messages that have the EventType attribute defined, regardless of its value.

**Complex Multi-Attribute Policies**: You can combine multiple attributes with AND logic (implicit) and use operators on each:

```json
{
  "EventType": ["order.created"],
  "OrderAmount": [{"numeric": [">=", 100, "<=", 500]}],
  "CustomerTier": [{"anything-but": ["blocked"]}]
}
```

This matches messages where EventType is order.created AND OrderAmount is between 100 and 500 AND CustomerTier is not "blocked".

### Troubleshooting: When Messages Don't Arrive

Filter policies are a common source of confusion. When a message doesn't arrive where you expected, here are the typical culprits.

**Attribute Name Mismatch**: Filter policy evaluation is case-sensitive. If you publish an attribute named `EventType` but your filter policy references `eventtype`, the policy won't match. Always verify that attribute names in your filter policies exactly match those you're publishing.

**Type Mismatch**: If you publish an attribute with `DataType: 'Number'` and try to use string operators on it, the filter won't work as expected. Similarly, publishing a string but filtering with numeric operators will fail. Be consistent about data types.

**Unintended Empty Filters**: An empty filter policy `{}` matches everything. A missing filter policy also matches everything. Sometimes developers accidentally delete a filter policy and wonder why they're receiving all messages.

**Numeric String Values**: Remember that numeric values are sent as strings in the StringValue field, but SNS parses them based on the DataType. If you publish `"StringValue": "100"` with `DataType: 'Number'`, SNS treats it as the number 100 for filtering purposes. However, if you send `"StringValue": "100abc"` with `DataType: 'Number'`, SNS will reject or misinterpret it.

**Operator Syntax Errors**: The operators must be in the exact format SNS expects. For example, `{"StringStartsWith": ["order."]}` is correct, but `{"stringStartsWith": ["order."]}` (lowercase s) will fail silently.

To debug filter policy issues, you can:

1. **Check CloudWatch Logs**: Enable SNS delivery status logging to CloudWatch to see which messages matched which subscriptions.

2. **Test the Policy**: Use the AWS Management Console's SNS subscription testing feature or the AWS CLI to test a filter policy against sample attributes before deploying.

3. **Simplify Incrementally**: Start with a simple filter policy and add complexity gradually. Once it works, you know where the issue is if you add another condition and it breaks.

4. **Log on the Publisher Side**: Add logging when you publish messages to confirm the attributes are being sent correctly.

Here's an example of enabling SNS delivery logging in Python:

```python
import boto3
import json

sns = boto3.client('sns')

# Get a subscription ARN from your setup
subscription_arn = 'arn:aws:sns:us-east-1:123456789012:OrderEvents:12345678-1234-1234-1234-123456789012'

# Set delivery status attributes
response = sns.set_subscription_attributes(
    SubscriptionArn=subscription_arn,
    AttributeName='DeliveryPolicy',
    AttributeValue=json.dumps({
        'maxReceiveCount': 3
    })
)

# Also enable raw message delivery if desired
sns.set_subscription_attributes(
    SubscriptionArn=subscription_arn,
    AttributeName='RawMessageDelivery',
    AttributeValue='true'
)
```

### Best Practices for Message Attributes and Filters

As you design your SNS-based event system, keep these practices in mind:

**Use Semantic Attribute Names**: Choose names that clearly describe what the attribute represents. `EventType` is better than `Type`. `OrderAmount` is better than `Amount`. Future developers (including yourself) will thank you.

**Keep Filter Policies Maintainable**: Avoid overly complex filter policies. If you find yourself nesting multiple operators or combining many attributes, consider whether your event taxonomy is well-designed. Sometimes the right answer is to publish different message types to different SNS topics rather than trying to filter everything on a single topic.

**Document Your Attribute Contract**: As a publisher, document which attributes you'll send, their data types, and possible values. Treat it like an API contract. Subscribers depend on this information to write correct filter policies.

**Test Filter Policies Before Deployment**: Use the AWS CLI or console to validate your filter policy against sample attributes. This catches typos and logic errors before they reach production.

**Monitor Unmatched Messages**: Set up CloudWatch monitoring to track how many messages are published versus how many reach each subscriber. A large gap might indicate a filter policy problem.

### Performance Considerations

Filter policy evaluation happens server-side in SNS, which is good news. It means the filtering doesn't consume resources on your subscriber. However, some design decisions affect overall system performance:

**Number of Attributes**: Publishing 10 attributes takes more CPU cycles to filter than publishing 2. For high-volume topics, minimize the number of attributes you send. Include only what's necessary for filtering.

**Filter Policy Complexity**: A complex policy with many conditions takes longer to evaluate than a simple one. For topics processing millions of messages per second, keep policies as simple as the use case allows.

**Number of Subscribers**: SNS scales very well, but each subscriber's filter policy must be evaluated. Hundreds of subscribers isn't a problem, but extremely high subscriber counts can impact throughput.

In practice, unless you're operating at hyperscale (millions of messages per second), these considerations rarely matter. But they're worth keeping in mind as you design.

### Combining SNS with Other AWS Services

Message attributes and filter policies shine when SNS is part of a larger system. Here's how they integrate with other services:

**SNS to SQS**: This is the classic pattern used in our e-commerce example. SNS publishes filtered messages to SQS queues for asynchronous processing. Each queue receives only the messages its consumer cares about.

**SNS to Lambda**: You can trigger Lambda functions from SNS with filter policies. SNS will only invoke the Lambda if the message matches the policy. This is efficient because Lambda isn't invoked for irrelevant messages.

**SNS to HTTP/HTTPS**: For webhook-based integrations, filter policies reduce unnecessary HTTP calls to external systems.

**SNS to Email/SMS**: If you're using SNS to send notifications, filter policies can route different notification types to different endpoints.

### Conclusion

Message attributes and subscription filter policies give SNS the intelligence to route messages intelligently without burdening your application code. Instead of every subscriber processing every message and deciding whether it's relevant, SNS handles the decision-making server-side.

The pattern is straightforward: publishers add semantic metadata to messages via attributes, and subscribers declare their interests via filter policies. SNS does the matching, ensuring efficiency and loose coupling between components.

As you build event-driven systems on AWS, you'll find that well-designed message attributes and filter policies scale with your business logic. They prevent tight coupling, reduce wasted processing, and make your event-driven architecture maintainable and extensible. Start simple with basic event type filtering, and as your system evolves, layer on more sophisticated policies using numeric ranges and string operators. The investment in getting this right early pays dividends as your system grows.
