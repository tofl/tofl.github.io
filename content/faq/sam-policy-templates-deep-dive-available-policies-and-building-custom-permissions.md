---
title: "SAM Policy Templates Deep Dive: Available Policies and Building Custom Permissions"
---

## SAM Policy Templates Deep Dive: Available Policies and Building Custom Permissions

When you're building serverless applications on AWS, you're constantly making security decisions. Every Lambda function needs permissions to interact with other AWS services, and getting those permissions right is crucial—too restrictive and your application breaks, too permissive and you've created a security vulnerability. AWS Serverless Application Model (SAM) policy templates exist precisely to solve this problem: they provide pre-built, least-privilege IAM policies that you can attach to your Lambda functions with just a single line of configuration.

The challenge many developers face is that SAM's policy templates feel like a black box. You know they exist, you might have used one or two in a tutorial, but you're not entirely sure what's available, what each one actually grants, or when you should write a custom policy instead. This article pulls back that curtain. We'll explore the full landscape of SAM policy templates, understand the IAM permissions they translate to, learn how to combine them, and walk through building your own custom policies when the built-in templates don't quite fit your needs.

### Understanding the Purpose and Power of Policy Templates

Before diving into specific policies, it's worth understanding why policy templates matter. Traditional IAM policy writing requires you to know not only what services you're working with, but also their exact action names, resource ARNs, and the nuances of what each action can do. A developer new to AWS might struggle with the difference between `dynamodb:GetItem` and `dynamodb:Query`, or why they need both `s3:GetObject` and `s3:ListBucket` to read files from a specific S3 bucket prefix.

Policy templates abstract away this complexity. They're pre-vetted by AWS security teams and follow the principle of least privilege, meaning they grant only the minimum permissions needed for common use cases. When you use a policy template, you're leveraging the collective knowledge of thousands of AWS deployments and best practices that have been distilled into a simple, reliable configuration.

The magic happens in your SAM template file. Instead of writing out a full IAM policy document with dozens of lines of JSON, you can express the same intent in a single template property. SAM then expands that into the complete policy when you deploy.

### The Landscape of Built-in Policy Templates

SAM comes with a comprehensive library of policy templates covering the most common serverless integration patterns. Let's explore the major categories and the specific templates available in each.

#### Compute and Container Policies

If your Lambda functions need to invoke other Lambda functions or manage ECS tasks, SAM provides templates for that. The `LambdaInvokePolicy` allows a function to call other Lambda functions by specifying which function ARN you want to invoke. This is useful in microservices architectures where one Lambda triggers another as part of a workflow.

Similarly, `ECSTaskExecutionRole` and `EC2DescribePolicy` handle compute-related permissions. The EC2 policies are particularly useful when your Lambda needs to discover or manage EC2 instances—for example, a Lambda that scans for instances missing security patches might use `EC2DescribePolicy` to list instances without needing to modify them.

#### Database Policies

Database integration is fundamental in serverless applications, and SAM provides several templated policies here. The `DynamoDBCrudPolicy` is one of the most commonly used. When you specify this policy with a table ARN, SAM grants the standard create, read, update, and delete operations: `dynamodb:PutItem`, `dynamodb:GetItem`, `dynamodb:UpdateItem`, `dynamodb:DeleteItem`, and `dynamodb:Query`. However, it does *not* include `dynamodb:Scan`, which is intentional—scan operations are expensive and often indicate that you should reconsider your data model.

For DynamoDB specifically, SAM also offers `DynamoDBStreamReadPolicy` if your Lambda is processing DynamoDB stream records, and `DynamoDBReadPolicy` if you only need read access. The read-only variant omits write operations entirely, giving you true least privilege.

For relational databases accessed through RDS, the `RDSCrudPolicy` provides permissions to make connections to RDS instances, though you still manage the database credentials separately through Secrets Manager.

#### Storage Policies

S3 is ubiquitous in AWS workloads, so SAM offers several S3-related policies. The `S3CrudPolicy` gives you basic object operations—`s3:GetObject`, `s3:PutObject`, `s3:DeleteObject`—on a specified bucket. Like the DynamoDB variant, this follows least privilege by omitting less common operations.

If you only need to read objects, use `S3ReadPolicy`. If you need to list bucket contents, you'll want to layer `S3CrudPolicy` with the knowledge that it includes `s3:ListBucket` permissions as well.

For EBS volumes and snapshots, `EBSCrudPolicy` handles those permissions, useful if your Lambda manages backup workflows.

#### Message Queue and Streaming Policies

Asynchronous communication through SQS and SNS is a core serverless pattern. The `SQSSendMessagePolicy` grants `sqs:SendMessage` on a specified queue, letting your Lambda enqueue work for other services. The `SQSPollerPolicy` is the inverse—it grants permissions to receive and delete messages, which is what you need if your Lambda is configured with an SQS event source.

For SNS, `SNSPublishMessagePolicy` lets your Lambda publish to a topic. The topic then handles the fan-out to subscribers.

For Kinesis streams, `KinesisStreamReadPolicy` and `KinesisCrudPolicy` handle read-only and full access respectively. These are essential for real-time data processing architectures.

#### Encryption and Secrets Management

Security-conscious deployments often encrypt data at rest and in transit. The `KMSDecryptPolicy` allows decryption of data encrypted with a specific KMS key, while `KMSEncryptPolicy` allows encryption. More commonly, you'll see these combined into `KMSEncryptDecryptPolicy` when your function needs to both encrypt and decrypt data.

For secrets stored in Secrets Manager, `SecretsManagerReadPolicy` grants permissions to retrieve secrets—critical for databases, API keys, or other sensitive configuration.

#### Monitoring and Logging Policies

Lambda functions automatically log to CloudWatch, but if your function needs to manually write logs or manage log groups, `CloudWatchPutMetricPolicy` and `CloudLogsFullAccess` are available. These are less commonly used since CloudWatch permissions are typically handled at the execution role level, but they're there if you need explicit metric publishing.

#### Additional Specialized Policies

SAM includes dozens more policy templates for specific AWS services. `SageMakerPowerUserPolicy` for machine learning workloads, `StepFunctionsExecutionPolicy` for orchestration, `SNSCrudPolicy` for full SNS access, and `SQSCrudPolicy` for full SQS access. The library continues to grow as AWS adds new services and new integration patterns emerge.

### How Policy Templates Expand Into IAM Policies

To truly understand policy templates, you need to see what they actually become when deployed. Let's look at concrete examples.

When you write this in your SAM template:

```yaml
Resources:
  MyFunction:
    Type: AWS::Serverless::Function
    Properties:
      CodeUri: src/
      Handler: index.handler
      Runtime: python3.11
      Policies:
        - DynamoDBCrudPolicy:
            TableName: !Ref MyTable
```

SAM translates it into an IAM policy that looks roughly like this:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "dynamodb:PutItem",
        "dynamodb:GetItem",
        "dynamodb:UpdateItem",
        "dynamodb:DeleteItem",
        "dynamodb:Query"
      ],
      "Resource": "arn:aws:dynamodb:us-east-1:123456789012:table/MyTable"
    }
  ]
}
```

Notice the specificity: the policy is limited to a single table ARN. If your table is in a specific region, the resource is region-aware. You can't accidentally grant access to other tables.

Now consider an S3 example:

```yaml
Policies:
  - S3CrudPolicy:
      BucketName: my-application-bucket
```

This expands to:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:PutObject",
        "s3:DeleteObject",
        "s3:ListBucket"
      ],
      "Resource": [
        "arn:aws:s3:::my-application-bucket",
        "arn:aws:s3:::my-application-bucket/*"
      ]
    }
  ]
}
```

Two important details here: first, S3 bucket operations are split into two resource types. The bucket itself for operations like `ListBucket`, and the objects within it using the `/*` wildcard. Second, this grants access to all objects in the bucket. If you wanted to restrict to a specific prefix, you'd need a custom policy.

### Combining Multiple Policy Templates

Real-world applications rarely need just one permission. A function that processes orders might need to read from a DynamoDB table, write to an S3 bucket for archival, and publish notifications to SNS. SAM handles this elegantly—you simply list multiple policies:

```yaml
Resources:
  OrderProcessor:
    Type: AWS::Serverless::Function
    Properties:
      CodeUri: src/
      Handler: handlers.process_order
      Runtime: python3.11
      Policies:
        - DynamoDBCrudPolicy:
            TableName: !Ref OrdersTable
        - S3CrudPolicy:
            BucketName: !Ref ArchiveBucket
        - SNSPublishMessagePolicy:
            TopicName: !GetAtt NotificationTopic.TopicName
```

This function now has permissions to interact with three different services. SAM merges these into a single execution role with three separate statements in the policy document. Each statement is independent, so you could even have multiple policies for the same service if needed—for example, read access to one table and write access to another.

The power of this approach is composability. You're building permission sets from smaller, well-understood pieces rather than writing one monolithic policy. It's easier to understand, easier to audit, and easier to modify later.

### Least Privilege in Practice: Read, Write, and Specific Access Variants

SAM recognizes that different functions need different levels of access. This is where the variation in template names becomes important. Take DynamoDB as an example. You have:

- `DynamoDBCrudPolicy`: Full create, read, update, delete access
- `DynamoDBReadPolicy`: Read-only access (GetItem and Query)
- `DynamoDBStreamReadPolicy`: Permissions to read from DynamoDB Streams

A function that only reports on order history should use `DynamoDBReadPolicy`, not CRUD. A function that receives stream events should use the stream-specific policy. This isn't just about security theater—it's about building systems that fail safely. If a reporting function is compromised or malfunctions, it can only read data, not modify or delete it.

The same pattern appears elsewhere. S3 has `S3CrudPolicy` and `S3ReadPolicy`. SQS has `SQSSendMessagePolicy`, `SQSPollerPolicy`, and `SQSCrudPolicy`. When designing your function's permissions, always ask: what's the minimum this function needs to do its job? Then pick the policy that matches that minimum.

### When Built-in Templates Fall Short: Writing Custom Policies

Eventually, you'll encounter a scenario where no template quite fits. Maybe you need to write to a specific S3 prefix rather than the entire bucket. Maybe you need both read and write access to one DynamoDB table and read-only access to another. Maybe you're integrating with a service that doesn't have a template. That's when you write a custom inline policy.

Inline policies are written directly in your SAM template using the `Statement` structure. Here's an example where a Lambda needs read-only access to a specific prefix in an S3 bucket:

```yaml
Resources:
  ReportGenerator:
    Type: AWS::Serverless::Function
    Properties:
      CodeUri: src/
      Handler: index.handler
      Runtime: python3.11
      Policies:
        - Statement:
            - Effect: Allow
              Action:
                - s3:GetObject
              Resource: arn:aws:s3:::my-bucket/reports/*
            - Effect: Allow
              Action:
                - s3:ListBucket
              Resource: arn:aws:s3:::my-bucket
              Condition:
                StringLike:
                  s3:prefix:
                    - reports/*
```

Notice how this is more precise than the template would be. It grants GetObject only for the `reports/` prefix, and ListBucket only for that prefix. A misconfiguration or compromise in this function can't affect other data in the bucket.

Custom policies are also necessary when you need conditions. Maybe you want to allow S3 access only from a specific VPC endpoint, or DynamoDB access only during business hours. These scenarios require writing the condition structure explicitly:

```yaml
Policies:
  - Statement:
      - Effect: Allow
        Action:
          - dynamodb:Query
          - dynamodb:GetItem
        Resource: !GetAtt MyTable.Arn
        Condition:
          StringEquals:
            aws:RequestedRegion: us-east-1
```

This policy restricts DynamoDB access to requests made from the us-east-1 region, useful in multi-region deployments where you want each function to access only its local database replica.

### Creating Reusable Custom Managed Policies

When you have complex permission requirements that multiple functions share, or when you want to separate policy management from function definition, AWS managed policies or customer managed policies are the answer. A customer managed policy is an IAM policy you create and manage separately, then attach to multiple resources.

You can define a customer managed policy in your SAM template using `AWS::IAM::ManagedPolicy`:

```yaml
Resources:
  OrderProcessingPolicy:
    Type: AWS::IAM::ManagedPolicy
    Properties:
      PolicyDocument:
        Version: "2012-10-17"
        Statement:
          - Sid: DynamoDBAccess
            Effect: Allow
            Action:
              - dynamodb:GetItem
              - dynamodb:Query
              - dynamodb:UpdateItem
            Resource: !GetAtt OrdersTable.Arn
          - Sid: S3ArchiveAccess
            Effect: Allow
            Action:
              - s3:PutObject
            Resource: !Sub "${ArchiveBucket.Arn}/orders/*"
          - Sid: SNSNotification
            Effect: Allow
            Action:
              - sns:Publish
            Resource: !GetAtt NotificationTopic.TopicArn

  OrderProcessor:
    Type: AWS::Serverless::Function
    Properties:
      CodeUri: src/
      Handler: handlers.process_order
      Runtime: python3.11
      ManagedPolicyArns:
        - !Ref OrderProcessingPolicy

  OrderValidator:
    Type: AWS::Serverless::Function
    Properties:
      CodeUri: src/
      Handler: handlers.validate_order
      Runtime: python3.11
      ManagedPolicyArns:
        - !Ref OrderProcessingPolicy
```

Now multiple functions can reuse the same policy definition. It's defined once, maintained in one place, and keeps your Lambda resources cleaner by moving complex policy logic elsewhere. When you need to audit permissions across your application, you have one policy document to review instead of searching through dozens of function definitions.

The `Sid` (statement ID) in each statement is optional but recommended. It makes policies self-documenting and makes audit logs easier to read—instead of seeing "action denied," you see "action denied for DynamoDBAccess."

### Domain-Specific Policy Patterns

Let's work through a few realistic scenarios to see how these concepts come together.

#### Image Processing Pipeline

Suppose you're building an image processing application. Users upload images to S3, which triggers a Lambda that resizes them and stores the results. The function needs S3 access, but only to specific buckets and prefixes. It also uses KMS to encrypt the output:

```yaml
Resources:
  ImageProcessorPolicy:
    Type: AWS::IAM::ManagedPolicy
    Properties:
      PolicyDocument:
        Version: "2012-10-17"
        Statement:
          - Sid: ReadUploadedImages
            Effect: Allow
            Action:
              - s3:GetObject
            Resource: !Sub "${UploadBucket.Arn}/uploads/*"
          - Sid: WriteProcessedImages
            Effect: Allow
            Action:
              - s3:PutObject
            Resource: !Sub "${OutputBucket.Arn}/processed/*"
          - Sid: ListBuckets
            Effect: Allow
            Action:
              - s3:ListBucket
            Resource:
              - !GetAtt UploadBucket.Arn
              - !GetAtt OutputBucket.Arn
          - Sid: EncryptOutput
            Effect: Allow
            Action:
              - kms:Decrypt
              - kms:GenerateDataKey
            Resource: !GetAtt ProcessingKey.Arn

  ImageProcessor:
    Type: AWS::Serverless::Function
    Properties:
      CodeUri: src/
      Handler: handlers.process_image
      Runtime: python3.11
      Timeout: 300
      MemorySize: 1024
      ManagedPolicyArns:
        - !Ref ImageProcessorPolicy
```

This policy is precise. The function can read from the uploads prefix, write to the processed prefix, and encrypt with a specific key. It can't delete objects, access other prefixes, or use other keys.

#### Real-Time Data Stream Processing

For a Kinesis-based analytics pipeline where Lambda reads stream records and writes aggregated results to both DynamoDB and CloudWatch:

```yaml
Resources:
  StreamProcessorPolicy:
    Type: AWS::IAM::ManagedPolicy
    Properties:
      PolicyDocument:
        Version: "2012-10-17"
        Statement:
          - Sid: ReadKinesisStream
            Effect: Allow
            Action:
              - kinesis:GetRecords
              - kinesis:GetShardIterator
              - kinesis:DescribeStream
              - kinesis:ListStreams
              - kinesis:ListShards
            Resource: !GetAtt DataStream.Arn
          - Sid: WriteToDynamoDB
            Effect: Allow
            Action:
              - dynamodb:PutItem
              - dynamodb:UpdateItem
            Resource: !GetAtt AggregatesTable.Arn
          - Sid: PublishMetrics
            Effect: Allow
            Action:
              - cloudwatch:PutMetricData
            Resource: "*"
            Condition:
              StringEquals:
                cloudwatch:namespace: CustomAnalytics

  StreamProcessor:
    Type: AWS::Serverless::Function
    Properties:
      CodeUri: src/
      Handler: handlers.process_stream
      Runtime: python3.11
      Timeout: 60
      ManagedPolicyArns:
        - !Ref StreamProcessorPolicy
      Events:
        KinesisEvent:
          Type: Kinesis
          Properties:
            Stream: !GetAtt DataStream.Arn
            StartingPosition: LATEST
            BatchSize: 100
```

The Kinesis permissions include the read operations the function needs when acting as an event source consumer. The DynamoDB access is restricted to put and update (not delete), and CloudWatch metrics are limited to a custom namespace.

#### Multi-Service Orchestration

For a step function coordinator Lambda that orchestrates work across multiple services:

```yaml
Resources:
  OrchestratorPolicy:
    Type: AWS::IAM::ManagedPolicy
    Properties:
      PolicyDocument:
        Version: "2012-10-17"
        Statement:
          - Sid: InvokeLambdas
            Effect: Allow
            Action:
              - lambda:InvokeFunction
            Resource:
              - !GetAtt WorkerOne.Arn
              - !GetAtt WorkerTwo.Arn
          - Sid: QueueTasks
            Effect: Allow
            Action:
              - sqs:SendMessage
            Resource: !GetAtt TaskQueue.Arn
          - Sid: LogExecutions
            Effect: Allow
            Action:
              - dynamodb:PutItem
            Resource: !GetAtt ExecutionLog.Arn

  Orchestrator:
    Type: AWS::Serverless::Function
    Properties:
      CodeUri: src/
      Handler: handlers.orchestrate
      Runtime: python3.11
      ManagedPolicyArns:
        - !Ref OrchestratorPolicy
```

The orchestrator can invoke specific worker functions (not arbitrary functions), send to a specific queue, and log to a table. The specificity prevents accidental or malicious invocation of other functions in the account.

### Best Practices for Policy Management

As you work with SAM policies, certain patterns emerge. First, prefer templates over custom policies when they fit. Templates are tested, documented, and less error-prone. Second, always go for the most restrictive option that works. If you only need read access, use a read policy. If you need access to one table, don't grant access to all tables.

Organize your policies logically. For small, single-function applications, inline policies are fine. For larger applications with many functions, customer managed policies reduce duplication and make auditing easier. Use meaningful Sids in all custom policy statements—your future self will thank you when reviewing logs.

Test your permissions explicitly. The easiest way is to follow the principle of least surprise: if a function needs to do something, it should have explicit permission. An undiscovered missing permission is far better than a function working with overly broad permissions. During development, you can use CloudTrail to see what actions your functions actually call, then refine permissions accordingly.

Finally, version your customer managed policies. IAM managed policies support versioning natively—when you need to modify a policy, you create a new version rather than replacing the old one. This lets you audit what changed and roll back if needed:

```bash
# Update a managed policy
aws iam put-role-policy --role-name MyRole --policy-name MyPolicy --policy-document file://updated-policy.json

# Create a new version and set it as default
aws iam create-policy-version --policy-arn arn:aws:iam::123456789012:policy/MyPolicy --policy-document file://updated-policy.json --set-as-default
```

### Conclusion

SAM policy templates represent a thoughtful distillation of AWS best practices into convenient, reusable building blocks. The built-in templates handle the common cases with proper least-privilege defaults, while the ability to write custom policies gives you the flexibility to handle domain-specific requirements. The key is understanding what each template provides and resisting the temptation to over-grant permissions for convenience.

As you build serverless applications, think of permissions as part of your application architecture. Choose templates and custom policies deliberately. Combine them to create specific permission sets for each function. When you need more control, write customer managed policies that can be shared and versioned. This approach—starting restrictive and adding permissions as needed—builds systems that are not only more secure but also easier to understand and maintain when you return to them months later. Your future self, your security team, and your users will all benefit from the extra care you take during these foundational steps.
