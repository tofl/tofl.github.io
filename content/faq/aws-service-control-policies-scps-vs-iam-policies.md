---
title: "AWS Service Control Policies (SCPs) vs IAM Policies"
---

## AWS Service Control Policies (SCPs) vs IAM Policies

You've just deployed an application across multiple AWS accounts in your organization, configured what you thought were the right IAM permissions, and suddenly—nothing works. Your developers get access denied errors even though their IAM roles appear to grant the necessary permissions. You dive into the CloudTrail logs, run through your IAM policy logic twice, and still can't explain the blockade. Then someone mentions: "Did you check the SCPs?"

If you've encountered this scenario, you've discovered one of AWS's most misunderstood permission mechanisms. Service Control Policies (SCPs) are a powerful—and often invisible—layer of access control that operates at the organizational level, separate from the identity-based policies most developers work with daily. Understanding how SCPs differ from traditional IAM policies and how they interact with them is essential for building secure, predictable multi-account architectures.

### What Are Service Control Policies?

Service Control Policies are permission boundaries that AWS Organizations applies at the account level. Think of them as a safety rail for your entire AWS account: they define the maximum permissions that any principal (user, role, or root account) can ever exercise within that account, regardless of what identity-based policies grant.

SCPs live within AWS Organizations and attach to organizational units (OUs), accounts, or the root of your organization. Unlike IAM policies that live on individual identities, SCPs operate as an overlay across all identities in an account or organizational branch. This architectural difference is crucial: SCPs are fundamentally organizational governance tools, not identity management tools.

To use SCPs, you must have AWS Organizations enabled and service control policies explicitly activated in your organization. By default, they're disabled—a conscious AWS design decision to prevent surprise permission denials until you're ready to implement organizational governance policies.

### The Core Difference: Scope and Intent

The distinction between SCPs and IAM policies starts with their fundamental purpose. IAM policies grant or deny permissions to specific identities—users, roles, or resources. They're about defining what a particular person or workload can do. SCPs, by contrast, define what your entire account is allowed to do, creating a permission ceiling regardless of individual identity configurations.

Imagine you're building a financial services platform. You might have an IAM policy that grants a developer role permissions to use Amazon EC2, RDS, and S3. This identity-based policy is saying: "This developer can do these things." But your organization might attach an SCP to the dev account that explicitly denies any use of unencrypted RDS instances. Now the actual set of things that developer can do is further constrained by the organizational rule.

This layering creates what AWS calls the "permission boundary evaluation logic." Even if an identity-based IAM policy grants a permission, if an SCP denies it at the account level, the request is denied. The evaluation chain looks like this: for a request to succeed, it must be allowed by the identity-based policy AND not denied by any applicable SCP AND not denied by resource-based policies AND not blocked by session policies.

The scope difference also manifests in where policies attach. IAM policies attach directly to users, groups, roles, or resources within an account. SCPs attach to organizational structures—the entire organization, specific OUs, or specific accounts. This means a single SCP can affect dozens of accounts simultaneously, making it a powerful governance tool but also a potential single point of failure if misconfigured.

### The Restrict-Only Nature of SCPs

Here's where many developers first encounter confusion: **SCPs never grant permissions; they only restrict them.** This fundamental limitation often surprises people coming from a pure IAM background.

If you attach an SCP that allows S3 access, that doesn't actually grant anyone S3 access. The SCP merely removes the restriction that would otherwise deny it. Someone still needs an identity-based IAM policy that actively grants S3 permissions for their request to succeed. The SCP is a permission filter, not a permission grantor.

This design choice exists for a good reason: it prevents organizational policies from accidentally granting permissions that should remain restricted. Imagine if an SCP could grant permissions—suddenly every developer in your organization would inherit those permissions through organizational policy, and you'd have no way to prevent them from using those services. By restricting SCPs to only denial logic, you maintain the principle of least privilege: an identity must be explicitly granted permissions through IAM, and the organization can only add restrictions on top of that.

Let's walk through a concrete example. Suppose you create an SCP that "allows" DynamoDB operations. You attach it to your development OU. A developer in the dev account still needs an IAM policy granting them DynamoDB permissions—the SCP doesn't provide it. What the SCP does is ensure that no policy denies DynamoDB access at the organizational level. It's a statement of organizational permission, not identity permission.

Conversely, if you create an SCP that denies DynamoDB operations and attach it to the dev OU, every principal in every dev account—regardless of their IAM policies—cannot use DynamoDB. The SCP creates an absolute boundary that identity policies cannot overcome.

### SCPs in the IAM Evaluation Logic

To truly understand how SCPs function, you need to see them within the broader context of AWS permission evaluation. When you make an API call, AWS runs through a systematic evaluation process before deciding to allow or deny the action.

The evaluation logic is essentially this: a request is allowed only if it's not explicitly denied by any applicable policy AND it's explicitly allowed by an identity-based policy (or resource-based policy, if applicable) AND it passes additional checks like condition-based restrictions.

SCPs enter this evaluation chain at the organizational level. AWS first checks whether the account itself—through SCPs—permits the action. If an SCP explicitly denies the action, evaluation stops immediately with a deny. If SCPs neither allow nor deny the action (which is often the case), evaluation continues to the identity level, where IAM policies take over.

This ordering is important: SCP denials are checked early and are absolute. You can't work around an SCP denial with a more permissive IAM policy. However, if an SCP doesn't explicitly deny something, it's effectively neutral, and the identity policies become the deciding factor.

Consider a practical scenario: your organization has an SCP that denies all API calls outside your corporate IP range. A developer with full EC2 permissions tries to launch an instance from home. Even though their IAM role grants EC2 launch permissions, the SCP's IP-based condition blocks the request before IAM policy evaluation completes. The developer gets access denied, and if they check their IAM policy, they'll see it grants permission—hence the confusion.

### Practical SCP Patterns and Use Cases

SCPs shine in specific governance scenarios where you need organizational-level control. One common pattern is the "deny list" approach: you attach an SCP to your entire organization that denies high-risk actions like deleting CloudTrail logs, modifying SCPs themselves, or accessing credentials that might exist in S3 buckets. This creates a baseline security posture that every account respects.

Another pattern is the "allowlist" approach, where you create SCPs that explicitly allow only certain services. This is more restrictive and requires careful planning, but it's powerful in heavily regulated environments. For example, you might have an SCP that allows only EC2, RDS, and S3, effectively preventing developers from accidentally spinning up expensive or prohibited services like SageMaker or Redshift.

Quarantine is another valuable SCP pattern. When you need to restrict a compromised account or isolate a development environment, you can attach an SCP that denies all actions. The account remains accessible for investigation, but principals can't make changes. This is far cleaner than deleting IAM roles or modifying resource policies.

SCPs are also excellent for regional governance. You might require that all workloads operate in specific AWS regions for compliance reasons. An SCP can deny all API calls with a request region condition that doesn't match your approved regions, creating organizational enforcement without needing to individually configure every IAM policy.

### Common Pitfalls and Troubleshooting

When developers encounter unexpected access denied errors in multi-account setups, SCPs are often the hidden culprit. The debugging process can be frustrating because SCPs aren't immediately visible when examining a specific identity's permissions—you have to navigate to the Organizations console and traverse the OU hierarchy.

One frequent mistake is creating an overly permissive allowlist SCP that unintentionally denies necessary actions. If you decide to use an allowlist approach with SCPs (allowing only specific services), you must account for services that other services depend on. For instance, allowing only S3 might seem fine until you realize that most services need IAM permissions to assume roles, and IAM isn't explicitly in your allowlist.

Another common issue is the "permission boundary surprise." Developers sometimes confuse SCPs with IAM permission boundaries, which are a different feature entirely. Permission boundaries are an IAM feature that sets a maximum for a specific role or user within an account. SCPs set the maximum for the entire account. Both can work together—a principal might be constrained by their IAM permission boundary, their identity-based policy, and an SCP, all at the same time.

When debugging access issues, start with the IAM policy simulator within the specific account. If the simulator shows the action is allowed, but it still fails in reality, check the SCPs attached to the account and its parent OUs. Use the AWS Organizations console to walk the hierarchy and review each SCP's statements. CloudTrail can also help—denied requests often include the SCP or policy that caused the denial in the event details.

### Designing Multi-Account Architectures with SCPs

In well-designed multi-account organizations, SCPs and IAM policies work in concert. The typical approach is to use SCPs for organizational governance—the baseline security and compliance rules that apply everywhere—and IAM policies for workload-specific permissions.

A common structure might look like this: the root OU has SCPs that deny dangerous actions like credential exfiltration, CloudTrail disablement, and root account credential generation. These SCPs protect the entire organization. Then, individual OUs for development, staging, and production have additional SCPs that reflect the governance needs of those environments. The dev OU might have looser SCPs allowing more services, while the production OU has restrictive SCPs ensuring only necessary services can be accessed. Within each account, individual teams manage their IAM policies to grant specific roles the precise permissions they need.

This layered approach provides defense in depth. If an IAM policy is mistakenly configured too permissively, the SCP acts as a safety net. If an SCP is accidentally too restrictive, you can modify it across the organization without touching individual IAM policies. The separation of concerns makes governance clearer and reduces the blast radius of configuration errors.

### Best Practices for SCP Implementation

Start conservative. Don't activate SCPs organization-wide until you've thoroughly tested them in a sandbox account or a limited OU. SCPs can silently break applications if misconfigured, and debugging across multiple accounts is time-consuming.

Document your SCP strategy. Create a clear explanation of why each SCP exists, what it prevents, and which OUs it affects. This documentation is invaluable when debugging issues or onboarding new team members.

Use version control for your SCP definitions. SCPs are essentially JSON policy documents, and treating them like code—with Git history, code review processes, and change tracking—prevents accidental modifications and provides an audit trail.

Test SCPs before broad rollout. Attach an SCP to a single account or OU and monitor the impact. Check CloudTrail for denied requests, run workload tests, and confirm that only the intended restrictions are in place. Only then expand to larger scopes.

Avoid overly complex SCP conditions. While SCPs support the same condition logic as IAM policies, complex conditions can become hard to debug. Keep SCP logic straightforward and easy to understand.

Remember that SCPs are not a substitute for proper IAM policy design. Even with restrictive SCPs, you should follow least privilege principles in your identity-based policies. SCPs are a organizational safeguard, not a replacement for careful identity management.

### Conclusion

Service Control Policies represent a distinct and essential layer in AWS's permission evaluation model. Unlike IAM identity-based policies that grant or deny permissions to specific identities, SCPs operate at the organizational level to restrict the maximum permissions any principal can exercise within an account. They're restriction-only mechanisms that filter requests before identity-based policy evaluation occurs, creating a hard ceiling on what accounts can do.

The key insight is that SCPs and IAM policies serve different purposes in different scopes. IAM policies manage what individual users and roles can do; SCPs manage what accounts can do. Both work together in the permission evaluation chain, and understanding their distinct roles is crucial for building secure, maintainable multi-account environments.

When you encounter those frustrating access denied errors in a multi-account setup, SCPs are often the answer. By grasping how they differ from IAM policies, how they restrict rather than grant, and where they fit in the evaluation logic, you'll be equipped to design governance architectures that are both secure and developer-friendly—and to troubleshoot permission issues with confidence.
