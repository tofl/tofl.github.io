---
title: "Injecting Secrets and Environment Variables into ECS Tasks"
---

## Injecting Secrets and Environment Variables into ECS Tasks

When you run containerized applications on Amazon Elastic Container Service (ECS), you need a way to pass configuration to your containers—database connection strings, API keys, feature flags, and other sensitive or environment-specific values. Getting this wrong can expose secrets in logs, complicate deployments, or create security vulnerabilities. Getting it right means your containers are flexible, secure, and portable across different environments.

This guide walks you through the practical mechanics of injecting secrets and environment variables into ECS tasks, covering the tools AWS provides, the subtle but important differences between them, and the security considerations that matter in production systems.

### Understanding Configuration Injection in ECS

Before diving into the how, let's clarify the what. ECS tasks need to receive configuration in two main categories: non-sensitive values like feature flags or log levels, and sensitive values like database passwords or API keys. AWS provides multiple mechanisms to deliver both, each with different security properties and use cases.

When you define an ECS task, you specify a container definition that includes everything the container needs to run—the Docker image, CPU and memory allocations, port mappings, and importantly, the configuration values that should be passed into the container. These configuration values reach your container as environment variables that your application reads at startup or runtime.

The critical question isn't whether to use environment variables—that's almost always necessary for containerized applications. The question is where those values come from and how you manage their lifecycle, especially when they're sensitive.

### Plain Environment Variables in Task Definitions

The simplest approach is to define environment variables directly in your ECS task definition. These are key-value pairs specified in the `containerDefinitions` section.

Here's what that looks like in a task definition JSON:

```json
{
  "family": "my-app",
  "containerDefinitions": [
    {
      "name": "my-app-container",
      "image": "my-app:1.0",
      "environment": [
        {
          "name": "LOG_LEVEL",
          "value": "INFO"
        },
        {
          "name": "FEATURE_FLAG_NEW_UI",
          "value": "true"
        },
        {
          "name": "API_TIMEOUT_SECONDS",
          "value": "30"
        }
      ]
    }
  ]
}
```

When the task launches, the ECS agent injects these variables into the container's environment. Your application can immediately read them using standard language constructs—`os.getenv()` in Python, `process.env` in Node.js, `System.getenv()` in Java, and so on.

This approach works well for non-sensitive configuration that's the same across all environments (or at least, isn't a security risk if exposed). The advantage is simplicity—no additional AWS service calls, no extra permissions needed. The disadvantage should be obvious: these values appear in your task definition, which means they're visible in the AWS Console, in API responses, and in any logs or monitoring systems that display task definitions.

**Never put secrets like passwords, API keys, or database credentials in plain environment variables.** If someone gains read access to your task definitions—a common permission in many organizations—they've compromised your secrets.

### Secrets Manager for Sensitive Values

AWS Secrets Manager is purpose-built for managing sensitive configuration. Instead of storing the actual secret in your task definition, you reference a secret by its ARN or name, and ECS resolves that reference at task startup.

Here's how it looks in a task definition:

```json
{
  "family": "my-app",
  "containerDefinitions": [
    {
      "name": "my-app-container",
      "image": "my-app:1.0",
      "secrets": [
        {
          "name": "DB_PASSWORD",
          "valueFrom": "arn:aws:secretsmanager:us-east-1:123456789012:secret:prod/db-password-AbCdE"
        },
        {
          "name": "API_KEY",
          "valueFrom": "arn:aws:secretsmanager:us-east-1:123456789012:secret:prod/external-api-key-XyZaB"
        }
      ]
    }
  ]
}
```

Notice the `secrets` section instead of `environment`. When this task launches, ECS doesn't put the secret reference in the container—it actually retrieves the secret value from Secrets Manager and injects it as an environment variable into the container. Your application receives `DB_PASSWORD` and `API_KEY` just like any other environment variable, but the actual values never appear in the task definition, logs, or AWS Console.

Secrets Manager offers several advantages beyond security. You can use resource policies to control who can read each secret. You can implement automatic rotation—define a Lambda function that rotates your database password on a schedule, and Secrets Manager handles the rotation logic while your application continues to work. You can also store secrets in multiple formats (plain strings, JSON documents with multiple key-value pairs, etc.) and manage versioning.

The tradeoff is complexity and cost. Every time a task starts, ECS makes an API call to Secrets Manager to retrieve the secret. This adds a small delay to task startup and incurs charges (though they're minimal at scale). You also need to ensure the task execution role has permission to read from Secrets Manager.

### SSM Parameter Store for Flexible Configuration

AWS Systems Manager Parameter Store offers another way to externalize configuration. It's more general-purpose than Secrets Manager—you can store any kind of parameter, sensitive or not, and retrieve it by name or path.

In a task definition, you reference parameters similarly to secrets:

```json
{
  "family": "my-app",
  "containerDefinitions": [
    {
      "name": "my-app-container",
      "image": "my-app:1.0",
      "secrets": [
        {
          "name": "DB_HOST",
          "valueFrom": "arn:aws:ssm:us-east-1:123456789012:parameter/prod/db-host"
        }
      ],
      "environment": [
        {
          "name": "LOG_LEVEL",
          "value": "INFO"
        }
      ]
    }
  ]
}
```

You can also reference Parameter Store parameters in the `environment` section if you're confident the parameter contains non-sensitive data, though using the `secrets` section is more conventional for external references.

Parameter Store is attractive when you want centralized configuration management without the overhead of Secrets Manager. You might use Parameter Store for things like database hostnames, service endpoints, or even encrypted sensitive values (Parameter Store supports KMS encryption for SecureString parameters). It's also cheaper for read-heavy workloads.

The distinction between Secrets Manager and Parameter Store isn't purely about sensitivity—it's about lifecycle and operational patterns. Secrets Manager is built for secrets that rotate, with built-in rotation orchestration and audit trails. Parameter Store is better for configuration that changes but doesn't rotate, or for any parameter you want to manage centrally with version history and access control.

### The Critical Distinction: secrets vs. environment Sections

Here's a subtle but important detail: the `secrets` section and the `environment` section behave differently in ECS task definitions.

When you use the `secrets` section with a reference to Secrets Manager or Parameter Store, ECS resolves that reference at task startup. The actual secret value is retrieved and injected into the container's environment, but the reference itself (the ARN or parameter name) is never stored in the task definition visible to you. If you examine a running task, you see the environment variable, but not where it came from.

When you use the `environment` section, the value is stored directly in the task definition. If that value is a reference like `arn:aws:secretsmanager:...`, it stays that way—ECS doesn't resolve it. The reference becomes the literal environment variable value, which is not what you want.

This is why best practice is to use the `secrets` section for external references, even if you're referencing a non-sensitive parameter from Parameter Store. The `secrets` section triggers the resolution mechanism.

```json
{
  "secrets": [
    {
      "name": "DB_PASSWORD",
      "valueFrom": "arn:aws:secretsmanager:us-east-1:123456789012:secret:prod/db-password-AbCdE"
    }
  ]
}
```

versus

```json
{
  "environment": [
    {
      "name": "DB_PASSWORD",
      "value": "arn:aws:secretsmanager:us-east-1:123456789012:secret:prod/db-password-AbCdE"
    }
  ]
}
```

The first injects the actual secret. The second injects the ARN string itself, which your application would try to parse as a password—clearly wrong.

### IAM Permissions for the Task Execution Role

For ECS to retrieve secrets on your behalf, the task execution role must have permissions to read from Secrets Manager or Parameter Store. This is a separate role from the task role (which your application code uses for permissions).

The task execution role is assumed by the ECS agent itself. It needs permissions like these:

For Secrets Manager:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "secretsmanager:GetSecretValue"
      ],
      "Resource": "arn:aws:secretsmanager:us-east-1:123456789012:secret:prod/*"
    }
  ]
}
```

For Parameter Store:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "ssm:GetParameters",
        "ssm:GetParameter"
      ],
      "Resource": "arn:aws:ssm:us-east-1:123456789012:parameter/prod/*"
    }
  ]
}
```

Note the wildcard at the end—this grants access to all parameters under `prod/`. You can be more specific if you prefer, listing individual secrets or parameters.

If your secrets are encrypted with a custom KMS key (which is recommended for sensitive data), the task execution role also needs KMS permissions:

```json
{
  "Effect": "Allow",
  "Action": [
    "kms:Decrypt",
    "kms:DescribeKey"
  ],
  "Resource": "arn:aws:kms:us-east-1:123456789012:key/12345678-1234-1234-1234-123456789012"
}
```

If you use AWS managed keys for encryption, you typically don't need explicit KMS permissions in the role policy—AWS handles that automatically—but it's good practice to be explicit anyway.

A common mistake is forgetting the KMS permissions when the secret or parameter is encrypted. Your task will fail to start with a cryptic error about insufficient permissions. Double-check that all the necessary permissions are present.

### When Secrets Are Resolved and Injected

Understanding the exact timing of secret resolution matters for debugging and for understanding what happens if something goes wrong.

When you launch an ECS task (or update an ECS service with a new task definition), the task goes through several phases. First, the ECS agent pulls the Docker image, allocates resources, and creates the container. At this point, nothing is injected yet. As the container is about to start, the ECS agent examines the task definition, sees the `secrets` section, and makes API calls to Secrets Manager or Parameter Store to retrieve the actual values. Once the values are retrieved, they're added to the environment variables that the ECS agent passes to the container runtime. The container starts with these variables already in place.

If the secret retrieval fails—perhaps the secret was deleted, or the task execution role lacks permissions—the entire task fails to start. You'll see an error in the ECS console or CloudWatch logs indicating that the secret couldn't be retrieved. This is actually a safety feature; it's better to fail loud than to start a container with incomplete or missing configuration.

The resolution happens at task launch time, not at container image build time. This means you can update a secret in Secrets Manager, but running tasks won't automatically pick up the new value. You need to stop the old task and launch a new one. For services running multiple tasks, you can use ECS service updates with a rolling deployment strategy to gradually replace old tasks with new ones that read the updated secrets.

### Practical Patterns for Secret Rotation

Rotating secrets—periodically changing them as a security best practice—becomes manageable when you use Secrets Manager with ECS.

The most common pattern is to use Secrets Manager's built-in rotation feature. You define a Lambda function that knows how to rotate the secret (for example, by calling your database and changing the password), and Secrets Manager calls that function on a schedule. The actual secret value changes, but your applications don't need to do anything special. When you restart a task, it retrieves the new secret value automatically.

Here's a conceptual overview of how this works. Your database secret in Secrets Manager contains connection details. You configure Secrets Manager to invoke a Lambda function every 30 days. That Lambda function uses the current secret to connect to the database, creates a new password, updates the secret in Secrets Manager with the new password, and tests the connection to make sure the new password works. The old task is still running with the old password, but the next time you deploy or restart it, it picks up the new one.

For tasks in ECS services (not Fargate tasks that stop and start sporadically), you can implement automatic rotation by combining Secrets Manager rotation with ECS service updates. When the secret rotates, you trigger a new deployment of the ECS service, which replaces tasks with new ones that read the rotated secret.

One thing to watch: if your secret is used by multiple independent systems—microservices, batch jobs, databases—make sure the rotation process handles all of them. Some systems might still be using the old password during the rotation window, so your rotation strategy needs to account for that. Many teams rotate passwords by creating a new password and having both old and new active for a brief period, then retiring the old one.

### Comparing Your Options

Each configuration method has trade-offs worth understanding.

**Plain environment variables** are the simplest but unsuitable for secrets. Use them only for non-sensitive configuration that's the same across all environments.

**Secrets Manager** is ideal for sensitive values that need lifecycle management, rotation, and audit trails. It's more expensive than Parameter Store but offers better security features and is specifically designed for secrets. Use it for passwords, API keys, encryption keys, and anything else that must be protected.

**Parameter Store** works well for general configuration that might be sensitive or not. It's cheaper than Secrets Manager and integrates well with other AWS systems. Use it for database hostnames, feature flags, service endpoints, and configuration that doesn't require rotation.

In practice, most applications use a combination. You might have plain environment variables for log levels and feature flags, Parameter Store for database hostnames and service endpoints, and Secrets Manager for passwords and keys.

### Debugging Configuration Issues

When configuration injection goes wrong, the symptoms can be confusing. Your application might fail to start because it can't connect to the database, or it might crash with a parsing error because an expected environment variable is missing.

Start by checking the task definition. Open the AWS Console, navigate to ECS, find your task definition, and view the JSON. Verify that the `secrets` section contains the correct ARNs or parameter names, and that there are no typos.

Next, check the task execution role permissions. In the IAM console, find the role used by your task definition. Verify that it has `secretsmanager:GetSecretValue` or `ssm:GetParameters` permissions for the secrets or parameters you're referencing. Don't just check the role policies—also check if any resource-based policies on the secrets themselves are blocking access.

If the secret exists but permissions are correct, verify that the secret isn't encrypted with a customer-managed KMS key that the task execution role can't decrypt. Test the permissions by assuming the task execution role and trying to retrieve the secret manually using the AWS CLI.

Check the CloudWatch logs for the task. ECS agent logs often contain detailed error messages about why a secret couldn't be retrieved. Look for messages like "access denied" or "secret not found."

If a secret was recently rotated, verify that the task has actually been restarted. Running tasks continue to use the old secret until they're replaced.

### Best Practices and Security Considerations

As you implement configuration injection in your ECS infrastructure, follow these guidelines to keep your secrets secure and your deployments reliable.

First, always use the `secrets` section for external references, not the `environment` section. This ensures ECS resolves the reference rather than treating the ARN as a literal value.

Second, never commit secrets or their references to your source code repository, even if they're ARNs. Use a deployment pipeline that injects the correct ARNs for each environment.

Third, encrypt sensitive parameters and secrets. Secrets Manager encrypts by default with AWS managed keys, but consider using customer-managed KMS keys for additional control. Parameter Store doesn't encrypt by default—explicitly use SecureString parameters for sensitive data.

Fourth, use resource-based policies or IAM conditions to ensure that only the intended task execution roles can read each secret. A compromised task shouldn't be able to read secrets from other applications.

Fifth, implement secret rotation for high-value secrets like database passwords. Use Secrets Manager's rotation feature or build a custom rotation process, but make sure it's automated and tested.

Sixth, monitor access to your secrets. Secrets Manager and Parameter Store both log API calls to CloudTrail, so you can see who accessed what. Set up CloudWatch alarms to alert you to suspicious patterns.

Finally, regularly audit your task definitions and secrets. Secrets that are no longer used should be deleted. Task execution roles should be reviewed periodically to ensure permissions are still appropriate.

### Conclusion

Injecting secrets and environment variables into ECS tasks is straightforward once you understand the available mechanisms and their trade-offs. Plain environment variables work for non-sensitive configuration. Secrets Manager is your best choice for sensitive values that need rotation and strong security controls. Parameter Store is ideal for general configuration management at a lower cost. Always use the `secrets` section for external references, ensure your task execution role has the necessary permissions, and implement rotation for high-value secrets.

The right approach depends on your specific security requirements, but the pattern is consistent: externalize configuration from your container images, use AWS managed services to store and deliver that configuration securely, and let ECS handle the injection at task startup. This keeps your containers flexible, your secrets protected, and your deployments manageable across multiple environments.
