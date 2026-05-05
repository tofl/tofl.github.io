---
title: "Inline Policies vs Managed Policies: When to Use Each"
---

## Inline Policies vs Managed Policies: When to Use Each

When you're designing access control in AWS, one of the first decisions you'll face is whether to use inline policies or managed policies. This choice might seem straightforward on the surface, but the implications ripple through your infrastructure's maintainability, security posture, and operational complexity. Understanding the trade-offs between these approaches is essential for building scalable, secure AWS environments.

### Understanding the Fundamental Difference

Before diving into the comparison, let's establish what we're actually talking about. An inline policy is a one-to-one relationship between a policy and an identity—whether that identity is an IAM user, role, or group. The policy lives and dies with that identity; it's embedded directly within it. A managed policy, by contrast, is a standalone policy object that can be attached to multiple identities. Think of inline policies as custom-fitted suits made for one person, while managed policies are off-the-rack items that many people can wear.

This fundamental architectural difference cascades into nearly every operational consideration you'll face when managing permissions at scale.

### The Reusability Factor

Here's where managed policies start to shine. Imagine you're building a microservices architecture where twelve Lambda functions need identical permissions to read from a specific S3 bucket and write to CloudWatch Logs. With inline policies, you'd need to define those permissions twelve times—once for each function's execution role. If the S3 bucket name changes or you need to add a new permission, you're making twelve edits across twelve different places.

With a managed policy, you define the permissions once. Attach it to all twelve roles. When requirements change, you update the policy in one location, and the change applies everywhere it's attached. This is particularly powerful in enterprise environments where you might have dozens or hundreds of resources following similar access patterns.

That said, not every scenario requires reusability. A one-off inline policy for a developer's personal sandbox account might be perfectly appropriate. The key is recognizing when you're facing a repeatable pattern versus a genuinely unique case.

### Versioning and Rollback Capabilities

This is perhaps the most underrated advantage of managed policies. AWS maintains up to five versions of each managed policy—both AWS-managed and customer-managed. When you update a managed policy, AWS automatically creates a new version and marks it as the default. The previous four versions stick around, giving you a safety net for rollbacks.

Here's how this works in practice: You update a customer-managed policy to grant additional permissions to your deployment pipeline. Three hours later, you discover the change inadvertently opened up permissions you didn't intend. With a managed policy, you can simply roll back to the previous version with a single API call. The change is instantly reverted for all attached identities.

Inline policies offer no such luxury. There's no version history, no rollback capability. If you modify an inline policy and it causes problems, you're manually editing it again to fix it. In complex environments where policy changes are frequent and high-stakes, this lack of versioning introduces operational risk.

The versioning capability becomes even more critical when you think about compliance and audit trails. If you need to demonstrate what permissions were in effect at a specific point in time—perhaps for a security incident investigation—managed policy versions give you a clear historical record.

### Size Limits and Scalability

Both inline and managed policies have size limits, but they work differently. The maximum size for any single policy (inline or managed) is 10 KB, which sounds like plenty until you start writing complex policies with numerous resources and conditions.

Consider a policy that needs to grant access to fifty different S3 buckets with varying permissions, alongside permissions for multiple EC2, RDS, and Lambda resources, with conditional logic based on IP ranges and request tags. You could easily approach that 10 KB limit. With inline policies, you're constrained to one policy per identity—hit that limit, and you're stuck. With managed policies, you can attach multiple policies to a single identity, effectively multiplying your available "policy space."

This scalability consideration often goes unnoticed until you hit the wall, at which point you're forced into a painful refactoring exercise.

### Lifecycle Management and Organizational Control

Managed policies integrate naturally into organizational governance frameworks. You can use AWS Organizations to define permission boundaries with service control policies, set up cross-account access patterns more cleanly, and establish consistent permission structures across your environment. When policies are managed resources with defined ownership, lifecycle, and deprecation procedures, governance becomes tractable.

Inline policies, by their nature, are scattered throughout your account structure. A permission buried in a user's inline policy might be overlooked during a security audit. It's harder to establish company-wide standards when policies are distributed across hundreds of identities rather than centralized in managed policy objects.

### AWS-Managed Policies: The Special Case

AWS provides pre-built managed policies covering common use cases—roles like `AmazonS3FullAccess`, `AmazonEC2FullAccess`, and more granular options like `AmazonS3ReadOnlyAccess`. These AWS-managed policies are maintained by AWS itself, including security updates and new feature support.

Using AWS-managed policies has a significant advantage: they evolve with AWS services. When AWS adds new features to S3 or EC2, the corresponding managed policies are automatically updated to include necessary permissions. You don't need to monitor for changes or manually update your policies to maintain compatibility with new functionality.

However, AWS-managed policies are intentionally broad to accommodate most customers' needs. This breadth often violates the principle of least privilege. You might grant `AmazonEC2FullAccess` when a function only needs to describe instances. AWS-managed policies are best used as a starting point or for development and testing environments, not as your final solution for production workloads.

Customer-managed policies strike a middle ground: they offer the reusability and versioning benefits of managed policies while allowing you to define exactly the permissions you need, without the breadth of AWS-managed options.

### When to Choose Inline Policies

Despite their limitations, inline policies have legitimate use cases. If you're granting permissions unique to a single identity—perhaps a specific user needs access to a particular resource for a temporary project—an inline policy keeps all that identity's permissions in one view. You see everything about what that user can do without needing to follow attachment chains.

Inline policies also make sense in temporary environments where you're not establishing long-term patterns. Creating a temporary IAM user for contractor access or setting up a development sandbox might involve inline policies if those resources will be deleted soon anyway.

In small-scale operations or during the initial exploration phase of AWS, inline policies can actually reduce complexity. You're not premature-optimizing your permission structure; you're keeping things simple until patterns emerge.

Some teams prefer inline policies for highly specialized, context-dependent permissions that will never be reused. If a particular Lambda function needs a weird combination of permissions that nothing else will ever need, bundling those in an inline policy attached directly to that function's role keeps the permission logic colocated with its usage.

### When to Choose Managed Policies

The inverse recommendation applies: choose managed policies as your default for production environments. If you're designing infrastructure that will persist and evolve, managed policies provide the operational leverage you'll appreciate six months from now when requirements change.

Use managed policies whenever you spot a repeating permission pattern. Deploying multiple services that need similar database access? That's a managed policy. Running Lambda functions with consistent CloudWatch and XRay logging requirements? That's another managed policy. Building a permission structure that reflects your organizational roles and responsibilities? Managed policies map naturally to that structure.

Managed policies shine in environments with governance requirements. If you need audit trails, change control processes, or compliance documentation, the versioning and centralization of managed policies make those requirements achievable. When you're operating in a regulated industry or managing AWS accounts across a large organization, managed policies are the right default choice.

### Practical Patterns and Real-World Scenarios

Let's walk through how these concepts play out in actual infrastructure design. Consider an e-commerce company with a microservices architecture. They have multiple Lambda functions handling order processing, inventory management, and payment processing. Each service needs specific permissions:

Order processing Lambda needs S3 access to a specific orders bucket, DynamoDB access to an orders table, and SNS permissions to publish notifications. Rather than writing the same inline policy three times (maybe one function per environment: dev, staging, production), they create a customer-managed policy called `OrderProcessingServicePolicy` and attach it to all three functions' execution roles. When they discover they need to add SQS permissions for dead-letter queues, they update the policy once.

Now consider the payment processing Lambda. It has unique requirements: it needs AWS Secrets Manager access to retrieve payment processor credentials, permission to call a specific SNS topic, and nothing else. This is genuinely unique to one function. An inline policy is perfectly appropriate here. The permission logic is specific to this function's implementation, and versioning benefits are minimal since it won't change frequently.

For the developer team itself, they might attach an AWS-managed policy like `AmazonEC2FullAccess` to a development account but immediately realize that's too broad. They create a customer-managed policy granting EC2, VPC, and security group permissions with the constraint that developers can only modify resources tagged with `Environment: development`. This policy gets attached to all developer identities, and when onboarding new developers, you simply attach the existing policy rather than creating new inline policies.

### Permission Boundaries and Policy Delegation

Managed policies become essential when implementing permission boundaries—a maximum permission set that limits what other policies can grant. Permission boundaries can only reference managed policies, not inline policies. This is a significant architectural constraint if you're trying to implement delegated access control where team leads can manage permissions for their teams without having unrestricted access.

If you're designing a system where individual teams manage their own IAM resources, you'll almost certainly end up with managed policies at the core of your permission structure. Inline policies would make it nearly impossible to enforce consistent guardrails.

### Migration and Deprecation Considerations

Real-world systems don't stay static. Eventually, you'll need to consolidate policies, deprecate old permission structures, or reorganize how permissions are distributed. Managed policies make this process manageable. You can deprecate an old managed policy by simply detaching it, and you'll immediately see which identities still depend on it.

With inline policies scattered throughout your account structure, deprecation becomes a search-and-destroy mission. You're likely to miss some instances, leaving orphaned permissions in place. This technical debt compounds over time.

### Size, Complexity, and the Law of Diminishing Returns

While managed policies allow you to attach multiple policies to overcome the 10 KB limit, don't take that as license to create enormous, unwieldy policies. A managed policy with 50 different resources and complex conditional logic becomes hard to maintain and reason about. Instead, follow the principle of separation of concern: create multiple smaller managed policies, each addressing a coherent set of permissions.

An identity might have three attached policies: one for compute resource access, one for data store access, and one for observability and logging. This is cleaner than a single 9.5 KB policy that covers everything. It's also easier to audit and understand what each policy is responsible for.

### Testing and Development Workflows

In development environments, inline policies can actually speed up iteration. You're experimenting, trying things out, and you don't want to maintain a library of managed policies. But the moment you're moving toward staging or production, the calculation changes. That's when you should migrate to managed policies and establish a more formal permission structure.

Some organizations use this as a practical workflow: developers create inline policies to get things working, then during the hardening phase before production deployment, those inline policies are formalized into customer-managed policies. This balances the speed of development with the governance requirements of production systems.

### The Cost Consideration

From a pure AWS billing perspective, managed policies and inline policies cost nothing—they're part of your IAM service, which is always free. However, there are indirect costs to consider. Poorly organized inline policies lead to security drift, which necessitates expensive security audits and remediation. Unversioned policies lead to incidents that require incident response resources. Scattered, hard-to-maintain permissions lead to higher operational overhead. Managed policies eliminate these indirect costs through better organization and auditability.

### Recommended Decision Framework

Here's a practical framework for making this decision in real-world scenarios:

Start by asking: Will this permission pattern be attached to multiple identities? If yes, use a managed policy—immediately. Reusing a managed policy avoids duplication and ensures consistency.

If it's unique to a single identity, ask: Will this permission set change over time in ways that might require rollback? If yes, use a managed policy. The versioning capability is worth it for any production workload.

If it's unique and stable, ask: Is this in a production or production-adjacent environment? If yes, use a managed policy anyway. The governance and auditability benefits matter at scale, and you never know when a "temporary" development policy becomes permanent.

If it's truly temporary and experimental, an inline policy is acceptable. Development sandboxes, contractor accounts, or short-lived test environments can reasonably use inline policies to avoid creating policy clutter.

### Conclusion

The choice between inline and managed policies isn't purely technical—it's a decision about how you want to operate your infrastructure. Inline policies offer simplicity for small, unique, temporary scenarios. Managed policies offer leverage, auditability, and operational control for everything else.

In most real-world AWS environments, managed policies should be your default. They cost nothing extra, they solve real operational problems, and they scale gracefully as your infrastructure grows and evolves. Save inline policies for genuinely exceptional cases, and you'll find your permission structures far easier to manage, audit, and adapt as requirements change.

The investment in properly structured managed policies pays dividends through reduced operational overhead, faster troubleshooting when access issues arise, and clearer organizational alignment between your infrastructure and business requirements. Start with managed policies, resist the temptation to create inline policies for convenience, and you'll build a permission structure that your future self will thank you for maintaining.
