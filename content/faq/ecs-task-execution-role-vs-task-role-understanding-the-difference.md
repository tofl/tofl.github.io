---
title: "ECS Task Execution Role vs Task Role: Understanding the Difference"
---

## ECS Task Execution Role vs Task Role: Understanding the Difference

When you're working with Amazon ECS (Elastic Container Service), you'll quickly encounter a concept that trips up even experienced developers: the distinction between the task execution role and the task role. These are two fundamentally different IAM roles that operate at different layers of your containerized application, and confusing them is one of the most common sources of permission-related bugs in production.

The problem isn't that these roles are inherently complicated—it's that they sound similar, serve similar purposes (granting permissions), and are often discussed in the same breath. Yet they grant permissions to different entities at different points in the container's lifecycle. Getting this wrong means your application might fail to start, or it might start successfully but crash when it tries to call AWS services. Let's untangle this distinction and build a solid mental model you can rely on.

### The Core Distinction: Who Gets Permission to Do What?

Think of an ECS task as having two distinct phases: startup and runtime. The task execution role handles permissions during startup, while the task role handles permissions during runtime—when your actual application code is running.

The **task execution role** is assumed by the ECS container agent (a background process running on your EC2 instance or AWS Fargate infrastructure). This role grants permissions for the infrastructure layer to set up your container before your application even starts executing. The ECS agent uses this role to pull your Docker image from Amazon ECR, retrieve secrets from AWS Secrets Manager or Parameter Store, and send logs to CloudWatch. Without proper permissions here, your container won't even start.

The **task role** is assumed by your application code running inside the container. When your application needs to call AWS APIs—whether that's reading from DynamoDB, writing to S3, or publishing to SNS—it's the task role that provides those permissions. The ECS agent sets up temporary credentials for this role and makes them available to your container through environment variables or the EC2 instance metadata service.

Here's a practical analogy: imagine deploying a web application to a physical server. The task execution role is like the IT administrator who needs permission to install software, set up networking, and configure the environment. The task role is like the application itself, which needs permission to access the databases and services it depends on during operation. You wouldn't give the IT administrator all the permissions the application needs, and vice versa.

### The Task Execution Role in Detail

The task execution role is all about enabling the ECS infrastructure to prepare your task for execution. Let's walk through what it actually does.

When you launch an ECS task, the ECS container agent immediately needs to pull your Docker image. If that image is in a private ECR registry (which is typical in production), the agent needs permission to call the ECR API and authenticate to the registry. Without this, you'll see image pull failures and your task will never transition to a running state.

The agent also needs to handle secrets and sensitive configuration. Many applications require database passwords, API keys, or other sensitive values. If you're storing these in AWS Secrets Manager or the Systems Manager Parameter Store, the agent needs permission to retrieve them and inject them into the container environment. This happens before your application starts.

Finally, CloudWatch Logs integration requires permission. If you want your container's stdout and stderr to flow into CloudWatch Logs (which you almost certainly do for observability), the agent needs the `logs:CreateLogStream` and `logs:PutLogEvents` permissions. Without these, your logs vanish into the void.

Let's look at a concrete IAM policy that grants the minimum necessary permissions for the task execution role:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "ecr:GetAuthorizationToken",
        "ecr:BatchGetImage",
        "ecr:GetDownloadUrlForLayer"
      ],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "logs:CreateLogStream",
        "logs:PutLogEvents"
      ],
      "Resource": "arn:aws:logs:us-east-1:123456789012:log-group:/ecs/my-app:*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "secretsmanager:GetSecretValue",
        "ssm:GetParameters"
      ],
      "Resource": [
        "arn:aws:secretsmanager:us-east-1:123456789012:secret:db-password-*",
        "arn:aws:ssm:us-east-1:123456789012:parameter/prod/api-key"
      ]
    }
  ]
}
```

Notice that this policy is narrowly scoped to exactly what the ECS agent needs. The ECR permission uses a wildcard because the authorization token is account-level, but the CloudWatch and Secrets Manager permissions are specific to the resources involved. This follows the principle of least privilege.

### The Task Role in Detail

The task role is where your application's actual AWS permissions live. This is where you grant your containerized application the ability to call AWS services as part of its normal operation.

Let's say you have a Node.js application that needs to read data from DynamoDB, upload files to S3, and send messages to an SNS topic. Each of these capabilities requires explicit permission in the task role's IAM policy. When your application code calls the AWS SDK (whether that's `boto3` for Python, the AWS SDK for JavaScript, or any other language), it automatically uses the credentials that the ECS agent has set up for the task role.

The key thing to understand is that these credentials are temporary and rotated automatically. The ECS agent configures environment variables like `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, and `AWS_SESSION_TOKEN`, and your application code uses these to authenticate. There's no long-term credential exposure, which is a significant security advantage.

Here's an example task role policy for that Node.js application:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "dynamodb:GetItem",
        "dynamodb:Query",
        "dynamodb:Scan"
      ],
      "Resource": "arn:aws:dynamodb:us-east-1:123456789012:table/UserData"
    },
    {
      "Effect": "Allow",
      "Action": [
        "s3:PutObject",
        "s3:GetObject"
      ],
      "Resource": "arn:aws:s3:::my-app-bucket/*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "sns:Publish"
      ],
      "Resource": "arn:aws:sns:us-east-1:123456789012:user-events"
    }
  ]
}
```

This policy grants exactly what the application needs and nothing more. Notice the specificity: DynamoDB actions are limited to a particular table, S3 permissions are scoped to a specific bucket, and SNS is limited to a specific topic.

### A Common Mistake: The Role Confusion

Here's where the confusion typically happens. A developer creates an ECS task definition and realizes their application is failing because it can't access DynamoDB. Naturally, they add DynamoDB permissions. But they add them to the task execution role instead of the task role.

The task immediately starts without errors—because the task execution role doesn't affect whether the container can start. But the application inside the container still can't access DynamoDB, because the application doesn't have the task execution role; it has the task role. The developer then spends an hour debugging, wondering why the permissions they just added aren't working.

The mental model that prevents this mistake is simple: the task execution role is infrastructure-focused (it gets the container ready), while the task role is application-focused (it's what your code uses). If your application is failing to call an AWS service, you need to fix the task role. If your container is failing to start or log output is disappearing, you need to fix the task execution role.

### How the Roles Work Together in Practice

Let's trace through a complete example to see how both roles interact in a real scenario.

You define an ECS task definition with:
- Task execution role ARN: `arn:aws:iam::123456789012:role/ecsTaskExecutionRole`
- Task role ARN: `arn:aws:iam::123456789012:role/ecsTaskRole`
- Image: `123456789012.dkr.ecr.us-east-1.amazonaws.com/my-app:latest`
- Secrets: A database password stored in Secrets Manager

When you launch this task, here's what happens:

First, the ECS agent (running with the task execution role credentials) authenticates to ECR, pulls your image, and retrieves the database password from Secrets Manager. It creates a log stream in CloudWatch if one doesn't exist. All of this happens using the permissions from the task execution role.

Next, the container starts and your application begins running. The ECS agent has set up environment variables containing temporary credentials for the task role. When your application code calls `new DynamoDBClient()` or `s3.putObject()`, the AWS SDK automatically picks up these credentials and uses them to authenticate the API call. This uses the permissions from the task role.

If the task execution role is missing ECR permissions, the container never starts—you see an image pull failure.

If the task role is missing DynamoDB permissions, the container starts fine, but the application crashes with an access denied error when it tries to query the database.

### Task Execution Role for Fargate vs EC2

There's one important difference in how these roles work depending on whether you're using ECS on AWS Fargate or ECS on EC2 instances.

With Fargate, AWS manages the underlying infrastructure entirely. The task execution role is the only place you can define how to authenticate to ECR, Secrets Manager, and CloudWatch. Fargate has no way to assume any other role for these infrastructure operations.

With ECS on EC2, the situation is slightly different. The EC2 instance itself has an instance profile (an IAM role). The ECS container agent running on that instance can use either the instance profile's permissions or the task execution role's permissions for infrastructure operations like ECR and CloudWatch access. However, best practice is still to use an explicit task execution role because it gives you finer control and clearer separation of concerns. The instance profile should typically be used only for agent management and other infrastructure-level tasks, not for application-level container setup.

### Practical Setup: Creating Both Roles

In practice, you'll create these roles either through the AWS Console, CloudFormation, or Infrastructure as Code tools like Terraform. Let me show you how this typically works.

For the task execution role, you'd create a role with a trust policy that allows the ECS service to assume it:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Service": "ecs-tasks.amazonaws.com"
      },
      "Action": "sts:AssumeRole"
    }
  ]
}
```

Then attach a policy with the infrastructure-level permissions we discussed earlier. The task role would have an identical trust policy but a completely different permission policy containing your application's AWS API permissions.

In your ECS task definition (whether you're using the JSON format or the CloudFormation syntax), you'd specify both:

```json
{
  "family": "my-app",
  "executionRoleArn": "arn:aws:iam::123456789012:role/ecsTaskExecutionRole",
  "taskRoleArn": "arn:aws:iam::123456789012:role/ecsTaskRole",
  "containerDefinitions": [
    {
      "name": "my-app",
      "image": "123456789012.dkr.ecr.us-east-1.amazonaws.com/my-app:latest",
      "memory": 512,
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "/ecs/my-app",
          "awslogs-region": "us-east-1",
          "awslogs-stream-prefix": "ecs"
        }
      }
    }
  ]
}
```

Notice that both roles are specified at the task definition level, not the container level. A single task can contain multiple containers, but they all share the same execution role and task role.

### Debugging Permission Issues

When you're facing permission-related failures in ECS, a systematic approach helps. First, determine whether the problem is a startup issue or a runtime issue. Check your CloudWatch Logs for the specific error message. If you see "CannotPullContainerImage" or "secrets retrieval failed," the issue is with the task execution role. If you see application-level errors like "AccessDenied" when calling DynamoDB, the issue is with the task role.

For task execution role issues, verify that the role has permissions to:
- Call `ecr:GetAuthorizationToken`, `ecr:BatchGetImage`, and `ecr:GetDownloadUrlForLayer` for ECR access
- Call `secretsmanager:GetSecretValue` or `ssm:GetParameters` if you're using secrets
- Call `logs:CreateLogStream` and `logs:PutLogEvents` if using CloudWatch Logs

For task role issues, examine your application code to identify what AWS APIs it's calling, then verify those permissions are explicitly granted.

### Key Takeaways

The distinction between task execution role and task role ultimately boils down to responsibility and timing. The task execution role is your infrastructure layer's ticket to set up the container environment. The task role is your application's ticket to call AWS services. They're both necessary, and mixing them up is a quick path to mysterious failures.

Remember that the task execution role is about getting your container started: pulling the image, retrieving secrets, and sending logs. The task role is about what your application does once it's running: accessing databases, storage, and messaging services. When something goes wrong, your first question should be whether the problem is a startup issue or a runtime issue. That answer immediately tells you which role to investigate.

As you build more applications on ECS, this distinction becomes second nature. You'll instinctively know to expand the task role when you add a new AWS API call to your application code, and to expand the task execution role only when you change how the container itself is configured. This clarity prevents a lot of troubleshooting pain down the road.
