---
title: "AWS Resource Access Manager (RAM): Sharing Resources Across Accounts"
---

## AWS Resource Access Manager (RAM): Sharing Resources Across Accounts

Managing infrastructure across multiple AWS accounts presents a classic architectural challenge: how do you share resources efficiently without duplicating them or creating a tangled mess of cross-account permissions? AWS Resource Access Manager (RAM) elegantly solves this problem by allowing you to share specific resources across accounts—whether they're part of your AWS Organization or standalone accounts—while maintaining clear ownership and governance boundaries.

This guide walks you through how RAM works, which resources you can share, the operational differences between organizational and cross-account sharing, and real-world patterns you'll encounter as you design multi-account architectures.

### Why Resource Sharing Matters in Multi-Account Environments

Modern AWS deployments rarely operate within a single account. Organizations typically distribute workloads, projects, or environments across multiple accounts for security isolation, billing separation, and organizational clarity. But this distribution creates friction: if you build a Virtual Private Cloud (VPC) with subnets in one account, how does another account's application access those subnets? Traditionally, you'd face uncomfortable choices: duplicate the network infrastructure (wasteful), use complex cross-account VPC peering (operationally heavy), or centralize everything in one account (defeats the purpose of isolation).

Resource Access Manager provides a middle path. Instead of copying resources or wrestling with peering configurations, you can designate a resource as shareable and grant access to other accounts—or even to your entire AWS Organization. The resource remains owned and managed by the original account, while consumers in other accounts can use it as if it were their own. This model scales cleanly across dozens or hundreds of accounts and simplifies governance because resource lifecycle management stays centralized.

### Understanding Resource Shares and Principals

At the heart of RAM is the concept of a **resource share**. A resource share is a named container that bundles one or more resources and explicitly grants access to one or more principals (AWS accounts or AWS Organization principals). Think of it as a carefully curated list: "These resources, for these accounts."

When you create a resource share, you're performing two fundamental actions: designating which resources to include and defining which principals can access them. A principal can be an AWS account ID, an organizational unit (OU) within your AWS Organization, or the organization root itself. This flexibility allows you to target access with precision—sharing infrastructure with a specific team's account, a department-level OU, or your entire organization depending on the governance requirements.

A crucial point: creating a resource share doesn't restrict the owning account's access. If Account A shares a VPC subnet with Account B, Account A retains full control and can continue using that subnet normally. Account B gains permission to launch resources within the shared subnet, but Account A remains the authoritative owner.

### Shareable Resources: What Can You Actually Share?

Not every AWS resource is shareable through RAM—that would create security and operational nightmares. AWS carefully controls which resource types are designed to be shared. The list includes:

**Networking resources** form the core of shareable assets. You can share VPC subnets, which is perhaps the most common use case. When you share a subnet, the consuming account can launch EC2 instances, RDS databases, Lambda functions, and other services within that subnet, but the owning account retains full administrative control over the subnet itself. You can also share Transit Gateways (TGWs), which enable you to centralize network connectivity across accounts in a hub-and-spoke topology. Route 53 Resolver rules allow you to share DNS resolution configurations, useful when you want to enforce consistent DNS routing policies across accounts without duplicating the resolver infrastructure.

**Database and analytics resources** extend sharing beyond networking. Aurora clusters can be shared, enabling a central database to serve multiple applications across different accounts. This pattern helps reduce operational overhead when several teams need access to the same data repository. Redshift clusters, Redshift subnet groups, and Redshift-managed VPC endpoints are similarly shareable for analytics workloads.

**License and instance management** resources include AWS License Manager to share license configurations and tracking across accounts, and EC2 Image Builder to share custom AMI-building infrastructure centrally.

**Other resources** round out the shareable portfolio: AWS Systems Manager contacts, Glue catalogs, and RDS database option groups. This list evolves as AWS adds sharing support to new services, so it's worth checking the current documentation regularly.

A practical limitation: you cannot share all resources. You cannot, for example, directly share an IAM role, an S3 bucket, or an EC2 instance. For these, you'll need traditional cross-account mechanisms like bucket policies or security groups.

### Organization-Based Sharing vs. Cross-Account Sharing

RAM supports two distinct sharing models, and choosing between them shapes your access control strategy.

**Organization-based sharing** applies when your AWS accounts are managed through AWS Organizations. When you enable resource sharing within your organization, you can grant access to entire OUs, the organization root, or specific accounts. The advantage here is simplicity at scale: if you designate a resource share to apply to an OU containing fifty accounts, all fifty accounts gain access automatically. New accounts added to that OU inherit access without manual intervention. This model works beautifully for larger organizations with predictable hierarchies. You enable organization-based sharing once, and AWS handles the propagation automatically.

**Cross-account sharing** is the fallback mechanism for standalone accounts or when you need fine-grained control. You explicitly specify individual AWS account IDs to grant access. This requires more manual management—if you add ten new accounts to your environment, you must explicitly add each to the relevant resource shares. However, it offers granularity when you need it: you can share resources with select external partners or specific accounts without exposing resources to your entire organization.

The choice usually depends on whether accounts are under your organizational control. If you manage them through Organizations, organization-based sharing is cleaner. If you're sharing with external partners or managing accounts independently, cross-account sharing is your only option.

### IAM Permissions and Principal Requirements

Sharing a resource through RAM requires appropriate IAM permissions, as does accepting and using a shared resource. Understanding these permission boundaries prevents frustrating access denials and clarifies the relationship between RAM and IAM.

**For the account that owns and shares the resource**, the owning account's administrator needs permissions to create the resource share, associate resources with the share, and designate principals. These are controlled through IAM actions like `ram:CreateResourceShare`, `ram:AssociateResourceToResourceShare`, and `ram:AssociateResourceSharePermissionToResourceShare`. Additionally, the owning account's IAM administrator must grant the consumer accounts (or principals) permissions to use the shared resource. For a VPC subnet share, this might mean allowing EC2 instance launch operations. The specific permissions depend on what the consuming account wants to do with the resource.

**For accounts consuming shared resources**, the receiver must have permission to accept the resource share invitation or allow automatic acceptance if the share is within the organization. They then need permissions to use the resource—again, the specifics depend on the resource type. If consuming a shared VPC subnet, they need EC2 permissions to launch instances; for a shared Redshift cluster, they need appropriate Redshift query permissions. Notably, RAM itself doesn't enforce permissions; IAM does. RAM is an access broker that says "Account B can see this resource," but Account B still needs IAM policies granting them the ability to act on it.

A common misconception: sharing a resource via RAM doesn't automatically grant all permissions to use it. You must configure both the RAM share and the relevant IAM policies. RAM opens the door; IAM controls what the recipient can do once inside.

### Practical Example: Centralized Network Architecture with VPC Subnet Sharing

Let's walk through a concrete scenario that illustrates how RAM streamlines a multi-account network architecture.

Imagine a company with a central infrastructure team managing a core VPC and several application teams in separate accounts. Traditionally, each team would run their own VPC, leading to duplicated networking infrastructure, separate IP address management, and operational complexity. With RAM, the infrastructure team can design a single VPC with multiple subnets—perhaps three subnets for a three-tier application stack—and share those subnets with application team accounts.

**Setup in the infrastructure account:** The team creates a VPC with appropriately sized subnets, security groups, and routing policies. They then create a resource share named "ApplicationTeamSubnets" and add the three subnets to it. If managing through Organizations, they select the OU containing all application team accounts. If managing standalone accounts, they explicitly add each account ID.

```
# Create a resource share (using AWS CLI)
aws ram create-resource-share \
  --name ApplicationTeamSubnets \
  --resource-arns arn:aws:ec2:region:account-id:subnet/subnet-1 \
                  arn:aws:ec2:region:account-id:subnet/subnet-2 \
                  arn:aws:ec2:region:account-id:subnet/subnet-3 \
  --principals arn:aws:organizations::account-id:ou/o-organization-id/ou-team-OU
```

**Configuration in an application team account:** The team receives a notification of the resource share (or, if organizational sharing, the share automatically becomes visible). They can view the shared subnets in the EC2 console under "Shared with me" resources. When launching an EC2 instance, they select one of the shared subnets just as they would a subnet they own. The instance launches in the infrastructure account's VPC, with networking managed centrally.

The infrastructure team retains control: they can modify security group rules, adjust route tables, and manage VPC Flow Logs. The application teams get the convenience of a well-designed network without the operational burden of managing it. If a new application team joins the organization, the infrastructure team simply adds their account to the resource share, and subnet access propagates automatically.

This pattern dramatically simplifies network governance in large organizations. One centralized VPC becomes a shared utility instead of a bottleneck.

### Enabling RAM in Your Organization

If you're using AWS Organizations, a one-time setup enables resource sharing across your organization. A delegated administrator—typically from the infrastructure or security team—enables sharing within the organization using the RAM console or API. Once enabled, any account in the organization can create resource shares and target them to OUs, accounts, or the organization root.

Without this organizational setup, accounts can still share resources directly with other accounts via cross-account sharing, but the process is less streamlined. Invitations must be sent and accepted explicitly rather than propagating automatically.

### Practical Considerations and Limits

While RAM is powerful, a few practical constraints shape how you use it. Resource shares have a quota: by default, you can create up to ten shares per account, though this can be increased through AWS support. Each share can include multiple resources, but grouping resources logically in shares makes governance and auditing easier.

Billing deserves attention: when you share a resource, billing stays with the owning account. If the infrastructure team shares subnets with application teams, the infrastructure account continues to pay for the VPC. This centralization of billing can simplify cost allocation if the central team is budgeted for shared infrastructure. Conversely, if you want to charge back to consumer accounts, you'll need a separate mechanism.

Audit and compliance teams appreciate RAM's transparency: AWS CloudTrail logs all resource share operations, and AWS Config can track which resources are shared and with whom. This visibility supports compliance requirements and incident response.

### Common Pitfalls and How to Avoid Them

One frequent mistake is assuming that sharing a resource grants permission to use it. Remember: RAM is access discovery, not permission. You must pair RAM shares with appropriate IAM policies. Without IAM permissions, a consumer account can see a shared resource but cannot interact with it.

Another pitfall is sharing resources that shouldn't be shared. While RAM provides the mechanism, you're responsible for the governance decision. Sharing a subnet is usually sensible; sharing a database with sensitive data requires careful consideration of data residency and compliance requirements. Not every resource that *can* be shared *should* be.

Organizations sometimes forget to update resource shares when organizational structure changes. If an OU is deleted or reorganized, resource shares targeting that OU no longer function. Periodic audits prevent these surprises.

### Next Steps and Related Concepts

Resource Access Manager is one pillar of a secure multi-account architecture. It typically works alongside other services: AWS Organizations for account hierarchy and policy management, AWS CloudFormation for deploying consistent infrastructure, and Transit Gateway for complex network routing.

As you design your multi-account environment, consider which resources are true shared utilities—infrastructure that multiple teams consume—and which are isolated per workload. Shared subnets, centralized databases, and common resolver rules are excellent RAM candidates. Team-specific compute resources, unique databases, and application-specific storage typically remain account-local.

The goal is striking a balance: centralizing infrastructure that benefits from unified management while preserving account isolation where it provides security or operational value.

### Conclusion

AWS Resource Access Manager transforms how you approach multi-account infrastructure by making resource sharing straightforward and scalable. Rather than duplicating infrastructure or wrestling with complex cross-account configurations, you designate shareable resources and grant access to consumers—whether they're in specific accounts or across your entire organization. This model aligns well with modern cloud governance: central teams manage shared utilities, application teams focus on their workloads, and infrastructure remains efficient and auditable.

Understanding when and how to use RAM—and recognizing its relationship to IAM, Organizations, and other AWS services—is essential for designing robust multi-account architectures. Start with your organization's clear shared utilities—networking, databases, DNS infrastructure—and expand from there as patterns emerge. Done thoughtfully, RAM becomes the connective tissue that lets multiple accounts work as a coherent whole.
