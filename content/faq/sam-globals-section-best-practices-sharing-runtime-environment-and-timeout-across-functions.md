---
title: "SAM Globals Section Best Practices: Sharing Runtime, Environment, and Timeout Across Functions"
---

## SAM Globals Section Best Practices: Sharing Runtime, Environment, and Timeout Across Functions

When you're building serverless applications with AWS SAM, one of the first things you'll notice is how repetitive CloudFormation templates can become. You find yourself writing the same runtime, timeout, memory allocation, and environment variables over and over again for each Lambda function. This is where the Globals section becomes your secret weapon for keeping templates clean, maintainable, and DRY — and understanding how to use it properly is essential knowledge for anyone serious about serverless architecture on AWS.

The Globals section in a SAM template is a powerful but sometimes misunderstood feature that lets you define properties once and apply them to multiple resources. When used thoughtfully, it dramatically reduces template noise and makes your infrastructure code easier to read and maintain. But there's a right way and a wrong way to approach it, and the difference comes down to understanding which properties are genuinely global and which ones should remain function-specific.

### Understanding What Globals Actually Are

Before diving into best practices, let's get clear on what the Globals section actually does. In SAM, the Globals section is where you define default property values that apply to all serverless functions in your template. When SAM processes your template, it merges these global defaults with function-level configurations, with function-level settings taking precedence whenever there's a conflict.

Think of it like CSS stylesheets — you define base styles that apply to everything, then you can override those styles on specific elements. The parallel breaks down a bit, but the mental model is helpful: globals are your baseline, and individual function configurations layer on top.

It's important to understand that not all resource properties support global configuration. Globals specifically work with properties that make sense as defaults across multiple functions. Properties like `Runtime`, `Timeout`, `MemorySize`, `Environment`, and `Tags` are common candidates. Properties like `CodeUri` or `Handler`, which are inherently function-specific, cannot be globalized because they define the actual code location and entry point for each function.

### Identifying Properties Worth Globalizing

The most common use case for Globals is standardizing the runtime across your entire application. If you're building a multi-function Python application, you probably want all your functions running on the same Python version. This keeps dependencies consistent and simplifies your mental model of what's running in production.

```yaml
Globals:
  Function:
    Runtime: python3.11
    Timeout: 30
    MemorySize: 256
```

This simple configuration eliminates the need to specify runtime and defaults for every single function in your template. When you need a function to break the mold—perhaps a compute-intensive data processor that needs 1024 MB and 60 seconds—you override just that function's settings.

Environment variables are another excellent candidate for globalization, particularly when you have configuration that applies across your entire application. API endpoints, feature flags, logging levels, and common AWS resource ARNs are perfect examples. A multi-function order processing system might need all functions to know about a shared database endpoint or a message queue URL.

```yaml
Globals:
  Function:
    Runtime: python3.11
    Timeout: 30
    MemorySize: 256
    Environment:
      Variables:
        LOG_LEVEL: INFO
        DYNAMODB_TABLE_NAME: Orders
        SQS_QUEUE_URL: https://sqs.us-east-1.amazonaws.com/123456789012/order-processing
```

Memory and timeout are worth globalizing when you have a reasonable default that applies to most of your functions. However, be thoughtful here—serverless architecture often involves functions with wildly different resource requirements, so your global defaults should reflect what's typical for your workload.

Tags are another excellent global candidate, particularly for environment tracking, cost allocation, or organizational metadata. If you want all functions in a template to have the same `Environment: production` or `Team: billing` tags, putting those in Globals is the right approach.

### The Override Pattern: Fine-Grained Control When You Need It

The real power of Globals emerges when you understand how to override them. Global defaults are exactly that—defaults. Any function can override any property by specifying it explicitly at the function level.

Consider a multi-function application where most functions are simple request handlers that complete in under 10 seconds, but one function processes large batch reports and regularly needs 5 minutes:

```yaml
Globals:
  Function:
    Runtime: python3.11
    Timeout: 30
    MemorySize: 256
    Environment:
      Variables:
        LOG_LEVEL: INFO
        DYNAMODB_TABLE_NAME: Orders

Resources:
  ListOrdersFunction:
    Type: AWS::Serverless::Function
    Properties:
      CodeUri: src/list_orders/
      Handler: app.lambda_handler
      Events:
        GetRequest:
          Type: Api
          Properties:
            RestApiId: !Ref OrdersApi
            Path: /orders
            Method: get

  ProcessReportFunction:
    Type: AWS::Serverless::Function
    Properties:
      CodeUri: src/process_report/
      Handler: app.lambda_handler
      Timeout: 300
      MemorySize: 512
      Environment:
        Variables:
          REPORT_BUCKET: !Ref ReportBucket
          LOG_LEVEL: DEBUG
      Events:
        ScheduleEvent:
          Type: Schedule
          Properties:
            Schedule: 'cron(0 2 * * ? *)'
```

In this example, `ListOrdersFunction` inherits everything from Globals—runtime, timeout, memory, and the standard environment variables. `ProcessReportFunction` keeps the global runtime and global `LOG_LEVEL` and `DYNAMODB_TABLE_NAME`, but overrides timeout to 300 seconds, memory to 512 MB, and adds an additional environment variable `REPORT_BUCKET`. Notice that `LOG_LEVEL` is explicitly set again in `ProcessReportFunction`—this is setting it to DEBUG, which overrides the global INFO value just for this function.

Environment variable override deserves special attention because it's a common source of confusion. When you specify environment variables at the function level, you're not merging them with globals—you're replacing them entirely. If you want to keep global environment variables and add function-specific ones, you need to re-declare the global variables alongside your new ones, as shown in the example above.

### Anti-Patterns: When Globals Become Liabilities

The biggest mistake developers make with Globals is trying to force too much into them. If you have properties in Globals that only apply to some of your functions, you're creating a false contract about your application structure. Future developers (including yourself six months from now) will assume a property is global when it's really only relevant to half the functions.

Consider this problematic pattern:

```yaml
Globals:
  Function:
    Runtime: python3.11
    Timeout: 30
    MemorySize: 256
    Environment:
      Variables:
        DYNAMODB_TABLE_NAME: Orders
        S3_BUCKET_NAME: my-uploads
        SNS_TOPIC_ARN: arn:aws:sns:us-east-1:123456789012:notifications
        API_GATEWAY_URL: https://api.example.com
```

If your application has functions that don't use S3, or that don't publish to SNS, then these environment variables shouldn't be global. They're just noise in the function environment, and they spread false context about what the function actually needs. Instead, group functions by their actual dependencies and set environment variables at the level where they make sense.

Another anti-pattern is overly aggressive globalization of memory and timeout. While it's tempting to set a global value, the reality is that serverless functions often have widely varying resource requirements. A function that makes a quick database query might be fine with 256 MB and 10 seconds. A function that processes images or performs complex computations might need 3008 MB and 900 seconds. Setting a global that applies to both usually means compromising on one or the other, which defeats the purpose of using Lambda's flexible scaling.

Hardcoding resource-specific values in Globals is also problematic. ARNs, bucket names, table names—these should generally be environment variables or parameter references, but even then, only if they apply globally. If you're hardcoding an S3 bucket name that's only used by one function, that belongs in that function's configuration, not in Globals.

### A Practical Example: Multi-Function Application with Thoughtful Globals

Let's build a more realistic example that shows how to structure Globals for a moderately complex serverless application—a notification service with multiple Lambda functions handling different aspects of the workflow.

```yaml
AWSTemplateFormatVersion: '2010-09-09'
Transform: AWS::Serverless-2013-08-31

Parameters:
  Environment:
    Type: String
    Default: dev
    AllowedValues:
      - dev
      - staging
      - prod

Globals:
  Function:
    Runtime: python3.11
    Timeout: 60
    MemorySize: 256
    Environment:
      Variables:
        ENVIRONMENT: !Ref Environment
        LOG_LEVEL: INFO
        POWERTOOLS_SERVICE_NAME: notification-service

Resources:
  NotificationQueue:
    Type: AWS::SQS::Queue
    Properties:
      QueueName: !Sub 'notifications-${Environment}'
      VisibilityTimeout: 120

  NotificationTable:
    Type: AWS::DynamoDB::Table
    Properties:
      TableName: !Sub 'notifications-${Environment}'
      BillingMode: PAY_PER_REQUEST
      AttributeDefinitions:
        - AttributeName: NotificationId
          AttributeType: S
        - AttributeName: Timestamp
          AttributeType: N
      KeySchema:
        - AttributeName: NotificationId
          KeyType: HASH
        - AttributeName: Timestamp
          KeyType: RANGE

  ProcessNotificationFunction:
    Type: AWS::Serverless::Function
    Properties:
      CodeUri: src/process_notification/
      Handler: app.lambda_handler
      Timeout: 120
      MemorySize: 512
      Environment:
        Variables:
          POWERTOOLS_SERVICE_NAME: notification-service-processor
          NOTIFICATION_TABLE: !Ref NotificationTable
          DYNAMODB_BATCH_SIZE: '10'
      Policies:
        - DynamoDBCrudPolicy:
            TableName: !Ref NotificationTable
      Events:
        SQSEvent:
          Type: SQS
          Properties:
            Queue: !GetAtt NotificationQueue.Arn
            BatchSize: 10

  SendEmailFunction:
    Type: AWS::Serverless::Function
    Properties:
      CodeUri: src/send_email/
      Handler: app.lambda_handler
      Timeout: 30
      MemorySize: 256
      Environment:
        Variables:
          SES_SENDER_EMAIL: noreply@notifications.example.com
          NOTIFICATION_TABLE: !Ref NotificationTable
      Policies:
        - SESEmailTemplateCrudPolicy: {}
        - DynamoDBCrudPolicy:
            TableName: !Ref NotificationTable

  SendSmsFunction:
    Type: AWS::Serverless::Function
    Properties:
      CodeUri: src/send_sms/
      Handler: app.lambda_handler
      Timeout: 30
      MemorySize: 256
      Environment:
        Variables:
          SNS_REGION: !Ref AWS::Region
          NOTIFICATION_TABLE: !Ref NotificationTable
      Policies:
        - SNSPublishMessagePolicy:
            TopicName: !Sub 'sms-notifications-${Environment}'
        - DynamoDBCrudPolicy:
            TableName: !Ref NotificationTable

  StatusCheckFunction:
    Type: AWS::Serverless::Function
    Properties:
      CodeUri: src/status_check/
      Handler: app.lambda_handler
      Timeout: 10
      MemorySize: 128
      Environment:
        Variables:
          NOTIFICATION_TABLE: !Ref NotificationTable
      Policies:
        - DynamoDBReadPolicy:
            TableName: !Ref NotificationTable
      Events:
        ApiEvent:
          Type: Api
          Properties:
            RestApiId: !Ref NotificationApi
            Path: /status/{notificationId}
            Method: get
```

Let's examine what makes this approach effective:

First, notice what's in Globals. The runtime is consistent across all functions—they're all Python 3.11. The base timeout of 60 seconds and memory of 256 MB are reasonable defaults that work for most functions. Environment variables that apply to all functions—the environment parameter and logging configuration—are global. The `POWERTOOLS_SERVICE_NAME` is there because AWS Lambda Powertools is being used across the application, and this base value makes sense as a global default.

Second, observe how functions override thoughtfully. `ProcessNotificationFunction` needs more time (120 seconds) and memory (512 MB) because it's batch-processing messages from SQS. The `SendEmailFunction` and `SendSmsFunction` use global defaults because they're relatively lightweight. The `StatusCheckFunction` is optimized further with a 10-second timeout and minimal memory because it's just a quick database lookup.

Third, notice that resource-specific environment variables—`NOTIFICATION_TABLE`, `SES_SENDER_EMAIL`, `SNS_REGION`—are function-specific, not global. These reflect the actual design: not all functions interact with all resources, so these variables belong where they're actually used.

The `DYNAMODB_BATCH_SIZE` in `ProcessNotificationFunction` is function-specific because it's a tuning parameter relevant only to that function's batch processing logic. Putting it in Globals would suggest it's a universal configuration, which it's not.

### Environment Variable Management at Scale

As your application grows and you accumulate more functions, the challenge of environment variable management becomes more apparent. A nuanced approach is to group related environment variables that are truly shared across multiple functions into Globals, while keeping resource-specific variables at the function level.

For instance, if you have authentication tokens, API keys, or service endpoints that multiple functions genuinely need, those belong in Globals or, better yet, in AWS Secrets Manager or Parameter Store with functions reading them as needed. However, this requires balancing the convenience of Globals against the security implications of hardcoding sensitive values in templates at all.

When working with multiple environments—development, staging, production—Globals become even more valuable. You can parameterize the environment name and use it in Globals to set a consistent environment variable that all functions inherit, then override at the function level only when that specific function has environment-specific behavior.

### Tags and Metadata Through Globals

Often overlooked is the use of Globals for organizing metadata through tags. If you want all functions in a template to have consistent tagging for cost allocation, team ownership, or environment identification, Globals is the perfect place:

```yaml
Globals:
  Function:
    Runtime: python3.11
    Timeout: 30
    MemorySize: 256
    Tags:
      Environment: !Ref Environment
      Team: backend
      Project: notifications
      CostCenter: engineering
```

This approach ensures consistency and makes infrastructure organization systematic. When you need cost reports filtered by team or environment, consistent tagging across all functions makes that trivial.

### Key Takeaways for Template Organization

The most successful teams using SAM adopt a consistent philosophy: Globals should contain properties that genuinely apply across all or nearly all functions in a template. Use them for standardizing runtime, setting reasonable baseline timeout and memory defaults, and capturing universally-needed configuration. Override at the function level whenever behavior diverges, and don't hesitate to be specific about function-level needs even when they differ from globals—that's the whole point of the override mechanism.

When you encounter a property that only a few functions need, it doesn't belong in Globals. When you're setting a Globals value that you know you'll override in most functions anyway, reconsider whether it's truly global. The goal isn't to eliminate every duplicate line in your template; it's to eliminate repetition that masks genuine consistency and to make your template's structure reflect your application's actual architecture.

By thoughtfully designing your Globals section, you create templates that are easier to understand, quicker to maintain, and more resilient to future changes. New developers onboarding to your codebase can glance at Globals and immediately understand the baseline assumptions about your serverless functions, and they can confidently modify individual functions knowing that changes won't accidentally ripple across your entire application unless you intend them to.
