---
title: "IAM Permission Boundaries Explained"
---

## IAM Permission Boundaries Explained

When you start delegating AWS administration tasks to other teams or building self-service platforms, you quickly run into a problem: how do you let someone create and manage IAM identities without giving them access to everything? Permission boundaries exist to solve exactly this problem, yet they're often misunderstood or overlooked entirely. They sit in an interesting place in AWS's permission model—powerful but subtle—and understanding them transforms how you think about least privilege at scale.

### Understanding Permission Boundaries at a Glance

A permission boundary is a managed policy that sets the maximum permissions an IAM identity can have. Unlike a regular identity-based policy that grants permissions, a boundary restricts them. Think of it as a ceiling rather than a floor: the actual permissions your user or role can exercise are determined by the intersection of their identity-based policies and their permission boundary.

This distinction matters because it means a permission boundary alone grants nothing—you still need identity-based policies attached to the user or role for anything to actually happen. The boundary simply says "this is as far as you can go," regardless of what identity-based policies claim.

### How Permission Boundaries Fit Into the Bigger Picture

AWS IAM's permission evaluation logic is famously complex, but permission boundaries occupy a specific niche within it. To understand where they sit, let's recall how AWS evaluates whether an action is allowed.

AWS evaluates permissions through a hierarchical process. First, there's an explicit deny check—any explicit deny anywhere in the policy chain immediately blocks the action, and nothing else matters. Next comes the actual evaluation: AWS looks for explicit allows. For regular identity-based policies, an explicit allow from any policy attached to the user is sufficient to permit the action (barring other restrictions). Service control policies, which operate at the organization level, act as guardrails across your entire AWS organization and must also contain an explicit allow.

Permission boundaries enter this evaluation after the organization-level checks but operate differently from identity-based policies. When a permission boundary is attached to an identity, the final set of permissions is the intersection of two things: what the identity-based policies explicitly allow, and what the permission boundary explicitly allows. If an action is allowed by the identity-based policy but denied (or simply not mentioned) by the permission boundary, the action is denied.

Here's a concrete scenario: imagine you attach a permission boundary to a user that allows only Amazon EC2 and Amazon S3 actions. Then you attach an identity-based policy that allows all IAM actions and EC2 actions. What can the user actually do? Only EC2 actions. The IAM actions are blocked because they fall outside the boundary's ceiling, even though the identity-based policy explicitly grants them.

### Permission Boundaries Versus SCPs: Know the Difference

Permission boundaries and service control policies both act as restrictions, which often causes confusion. However, they operate at fundamentally different levels and serve different purposes.

Service control policies are organization-level policies that apply to entire AWS accounts or organizational units. They act as a blanket restriction across all identities within those accounts—every IAM user, role, and even the root account is subject to SCPs. You can't escape an SCP by having a more permissive identity-based policy. SCPs are the organizational guardrails; they enforce what your company will never allow across the entire AWS footprint.

Permission boundaries, by contrast, are identity-specific. They're attached to individual users or roles, not accounts. They exist to enable delegated administration—letting someone create and manage other identities without risking those new identities gaining more power than they should have. Permission boundaries are the mechanism that lets a platform team create IAM roles for application teams while ensuring those roles stay within safe boundaries.

Another key difference: SCPs affect all principals in an account, including the account's root user and administrators. Permission boundaries do not affect the root account. If you want to truly lock down what an administrator can do, you'd use an SCP. If you want to empower a delegated administrator to create users and roles without risk, you'd use permission boundaries.

### When and Why to Use Permission Boundaries

Permission boundaries shine in specific scenarios, and understanding when to apply them helps you architect more secure systems.

The primary use case is delegated administration. Imagine your organization has a central cloud platform team, but individual application teams need the ability to create IAM roles for their applications and services. Without permission boundaries, you'd have two bad options: either grant these teams broad IAM permissions (and risk them creating overly permissive roles), or maintain a bottleneck where the platform team handles every role request. Permission boundaries solve this by letting you grant teams the ability to create and manage roles, bounded by a defined ceiling.

Another scenario is self-service in multi-tenant platforms. If you're building a service that provisions AWS resources for customers or internal teams, permission boundaries let you ensure that whatever roles the service creates can't exceed certain limits. A customer might create a database-reading role, but you can guarantee through the boundary that it can never access other customers' data or modify security settings.

Permission boundaries also provide an additional layer of defense against misconfiguration. Even if someone creates an overly permissive identity-based policy by mistake, the permission boundary acts as a safety net. This is less critical than other controls but useful in high-risk environments where human error is a concern.

There are, however, scenarios where permission boundaries don't help. If you're trying to prevent a human administrator from doing something risky across your entire organization, use SCPs instead—they apply to all identities including admins. If you're trying to prevent someone without IAM permissions from accessing a resource, use resource-based policies and encryption keys instead. Permission boundaries only matter to people who can create or modify IAM identities, which is already a privileged operation.

### Crafting Permission Boundaries in Practice

Let's move from theory to implementation. Creating an effective permission boundary means thinking carefully about what ceiling you want to enforce.

The most straightforward approach is to use an existing AWS managed policy as your boundary. AWS provides policies like `PowerUserAccess`, which grants most permissions but excludes IAM, billing, and some security-sensitive actions. Using a managed policy simplifies maintenance—when AWS updates the policy, you benefit automatically.

Here's what that might look like in practice. Suppose you're granting a platform engineering team the ability to create application roles. You might use the `PowerUserAccess` managed policy as their permission boundary:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "iam:CreateRole",
        "iam:PutRolePolicy",
        "iam:AttachRolePolicy",
        "iam:DetachRolePolicy",
        "iam:DeleteRolePolicy",
        "iam:GetRole",
        "iam:ListRolePolicies"
      ],
      "Resource": "arn:aws:iam::123456789012:role/app-*"
    }
  ]
}
```

This is an identity-based policy that lets the team manage roles matching the `app-*` naming pattern. Now you'd attach `PowerUserAccess` as a permission boundary to this team's user or role. The result: they can create and manage application roles using services allowed by PowerUserAccess, but they can't modify security-critical resources like KMS keys, access other roles outside the `app-*` namespace, or escalate their own permissions.

Custom permission boundaries are necessary when you need more specific control. Let's say you're building a multi-tenant SaaS platform where each customer gets their own set of resources within a single AWS account. You might create a custom boundary that allows only actions on resources tagged with the customer's specific tag:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "ec2:*",
        "s3:*",
        "dynamodb:*",
        "lambda:*",
        "logs:*"
      ],
      "Resource": "*",
      "Condition": {
        "StringEquals": {
          "aws:RequestTag/Customer": "acme-corp"
        }
      }
    },
    {
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:ListBucket"
      ],
      "Resource": [
        "arn:aws:s3:::shared-config-bucket",
        "arn:aws:s3:::shared-config-bucket/*"
      ]
    }
  ]
}
```

This boundary allows the identity to work with services like EC2, S3, DynamoDB, and Lambda, but only on resources tagged for the specific customer. It additionally allows read-only access to a shared configuration bucket. Any identity with this boundary as their maximum ceiling cannot access resources from other customers, even if their identity-based policies explicitly grant such access.

### Permission Boundaries in Action: Concrete Examples

Understanding permission boundaries is easier when you see them interact with real policies. Let's walk through several scenarios.

**Scenario One: Boundary as a Safety Net**

You have a user, `alice`, who is a developer on the platform team. Her identity-based policy grants her EC2 and S3 full access:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "ec2:*",
        "s3:*"
      ],
      "Resource": "*"
    }
  ]
}
```

Her permission boundary is attached and allows only EC2 and RDS actions:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "ec2:*",
        "rds:*"
      ],
      "Resource": "*"
    }
  ]
}
```

What can Alice actually do? She can perform any EC2 action (allowed by both her identity policy and boundary) and any RDS action (allowed by her boundary, even though her identity policy doesn't grant it). She cannot perform S3 actions—her identity policy grants this, but the boundary doesn't, so the intersection is empty for S3.

**Scenario Two: Delegated Administration**

You have a role, `DelegatedAdminRole`, that a platform team assumes. Its identity-based policy allows creating and managing IAM roles, but only those matching a specific naming pattern:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "iam:CreateRole",
        "iam:PutRolePolicy",
        "iam:AttachRolePolicy",
        "iam:GetRole",
        "iam:ListRolePolicies"
      ],
      "Resource": "arn:aws:iam::123456789012:role/workload-*"
    }
  ]
}
```

The permission boundary is a custom policy that allows only read-only IAM actions plus specific service permissions:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "iam:GetRole",
        "iam:ListRolePolicies",
        "iam:GetRolePolicy"
      ],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "ec2:*",
        "s3:*",
        "lambda:*"
      ],
      "Resource": "*"
    }
  ]
}
```

The result is interesting: the platform team can read role information (allowed by both), but they cannot actually create or modify roles, because `CreateRole`, `PutRolePolicy`, and `AttachRolePolicy` are not in the boundary. This particular scenario demonstrates why you'd rarely set things up this way—you'd want to include the IAM actions they need in the boundary.

A more realistic version would include those IAM actions in the boundary, allowing the team to create workload roles but preventing them from creating roles outside the naming pattern or escalating their own permissions through IAM modifications:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "iam:CreateRole",
        "iam:PutRolePolicy",
        "iam:AttachRolePolicy",
        "iam:DetachRolePolicy",
        "iam:DeleteRolePolicy",
        "iam:GetRole",
        "iam:ListRolePolicies",
        "iam:ListAttachedRolePolicies"
      ],
      "Resource": "arn:aws:iam::123456789012:role/workload-*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "ec2:*",
        "s3:*",
        "lambda:*"
      ],
      "Resource": "*"
    }
  ]
}
```

Now they can create and manage workload roles, and they can work with EC2, S3, and Lambda services, but they're bounded by the role naming pattern and can't manipulate other roles or modify IAM settings outside their scope.

### Practical Considerations When Implementing Permission Boundaries

Implementing permission boundaries effectively requires attention to several practical details.

Testing is crucial. Permission boundaries have a non-obvious interaction with identity-based policies that often catches people off guard. Before deploying a permission boundary to production, test it thoroughly. Create a test user or role, attach the identity-based policies you expect to use, attach the boundary, and verify that the intersection of permissions is what you actually want. Use the IAM policy simulator or temporary test credentials to validate behavior.

Naming and documentation matter more than you might think. If you're creating custom permission boundaries, choose names that clearly communicate their purpose. A boundary named `PlatformTeamBoundary` is more useful than `Boundary1`. Document which boundaries are in use, what they restrict, and why those restrictions exist. This helps future maintainers understand the security architecture.

Permission boundaries don't automatically prevent all privilege escalation risks. Someone with permission to modify IAM policies (including the boundary itself) could remove the boundary or modify it to increase permissions. If this is a concern, use SCPs to prevent modification of permission boundaries, or ensure that only highly privileged, audited processes can modify them.

When using permission boundaries with AWS managed policies, be aware that AWS occasionally updates managed policies. If you're using a managed policy as a boundary and AWS adds new permissions to it, those new permissions become available to identities under that boundary. For critical security boundaries, you might prefer customer-managed policies where you have explicit control over updates, even though they require more maintenance.

Consider how permission boundaries interact with cross-account access. Permission boundaries apply to the local account; they don't restrict what a role from another account can do when assuming your role. If you're concerned about cross-account security, you'd primarily use resource-based policies and SCPs rather than relying on permission boundaries.

### Permission Boundaries and the Principle of Least Privilege

Permission boundaries align well with least privilege, but they're not a substitute for it. Least privilege means granting the minimum permissions necessary to perform a job. Permission boundaries provide a guardrail that prevents exceeding a defined maximum, but they don't automatically enforce least privilege within that boundary.

A well-designed permission boundary sets a reasonable upper limit based on the role's purpose. If you're creating a boundary for application developers, you might allow EC2, S3, CloudWatch, and CloudFormation actions, but exclude IAM, KMS, and security services. This boundary defines the "developer ceiling." Within that ceiling, individual developers' identity-based policies should grant only what they specifically need.

The combination of a sensible permission boundary and carefully scoped identity-based policies creates a powerful least-privilege system. The boundary prevents categories of actions entirely, while the identity-based policy prevents specific actions or resources within allowed categories.

### Comparing Permission Boundaries to Other AWS Security Controls

It helps to understand permission boundaries in relation to other AWS mechanisms that also affect what actions are allowed.

Resource-based policies let individual resources define who can access them and what they can do. An S3 bucket can have a policy that only allows access from specific IAM principals. Resource-based policies are evaluated independently—they don't interact with permission boundaries or identity-based policies. If an action is allowed by a resource policy, it's allowed, regardless of permission boundaries. Conversely, if a resource policy denies an action, the action is denied even if identity-based policies and permission boundaries allow it.

Session policies are temporary restrictions applied when assuming a role via STS (Security Token Service). They're similar to permission boundaries in that they limit the maximum permissions for a temporary session, but they apply to the session itself rather than the role permanently. Session policies are useful for temporary delegation, like giving a third party temporary access to investigate an issue.

Tags and attribute-based access control (ABAC) let you make authorization decisions based on resource or principal tags. While not a restriction mechanism like permission boundaries, ABAC provides fine-grained control that often complements permission boundaries. For example, a permission boundary might allow all EC2 actions, but ABAC policies on EC2 instances could restrict to only instances tagged for a specific team.

### Designing Permission Boundaries for Your Organization

When you're setting up permission boundaries for your organization, think about your organizational structure and delegation model.

Start by identifying which roles need delegated administration capabilities. These are your primary candidates for permission boundaries. A platform team that creates application roles, a security team that manages audit and logging, or a cost optimization team that manages resource cleanup are all good candidates.

For each of these roles, determine what actions they legitimately need to perform and which actions they should never be able to perform. Actions they should never perform often fall into security-sensitive categories: modifications to IAM users and roles outside their scope, changes to organization structure, modifications to security services like GuardDuty or Security Hub, or changes to billing and cost allocation.

Create a permission boundary that encompasses the legitimate actions. Err on the side of being more restrictive rather than less—it's easier to expand a boundary later if needed than to deal with a security incident from an over-permissive boundary. Use AWS managed policies where they align with your needs; create custom managed policies when you need more specific control.

Document your boundaries and maintain them as your organization evolves. As new teams form or responsibilities shift, review and update permission boundaries accordingly.

### Common Mistakes to Avoid

Several mistakes commonly trip up teams implementing permission boundaries.

**Forgetting that boundaries require identity-based policies.** A permission boundary alone grants nothing. If you attach a boundary to a user but no identity-based policies, the user has no permissions. You must attach both the identity-based policy and the boundary.

**Confusing boundary intersection with denial logic.** A permission boundary isn't a deny policy; it's a maximum ceiling. If an action is allowed by the identity-based policy but not mentioned in the boundary, it's denied. But if an action is mentioned in both, it's allowed. This is conjunction, not the more complex logic of deny statements.

**Applying boundaries as a primary security control instead of a defense-in-depth layer.** Permission boundaries are excellent as one layer of security, but they're not sufficient alone. Combine them with identity-based policies, SCPs, resource-based policies, and monitoring to create defense in depth.

**Setting boundaries that are too permissive.** If your boundary allows `*:*` on all resources, it provides no actual restriction. Conversely, boundaries that are too restrictive will frustrate teams and lead to requests for escalation. Find the right balance based on actual job functions.

**Neglecting to test permission boundaries before deploying to production.** The interaction of boundaries with identity-based policies can be subtle. Always test thoroughly in a development or staging environment first.

### Conclusion

Permission boundaries are a focused but powerful tool in AWS's identity and access management arsenal. They enable you to safely delegate administration by setting explicit ceilings on what identities can do, while still allowing fine-grained control through identity-based policies. Unlike service control policies, which operate at the organizational level, permission boundaries work at the individual identity level, making them ideal for delegated administration, multi-tenant platforms, and organizations that need to balance team autonomy with security guardrails.

The key to using permission boundaries effectively is understanding that they establish an intersection with identity-based policies, not a replacement for them. An action is allowed only if both the identity-based policy and the permission boundary explicitly allow it. Combined with careful policy design, permission boundaries help you implement least privilege at scale—letting teams do their jobs while preventing categories of actions they have no business performing.

As you design your IAM architecture, think about where delegated administration occurs in your organization. Those are your natural places to introduce permission boundaries. Start simple with AWS managed policies, test thoroughly, and document your decisions. Over time, you'll develop permission boundary patterns that work for your organization's structure, providing security and autonomy in the right measure.
