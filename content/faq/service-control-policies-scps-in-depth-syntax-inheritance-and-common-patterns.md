---
title: "Service Control Policies (SCPs) in Depth: Syntax, Inheritance, and Common Patterns"
---

## Service Control Policies (SCPs) in Depth: Syntax, Inheritance, and Common Patterns

Service Control Policies represent one of the most powerful yet frequently misunderstood tools in the AWS ecosystem. If you manage multiple AWS accounts—whether through AWS Organizations or simply juggle several accounts across teams—SCPs are your first line of defense for enforcing organizational standards and preventing unauthorized actions at scale. Unlike IAM policies, which explicitly grant permissions, SCPs operate as permission boundaries that filter what actions are *allowed* across your entire account structure. Understanding how to write them, how they cascade through your organizational hierarchy, and how they interact with other permission mechanisms is essential for any developer or architect operating in a multi-account environment.

### Understanding the Fundamentals: What SCPs Actually Are

Let's start by clearing up a common misconception. Service Control Policies are *not* permission-granting mechanisms. They don't say "do this"—they say "don't exceed these limits." Think of an SCP as a master whitelist or blacklist that sits above all your IAM policies. Even if an IAM policy explicitly grants you permission to perform an action, an SCP can still block you.

This is a crucial distinction because it changes how you think about permission models. In a traditional single-account AWS environment, you're accustomed to the idea that if an IAM policy grants you permission and nothing denies you, you can perform an action. SCPs introduce a new layer: even with a permissive IAM policy, you cannot exceed the boundaries defined by your SCPs.

SCPs only exist within AWS Organizations, and they operate at the account or organizational unit (OU) level. They apply to all IAM principals—users, roles, and root user—within the accounts they target, with one critical exception: the management account (formerly called the master account) is completely exempt from SCP restrictions. This means if you're trying to enforce organization-wide standards, you cannot use SCPs to restrict the management account itself.

### The JSON Structure: Why SCPs Look Like IAM Policies

If you've written an IAM policy before, an SCP will look immediately familiar. The syntax is nearly identical—it's valid JSON with principals, actions, resources, conditions, and effects. Here's why: AWS realized early on that developers already understand IAM policy syntax, so SCPs leverage that same structure. However, the semantics are different in subtle but important ways.

A basic SCP structure looks like this:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "*",
      "Resource": "*"
    }
  ]
}
```

This is the `FullAWSAccess` policy, which is the default SCP attached to all new OUs and accounts when you enable SCPs. It's effectively a "do nothing" policy because it doesn't restrict anything—all actions are allowed. When you attach an additional SCP to an OU or account, it works in conjunction with `FullAWSAccess` and any other SCPs in the inheritance chain.

Here's where the logic gets interesting. SCPs use a specific evaluation pattern:

1. Start with all possible AWS actions blocked.
2. Any "Allow" statement in any applicable SCP unblocks actions.
3. Any "Deny" statement in any applicable SCP blocks actions (overriding any allows).

This means if you have multiple SCPs attached to an account, *all* of them must allow an action for it to be permissible. A single deny statement will prevent an action, period.

### Inheritance Down the OU Tree

One of the most elegant aspects of SCPs is how they cascade through your organizational hierarchy. When you organize your accounts into organizational units, SCPs attached at higher levels in the tree apply to all accounts beneath them.

Imagine you structure your AWS Organizations like this:

```
Root
├── Production (OU)
│   ├── Account A (payment processing)
│   ├── Account B (customer database)
├── Development (OU)
│   ├── Account C
│   ├── Account D
├── Sandbox (OU)
    └── Account E
```

If you attach an SCP to the Production OU that restricts certain actions, it applies to Account A and Account B. If you attach a different SCP to the Root level, it applies to *all* accounts in the organization. SCPs attached lower in the tree are more restrictive—they combine with parent-level SCPs.

Here's the critical concept: when evaluating whether an action is allowed, AWS considers *all* SCPs in the path from the account up to the root. If any of them deny the action, it's denied. If all of them allow it, and if the IAM policy also allows it, then the action is permitted.

Let me illustrate with a concrete example. Suppose you have this hierarchy and these policies:

- **Root SCP**: Allows everything (FullAWSAccess)
- **Production OU SCP**: Denies all except EC2, RDS, and S3 actions
- **Account A** (under Production): No account-level SCP

A user in Account A wanting to launch an EC2 instance would encounter this evaluation:
1. Root SCP: Allows EC2 actions ✓
2. Production OU SCP: Allows EC2 actions ✓
3. IAM policy for the user: Needs to grant EC2 permissions
4. Result: Action is allowed

The same user trying to create an IAM role would see:
1. Root SCP: Allows IAM actions ✓
2. Production OU SCP: Does NOT allow IAM actions ✗
3. Result: Action is denied at the SCP level, regardless of IAM policy

This inheritance model is powerful because it allows you to set broad restrictions at the organizational level while permitting more specific exceptions at lower levels.

### Allow List vs. Deny List Strategies

There are two fundamentally different approaches to writing SCPs: allow lists and deny lists. Your choice depends on your organizational posture and risk tolerance.

**Deny list strategy** is more permissive by default. You start with `FullAWSAccess` and attach additional SCPs that explicitly deny problematic actions. For example, you might deny access to certain AWS services, regions, or actions that pose compliance or cost risks. This approach is easier to implement initially because you're not restricting everything by default—you're only blocking specific things.

A deny list SCP might look like:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Deny",
      "Action": [
        "iam:DeleteRole",
        "iam:DeleteUser"
      ],
      "Resource": "*"
    }
  ]
}
```

This policy doesn't explicitly allow anything; it just says "users in this account cannot delete IAM roles or users." Combined with the default `FullAWSAccess`, all other actions remain available.

**Allow list strategy** is more restrictive and security-conscious. You replace `FullAWSAccess` with a policy that explicitly lists what actions *are* allowed, implicitly denying everything else. This requires more upfront planning but provides stronger guardrails.

An allow list SCP might look like:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "ec2:*",
        "s3:*",
        "rds:*"
      ],
      "Resource": "*"
    }
  ]
}
```

This policy explicitly permits EC2, S3, and RDS actions while denying everything else. Organizations using this strategy typically maintain a curated list of allowed services based on their business requirements.

The choice between these strategies affects your entire governance model. Deny lists are forgiving and easier to troubleshoot (when something breaks, you add an exception). Allow lists are restrictive and require discipline but provide better visibility into what your organization actually uses.

### The Default FullAWSAccess Policy

When you enable SCPs in your organization, every OU and account gets a default SCP called `FullAWSAccess`. This policy is essentially a no-op:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "*",
      "Resource": "*"
    }
  ]
}
```

It allows everything, which is why when you first enable SCPs, no existing permissions change. You can't delete this policy, but you *can* replace it by attaching a different SCP and removing `FullAWSAccess`.

The existence of `FullAWSAccess` by default reflects AWS's conservative design philosophy: new features don't break existing setups. However, it also means you must be intentional about governance. SCPs are opt-in controls that require you to actively restrict what you want restricted.

### Common Patterns and Practical Examples

Let's move from theory to practice. Here are several concrete SCP patterns you'll find useful across different organizational scenarios.

#### Restricting AWS Regions

One of the most common use cases for SCPs is enforcing that resources are only created in approved regions. This might be driven by compliance requirements, cost optimization, or data residency mandates.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Deny",
      "Action": "*",
      "Resource": "*",
      "Condition": {
        "StringNotEquals": {
          "aws:RequestedRegion": [
            "us-east-1",
            "us-west-2",
            "eu-west-1"
          ]
        }
      }
    }
  ]
}
```

This policy denies all actions in regions *other than* the three specified. Any attempt to launch an EC2 instance in `ap-southeast-1`, for example, would fail with a policy violation. Note that some AWS services (like IAM, CloudFront, and Organizations) are global and don't respect region restrictions, so this policy won't affect them.

#### Blocking Specific Services

You might want to prevent certain expensive or risky services from being used. For instance, you could block SageMaker to prevent unexpected ML costs in development environments:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Deny",
      "Action": "sagemaker:*",
      "Resource": "*"
    }
  ]
}
```

#### Preventing Root User Actions

The root user in an AWS account has unrestricted permissions. Many organizations want to ensure the root user isn't used for everyday tasks. You can prevent this with an SCP:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Deny",
      "Action": "*",
      "Resource": "*",
      "Condition": {
        "StringLike": {
          "aws:PrincipalArn": "arn:aws:iam::*:root"
        }
      }
    }
  ]
}
```

This denies all actions when the principal is the root user. Note that root users can still use the console to log in and change account settings, but they cannot perform service API calls.

#### Requiring Encryption

You can mandate that certain resources be created only with encryption enabled:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Deny",
      "Action": "s3:PutObject",
      "Resource": "*",
      "Condition": {
        "StringNotEquals": {
          "s3:x-amz-server-side-encryption": "AES256"
        }
      }
    }
  ]
}
```

This blocks putting objects into S3 unless they're encrypted with AES-256 (or you could require KMS encryption). Similarly, you can deny RDS database creation without encryption enabled.

#### Preventing Privilege Escalation

A particularly important pattern is preventing users from escalating their own privileges by creating new IAM users or roles with broad permissions:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Deny",
      "Action": [
        "iam:CreateAccessKey",
        "iam:CreateLoginProfile",
        "iam:AttachUserPolicy",
        "iam:PutUserPolicy"
      ],
      "Resource": "*"
    }
  ]
}
```

This prevents users from creating new access keys or policies for themselves, though it would require careful tuning depending on your organization's needs.

### How SCPs Interact with IAM Policies and Permission Boundaries

Understanding the policy evaluation logic is essential for predicting what will and won't be allowed in your AWS environment. SCPs operate at a different layer than IAM policies and permission boundaries, and they combine in specific ways.

Here's the evaluation flow:

1. **Organization SCPs**: Applied to the account and all parent OUs. If any deny an action, it's blocked. All must allow for action to proceed.
2. **Permission Boundaries**: If the principal has a permission boundary attached, the action must be allowed by the boundary.
3. **IAM Policies**: The identity-based policies (attached to the user or role) must explicitly allow the action.
4. **Resource-based Policies**: If the resource has a resource-based policy (like a bucket policy or trust policy), it must also allow the action if it's cross-account.

The critical insight is that *all four layers must allow the action for it to succeed*. A deny at any layer blocks the action. This is often referred to as the "deny wins" principle in AWS permissions.

To illustrate, imagine a user named Alice in Account A trying to read an S3 object in Account B. Here's what must happen:

1. The SCP attached to Account A must allow S3 read actions
2. Alice's permission boundary (if one exists) must allow S3 read actions
3. Alice's IAM policy must explicitly allow S3 read actions
4. The S3 bucket policy in Account B must allow Alice's principal to read objects

If *any* of these four components denies the action, Alice cannot read the object. This layered approach provides defense in depth, but it also means troubleshooting permission issues requires checking all four sources.

### Why the Management Account is Exempt

You might wonder why the management account isn't subject to SCPs. The answer has to do with practical system design and governance hierarchy. The management account is special in AWS Organizations—it's the account that creates and manages the organization itself. Restricting it with SCPs would create a bootstrapping problem: how would you modify SCPs if the account managing them is restricted by SCPs?

This design choice has security implications you should understand. It means the management account is essentially a privileged account and should be treated as such. Many organizations follow the practice of keeping the management account minimal—using it only for organizational management and AWS Billing—while running actual workloads in member accounts where SCPs can enforce restrictions.

### Best Practices and Common Pitfalls

Writing effective SCPs requires understanding both the power and the limitations of the tool. Here are some principles that will serve you well.

**Test before deploying to production OUs**. SCPs are powerful enough to block entire classes of operations. Create a test OU, attach experimental policies there, and verify they work as expected before rolling them out to Production or other critical OUs.

**Document your SCP strategy clearly**. Whether you're using allow lists or deny lists, whether you're restricting by region or service, document the intent behind each policy. Future maintainers (including yourself in six months) will appreciate this context.

**Remember that SCPs affect *everyone* in an account**. Unlike IAM policies, which you can scope to specific users or roles, SCPs apply broadly. Be cautious about policies that might affect automation, CI/CD pipelines, or Lambda functions that serve critical purposes.

**Use tags and conditions thoughtfully**. SCPs support IAM condition keys, including tags. You can write policies that restrict actions on resources with certain tags, allowing fine-grained control without creating many separate policies.

**Audit regularly**. SCPs are powerful enough that unauthorized removal or modification can have major consequences. Use AWS CloudTrail to log all SCP changes and periodically audit your organization's policy structure.

**Avoid overly complex policies**. While it's tempting to write a single policy that handles many restrictions, multiple simpler policies are often easier to understand, audit, and modify. Each policy should ideally address one coherent concern.

### Practical Limitations to Keep in Mind

SCPs are not a complete governance solution, and it's important to understand their boundaries. They don't apply to the management account, so if you have workloads running there, you'll need IAM policies and permission boundaries to enforce restrictions. SCPs also don't have any effect on the AWS Console root login—if someone has the root user's credentials, they can still access the account through the console, though they'll be blocked from API calls by certain SCPs (like the root user example earlier).

Additionally, some AWS services provide limited support for condition keys, meaning certain restrictions are difficult or impossible to enforce with SCPs. For example, some global services don't respect region conditions. Always test your assumptions before deploying policies that depend on specific condition key support.

Finally, SCPs apply based on where API calls originate, not where resources are created. This distinction matters for services like CloudFormation or Terraform, where a central deployment account might make API calls on behalf of other accounts. The SCP evaluation happens in the account where the API call lands, not where it originated.

### Conclusion

Service Control Policies represent a fundamental shift in how you think about permissions at scale. Rather than granting permissions to millions of users and roles individually, SCPs let you enforce organizational standards across entire account hierarchies. The JSON syntax you're already familiar with from IAM policies masks a fundamentally different operational model—one based on filters and boundaries rather than grants.

As you design your organization's permission structure, remember that SCPs work best when combined with a clear strategy: decide whether you're using allow lists or deny lists, document your organizational structure and the restrictions that apply at each level, and test policies thoroughly before deployment. The management account's exemption, the inheritance model through OUs, and the layering with IAM policies and permission boundaries all contribute to a flexible but potentially complex permission evaluation flow.

With this understanding, you're equipped to use SCPs not just as a compliance checkbox, but as a powerful tool for scaling governance across your AWS infrastructure. The effort you invest in getting SCPs right pays dividends across your entire organization.
