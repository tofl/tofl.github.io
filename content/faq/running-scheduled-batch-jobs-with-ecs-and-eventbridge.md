---
title: "Running Scheduled Batch Jobs with ECS and EventBridge"
---

## Running Scheduled Batch Jobs with ECS and EventBridge

If you've ever needed to run a batch job at a specific time each day, or trigger a container task whenever a file lands in an S3 bucket, you've probably wondered how to orchestrate that without building custom infrastructure. AWS EventBridge paired with Elastic Container Service (ECS) offers an elegant solution that's both powerful and surprisingly simple to set up. In this article, we'll walk through the practical details of scheduling and triggering ECS tasks using EventBridge rules, complete with a real-world data processing example.

### Understanding the Architecture

Before diving into configuration, let's clarify what we're building and why it matters. ECS allows you to run containerized workloads on either EC2 instances or Fargate (serverless containers). EventBridge acts as your event router — it listens for events from AWS services or custom applications, evaluates them against rules you define, and sends matching events to targets like ECS.

This architecture eliminates the need for cron daemons running on EC2 instances or custom Lambda functions that poll services. Instead, you get a serverless, event-driven approach where EventBridge handles scheduling and event matching, and ECS executes your containerized application.

The workflow is straightforward: EventBridge detects a rule trigger (either time-based or event-based), then calls the ECS `RunTask` API on your behalf, spinning up a new task that executes your container. When the task completes, it shuts down. You pay only for the compute time your container actually uses.

### Setting Up Your ECS Task Definition

Your first step is preparing the containerized workload. If you don't already have a task definition, you'll need to create one in the AWS Management Console or via the CLI. A task definition is essentially a blueprint that describes how your Docker container should run — what image to use, how much memory and CPU it needs, environment variables, logging configuration, and so on.

For our example, imagine we're building a batch job that processes CSV files from an S3 bucket and generates a summary report. Here's a minimal task definition you might create:

```json
{
  "family": "data-processor",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "256",
  "memory": "512",
  "containerDefinitions": [
    {
      "name": "processor",
      "image": "123456789012.dkr.ecr.us-east-1.amazonaws.com/data-processor:latest",
      "essential": true,
      "environment": [
        {
          "name": "LOG_LEVEL",
          "value": "INFO"
        }
      ],
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "/ecs/data-processor",
          "awslogs-region": "us-east-1",
          "awslogs-stream-prefix": "ecs"
        }
      }
    }
  ]
}
```

This task definition uses Fargate, which means you don't manage the underlying EC2 infrastructure. The container runs with 256 CPU units and 512 MB of memory. CloudWatch Logs will capture all output from the container, which is invaluable for debugging.

Notice that we're setting environment variables statically here. Later, when we trigger the task via EventBridge, we'll override some of these values dynamically based on the triggering event.

### Creating an IAM Role for EventBridge

Before EventBridge can call the ECS `RunTask` API on your behalf, you need to grant it explicit permission. This requires an IAM role with an appropriate policy.

Create a trust policy that allows the EventBridge service to assume the role:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Service": "events.amazonaws.com"
      },
      "Action": "sts:AssumeRole"
    }
  ]
}
```

Next, attach a policy that permits EventBridge to invoke ECS tasks. Here's a policy that grants the necessary permissions:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "ecs:RunTask"
      ],
      "Resource": [
        "arn:aws:ecs:us-east-1:123456789012:task-definition/data-processor:*"
      ]
    },
    {
      "Effect": "Allow",
      "Action": [
        "iam:PassRole"
      ],
      "Resource": [
        "arn:aws:iam::123456789012:role/ecsTaskExecutionRole",
        "arn:aws:iam::123456789012:role/ecsTaskRole"
      ]
    }
  ]
}
```

The first statement allows EventBridge to run tasks based on your task definition. The second allows EventBridge to pass the execution role and task role to the container — this is essential even if your container doesn't need special permissions, because the ECS agent itself needs permissions to pull images and write logs.

If you don't already have an ECS task execution role, create one with the managed policy `AmazonECSTaskExecutionRolePolicy` attached. This policy grants permissions to pull images from ECR, write logs to CloudWatch, and fetch secrets from Secrets Manager if needed.

### Creating a Time-Based EventBridge Rule

Now let's set up a rule that triggers on a schedule. EventBridge supports both cron expressions and rate expressions for time-based rules.

Suppose you want to run your data processor every day at 2 AM UTC. In the AWS Management Console, navigate to EventBridge and create a new rule:

1. Enter a name like `daily-data-processor`
2. Under "Schedule pattern," select "Cron expression"
3. Enter the expression: `0 2 * * ? *`

This cron expression means "at 02:00 UTC every day." The format follows standard cron syntax: minutes (0), hours (2), day of month (*), month (*), day of week (?), and year (*).

Alternatively, if you prefer a more human-readable syntax, use a rate expression like `rate(1 day)` to run every 24 hours.

Here's how to create the same rule using the AWS CLI:

```bash
aws events put-rule \
  --name daily-data-processor \
  --schedule-expression "cron(0 2 * * ? *)" \
  --state ENABLED
```

### Creating an Event-Pattern-Based Rule

Time-based rules are useful for periodic tasks, but often you want to trigger a job in response to something that happens — like a file being uploaded to S3. This is where event-pattern rules shine.

Let's create a rule that triggers whenever a CSV file is uploaded to a specific S3 bucket:

```bash
aws events put-rule \
  --name s3-csv-uploaded \
  --event-pattern '{
    "source": ["aws.s3"],
    "detail-type": ["Object Created"],
    "detail": {
      "bucket": {
        "name": ["my-data-bucket"]
      },
      "object": {
        "key": [{
          "suffix": ".csv"
        }]
      }
    }
  }' \
  --state ENABLED
```

This rule listens for S3 put operations on objects ending in `.csv` in the bucket `my-data-bucket`. When a matching event arrives, EventBridge will forward it to your target.

Event patterns are incredibly flexible. You can match on any combination of fields in the event JSON, use wildcards, string matching, numeric comparisons, and logical operators. For S3, the source is always `aws.s3` and the detail-type is `Object Created` for uploads.

### Adding an ECS Target to Your Rule

Once you've created a rule, you need to specify what should happen when it triggers. This is where you add ECS as the target.

Using the CLI, add an ECS target to your rule:

```bash
aws events put-targets \
  --rule daily-data-processor \
  --targets "Id"="1","Arn"="arn:aws:ecs:us-east-1:123456789012:cluster/production","RoleArn"="arn:aws:iam::123456789012:role/EventBridgeECSRole","EcsParameters"="{\"LaunchType\":\"FARGATE\",\"NetworkConfiguration\":{\"AwsvpcConfiguration\":{\"Subnets\":[\"subnet-12345678\"],\"SecurityGroups\":[\"sg-87654321\"],\"AssignPublicIp\":\"ENABLED\"}},\"TaskDefinitionArn\":\"arn:aws:ecs:us-east-1:123456789012:task-definition/data-processor:1\"}"
```

Let's break down what's happening here. The `RoleArn` points to the IAM role we created earlier, which grants EventBridge permission to call `RunTask`. The `EcsParameters` object specifies important configuration:

- **LaunchType**: We're using FARGATE, which is serverless and usually simpler for batch jobs
- **NetworkConfiguration**: Required for Fargate. Specify a subnet and security group for your container to use
- **TaskDefinitionArn**: Points to the task definition we prepared earlier

### Passing Event Data as Container Overrides

Here's where things get really interesting. When EventBridge triggers your ECS task, you can pass data from the triggering event directly into your container as environment variables or command arguments. This is called "container overrides."

Imagine that when a CSV file is uploaded to S3, you want your processor to know which file was uploaded. You can extract the bucket and key from the S3 event and pass them to your container.

When you add a target to your rule, you can specify overrides in the `EcsParameters`:

```bash
aws events put-targets \
  --rule s3-csv-uploaded \
  --targets "Id"="1","Arn"="arn:aws:ecs:us-east-1:123456789012:cluster/production","RoleArn"="arn:aws:iam::123456789012:role/EventBridgeECSRole","EcsParameters"="{\"LaunchType\":\"FARGATE\",\"NetworkConfiguration\":{\"AwsvpcConfiguration\":{\"Subnets\":[\"subnet-12345678\"],\"SecurityGroups\":[\"sg-87654321\"],\"AssignPublicIp\":\"ENABLED\"}},\"TaskDefinitionArn\":\"arn:aws:ecs:us-east-1:123456789012:task-definition/data-processor:1\",\"ContainerOverrides\":[{\"Name\":\"processor\",\"Environment\":[{\"Name\":\"S3_BUCKET\",\"Value\":\"$.detail.bucket.name\"},{\"Name\":\"S3_KEY\",\"Value\":\"$.detail.object.key\"}]}]}"
```

The syntax `$.detail.bucket.name` and `$.detail.object.key` use JSONPath notation. EventBridge will extract those fields from the incoming event and inject them as environment variables into your container.

Your application code can then read these environment variables:

```python
import os
import boto3

bucket = os.getenv('S3_BUCKET')
key = os.getenv('S3_KEY')

s3 = boto3.client('s3')
obj = s3.get_object(Bucket=bucket, Key=key)
csv_data = obj['Body'].read()

# Process the CSV...
print(f"Processing {key} from {bucket}")
```

This is powerful because you can drive your application's behavior entirely from the event that triggered it, without needing a separate control plane or API calls.

### Practical Example: A Data Processing Workflow

Let's tie everything together with a complete, realistic example. You have a data pipeline where users upload CSV files to S3, and each upload should trigger an analysis job that generates statistics and stores results back to S3.

First, create your task definition. Here's a more complete version that includes both task execution role and container environment setup:

```json
{
  "family": "csv-analyzer",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "512",
  "memory": "1024",
  "executionRoleArn": "arn:aws:iam::123456789012:role/ecsTaskExecutionRole",
  "taskRoleArn": "arn:aws:iam::123456789012:role/csvAnalyzerTaskRole",
  "containerDefinitions": [
    {
      "name": "analyzer",
      "image": "123456789012.dkr.ecr.us-east-1.amazonaws.com/csv-analyzer:latest",
      "essential": true,
      "environment": [
        {
          "name": "AWS_REGION",
          "value": "us-east-1"
        }
      ],
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "/ecs/csv-analyzer",
          "awslogs-region": "us-east-1",
          "awslogs-stream-prefix": "ecs"
        }
      }
    }
  ]
}
```

Next, create an IAM role for the task (`csvAnalyzerTaskRole`) that allows reading from the input S3 bucket and writing to the output bucket:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:GetObject"
      ],
      "Resource": [
        "arn:aws:s3:::user-uploads-bucket/*"
      ]
    },
    {
      "Effect": "Allow",
      "Action": [
        "s3:PutObject"
      ],
      "Resource": [
        "arn:aws:s3:::analysis-results-bucket/*"
      ]
    }
  ]
}
```

Now, create an EventBridge rule that matches CSV uploads:

```bash
aws events put-rule \
  --name csv-upload-trigger \
  --event-pattern '{
    "source": ["aws.s3"],
    "detail-type": ["Object Created"],
    "detail": {
      "bucket": {
        "name": ["user-uploads-bucket"]
      },
      "object": {
        "key": [{
          "suffix": ".csv"
        }]
      }
    }
  }' \
  --state ENABLED
```

Add the ECS target with container overrides to pass the S3 details:

```bash
aws events put-targets \
  --rule csv-upload-trigger \
  --targets "Id"="1","Arn"="arn:aws:ecs:us-east-1:123456789012:cluster/processing","RoleArn"="arn:aws:iam::123456789012:role/EventBridgeECSRole","EcsParameters"="{\"LaunchType\":\"FARGATE\",\"NetworkConfiguration\":{\"AwsvpcConfiguration\":{\"Subnets\":[\"subnet-12345678\"],\"SecurityGroups\":[\"sg-87654321\"],\"AssignPublicIp\":\"ENABLED\"}},\"TaskDefinitionArn\":\"arn:aws:ecs:us-east-1:123456789012:task-definition/csv-analyzer:1\",\"ContainerOverrides\":[{\"Name\":\"analyzer\",\"Environment\":[{\"Name\":\"INPUT_BUCKET\",\"Value\":\"$.detail.bucket.name\"},{\"Name\":\"INPUT_KEY\",\"Value\":\"$.detail.object.key\"},{\"Name\":\"OUTPUT_BUCKET\",\"Value\":\"analysis-results-bucket\"}]}]}"
```

Your container application would look something like this:

```python
import os
import csv
import json
import boto3
from datetime import datetime

s3 = boto3.client('s3')

input_bucket = os.getenv('INPUT_BUCKET')
input_key = os.getenv('INPUT_KEY')
output_bucket = os.getenv('OUTPUT_BUCKET')

# Download and analyze
response = s3.get_object(Bucket=input_bucket, Key=input_key)
csv_file = response['Body']

reader = csv.DictReader(csv_file.read().decode('utf-8').splitlines())
rows = list(reader)

# Perform analysis
analysis = {
    'file': input_key,
    'row_count': len(rows),
    'columns': reader.fieldnames,
    'timestamp': datetime.utcnow().isoformat(),
    'processed_at': datetime.utcnow().isoformat()
}

# Store results
output_key = f"results/{input_key.split('/')[-1]}.analysis.json"
s3.put_object(
    Bucket=output_bucket,
    Key=output_key,
    Body=json.dumps(analysis),
    ContentType='application/json'
)

print(f"Analysis complete: {output_key}")
```

When a user uploads `sales_data.csv` to `user-uploads-bucket`, EventBridge automatically detects the upload, extracts the bucket and key from the S3 event, and launches your ECS task with those values injected as environment variables. Your container downloads the file, analyzes it, and stores results back to S3 — all triggered instantly and automatically.

### Monitoring Task Execution

Once your tasks are running, you'll want visibility into their execution. CloudWatch is your primary tool for this.

First, check task logs in CloudWatch. Since we configured the task definition to send logs to CloudWatch Logs, navigate to `/ecs/csv-analyzer` log group and you'll see each task's output.

To view task execution history, use the ECS console. Navigate to your cluster, select the task, and you'll see status information, execution duration, and any errors that occurred.

You can also use the CLI to list recent tasks:

```bash
aws ecs list-tasks --cluster processing --launch-type FARGATE
```

To get detailed information about a specific task:

```bash
aws ecs describe-tasks \
  --cluster processing \
  --tasks arn:aws:ecs:us-east-1:123456789012:task/processing/1234567890abcdef
```

This output includes the task's current status (PROVISIONING, PENDING, ACTIVATING, RUNNING, DEACTIVATING, STOPPING, DEPROVISIONING, STOPPED), exit code, and any failures.

For alerting on task failures, you can create CloudWatch alarms based on log patterns. For example, alert if a task's exit code is non-zero:

```bash
aws logs put-metric-alarm \
  --alarm-name csv-analyzer-failures \
  --alarm-description "Alert when CSV analyzer tasks fail" \
  --metric-name TaskExitCode \
  --namespace AWS/ECS \
  --statistic Average \
  --period 300 \
  --threshold 0 \
  --comparison-operator GreaterThanThreshold
```

You might also want to monitor EventBridge rule invocations to see how many times your rules are triggering:

```bash
aws cloudwatch get-metric-statistics \
  --namespace AWS/Events \
  --metric-name Invocations \
  --dimensions Name=RuleName,Value=csv-upload-trigger \
  --start-time 2024-01-01T00:00:00Z \
  --end-time 2024-01-02T00:00:00Z \
  --period 3600 \
  --statistics Sum
```

### Handling Failures and Retries

By default, if an ECS task fails, EventBridge won't automatically retry. However, you can configure retry policies on your rule targets.

When adding a target, specify a retry policy:

```bash
aws events put-targets \
  --rule csv-upload-trigger \
  --targets "Id"="1","Arn"="arn:aws:ecs:us-east-1:123456789012:cluster/processing","RoleArn"="arn:aws:iam::123456789012:role/EventBridgeECSRole","RetryPolicy"="{\"MaximumEventAge\":3600,\"MaximumRetryAttempts\":2}","EcsParameters"="{...}"
```

This configuration retries failed invocations up to 2 times, but only if the original event is less than 1 hour old. Adjust these values based on your application's tolerance for latency and your willingness to retry.

For tasks that might fail transiently (network issues, temporary service unavailability), retries are helpful. For tasks that fail due to bad data or invalid state, retries won't help — you need to investigate the root cause via logs.

### Advanced Patterns

EventBridge's flexibility enables sophisticated workflows. Here are a few patterns worth exploring:

**Conditional Logic**: You can create multiple rules that match different patterns and trigger different actions. For example, you might process `.csv` files one way and `.json` files another way, using separate rules and task definitions.

**Cross-Account Execution**: EventBridge can target resources in other AWS accounts if you set up appropriate cross-account roles. This is useful for centralized monitoring or shared infrastructure.

**Dead-Letter Queues**: Configure a dead-letter queue for events that fail to reach their target after retries. This ensures you don't lose visibility into failures.

**Templating and Transformation**: Use input transformers to reshape event data before passing it to your target. This is useful if your container expects a different format than what S3 provides.

### Conclusion

EventBridge and ECS together provide a clean, serverless way to run scheduled and event-driven batch jobs. You eliminate the need for always-on infrastructure, custom schedulers, or complex polling logic. Instead, you define rules declaratively, attach ECS tasks as targets, and let AWS handle the orchestration.

The key pieces are straightforward: a task definition that encapsulates your application, an IAM role that grants EventBridge permission to invoke tasks, a rule that defines when to trigger (via cron schedule or event pattern), and container overrides that inject contextual data into each execution. Monitor task execution through CloudWatch Logs and the ECS console, and you have full visibility into your batch workloads.

As you build out your own pipelines, remember that event-driven architectures scale naturally. You don't provision capacity upfront — you pay only for the tasks that actually run, and EventBridge handles the routing automatically. Whether you're processing uploaded files, performing periodic maintenance, or reacting to system state changes, this pattern will serve you well.
