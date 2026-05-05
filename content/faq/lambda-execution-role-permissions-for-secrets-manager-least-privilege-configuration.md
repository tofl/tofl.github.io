---
title: "Lambda Execution Role Permissions for Secrets Manager: Least-Privilege Configuration"
---

## Lambda Execution Role Permissions for Secrets Manager: Least-Privilege Configuration

Every developer has been there: you write a Lambda function that needs to access a database password or API key, you grant it permission to read from Secrets Manager, and suddenly your function works. But does it work *securely*? More often than not, that first working solution involves permissions that are far broader than necessary. Instead of allowing your function to access only the specific secret it needs, you've inadvertently granted it access to every secret in your AWS account. In a real-world environment with dozens or hundreds of secrets, that's a significant security risk.

The good news is that configuring least-privilege access to Secrets Manager from Lambda is straightforward once you understand the pieces involved. This article walks you through everything you need to know: how to structure IAM policies for your Lambda execution role, how to restrict access to specific secrets using resource ARNs, how to handle cross-account scenarios, and how to troubleshoot when things inevitably go wrong.

### Understanding the Execution Role and Secrets Manager Permissions

When you invoke a Lambda function, AWS assumes an IAM execution role on your behalf. This role contains the permissions that determine what your function can do. If your function needs to retrieve secrets from AWS Secrets Manager, the execution role must grant the appropriate permissions.

The core permission you need is `secretsmanager:GetSecretValue`. This action allows your function to retrieve the current version of a secret from Secrets Manager. Without this permission explicitly granted in the execution role's trust policy, your function will receive an `AccessDenied` error when it attempts to call the Secrets Manager API.

Think of the execution role as a security boundary. Just as you wouldn't give your apartment key to someone and then hope they only go to their assigned bedroom, you shouldn't give your Lambda function access to all your secrets just to access one. The execution role should be scoped precisely: your function gets permission to call `GetSecretValue` on the specific secret ARN it needs, and nothing more.

### Structuring a Basic Lambda Execution Role Policy

Let's start with the most permissive (and therefore most dangerous) approach: granting full Secrets Manager access. This policy allows the Lambda function to retrieve any secret in the AWS account.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "secretsmanager:GetSecretValue",
      "Resource": "*"
    }
  ]
}
```

This is what many developers start with because it works, and it requires minimal thought. But notice that wildcard `*` in the Resource field. This means your function can read any secret, in any region, in your entire AWS account. If your function is compromised through a code vulnerability or malicious dependency, an attacker gains access to all your secrets. That's not acceptable in production.

The least-privilege approach restricts the Resource field to the specific secret ARN that your function actually needs. Here's how it looks:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "secretsmanager:GetSecretValue",
      "Resource": "arn:aws:secretsmanager:us-east-1:123456789012:secret:prod/database-password-AbCdE"
    }
  ]
}
```

In this version, the function can only retrieve the secret named `prod/database-password` in the `us-east-1` region. If someone tries to use this function to read a different secret, they'll get an `AccessDenied` error. If the function is deployed to a different region, it will also fail — which is actually a feature, not a bug, because it prevents accidental cross-region access.

### Using Resource ARNs Effectively

Understanding how to construct the correct resource ARN is essential. A Secrets Manager secret ARN follows this pattern:

```
arn:aws:secretsmanager:region:account-id:secret:secret-name-RandomSuffix
```

The `RandomSuffix` part is automatically appended by AWS and consists of six random characters. This suffix exists so that if you delete a secret and recreate it with the same name, you can still reference the original secret's ARN without confusion.

Here's a practical example: if you're working in the `us-west-2` region, your AWS account ID is `123456789012`, and your secret is named `my-app/api-key`, the full ARN would look like:

```
arn:aws:secretsmanager:us-west-2:123456789012:secret:my-app/api-key-aBcDeF
```

One important nuance: when you're writing the IAM policy, you typically don't know the exact six-character suffix that AWS will generate. This is where ARN wildcards come in handy. You can use a partial wildcard to match any version of that secret:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "secretsmanager:GetSecretValue",
      "Resource": "arn:aws:secretsmanager:us-west-2:123456789012:secret:my-app/api-key-*"
    }
  ]
}
```

This policy allows access to the secret regardless of what the randomly-generated suffix is. This is the sweet spot for least-privilege configuration: it's specific enough to prevent access to other secrets, but flexible enough to account for AWS-generated components.

### Handling Customer-Managed KMS Keys

Here's where many developers encounter their first unexpected problem: your Lambda function successfully retrieves the secret from Secrets Manager, but it fails to decrypt it. This happens when the secret is encrypted with a customer-managed AWS KMS key rather than the AWS-managed key.

By default, Secrets Manager encrypts secrets using the AWS-managed key `aws/secretsmanager`. Your function doesn't need explicit KMS permissions to decrypt this key. However, if someone has configured the secret to use a customer-managed KMS key for encryption, your Lambda execution role also needs permission to use that KMS key for decryption.

Without the KMS permission, you'll see an error like `AccessDenied: User: arn:aws:iam::123456789012:role/lambda-execution-role is not authorized to perform: kms:Decrypt`. The secret retrieval itself succeeds, but the decryption fails, leaving your function unable to access the plaintext value.

To fix this, you need to add a KMS permission to your execution role policy:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "secretsmanager:GetSecretValue",
      "Resource": "arn:aws:secretsmanager:us-west-2:123456789012:secret:my-app/api-key-*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "kms:Decrypt",
        "kms:DescribeKey"
      ],
      "Resource": "arn:aws:kms:us-west-2:123456789012:key/12345678-1234-1234-1234-123456789012"
    }
  ]
}
```

The first statement allows your function to retrieve the secret from Secrets Manager. The second statement allows it to decrypt the secret using the specific KMS key. Notice that the KMS resource ARN is different from the Secrets Manager ARN — it points directly to the KMS key itself.

If you're uncertain which KMS key a secret uses, you can check in the AWS Console by navigating to Secrets Manager, selecting the secret, and looking for the encryption key information in the details. Alternatively, you can use the AWS CLI:

```bash
aws secretsmanager describe-secret --secret-id my-app/api-key --region us-west-2
```

Look for the `KmsKeyId` field in the response. If it contains an ARN starting with `arn:aws:kms`, it's a customer-managed key and you'll need the KMS permission. If it shows `aws/secretsmanager`, it's the AWS-managed key and you won't need explicit KMS permissions (though it doesn't hurt to add them for defense in depth).

### Cross-Account Secret Access with Resource-Based Policies

Sometimes your Lambda function lives in one AWS account but needs to retrieve a secret that exists in another AWS account. This is a common pattern in larger organizations where secrets are centralized in a security account while applications run in separate workload accounts.

To enable this, you need two pieces: a policy in the Lambda execution role that grants permission to access the foreign secret, and a resource-based policy on the secret itself that grants the cross-account principal permission to retrieve it.

Let's say your Lambda function is in account `111111111111` and the secret is in account `222222222222`. First, add a statement to the Lambda execution role in account `111111111111`:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "secretsmanager:GetSecretValue",
      "Resource": "arn:aws:secretsmanager:us-west-2:222222222222:secret:prod/shared-api-key-*"
    }
  ]
}
```

Then, on the secret in account `222222222222`, attach a resource-based policy that allows the cross-account role to retrieve it:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "AWS": "arn:aws:iam::111111111111:role/lambda-execution-role"
      },
      "Action": "secretsmanager:GetSecretValue",
      "Resource": "*"
    }
  ]
}
```

This resource-based policy is attached to the secret itself, not to an IAM role. In the AWS Console, you'd navigate to the secret's details page and look for the "Resource Permissions" or "Permissions" section. Via the CLI, you can set it with:

```bash
aws secretsmanager put-resource-policy \
  --secret-id prod/shared-api-key \
  --resource-policy file://policy.json \
  --region us-west-2
```

When both policies are in place, the cross-account Lambda function can retrieve the secret. If either piece is missing, you'll get an `AccessDenied` error.

If the secret uses a customer-managed KMS key, you also need to grant the cross-account role decryption permissions on that key. This is typically done through the KMS key's policy, which is separate from the secret's policy:

```json
{
  "Sid": "Allow cross-account decryption",
  "Effect": "Allow",
  "Principal": {
    "AWS": "arn:aws:iam::111111111111:role/lambda-execution-role"
  },
  "Action": [
    "kms:Decrypt",
    "kms:DescribeKey"
  ],
  "Resource": "*"
}
```

This KMS policy statement should be added to the key policy of the customer-managed key in account `222222222222`.

### Common Configuration Mistakes

Even with the right concepts in mind, developers often stumble on a few predictable mistakes. Understanding these pitfalls will save you hours of debugging.

**Overly broad wildcard resources** are the most common mistake. Using `Resource: "*"` for `secretsmanager:GetSecretValue` is easy and it works, but it violates the principle of least privilege. The same goes for using a wildcard like `arn:aws:secretsmanager:*:*:*` when you could be more specific about the region and account. Every additional wildcard increases your blast radius if the function is compromised.

**Forgetting the KMS permission** happens constantly. A developer configures a secret to use a customer-managed KMS key for extra security, then grants the Lambda function permission to call `GetSecretValue`. Everything looks right — until the function tries to run and fails with a cryptic `AccessDenied` error. The function can see the secret, but it can't decrypt it. This is easily prevented by always checking whether a secret uses a customer-managed key during the initial configuration phase.

**Mismatched ARN specificity** occurs when you're too general in one place and too specific in another. For example, you might grant permission to a secret ARN in `us-west-2` but deploy your Lambda to `us-east-1`. The function won't have permission to access the secret in `us-west-2` from a different region (this is actually correct behavior, but it surprises developers who expected it to work). The solution is to think about where your function will be deployed and ensure the ARN and region match.

**Ignoring version management** is another pitfall. Secrets Manager allows you to retrieve specific versions of a secret using the `--version-id` parameter. If your policy grants `GetSecretValue` but the secret owner has restricted the `GetSecretValueResponse` action for older versions, you might only be able to retrieve the current version. This is rarely an issue in practice, but it's worth knowing if your function needs historical versions of a secret.

### Troubleshooting AccessDenied Errors

When your Lambda function throws an `AccessDenied` error while retrieving a secret, the first step is to check your CloudWatch logs. The error message often indicates which permission is missing. You'll see something like:

```
User: arn:aws:iam::123456789012:role/lambda-execution-role is not authorized to perform: 
secretsmanager:GetSecretValue on resource: 
arn:aws:secretsmanager:us-west-2:123456789012:secret:my-secret-AbCdE
```

This tells you exactly which resource and action are failing. If the action is `secretsmanager:GetSecretValue`, you're missing the Secrets Manager permission. If it's `kms:Decrypt`, you're missing the KMS permission.

Next, verify that your Lambda execution role actually has the policies you think it has. In the AWS Console, navigate to IAM > Roles, find the execution role, and review its attached inline and managed policies. Make sure the resource ARN matches exactly what you're trying to access, including the region, account ID, and secret name.

A common debugging technique is to enable CloudTrail logging on your AWS account. This captures all API calls, including failed authentication attempts. You can query CloudTrail to see exactly what permission was missing when the `AccessDenied` error occurred. This is particularly helpful when you're dealing with complex cross-account scenarios.

Another useful tool is the IAM Access Analyzer, which can validate your policies against a set of rules and identify potential issues. You can use it to test whether your policy would allow a specific action on a specific resource without actually running your Lambda function.

If you're still stuck, try a temporary policy with broader permissions to isolate whether the issue is with permissions or with something else (like the secret name, region, or the secret's own configuration). For example, temporarily add a policy that grants `secretsmanager:*` on `Resource: "*"` to your execution role. If the function suddenly works, you know the issue is permission scope. If it still fails, the problem is elsewhere.

### Best Practices for Production

When deploying to production, follow these principles to keep your secret access secure and auditable.

Always use the most specific ARN you can. Instead of `arn:aws:secretsmanager:*:*:secret:*`, use `arn:aws:secretsmanager:us-west-2:123456789012:secret:prod/database-password-*`. The extra specificity costs nothing in terms of complexity but gains you significant security.

Document which secrets each Lambda function needs to access. Keep this documentation in your Infrastructure as Code (IaC) tool, whether that's CloudFormation, Terraform, or AWS CDK. When a new developer needs to understand the security model, they should be able to look at the code and immediately see what permissions are required and why.

Use AWS Secrets Manager's built-in features for secret rotation. If a secret is rotated, ensure your Lambda execution role still has permission to retrieve the new version. Rotation typically creates a new version while keeping the same secret ARN, so your existing policy should continue to work, but it's worth verifying.

Consider using separate secrets for different environments. Rather than storing `prod/database-password` and `dev/database-password` in the same account and giving all functions permission to both, use separate accounts or at least separate secrets. This limits the blast radius if a function in the dev environment is compromised.

Enable secret tagging and use tag-based conditions in your IAM policies. Instead of granting access to specific ARNs, you can grant access to all secrets with a particular tag. This is more maintainable as your number of secrets grows:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "secretsmanager:GetSecretValue",
      "Resource": "*",
      "Condition": {
        "StringEquals": {
          "secretsmanager:ResourceTag/Application": "my-app"
        }
      }
    }
  ]
}
```

This policy allows your function to retrieve any secret tagged with `Application: my-app`, regardless of its name or ARN. When you need to grant access to a new secret, you just add the tag — no need to update the IAM policy.

### Conclusion

Securing Lambda's access to Secrets Manager comes down to understanding the execution role, the specific permissions required, and the principle of least privilege. The core permission is `secretsmanager:GetSecretValue`, but the real work is in scoping it correctly to the specific secrets your function needs and, when necessary, adding KMS permissions for customer-managed encryption keys.

Start with the most restrictive policy you can: grant your function permission to access only the specific secret ARN it needs, in the specific region it's deployed. From there, expand only when necessary — for cross-account access, for multiple secrets, or for different environments. Document your choices and revisit them regularly.

As you build more sophisticated systems with Lambda functions accessing multiple secrets or secrets in different accounts, you'll find that the same principles continue to apply. Specificity, clarity, and the principle of least privilege aren't just security best practices; they're the foundation for building systems that are understandable, maintainable, and resilient to failure.
