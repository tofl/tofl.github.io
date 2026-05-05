---
title: "SAM Events: CloudWatch Events, SQS, DynamoDB Streams, and S3 as Lambda Triggers"
---

## SAM Events: CloudWatch Events, SQS, DynamoDB Streams, and S3 as Lambda Triggers

Serverless applications live and die by their event sources. A Lambda function sitting idle in AWS is just expensive compute with nothing to do. The magic happens when something external triggers it—a user uploads a file, a message arrives in a queue, data changes in a database stream, or a scheduled task fires at a specific time. Understanding how to connect these event sources to your Lambda functions is fundamental to building serverless architectures.

The AWS Serverless Application Model (SAM) makes this connection explicit and straightforward through its `Events` section within the `AWS::Serverless::Function` resource. Rather than manually creating triggers, configuring permissions, and wiring resources together in CloudFormation, SAM lets you declare your event sources declaratively in your template. It then handles the heavy lifting—creating the necessary resources, setting up permissions, and configuring the actual trigger mechanism.

This article walks you through how SAM's Events section works and explores the major event source types you'll encounter when building serverless applications. Whether you're triggering Lambda from API requests, processing messages from queues, reacting to database changes, or responding to file uploads, you'll find practical guidance and concrete examples here.

### Understanding the Events Section in SAM

Before diving into specific event types, let's establish what the Events section actually does. When you define an event in your SAM template, you're telling SAM: "This Lambda function should be invoked when this event occurs." SAM then translates that declarative statement into CloudFormation resources and IAM permissions.

Consider this simple example:

```yaml
AWSTemplateFormatVersion: '2010-09-09'
Transform: AWS::Serverless-2016-10-31

Globals:
  Function:
    Timeout: 20
    Runtime: python3.11

Resources:
  MyFunction:
    Type: AWS::Serverless::Function
    Properties:
      CodeUri: src/
      Handler: app.lambda_handler
      Events:
        MyEvent:
          Type: S3
          Properties:
            Bucket: my-bucket
            Events: s3:ObjectCreated:*
```

In this template, `MyEvent` is the logical identifier for this trigger (used for referencing and exporting). The `Type: S3` tells SAM this is an S3 bucket event. The `Properties` section specifies which bucket and which S3 events should trigger the function.

Behind the scenes, SAM creates the S3 bucket (if it doesn't exist), configures an event notification on that bucket, and grants the S3 service permission to invoke your Lambda function. Without SAM, you'd manually create the bucket, write a separate CloudFormation resource for the notification configuration, and craft an IAM resource-based policy granting S3 the permission to invoke Lambda. SAM eliminates boilerplate.

### API Gateway and HTTP API Events

Web-facing Lambda functions typically start their lives as HTTP endpoints. SAM supports two ways to expose Lambda functions via HTTP: traditional API Gateway REST APIs and the newer HTTP APIs.

#### REST API Events

The `Api` event type creates an AWS API Gateway REST API and exposes your Lambda as an HTTP endpoint. Here's what it looks like:

```yaml
Resources:
  GetProductFunction:
    Type: AWS::Serverless::Function
    Properties:
      CodeUri: src/handlers/products/
      Handler: get.handler
      Events:
        GetProductAPI:
          Type: Api
          Properties:
            Path: /products/{id}
            Method: get
            RestApiId: !Ref ProductsApi

  ProductsApi:
    Type: AWS::Serverless::Api
    Properties:
      StageName: prod
```

The `Path` property defines the URL path pattern. Curly braces like `{id}` create path parameters that your Lambda receives in the `pathParameters` event property. The `Method` property specifies the HTTP verb—`get`, `post`, `put`, `delete`, `patch`, `options`, or `any` (which matches all methods).

When you use `RestApiId`, you're explicitly referencing a SAM API resource you've defined. If you omit this property, SAM creates an implicit REST API for you. Here's that simplified version:

```yaml
Resources:
  GetProductFunction:
    Type: AWS::Serverless::Function
    Properties:
      CodeUri: src/
      Handler: get.handler
      Events:
        GetProductAPI:
          Type: Api
          Properties:
            Path: /products/{id}
            Method: get
```

Your Lambda handler receives the HTTP request wrapped in an event object. To parse a JSON request body, you'll typically call `json.loads(event['body'])` in Python or `JSON.parse(event.body)` in Node.js. API Gateway automatically serializes your Lambda response into an HTTP response, so returning a dictionary or object with `statusCode`, `headers`, and `body` gives you control over the HTTP response.

#### HTTP API Events

HTTP APIs are a newer, streamlined alternative to REST APIs. They're simpler, faster, and cheaper—perfect for straightforward microservices. The `HttpApi` event type is what you use:

```yaml
Resources:
  GetProductFunction:
    Type: AWS::Serverless::Function
    Properties:
      CodeUri: src/handlers/products/
      Handler: get.handler
      Events:
        GetProductHTTP:
          Type: HttpApi
          Properties:
            Path: /products/{id}
            Method: GET
            ApiId: !Ref ProductsHttpApi

  ProductsHttpApi:
    Type: AWS::Serverless::HttpApi
    Properties:
      StageName: prod
```

The syntax is nearly identical to REST APIs. The key differences are that HTTP APIs are more performant, support JWT authorizers natively, and have a simpler permission model. If you're building modern APIs and don't need REST-specific features like request validators or models, HTTP APIs are often the better choice.

### SQS Queue Events

Simple Queue Service provides a reliable, scalable queue for decoupling producers from consumers. When you trigger a Lambda from an SQS queue, you're setting up a polling mechanism where AWS Lambda continuously polls the queue, retrieves messages in batches, and invokes your function.

```yaml
Resources:
  OrderProcessorFunction:
    Type: AWS::Serverless::Function
    Properties:
      CodeUri: src/
      Handler: process_order.handler
      Events:
        OrderQueue:
          Type: SQS
          Properties:
            Queue: !GetAtt OrderQueue.Arn
            BatchSize: 10
            MaximumBatchingWindowInSeconds: 5

  OrderQueue:
    Type: AWS::SQS::Queue
    Properties:
      VisibilityTimeout: 300
      MessageRetentionPeriod: 1209600
```

When you specify an SQS trigger, SAM creates an event source mapping that tells Lambda how to poll your queue. The `Queue` property is the ARN of the SQS queue. The `BatchSize` property determines how many messages Lambda retrieves in a single poll (up to 10 for standard queues, up to 10,000 for FIFO). The `MaximumBatchingWindowInSeconds` property allows Lambda to wait up to the specified duration to accumulate messages before invoking your function—useful for batching optimizations.

Your Lambda handler receives a batch of messages in the `Records` array:

```python
def handler(event, context):
    for record in event['Records']:
        message_body = json.loads(record['body'])
        message_id = record['messageId']
        # Process the message
        print(f"Processing message {message_id}: {message_body}")
    
    return {'statusCode': 200}
```

An important behavior to understand: if your function succeeds, Lambda deletes all messages in the batch from the queue. If your function raises an exception, Lambda doesn't delete the messages, and they become visible again after the queue's visibility timeout expires. If you want finer control—deleting some messages and letting others be reprocessed—you can return a `batchItemFailures` response:

```python
def handler(event, context):
    batch_item_failures = []
    
    for record in event['Records']:
        try:
            message_body = json.loads(record['body'])
            # Process...
        except Exception as e:
            print(f"Failed to process message {record['messageId']}: {e}")
            batch_item_failures.append({"itemId": record['messageId']})
    
    return {"batchItemFailures": batch_item_failures}
```

### DynamoDB Streams Events

DynamoDB Streams capture item-level changes in a DynamoDB table—inserts, updates, and deletes. They're perfect for triggering workflows when data changes, synchronizing to other systems, or updating search indexes.

```yaml
Resources:
  OrderProcessorFunction:
    Type: AWS::Serverless::Function
    Properties:
      CodeUri: src/
      Handler: process_stream.handler
      Events:
        OrderTableStream:
          Type: DynamoDB
          Properties:
            Stream: !GetAtt OrderTable.StreamArn
            StartingPosition: LATEST
            BatchSize: 100

  OrderTable:
    Type: AWS::DynamoDB::Table
    Properties:
      TableName: Orders
      AttributeDefinitions:
        - AttributeName: OrderId
          AttributeType: S
      KeySchema:
        - AttributeName: OrderId
          KeyType: HASH
      StreamSpecification:
        StreamViewType: NEW_AND_OLD_IMAGES
      BillingMode: PAY_PER_REQUEST
```

The `Stream` property points to your DynamoDB table's stream ARN. The `StreamSpecification.StreamViewType` determines what information is included in the stream: `KEYS_ONLY` (just the key), `NEW_IMAGE` (the new item state), `OLD_IMAGE` (the previous state), or `NEW_AND_OLD_IMAGES` (both). For most use cases, `NEW_AND_OLD_IMAGES` is most useful.

The `StartingPosition` property controls where Lambda begins reading from the stream when the function is first deployed. Use `LATEST` to start processing only new changes, or `TRIM_HORIZON` to start from the oldest records. The `BatchSize` determines how many stream records are included in each invocation.

Your handler receives records with `dynamodb` properties containing the actual data:

```python
def handler(event, context):
    for record in event['Records']:
        event_name = record['eventName']  # INSERT, MODIFY, or REMOVE
        
        if event_name == 'INSERT':
            new_image = record['dynamodb']['NewImage']
            print(f"New item: {new_image}")
        elif event_name == 'MODIFY':
            new_image = record['dynamodb']['NewImage']
            old_image = record['dynamodb']['OldImage']
            print(f"Item changed from {old_image} to {new_image}")
        elif event_name == 'REMOVE':
            old_image = record['dynamodb']['OldImage']
            print(f"Item deleted: {old_image}")
    
    return {'statusCode': 200}
```

Note that DynamoDB Streams data uses a special format where strings are wrapped in `{'S': 'value'}` objects. In production code, you'd want to parse this into normal Python dictionaries using a helper library or custom parser.

### S3 Bucket Events

S3 bucket events trigger Lambda functions when objects are created, updated, or deleted. This is commonly used for image processing, log analysis, data transformation, and file validation workflows.

```yaml
Resources:
  ImageProcessorFunction:
    Type: AWS::Serverless::Function
    Properties:
      CodeUri: src/
      Handler: process_image.handler
      Policies:
        - S3ReadPolicy:
            BucketName: !Ref UploadBucket
      Events:
        ImageUpload:
          Type: S3
          Properties:
            Bucket: !Ref UploadBucket
            Events: s3:ObjectCreated:*
            Filter:
              S3Key:
                Rules:
                  - Name: prefix
                    Value: uploads/
                  - Name: suffix
                    Value: .jpg

  UploadBucket:
    Type: AWS::S3::Bucket
    Properties:
      BucketName: my-unique-upload-bucket
```

The `Events` property specifies which S3 operations trigger the function. Common values include `s3:ObjectCreated:*` (any creation), `s3:ObjectCreated:Put` (only PUT operations), `s3:ObjectRemoved:*` (any deletion), or `s3:ObjectRemoved:Delete`. You can specify multiple events as a list.

The `Filter` property allows you to narrow down which objects trigger the function. Prefixes filter by key prefix (useful for organizing uploads into folders), and suffixes filter by file extension. You can combine multiple rules as shown above—this configuration triggers on any JPG file uploaded to the `uploads/` prefix.

Your handler receives the S3 bucket and key in the event:

```python
def handler(event, context):
    for record in event['Records']:
        bucket = record['s3']['bucket']['name']
        key = record['s3']['object']['key']
        
        print(f"Processing s3://{bucket}/{key}")
        
        # Download the object
        s3_client = boto3.client('s3')
        response = s3_client.get_object(Bucket=bucket, Key=key)
        
        # Process...
```

One important detail: S3 bucket event notifications are asynchronous and eventually consistent. If you upload a file and immediately check S3, it might not be there yet. In practice, this is rarely an issue, but it's worth understanding.

### CloudWatch Events and EventBridge

CloudWatch Events (now part of Amazon EventBridge) provides a powerful event-driven routing system. You can trigger Lambda functions on schedules, respond to AWS service events, or route custom application events.

#### Scheduled Events

The most common use case is triggering Lambda on a schedule:

```yaml
Resources:
  BackupFunction:
    Type: AWS::Serverless::Function
    Properties:
      CodeUri: src/
      Handler: backup.handler
      Events:
        DailyBackupSchedule:
          Type: Schedule
          Properties:
            Schedule: cron(0 2 * * ? *)
            Description: Run backup every day at 2 AM UTC
```

The `Schedule` property uses cron syntax. The format is `cron(minute hour day month ? day_of_week year)`. The question mark is a wildcard that matches any value for that field. This example runs at 2 AM UTC every day. For every 5 minutes, you'd use `rate(5 minutes)`. For every hour, `rate(1 hour)`. The rate syntax accepts `minutes`, `hours`, or `days` (plural).

#### AWS Service Events

EventBridge also captures events from AWS services. When an EC2 instance changes state, an S3 bucket policy changes, or an API call is made, EventBridge can route those events to your Lambda:

```yaml
Resources:
  EC2EventFunction:
    Type: AWS::Serverless::Function
    Properties:
      CodeUri: src/
      Handler: handle_ec2_event.handler
      Events:
        EC2StateChange:
          Type: EventBridgeRule
          Properties:
            EventBusName: default
            Pattern:
              source:
                - aws.ec2
              detail-type:
                - EC2 Instance State-change Notification
              detail:
                state:
                  - running
```

The `Pattern` property uses JSON matching logic to filter events. This example catches events from the EC2 service (source is `aws.ec2`) where the detail-type is instance state changes and the state is now `running`.

#### Custom Application Events

You can also publish custom events from your application and have EventBridge route them to Lambda:

```python
import boto3
import json

events_client = boto3.client('events')

events_client.put_events(
    Entries=[
        {
            'Source': 'myapp',
            'DetailType': 'UserSignup',
            'Detail': json.dumps({
                'user_id': '12345',
                'email': 'user@example.com'
            })
        }
    ]
)
```

Then in your template:

```yaml
Resources:
  WelcomeEmailFunction:
    Type: AWS::Serverless::Function
    Properties:
      CodeUri: src/
      Handler: send_welcome_email.handler
      Events:
        NewUserSignup:
          Type: EventBridgeRule
          Properties:
            Pattern:
              source:
                - myapp
              detail-type:
                - UserSignup
```

### SNS Topic Events

Simple Notification Service provides a pub/sub mechanism where your Lambda subscribes to a topic and receives messages when other services publish to it.

```yaml
Resources:
  NotificationProcessorFunction:
    Type: AWS::Serverless::Function
    Properties:
      CodeUri: src/
      Handler: process_notification.handler
      Events:
        OrderNotificationTopic:
          Type: SNS
          Properties:
            Topic: !Ref OrderNotificationTopic
            FilterPolicy:
              event_type:
                - order_placed
                - order_shipped

  OrderNotificationTopic:
    Type: AWS::SNS::Topic
    Properties:
      TopicName: order-notifications
```

The `Topic` property is the ARN of the SNS topic. The `FilterPolicy` property allows you to filter messages based on message attributes. This configuration only triggers the function for messages with an `event_type` attribute of either `order_placed` or `order_shipped`.

Your handler receives the message in the `Message` property:

```python
def handler(event, context):
    for record in event['Records']:
        message = json.loads(record['Sns']['Message'])
        subject = record['Sns']['Subject']
        
        print(f"Subject: {subject}")
        print(f"Message: {message}")
```

### Kinesis Stream Events

Kinesis provides real-time data streaming, making it ideal for high-throughput scenarios like application logs, clickstreams, or real-time analytics.

```yaml
Resources:
  KinesisProcessorFunction:
    Type: AWS::Serverless::Function
    Properties:
      CodeUri: src/
      Handler: process_stream.handler
      Events:
        DataStream:
          Type: Kinesis
          Properties:
            Stream: !GetAtt DataStream.Arn
            StartingPosition: LATEST
            BatchSize: 100
            ParallelizationFactor: 10

  DataStream:
    Type: AWS::Kinesis::Stream
    Properties:
      Name: application-data-stream
      StreamModeDetails:
        StreamMode: ON_DEMAND
```

The `StartingPosition` works similarly to DynamoDB Streams—use `LATEST` for new records or `TRIM_HORIZON` for historical records. The `ParallelizationFactor` allows multiple Lambda function instances to process the stream in parallel, improving throughput.

Your handler receives records with `kinesis` data:

```python
import base64
import json

def handler(event, context):
    for record in event['Records']:
        payload = base64.b64decode(record['kinesis']['data'])
        data = json.loads(payload)
        
        print(f"Processing record: {data}")
```

Kinesis data is base64-encoded, so you need to decode it before parsing.

### Permissions and SAM Magic

One of SAM's most valuable features is automatic permission management. When you define an event trigger, SAM not only creates the necessary resources but also grants the triggering service permission to invoke your Lambda function.

For example, when you define an S3 event:

```yaml
Events:
  ImageUpload:
    Type: S3
    Properties:
      Bucket: !Ref UploadBucket
      Events: s3:ObjectCreated:*
```

SAM automatically creates a resource-based policy on your Lambda function that allows the S3 service to invoke it. Without SAM, you'd manually create an `AWS::Lambda::Permission` resource:

```yaml
ImageUploadPermission:
  Type: AWS::Lambda::Permission
  Properties:
    FunctionName: !Ref ImageProcessorFunction
    Action: lambda:InvokeFunction
    Principal: s3.amazonaws.com
    SourceArn: !GetAtt UploadBucket.Arn
```

Similarly, when you specify an SQS queue event source, SAM creates an event source mapping and grants the Lambda service permission to read from the queue. This is all handled automatically—you just declare what you want, and SAM makes it happen.

### Best Practices for Event-Driven Lambda Functions

Understanding event sources is one thing; using them effectively is another. Here are several practices that will make your serverless applications more robust and maintainable.

First, always consider your error handling strategy. Different event sources behave differently when your Lambda fails. With synchronous events like API Gateway, the error propagates immediately to the caller. With asynchronous sources like SQS or SNS, failures are silently retried (typically twice) before being sent to a dead-letter queue if you've configured one. Design your function with these behaviors in mind.

Second, be mindful of cold starts when choosing event sources. If you're using CloudWatch Events to trigger a function every minute, cold starts accumulate and degrade user experience. If you're using SQS with a small batch size, you're invoking Lambda frequently, which can also increase costs. Finding the right balance between latency and cost requires understanding your specific use case.

Third, leverage SAM's policy templates to grant minimal permissions. Rather than giving your Lambda broad S3 access with `S3FullAccess`, use SAM's predefined policies:

```yaml
Resources:
  MyFunction:
    Type: AWS::Serverless::Function
    Properties:
      CodeUri: src/
      Handler: app.handler
      Policies:
        - S3ReadPolicy:
            BucketName: !Ref MyBucket
        - DynamoDBWritePolicy:
            TableName: !Ref MyTable
```

These policies follow the principle of least privilege and are much safer than wildcard permissions.

Finally, always test your event handling with actual event payloads. AWS provides sample events in the Lambda console, or you can construct them from the documentation. Your handler needs to gracefully handle the exact structure of the events your triggers send.

### Conclusion

The Events section in SAM templates is where serverless applications come to life. By declaring event sources declaratively, you tell AWS exactly how your Lambda functions should be triggered, and SAM handles the plumbing—creating resources, configuring permissions, and setting up the actual trigger mechanisms.

Whether you're building REST APIs with API Gateway, processing asynchronous work from SQS queues, reacting to database changes via DynamoDB Streams, or orchestrating workflows with EventBridge, the patterns remain consistent: declare your event source, specify its properties, and let SAM do the heavy lifting. As you build more serverless applications, these event sources become as natural as declaring function parameters—you simply state what you need, and the framework provides it.
