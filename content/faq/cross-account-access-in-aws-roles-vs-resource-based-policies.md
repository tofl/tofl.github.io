---
title: "Cross-Account Access in AWS: Roles vs Resource-Based Policies"
---

## Cross-Account Access in AWS: Roles vs Resource-Based Policies

In many organizations, AWS workloads span multiple accounts. Maybe your development team operates in one account, your data warehouse in another, and your production application in a third. At some point, resources in one account need to access resources in another—and that's where cross-account access becomes critical. The question isn't whether you'll need it; it's how you'll implement it.

AWS gives you two primary mechanisms to grant cross-account access: assuming a role through the Security Token Service (STS), or using resource-based policies that explicitly permit cross-account principals. Both work, but they're fundamentally different approaches with distinct trade-offs. Understanding when to use each one will help you build more secure, maintainable, and scalable AWS architectures.

### Understanding the Two Approaches

The conceptual difference between these approaches is worth dwelling on because it shapes how you think about security and delegation in AWS.

**Role assumption via STS** works like this: an identity in Account A (a user, instance, or service) requests temporary credentials from the STS service. They ask, in essence, "I'd like to assume this role in Account B." If they have permission to assume that role, STS grants them temporary security credentials tied to the assumed role. Those credentials have the permissions defined by the role in Account B. This is a delegated, time-limited, credential-based approach.

**Resource-based policies** work differently. Instead of asking for credentials, the resource itself (like an S3 bucket, Lambda function, or SNS topic) has a policy statement that says, "I allow this principal from Account A to perform these actions directly." There's no assumption or temporary credential handoff. The principal in Account A acts directly against the resource, and the resource evaluates whether that principal is permitted.

Think of it this way: role assumption is like being handed a visitor's badge that grants you temporary access to a building. A resource-based policy is like a guest list at the door—your name is on it, and you're admitted directly.

### The Role-Assumption Approach with STS

When you assume a role, you're leveraging the AWS Security Token Service to create temporary credentials. This mechanism is powerful because it enforces time-limiting, fine-grained control, and clear audit trails.

Let's walk through a concrete scenario. Suppose you have an EC2 instance in Account A that needs to read data from an S3 bucket in Account B. Here's how you'd set this up:

**Step 1: Create the role in Account B**

In Account B, you define an IAM role with a trust policy that permits Account A to assume it, and you attach a policy granting S3 read permissions.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "AWS": "arn:aws:iam::111111111111:root"
      },
      "Action": "sts:AssumeRole"
    }
  ]
}
```

Here, `111111111111` is your Account A ID. The trust policy permits anyone in that account (the root) to assume the role. You'd typically narrow this to a specific user or service role.

Then, attach a policy to this role:

```json
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
        "arn:aws:s3:::shared-data-bucket",
        "arn:aws:s3:::shared-data-bucket/*"
      ]
    }
  ]
}
```

**Step 2: Grant permission to assume the role in Account A**

Back in Account A, the EC2 instance (or the principal making the call) needs permission to assume the role. If the instance has an instance profile with an IAM role, that role needs an inline or attached policy like:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "sts:AssumeRole",
      "Resource": "arn:aws:iam::222222222222:role/CrossAccountS3Access"
    }
  ]
}
```

Here, `222222222222` is Account B, and `CrossAccountS3Access` is the role name.

**Step 3: The instance assumes the role and uses the credentials**

When the application on the EC2 instance needs to access the S3 bucket, it calls the STS `AssumeRole` API:

```bash
aws sts assume-role \
  --role-arn arn:aws:iam::222222222222:role/CrossAccountS3Access \
  --role-session-name my-app-session
```

The response includes temporary credentials (access key, secret key, and session token) valid for a limited period (default 3600 seconds, up to 43200). The application then uses these credentials to access the S3 bucket.

The beauty of this approach is the temporary nature and auditability. CloudTrail logs each assumption, and the credentials automatically expire. If a credential is compromised, it has a limited window of exploitation.

### The Resource-Based Policy Approach

Resource-based policies provide a simpler, more direct mechanism in some cases. Not all AWS services support resource-based policies, but major services like S3, SNS, SQS, Lambda, and KMS do.

Let's use the same scenario: Account A needs S3 access to Account B. This time, instead of creating a role, you modify the bucket policy directly.

**Step 1: Modify the bucket policy in Account B**

You add a statement to the bucket policy that explicitly grants permissions to a principal in Account A:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "AWS": "arn:aws:iam::111111111111:root"
      },
      "Action": [
        "s3:GetObject",
        "s3:ListBucket"
      ],
      "Resource": [
        "arn:aws:s3:::shared-data-bucket",
        "arn:aws:s3:::shared-data-bucket/*"
      ]
    }
  ]
}
```

That's it. The bucket policy says, "Anyone from Account A (specifically the root user or anything within that account) can list and read objects in this bucket."

**Step 2: The principal in Account A accesses the resource directly**

The EC2 instance in Account A can now directly access the bucket without assuming a role. If the instance's IAM role has a policy allowing S3 access (even a generic one), the instance can read from the bucket:

```bash
aws s3 ls s3://shared-data-bucket --region us-east-1
```

Behind the scenes, AWS evaluates both the instance's IAM permissions *and* the bucket policy. Both must allow the action for it to succeed.

### When to Use Role Assumption

Role assumption is your go-to mechanism in several scenarios:

**Cross-account access with temporary credentials.** If you need credentials that automatically expire, role assumption is ideal. This limits the blast radius of credential compromise. You might have a Lambda function in Account A that periodically reads from DynamoDB in Account B—role assumption with short session durations is perfect here.

**Complex permission requirements.** If the cross-account access needs to be heavily audited or if permissions must change frequently, assuming a role gives you a clear, centralized place to manage permissions. You change the role's permission policy, not multiple resource policies across different services.

**Delegated access scenarios.** When you're building a platform where multiple teams or external partners need temporary, controlled access, role assumption provides the structure. You can set session policies, duration limits, and external IDs for additional security.

**Federated identities.** If you're using SAML, OpenID Connect, or cross-account federation, role assumption is the mechanism. A user from an identity provider assumes a role in your AWS account.

**Cross-account Lambda or Step Functions execution.** When AWS services in one account need to invoke services in another, role assumption is standard. The service assumes a cross-account role to invoke Lambda functions or start executions in another account.

### When to Use Resource-Based Policies

Resource-based policies shine in different contexts:

**Simple, direct access.** If Account A simply needs read access to a bucket in Account B, and that's unlikely to change, a bucket policy is straightforward. It's a one-time configuration on the resource itself.

**Services without role support.** Not all AWS services support resource-based policies, but those that do (S3, SNS, SQS, Lambda, KMS) often make resource-based policies the simplest option. For example, if you want Account A to invoke a Lambda function in Account B, a resource-based policy on the function is often easier than setting up role assumptions.

**Delegation by resource owners.** In distributed organizations, resource owners (the team managing an S3 bucket, for example) can directly grant access to other accounts via bucket policies without requiring IAM administrators to create roles. This decentralizes control.

**Public or semi-public access.** If you want to grant access to multiple AWS accounts or even the public, resource-based policies are flexible. You can have wildcard principals or wide-ranging permissions without creating separate roles.

**Tight coupling to specific resources.** When the permission is fundamentally tied to a specific resource (e.g., "read this bucket, not any bucket"), a resource-based policy makes that clear and co-locates the policy with the resource.

### Key Trade-offs and Considerations

Understanding the nuances between these approaches helps you make the right choice for your architecture.

**Auditability and control.** Role assumption provides clearer audit trails because every assumption is logged. If you need to revoke access, you modify or delete the role. Resource-based policies are also auditable, but the permission logic is distributed across multiple resources. If Account A has access via ten different resource-based policies, auditing what Account A can do requires checking all ten resources.

**Credential management.** Role assumption creates temporary credentials. Resource-based policies don't—the principal uses their existing credentials. If you're concerned about credential compromise, the time-limited nature of assumed-role credentials is a security advantage. However, resource-based policies eliminate the operational complexity of credential rotation for cross-account scenarios.

**Performance.** Resource-based policies are typically slightly faster because there's no STS call involved. You directly use your credentials to access the resource. For most workloads, this difference is negligible, but in high-volume scenarios (thousands of requests per second), it can matter.

**Flexibility and modification.** Role assumption is more flexible if permissions need to change. You modify the role's policy in one place. With resource-based policies, you're modifying multiple resources. However, if you're building a reusable, templated cross-account access pattern (e.g., a Lambda function that multiple accounts invoke), resource-based policies are simpler—each account just adds an entry to the resource policy.

**Preventing delegation.** There's a subtle but important security consideration: principal delegation. When you grant someone permission to assume a role, they can potentially pass that role to another service or principal. This is useful for delegation but can be a security risk if not carefully managed. Resource-based policies don't have this concern because there's no intermediate credential handoff.

### Combining Both Approaches

In practice, you often don't choose one or the other—you use both strategically.

Imagine a platform where Account A (a control plane) manages multiple customer accounts. Each customer account has an S3 bucket. The platform needs to audit and backup all customer buckets. You might:

1. Create a cross-account role in each customer account that grants S3 permissions to the platform account's backup service.
2. Use that role for the backup process, leveraging temporary credentials and clear audit trails.
3. On top of that, add resource-based policies to specific buckets to allow the platform's data analytics service direct read access without role assumption, keeping analytics latency minimal.

This hybrid approach balances security, auditability, performance, and operational simplicity.

### External IDs for Enhanced Security

Whether you use role assumption or resource-based policies, when granting cross-account access, consider using external IDs as an additional security layer.

An external ID is a secret string that must be provided when assuming a role. Even if an attacker knows your account ID and role name, they can't assume the role without the external ID.

When creating a role's trust policy, you include an external ID condition:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "AWS": "arn:aws:iam::111111111111:root"
      },
      "Action": "sts:AssumeRole",
      "Condition": {
        "StringEquals": {
          "sts:ExternalId": "my-secret-external-id-12345"
        }
      }
    }
  ]
}
```

Then, when assuming the role, you include the external ID:

```bash
aws sts assume-role \
  --role-arn arn:aws:iam::222222222222:role/CrossAccountS3Access \
  --role-session-name my-app-session \
  --external-id my-secret-external-id-12345
```

External IDs are especially valuable when a third party is managing the cross-account access on your behalf, or when you're paranoid about role assumption hijacking. They don't apply to resource-based policies in the same way, but you can use conditions in resource-based policies for similar effects (e.g., restricting by source IP or VPC endpoint).

### Practical Guidance for Implementation

When you're faced with a cross-account access requirement, ask yourself these questions:

**Does the resource support resource-based policies?** If the resource you need to access is S3, Lambda, SNS, SQS, or KMS, resource-based policies are available and often the simplest choice for direct access.

**Do you need temporary credentials or time-limited access?** If yes, use role assumption. This is especially important for applications where credentials might be exposed or for audit compliance.

**How many services need access, and how frequently do permissions change?** If it's a one-off or a small number of resources, resource-based policies work well. If it's complex and changing, role assumption provides better centralization.

**Are you delegating access to a third party or external service?** Role assumption is typically safer because you can use external IDs, set session policies, and revoke access by disabling the role.

**What's your audit and compliance posture?** Both approaches are auditable, but role assumption provides clearer, more granular logs of who accessed what and when.

### Conclusion

Cross-account access is one of the most common patterns in multi-account AWS architectures, and having the right tool for the job makes a significant difference. Role assumption via STS and resource-based policies are both powerful—they're just designed for different scenarios.

Use role assumption when you need temporary credentials, centralized permission management, or enhanced security with external IDs. Use resource-based policies when you want simplicity, direct access, or when the permission is tightly bound to a specific resource. In many sophisticated architectures, you'll use both, layered strategically to balance security, performance, and operational simplicity.

As you design your multi-account strategy, think about your organization's risk profile, audit requirements, and operational overhead. The right choice will make your AWS environment both more secure and easier to manage.
