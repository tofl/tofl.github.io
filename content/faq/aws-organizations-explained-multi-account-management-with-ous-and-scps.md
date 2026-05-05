---
title: "AWS Organizations Explained: Multi-Account Management with OUs and SCPs"
---

## AWS Organizations Explained: Multi-Account Management with OUs and SCPs

Managing infrastructure across multiple AWS accounts has become the de facto standard for organizations of any meaningful scale. Whether you're separating environments by function (development, staging, production), by business unit, or by compliance requirement, a single AWS account quickly becomes unwieldy. That's where AWS Organizations comes in—a service that transforms how you manage, govern, and scale your AWS infrastructure across dozens, hundreds, or even thousands of accounts.

This article walks you through the essentials of AWS Organizations: how to structure your accounts, enforce policies across them, and leverage consolidated billing. If you're building cloud infrastructure for real-world workloads or preparing to architect solutions in AWS, understanding Organizations isn't optional—it's foundational.

### Understanding the Core Concept of AWS Organizations

At its heart, AWS Organizations is a free service that lets you centrally manage and govern multiple AWS accounts as a single entity. Rather than logging into each account separately to apply policies or track billing, Organizations gives you a bird's-eye view and centralized control.

Think of it like this: if a single AWS account is a single house, AWS Organizations is the neighborhood management system that oversees multiple houses, sets rules for all of them, and consolidates the utility bills. One person manages the common rules; individual homeowners still control what happens inside their own house (within those rules).

The service revolves around a hierarchical structure. At the top sits your management account (formerly called the master account)—the account that created the organization and holds the keys to the kingdom. Below that, you build a tree of member accounts organized into logical groupings called Organizational Units, or OUs. Policies cascade down this hierarchy, and billing flows up to the management account.

### The Management Account and Member Accounts

The management account is special. It's the account you use to create the organization in the first place, and it remains the sole account with permissions to manage the organization itself. From the management account, you can invite existing AWS accounts to join your organization, create new accounts, delete accounts, apply policies, and view consolidated billing.

Here's an important distinction: the management account is part of your organization, but it's not exempt from the rules you create. If you define a policy that restricts who can create Amazon EC2 instances, that policy applies to the management account too. This is actually a good thing—it prevents accidental privilege escalation where you'd be tempted to bypass your own controls.

Member accounts are any AWS account that has joined your organization. They might have been created within the organization, or they might be existing accounts you've invited to join. Member accounts are where your actual workloads live. They have their own AWS resources, their own IAM users and roles, and their own resource limits, but they're subject to the policies you've attached at the organizational level.

One crucial point: member accounts retain significant autonomy. An IAM administrator in a member account can still create users, roles, and policies within that account—as long as those don't conflict with the Service Control Policies (we'll cover those soon) you've attached. Organizations is about providing guard rails and visibility, not about eliminating local control entirely.

### Designing Your Organizational Structure with OUs

The magic of Organizations lies in how you structure it. Organizational Units, or OUs, are the containers into which you organize your accounts. An OU can contain accounts, other OUs, or both. This lets you build a hierarchy that reflects your business reality.

The root OU is the top-level container that exists in every organization. Every account must be in the root or in some OU nested under the root. You can nest OUs up to five levels deep—that is, you can have OUs within OUs within OUs, but not infinitely. In practice, five levels is plenty for most organizations.

Consider a realistic example. A mid-sized company might organize like this:

The root sits at the top. Below it, they create OUs for major divisions: Engineering, Finance, and Operations. Under Engineering, they further subdivide into Environments (Development, Staging, Production) and Workloads (Web Services, Data Platform, Infrastructure). A specific account containing the production Kubernetes infrastructure might sit under Engineering → Environments → Production, or it might sit under Engineering → Workloads → Infrastructure. The choice depends on whether you want policies to vary by environment or by workload type.

Another organization might organize differently: by geography (US, EU, APAC), or by application (Mobile App, Web Platform, Analytics), or by a combination. There's no single correct answer. The key is choosing a structure that maps to how you actually want to apply policies and manage accounts.

As you design your hierarchy, keep a few principles in mind. First, think about where policies will diverge. If all accounts in a given OU should have the same restrictions, they belong together. If you find yourself wanting to apply different policies to accounts in the same OU, that's a signal you should subdivide. Second, keep it relatively shallow—three or four levels is usually ideal. Deeper hierarchies become harder to understand and manage. Finally, remember that you can reorganize your OUs later if your needs change. Organizations allows you to move accounts between OUs without deleting them.

### Service Control Policies: The Organization-Wide Guard Rails

Service Control Policies, or SCPs, are where Organizations becomes truly powerful for governance. An SCP is a JSON document that defines the maximum permissions available to an account or OU. Think of it as a permission ceiling, not a permission grant.

This is a critical distinction: SCPs do not grant permissions. They restrict permissions. Even if you have an SCP that allows EC2 actions, those actions still won't work unless you have corresponding IAM permissions that explicitly grant them. Conversely, if an SCP denies an action, no IAM policy can override that denial. The SCP acts as a veto that can't be appealed.

Here's a practical example. Imagine you want to ensure that no account in your organization can delete an Amazon S3 bucket without going through a specific process. You could create an SCP like this:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Deny",
      "Action": "s3:DeleteBucket",
      "Resource": "*"
    }
  ]
}
```

Attach this SCP to the root OU, and no one—not even an IAM administrator in a member account—can delete a bucket without somehow modifying or removing the SCP. The SCP is enforced at the account level, not at the individual user level.

SCPs are attached to OUs or accounts, not to users or roles. When you attach an SCP to an OU, it applies to all accounts in that OU and all nested OUs below it. If you attach an SCP directly to an account, it applies only to that account. This hierarchy of policy attachment is powerful because it lets you set guardrails at different levels.

A common pattern is to attach restrictive SCPs at the root level to prevent certain dangerous actions organization-wide, then attach more permissive or specialized SCPs at lower OUs to allow specific behaviors in specific contexts. For instance, you might deny all but a whitelist of AWS regions at the root, then allow additional regions only in the Production OU where your workloads actually run.

SCPs have limitations worth knowing. First, they don't apply to the management account. If you attach an SCP to the root that denies all actions, your management account isn't affected—its administrators can still do anything. This is intentional: you need a way to recover if you lock yourself out. Second, SCPs don't apply to certain AWS services. CloudFront, IAM, and a few others have their own permission models that aren't affected by SCPs. Third, the management account's SCPs can't be modified through the Organizations console—they're managed differently to protect organizational governance.

### Service Control Policies Versus IAM Policies

The confusion between SCPs and IAM policies trips up many developers. Both are JSON documents that define permissions, but they operate at completely different levels.

An IAM policy is attached to an identity within an AWS account: a user, a role, or a group. It specifies what that identity is allowed (or denied) to do. IAM policies are evaluated within a single account. They're the primary mechanism for enforcing least privilege and role-based access control within your applications and infrastructure.

An SCP, by contrast, is attached at the organizational level—to an OU or an account—and defines the maximum permissions available to the entire account or OU. It's a blanket restriction that applies regardless of which IAM identity is performing an action.

Here's the mental model: imagine an AWS account as a kingdom. IAM policies are the laws that govern individual citizens (users and roles). SCPs are the provincial boundaries—rules about what any citizen in that province can do, regardless of which province they belong to. Both have to align for an action to succeed.

Concretely, if you want a user to be able to launch EC2 instances, you need:

1. An IAM policy attached to that user (or a role the user assumes) that includes the `ec2:RunInstances` permission.
2. No SCP on the account or any of its parent OUs that denies `ec2:RunInstances`.

If either condition fails, the user can't launch an instance. This is why SCPs are so powerful for governance—they're a failsafe that prevents even well-intentioned IAM administrators from accidentally (or intentionally) bypassing security controls.

### Consolidated Billing and Cost Management

One of the immediate, tangible benefits of Organizations is consolidated billing. When you create or invite accounts into your organization, their billing automatically consolidates into the management account. Instead of paying separate bills for each account, you get a single bill with line items for each member account.

This consolidation unlocks significant financial benefits. The most direct is volume discounts. AWS pricing is progressive—the more compute, storage, or data transfer you use, the lower the per-unit cost. With consolidated billing, AWS aggregates usage across all your accounts to calculate your discount tier. A company running five EC2 instances might get a 5% discount within each account separately; with consolidated billing across fifty accounts, millions of instances, that same company might qualify for a 15% discount, which applies to all five instances as well as all the others.

Additionally, consolidated billing enables Reserved Instance sharing and Savings Plans sharing. A Reserved Instance or Savings Plan purchased in one account can be used by any other account in your organization. This flexibility means you don't need to guess which account will use a RI; you can buy them centrally and let AWS match them to usage across all accounts. For large organizations, this can be worth hundreds of thousands of dollars annually.

AWS also calculates your volume discount against your consolidated usage, then applies that discount across all member accounts. This is powerful: if account A uses a lot of data transfer and account B uses very little, they both benefit from the aggregate volume because the cost is calculated at the organizational level.

From the management account, you can view detailed billing and cost reports that show usage and costs broken down by account, by service, by region, or by custom tags. This visibility is invaluable for chargeback models (billing business units for infrastructure they use), for optimization (identifying where costs are running high), and for forecasting.

### Creating and Inviting Accounts

There are two ways to add member accounts to your organization: create them directly within Organizations, or invite existing accounts to join.

When you create a new account through Organizations, AWS automatically configures it as a member account of your organization. You provide an email address, an account name, and optionally an IAM role name. AWS creates the account, sets it up with a root user, and enrolls it in your organization all in one step. Within a few minutes, the new account is ready. This is the preferred approach for greenfield deployments where you're building your organizational structure from scratch.

Inviting an existing account is the process you use when you have standalone AWS accounts that you want to bring into your organization. From the management account, you initiate an invitation to the existing account's root email address. The owner of that account receives an email and must accept the invitation. Once accepted, the account becomes a member account of your organization. Any resources in that account remain untouched; the account is simply enrolled in your organization's governance and billing structure.

The invitation process is straightforward but requires coordination. If you're consolidating a large portfolio of accounts—say, a company that's been growing organically and has accounts scattered across different teams—you'll need to reach out to each account owner, ask them to accept the invitations, and coordinate the switch-over. Organizations provides an API for this, so you can automate the invitation process at scale, but the acceptance still requires a human action in each account.

Once an account is part of your organization, you can't move it out and keep it running independently. If you want to remove an account, you must delete it (which destroys all its resources) or remove it from the organization and then perform a standalone account recovery process. This is intentional—it prevents accidental or malicious removal of accounts from governance. Think carefully before inviting an account you might want to maintain independently later.

### Understanding Organizational Limits

AWS Organizations has some important limits you should keep in mind as you design your structure. These limits exist to prevent accidental misconfigurations and to ensure the service scales predictably.

Each organization can contain a maximum of four thousand accounts. This sounds like a lot—and for most organizations, it is—but if you're building a platform that serves thousands of customers and you want to provision a separate account for each, you'll hit this limit. AWS can increase it upon request, but it's not unlimited.

The OU hierarchy can be up to five levels deep, as mentioned earlier. Deeper nesting than necessary becomes confusing; most organizations work well with three or four levels. The total number of OUs per organization is ten thousand, which is effectively unlimited for practical purposes.

SCPs have a size limit of five thousand characters, which is usually plenty for expressing reasonable policies. If you find yourself writing SCPs larger than this, it's often a sign you should break them into multiple policies or rethink your approach.

The management account can't be removed from the organization. This is a safeguard—it ensures there's always a place to manage the organization from. Similarly, you can't change which account is the management account without dissolving and recreating the organization.

These limits rarely become a practical problem for most organizations, but it's good to know they exist and understand why they're there.

### Security Best Practices for Multi-Account Organizations

Deploying AWS Organizations is a governance multiplier, but it only works if you follow certain security practices. Here are the critical ones.

First, secure the management account aggressively. The management account has permissions to modify the organization structure, apply SCPs, and initiate account deletions. Compromise of the management account is a critical security incident. Use a strong root password stored in a secure password manager, enable MFA on the root user, and consider using AWS CloudTrail (which should be enabled organization-wide) to audit all actions. Restrict who has access to the management account—ideally, only a small number of senior infrastructure engineers or security personnel. Most day-to-day work should happen in member accounts.

Second, establish a baseline SCP at the root level that protects against common mistakes. A typical baseline might deny the ability to disable CloudTrail (which logs all API activity), deny the ability to modify SCPs themselves (to prevent someone from loosening controls), and deny access to certain dangerous actions like closing the AWS account or removing the organization. This baseline is insurance against well-meaning developers or newly hired employees accidentally breaking the organization's security posture.

Third, use CloudTrail organization-wide. Organizations supports a feature where you can enable CloudTrail in all accounts from the management account, logging to a central S3 bucket. This gives you organization-wide audit trails that can't be modified or deleted by individual accounts. Pair this with CloudWatch Logs for real-time alerting on suspicious activities.

Fourth, implement a consistent tagging strategy across all accounts. Tags are metadata you attach to AWS resources that help you organize, track, and manage them. By establishing a tagging standard—for example, tagging all resources with the account owner, the environment, the cost center, and the application name—you enable better cost allocation, compliance tracking, and resource governance.

Fifth, delegate the right level of access. The principle of least privilege applies at the organizational level too. Rather than giving developers access to the management account, create specific roles in member accounts that give them the permissions they need for their work. Use cross-account roles if they need to access resources in other accounts. This compartmentalization limits the blast radius if credentials are compromised.

Finally, regularly audit your organizational structure and policies. As your organization grows and changes, your OU structure and SCPs might become misaligned with your actual needs. Quarterly reviews of your organization—checking whether accounts are in the right OUs, whether your SCPs are still achieving their intended effect, whether there are new security threats you should guard against—keep your structure healthy and effective.

### Practical Example: Organizing a Startup

Let me walk through a realistic scenario that ties together many of these concepts.

Imagine you're a growing startup with engineering, finance, and operations teams. Currently, you have four AWS accounts: dev, staging, prod, and a separate account for data analytics. You're consolidating under Organizations.

First, you create the organization in the account you've designated as management (let's say the dev account you've been using). Then, you structure it like this:

The root OU contains a Deny policy that prevents anyone from creating or modifying S3 bucket public access block settings in a way that makes data public. This is a baseline security control that applies everywhere.

Below root, you create three OUs: Engineering, Finance, and Data. Under Engineering, you create Environments with Development and Production OUs. Your dev account moves under Development, your staging and prod accounts move under Production.

The Data OU contains just the analytics account. The Finance OU contains a separate account you've created for financial reporting and billing analysis.

Now you define policies:

The Production OU gets an SCP that restricts what can be deleted (to prevent accidental infrastructure destruction). It also restricts region access to only the regions where your production workloads run. The Development OU has more permissive policies that allow experimentation and regional diversity for testing.

The Data OU gets an SCP that restricts data exfiltration actions like downloading large amounts of data or creating temporary access credentials.

The Finance OU gets an SCP that restricts certain security controls from being modified, ensuring your compliance posture isn't accidentally weakened.

With consolidated billing enabled, AWS now:

Calculates your volume discount across all four accounts' usage and applies it to each account's charges. Allows any Reserved Instances purchased in any account to be used in any other account. Provides a single invoice showing all four accounts' costs, broken down by service and account.

This structure gives each team autonomy within their accounts, prevents common mistakes through SCPs, enables cost optimization through consolidated billing, and provides centralized visibility and governance from the management account. If your startup grows and adds a fifth account, you simply move it into the appropriate OU and the policies apply automatically. If you realize a year later that you want to reorganize by function instead of environment, you can restructure the OUs without losing accounts or resources.

### Getting Started with Organizations

If you're starting from scratch, the process is straightforward. Log into the AWS account you want to use as your management account, navigate to the AWS Organizations console, and click "Create organization." AWS creates the organization and makes your account the management account. From there, you can create OUs, create or invite accounts, and attach SCPs.

If you're consolidating existing accounts, start by planning your OU structure on paper or in a spreadsheet. Map out which accounts should live where and which policies you need. Then, create the OU structure in the management account, create any new accounts you need, and issue invitations to existing accounts. Once all accounts are enrolled, attach your SCPs. This deliberate, planned approach prevents confusion and mistakes.

As with any AWS service, start small and iterate. You don't need a perfect organizational structure on day one. It's okay to start with a simple structure—maybe just an Engineering OU and an Operations OU—and refine it as you better understand your needs and as your organization grows. SCPs can also be updated or replaced as your security requirements evolve. Organizations is designed to be flexible.

### Conclusion

AWS Organizations transforms how you manage infrastructure at scale. By consolidating multiple accounts under a single organizational structure, applying policies that prevent common mistakes, and leveraging consolidated billing for cost optimization, you can build governance that actually works—that protects your infrastructure and finances without becoming a bureaucratic nightmare.

The key is understanding the pieces: the management account's special role, the hierarchy of OUs, the power and limitations of SCPs, and how all of this ties to consolidated billing. With these concepts solid, you have the foundation to design organizational structures that align with your business, enforce security controls that matter, and give teams the autonomy they need to innovate.

Whether you're architecting a new multi-account setup or refining an existing one, the principles remain the same: think about your policy boundaries before you build them, secure the management account first and most carefully, and iterate as your needs evolve. Organizations isn't a set-it-and-forget-it service—it's the control plane for your entire AWS presence, and it deserves the attention it merits.
