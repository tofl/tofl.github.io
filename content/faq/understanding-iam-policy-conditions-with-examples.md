---
title: "Understanding IAM Policy Conditions with Examples"
---

## Understanding IAM Policy Conditions with Examples

When you're building secure applications on AWS, identity and access management is where everything starts. You can define who can do what, but without conditions, your policies lack nuance and flexibility. IAM policy conditions are the fine-grained control mechanism that lets you say things like "allow this action, but only from this IP address" or "allow this action only if MFA is present." Understanding conditions deeply is essential for writing least-privilege policies and building applications that are both secure and operationally practical.

### Why Conditions Matter in IAM Policy Design

At their core, IAM policies grant or deny permissions based on principals (who), actions (what), and resources (which). But real-world security rarely stops there. Consider this scenario: you want to allow developers to access production databases, but only during business hours, from the corporate VPN, and only after they've authenticated with multi-factor authentication. Without conditions, you'd either grant broad access or you'd have to manage multiple policies and rotate keys constantly.

Conditions are the fourth dimension of IAM policy design. They act as gatekeepers that evaluate contextual information about the request before the policy decision is made. Every AWS API call carries metadata—the source IP, the current time, whether MFA was used, resource tags, and much more. Conditions let you leverage this metadata to create policies that are simultaneously more permissive (fewer restrictions on *what*) and more secure (more restrictions on *how* and *when*).

### The Anatomy of a Condition Block

Before diving into specific condition keys and operators, let's understand the structure. A condition block in an IAM policy looks like this:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::my-bucket/*",
      "Condition": {
        "IpAddress": {
          "aws:SourceIp": ["203.0.113.0/24"]
        }
      }
    }
  ]
}
```

The `Condition` element is a JSON object where the top-level keys are condition operators (like `IpAddress`, `StringEquals`, `Bool`, etc.). Under each operator, you specify one or more condition keys and their values. When AWS evaluates the policy, it checks whether the request matches all the conditions in the statement. If any condition fails, the entire statement doesn't apply.

It's worth noting that multiple conditions within the same operator are treated with OR logic, while multiple operators are treated with AND logic. So if you have `IpAddress` and `StringEquals` operators in the same condition block, both must be satisfied. But if you have multiple values under a single operator, only one needs to match.

### Common Condition Keys and Their Use Cases

AWS provides dozens of condition keys, but a few appear frequently in real-world policies. Let's explore the most practical ones.

#### aws:SourceIp — Restricting by Network Location

The `aws:SourceIp` condition key allows you to restrict API calls based on the IP address or CIDR range from which the request originates. This is one of the most straightforward ways to enforce network-level access controls.

Imagine you have a Lambda function that processes sensitive financial data, and you want to ensure it can only be invoked from your application servers within a specific subnet. Here's how you'd enforce that:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Service": "lambda.amazonaws.com"
      },
      "Action": "sts:AssumeRole",
      "Condition": {
        "IpAddress": {
          "aws:SourceIp": ["10.0.1.0/24", "10.0.2.0/24"]
        }
      }
    }
  ]
}
```

One important caveat: when requests go through a proxy, load balancer, or NAT gateway, `aws:SourceIp` reflects the IP of that intermediary, not the original client. In VPC-only services like RDS or DynamoDB accessed from within a VPC, the condition might not work as expected because there's no traditional "source IP" in the same sense. For those cases, you'll want to consider VPC endpoints and security groups instead.

#### aws:MultiFactorAuthPresent — Enforcing MFA

Multi-factor authentication is a cornerstone of AWS security, and you can enforce its use directly in your policies using the `aws:MultiFactorAuthPresent` condition key. This is particularly powerful for sensitive operations like deleting resources or modifying security settings.

Here's a practical example: allow developers to manage EC2 instances, but require MFA for any termination:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "ec2:DescribeInstances",
        "ec2:StartInstances",
        "ec2:StopInstances"
      ],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": "ec2:TerminateInstances",
      "Resource": "*",
      "Condition": {
        "Bool": {
          "aws:MultiFactorAuthPresent": "true"
        }
      }
    }
  ]
}
```

This policy accomplishes something important: it acknowledges that terminating instances is dangerous and warrants additional authentication, while routine management tasks don't create the same risk. The `Bool` operator is used here because `aws:MultiFactorAuthPresent` is a boolean value.

One thing to keep in mind: MFA presence is only applicable to certain request types. Temporary security credentials obtained through STS (Security Token Service) can include MFA information, but if you're using long-lived access keys, the `aws:MultiFactorAuthPresent` condition won't work—those credentials inherently don't have MFA context. This is actually a good design forcing function; it encourages you to use temporary credentials and federated identity.

#### aws:RequestTag and aws:ResourceTag — Tag-Based Access Control

Tags are metadata you attach to AWS resources, and AWS lets you use tags as condition keys. This opens up powerful, dynamic access control patterns without hardcoding resource ARNs.

The `aws:ResourceTag` condition key checks tags on the *target* resource, while `aws:RequestTag` checks tags in the *request itself* (useful for controlling tag application). Both are invaluable for scaling access control as your infrastructure grows.

Here's a scenario: you run a multi-tenant SaaS application where each customer is represented by a tag called `Customer`. You want teams to be able to access resources tagged with their customer ID:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:PutObject"
      ],
      "Resource": "arn:aws:s3:::my-data-bucket/*",
      "Condition": {
        "StringEquals": {
          "aws:ResourceTag/Customer": "${aws:username}"
        }
      }
    }
  ]
}
```

Wait—notice the `${aws:username}` syntax? That's policy variable substitution. When you use variables like this, AWS replaces them at evaluation time. So if the username is "alice," AWS checks if the resource has a tag `Customer: alice`. This makes your policies remarkably flexible and scalable. You can use similar variables for principal name, source account, and other request properties.

The `s3:prefix` condition key is worth mentioning separately because it's S3-specific and doesn't quite fit the tag pattern, though it's equally powerful. It restricts access to objects within specific S3 key prefixes, giving you fine-grained object-level access:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:PutObject"
      ],
      "Resource": "arn:aws:s3:::my-bucket/*",
      "Condition": {
        "StringLike": {
          "s3:prefix": ["documents/team-a/*"]
        }
      }
    }
  ]
}
```

This allows access only to objects under `documents/team-a/`. It's a clean way to implement folder-like isolation in S3 without creating separate buckets.

### Condition Operators — The Comparison Functions

Now let's explore the operators themselves—these are the mechanisms that compare request data against your specified values.

#### StringEquals and StringLike

`StringEquals` performs exact string matching. It's case-sensitive and doesn't support wildcards, making it ideal when you need precision. `StringLike` is its more flexible cousin; it supports wildcards (`*` and `?`), making it perfect for patterns.

Here's when you'd use each. If you want to allow access only to a specific service principal, `StringEquals` makes sense:

```json
{
  "Effect": "Allow",
  "Action": "sts:AssumeRole",
  "Principal": {
    "Service": "ec2.amazonaws.com"
  },
  "Condition": {
    "StringEquals": {
      "sts:ExternalId": "my-unique-external-id-value"
    }
  }
}
```

But if you're matching S3 bucket names where you have dozens of buckets following a naming pattern, `StringLike` is cleaner:

```json
{
  "Effect": "Allow",
  "Action": "s3:ListBucket",
  "Resource": "arn:aws:s3:::*",
  "Condition": {
    "StringLike": {
      "s3:prefix": ["logs-*/current/*"]
    }
  }
}
```

#### IpAddress and NotIpAddress

`IpAddress` evaluates whether a request originates from an IP address or CIDR range. `NotIpAddress` is the inverse. These are used with the `aws:SourceIp` condition key, and they support both IPv4 and IPv6 CIDR notation.

Here's a practical pattern: allow access from the office network, but deny from a specific problematic IP:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "dynamodb:Query",
      "Resource": "arn:aws:dynamodb:*:*:table/Users",
      "Condition": {
        "IpAddress": {
          "aws:SourceIp": ["203.0.113.0/24"]
        }
      }
    },
    {
      "Effect": "Deny",
      "Action": "dynamodb:Query",
      "Resource": "arn:aws:dynamodb:*:*:table/Users",
      "Condition": {
        "IpAddress": {
          "aws:SourceIp": "203.0.113.50"
        }
      }
    }
  ]
}
```

Remember that explicit `Deny` statements always override `Allow` statements, so the second statement ensures that even if someone is in the allowed CIDR range, they're blocked if they're from that specific IP.

#### Bool

The `Bool` operator checks boolean condition keys like `aws:MultiFactorAuthPresent`, `aws:SecureTransport`, and others. It only accepts `true` or `false` as values.

Here's a comprehensive security example that requires HTTPS and MFA:

```json
{
  "Effect": "Allow",
  "Action": "iam:UpdateUserPassword",
  "Resource": "arn:aws:iam::ACCOUNT-ID:user/${aws:username}",
  "Condition": {
    "Bool": {
      "aws:MultiFactorAuthPresent": "true",
      "aws:SecureTransport": "true"
    }
  }
}
```

Both conditions must be true; the request must use HTTPS (that's what `aws:SecureTransport` checks) and MFA must be present.

#### DateGreaterThan, DateLessThan, DateGreaterThanEquals, DateLessThanEquals

Time-based conditions are invaluable for temporary access. AWS uses ISO 8601 format for these operators.

Suppose you're granting a third-party vendor temporary access to audit logs:

```json
{
  "Effect": "Allow",
  "Action": [
    "cloudtrail:LookupEvents",
    "cloudtrail:GetTrailStatus"
  ],
  "Resource": "*",
  "Condition": {
    "DateGreaterThanEquals": {
      "aws:CurrentTime": "2024-01-01T00:00:00Z"
    },
    "DateLessThanEquals": {
      "aws:CurrentTime": "2024-01-31T23:59:59Z"
    }
  }
}
```

This grants access only during January 2024. At the stroke of midnight on February 1st, the policy automatically stops applying. No need to manually revoke the credential.

#### NumericEquals, NumericGreaterThan, and Numeric Comparisons

These operators work with numeric values. They're less common than string or IP-based conditions, but they appear in policies checking API quotas or usage limits.

```json
{
  "Effect": "Allow",
  "Action": "autoscaling:SetDesiredCapacity",
  "Resource": "*",
  "Condition": {
    "NumericLessThanEquals": {
      "autoscaling:MaxSize": "10"
    }
  }
}
```

This prevents someone from scaling a group beyond 10 instances, enforcing your cost controls at the policy level.

### Real-World Policy Examples

Let's bring this together with some practical, full-featured policies you might actually use.

#### Example 1: Restricted S3 Access with Multiple Conditions

Here's a policy for a data analyst who needs to access customer data in S3, but only from the office during business hours and only if they've authenticated with MFA:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowAnalysisDataAccess",
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:ListBucket"
      ],
      "Resource": [
        "arn:aws:s3:::analysis-data",
        "arn:aws:s3:::analysis-data/*"
      ],
      "Condition": {
        "IpAddress": {
          "aws:SourceIp": ["203.0.113.0/24"]
        },
        "Bool": {
          "aws:MultiFactorAuthPresent": "true"
        },
        "DateGreaterThanEquals": {
          "aws:CurrentTime": "2024-01-01T09:00:00Z"
        },
        "DateLessThanEquals": {
          "aws:CurrentTime": "2024-01-01T17:00:00Z"
        }
      }
    }
  ]
}
```

Note that the date conditions in my example use specific dates, but in practice you'd use a policy management tool or update the policy periodically. Some teams write policies that check the day of week using string conditions on `aws:CurrentTime` formatted appropriately, though that's more complex.

#### Example 2: Tag-Based Environment Isolation

This policy allows an application service to access only resources tagged with its environment:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowEnvironmentResources",
      "Effect": "Allow",
      "Action": [
        "ec2:DescribeInstances",
        "ec2:DescribeVolumes",
        "rds:DescribeDBInstances"
      ],
      "Resource": "*",
      "Condition": {
        "StringEquals": {
          "aws:ResourceTag/Environment": "production"
        }
      }
    },
    {
      "Sid": "DenyProductionFromDev",
      "Effect": "Deny",
      "Action": "*",
      "Resource": "*",
      "Condition": {
        "StringEquals": {
          "aws:ResourceTag/Environment": "production"
        }
      }
    }
  ]
}
```

Wait, that second statement isn't quite right—it would deny everything to everyone if they have production tags. A better pattern is to deny specific actions or to use this in a way that prevents accidental access:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowDevAccess",
      "Effect": "Allow",
      "Action": [
        "ec2:DescribeInstances",
        "ec2:StartInstances",
        "ec2:StopInstances"
      ],
      "Resource": "*",
      "Condition": {
        "StringEquals": {
          "aws:ResourceTag/Environment": "dev"
        }
      }
    },
    {
      "Sid": "DenyTerminationUnlessMFA",
      "Effect": "Deny",
      "Action": "ec2:TerminateInstances",
      "Resource": "*",
      "Condition": {
        "StringEquals": {
          "aws:ResourceTag/Environment": "dev"
        },
        "Bool": {
          "aws:MultiFactorAuthPresent": "false"
        }
      }
    }
  ]
}
```

This grants broad dev environment access but explicitly denies termination unless MFA is present. It's a safety net.

#### Example 3: Database Access with Variable Substitution

Here's a pattern for allowing database access scoped to a user's department:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowRDSConnect",
      "Effect": "Allow",
      "Action": [
        "rds:DescribeDBInstances",
        "rds-db:connect"
      ],
      "Resource": "arn:aws:rds:*:ACCOUNT-ID:db/*",
      "Condition": {
        "StringEquals": {
          "aws:ResourceTag/Department": "${aws:PrincipalTag/Department}"
        }
      }
    }
  ]
}
```

This uses variable substitution on both sides: `${aws:PrincipalTag/Department}` retrieves the department tag from the IAM user or role, and `aws:ResourceTag/Department` checks the target database's tag. They must match. As your organization grows, you don't need to rewrite this policy for each department; it scales automatically.

### Testing and Debugging Conditions

One challenge with conditions is that they can be subtle to debug. If a policy with conditions doesn't work as expected, the issue might be in how AWS interprets the condition, not in the policy logic itself.

The IAM Policy Simulator is your friend here. You can construct a policy with conditions, simulate a request with specific context values, and immediately see whether the condition evaluates to true or false. This is invaluable during development.

Additionally, CloudTrail logs every AWS API call and includes the evaluated condition context. If a request was denied due to conditions, you can examine the CloudTrail event to understand exactly what values were evaluated.

When writing conditions, be explicit about your expectations. Use meaningful SIDs (statement IDs) in your policies so that if something is denied, the error message or logs make clear which statement was the culprit. Conditions are powerful, but they're also silent by default—they don't trigger errors or warnings, they simply cause a policy to not apply.

### Common Gotchas and Best Practices

There are a few things that trip up developers working with conditions.

First, remember that condition keys are context-dependent. `aws:SourceIp` makes sense for API calls, but some AWS services don't provide source IP information in the same way. Always verify that the condition key you're using is actually populated for your use case. AWS documentation lists which services support which condition keys.

Second, be careful with the logic of combining conditions. If you have two values under the same operator, they're ORed together. If you have two different operators, they're ANDed. Sometimes what seems logical syntactically doesn't match your security intent.

Third, tag-based conditions are incredibly powerful but introduce operational overhead. Someone needs to tag resources consistently. A mistagged resource won't be protected by your tag-based conditions. Consider using resource policies in addition to identity policies to create defense in depth.

Fourth, understand that some condition keys are only available for certain principal types or request types. For instance, `aws:MultiFactorAuthPresent` is relevant for human users but not for services or cross-account roles without MFA context. Read the fine print in AWS documentation.

Finally, always test your conditions before deploying them to production. A condition that's too restrictive will lock out legitimate users and cause operational headaches. Use the Policy Simulator, or better yet, deploy to a non-production environment first and have test users validate that access works as intended.

### Conclusion

IAM policy conditions are where policy design transitions from binary (allowed or denied) to nuanced (allowed under these circumstances). By mastering condition keys like `aws:SourceIp`, `aws:MultiFactorAuthPresent`, and tag-based conditions, combined with operators like `IpAddress`, `Bool`, `StringEquals`, and date comparisons, you gain the ability to express security requirements that are both strict and practical.

The real power emerges when you stop thinking of IAM policies as static access lists and start thinking of them as dynamic rules that respond to context. A developer on the VPN at 3 AM on Sunday might be blocked by the same policy that allows them during the day from the office. A resource with the wrong environment tag might be denied even if the user has broad permissions. This contextual thinking is what separates a good access control strategy from a brittle one.

As you build on AWS, spend time experimenting with conditions in your own policies. Use the Policy Simulator to verify your logic. Start simple—maybe just an IP-based restriction—and gradually add complexity as you become comfortable. Over time, you'll develop an intuition for when a condition is the right tool versus when you need to solve the problem at a different layer, like with VPC security groups or resource policies.
