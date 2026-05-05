---
title: "SNS to SQS Fan-Out Pattern: A Complete Hands-On Example"
---

## SNS to SQS Fan-Out Pattern: A Complete Hands-On Example

When you need to decouple producers from multiple independent consumers, or when a single event needs to trigger work across several different systems, the SNS-to-SQS fan-out pattern becomes invaluable. This architecture allows you to publish a message once to an Amazon SNS topic and have it automatically delivered to multiple Amazon SQS queues, each processing the message independently according to their own pace and logic.

The beauty of this pattern lies in its flexibility and resilience. Your producer doesn't need to know about individual consumers, queues can be added or removed without changing producer code, and each consumer can process messages at its own speed without blocking others. If one queue falls behind or fails, the others continue unaffected.

In this article, we'll build a complete, working example of this pattern from the ground up. You'll learn how to create the infrastructure, understand the IAM permissions required, write producer and consumer code, and implement monitoring that tells you what's actually happening in your system.

### Understanding the Fan-Out Pattern

Before diving into implementation, let's clarify what makes this pattern special. In a typical publish-subscribe architecture, SNS acts as a message broker that immediately delivers messages to all subscribers. However, SNS itself doesn't persist messages—if a subscriber isn't ready, the message is lost.

SQS, by contrast, is a message queue that persists messages until a consumer explicitly deletes them. By subscribing SQS queues to an SNS topic, you get the best of both worlds: the broadcast capability of SNS combined with the durability and decoupling of SQS. This is the fan-out pattern.

Consider a real-world example: an e-commerce platform receives an order placement event. This single event needs to trigger several independent workflows—inventory management, payment processing, shipping label generation, and customer notification. Rather than having the order service call three different APIs directly (creating tight coupling and failure dependencies), it publishes a single message to an SNS topic. Three separate SQS queues subscribe to that topic, and three independent microservices consume from their respective queues without knowing about each other.

If the payment processing system is temporarily slow, it doesn't slow down inventory updates or shipping label generation. If you later need to add email analytics tracking, you simply create a new SQS queue, subscribe it to the topic, and deploy a new consumer—the order service doesn't change at all.

### Setting Up the Infrastructure

Let's start by creating the SNS topic and SQS queues using the AWS CLI. I'll walk through each step and explain what's happening.

First, create an SNS topic:

```bash
aws sns create-topic --name order-events --region us-east-1
```

This returns a topic ARN that looks like `arn:aws:sns:us-east-1:123456789012:order-events`. Save this—you'll need it frequently.

Next, create three SQS queues. For this example, imagine we're routing orders to different processing pipelines based on order type:

```bash
aws sqs create-queue --queue-name inventory-processing --region us-east-1
aws sqs create-queue --queue-name payment-processing --region us-east-1
aws sqs create-queue --queue-name notification-processing --region us-east-1
```

Each command returns a queue URL like `https://sqs.us-east-1.amazonaws.com/123456789012/inventory-processing`. You'll need these URLs as well.

At this point, you have the basic infrastructure, but they're not connected yet. The SNS topic has no idea the queues exist, and the queues don't know to listen to the topic. That's where subscriptions come in.

### Establishing the SNS-to-SQS Connection

To connect an SQS queue to an SNS topic, you create a subscription. But before you can do that, you need to grant SNS permission to send messages to your SQS queues. This is where IAM permissions become critical—a common source of frustration for developers new to this pattern.

Each SQS queue has a resource policy that defines who can perform what actions on that queue. By default, this policy is empty, which means nobody can access the queue (except the queue's owner through the root account). You need to explicitly allow the SNS topic to send messages to each queue.

Let's attach a policy to the inventory processing queue. First, create a policy file named `queue-policy.json`:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Service": "sns.amazonaws.com"
      },
      "Action": "sqs:SendMessage",
      "Resource": "arn:aws:sqs:us-east-1:123456789012:inventory-processing",
      "Condition": {
        "ArnEquals": {
          "aws:SourceArn": "arn:aws:sns:us-east-1:123456789012:order-events"
        }
      }
    }
  ]
}
```

This policy says: "Allow the SNS service to send messages to this queue, but only if those messages originate from our specific order-events topic." The source ARN condition is crucial for security—it prevents any SNS topic in your account from sending messages to your queue.

Apply this policy to the inventory-processing queue:

```bash
aws sqs set-queue-attributes \
  --queue-url https://sqs.us-east-1.amazonaws.com/123456789012/inventory-processing \
  --attributes '{"Policy":"<POLICY_JSON_HERE>"}' \
  --region us-east-1
```

You'll need to replace `<POLICY_JSON_HERE>` with the actual JSON (make sure it's properly escaped if pasting into the command line). The same policy should be applied to the other two queues, adjusting the Resource ARN for each.

Now you can create the subscriptions:

```bash
aws sns subscribe \
  --topic-arn arn:aws:sns:us-east-1:123456789012:order-events \
  --protocol sqs \
  --notification-endpoint arn:aws:sqs:us-east-1:123456789012:inventory-processing \
  --region us-east-1
```

Repeat this command for the other two queues. Each subscription returns a subscription ARN. After these three subscriptions are created, any message published to the order-events topic will be automatically delivered to all three queues.

### Implementing Filter Policies

One of the most powerful features of SNS subscriptions is the ability to filter messages using subscription filter policies. This lets you route different messages to different queues based on message attributes or content, reducing unnecessary processing.

For example, imagine your order-events topic publishes both order placements and order cancellations. You might want inventory processing to handle both, but payment processing only cares about placements and notification processing handles both. You can express this with filter policies.

First, let's update the payment-processing queue subscription to only receive messages with an orderType of "placement":

```bash
aws sns set-subscription-attributes \
  --subscription-arn arn:aws:sns:us-east-1:123456789012:order-events:a1b2c3d4-e5f6-7890-abcd-ef1234567890 \
  --attribute-name FilterPolicy \
  --attribute-value '{"orderType":["placement"]}' \
  --region us-east-1
```

The filter policy is a JSON object that matches against message attributes. If a message includes an `orderType` attribute with the value "placement", it passes through to this queue. Any other order type is silently dropped.

You can create more sophisticated filters. For instance, to route high-value orders to a specialized processing queue:

```json
{
  "orderValue": [{"numeric": [">", 1000]}],
  "orderType": ["placement"]
}
```

This filters for orders greater than $1000 that are placements. Filter policies support numeric comparisons, string matching, prefix matching, and even EXISTS checks, giving you fine-grained control over message routing.

### Writing Producer Code

Now let's write code that publishes messages to the SNS topic. I'll show you Python and Node.js examples so you can choose what fits your environment.

Here's a Python producer using boto3:

```python
import boto3
import json
from datetime import datetime

sns_client = boto3.client('sns', region_name='us-east-1')

def publish_order_event(order_id, customer_id, order_value, order_type):
    topic_arn = 'arn:aws:sns:us-east-1:123456789012:order-events'
    
    # The message body—what the consumer will actually process
    message = {
        'orderId': order_id,
        'customerId': customer_id,
        'orderValue': order_value,
        'timestamp': datetime.utcnow().isoformat()
    }
    
    # Message attributes—used for filtering at the SNS subscription level
    message_attributes = {
        'orderType': {
            'StringValue': order_type,
            'DataType': 'String'
        },
        'orderValue': {
            'StringValue': str(order_value),
            'DataType': 'Number'
        },
        'customerId': {
            'StringValue': customer_id,
            'DataType': 'String'
        }
    }
    
    try:
        response = sns_client.publish(
            TopicArn=topic_arn,
            Message=json.dumps(message),
            Subject='Order Event',
            MessageAttributes=message_attributes
        )
        print(f"Message published. MessageId: {response['MessageId']}")
        return response['MessageId']
    except Exception as e:
        print(f"Error publishing message: {e}")
        raise

# Example usage
publish_order_event(
    order_id='ORD-12345',
    customer_id='CUST-789',
    order_value=1500.00,
    order_type='placement'
)
```

The key insight here is the distinction between the message body and message attributes. The message body is what gets delivered to the queues and what consumers process. Message attributes are metadata that SNS uses for filtering but which are also forwarded to the queues so consumers can access them if needed.

Here's the equivalent Node.js code using the AWS SDK v3:

```javascript
import { SNSClient, PublishCommand } from "@aws-sdk/client-sns";

const snsClient = new SNSClient({ region: "us-east-1" });

async function publishOrderEvent(orderId, customerId, orderValue, orderType) {
  const topicArn = 'arn:aws:sns:us-east-1:123456789012:order-events';
  
  const message = {
    orderId: orderId,
    customerId: customerId,
    orderValue: orderValue,
    timestamp: new Date().toISOString()
  };
  
  const params = {
    TopicArn: topicArn,
    Message: JSON.stringify(message),
    Subject: 'Order Event',
    MessageAttributes: {
      orderType: {
        StringValue: orderType,
        DataType: 'String'
      },
      orderValue: {
        StringValue: orderValue.toString(),
        DataType: 'Number'
      },
      customerId: {
        StringValue: customerId,
        DataType: 'String'
      }
    }
  };
  
  try {
    const response = await snsClient.send(new PublishCommand(params));
    console.log(`Message published. MessageId: ${response.MessageId}`);
    return response.MessageId;
  } catch (error) {
    console.error(`Error publishing message: ${error}`);
    throw error;
  }
}

// Example usage
publishOrderEvent('ORD-12345', 'CUST-789', 1500.00, 'placement');
```

When you run this code, the message is published to the SNS topic with its attributes. SNS evaluates each subscription's filter policy against these attributes. If the policy matches, the message is delivered to that queue. If it doesn't match, the message is silently discarded for that subscription (but may be delivered to others that match).

### Writing Consumer Code

Consumers read messages from SQS queues independently. Here's a Python consumer that polls the inventory-processing queue:

```python
import boto3
import json
import time

sqs_client = boto3.client('sqs', region_name='us-east-1')

def process_inventory_message(message_body, message_attributes):
    """
    Process the order event for inventory management.
    In a real system, this would update inventory, check stock levels, etc.
    """
    order = json.loads(message_body)
    print(f"Processing inventory for order {order['orderId']}")
    print(f"Customer: {order['customerId']}, Value: {order['orderValue']}")
    print(f"Message attributes: {message_attributes}")
    
    # Simulate some processing work
    time.sleep(1)
    print(f"Inventory processed for order {order['orderId']}")

def consume_messages(queue_url, max_messages=10, wait_time=20):
    """
    Poll the queue for messages and process them.
    """
    while True:
        try:
            response = sqs_client.receive_message(
                QueueUrl=queue_url,
                MaxNumberOfMessages=max_messages,
                WaitTimeSeconds=wait_time,
                MessageAttributeNames=['All']
            )
            
            # If no messages, receive_message returns without a Messages key
            if 'Messages' not in response:
                print("No messages received, waiting...")
                continue
            
            for message in response['Messages']:
                try:
                    # Extract the actual message body and attributes
                    process_inventory_message(
                        message['Body'],
                        message.get('MessageAttributes', {})
                    )
                    
                    # Delete the message from the queue after processing
                    sqs_client.delete_message(
                        QueueUrl=queue_url,
                        ReceiptHandle=message['ReceiptHandle']
                    )
                    print(f"Message deleted from queue")
                    
                except Exception as e:
                    print(f"Error processing message: {e}")
                    # In production, you might implement exponential backoff
                    # or send to a dead-letter queue
        
        except Exception as e:
            print(f"Error receiving messages: {e}")
            time.sleep(5)

# Usage
queue_url = 'https://sqs.us-east-1.amazonaws.com/123456789012/inventory-processing'
consume_messages(queue_url)
```

A few important details in this consumer code. First, the consumer polls the queue in a loop. Long polling with `WaitTimeSeconds=20` is more efficient than short polling—it reduces the number of API calls and delivers messages faster. If no messages arrive within 20 seconds, the API call returns and you poll again.

Second, you must explicitly delete the message using its `ReceiptHandle` after successfully processing it. If you don't delete it, SQS will assume the consumer crashed or failed and will re-deliver the message after the visibility timeout expires. By default, this timeout is 30 seconds, but you can adjust it per queue or even extend it per message if processing takes longer.

Third, notice that we're requesting `MessageAttributeNames=['All']` to get the message attributes that were attached at publication time. These are forwarded through SNS to SQS, allowing consumers to access them for context or further filtering.

Here's the equivalent Node.js consumer:

```javascript
import { SQSClient, ReceiveMessageCommand, DeleteMessageCommand } 
  from "@aws-sdk/client-sqs";

const sqsClient = new SQSClient({ region: "us-east-1" });

async function processInventoryMessage(messageBody, messageAttributes) {
  const order = JSON.parse(messageBody);
  console.log(`Processing inventory for order ${order.orderId}`);
  console.log(`Customer: ${order.customerId}, Value: ${order.orderValue}`);
  console.log(`Message attributes:`, messageAttributes);
  
  // Simulate processing
  await new Promise(resolve => setTimeout(resolve, 1000));
  console.log(`Inventory processed for order ${order.orderId}`);
}

async function consumeMessages(queueUrl, maxMessages = 10, waitTime = 20) {
  while (true) {
    try {
      const response = await sqsClient.send(new ReceiveMessageCommand({
        QueueUrl: queueUrl,
        MaxNumberOfMessages: maxMessages,
        WaitTimeSeconds: waitTime,
        MessageAttributeNames: ['All']
      }));
      
      if (!response.Messages || response.Messages.length === 0) {
        console.log("No messages received, waiting...");
        continue;
      }
      
      for (const message of response.Messages) {
        try {
          await processInventoryMessage(
            message.Body,
            message.MessageAttributes || {}
          );
          
          await sqsClient.send(new DeleteMessageCommand({
            QueueUrl: queueUrl,
            ReceiptHandle: message.ReceiptHandle
          }));
          console.log("Message deleted from queue");
          
        } catch (error) {
          console.error(`Error processing message: ${error}`);
        }
      }
    } catch (error) {
      console.error(`Error receiving messages: ${error}`);
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
}

// Usage
const queueUrl = 'https://sqs.us-east-1.amazonaws.com/123456789012/inventory-processing';
consumeMessages(queueUrl);
```

The beauty of this setup is that the inventory consumer is completely independent from the payment and notification consumers. Each can be deployed separately, run at different scales, or even be replaced entirely without affecting the others. If you want to add a fourth consumer for fraud detection, you simply create a new queue, subscribe it to the topic, and deploy a new consumer—the producer code doesn't change at all.

### IAM Roles for Applications

If you're running these applications in AWS Lambda, EC2, or ECS, they need IAM permissions to call SNS and SQS APIs. Rather than using explicit AWS credentials (which is a security antipattern), you should attach an IAM role to your compute resource.

Here's an example IAM policy for a producer application:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "sns:Publish",
      "Resource": "arn:aws:sns:us-east-1:123456789012:order-events"
    }
  ]
}
```

This policy grants permission to publish to the specific SNS topic only. It follows the principle of least privilege—the application can't publish to other topics or perform other SNS operations.

For a consumer application consuming from the inventory-processing queue:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "sqs:ReceiveMessage",
        "sqs:DeleteMessage"
      ],
      "Resource": "arn:aws:sqs:us-east-1:123456789012:inventory-processing"
    }
  ]
}
```

Again, this is restricted to the specific queue. The consumer can receive and delete messages but can't perform other operations like sending messages or modifying queue attributes.

If you're using an AWS Lambda function triggered by SQS, AWS automatically manages permissions if you use the Lambda console's integration UI. But if you're configuring it manually, these are the permissions you need.

### Monitoring with CloudWatch

Understanding what's happening in your system requires good monitoring. AWS CloudWatch provides several metrics that are crucial for the SNS-to-SQS pattern.

For SQS queues, the most important metrics are:

**ApproximateNumberOfMessagesVisible** shows how many messages are currently in the queue waiting to be processed. A high number that keeps growing suggests your consumers are falling behind. A consistent value of zero suggests either your system is well-balanced or you're not receiving many messages.

**NumberOfMessagesSent** is a cumulative count of messages sent to the queue since you last reset the metric. This shows the volume of traffic. By comparing this across queues, you can see if messages are being routed evenly or if one queue is receiving more traffic than others (which might indicate filter policies aren't working as expected).

**ApproximateAgeOfOldestMessage** tells you how long the oldest unprocessed message has been sitting in the queue. If this is high, it means messages are arriving but not being consumed quickly.

For SNS topics, **NumberOfMessagesPublished** shows the volume being sent, and **NumberOfNotificationsFailed** reveals delivery issues.

You can view these metrics in the CloudWatch console, or programmatically query them. Here's how to check a specific metric using the CLI:

```bash
aws cloudwatch get-metric-statistics \
  --namespace AWS/SQS \
  --metric-name ApproximateNumberOfMessagesVisible \
  --dimensions Name=QueueName,Value=inventory-processing \
  --start-time 2024-01-15T00:00:00Z \
  --end-time 2024-01-15T01:00:00Z \
  --period 300 \
  --statistics Average,Maximum \
  --region us-east-1
```

This queries the average and maximum number of visible messages in the inventory-processing queue over the past hour, broken into 5-minute intervals.

For more proactive monitoring, set up CloudWatch alarms. For example, alert if the number of visible messages exceeds 1000:

```bash
aws cloudwatch put-metric-alarm \
  --alarm-name inventory-queue-backlog \
  --alarm-description "Alert if inventory queue has more than 1000 messages" \
  --metric-name ApproximateNumberOfMessagesVisible \
  --namespace AWS/SQS \
  --statistic Average \
  --period 300 \
  --threshold 1000 \
  --comparison-operator GreaterThanThreshold \
  --evaluation-periods 2 \
  --dimensions Name=QueueName,Value=inventory-processing \
  --region us-east-1
```

This alarm triggers if the average number of visible messages exceeds 1000 for two consecutive 5-minute periods, giving you time to investigate before the backlog becomes critical.

### Troubleshooting Common Permission Errors

Even with the best intentions, permission issues are the most common problem when implementing SNS-to-SQS. Let me walk through the most frequent errors and how to resolve them.

**Error: "User is not authorized to perform: sns:Publish"**

This occurs when the producer application doesn't have the `sns:Publish` permission. Check the IAM policy attached to the role used by the producer and ensure it includes the `sns:Publish` action on the correct topic ARN. If the policy looks correct, ensure the role is actually attached to the EC2 instance, Lambda function, or other resource running your code.

**Error: "Access Denied: User is not authorized to perform: sqs:ReceiveMessage"**

Similar to the SNS error, but for SQS consumers. Verify the consumer's IAM policy includes `sqs:ReceiveMessage` and `sqs:DeleteMessage` on the queue ARN.

**Messages are published but never appear in any queue**

This usually means the subscriptions don't exist or the SNS topic doesn't have permission to send to the SQS queues. Verify subscriptions exist by listing them:

```bash
aws sns list-subscriptions-by-topic \
  --topic-arn arn:aws:sns:us-east-1:123456789012:order-events \
  --region us-east-1
```

You should see three subscriptions with status "Subscribed". If you see "PendingConfirmation", the subscription wasn't confirmed (this happens with certain endpoint types but not SQS).

To check if SNS has permission to send messages, look at the SQS queue policy:

```bash
aws sqs get-queue-attributes \
  --queue-url https://sqs.us-east-1.amazonaws.com/123456789012/inventory-processing \
  --attribute-names Policy \
  --region us-east-1
```

The returned policy should have a statement that allows `sqs:SendMessage` from the SNS topic.

**Messages appear in some queues but not others**

This usually indicates a filter policy issue. The message passed through the SNS topic but a subscription's filter policy rejected it. Verify the filter policies match your message attributes:

```bash
aws sns get-subscription-attributes \
  --subscription-arn arn:aws:sns:us-east-1:123456789012:order-events:abc123... \
  --attribute-name FilterPolicy \
  --region us-east-1
```

Check that the message attributes you're publishing match what the filter policy expects. If you publish with `orderType: "placement"` but the filter policy expects `orderType: "PLACEMENT"` (case matters), the message won't match.

**Messages are received and processed but keep reappearing**

This means the consumer is failing to delete messages after processing. Ensure you're calling `sqs:DeleteMessage` with the correct `ReceiptHandle`. The receipt handle is specific to each receive operation—if you receive the same message twice, you'll get different receipt handles each time.

**Visibility timeout keeps expiring**

If your processing takes longer than the queue's visibility timeout (default 30 seconds), the message becomes visible again while you're still processing it, and another consumer might pick it up. Either increase the visibility timeout for the queue, or extend it per message if processing times vary:

```python
sqs_client.change_message_visibility(
    QueueUrl=queue_url,
    ReceiptHandle=message['ReceiptHandle'],
    VisibilityTimeout=120  # Extend to 2 minutes
)
```

### Best Practices for Production

As you move toward production deployments, keep these practices in mind.

First, implement dead-letter queues. If a consumer fails to process a message after a certain number of attempts, send it to a separate dead-letter queue for inspection and manual handling. Configure this at the SQS queue level—it requires just a few minutes and prevents bad messages from blocking your main queue.

Second, use batch operations when processing multiple messages. Instead of deleting messages one at a time, delete them in batches of up to 10, which reduces API calls and improves efficiency.

Third, implement idempotent processing. Network issues, timeouts, or application crashes can cause messages to be delivered multiple times, even if you've implemented perfect code. Your processing logic should handle receiving the same message twice and produce the same result both times. Typically, this means storing a unique message ID and checking if you've already processed it.

Fourth, monitor and alert on all three key metrics: messages visible, message age, and failed deliveries. Set up dashboards that give you a quick view of queue health.

Finally, test your filter policies thoroughly before deploying. It's easy to think a policy works only to find in production that messages matching your intent aren't reaching the right queues. Test with real message attributes to ensure the syntax is correct.

### Conclusion

The SNS-to-SQS fan-out pattern is a foundational architecture for building decoupled, scalable systems on AWS. By understanding how to create the infrastructure, configure permissions correctly, write producers and consumers, and monitor the system effectively, you have a powerful tool for handling complex event-driven workflows.

The key takeaway is that this pattern gives you broadcast capability through SNS while maintaining the durability and independence of SQS. Each consumer works at its own pace, queues can be added or removed without affecting producers, and messages are persisted and retried automatically. When you combine this with filter policies for intelligent message routing and CloudWatch monitoring for visibility, you have a production-ready system that handles real-world complexity with elegance.

As you build more sophisticated systems, you'll find variations on this pattern—using Lambda for event processing, integrating with DynamoDB streams, or combining with Step Functions for orchestration. But the fundamentals you've learned here form the foundation for all of those architectures.
