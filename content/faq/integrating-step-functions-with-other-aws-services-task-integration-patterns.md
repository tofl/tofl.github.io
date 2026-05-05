---
title: "Integrating Step Functions with Other AWS Services: Task Integration Patterns"
---

## Integrating Step Functions with Other AWS Services: Task Integration Patterns

Imagine you're building a workflow that needs to process an image, store metadata in a database, send notifications, and trigger container workloads—all orchestrated seamlessly. This is where AWS Step Functions becomes transformative. But Step Functions' true power lies not just in its ability to define workflows, but in how elegantly it integrates with the broader AWS ecosystem. Understanding how to craft these integrations correctly—choosing the right patterns, writing proper task definitions, and configuring permissions—separates a developer who can build workflows from one who can build *production-grade* workflows.

In this article, we'll explore how to integrate Step Functions with the services you'll encounter most frequently: Lambda, DynamoDB, SNS, SQS, ECS, and API Gateway. We'll move beyond the basics and dig into the integration patterns that allow you to handle everything from quick, synchronous operations to long-running jobs and even human-in-the-loop approvals. You'll learn when to call services directly and when to wrap them in Lambda, see the exact JSON task definitions you'll need, and understand the IAM permissions that make it all work.

### Understanding Step Functions Service Integrations

Before diving into specific services, let's establish what a service integration actually is. When you define a task in a Step Functions state machine, you're essentially telling Step Functions: "Call this AWS service and wait for a response." Step Functions can interact with over 200 AWS services without needing to invoke Lambda as a middleman. This is powerful because it reduces latency, simplifies your architecture, and often reduces costs by eliminating unnecessary function invocations.

However, not all integrations are created equal. Step Functions offers three primary integration patterns, each suited to different scenarios. These patterns determine how long Step Functions waits for a service to complete and what level of control you have over the interaction.

### The Three Core Integration Patterns

**RequestResponse** is the synchronous pattern you'll use most often. When you invoke a service with RequestResponse, Step Functions sends a request and waits for an immediate response before proceeding to the next state. This is ideal for operations that complete quickly—typically within seconds. The service either succeeds or fails, and that outcome is returned directly to your state machine. If the operation times out (which it will, after a default of 99 years), the task fails.

**Run a Job (.sync)** is designed for asynchronous, long-running operations. This pattern is commonly used with services like ECS, Glue, SageMaker, and Batch. When you use the `.sync` suffix in your resource URI, Step Functions polls the service repeatedly until the job completes. For example, `arn:aws:states:::ecs:runTask.sync` tells Step Functions to run an ECS task and keep checking its status until it's done—no matter if that takes minutes or hours. This is transformative for workflows where tasks might take significant time.

**Wait for Task Token (.waitForTaskToken)** enables human-in-the-loop workflows. Instead of polling for completion, Step Functions generates a unique token and passes it to your service. Your application (or human) then uses that token to notify Step Functions when work is complete. This pattern is essential for approval workflows, manual interventions, or integrations with external systems that can't be polled. You'll see this pattern with services like SQS (where a Lambda reads messages with embedded tokens), SNS, or even HTTP endpoints via API Gateway.

Each pattern serves a distinct purpose, and choosing the right one is crucial for building efficient, cost-effective workflows.

### Invoking Lambda Functions

Lambda is often the first AWS service developers integrate with Step Functions, and for good reason. The integration is straightforward, but understanding when to invoke Lambda directly versus wrapping other services in Lambda is key.

A direct Lambda invocation using RequestResponse is beautifully simple:

```json
{
  "Comment": "Invoke a Lambda function synchronously",
  "StartAt": "ProcessImage",
  "States": {
    "ProcessImage": {
      "Type": "Task",
      "Resource": "arn:aws:states:::lambda:invoke",
      "Parameters": {
        "FunctionName": "image-processor",
        "InvocationType": "RequestResponse",
        "Payload.$": "$"
      },
      "End": true
    }
  }
}
```

In this definition, the `Resource` is `arn:aws:states:::lambda:invoke`, which is a service integration resource—not an ARN that directly references your function. The actual function is specified in the `FunctionName` parameter. You can pass the entire input from the previous state using `"Payload.$": "$"`, or selectively extract parts of the input using JSON Path expressions.

The `InvocationType` parameter determines the integration pattern. `RequestResponse` is synchronous—Step Functions waits for your Lambda to complete and receives the response. The Lambda function's return value becomes the output of this task, flowing into the next state. If your Lambda returns `{"statusCode": 200, "body": "Success"}`, that entire object becomes the task output.

Here's a critical detail many developers miss: when you invoke Lambda from Step Functions using the service integration (not just as a traditional Lambda handler), the Lambda receives the request inside the `Payload` property. If you've set `"Payload.$": "$"`, your Lambda's event object will look like this:

```json
{
  "Payload": {
    "imageUrl": "s3://bucket/image.jpg",
    "userId": "user123"
  }
}
```

Your Lambda code needs to extract the actual data from the `Payload` property:

```python
def handler(event, context):
    payload = event.get('Payload', {})
    image_url = payload.get('imageUrl')
    # Process image...
    return {'result': 'success'}
```

The IAM permissions required for this integration are minimal but essential. Your Step Functions execution role needs permission to invoke the Lambda function:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "lambda:InvokeFunction",
      "Resource": "arn:aws:lambda:region:account-id:function:image-processor"
    }
  ]
}
```

Notice we specify the exact function ARN. You could also use `"Resource": "*"` with caution in development, but production deployments should always restrict to specific functions.

Now, when should you invoke Lambda directly versus wrapping another service in Lambda? The answer comes down to complexity and reusability. If you need to do something simple—transform data, call a single API, make a quick database query—consider whether Step Functions can do it directly. Using direct service integrations keeps your workflow visible, reduces latency, and eliminates the Lambda concurrency limits. However, if you're orchestrating complex business logic, combining multiple services, or reusing the same Lambda across different applications, Lambda is the right choice.

### Working with DynamoDB

DynamoDB integration is where Step Functions' direct service integration really shines. Rather than writing Lambda to read or write to DynamoDB, you can define DynamoDB operations directly in your state machine, making your workflow transparent and removing unnecessary Lambda invocations.

The most common DynamoDB operations in Step Functions are `PutItem` (write), `GetItem` (read), `UpdateItem`, and `DeleteItem`. Here's a practical example—a state machine that processes a customer order by writing it to DynamoDB:

```json
{
  "Comment": "Save order to DynamoDB",
  "StartAt": "SaveOrder",
  "States": {
    "SaveOrder": {
      "Type": "Task",
      "Resource": "arn:aws:states:::dynamodb:putItem",
      "Parameters": {
        "TableName": "Orders",
        "Item": {
          "OrderId": {
            "S.$": "$.orderId"
          },
          "CustomerId": {
            "S.$": "$.customerId"
          },
          "Amount": {
            "N.$": "$.amount"
          },
          "Status": {
            "S": "PENDING"
          },
          "CreatedAt": {
            "S.$": "$$.State.EnteredTime"
          }
        }
      },
      "End": true
    }
  }
}
```

The key thing to understand here is the `Item` structure. DynamoDB's low-level API (which Step Functions uses) requires you to specify the data type for each attribute. The syntax is `"AttributeName": {"DataType": value}`. For a string, you use `"S"`, for a number `"N"`, for a boolean `"BOOL"`. If you're extracting a value from the input, you append `.$` to indicate JSON Path syntax.

Notice `"CreatedAt": {"S.$": "$$.State.EnteredTime"}`. This is clever—we're using a special Step Functions context variable `$$.State.EnteredTime` which contains the timestamp when the state was entered. This is baked into Step Functions' runtime, so no Lambda needed.

A more complex example using `UpdateItem` might look like this:

```json
{
  "Type": "Task",
  "Resource": "arn:aws:states:::dynamodb:updateItem",
  "Parameters": {
    "TableName": "Orders",
    "Key": {
      "OrderId": {
        "S.$": "$.orderId"
      }
    },
    "UpdateExpression": "SET #status = :status, UpdatedAt = :updatedAt",
    "ExpressionAttributeNames": {
      "#status": "Status"
    },
    "ExpressionAttributeValues": {
      ":status": {
        "S": "SHIPPED"
      },
      ":updatedAt": {
        "S.$": "$$.State.EnteredTime"
      }
    }
  },
  "End": true
}
```

This uses DynamoDB's update expression syntax. We're updating the `Status` attribute to "SHIPPED" and the `UpdatedAt` timestamp. Expression attribute names (`#status`) and values (`:status`) are placeholders that prevent issues with reserved words and safely inject values.

The IAM role for your Step Functions execution needs permissions to interact with DynamoDB:

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
        "dynamodb:DeleteItem"
      ],
      "Resource": "arn:aws:dynamodb:region:account-id:table/Orders"
    }
  ]
}
```

Specify the exact table ARN to follow the principle of least privilege.

### Publishing to SNS

SNS (Simple Notification Service) integration with Step Functions is ideal for broadcasting notifications as part of your workflow. Whether you're notifying users of order status, alerting operations teams of failures, or triggering downstream systems, SNS integration is your path forward.

Here's a state machine that notifies a customer when their order ships:

```json
{
  "Comment": "Send notification via SNS",
  "StartAt": "NotifyCustomer",
  "States": {
    "NotifyCustomer": {
      "Type": "Task",
      "Resource": "arn:aws:states:::sns:publish",
      "Parameters": {
        "TopicArn": "arn:aws:sns:region:account-id:order-notifications",
        "Subject": "Your order has shipped",
        "Message.$": "$.orderDetails",
        "MessageAttributes": {
          "CustomerId": {
            "DataType": "String",
            "StringValue.$": "$.customerId"
          },
          "OrderId": {
            "DataType": "String",
            "StringValue.$": "$.orderId"
          }
        }
      },
      "End": true
    }
  }
}
```

The integration is straightforward. The `Resource` is `arn:aws:states:::sns:publish`. You specify the `TopicArn` (the SNS topic to publish to), the `Subject` (which email subscribers see), and the `Message`. The `Message.$` uses JSON Path to pass structured data as the message body.

Message attributes are optional but powerful. They allow you to attach metadata to your SNS message that subscribers can filter on. In this example, we're attaching the CustomerId and OrderId, which SNS subscribers could use to filter notifications or route them appropriately.

One nuance: if `Message` is a JSON object (like `$.orderDetails`), SNS will stringify it. Your subscribers receive it as a JSON string that they'd need to parse. If you want to pass a simple string message, you could do:

```json
"Message": "Your order 12345 has shipped"
```

The IAM permissions required are straightforward:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "sns:Publish",
      "Resource": "arn:aws:sns:region:account-id:order-notifications"
    }
  ]
}
```

A common pattern is to use SNS for both notifications and triggering downstream systems. However, if you need Step Functions to wait for responses (like an approval), SNS alone isn't sufficient. That's where the wait-for-task-token pattern comes in, which we'll explore later.

### Working with SQS

SQS integration typically appears in Step Functions for sending messages to queues that other systems process. However, the integration pattern here is simpler than you might expect—Step Functions sends a message to SQS and considers the task complete when the message is queued (not when it's processed).

Here's a practical example where a workflow sends a message to an SQS queue for downstream processing:

```json
{
  "Comment": "Send message to SQS",
  "StartAt": "QueueDataProcessing",
  "States": {
    "QueueDataProcessing": {
      "Type": "Task",
      "Resource": "arn:aws:states:::sqs:sendMessage",
      "Parameters": {
        "QueueUrl": "https://sqs.region.amazonaws.com/account-id/data-processing-queue",
        "MessageBody.$": "$"
      },
      "End": true
    }
  }
}
```

The `Resource` is `arn:aws:states:::sqs:sendMessage`. You provide the `QueueUrl` (not the queue ARN—SQS uses full URLs) and the `MessageBody`. The `$` passes the entire state input as the message body. SQS will stringify JSON objects, so your consumer will receive a JSON string it needs to parse.

If you want to add structure to your message, you can construct it explicitly:

```json
{
  "MessageBody.$": "States.JsonToString({orderId: $.orderId, customerId: $.customerId, amount: $.amount})"
}
```

The `States.JsonToString()` function serializes a JSON object into a string, which is what SQS expects for the message body.

You can also use message attributes to pass metadata:

```json
{
  "QueueUrl": "https://sqs.region.amazonaws.com/account-id/data-processing-queue",
  "MessageBody.$": "$.orderData",
  "MessageAttributes": {
    "Priority": {
      "StringValue": "HIGH",
      "DataType": "String"
    },
    "Source": {
      "StringValue": "StepFunctions",
      "DataType": "String"
    }
  }
}
```

One important distinction: this integration only handles *sending* messages to SQS. It doesn't handle receiving and processing messages, which brings us back to Lambda. If you need a workflow state that waits for SQS messages (perhaps as part of a human approval loop), you'd typically use the wait-for-task-token pattern with a Lambda consumer. That Lambda would pull messages from SQS, extract the task token, and send it back to Step Functions when work is complete.

The IAM permissions for SQS are:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "sqs:SendMessage",
      "Resource": "arn:aws:sqs:region:account-id:data-processing-queue"
    }
  ]
}
```

### Orchestrating ECS Tasks with Long-Running Sync

ECS integration is where the `.sync` pattern truly demonstrates its value. Unlike Lambda, which completes in seconds or minutes, ECS tasks might run for extended periods—processing large datasets, running backups, or executing batch jobs. The `.sync` pattern is built exactly for this scenario.

Here's a state machine that launches an ECS task and waits for it to complete:

```json
{
  "Comment": "Run ECS task and wait for completion",
  "StartAt": "RunDataProcessingTask",
  "States": {
    "RunDataProcessingTask": {
      "Type": "Task",
      "Resource": "arn:aws:states:::ecs:runTask.sync",
      "Parameters": {
        "LaunchType": "FARGATE",
        "Cluster": "data-processing-cluster",
        "TaskDefinition": "data-processor:1",
        "NetworkConfiguration": {
          "AwsvpcConfiguration": {
            "Subnets": ["subnet-12345", "subnet-67890"],
            "SecurityGroups": ["sg-12345"],
            "AssignPublicIp": "DISABLED"
          }
        },
        "Overrides": {
          "ContainerOverrides": [
            {
              "Name": "processor",
              "Environment": [
                {
                  "Name": "INPUT_DATA",
                  "Value.$": "$.dataUrl"
                },
                {
                  "Name": "OUTPUT_BUCKET",
                  "Value": "my-results-bucket"
                }
              ]
            }
          ]
        }
      },
      "TimeoutSeconds": 3600,
      "End": true
    }
  }
}
```

The `.sync` suffix is the critical piece. Without it, Step Functions would start the task and immediately move to the next state. With `.sync`, it polls the ECS service repeatedly until the task reaches a terminal state (RUNNING, STOPPED, etc.).

Several elements deserve attention here. First, `LaunchType` specifies whether to use Fargate or EC2. For Fargate, you must provide `NetworkConfiguration` with VPC subnets and security groups. If you're using EC2 launch type, you don't need network configuration but might specify `PlacementConstraints`.

The `Overrides` section is powerful—it allows you to pass dynamic data from your state machine to the ECS task. Here, we're setting environment variables that the container can read. The `INPUT_DATA` environment variable is populated from `$.dataUrl` (using JSON Path), while `OUTPUT_BUCKET` is a static value. Your container code can read these:

```python
import os
input_data = os.environ.get('INPUT_DATA')
output_bucket = os.environ.get('OUTPUT_BUCKET')
# Process...
```

The `TimeoutSeconds` is important—it defines how long Step Functions will wait for the task to complete. If the task doesn't finish within this window, the state fails. For long-running tasks, make sure this is generous.

What happens when the task completes? By default, the output of an ECS task in a synchronous integration is a JSON object containing the task's exit code and other metadata:

```json
{
  "Cluster": "arn:aws:ecs:region:account-id:cluster/data-processing-cluster",
  "TaskArn": "arn:aws:ecs:region:account-id:task/data-processing-cluster/abc123",
  "Containers": [
    {
      "ContainerArn": "arn:aws:ecs:region:account-id:container-instance/...",
      "ExitCode": 0,
      "LastStatus": "STOPPED"
    }
  ]
}
```

If the task's exit code is 0, it succeeded. Any non-zero exit code indicates failure, and the state machine task fails accordingly.

The IAM permissions for ECS orchestration are more extensive:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "ecs:RunTask",
        "ecs:StopTask",
        "ecs:DescribeTasks"
      ],
      "Resource": [
        "arn:aws:ecs:region:account-id:task-definition/data-processor:*",
        "arn:aws:ecs:region:account-id:task/data-processing-cluster/*"
      ]
    },
    {
      "Effect": "Allow",
      "Action": "iam:PassRole",
      "Resource": [
        "arn:aws:iam::account-id:role/ecsTaskExecutionRole",
        "arn:aws:iam::account-id:role/ecsTaskRole"
      ]
    }
  ]
}
```

The `iam:PassRole` permission is essential—it allows Step Functions to pass the task execution role to ECS. Without it, your ECS task won't have the permissions it needs to access other AWS services.

### Calling HTTP Endpoints via API Gateway

API Gateway integration opens the door to calling HTTP endpoints directly from Step Functions. This is useful for triggering webhooks, calling third-party APIs, or invoking custom HTTP services running on EC2 or on-premises infrastructure.

Here's a state machine that calls an HTTP endpoint:

```json
{
  "Comment": "Call HTTP endpoint via API Gateway",
  "StartAt": "CallWebhook",
  "States": {
    "CallWebhook": {
      "Type": "Task",
      "Resource": "arn:aws:states:::http:invoke",
      "Parameters": {
        "ApiEndpoint": "https://api.example.com/webhook",
        "Method": "POST",
        "Headers": {
          "Content-Type": "application/json",
          "Authorization.$": "$.authToken"
        },
        "RequestBody.$": "$"
      },
      "TimeoutSeconds": 30,
      "End": true
    }
  }
}
```

The `Resource` is `arn:aws:states:::http:invoke`. You specify the `ApiEndpoint` (the full HTTPS URL), the HTTP `Method` (GET, POST, PUT, etc.), optional `Headers`, and the `RequestBody`. The entire state input (`$`) becomes the request body.

The response from the HTTP call becomes the task output. If the endpoint returns a JSON response like `{"status": "success"}`, that becomes available to downstream states.

However, there's an important consideration: the Step Functions execution role doesn't need special permissions for HTTP calls—any execution role can call public endpoints. But you should enable logging to see what's happening:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "logs:CreateLogDelivery",
        "logs:GetLogDelivery",
        "logs:UpdateLogDelivery",
        "logs:DeleteLogDelivery",
        "logs:ListLogDeliveries",
        "logs:PutResourcePolicy",
        "logs:DescribeResourcePolicies",
        "logs:DescribeLogGroups"
      ],
      "Resource": "*"
    }
  ]
}
```

A critical concern with HTTP endpoints is timeout and retry behavior. By default, Step Functions waits up to 25 seconds for an HTTP response. You can adjust this with `TimeoutSeconds`. If the endpoint is unreliable, you can add retry and catch logic:

```json
{
  "Type": "Task",
  "Resource": "arn:aws:states:::http:invoke",
  "Parameters": {
    "ApiEndpoint": "https://api.example.com/webhook",
    "Method": "POST",
    "RequestBody.$": "$"
  },
  "Retry": [
    {
      "ErrorEquals": ["States.TaskFailed", "States.Timeout"],
      "IntervalSeconds": 2,
      "MaxAttempts": 3,
      "BackoffRate": 2.0
    }
  ],
  "Catch": [
    {
      "ErrorEquals": ["States.ALL"],
      "Next": "HandleFailure"
    }
  ],
  "TimeoutSeconds": 30,
  "End": true
}
```

This configuration retries on failures up to 3 times, with exponential backoff. If all retries fail, it transitions to the `HandleFailure` state.

### Human-in-the-Loop with Wait for Task Token

The wait-for-task-token pattern is where Step Functions enables human approval workflows and integration with systems that can't be polled. Instead of Step Functions repeatedly checking if something is done, it hands off responsibility to an external system with a unique token, and waits for that external system to call back.

Let's look at a practical example: a workflow that requires manual approval before processing sensitive data.

```json
{
  "Comment": "Approval workflow with task token",
  "StartAt": "RequestApproval",
  "States": {
    "RequestApproval": {
      "Type": "Task",
      "Resource": "arn:aws:states:::lambda:invoke.waitForTaskToken",
      "Parameters": {
        "FunctionName": "send-approval-request",
        "InvocationType": "Event",
        "Payload": {
          "action": "request_approval",
          "taskToken.$": "$$.Task.Token",
          "orderId.$": "$.orderId",
          "amount.$": "$.amount"
        }
      },
      "TimeoutSeconds": 3600,
      "Next": "ProcessOrder"
    },
    "ProcessOrder": {
      "Type": "Task",
      "Resource": "arn:aws:lambda:region:account-id:function:process-order",
      "End": true
    }
  }
}
```

The `.waitForTaskToken` suffix signals to Step Functions that this task will wait for an explicit callback. Notice the special context variable `$$.Task.Token`—this is automatically generated by Step Functions and represents a unique identifier for this specific task execution. We pass it to our Lambda function in the `Payload`.

The `InvocationType: Event` is crucial here. It's asynchronous, meaning Lambda fires the Lambda but doesn't wait for it to complete. The Lambda function reads the task token and sends it to whoever needs to approve the request (perhaps saving it to DynamoDB or sending it in an email).

Your Lambda function (the approval request sender) might look like this:

```python
import json
import boto3

dynamodb = boto3.resource('dynamodb')

def handler(event, context):
    payload = event.get('Payload', {})
    task_token = payload.get('taskToken')
    order_id = payload.get('orderId')
    amount = payload.get('amount')
    
    # Store the token temporarily so the approver can reference it
    table = dynamodb.Table('ApprovalRequests')
    table.put_item(Item={
        'RequestId': order_id,
        'TaskToken': task_token,
        'Amount': amount,
        'Status': 'PENDING'
    })
    
    # Send an email/notification asking for approval
    # The approval handler will retrieve the token and send it back
    
    return {'success': True}
```

Later, when someone approves the request (via a dashboard button, API call, or email link), another system retrieves the task token and sends it back to Step Functions. A separate approval-handling Lambda might do this:

```python
import boto3

stepfunctions = boto3.client('stepfunctions')

def handler(event, context):
    # This handler is called when someone clicks "Approve" in a web dashboard
    request_id = event['requestId']
    approved = event.get('approved', False)
    
    # Retrieve the task token from your storage
    task_token = retrieve_token_from_storage(request_id)
    
    # Send the token back to Step Functions
    if approved:
        stepfunctions.send_task_success(
            taskToken=task_token,
            output=json.dumps({'approved': True})
        )
    else:
        stepfunctions.send_task_failure(
            taskToken=task_token,
            error='REJECTED',
            cause='Approval was rejected'
        )
    
    return {'status': 'callback_sent'}
```

The Step Functions SDK provides `send_task_success` and `send_task_failure` methods. Calling `send_task_success` with the task token causes Step Functions to resume the workflow and move to the next state. The output you provide becomes available to downstream states. Calling `send_task_failure` causes the task to fail, triggering any error handling you've configured.

This pattern is powerful for approval workflows, but it comes with considerations. First, you're responsible for managing the token. If you lose it or the external system crashes before sending it back, the workflow hangs. The `TimeoutSeconds` parameter ensures the workflow doesn't wait forever—if no callback arrives within that window, the task fails. Second, the token is a secret—treat it like a credential. Don't log it, and ensure it's transmitted over HTTPS.

The IAM permissions for this pattern require the ability to call Lambda and to describe state machines:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "lambda:InvokeFunction",
      "Resource": "arn:aws:lambda:region:account-id:function:send-approval-request"
    },
    {
      "Effect": "Allow",
      "Action": [
        "states:SendTaskSuccess",
        "states:SendTaskFailure"
      ],
      "Resource": "*"
    }
  ]
}
```

Note that the Lambda function calling `send_task_success` or `send_task_failure` needs its own IAM role with the `states:SendTaskSuccess` and `states:SendTaskFailure` permissions.

### Direct Service Integration vs. Lambda Wrapping

By now, you've seen examples of both direct service integration and Lambda wrapping. The question many developers ask is: when should I use which approach?

**Use direct service integration when**: The operation is straightforward and requires minimal logic transformation. Calling DynamoDB to read or write a record, publishing to SNS, writing to SQS, invoking Lambda, or launching ECS tasks are all excellent candidates. Direct integration reduces latency, eliminates Lambda concurrency constraints, and keeps your workflow transparent and auditable. If your operation can be expressed in the service's native parameters and doesn't require complex conditional logic, go direct.

**Use Lambda wrapping when**: You need to orchestrate multiple services, transform data in complex ways, or reuse the logic across applications. If you're reading from DynamoDB, transforming the result, calling an external API, and then writing to S3, Lambda is the right choice. Lambda also shines for operations that require conditional logic, error handling, or retry strategies that are easier to express in code than in state machine JSON. Additionally, if you have team members who are more comfortable writing Python or JavaScript than maintaining JSON state machines, Lambda provides an escape hatch.

A practical example: suppose you're processing an order. You might orchestrate like this—a state machine that directly writes to DynamoDB (simple operation) but invokes Lambda to validate payment with an external service (complex logic). The workflow is hybrid, playing to the strengths of each approach.

Here's a hybrid state machine:

```json
{
  "Comment": "Hybrid approach - direct services and Lambda",
  "StartAt": "SaveOrder",
  "States": {
    "SaveOrder": {
      "Type": "Task",
      "Resource": "arn:aws:states:::dynamodb:putItem",
      "Parameters": {
        "TableName": "Orders",
        "Item": {
          "OrderId": {"S.$": "$.orderId"},
          "CustomerId": {"S.$": "$.customerId"},
          "Amount": {"N.$": "$.amount"},
          "Status": {"S": "PENDING"}
        }
      },
      "Next": "ValidatePayment"
    },
    "ValidatePayment": {
      "Type": "Task",
      "Resource": "arn:aws:lambda:region:account-id:function:validate-payment",
      "Parameters": {
        "orderId.$": "$.orderId",
        "amount.$": "$.amount"
      },
      "Next": "CheckValidation"
    },
    "CheckValidation": {
      "Type": "Choice",
      "Choices": [
        {
          "Variable": "$.valid",
          "BooleanEquals": true,
          "Next": "ProcessOrder"
        }
      ],
      "Default": "RejectOrder"
    },
    "ProcessOrder": {
      "Type": "Task",
      "Resource": "arn:aws:states:::sns:publish",
      "Parameters": {
        "TopicArn": "arn:aws:sns:region:account-id:order-processing",
        "Subject": "Order approved",
        "Message.$": "$.orderId"
      },
      "End": true
    },
    "RejectOrder": {
      "Type": "Task",
      "Resource": "arn:aws:states:::sns:publish",
      "Parameters": {
        "TopicArn": "arn:aws:sns:region:account-id:order-processing",
        "Subject": "Order rejected",
        "Message.$": "$.orderId"
      },
      "End": true
    }
  }
}
```

This workflow directly writes to DynamoDB, invokes Lambda for payment validation (which returns `{valid: true/false}`), uses a Choice state to branch based on the result, and then publishes to SNS. It's a clean separation of concerns: simple operations are direct, complex operations go through Lambda.

### Cross-Service Patterns and Best Practices

As you build more complex workflows, certain patterns emerge. Error handling, for example, looks the same regardless of which service you're calling:

```json
{
  "Type": "Task",
  "Resource": "arn:aws:states:::lambda:invoke",
  "Parameters": {
    "FunctionName": "risky-operation",
    "Payload.$": "$"
  },
  "Retry": [
    {
      "ErrorEquals": ["States.TaskFailed", "States.Timeout"],
      "IntervalSeconds": 1,
      "MaxAttempts": 3,
      "BackoffRate": 2.0
    }
  ],
  "Catch": [
    {
      "ErrorEquals": ["States.ALL"],
      "Next": "HandleError",
      "ResultPath": "$.error"
    }
  ],
  "End": true
}
```

The `Retry` block allows automatic retries with exponential backoff. The `Catch` block handles exceptions that survive retries. The `ResultPath` specifies where to store error information—`"$.error"` inserts it at the top level of the output.

Another pattern is using `ResultPath` to control what data flows to the next state. By default, the output of a task becomes its entire output. But you might want to preserve the original input and add to it:

```json
{
  "Type": "Task",
  "Resource": "arn:aws:states:::dynamodb:getItem",
  "Parameters": {
    "TableName": "Users",
    "Key": {"UserId": {"S.$": "$.userId"}}
  },
  "ResultPath": "$.userDetails",
  "End": true
}
```

Here, the DynamoDB response is stored at `$.userDetails`, and if the input was `{userId: "123", action: "approve"}`, the output becomes `{userId: "123", action: "approve", userDetails: {...}}`. This is powerful for building up context as the workflow progresses.

### Monitoring, Logging, and Debugging

Understanding what's happening in your workflows requires proper logging. When you create a Step Functions state machine via the AWS CLI or CloudFormation, include logging configuration:

```json
{
  "stateMachineArn": "arn:aws:states:region:account-id:stateMachine:MyStateMachine",
  "definition": { ... },
  "loggingConfiguration": {
    "level": "ALL",
    "includeExecutionData": true,
    "destinations": [
      {
        "cloudWatchLogsLogGroup": {
          "logGroupName": "/aws/states/my-state-machine"
        }
      }
    ]
  }
}
```

Enabling `level: ALL` captures everything. `includeExecutionData: true` includes the actual payload being processed (useful for debugging but be mindful of sensitive data). Logs flow to CloudWatch Logs, where you can search and analyze them.

When debugging service integrations, pay attention to the task's output. Each service returns structured data that tells you what happened. An ECS task returns exit codes. A DynamoDB PutItem returns the item you inserted. Lambda returns your function's return value. Understanding these outputs helps you catch issues early.

### Conclusion

Integrating Step Functions with other AWS services transforms them from individual, siloed tools into a cohesive, orchestrated system. Whether you're invoking Lambda for complex logic, calling DynamoDB for persistence, publishing to SNS for notifications, running ECS tasks for long-running jobs, or waiting for human approval via task tokens, the patterns are consistent: understand the integration resource, craft the parameters correctly, provide adequate IAM permissions, and choose the right pattern for your use case.

The key distinction between RequestResponse (synchronous), .sync (asynchronous polling), and .waitForTaskToken (callback-based) determines how your workflow behaves. RequestResponse is your default for fast operations. .sync handles long-running asynchronous work like ECS and Batch jobs. .waitForTaskToken enables human-in-the-loop workflows and integration with external systems that can't be polled.

As you design workflows, remember that direct service integration is powerful and efficient when the operation is straightforward, but don't hesitate to wrap services in Lambda when business logic is complex. The most effective workflows are hybrid—using direct integration where it shines and Lambda where it adds value. With these patterns and practices in place, you're equipped to build production-grade workflows that are transparent, maintainable, and efficient.
