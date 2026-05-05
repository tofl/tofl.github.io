---
title: "IAM Identity Center Permission Sets: Design and Best Practices"
---

## IAM Identity Center Permission Sets: Design and Best Practices

When you're managing access across multiple AWS accounts in an organization, the traditional approach of creating and maintaining IAM users and roles in each account quickly becomes unwieldy. You end up juggling credentials, enforcing password policies across silos, and manually provisioning the same roles over and over. AWS IAM Identity Center (the managed successor to AWS SSO) solves this problem by providing a centralized identity and access management solution. But the real power lies in understanding how to design and deploy permission sets effectively at scale.

Permission sets are the mechanism through which IAM Identity Center translates high-level access policies into actual IAM roles provisioned in your member accounts. They're not a completely new concept, but they're also not just standard IAM roles. Understanding how they work, how to configure them properly, and how to apply best practices will let you build a secure, maintainable access control system for organizations of any size.

### Understanding Permission Sets and Their Role in the IAM Identity Center Architecture

At their core, permission sets are templates that define a collection of permissions and session configuration. When you assign a permission set to a user or group in IAM Identity Center, the service automatically creates or updates a corresponding IAM role in the target AWS account. This role has a predictable name, a trust relationship that points back to IAM Identity Center, and the permissions you've defined.

Think of it like a blueprint: the permission set is the blueprint, and the IAM role in each member account is the constructed building. If you update the permission set, IAM Identity Center updates all the corresponding roles across all assigned accounts. This is far more efficient than logging into each account individually and updating roles manually.

The flow works like this: a user in your identity source (which could be Okta, Azure AD, your own identity provider via SCIM, or AWS Managed Active Directory) authenticates with IAM Identity Center. IAM Identity Center validates that authentication and checks what permission sets have been assigned to that user for the target account. It then generates temporary credentials that assume the corresponding IAM role in that member account. The user can then use those credentials to access AWS services.

This architecture has a crucial implication: permission sets and the IAM roles they provision are tightly coupled. You can't simply edit an IAM role created by IAM Identity Center and expect the changes to stick. IAM Identity Center will reconcile any drift and restore the role to match the permission set definition. This is actually a feature, not a limitation—it ensures consistency and prevents accidental or malicious modifications.

### AWS-Managed Versus Customer-Managed Permission Sets

IAM Identity Center provides a starting point with AWS-managed permission sets, but understanding when and why to use customer-managed permission sets is essential for building practical access control systems.

AWS-managed permission sets are preconfigured by AWS and cover common use cases: ReadOnlyAccess for read-only operations, PowerUserAccess for developers who shouldn't manage IAM, AdministratorAccess for admin users, and several domain-specific policies like SecurityAudit or ViewOnlyAccess. These are versioned and updated by AWS over time, so they reflect current best practices. They're convenient, and if your use case aligns neatly with one of them, using an AWS-managed permission set reduces your maintenance burden.

However, most real-world scenarios require customization. Your organization might need a developer role that can create resources in certain regions but not others, or that can view logs but not modify them. You might want to grant database administrators access to RDS but not EC2, or give data scientists permission to read from S3 buckets but only within a specific prefix. That's where customer-managed permission sets come in.

A customer-managed permission set is one you create and maintain yourself. You define the permissions using standard IAM policy language—exactly what you'd write if you were creating a standalone IAM policy. The key advantage is flexibility: you can craft policies tailored to your organizational structure, security requirements, and operational practices. The tradeoff is that you own the maintenance. If AWS releases a new service or new capabilities in an existing service, it won't automatically be reflected in your customer-managed policies. You'll need to review and update them periodically.

A pragmatic approach is to use AWS-managed permission sets where they fit, and create customer-managed permission sets for anything more specific. For example, you might use the AWS-managed ReadOnlyAccess for your analysts, but create a custom permission set for your platform engineering team that includes permissions to manage CloudFormation stacks, EC2 instances, and networking resources in specific regions.

### Attaching Inline Policies and Permissions Boundaries to Permission Sets

Once you've chosen between AWS-managed and customer-managed permission sets, you can further refine access by attaching inline policies and permissions boundaries. This layering approach gives you fine-grained control while keeping your permission set definitions manageable.

An inline policy attached to a permission set becomes part of the IAM role itself. You can add inline policies to both AWS-managed and customer-managed permission sets, making them more restrictive or adding specific capabilities. For instance, if you're using the PowerUserAccess AWS-managed permission set but your organization's security policy requires that users never delete specific resources, you could attach an inline policy that explicitly denies those delete actions.

Permissions boundaries are different. A permissions boundary is a policy that defines the maximum permissions a role can have. Even if a role has explicit allow statements, those permissions are only effective if they're also allowed by the boundary. It's a useful safety mechanism: you can use a permissions boundary to ensure that no permission set in a specific account can exceed a certain scope of access, regardless of what policies are attached to individual permission sets.

Here's a practical example: imagine your organization has a shared services account where developers can provision temporary infrastructure for testing. You want to give them broad permissions to create resources, but you want to ensure they can never delete resources in production or modify IAM policies. You'd create a permissions boundary that explicitly denies IAM modifications and deletions of production resources. Then you'd attach that boundary to the permission set. Now, even if someone crafted a policy that tried to grant delete permissions, the boundary would prevent it.

In practice, permissions boundaries are often used at the account level rather than the permission set level. Your organization's security team might define a boundary in the member account that applies to all permission sets, ensuring a baseline of compliance. Within that constraint, individual permission sets can be more permissive.

### Session Duration Configuration

One detail that often gets overlooked is session duration—how long the temporary credentials issued by IAM Identity Center remain valid. This is configured at the permission set level and has both security and usability implications.

When a user logs in via IAM Identity Center and assumes a role for a specific account, they receive temporary credentials with a defined duration. The default is one hour, which is conservative but sometimes inconvenient. If you're building an automated deployment pipeline or running a long-running analysis job, credentials that expire every hour require refresh logic.

You can configure the session duration for each permission set independently, ranging from one hour to twelve hours. This is the maximum duration a single session can last. The actual session duration presented to the user at login is the lesser of the permission set's maximum session duration and what the user selects in IAM Identity Center (up to the maximum).

There's a security-usability tradeoff here. A short session duration like one hour is more secure because compromised credentials have a limited window of use. A longer duration, like eight hours, is more convenient for users, especially those running batch jobs or working with tools that don't automatically refresh credentials. Most organizations settle on two to four hours as a reasonable middle ground.

From an operational perspective, if you're using IAM Identity Center with the AWS CLI, understand that when you run `aws sso login --profile your-profile`, you're authenticating interactively and receiving credentials valid for the session duration defined in the permission set. Those credentials are cached locally. When they expire, you'll need to run `aws sso login` again. Some teams reduce friction by setting longer session durations for development environments and shorter durations for production access.

### Using IAM Identity Center with the AWS CLI v2

The AWS CLI v2 integrates seamlessly with IAM Identity Center, and understanding that integration is crucial for developers who work with the command line daily. Rather than managing long-lived access keys, you authenticate through IAM Identity Center and receive temporary credentials.

The process starts with configuration. You typically configure your AWS CLI profile to use SSO:

```
[profile dev]
sso_start_url = https://my-organization.awsapps.com/start
sso_region = us-east-1
sso_account_id = 123456789012
sso_role_name = DeveloperAccess
region = us-east-1
```

The `sso_start_url` is the login URL for your IAM Identity Center instance, `sso_region` is the region where Identity Center is configured, `sso_account_id` is the target AWS account, and `sso_role_name` is the name of the IAM role created by your permission set in that account.

When you first run a command with that profile, the CLI will tell you to log in:

```
aws s3 ls --profile dev
```

This triggers a login flow where your default browser opens, you authenticate with your identity provider, and AWS CLI caches your temporary credentials locally (by default in `~/.aws/sso/cache`). Subsequent commands use those cached credentials until they expire.

One important detail: the `sso_role_name` must match the actual name of the IAM role provisioned in the member account by your permission set. By default, IAM Identity Center creates role names based on the permission set name. If your permission set is called "DeveloperAccess", the role will be named "DeveloperAccess" in each member account. If you want a different name, you can customize it when creating or updating the permission set.

The AWS CLI respects the session duration configured in your permission set. Once credentials expire, you'll need to authenticate again with `aws sso login`. For scripts and automation that run longer than your session duration, you have a few options: refresh credentials periodically with a background process, set a longer session duration for service accounts, or use temporary credentials obtained through other means (like STS AssumeRole) for automation that runs outside your normal interactive session.

### Common Permission Set Patterns and Architectures

Most organizations converge on a small number of standard permission sets that cover the majority of use cases, then customize from there. Understanding these patterns helps you build a maintainable access control system.

**ReadOnly access** is the simplest and most universally applicable. Users with this permission set can view resources across the account but can't create, modify, or delete anything. It's ideal for auditors, managers, and anyone who needs visibility without responsibility for changes. You can use the AWS-managed ReadOnlyAccess permission set directly, or create a customer-managed version if you need to exclude certain services (for instance, some organizations restrict viewing of secrets in Secrets Manager even for read-only roles).

**Developer access** is more permissive. Developers need to create and modify resources as part of their work, but they shouldn't manage IAM, billing, or organizational policies. The AWS-managed PowerUserAccess permission set covers this well, though many organizations customize it. A typical custom developer permission set might include permissions for EC2, RDS, S3, CloudFormation, CloudWatch, and a few other services, but explicitly deny any IAM modifications. Some teams further restrict developers by region or by resource tag, ensuring that developers can only modify resources tagged with their project or team identifier.

**Database administrator access** is specialized. DBAs need permissions to manage RDS, DynamoDB, or other database services, but probably shouldn't have general compute permissions. A custom permission set for database administrators would include RDS full access, DynamoDB permissions, CloudWatch logs for diagnostics, and explicitly exclude EC2 and Lambda permissions.

**Break-glass admin access** is a critical security pattern. In an emergency, your organization needs a way for a senior member of the ops team to access any account and perform any action, potentially to remediate a security incident or outage. Rather than creating a full administrator role that anyone can use casually, you create a break-glass permission set with full AdministratorAccess, but assign it only to specific named individuals. This permission set might also have a short session duration (one hour) and require multi-factor authentication. The assignment itself is documented and auditable: you know exactly who can access break-glass admin roles and when.

**SecurityAudit and compliance access** is another common pattern. Security and compliance teams need to read security-relevant information across accounts—VPC configurations, IAM policies, security group rules, CloudTrail logs—but shouldn't be able to modify those resources. The AWS-managed SecurityAudit permission set provides this; you can use it directly or enhance it with permissions to read from CloudTrail, GuardDuty, and other security services.

In large organizations, you might have twenty or thirty permission sets, but they typically organize around these core patterns, with variations for specific teams or projects. The goal is to make permission sets predictable: anyone with the "DeveloperAccess" permission set in the engineering account has the same permissions as anyone else with that permission set, which makes onboarding easier and compliance auditing clearer.

### Best Practices for Designing and Maintaining Permission Sets

Several design patterns and operational practices help keep permission sets manageable and secure as your organization scales.

**Name permission sets clearly and consistently.** Use naming conventions that immediately convey the scope of access. "DeveloperAccess" is clearer than "Dev" or "Access2". Include the intended audience or purpose in the name. "DataScienceReadOnly" tells you more than "Analytics".

**Document the purpose and use cases for each permission set.** You might create this documentation in your internal wiki, a markdown file in your infrastructure repository, or a simple spreadsheet. Include what each permission set is for, who typically needs it, and what the permissions allow. This documentation becomes invaluable when reviewing permission sets for compliance audits or when onboarding new team members.

**Review and audit permission sets regularly.** Set a calendar reminder to review permission sets quarterly or semi-annually. Ask: is this permission set still used? Have the underlying IAM services changed in ways that warrant updating policies? Are there any security gaps we've noticed? This review prevents permission set sprawl and keeps your definitions current.

**Leverage customer-managed permission sets for organization-specific needs, but keep them simple.** A permission set with a 200-line policy is harder to understand, maintain, and audit than a simple one. If a permission set is getting complex, consider whether you should break it into multiple permission sets or whether a different approach (like resource-based policies or attribute-based access control in IAM) might be more appropriate.

**Use IAM policy conditions to make permission sets more flexible without creating more of them.** For instance, a single "DeveloperAccess" permission set can include a condition that restricts EC2 instance types to t3.medium and smaller, or that limits API calls to business hours. Conditions let you define guardrails within a permission set without branching into separate, similar permission sets.

**Combine permissions boundaries at the account level with permissive permission sets in specific accounts.** This works well for development and staging accounts where you want to give developers broad access. Apply a permissions boundary at the account level that prevents deletion of certain resources or prevents IAM modifications, then use a permissive permission set. The combination gives developers what they need while maintaining your guardrails.

**Track permission set changes and their rationale.** If your infrastructure code is stored in Git (which it should be), include your permission set definitions. Document changes in commit messages: if someone removes a permission, future auditors can see why. If you're managing permission sets through the AWS console rather than infrastructure-as-code, at least maintain a changelog describing what changed and when.

**Test permission sets in a non-production account before rolling them out broadly.** Create a test account, assign the permission set to a test user, and verify that the permissions work as intended. It's easy to accidentally deny something you meant to allow or vice versa. A few minutes of testing in a safe environment prevents headaches later.

### Scaling Permission Sets Across Multiple Accounts

As your organization grows and the number of AWS accounts increases, the question of how to manage permission sets efficiently becomes urgent. The good news is that IAM Identity Center is designed for this.

When you create a permission set, you can assign it to multiple accounts simultaneously. IAM Identity Center provisions the corresponding IAM role in each account. If you have twenty accounts and you want to give a specific user access to ten of them with the same permission set, you assign the permission set once and specify those ten accounts. IAM Identity Center handles creating or updating the roles.

From an organizational perspective, use AWS Organizations to group accounts logically. You might have an OU for development accounts, another for production, and another for shared services. When creating a permission set and assigning it, you can assign it at the OU level, which means it applies to all accounts in that OU now and in the future. This dynamic assignment is powerful: as you add new accounts to an OU, users with permission sets assigned to that OU automatically gain access to the new accounts without you needing to manually update anything.

Combining permission sets with account grouping in Organizations lets you scale access management elegantly. Your structure might look like: a "DeveloperAccess" permission set assigned to all accounts in the development OU, a "ReadOnlyAccess" permission set assigned to all accounts, and a "AdminAccess" permission set assigned only to the production OU for senior ops team members.

### Troubleshooting Common Permission Set Issues

Even with good design, issues arise. Knowing how to diagnose them saves time.

If a user can't assume a role despite a permission set being assigned, first verify that the permission set is indeed assigned. In the IAM Identity Center console, navigate to the user, check the account assignments, and confirm the permission set appears. Sometimes assignments fail silently if there's a misconfiguration; you can check the account assignments status to see if there were errors.

If a user has the permission set assigned but operations are failing with "access denied" errors, review the permission set's policy and any permissions boundaries in the account. Verify that the policy includes the necessary permissions. Use the IAM policy simulator (available in the IAM console) to test whether a specific action would be allowed given the policies attached to the role.

If temporary credentials work but the user keeps being prompted to log in, check the session duration. If it's too short relative to the user's workflow, increase it. If the user is using multiple profiles and switching between them, each profile has its own credential cache, so they might be hitting expiration more frequently than expected.

If a custom permission set isn't behaving as expected, check that you haven't accidentally created a conflict between the inline policy and a permissions boundary. Remember that a permissions boundary restricts permissions; even if your inline policy allows something, the boundary can deny it.

### Conclusion

IAM Identity Center permission sets are the lever through which you implement access control at organizational scale. They translate the abstract concept of user roles into concrete IAM roles in your member accounts, and they provide a centralized way to manage access without logging into each account individually.

Effective permission set design starts with understanding that they're templates, not individual roles. Choose between AWS-managed and customer-managed permission sets based on your needs, use inline policies and permissions boundaries to refine access, and configure session durations with security and usability in mind. Build your access control system around a few clear patterns—ReadOnly, DeveloperAccess, break-glass admin—and customize from there.

As you work with IAM Identity Center in your development workflow, integrate it with the AWS CLI v2 for seamless command-line access. Document your permission sets, review them regularly, and test changes before rolling them out. When you're ready to scale across multiple accounts, use IAM Identity Center's ability to assign permission sets at the OU level so your access control grows with your organization automatically.

Permission sets might seem like a detail in the larger picture of AWS access management, but they're the mechanism that makes centralized, scalable identity management possible. Spend time getting them right, and you'll have a cleaner, more secure, more maintainable access control system.
