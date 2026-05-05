---
title: "Using IAM Roles Instead of Access Keys on EC2, Lambda, and ECS"
---

## Using IAM Roles Instead of Access Keys on EC2, Lambda, and ECS

Imagine you're deploying an application that needs to read secrets from AWS Secrets Manager, write logs to CloudWatch, and fetch data from an S3 bucket. Your first instinct might be to generate an AWS Access Key and Secret Access Key, embed them in your application code or configuration files, and call it done. But here's the problem: those keys are now sitting in your codebase, your configuration management system, your container images, and possibly your version control history. If anyone gains access to those keys—through a compromised server, a leaked GitHub repository, or an overzealous developer sharing configuration—they have permanent access to your AWS resources until you manually rotate the keys.

This is where IAM roles change the game. Instead of managing long-lived credentials, you assign a role to your compute resource, and AWS automatically provides temporary, auto-rotating credentials. The AWS SDK handles the heavy lifting transparently, so your code doesn't need to know about credentials at all. This approach is not just a best practice—it's a foundational security pattern that underpins secure AWS deployments at scale.

In this article, we'll explore how to use IAM roles across EC2, Lambda, and ECS, understand how credential retrieval works behind the scenes, and walk through the practical steps to migrate from long-lived access keys.

### Why IAM Roles Are Superior to Access Keys

Before diving into implementation, let's understand why this matters. Long-lived access keys are a liability. They don't expire automatically, they can be copied and shared, and they're easy to accidentally commit to version control. Even with the best intentions, managing access keys across teams and environments becomes a security headache.

IAM roles solve this by issuing temporary security credentials that last for a limited time—typically 15 minutes to a few hours, depending on your configuration. These credentials are automatically rotated by AWS, so even if someone intercepts a credential, its window of usefulness is narrow. The credentials are delivered to your compute resource by AWS through secure metadata services, so they never need to be stored or manually managed by you.

From an operational perspective, this also simplifies key rotation. Instead of coordinating access key changes across multiple servers and applications, you simply update the IAM role's permissions, and all resources using that role immediately inherit the new permissions. There's no key sprawl, no forgotten keys in abandoned servers, and no emergency late-night calls to rotate credentials.

### IAM Roles and Instance Profiles for EC2

When you want an EC2 instance to access AWS resources, you assign an IAM role to it via an instance profile. An instance profile is essentially a container that holds an IAM role; it's the mechanism that allows EC2 to use that role.

Here's how the flow works: you create an IAM role with a trust relationship that allows the EC2 service to assume it. You then attach policies to that role granting the permissions your application needs. Finally, you create an instance profile, attach the role to it, and associate the instance profile with your EC2 instance—either at launch time or afterward.

Let's walk through a concrete example. Suppose you have an application running on EC2 that needs to read from an S3 bucket. First, you'd create an IAM role:

```
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Service": "ec2.amazonaws.com"
      },
      "Action": "sts:AssumeRole"
    }
  ]
}
```

This trust policy allows the EC2 service to assume the role. Next, you'd attach a policy that grants S3 permissions:

```
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:ListBucket"
      ],
      "Resource": [
        "arn:aws:s3:::my-bucket",
        "arn:aws:s3:::my-bucket/*"
      ]
    }
  ]
}
```

Now you create an instance profile and attach the role:

```bash
aws iam create-instance-profile --instance-profile-name my-app-profile
aws iam add-role-to-instance-profile \
  --instance-profile-name my-app-profile \
  --role-name my-app-role
```

When you launch an EC2 instance, you specify this instance profile. If you're launching from the AWS Management Console, you'll see an "IAM instance profile" dropdown on the details page. Via the AWS CLI, you'd use the `--iam-instance-profile` parameter:

```bash
aws ec2 run-instances \
  --image-id ami-0c55b159cbfafe1f0 \
  --instance-type t3.micro \
  --iam-instance-profile Name=my-app-profile
```

Once the instance is running, the AWS SDK on that instance automatically retrieves temporary credentials from the EC2 instance metadata service. Your application doesn't need to hardcode credentials or reference them from environment variables. It just uses the SDK as normal, and the SDK handles credential retrieval behind the scenes. For example, using the AWS SDK for Python (boto3):

```python
import boto3

s3_client = boto3.client('s3')
response = s3_client.get_object(Bucket='my-bucket', Key='myfile.txt')
```

The SDK automatically detects it's running on EC2, queries the instance metadata service for credentials, caches them, and refreshes them before they expire.

### How EC2 Credentials Are Retrieved via IMDSv2

The mechanism for retrieving credentials on EC2 is the Instance Metadata Service, and understanding it demystifies a lot of AWS security practices. The older version, IMDSv1, was simple but had a vulnerability: it could be exploited from within a container or poorly configured application to leak credentials. IMDSv2 addresses this by requiring a two-step process.

With IMDSv2, your application first makes a PUT request to a special endpoint to obtain a token, then uses that token in a GET request to fetch the actual metadata. This prevents certain types of attacks because an attacker would need to initiate the PUT request, not just snoop on GET requests.

The endpoint is always `http://169.254.169.254/latest/meta-data/`, and it's only accessible from within the instance itself. When your application calls the AWS SDK, the SDK handles this protocol automatically. If you were to manually inspect what's happening, you'd see something like this:

```bash
# Step 1: Get the token (IMDSv2)
curl -X PUT "http://169.254.169.254/latest/api/token" \
  -H "X-aws-ec2-metadata-token-ttl-seconds: 21600"

# Step 2: Use the token to fetch credentials
curl -H "X-aws-ec2-metadata-token: $TOKEN" \
  "http://169.254.169.254/latest/meta-data/iam/security-credentials/my-app-role"
```

The response includes the temporary access key, secret key, and session token, along with an expiration time. The AWS SDK caches these credentials and refreshes them automatically before they expire.

By default, new EC2 instances are configured to use IMDSv2, which is the secure choice. However, if you have legacy applications that rely on IMDSv1, you may need to support both. You can configure the instance metadata options when launching an instance to enforce IMDSv2 only, which is highly recommended.

### IAM Execution Roles for Lambda

Lambda simplifies credential management even further. You don't create instance profiles; instead, you assign an execution role directly to your Lambda function. This role grants the function permissions to access AWS services and resources.

When you create a Lambda function, you specify an execution role. This role must have a trust relationship allowing the Lambda service to assume it:

```
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Service": "lambda.amazonaws.com"
      },
      "Action": "sts:AssumeRole"
    }
  ]
}
```

You then attach policies to grant the specific permissions your function needs. For example, if your Lambda function writes to DynamoDB:

```
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "dynamodb:PutItem",
        "dynamodb:GetItem"
      ],
      "Resource": "arn:aws:dynamodb:us-east-1:123456789012:table/my-table"
    }
  ]
}
```

Via the AWS CLI, you can create a function with an execution role like this:

```bash
aws lambda create-function \
  --function-name my-function \
  --runtime python3.11 \
  --role arn:aws:iam::123456789012:role/my-execution-role \
  --handler index.handler \
  --zip-file fileb://function.zip
```

Inside your Lambda function code, the AWS SDK automatically retrieves credentials from the container credentials endpoint, which is provided to the function via the `AWS_CONTAINER_CREDENTIALS_FULL_URI` and `AWS_CONTAINER_AUTHORIZATION_TOKEN` environment variables. Your function code remains clean and credential-agnostic:

```python
import json
import boto3

dynamodb = boto3.resource('dynamodb')

def handler(event, context):
    table = dynamodb.Table('my-table')
    table.put_item(Item={'id': '123', 'data': 'example'})
    return {
        'statusCode': 200,
        'body': json.dumps('Success')
    }
```

Lambda's execution role model is intentionally simpler than EC2 because Lambda handles all the infrastructure concerns for you. You simply define what your function is allowed to do, and Lambda ensures the credentials are available.

### IAM Task Roles for ECS and Fargate

ECS introduces a bit more complexity because you're managing containerized applications, potentially multiple containers per task, and they might be running on EC2 or Fargate. ECS solves this with task roles and task execution roles—and it's important to understand the distinction.

The **task execution role** is what ECS itself uses to manage your task. It grants permissions to pull container images from ECR, write logs to CloudWatch, and retrieve secrets from Secrets Manager if your task definition references them. This is created and managed by ECS, and you typically don't need to customize it heavily unless your images are in private registries or you're using advanced features.

The **task role** is what your application code inside the containers uses. It's equivalent to the EC2 instance profile or Lambda execution role. You create this role with a trust relationship allowing the ECS task service to assume it, attach policies granting your application's needed permissions, and reference it in your task definition.

Here's an example task definition for a Fargate task that needs to write to CloudWatch Logs and read from S3:

```json
{
  "family": "my-app",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "256",
  "memory": "512",
  "executionRoleArn": "arn:aws:iam::123456789012:role/ecsTaskExecutionRole",
  "taskRoleArn": "arn:aws:iam::123456789012:role/my-app-task-role",
  "containerDefinitions": [
    {
      "name": "my-app",
      "image": "123456789012.dkr.ecr.us-east-1.amazonaws.com/my-app:latest",
      "essential": true,
      "portMappings": [
        {
          "containerPort": 8080,
          "protocol": "tcp"
        }
      ],
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

The `taskRoleArn` field specifies the role your application will use. Inside your containers, the AWS SDK retrieves credentials from the container credentials endpoint, just like with Lambda. The endpoint URI is provided via the `AWS_CONTAINER_CREDENTIALS_RELATIVE_URI` environment variable, which ECS sets automatically.

For ECS on EC2, the mechanism is slightly different. The ECS agent running on the EC2 instance assumes the task role and provides credentials to the container via the same container credentials endpoint. From your application's perspective, it's identical—the SDK retrieves credentials transparently.

### The Container Credentials Endpoint

Both Lambda and ECS use the container credentials endpoint, which deserves a closer look because it's the key to understanding how containerized workloads authenticate to AWS.

When a Lambda function or ECS task starts, the runtime or agent injects environment variables pointing to a local HTTP endpoint. Your application makes a request to this endpoint to retrieve temporary credentials. The endpoint is local, secure, and only accessible from within that container or Lambda execution environment.

For example, an ECS task might have:

```
AWS_CONTAINER_CREDENTIALS_RELATIVE_URI=/v2/credentials/abc123
```

The SDK constructs the full URL using a base URI and this relative path. The response is JSON containing temporary credentials and their expiration:

```json
{
  "AccessKeyId": "ASIAJ...",
  "SecretAccessKey": "...",
  "Token": "...",
  "Expiration": "2024-01-15T14:30:00Z"
}
```

The beauty of this design is that credentials are never exposed to your application code or logs. They're retrieved just-in-time by the SDK, used for a few requests, and refreshed before expiration. Your application remains completely credential-agnostic.

### Migrating from Access Keys to IAM Roles

If you're currently using hardcoded access keys, the migration path is straightforward but requires careful planning to avoid outages.

First, audit your environment to identify where access keys are being used. Check for hardcoded credentials in application code, environment variables, configuration files, and container images. Document each usage and the corresponding IAM permissions needed.

For each application or service, create an IAM role with the minimum permissions it requires. This is where the principle of least privilege becomes concrete. If an application only needs to read from one S3 bucket and write to CloudWatch Logs, grant only those permissions. Avoid wildcard permissions or overly broad roles.

Next, update your deployment processes to assign the appropriate role to each compute resource. For EC2, ensure your instance profiles are attached at launch time. For Lambda, update function configurations to use the correct execution role. For ECS, update your task definitions to reference the task role.

Then comes the important part: test thoroughly in a non-production environment. Deploy your application with the role, verify it can access the resources it needs, and monitor for any permission errors. The CloudTrail service can help you identify what permissions are actually being used by examining denied API calls.

Once you're confident, gradually roll out the change in production. You might run both access keys and roles in parallel temporarily, but the goal is to eventually remove the access keys entirely. Set a deadline for this, and stick to it.

Finally, disable and delete the old access keys. Going back to our earlier analogy: removing access keys is like finally disconnecting the spare key under the doormat after you've switched to a keycard system.

### Avoiding Common Pitfalls

When implementing IAM roles, a few mistakes are easy to make but equally easy to avoid if you're aware of them.

**Overly permissive roles** are a common pitfall. It's tempting to attach a managed policy like `PowerUserAccess` to your task role to avoid dealing with granular permissions, but this violates the principle of least privilege and increases the blast radius if a resource is compromised. Take the time to define specific permissions.

**Forgetting the execution role** in ECS is another frequent error. You specify a task role and think you're done, but you also need an execution role for ECS to manage the task. If you forget it, the task won't be able to pull images or write logs, and it'll fail to start.

**Not updating trust relationships** when migrating from one compute type to another can also cause issues. If you repurpose an EC2 role for Lambda, make sure the trust policy includes the Lambda service, not just EC2.

**Caching stale credentials** in your application can happen if you instantiate SDK clients incorrectly. For example, creating a boto3 client at module load time and reusing it across multiple function invocations should be fine, but if you're somehow caching the credentials directly, you might use expired ones. Generally, let the SDK manage credential lifecycle.

**Not monitoring IAM role usage** means you might unknowingly be running with permissions your application no longer needs. Use CloudTrail and access analyzer tools to understand what permissions are actually being used, and refine your policies accordingly.

### Security and Compliance Benefits

Using IAM roles instead of access keys provides substantial security and compliance advantages that extend beyond just managing credentials more conveniently.

Because credentials are temporary and automatically rotated, the blast radius of a compromise is limited. If someone obtains a credential, it's valid only for a short duration, and it's tied to a specific role with specific permissions. This contrasts sharply with access keys, which are permanent until manually rotated and might grant broad permissions.

From a compliance perspective, many regulatory frameworks like PCI-DSS and HIPAA require that sensitive credentials be protected, rotated regularly, and never hardcoded. Using IAM roles demonstrates compliance with these requirements because AWS handles rotation automatically and credentials are never hardcoded.

Audit and accountability also improve. When you use IAM roles, every API call made by a resource is attributable to that role, and CloudTrail captures the role used. This creates a clear audit trail for compliance and incident investigation. With access keys, it's much harder to trace which application or developer used a particular key.

Finally, IAM roles reduce operational risk by eliminating the human element from credential management. There's no need to coordinate key rotations, no risk of keys being accidentally shared or committed to version control, and no emergency key rotation procedures.

### Conclusion

Using IAM roles is one of the most impactful decisions you can make for AWS application security. Instead of managing long-lived access keys that are difficult to track, easy to misplace, and a permanent liability, you let AWS provide temporary, auto-rotating credentials to your compute resources. Whether you're running on EC2, Lambda, or ECS, the pattern is consistent: create a role with the minimum permissions your application needs, assign it to your resource, and let the AWS SDK handle credential retrieval transparently.

The migration from hardcoded access keys to IAM roles is straightforward, and the security and operational benefits are substantial. Start by auditing your current usage, creating properly scoped roles, and testing thoroughly in non-production environments. Once you've made the switch, you'll find that managing access to AWS resources becomes simpler, more secure, and easier to audit—which is exactly what any mature AWS deployment should strive for.
