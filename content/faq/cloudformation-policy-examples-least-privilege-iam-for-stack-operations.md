---
title: "CloudFormation Policy Examples: Least-Privilege IAM for Stack Operations"
---

## CloudFormation Policy Examples: Least-Privilege IAM for Stack Operations

When you hand developers the ability to deploy infrastructure through CloudFormation, you're essentially giving them permission to create, modify, and sometimes delete AWS resources at scale. The challenge isn't whether to grant that power—modern development demands it—but how to grant it safely. This is where least-privilege IAM policies become your strongest ally, yet crafting them correctly trips up even experienced AWS architects. The stakes are real: a poorly scoped policy can let someone accidentally (or intentionally) provision resources you never intended, expose sensitive data, or rack up unexpected costs.

In this guide, we'll explore how to design IAM policies that enable developers to work productively with CloudFormation while maintaining tight security boundaries. You'll learn why a simple "allow cloudformation" statement isn't enough, how to think about the permission layers involved, and how to use practical conditions to enforce organizational standards.

### Understanding the Two-Layer Permission Model

Here's the critical insight that many developers miss: CloudFormation itself is just an orchestration service. When you grant someone permission to create a CloudFormation stack, you're granting them permission to tell CloudFormation what to do. But CloudFormation then needs its own permissions to actually perform those actions on your behalf.

Think of it like this: a manager can have permission to request a purchase (CloudFormation permission), but the accounting team still needs permission to process the purchase (the underlying service permissions). Both permissions must exist.

When a developer runs `aws cloudformation create-stack` with a template that includes an EC2 instance, S3 bucket, and RDS database, two distinct permission checks happen:

1. **CloudFormation layer**: AWS verifies the developer has `cloudformation:CreateStack`, `cloudformation:ValidateTemplate`, and related actions. These permissions say "you're allowed to use the CloudFormation service."

2. **Service layer**: AWS verifies the developer (or the IAM role CloudFormation assumes) has `ec2:RunInstances`, `s3:CreateBucket`, `rds:CreateDBInstance`, and any other actions that the template requires. These permissions say "you're allowed to create these actual resources."

Both layers must grant permissions. A developer could have full CloudFormation access but be unable to create stacks if they lack permission to create the resources the template describes. Conversely, they could have permission to create every AWS resource but be blocked from CloudFormation operations themselves.

### The Foundation: CloudFormation Service Permissions

Let's start with the CloudFormation layer. Most developers need a baseline set of CloudFormation actions to work effectively. Here's what typically appears in a well-scoped policy:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "CloudFormationStackOperations",
      "Effect": "Allow",
      "Action": [
        "cloudformation:CreateStack",
        "cloudformation:UpdateStack",
        "cloudformation:DeleteStack",
        "cloudformation:DescribeStacks",
        "cloudformation:DescribeStackResources",
        "cloudformation:DescribeStackEvents",
        "cloudformation:ListStacks",
        "cloudformation:GetTemplate",
        "cloudformation:ValidateTemplate"
      ],
      "Resource": "arn:aws:cloudformation:*:ACCOUNT-ID:stack/*"
    }
  ]
}
```

This statement allows developers to perform the core stack operations. The `Resource` field restricts these permissions to CloudFormation stacks in your account—they can't manage CloudFormation resources in other accounts or at the organization level.

However, notice what's missing: permissions for specific resources like EC2, S3, or databases. That's intentional. This policy alone would let someone create a stack, but the stack operations would fail when CloudFormation tried to create the actual infrastructure.

### Adding Service-Specific Permissions

Now we layer in the permissions for the resources developers should be able to provision. Here's where policy design becomes nuanced, because you need to think about *what resources* developers should create and *which ones they shouldn't*.

Let's build a realistic scenario: you want developers to create stacks containing EC2 instances and security groups, but you don't want them creating RDS databases or modifying IAM roles. Here's the expanded policy:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "CloudFormationStackOperations",
      "Effect": "Allow",
      "Action": [
        "cloudformation:CreateStack",
        "cloudformation:UpdateStack",
        "cloudformation:DeleteStack",
        "cloudformation:DescribeStacks",
        "cloudformation:DescribeStackResources",
        "cloudformation:DescribeStackEvents",
        "cloudformation:ListStacks",
        "cloudformation:GetTemplate",
        "cloudformation:ValidateTemplate"
      ],
      "Resource": "arn:aws:cloudformation:*:ACCOUNT-ID:stack/*"
    },
    {
      "Sid": "EC2Resources",
      "Effect": "Allow",
      "Action": [
        "ec2:RunInstances",
        "ec2:TerminateInstances",
        "ec2:StartInstances",
        "ec2:StopInstances",
        "ec2:CreateSecurityGroup",
        "ec2:DeleteSecurityGroup",
        "ec2:AuthorizeSecurityGroupIngress",
        "ec2:RevokeSecurityGroupIngress",
        "ec2:DescribeSecurityGroups",
        "ec2:DescribeInstances",
        "ec2:DescribeKeyPairs",
        "ec2:DescribeVpcs",
        "ec2:DescribeSubnets"
      ],
      "Resource": "*"
    }
  ]
}
```

This policy now allows stack operations plus the EC2 actions needed to create and manage instances. But notice the `Resource` field for EC2 is set to `"*"`. That's not ideal from a least-privilege perspective, but it's often a practical necessity because you need to describe VPCs and subnets to know which ones are available. We'll improve this shortly.

### The Critical Safety Mechanism: Explicit Denies

Here's where security-conscious architects diverge from the merely permissive. Certain actions are so dangerous that you should explicitly deny them unless absolutely necessary. IAM deletion, KMS key destruction, and principal policy modifications fall into this category.

Consider this scenario: a developer's policy allows `iam:*` because you reasoned that CloudFormation needs flexibility to create roles. But this same policy also grants `iam:DeleteRole`, `iam:DeletePolicy`, and `iam:PutUserPolicy`. Now a developer (malicious or careless) can delete critical infrastructure policies or IAM roles that other teams depend on.

Explicit denies protect against this. They take precedence over allows and cannot be overridden by other policies, making them ideal for guardrails:

```json
{
  "Sid": "ExplicitDenyDangerousActions",
  "Effect": "Deny",
  "Action": [
    "iam:DeleteUser",
    "iam:DeleteRole",
    "iam:DeletePolicy",
    "iam:PutUserPolicy",
    "iam:PutRolePolicy",
    "iam:AttachUserPolicy",
    "iam:AttachRolePolicy",
    "iam:CreateAccessKey",
    "iam:CreateLoginProfile",
    "kms:DeleteKey",
    "kms:ScheduleKeyDeletion",
    "kms:DisableKey"
  ],
  "Resource": "*"
}
```

This statement doesn't prevent CloudFormation from managing *service roles* that CloudFormation itself creates (those are typically prefixed with `aws-cloudformation-`), but it does prevent developers from manipulating general-purpose IAM resources or destroying encryption keys. It's a simple but powerful pattern.

### Refining with Conditions: The Real Power of Least-Privilege

Conditions are where static policies become intelligent. They let you enforce business rules without hardcoding every resource ARN. Consider these practical scenarios:

**Restricting to specific VPCs**: You want developers to only provision resources in approved VPCs to maintain network isolation.

```json
{
  "Sid": "AllowEC2InSpecificVPC",
  "Effect": "Allow",
  "Action": [
    "ec2:RunInstances",
    "ec2:CreateNetworkInterface"
  ],
  "Resource": [
    "arn:aws:ec2:*:ACCOUNT-ID:instance/*",
    "arn:aws:ec2:*:ACCOUNT-ID:network-interface/*"
  ],
  "Condition": {
    "StringEquals": {
      "ec2:Vpc": "arn:aws:ec2:REGION:ACCOUNT-ID:vpc/vpc-12345678"
    }
  }
}
```

This condition ensures that even if developers have `ec2:RunInstances` permission, instances can only launch in the specified VPC.

**Enforcing S3 bucket encryption**: You want all S3 buckets created through CloudFormation to be encrypted by default.

```json
{
  "Sid": "AllowS3BucketCreation",
  "Effect": "Allow",
  "Action": [
    "s3:CreateBucket",
    "s3:PutBucketEncryption",
    "s3:PutBucketVersioning"
  ],
  "Resource": "arn:aws:s3:::*"
}
```

Then, to enforce encryption, add a deny statement:

```json
{
  "Sid": "DenyUnencryptedS3Buckets",
  "Effect": "Deny",
  "Action": "s3:CreateBucket",
  "Resource": "arn:aws:s3:::*",
  "Condition": {
    "StringNotEquals": {
      "s3:x-amz-server-side-encryption": "AES256"
    }
  }
}
```

Actually, this particular condition doesn't work exactly as written—S3 bucket creation doesn't include encryption headers directly. A better approach is to use CloudFormation-level controls, which we'll cover next.

**Limiting to specific CloudFormation stack names**: Organizations often use stack naming conventions. You can enforce them:

```json
{
  "Sid": "AllowStackOperationsOnNamedStacks",
  "Effect": "Allow",
  "Action": [
    "cloudformation:UpdateStack",
    "cloudformation:DeleteStack"
  ],
  "Resource": "arn:aws:cloudformation:*:ACCOUNT-ID:stack/prod-*",
  "Condition": {
    "StringEquals": {
      "aws:RequestedRegion": "us-east-1"
    }
  }
}
```

This policy only allows developers to update or delete stacks whose names start with `prod-` and only in `us-east-1`, preventing accidental operations in wrong regions or against wrong stacks.

### Working with CloudFormation Capabilities

CloudFormation has a concept called "capabilities" that require explicit acknowledgment before executing certain operations. The most common is `CAPABILITY_IAM`, which is required when your template creates, modifies, or deletes IAM resources.

When developers run `aws cloudformation create-stack` with a template that includes IAM resources, they must include `--capabilities CAPABILITY_IAM`. This is actually a built-in safety mechanism—developers must consciously opt into creating IAM resources rather than doing so accidentally.

However, your IAM policy should reflect whether developers should be able to create stacks with IAM resources. If not, you can restrict this through tags or explicit denies on IAM actions, as we discussed earlier.

### A Complete Developer Policy Template

Let's assemble a comprehensive, production-ready policy for a developer team that needs to work with CloudFormation across EC2, networking, and S3, but shouldn't touch IAM, databases, or destructive operations:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "CloudFormationStackOperations",
      "Effect": "Allow",
      "Action": [
        "cloudformation:CreateStack",
        "cloudformation:UpdateStack",
        "cloudformation:DeleteStack",
        "cloudformation:DescribeStacks",
        "cloudformation:DescribeStackResources",
        "cloudformation:DescribeStackEvents",
        "cloudformation:ListStacks",
        "cloudformation:GetTemplate",
        "cloudformation:ValidateTemplate",
        "cloudformation:GetStackPolicy",
        "cloudformation:SetStackPolicy",
        "cloudformation:DescribeStackResource"
      ],
      "Resource": "arn:aws:cloudformation:*:ACCOUNT-ID:stack/*"
    },
    {
      "Sid": "EC2Compute",
      "Effect": "Allow",
      "Action": [
        "ec2:RunInstances",
        "ec2:TerminateInstances",
        "ec2:StartInstances",
        "ec2:StopInstances",
        "ec2:RebootInstances",
        "ec2:CreateVolume",
        "ec2:DeleteVolume",
        "ec2:AttachVolume",
        "ec2:DetachVolume",
        "ec2:DescribeInstances",
        "ec2:DescribeVolumes",
        "ec2:DescribeInstanceAttribute"
      ],
      "Resource": [
        "arn:aws:ec2:*:ACCOUNT-ID:instance/*",
        "arn:aws:ec2:*:ACCOUNT-ID:volume/*"
      ]
    },
    {
      "Sid": "EC2Networking",
      "Effect": "Allow",
      "Action": [
        "ec2:CreateSecurityGroup",
        "ec2:DeleteSecurityGroup",
        "ec2:AuthorizeSecurityGroupIngress",
        "ec2:AuthorizeSecurityGroupEgress",
        "ec2:RevokeSecurityGroupIngress",
        "ec2:RevokeSecurityGroupEgress",
        "ec2:DescribeSecurityGroups",
        "ec2:DescribeSecurityGroupReferences",
        "ec2:DescribeNetworkInterfaces",
        "ec2:CreateNetworkInterface",
        "ec2:DeleteNetworkInterface",
        "ec2:ModifyNetworkInterfaceAttribute"
      ],
      "Resource": "*"
    },
    {
      "Sid": "EC2ReadOnly",
      "Effect": "Allow",
      "Action": [
        "ec2:DescribeVpcs",
        "ec2:DescribeSubnets",
        "ec2:DescribeAvailabilityZones",
        "ec2:DescribeKeyPairs",
        "ec2:DescribeImages",
        "ec2:DescribeTags"
      ],
      "Resource": "*"
    },
    {
      "Sid": "S3BucketManagement",
      "Effect": "Allow",
      "Action": [
        "s3:CreateBucket",
        "s3:DeleteBucket",
        "s3:ListBucket",
        "s3:GetBucketVersioning",
        "s3:PutBucketVersioning",
        "s3:GetBucketEncryption",
        "s3:PutBucketEncryption",
        "s3:GetBucketLogging",
        "s3:PutBucketLogging",
        "s3:GetBucketPolicy",
        "s3:PutBucketPolicy"
      ],
      "Resource": "arn:aws:s3:::*"
    },
    {
      "Sid": "S3ObjectAccess",
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:PutObject",
        "s3:DeleteObject"
      ],
      "Resource": "arn:aws:s3:::*/*"
    },
    {
      "Sid": "ExplicitDenyIAMAndKMS",
      "Effect": "Deny",
      "Action": [
        "iam:*",
        "kms:DeleteKey",
        "kms:ScheduleKeyDeletion",
        "kms:DisableKey"
      ],
      "Resource": "*"
    }
  ]
}
```

This policy provides a solid foundation. Developers can create and manage CloudFormation stacks that provision EC2 instances, security groups, and S3 buckets, but they're explicitly blocked from touching IAM or destroying KMS keys. Notice how the EC2 read-only actions use `Resource: "*"` because CloudFormation needs to query available VPCs and subnets before creation, but create/delete operations are restricted to specific resource types.

### Handling Service Roles and AssumeRole Permissions

There's one more layer worth understanding: service roles. When CloudFormation creates resources, it can operate in one of two modes. By default, it uses the permissions of the user or role calling the API. Alternatively, you can provide a service role that CloudFormation assumes for the duration of stack operations.

Using a service role adds a layer of isolation and is considered a best practice in organizations with strict separation of duties. The policy for developers then grants `iam:PassRole` for specific service roles:

```json
{
  "Sid": "AllowPassRoleForCloudFormationService",
  "Effect": "Allow",
  "Action": "iam:PassRole",
  "Resource": "arn:aws:iam::ACCOUNT-ID:role/cloudformation-service-role",
  "Condition": {
    "StringEquals": {
      "iam:PassedToService": "cloudformation.amazonaws.com"
    }
  }
}
```

And the service role itself has the permissions needed to create resources:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "ec2:RunInstances",
        "ec2:CreateSecurityGroup",
        "s3:CreateBucket"
      ],
      "Resource": "*"
    }
  ]
}
```

This pattern decouples developer permissions from the actual resource creation permissions. A developer can hand CloudFormation a template and a service role, and CloudFormation creates resources as the service role, not as the developer. This prevents developers from exceeding their granted permissions even indirectly through CloudFormation.

### Real-World Scenario: Multi-Team AWS Account

Consider a typical organizational setup: you have a shared AWS account with multiple teams (backend, frontend, data), each needing CloudFormation access but with different resource requirements and safety constraints.

**Backend team policy**: Needs EC2, RDS, and ElastiCache for application infrastructure.

```json
{
  "Sid": "BackendTeamCloudFormation",
  "Effect": "Allow",
  "Action": [
    "cloudformation:CreateStack",
    "cloudformation:UpdateStack",
    "cloudformation:DeleteStack",
    "cloudformation:Describe*",
    "cloudformation:List*",
    "cloudformation:Validate*",
    "cloudformation:GetTemplate"
  ],
  "Resource": "arn:aws:cloudformation:*:ACCOUNT-ID:stack/backend-*"
}
```

Pair this with permissions for RDS, ElastiCache, and EC2, but deny IAM and KMS deletion.

**Frontend team policy**: Needs CloudFront, S3, and API Gateway for static site and API infrastructure.

```json
{
  "Sid": "FrontendTeamCloudFormation",
  "Effect": "Allow",
  "Action": [
    "cloudformation:CreateStack",
    "cloudformation:UpdateStack",
    "cloudformation:DeleteStack",
    "cloudformation:Describe*",
    "cloudformation:List*",
    "cloudformation:Validate*",
    "cloudformation:GetTemplate"
  ],
  "Resource": "arn:aws:cloudformation:*:ACCOUNT-ID:stack/frontend-*"
}
```

With permissions for S3, CloudFront, and API Gateway. Notice the `Resource` restriction to stack names prefixed with `backend-` or `frontend-`. This prevents one team from accidentally (or maliciously) updating another team's stacks.

**Data team policy**: Needs Glue, Athena, and S3 for analytics infrastructure, plus read-only RDS access.

```json
{
  "Sid": "DataTeamCloudFormation",
  "Effect": "Allow",
  "Action": [
    "cloudformation:CreateStack",
    "cloudformation:UpdateStack",
    "cloudformation:DeleteStack",
    "cloudformation:Describe*",
    "cloudformation:List*",
    "cloudformation:Validate*",
    "cloudformation:GetTemplate"
  ],
  "Resource": "arn:aws:cloudformation:*:ACCOUNT-ID:stack/data-*"
}
```

With permissions for Glue, Athena, and S3, plus read-only RDS access.

Each team has identical CloudFormation permissions but different underlying resource permissions, and all teams are blocked from IAM and KMS operations. This scales cleanly as your organization adds teams.

### Testing Your Policies

Before deploying a policy to production, validate it against real CloudFormation templates. The AWS IAM Policy Simulator (available in the AWS Console) is invaluable here. You can paste a policy, specify actions, and see whether they're allowed or denied. Additionally, you can test with actual AWS CLI commands in a non-production account:

```bash
aws cloudformation create-stack \
  --stack-name test-stack \
  --template-body file://template.json
```

If permissions are missing, CloudFormation returns an `AccessDenied` error that usually specifies which action failed. This iterative approach is much safer than deploying to production and discovering problems.

CloudFormation also provides `--role-arn` parameter to test with a specific service role, helping you validate the service role's permissions separately from the developer's permissions.

### Common Pitfalls and How to Avoid Them

**Over-permissioning to simplify policy management**: It's tempting to grant `ec2:*` or `iam:*` to avoid managing individual actions. Resist this. The additional effort upfront saves you from security incidents later.

**Forgetting read-only actions**: Developers often need `Describe*` permissions to see what resources exist before creating new ones. Don't omit these in pursuit of minimal policies.

**Not accounting for CloudFormation's internal operations**: CloudFormation sometimes needs permission for actions you wouldn't expect. For instance, it needs `logs:CreateLogGroup` to create log groups for VPC Flow Logs, even if your template doesn't explicitly define them. Test thoroughly.

**Assuming deny statements override service roles**: If you have an explicit deny on `iam:DeleteRole` in a developer's policy but grant full IAM permissions through a service role, the service role can still delete roles. Denies apply to the principal's entire permission set, not just specific policies.

**Neglecting resource-based policies**: CloudFormation stacks can reference resources with resource-based policies (S3 bucket policies, KMS key policies). Ensure those policies align with your IAM policies. A developer might have permission to create an S3 bucket but lack permission to set its policy if the KMS key policy denies them.

### Moving Forward

The policies in this guide provide a strong foundation, but your specific requirements will vary based on your organization's architecture, risk tolerance, and teams. Start with a conservative policy—grant only what's needed for day-to-day operations—and expand based on actual requirements rather than anticipated ones.

Regularly audit CloudFormation stack creation and deletion events in CloudTrail to ensure developers are creating the resources you expect. If you notice unexpected resource types, tighten the policy. Similarly, review IAM policy access denials to catch cases where developers need additional permissions.

The principle of least privilege isn't a one-time configuration but an ongoing practice of verifying that the permissions you've granted match the work people actually do. With the patterns and policies in this guide, you have the tools to build CloudFormation governance that enables your teams while protecting your infrastructure.
