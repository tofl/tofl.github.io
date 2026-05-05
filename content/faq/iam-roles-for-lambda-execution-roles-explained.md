---
title: "IAM Roles for Lambda: Execution Roles Explained"
---

## IAM Roles for Lambda: Execution Roles Explained

When you invoke a Lambda function, you might assume it runs with no permissions at all—a clean slate in terms of AWS API access. In reality, Lambda needs *some* way to interact with AWS services, write logs, and perform its job. That's where execution roles come in. Understanding how Lambda execution roles work is fundamental to building secure, functional serverless applications, and it's a concept that appears regularly in real-world scenarios and technical assessments.

An execution role is an IAM role that Lambda assumes when your function runs. It's the mechanism by which your function gains temporary security credentials to call AWS APIs. Without an execution role, your Lambda function would be locked out of nearly everything, unable to even write logs to CloudWatch. In this article, we'll explore what execution roles are, how they differ from related concepts like EC2 instance profiles, what minimum permissions are required, how to scope them tightly for security, and how Lambda retrieves credentials at runtime.

### What Is a Lambda Execution Role?

A Lambda execution role is an IAM role that you create and configure to grant your Lambda function permission to interact with AWS services. When Lambda invokes your function, it assumes this role and uses the temporary credentials associated with it. Those credentials are valid for the duration of the function's execution and are automatically refreshed by AWS.

Think of it this way: you wouldn't hand your AWS access keys to a script and hope it doesn't misuse them. Instead, you define a role with *exactly* the permissions that script needs, and the runtime environment applies those credentials automatically. Lambda works the same way. You attach policies to the execution role, and when your function runs, it can call any AWS API that those policies permit.

The execution role is specified in your Lambda function's configuration. You can set it through the AWS Management Console, the AWS CLI, Infrastructure as Code tools like CloudFormation or Terraform, or the AWS SDKs. Once configured, every invocation of that function will assume that role.

### How Execution Roles Differ From EC2 Instance Profiles

New developers sometimes conflate Lambda execution roles with EC2 instance profiles, and while they serve similar purposes, there are important distinctions.

An EC2 instance profile is a container that holds an IAM role and is attached to an EC2 instance at launch time. The instance profile is the glue that connects the role to the instance. The EC2 metadata service running on the instance makes the role's temporary credentials available to any code running on that instance. Applications on the instance query the metadata service to obtain credentials, typically via environment variables or SDK auto-discovery.

With Lambda, there's no instance profile involved. Lambda manages the entire credential flow internally. When you specify an execution role on a Lambda function, AWS Lambda directly assumes that role during invocation. The Lambda runtime environment injects temporary credentials into the function's execution context—often through environment variables like `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, and `AWS_SESSION_TOKEN`—or through a credentials file that AWS SDKs know how to read. The function doesn't need to make any extra calls to retrieve credentials; they're simply available when the function starts.

Another key difference is lifecycle. An EC2 instance profile is configured when you launch the instance and persists for the instance's lifetime. A Lambda execution role is evaluated at invocation time. If you change the execution role's permissions while a Lambda function is running, those changes take effect on the next invocation.

### The Minimum Required Permission: CloudWatch Logs

If you're going to run a Lambda function in a production environment, it needs to log somewhere. CloudWatch Logs is AWS's native logging service, and every Lambda function should be able to write logs to it. In fact, writing to CloudWatch Logs is so fundamental that AWS provides a managed policy specifically for this: `AWSLambdaBasicExecutionRole`.

The `AWSLambdaBasicExecutionRole` policy includes permissions to perform three key actions: `logs:CreateLogGroup`, `logs:CreateLogStream`, and `logs:PutLogEvents`. These permissions allow Lambda to create a log group and log stream for your function and to write log entries to it. Here's what those permissions look like in policy form:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "logs:CreateLogGroup",
        "logs:CreateLogStream",
        "logs:PutLogEvents"
      ],
      "Resource": "arn:aws:logs:*:*:*"
    }
  ]
}
```

If you attach this managed policy to your Lambda execution role, your function can write logs. Without it, your function will still run, but any attempt to log will fail silently (or throw an error if you're checking for it). This is a common gotcha: developers create a Lambda function with a custom execution role that grants access to their business logic but forget to include logging permissions. The function runs, but logs disappear into the void.

When you create a Lambda execution role through the console, AWS automatically attaches this managed policy for you. However, when you create a role programmatically or through Infrastructure as Code, you must explicitly include it. Many organizations create a baseline execution role template that includes at minimum the basic execution role permissions, then attach additional policies for function-specific needs.

### Scoping Execution Roles Tightly for Security

The principle of least privilege is core to AWS security best practices. Your Lambda function should have access to exactly the permissions it needs—no more, no less. An execution role that's too permissive becomes a security risk. If a function is compromised or contains a bug that makes unintended API calls, a broad execution role amplifies the damage.

Let's consider a concrete example. Suppose you have a Lambda function that reads objects from a specific S3 bucket and processes them. A poorly scoped execution role might look like this:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "s3:*",
      "Resource": "*"
    }
  ]
}
```

This role grants full S3 access across all buckets and all actions. It's excessive. A better approach is to scope the role to only the specific bucket and the specific actions the function needs:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:GetObject"
      ],
      "Resource": "arn:aws:s3:::my-input-bucket/*"
    }
  ]
}
```

Now the function can only read objects from `my-input-bucket`. It cannot delete objects, write to other buckets, list buckets, or perform any other S3 operation.

Scoping tightly applies to all aspects of your execution role:

**Action-level scoping** restricts which API calls the role can make. If your function only needs to read from DynamoDB, grant `dynamodb:GetItem` and `dynamodb:Query`, not `dynamodb:*`.

**Resource-level scoping** restricts which AWS resources the role can access. Use ARNs to specify exact tables, buckets, topics, or streams. Avoid wildcards in resource ARNs unless there's a specific reason for broad access.

**Condition-level scoping** (when available) adds an extra layer of control. For example, you can restrict API calls to happen only during a certain time window, or only when the request originates from a specific source.

Many organizations use AWS IAM Access Analyzer or AWS CloudTrail logs to identify over-privileged roles and progressively narrow permissions. You can also enable CloudTrail logging for your Lambda functions, monitor which APIs they actually call, and then refine the execution role's policies accordingly.

### How Lambda Retrieves Credentials at Runtime

Understanding the mechanics of credential retrieval helps demystify how your function gains access to those temporary credentials. When Lambda invokes your function, it needs to assume the execution role and provide the resulting temporary credentials to the function's runtime environment.

Here's the flow:

First, Lambda itself must have permission to assume your execution role. This is governed by the role's trust relationship (also called the trust policy). When you create an execution role for Lambda, you set up a trust policy that allows the Lambda service to assume that role. The trust policy looks something like this:

```json
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

This says: "The Lambda service (`lambda.amazonaws.com`) is allowed to assume this role." Without this trust relationship, Lambda cannot assume the role, and invocations fail.

When you invoke a Lambda function, the Lambda control plane intercepts the invocation request. It checks the function's configuration, finds the execution role ARN, and calls the AWS Security Token Service (STS) `AssumeRole` API on your behalf. STS returns temporary credentials (an access key, secret key, and session token) valid for a limited time—typically one hour.

These credentials are then injected into the function's execution environment. For most AWS SDKs, the credentials are made available through environment variables:

- `AWS_ACCESS_KEY_ID`: The access key
- `AWS_SECRET_ACCESS_KEY`: The secret key
- `AWS_SESSION_TOKEN`: The session token
- `AWS_LAMBDA_FUNCTION_TIMEOUT`: The function's timeout (not a credential, but useful context)

The AWS SDKs (boto3 for Python, AWS SDK for JavaScript, etc.) are configured by default to read these environment variables. When your code creates an S3 client or DynamoDB client without explicitly passing credentials, the SDK automatically picks up these environment variables and uses them. You don't need to do anything special.

```python
import boto3

# The boto3 SDK automatically uses the credentials from 
# AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, and AWS_SESSION_TOKEN
s3_client = boto3.client('s3')
response = s3_client.get_object(Bucket='my-bucket', Key='my-key')
```

If you need to verify that credentials are available, you can inspect the environment variables within your function, though this is rarely necessary in practice.

### Creating and Managing Execution Roles

In practice, you'll create execution roles through one of several methods. The AWS Management Console provides a straightforward interface: when you create a new Lambda function, you can choose to create a new execution role, and the console guides you through it. The default role automatically includes the basic execution role policy for CloudWatch Logs.

For Infrastructure as Code, you'd define the role using CloudFormation, Terraform, or the AWS CDK. Here's a CloudFormation example:

```yaml
LambdaExecutionRole:
  Type: AWS::IAM::Role
  Properties:
    AssumeRolePolicyDocument:
      Version: '2012-10-17'
      Statement:
        - Effect: Allow
          Principal:
            Service: lambda.amazonaws.com
          Action: sts:AssumeRole
    ManagedPolicyArns:
      - arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole
    Policies:
      - PolicyName: DynamoDBAccess
        PolicyDocument:
          Version: '2012-10-17'
          Statement:
            - Effect: Allow
              Action:
                - dynamodb:GetItem
                - dynamodb:PutItem
              Resource: arn:aws:dynamodb:*:*:table/MyTable
```

This role includes the managed policy for basic execution (CloudWatch Logs) plus an inline policy granting specific DynamoDB access. You'd then attach this role to your Lambda function configuration.

When you update an execution role—adding or removing permissions, for example—those changes apply to new invocations immediately. Existing invocations continue with the credentials they obtained at startup, so there's no mid-execution disruption.

### Common Execution Role Patterns and Best Practices

In real-world applications, a few patterns emerge:

**The minimal baseline role** includes only CloudWatch Logs permissions. You start here and add more permissions only as needed. This forces you to be intentional about what your function can access.

**The function-specific role** grants permissions tailored to a single Lambda function's requirements. This is the recommended approach. Each function has its own role with only the permissions it needs. It simplifies auditing and limits blast radius if the function is compromised.

**The shared role** is used by multiple related Lambda functions. This can simplify management if functions genuinely share the same requirements, but it reduces the principle of least privilege. If one function is compromised, all functions sharing the role are at risk.

**The layered role** uses a base managed policy (like `AWSLambdaBasicExecutionRole`) plus function-specific inline or managed policies. This approach ensures all functions have logging permissions while allowing customization.

A practical best practice is to create a baseline execution role template in your organization's Infrastructure as Code. This template includes the basic execution role policy and any organization-wide requirements (like VPC execution permissions if functions run in a VPC, or X-Ray write access if you use X-Ray tracing). Individual functions then inherit from this template and add their specific permissions.

### Execution Roles and VPC Lambda Functions

If your Lambda function runs inside a VPC (Virtual Private Cloud), the execution role requires additional permissions. Specifically, it needs permissions to create and manage Elastic Network Interfaces (ENIs) in your VPC. AWS provides a managed policy for this: `AWSLambdaVPCAccessExecutionRole`. This policy grants permissions to `ec2:CreateNetworkInterface`, `ec2:DescribeNetworkInterfaces`, and `ec2:DeleteNetworkInterface`.

When you configure a Lambda function to run in a VPC, AWS Lambda automatically creates an ENI in your VPC to allow the function to communicate with resources inside the VPC. Without these ENI-related permissions, Lambda cannot create the ENI and your function fails immediately.

If you're using the basic execution role for a VPC function, you need to also attach the VPC access role:

```yaml
ManagedPolicyArns:
  - arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole
  - arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole
```

Many developers forget this and encounter cryptic errors when their VPC-enabled Lambda functions fail to start. It's a key detail to remember.

### Troubleshooting Execution Role Issues

When a Lambda function fails due to execution role problems, the symptoms are usually clear once you know what to look for:

If your function logs don't appear in CloudWatch Logs, the execution role is missing logging permissions. Check that the role has `logs:CreateLogGroup`, `logs:CreateLogStream`, and `logs:PutLogEvents` for the appropriate resources.

If your function tries to call an AWS API and gets an "Access Denied" error, the execution role is missing permissions for that API. The error message typically includes the action that was denied (e.g., "User: arn:aws:iam::...role/my-role is not authorized to perform: s3:GetObject").

If your VPC-enabled function fails immediately, check that the execution role has the VPC access managed policy attached.

If your function cannot assume the execution role at all, check the role's trust policy. Make sure it allows `lambda.amazonaws.com` to assume the role.

To troubleshoot, start by reviewing the execution role's permissions in the IAM console. Navigate to the role, check the attached policies, and verify that the required permissions are present. Then check CloudTrail logs for API calls made by the function to see exactly which action failed and why.

### Execution Roles vs. Resource-Based Policies

It's important not to confuse execution roles with resource-based policies. An execution role controls what your Lambda function can do when it invokes other AWS services. A resource-based policy controls who can invoke your Lambda function.

For example, if you want an API Gateway to trigger your Lambda function, you attach a resource-based policy to the Lambda function that allows API Gateway to invoke it. This is separate from the execution role. The execution role determines what the function can do once it starts running; the resource-based policy determines who can start it in the first place.

Similarly, if you want an S3 bucket to trigger your function when objects are uploaded, you attach a resource-based policy to the function that allows S3 to invoke it. Again, this is independent of the execution role.

### Wrapping Up: Secure Serverless with Proper Execution Roles

Lambda execution roles are the foundation of secure, functional serverless applications. They provide the mechanism by which your functions gain temporary, scoped access to AWS services without ever handling credentials directly. A well-configured execution role grants exactly the permissions your function needs—no more, no less—and includes basic permissions for logging.

The key takeaways are straightforward: always include CloudWatch Logs permissions in your execution roles, scope permissions as tightly as possible to specific actions and resources, understand that Lambda assumes the role at invocation time and injects temporary credentials into the runtime environment, and remember that VPC functions require additional ENI-related permissions.

As you build serverless applications, treat execution role configuration with the same care you'd give to any security boundary. Review execution roles regularly, use Infrastructure as Code to version and audit them, and apply the principle of least privilege consistently. When you do, you'll have Lambda functions that are both secure and fully functional.
