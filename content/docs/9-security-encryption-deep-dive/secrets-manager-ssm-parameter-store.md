---
title: "29. Secrets Manager & SSM Parameter Store"
type: docs
weight: 2
---

## Secrets Manager & SSM Parameter Store

Applications constantly need access to sensitive configuration: database passwords, API keys, OAuth tokens, and feature flags. Hardcoding these into source code or environment variables is a well-known security risk. AWS provides two services to solve this: **Secrets Manager** for sensitive credentials that need lifecycle management (rotation, auditing, cross-account sharing), and **SSM Parameter Store** for general-purpose configuration storage, including secrets. Knowing which to reach for — and when — is a frequently tested decision on the DVA-C02 exam.

### Secrets Manager

Secrets Manager [🔗](https://docs.aws.amazon.com/secretsmanager/latest/userguide/intro.html) is purpose-built for storing, managing, and automatically rotating credentials. Every secret is encrypted at rest using a KMS key (either an AWS-managed key or a CMK you control).

**Secret rotation** is the standout feature. Secrets Manager can rotate credentials automatically on a schedule you define. Rotation works by invoking a **Lambda function** that performs a four-step lifecycle: `createSecret`, `setSecret`, `testSecret`, `finishSecret`. AWS provides managed rotation functions for common databases (RDS, Redshift, DocumentDB) so you often don't need to write one from scratch [🔗](https://docs.aws.amazon.com/secretsmanager/latest/userguide/rotating-secrets.html). When rotation runs, the secret is updated in place, and any application fetching the secret by name automatically gets the new value on its next retrieval — no deployment required.

**Cross-account access** is supported through resource-based policies. You attach a policy directly to a secret granting a principal in another account `secretsmanager:GetSecretValue`. This is useful in multi-account architectures where a central secrets account manages credentials consumed by workload accounts.

A practical example: an e-commerce application needs a PostgreSQL password. You store the password in Secrets Manager, attach it to the RDS instance, and configure a 30-day rotation schedule. The Lambda rotation function updates the RDS user's password and stores the new value in Secrets Manager. Application code retrieves the secret at startup — no human ever needs to know the actual password.

### SSM Parameter Store

SSM Parameter Store [🔗](https://docs.aws.amazon.com/systems-manager/latest/userguide/systems-manager-parameter-store.html) is a broader configuration store. It holds both non-sensitive configuration (feature flags, environment names, AMI IDs) and sensitive values (passwords, tokens) encrypted via KMS using the `SecureString` parameter type.

Parameters are organised into a **hierarchy** using path-style names: `/myapp/prod/db-password`, `/myapp/prod/api-url`. This makes it easy to retrieve all configuration for a given environment in a single API call (`GetParametersByPath`) rather than fetching each value individually.

Parameter Store has two tiers [🔗](https://docs.aws.amazon.com/systems-manager/latest/userguide/parameter-store-advanced-parameters.html):

- **Standard tier** — up to 10,000 parameters, max 4 KB per value, no additional charge.
- **Advanced tier** — up to 100,000 parameters, max 8 KB per value, supports **parameter policies** (TTL-based expiration and expiration notifications via EventBridge). There is a small per-parameter monthly cost.

### Secrets Manager vs SSM Parameter Store

This comparison is heavily tested. Here is the practical decision framework:

| Concern | Secrets Manager | SSM Parameter Store |
|---|---|---|
| Automatic credential rotation | ✅ Native, Lambda-driven | ❌ Must implement yourself |
| Cost | ~$0.40/secret/month + API calls | Free (standard tier) |
| Encryption | Always KMS | Optional (`SecureString` for sensitive values) |
| Cross-account access | ✅ Resource-based policies | Limited |
| General app config (non-secret) | Overkill | ✅ Ideal |
| Parameter hierarchy / bulk retrieval | ❌ | ✅ `GetParametersByPath` |

**Rule of thumb:** use Secrets Manager when you need rotation or fine-grained auditing of credentials. Use Parameter Store for everything else — especially non-sensitive config and when cost is a constraint.

### Runtime Retrieval Pattern (Exam Favourite)

A critical design decision that surfaces repeatedly on the exam: **fetch secrets and configuration at Lambda initialisation time, not inside the handler**.

Lambda execution environments are reused across invocations (the "warm start" behaviour). Code placed outside the handler function runs once during initialisation and is then cached for the lifetime of that execution environment. Fetching a secret inside the handler means an API call to Secrets Manager or Parameter Store on *every* invocation — adding latency and API cost at scale.

```python
import boto3
import json

# Runs once at init time — result is cached across warm invocations
client = boto3.client('secretsmanager')
secret = json.loads(
    client.get_secret_value(SecretId='prod/myapp/db')['SecretString']
)

def handler(event, context):
    # Uses the cached secret — no API call here
    db_password = secret['password']
    ...
```

For SSM Parameter Store, the same principle applies. You can also use the **AWS Parameters and Secrets Lambda Extension** [🔗](https://docs.aws.amazon.com/systems-manager/latest/userguide/ps-integration-lambda-extensions.html), which runs as a Lambda layer, caches parameter values locally, and serves them over a local HTTP endpoint — avoiding repeated SDK calls entirely.

### SSM Session Manager, Run Command, and Patch Manager

SSM goes beyond configuration storage. **Session Manager** [🔗](https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager.html) lets you open a shell session to an EC2 instance through the AWS console or CLI without opening port 22, maintaining a bastion host, or managing SSH keys. Access is controlled through IAM, and all session activity is logged to CloudWatch or S3. It is the preferred secure access pattern for EC2 in modern AWS architectures.

**Run Command** lets you execute shell scripts or AWS-provided documents (SSM Documents) across a fleet of EC2 instances without SSH — useful for one-off administrative tasks. **Patch Manager** automates the process of patching managed instances on a schedule, tracking compliance across your fleet. Both are worth knowing at a conceptual level for the exam [🔗](https://docs.aws.amazon.com/systems-manager/latest/userguide/systems-manager-patch.html).

{{< qcm >}}
[
{
"question": "A developer is building a serverless application using AWS Lambda that retrieves a database password from AWS Secrets Manager. The application experiences high throughput with thousands of invocations per minute. Which approach should the developer use to minimize latency and API costs?",
"answers": [
{
"answer": "Fetch the secret inside the Lambda handler function on every invocation to ensure the latest value is always used.",
"isCorrect": false,
"explanation": "Fetching the secret inside the handler means an API call to Secrets Manager on every invocation, adding latency and significant API costs at scale."
},
{
"answer": "Fetch the secret outside the handler function during Lambda initialization so it is cached across warm invocations.",
"isCorrect": true,
"explanation": "Code outside the handler runs once during the initialization phase and is cached for the lifetime of the execution environment (warm start). This avoids a Secrets Manager API call on every invocation, reducing both latency and cost."
},
{
"answer": "Use the AWS Parameters and Secrets Lambda Extension to cache secrets locally and serve them over a local HTTP endpoint.",
"isCorrect": true,
"explanation": "The AWS Parameters and Secrets Lambda Extension runs as a Lambda layer, caches parameter and secret values locally, and serves them via a local HTTP endpoint — eliminating repeated SDK calls entirely, which is ideal for high-throughput workloads."
},
{
"answer": "Store the secret as a Lambda environment variable at deployment time to avoid any runtime API calls.",
"isCorrect": false,
"explanation": "Hardcoding secrets into environment variables is a security risk. It also means the value is static and won't reflect rotations without redeployment, defeating the purpose of Secrets Manager."
}
]
},
{
"question": "A company stores database credentials in AWS Secrets Manager and wants them to be automatically rotated every 30 days for an Amazon RDS instance. What does Secrets Manager invoke to perform the rotation?",
"answers": [
{
"answer": "An Amazon EventBridge rule that triggers an ECS task",
"isCorrect": false,
"explanation": "EventBridge is not involved in the Secrets Manager rotation mechanism. Rotation is driven by a Lambda function, not an ECS task."
},
{
"answer": "An AWS Lambda function that executes a four-step lifecycle: createSecret, setSecret, testSecret, finishSecret",
"isCorrect": true,
"explanation": "Secrets Manager triggers a Lambda function to perform rotation. The function follows exactly these four steps: createSecret, setSecret, testSecret, and finishSecret. AWS provides managed rotation functions for common databases like RDS, so you often don't need to write one yourself."
},
{
"answer": "An AWS Step Functions state machine",
"isCorrect": false,
"explanation": "Step Functions is not used for Secrets Manager rotation. The rotation mechanism relies exclusively on a Lambda function."
},
{
"answer": "An RDS stored procedure invoked by Secrets Manager directly",
"isCorrect": false,
"explanation": "Secrets Manager does not invoke RDS stored procedures directly. All rotation logic is handled through a Lambda function."
}
]
},
{
"question": "A development team needs to store both non-sensitive configuration values (such as feature flags and environment names) and some encrypted database passwords for their application. They want to retrieve all configuration for a given environment in a single API call. Cost is a concern. Which AWS service best fits this use case?",
"answers": [
{
"answer": "AWS Secrets Manager",
"isCorrect": false,
"explanation": "Secrets Manager is purpose-built for sensitive credentials needing rotation and auditing. It costs approximately $0.40 per secret per month and does not support hierarchical bulk retrieval with GetParametersByPath, making it a poor fit for general-purpose config storage."
},
{
"answer": "AWS SSM Parameter Store",
"isCorrect": true,
"explanation": "SSM Parameter Store is ideal for general-purpose configuration. It supports a hierarchical naming convention (e.g., /myapp/prod/db-password) and the GetParametersByPath API to retrieve all parameters for an environment in one call. The standard tier is free and supports both plain-text and encrypted (SecureString) values."
},
{
"answer": "AWS AppConfig",
"isCorrect": false,
"explanation": "AppConfig is designed for managed feature flag and application configuration deployments with validation and rollback capabilities. While useful, it is not the primary service for storing credentials and does not offer the same hierarchical bulk retrieval or cost profile as SSM Parameter Store."
}
]
},
{
"question": "Which of the following are valid reasons to choose AWS Secrets Manager over SSM Parameter Store? (Select TWO)",
"answers": [
{
"answer": "You need automatic, scheduled rotation of database credentials without writing custom orchestration.",
"isCorrect": true,
"explanation": "Automatic credential rotation is the standout feature of Secrets Manager. It natively invokes a Lambda function on a defined schedule to rotate credentials. SSM Parameter Store does not support automatic rotation — you would have to implement it yourself."
},
{
"answer": "You want to store non-sensitive application configuration such as environment names and AMI IDs.",
"isCorrect": false,
"explanation": "SSM Parameter Store is the appropriate choice for non-sensitive configuration. Using Secrets Manager for such values would be overkill and more expensive."
},
{
"answer": "You need to grant a principal in another AWS account access to a secret using a resource-based policy.",
"isCorrect": true,
"explanation": "Secrets Manager supports cross-account access through resource-based policies attached directly to a secret, granting principals in other accounts the secretsmanager:GetSecretValue permission. SSM Parameter Store has limited cross-account support."
},
{
"answer": "You need to retrieve all configuration values for a given environment in a single API call using a path prefix.",
"isCorrect": false,
"explanation": "Hierarchical bulk retrieval using GetParametersByPath is a feature of SSM Parameter Store, not Secrets Manager."
}
]
},
{
"question": "A security-conscious team wants to access EC2 instances without opening port 22, without maintaining a bastion host, and without managing SSH keys. All session activity must be logged. Which AWS Systems Manager feature should they use?",
"answers": [
{
"answer": "SSM Run Command",
"isCorrect": false,
"explanation": "Run Command allows executing scripts across a fleet of EC2 instances without SSH, but it is designed for one-off administrative tasks, not for interactive shell sessions."
},
{
"answer": "SSM Session Manager",
"isCorrect": true,
"explanation": "Session Manager provides interactive shell access to EC2 instances through the AWS console or CLI without port 22, bastion hosts, or SSH keys. Access is controlled via IAM and all session activity can be logged to CloudWatch Logs or S3."
},
{
"answer": "SSM Patch Manager",
"isCorrect": false,
"explanation": "Patch Manager automates OS patching on a schedule and tracks compliance. It does not provide interactive shell access to instances."
},
{
"answer": "AWS Systems Manager Parameter Store",
"isCorrect": false,
"explanation": "Parameter Store is a configuration and secret storage service. It has no functionality for opening sessions or executing commands on EC2 instances."
}
]
},
{
"question": "A developer needs to store a secret value that is 6 KB in size in AWS SSM Parameter Store. Which parameter tier must they use?",
"answers": [
{
"answer": "Standard tier",
"isCorrect": false,
"explanation": "The standard tier supports a maximum value size of 4 KB. A 6 KB secret exceeds this limit and cannot be stored in the standard tier."
},
{
"answer": "Advanced tier",
"isCorrect": true,
"explanation": "The advanced tier supports parameter values up to 8 KB, which accommodates the 6 KB secret. The advanced tier also supports up to 100,000 parameters and parameter policies such as TTL-based expiration."
}
]
},
{
"question": "Which SSM Parameter Store tier supports TTL-based parameter expiration and expiration notifications through Amazon EventBridge?",
"answers": [
{
"answer": "Standard tier",
"isCorrect": false,
"explanation": "The standard tier is free and supports up to 10,000 parameters with a 4 KB size limit, but it does not support parameter policies such as TTL expiration or EventBridge notifications."
},
{
"answer": "Advanced tier",
"isCorrect": true,
"explanation": "The advanced tier supports parameter policies, which include TTL-based expiration (forcing parameters to expire after a defined period) and expiration notifications via Amazon EventBridge. There is a small per-parameter monthly cost for this tier."
}
]
},
{
"question": "An application stores its PostgreSQL password in AWS Secrets Manager with a 30-day rotation policy. After rotation occurs, what must the development team do to ensure the application uses the updated password?",
"answers": [
{
"answer": "Redeploy the application with the new password injected as an environment variable.",
"isCorrect": false,
"explanation": "Redeployment is not necessary. One of the key benefits of Secrets Manager is that applications fetching secrets by name automatically receive the updated value on their next retrieval — no deployment is required."
},
{
"answer": "Manually update the secret value in the application's configuration file.",
"isCorrect": false,
"explanation": "This approach reintroduces the very problem Secrets Manager is designed to solve: secrets stored in configuration files. The application should retrieve the secret dynamically from Secrets Manager."
},
{
"answer": "Nothing — the application automatically retrieves the new password the next time it calls Secrets Manager by name.",
"isCorrect": true,
"explanation": "When rotation runs, the secret is updated in place in Secrets Manager. Any application that fetches the secret by name will receive the new value on its next retrieval. No redeployment or manual intervention is needed."
},
{
"answer": "Trigger a Lambda function manually to propagate the new password to the application.",
"isCorrect": false,
"explanation": "The rotation Lambda is invoked automatically by Secrets Manager on the defined schedule. The application retrieves the updated value directly from Secrets Manager without any additional propagation step."
}
]
},
{
"question": "A company uses a central AWS account to manage all credentials, and multiple workload accounts need access to these secrets. Which feature of AWS Secrets Manager enables this architecture?",
"answers": [
{
"answer": "IAM identity-based policies attached to IAM roles in each workload account",
"isCorrect": false,
"explanation": "Identity-based policies alone are not sufficient for cross-account access to a Secrets Manager secret. A resource-based policy must be attached to the secret itself to grant access to principals in other accounts."
},
{
"answer": "Resource-based policies attached directly to the secret granting cross-account principals secretsmanager:GetSecretValue",
"isCorrect": true,
"explanation": "Secrets Manager supports cross-account access through resource-based policies. You attach a policy directly to the secret that grants a principal in another AWS account the secretsmanager:GetSecretValue permission, enabling multi-account secrets management from a centralized account."
},
{
"answer": "S3 bucket policies used to share secret values across accounts",
"isCorrect": false,
"explanation": "S3 is not involved in Secrets Manager cross-account access. Secrets are shared directly through resource-based policies on the secret itself."
},
{
"answer": "AWS Organizations Service Control Policies (SCPs)",
"isCorrect": false,
"explanation": "SCPs are used to restrict or allow actions across accounts in an Organization, but they do not grant cross-account access to a specific Secrets Manager secret. Resource-based policies on the secret are required."
}
]
},
{
"question": "A developer wants to retrieve all SSM Parameter Store parameters for the production environment of their application in a single API call. Parameters are stored with names like /myapp/prod/db-password and /myapp/prod/api-url. Which API action should they use?",
"answers": [
{
"answer": "GetParameter",
"isCorrect": false,
"explanation": "GetParameter retrieves a single parameter by its exact name. It would require a separate API call for each parameter, which is inefficient."
},
{
"answer": "GetParametersByPath",
"isCorrect": true,
"explanation": "GetParametersByPath retrieves all parameters that share a common path prefix (e.g., /myapp/prod/). This allows fetching all configuration for a given environment in a single API call, which is one of the key advantages of SSM Parameter Store's hierarchical naming."
},
{
"answer": "GetSecretValue",
"isCorrect": false,
"explanation": "GetSecretValue is an AWS Secrets Manager API action, not an SSM Parameter Store action. It retrieves a single secret by name."
},
{
"answer": "DescribeParameters",
"isCorrect": false,
"explanation": "DescribeParameters returns metadata about parameters (name, type, description) but does not return their values."
}
]
},
{
"question": "How does AWS Secrets Manager protect secret values at rest?",
"answers": [
{
"answer": "Secrets are stored in plaintext but access is restricted by IAM policies.",
"isCorrect": false,
"explanation": "Secrets Manager always encrypts secrets at rest using KMS. Storing them in plaintext would be a fundamental security violation inconsistent with the service's design."
},
{
"answer": "Secrets are always encrypted using a KMS key — either an AWS-managed key or a customer-managed key (CMK).",
"isCorrect": true,
"explanation": "Every secret stored in Secrets Manager is encrypted at rest using AWS KMS. You can use the default AWS-managed key or provide your own customer-managed key (CMK) for additional control."
},
{
"answer": "Secrets are encrypted using AES-256 with a key managed by Secrets Manager internally, independent of KMS.",
"isCorrect": false,
"explanation": "Secrets Manager uses AWS KMS for encryption, not an internal key management system. This integration allows you to control key policies, audit key usage in CloudTrail, and optionally use your own CMK."
}
]
},
{
"question": "A team wants to execute a shell script across a fleet of 50 EC2 instances simultaneously to update a configuration file, without using SSH or a configuration management tool. Which AWS Systems Manager feature is best suited for this task?",
"answers": [
{
"answer": "SSM Session Manager",
"isCorrect": false,
"explanation": "Session Manager opens an interactive shell session to a single EC2 instance. It is not designed for running scripts across a fleet simultaneously."
},
{
"answer": "SSM Run Command",
"isCorrect": true,
"explanation": "Run Command lets you execute shell scripts or AWS-provided SSM Documents across a fleet of EC2 instances without SSH. It is ideal for one-off administrative tasks like updating configuration files across many instances simultaneously."
},
{
"answer": "SSM Patch Manager",
"isCorrect": false,
"explanation": "Patch Manager is designed for automating OS patching on a schedule and tracking patch compliance. It is not the right tool for running arbitrary shell scripts."
},
{
"answer": "SSM Parameter Store",
"isCorrect": false,
"explanation": "Parameter Store is a configuration and secret storage service. It cannot execute scripts or perform any operations on EC2 instances."
}
]
},
{
"question": "Which of the following statements correctly describe differences between AWS Secrets Manager and SSM Parameter Store? (Select TWO)",
"answers": [
{
"answer": "Secrets Manager charges approximately $0.40 per secret per month, while SSM Parameter Store's standard tier is free.",
"isCorrect": true,
"explanation": "Cost is a key differentiator. Secrets Manager has a per-secret monthly cost plus API call charges. The SSM Parameter Store standard tier has no additional charge, making it preferable when cost is a constraint and rotation is not needed."
},
{
"answer": "SSM Parameter Store always encrypts all values using KMS by default.",
"isCorrect": false,
"explanation": "Encryption in SSM Parameter Store is optional and only applies when you use the SecureString parameter type. Standard String parameters are stored in plaintext."
},
{
"answer": "SSM Parameter Store supports native automatic credential rotation using Lambda functions.",
"isCorrect": false,
"explanation": "Automatic rotation is a feature of Secrets Manager, not SSM Parameter Store. If you need rotation with Parameter Store, you must implement it yourself."
},
{
"answer": "Secrets Manager always encrypts secrets at rest, while SSM Parameter Store only encrypts values stored as SecureString.",
"isCorrect": true,
"explanation": "This is a key distinction. Every Secrets Manager secret is KMS-encrypted by default. In Parameter Store, only SecureString parameters are encrypted; String and StringList parameters are stored in plaintext."
}
]
},
{
"question": "A Lambda function retrieves a configuration value from SSM Parameter Store on every invocation, causing unnecessary latency and API costs. What are two ways to mitigate this? (Select TWO)",
"answers": [
{
"answer": "Move the SSM GetParameter call outside the handler function so it runs once at initialization and is cached across warm invocations.",
"isCorrect": true,
"explanation": "Code outside the Lambda handler runs once during the initialization phase and is reused across warm invocations. This avoids repeated SSM API calls, reducing both latency and cost significantly."
},
{
"answer": "Use the AWS Parameters and Secrets Lambda Extension, which caches parameter values locally and serves them via a local HTTP endpoint.",
"isCorrect": true,
"explanation": "The AWS Parameters and Secrets Lambda Extension runs as a Lambda layer, caches SSM and Secrets Manager values locally within the execution environment, and serves them over localhost — eliminating SDK calls to the SSM API on every invocation."
},
{
"answer": "Increase the Lambda function's memory allocation to cache the SSM response automatically.",
"isCorrect": false,
"explanation": "Increasing memory does not provide any caching mechanism for SSM responses. Caching must be implemented explicitly in code or via the Lambda extension."
},
{
"answer": "Store the parameter value in an SQS queue and have Lambda consume it from there.",
"isCorrect": false,
"explanation": "SQS is a message queuing service and is not a suitable caching layer for configuration values. This approach would add architectural complexity without solving the underlying problem."
}
]
},
{
"question": "A developer is designing a solution where configuration parameters must automatically expire after 90 days, and the team must be notified via Amazon EventBridge before expiration. Which SSM Parameter Store configuration supports this requirement?",
"answers": [
{
"answer": "Standard tier with a custom Lambda function polling parameter metadata",
"isCorrect": false,
"explanation": "The standard tier does not support parameter policies including TTL-based expiration or EventBridge notifications. You would need the advanced tier for this functionality."
},
{
"answer": "Advanced tier with a parameter policy defining TTL expiration and an EventBridge notification",
"isCorrect": true,
"explanation": "The advanced tier supports parameter policies, which include TTL-based expiration (automatically expiring parameters after a set period) and EventBridge-based expiration notifications. This is the only native way to achieve automatic parameter expiration in SSM Parameter Store."
},
{
"answer": "Standard tier with an S3 lifecycle policy applied to the parameter storage bucket",
"isCorrect": false,
"explanation": "SSM Parameter Store does not store parameters in an S3 bucket accessible to the user. S3 lifecycle policies are not applicable here."
}
]
}
]
{{< /qcm >}}