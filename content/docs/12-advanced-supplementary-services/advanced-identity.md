---
title: "46. Advanced Identity"
type: docs
weight: 9
---

## Advanced Identity

As AWS environments grow, managing identity across dozens of accounts and integrating with existing corporate directories becomes a challenge. This section covers the tools AWS provides to handle enterprise-scale identity: centralizing account governance, enabling single sign-on, sharing resources, federating with external identity providers, and applying fine-grained access control through attributes.

### AWS Organizations

AWS Organizations [🔗](https://docs.aws.amazon.com/organizations/latest/userguide/orgs_introduction.html) lets you group multiple AWS accounts under a single management structure. Accounts are organized into **Organizational Units (OUs)** — logical containers you can nest hierarchically (e.g., `Root > Production > Backend`).

The key governance mechanism is the **Service Control Policy (SCP)** [🔗](https://docs.aws.amazon.com/organizations/latest/userguide/orgs_manage_policies_scps.html). SCPs are permission guardrails attached to OUs or individual accounts. They don't grant permissions — they restrict what IAM policies *can* grant. For example, you can attach an SCP that prevents any principal in a `Dev` OU from calling `ec2:TerminateInstances` in production regions, regardless of what their IAM role allows.

A critical nuance: **SCPs apply to every principal in an account, including the root user**, except for the management account itself — SCPs never restrict the management account. This makes SCPs a powerful tool for enforcing compliance and preventing accidental or malicious privilege escalation across the org.

Organizations also consolidates billing, so all accounts roll up to a single payer, enabling volume discounts and Reserved Instance sharing.

### IAM Identity Center (SSO)

AWS IAM Identity Center [🔗](https://docs.aws.amazon.com/singlesignon/latest/userguide/what-is.html) (formerly AWS SSO) provides a single place to manage human access to multiple AWS accounts and applications. Instead of creating IAM users in every account, you define **permission sets** (collections of IAM policies) and **assign** them to users or groups for specific accounts.

Users authenticate once through the Identity Center portal and get temporary credentials scoped to whichever account and permission set they need — no long-term IAM credentials involved. Identity Center can use its built-in directory, or be connected to an external IdP (Azure AD, Okta, etc.) via SAML 2.0 or SCIM for user provisioning.

**Typical flow:** A developer logs into the SSO portal → selects the `Staging` account → assumes the `DeveloperAccess` permission set → receives short-lived credentials for that session.

### Resource Access Manager (RAM)

AWS Resource Access Manager (RAM) [🔗](https://docs.aws.amazon.com/ram/latest/userguide/what-is.html) lets you share AWS resources across accounts within your organization without duplicating them. Common use cases include sharing:

- **VPC subnets** — so workloads in multiple accounts can use a centrally managed network
- **Route 53 Resolver rules** — sharing DNS forwarding rules org-wide
- **License Manager configurations**, Transit Gateways, and more

RAM eliminates the need to recreate infrastructure in every account, reducing cost and configuration drift.

### AWS Directory Service

AWS Directory Service [🔗](https://docs.aws.amazon.com/directoryservice/latest/admin-guide/what_is.html) provides managed options for integrating Microsoft Active Directory with AWS:

- **Managed Microsoft AD** — A fully managed AD domain hosted in AWS. Supports trust relationships with your on-premises AD, enabling users to authenticate to AWS resources with their corporate credentials.
- **AD Connector** — A proxy that redirects authentication requests to your existing on-premises AD without caching credentials in AWS. Nothing is stored in AWS; it simply tunnels to your AD.
- **Simple AD** — A lightweight, Samba-based standalone directory for basic LDAP/Kerberos use cases where a full Microsoft AD isn't required.

Use **Managed Microsoft AD** when you need a true AD environment in AWS (e.g., for EC2 instances joined to a domain). Use **AD Connector** when you want AWS services to authenticate against your on-premises AD without replicating it.

### Identity Federation

Federation allows users who exist outside of AWS IAM — in a corporate directory or a public identity provider — to obtain temporary AWS credentials.

**SAML 2.0 Federation** [🔗](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_providers_saml.html) is used for enterprise scenarios. Your corporate IdP (e.g., ADFS, Okta) issues a SAML assertion, which is exchanged with AWS STS (`AssumeRoleWithSAML`) for temporary credentials. This is the basis for how IAM Identity Center federates with external IdPs.

**Web Identity Federation / OIDC** [🔗](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_providers_oidc.html) is used for application-facing scenarios — mobile or web apps where users authenticate with an external OIDC-compatible IdP (Google, Facebook, Amazon Cognito). The app exchanges the OIDC token with STS (`AssumeRoleWithWebIdentity`) for temporary credentials. In practice, **Cognito is the recommended abstraction layer** for this, as it handles token exchange, refresh, and maps users to IAM roles automatically.

### Session Tags and ABAC

Attribute-Based Access Control (ABAC) [🔗](https://docs.aws.amazon.com/IAM/latest/UserGuide/introduction_attribute-based-access-control.html) is a scalable authorization strategy where access decisions are based on **tags** attached to both IAM principals and AWS resources, rather than on explicit role-to-resource mappings.

**Session tags** [🔗](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_session-tags.html) are key-value pairs passed into a role assumption request (via `AssumeRole`, `AssumeRoleWithSAML`, etc.). These tags are then available as `aws:PrincipalTag` condition keys in IAM policies.

**Example:** A policy allows a developer to access only DynamoDB tables that share the same `Project` tag as the principal:

```json
"Condition": {
  "StringEquals": {
    "aws:ResourceTag/Project": "${aws:PrincipalTag/Project}"
  }
}
```

With ABAC, you don't need to create a new role for every project or team — the same policy scales dynamically based on tag values. This is especially powerful in organizations where resources and teams are created frequently, since access is governed by consistent tagging conventions rather than proliferating IAM roles.

{{< qcm >}}
[
{
"question": "A company uses AWS Organizations with multiple OUs. A security team wants to ensure that no account in the 'Dev' OU can delete S3 buckets, regardless of what IAM policies exist in those accounts. What is the most appropriate solution?",
"answers": [
{
"answer": "Attach a Service Control Policy (SCP) to the 'Dev' OU that denies s3:DeleteBucket.",
"isCorrect": true,
"explanation": "SCPs act as permission guardrails on OUs. Attaching a Deny SCP for s3:DeleteBucket to the 'Dev' OU ensures no principal in any account within that OU can perform this action, regardless of their IAM policies."
},
{
"answer": "Create an IAM policy in each Dev account that denies s3:DeleteBucket and attach it to all roles.",
"isCorrect": false,
"explanation": "Managing IAM policies per account is error-prone and doesn't scale. Administrators with sufficient permissions could modify or bypass those policies. SCPs are the correct centralized governance mechanism."
},
{
"answer": "Attach a Service Control Policy (SCP) to the management account to deny s3:DeleteBucket.",
"isCorrect": false,
"explanation": "SCPs attached to the management account do not restrict the management account itself. To restrict Dev accounts, the SCP must be attached to the 'Dev' OU (or individual member accounts)."
},
{
"answer": "Enable AWS Config rules in each Dev account to detect and remediate S3 bucket deletions.",
"isCorrect": false,
"explanation": "AWS Config detects and can remediate non-compliant configurations after the fact, but it does not preventively block API actions. SCPs provide proactive enforcement."
}
]
},
{
"question": "Which of the following statements about Service Control Policies (SCPs) in AWS Organizations is correct?",
"answers": [
{
"answer": "SCPs can grant permissions to IAM principals in member accounts.",
"isCorrect": false,
"explanation": "SCPs never grant permissions. They only restrict what IAM policies can grant. Actual permissions must still be granted through IAM policies within each account."
},
{
"answer": "SCPs apply to all principals in a member account, including the root user of that account.",
"isCorrect": true,
"explanation": "SCPs apply to every principal in a member account, including the root user. This is a critical security feature, as it prevents even the account root from performing restricted actions."
},
{
"answer": "SCPs restrict the management account in the same way they restrict member accounts.",
"isCorrect": false,
"explanation": "SCPs never restrict the management account. This is an important exception — the management account is always exempt from SCP restrictions."
},
{
"answer": "SCPs can only be attached to individual accounts, not to Organizational Units.",
"isCorrect": false,
"explanation": "SCPs can be attached to both Organizational Units (OUs) and individual accounts, giving flexible control over which accounts are governed by a given policy."
}
]
},
{
"question": "A company wants to allow its developers to access multiple AWS accounts using a single login, without creating IAM users in each account. Which AWS service best addresses this requirement?",
"answers": [
{
"answer": "AWS IAM Identity Center (SSO)",
"isCorrect": true,
"explanation": "IAM Identity Center allows users to authenticate once through a central portal and access multiple AWS accounts using permission sets, without requiring individual IAM users in each account."
},
{
"answer": "AWS Directory Service (AD Connector)",
"isCorrect": false,
"explanation": "AD Connector proxies authentication to an on-premises Active Directory. It does not by itself provide a single sign-on portal for accessing multiple AWS accounts."
},
{
"answer": "AWS Resource Access Manager (RAM)",
"isCorrect": false,
"explanation": "RAM is used to share AWS resources (like VPC subnets) across accounts. It does not manage user authentication or single sign-on."
},
{
"answer": "AWS STS with AssumeRole",
"isCorrect": false,
"explanation": "AssumeRole can be used to switch roles across accounts, but it requires manual configuration per account and per user. IAM Identity Center provides a centralized, managed alternative."
}
]
},
{
"question": "In AWS IAM Identity Center, what is a 'permission set'?",
"answers": [
{
"answer": "A collection of IAM policies assigned to users or groups for specific AWS accounts.",
"isCorrect": true,
"explanation": "Permission sets define the level of access a user or group has when accessing a particular AWS account through Identity Center. They are reusable collections of IAM policies."
},
{
"answer": "A type of SCP that restricts what actions a user can perform across the organization.",
"isCorrect": false,
"explanation": "SCPs are AWS Organizations constructs. Permission sets are Identity Center-specific and define what access is granted, not what is restricted at the org level."
},
{
"answer": "A set of SAML attributes sent from an external IdP to AWS.",
"isCorrect": false,
"explanation": "SAML attributes are part of the federation flow. Permission sets are predefined access definitions within Identity Center, independent of the SAML assertion itself."
},
{
"answer": "Long-term IAM credentials scoped to a specific account.",
"isCorrect": false,
"explanation": "Identity Center issues short-lived, temporary credentials — not long-term credentials. This is one of its key security advantages over traditional IAM users."
}
]
},
{
"question": "A company has workloads running in three separate AWS accounts and wants to allow them to communicate over a centrally managed VPC without replicating the network infrastructure in each account. Which AWS service should they use?",
"answers": [
{
"answer": "AWS Resource Access Manager (RAM)",
"isCorrect": true,
"explanation": "RAM allows sharing of VPC subnets (and other resources) across accounts within an organization. Workloads in different accounts can use the shared subnets without duplicating the network setup."
},
{
"answer": "AWS Organizations",
"isCorrect": false,
"explanation": "AWS Organizations handles account governance and billing consolidation. It does not share infrastructure resources like VPC subnets across accounts."
},
{
"answer": "VPC Peering",
"isCorrect": false,
"explanation": "VPC Peering connects two VPCs but does not share a single VPC's subnets across accounts. RAM is specifically designed for this cross-account resource sharing use case."
},
{
"answer": "AWS IAM Identity Center",
"isCorrect": false,
"explanation": "IAM Identity Center manages user authentication and access across accounts. It does not share networking resources."
}
]
},
{
"question": "Which AWS Directory Service option should be used when a company wants AWS services to authenticate against their existing on-premises Active Directory, without storing any credentials or directory data in AWS?",
"answers": [
{
"answer": "AD Connector",
"isCorrect": true,
"explanation": "AD Connector acts as a proxy that redirects authentication requests to the on-premises AD. No credentials or directory data are cached or stored in AWS, making it ideal for this requirement."
},
{
"answer": "Managed Microsoft AD",
"isCorrect": false,
"explanation": "Managed Microsoft AD is a fully managed AD domain hosted in AWS. It stores directory data in AWS and is used when you need an actual AD environment in AWS, not just a proxy to on-premises AD."
},
{
"answer": "Simple AD",
"isCorrect": false,
"explanation": "Simple AD is a Samba-based standalone directory for basic LDAP/Kerberos use cases. It is not connected to an on-premises AD and stores its own directory data."
},
{
"answer": "AWS IAM Identity Center with an external IdP",
"isCorrect": false,
"explanation": "While IAM Identity Center can federate with external IdPs, the question specifically requires proxying to on-premises AD without storing data in AWS — which is what AD Connector is designed for."
}
]
},
{
"question": "A company is setting up EC2 instances that need to be domain-joined to an Active Directory for Windows authentication. They want the AD to run in AWS with a trust relationship to their on-premises AD. Which AWS Directory Service option is most appropriate?",
"answers": [
{
"answer": "Managed Microsoft AD",
"isCorrect": true,
"explanation": "Managed Microsoft AD is a fully managed AD domain hosted in AWS that supports domain-joining EC2 instances and creating trust relationships with on-premises AD domains."
},
{
"answer": "AD Connector",
"isCorrect": false,
"explanation": "AD Connector is a proxy and does not support domain-joining EC2 instances. It simply redirects authentication requests to an existing on-premises AD."
},
{
"answer": "Simple AD",
"isCorrect": false,
"explanation": "Simple AD is a lightweight Samba-based directory. It does not support trust relationships with Microsoft AD environments and is not suitable for full AD integration scenarios."
}
]
},
{
"question": "A mobile application allows users to sign in with Google. After authentication, the app needs to call AWS services on behalf of the user. What is the recommended approach?",
"answers": [
{
"answer": "Use Amazon Cognito to handle the OIDC token exchange and map users to IAM roles for temporary AWS credentials.",
"isCorrect": true,
"explanation": "Cognito is the recommended abstraction layer for web/mobile identity federation. It handles token exchange, refresh, and maps authenticated users to IAM roles automatically, avoiding the need to call STS directly."
},
{
"answer": "Use SAML 2.0 federation with AWS STS AssumeRoleWithSAML to exchange the Google token for AWS credentials.",
"isCorrect": false,
"explanation": "AssumeRoleWithSAML is for enterprise SAML-based federation (e.g., ADFS, Okta), not for OIDC providers like Google. The correct STS call for OIDC is AssumeRoleWithWebIdentity."
},
{
"answer": "Create an IAM user for each end-user and embed long-term credentials in the mobile app.",
"isCorrect": false,
"explanation": "Embedding IAM credentials in a mobile app is a serious security anti-pattern. Temporary credentials via federation are always preferred for end-user scenarios."
},
{
"answer": "Use IAM Identity Center to federate Google users into AWS accounts.",
"isCorrect": false,
"explanation": "IAM Identity Center is designed for workforce (employee) access to AWS accounts, not for consumer-facing mobile app scenarios. Cognito is designed for application user identity."
}
]
},
{
"question": "Which AWS STS API action is used when an enterprise user authenticates via their corporate IdP (e.g., ADFS) and exchanges a SAML assertion for temporary AWS credentials?",
"answers": [
{
"answer": "AssumeRoleWithSAML",
"isCorrect": true,
"explanation": "AssumeRoleWithSAML is the STS API call used in SAML 2.0 federation. The corporate IdP issues a SAML assertion, which is exchanged with STS for short-term AWS credentials."
},
{
"answer": "AssumeRoleWithWebIdentity",
"isCorrect": false,
"explanation": "AssumeRoleWithWebIdentity is used for OIDC-based federation (e.g., Google, Cognito). SAML 2.0 federation uses AssumeRoleWithSAML instead."
},
{
"answer": "AssumeRole",
"isCorrect": false,
"explanation": "AssumeRole is a generic role assumption call used within AWS (e.g., cross-account access). It does not handle SAML assertions from external identity providers."
},
{
"answer": "GetFederationToken",
"isCorrect": false,
"explanation": "GetFederationToken is a legacy STS call that creates temporary credentials for a federated user but does not handle SAML assertion exchanges from an external IdP."
}
]
},
{
"question": "A developer is assuming a role using AssumeRole and passes session tags: `Project=AlphaTeam` and `Environment=Staging`. An IAM policy uses the condition `aws:PrincipalTag/Project`. What does this condition evaluate against?",
"answers": [
{
"answer": "The value of the 'Project' session tag passed during role assumption.",
"isCorrect": true,
"explanation": "Session tags passed during AssumeRole become available as `aws:PrincipalTag` condition keys in IAM policies, enabling attribute-based access control based on the values set at role assumption time."
},
{
"answer": "The tags attached to the IAM role itself in IAM.",
"isCorrect": false,
"explanation": "Tags on the IAM role resource are not automatically used in `aws:PrincipalTag`. This condition key specifically evaluates session tags passed during the AssumeRole call."
},
{
"answer": "The tags of the AWS resource being accessed.",
"isCorrect": false,
"explanation": "Resource tags are referenced with `aws:ResourceTag/key`, not `aws:PrincipalTag/key`. The PrincipalTag condition refers to attributes of the requesting principal."
},
{
"answer": "The AWS account ID of the caller.",
"isCorrect": false,
"explanation": "The account ID is accessed via `aws:PrincipalAccount`. `aws:PrincipalTag` specifically refers to session or principal tags, not account-level identifiers."
}
]
},
{
"question": "A company manages hundreds of projects and wants developers to access only DynamoDB tables tagged with the same project as their IAM principal. What is the most scalable approach to implement this?",
"answers": [
{
"answer": "Use Attribute-Based Access Control (ABAC) with session tags and an IAM policy condition that compares aws:PrincipalTag/Project to aws:ResourceTag/Project.",
"isCorrect": true,
"explanation": "ABAC with session tags allows a single policy to dynamically control access based on matching tags, eliminating the need to create separate roles or policies for each project."
},
{
"answer": "Create a dedicated IAM role for each project with explicit DynamoDB table ARNs in the resource policy.",
"isCorrect": false,
"explanation": "Creating a role per project does not scale well. With hundreds of projects, this approach results in an unmanageable proliferation of IAM roles and policies."
},
{
"answer": "Use AWS Organizations SCPs to restrict DynamoDB table access per project.",
"isCorrect": false,
"explanation": "SCPs are guardrails at the OU/account level and do not support fine-grained, attribute-based resource matching like ABAC does."
},
{
"answer": "Use resource-based policies on each DynamoDB table to grant access per developer.",
"isCorrect": false,
"explanation": "DynamoDB tables do not support resource-based policies. Furthermore, managing individual policies per table and developer does not scale for hundreds of projects."
}
]
},
{
"question": "Which of the following are valid use cases for AWS Resource Access Manager (RAM)? (Select TWO)",
"answers": [
{
"answer": "Sharing VPC subnets across multiple AWS accounts in an organization.",
"isCorrect": true,
"explanation": "RAM supports sharing VPC subnets, allowing workloads in different accounts to use a centrally managed network without duplicating infrastructure."
},
{
"answer": "Sharing Route 53 Resolver rules org-wide for consistent DNS forwarding.",
"isCorrect": true,
"explanation": "Route 53 Resolver rules are one of the supported resource types in RAM, enabling consistent DNS resolution across all accounts without per-account configuration."
},
{
"answer": "Sharing IAM roles across AWS accounts.",
"isCorrect": false,
"explanation": "IAM roles are not shareable via RAM. Cross-account role access is achieved through IAM trust policies (AssumeRole), not RAM."
},
{
"answer": "Centralizing CloudTrail logs from multiple accounts into a single S3 bucket.",
"isCorrect": false,
"explanation": "Centralizing CloudTrail logs is done through CloudTrail organization trails and S3 bucket policies, not via RAM."
}
]
},
{
"question": "A company's IAM Identity Center is connected to Okta as an external identity provider. What protocol is used for user provisioning (automatically syncing users and groups from Okta to Identity Center)?",
"answers": [
{
"answer": "SCIM (System for Cross-domain Identity Management)",
"isCorrect": true,
"explanation": "SCIM is the protocol used for automated user provisioning — syncing users and groups from an external IdP like Okta into IAM Identity Center, keeping memberships up to date automatically."
},
{
"answer": "SAML 2.0",
"isCorrect": false,
"explanation": "SAML 2.0 is used for authentication (federated sign-in). Provisioning (syncing user/group data) is handled separately via SCIM."
},
{
"answer": "OIDC",
"isCorrect": false,
"explanation": "OIDC is an authentication protocol used in web identity federation scenarios. User provisioning into Identity Center is done via SCIM, not OIDC."
},
{
"answer": "LDAP",
"isCorrect": false,
"explanation": "LDAP is used by on-premises directory services. IAM Identity Center uses SCIM for provisioning with external cloud IdPs like Okta or Azure AD."
}
]
},
{
"question": "An organization uses AWS Organizations. They want to consolidate billing across all accounts AND enforce that no account can purchase Reserved Instances without approval. Which features of AWS Organizations address both requirements? (Select TWO)",
"answers": [
{
"answer": "Consolidated billing, which rolls up all accounts under a single payer.",
"isCorrect": true,
"explanation": "AWS Organizations automatically consolidates billing across all member accounts, enabling a single payer and unlocking volume discounts and Reserved Instance sharing."
},
{
"answer": "A Service Control Policy (SCP) that denies ec2:PurchaseReservedInstancesOffering.",
"isCorrect": true,
"explanation": "SCPs can restrict any AWS API action, including purchasing Reserved Instances, ensuring no member account can do so without the policy being modified at the org level."
},
{
"answer": "RAM sharing of Reserved Instances across accounts.",
"isCorrect": false,
"explanation": "RAM does not share Reserved Instances. Reserved Instance benefits are shared within an organization through consolidated billing automatically, not through RAM."
},
{
"answer": "IAM Identity Center permission sets that allow billing actions.",
"isCorrect": false,
"explanation": "Permission sets control access for human users via Identity Center. They do not enforce org-wide restrictions like preventing Reserved Instance purchases — that is an SCP's role."
}
]
},
{
"question": "What is a key difference between Managed Microsoft AD and AD Connector in AWS Directory Service?",
"answers": [
{
"answer": "Managed Microsoft AD hosts a real Active Directory in AWS and supports EC2 domain join, while AD Connector only proxies requests to an existing on-premises AD without storing data in AWS.",
"isCorrect": true,
"explanation": "This is the fundamental distinction. Managed Microsoft AD creates a new AD domain in AWS (useful for cloud-native AD needs), while AD Connector is a lightweight proxy to an existing on-premises AD."
},
{
"answer": "AD Connector supports trust relationships with on-premises AD, while Managed Microsoft AD does not.",
"isCorrect": false,
"explanation": "It's the reverse: Managed Microsoft AD supports trust relationships with on-premises AD. AD Connector simply proxies to on-premises AD without establishing a separate trust."
},
{
"answer": "Both services store Active Directory data in AWS, but Managed Microsoft AD stores more data.",
"isCorrect": false,
"explanation": "AD Connector stores no directory data in AWS. Only Managed Microsoft AD maintains directory data within AWS infrastructure."
},
{
"answer": "Simple AD is the recommended option when trust relationships with on-premises AD are required.",
"isCorrect": false,
"explanation": "Simple AD does not support trust relationships with Microsoft AD. Managed Microsoft AD is the appropriate choice when AD trust relationships are needed."
}
]
},
{
"question": "A team uses ABAC with session tags. A developer assumes a role with the session tag `Team=Backend`. An IAM policy grants access to S3 buckets where `aws:ResourceTag/Team` equals `aws:PrincipalTag/Team`. Which S3 buckets can this developer access?",
"answers": [
{
"answer": "Only S3 buckets tagged with Team=Backend.",
"isCorrect": true,
"explanation": "The ABAC policy condition compares the resource tag to the principal's session tag. Since the developer's session has Team=Backend, only resources tagged Team=Backend match the condition."
},
{
"answer": "All S3 buckets in the account, because the IAM role has S3 access.",
"isCorrect": false,
"explanation": "The ABAC condition scopes access to only those resources whose tags match the principal's session tags. Without a matching tag, access is denied even if the role has a broad S3 policy."
},
{
"answer": "S3 buckets with no tags, since untagged resources don't violate the condition.",
"isCorrect": false,
"explanation": "If a resource has no matching tag, the condition evaluates to false and access is denied. ABAC requires explicit tag matching to grant access."
},
{
"answer": "S3 buckets tagged with any value for the 'Team' key.",
"isCorrect": false,
"explanation": "The StringEquals condition requires an exact match. Buckets tagged Team=Frontend or Team=DevOps would not match Team=Backend, so access would be denied."
}
]
},
{
"question": "Which of the following correctly describes the authentication flow when using IAM Identity Center with an external SAML 2.0 identity provider?",
"answers": [
{
"answer": "The user logs into the Identity Center portal, which redirects authentication to the external IdP. The IdP issues a SAML assertion, and Identity Center exchanges it for temporary AWS credentials scoped to the selected account and permission set.",
"isCorrect": true,
"explanation": "This is the correct federated SSO flow: the user authenticates via the external IdP, receives a SAML assertion, and Identity Center converts this into short-lived AWS credentials for the appropriate account/permission set."
},
{
"answer": "The user calls AssumeRoleWithSAML directly against AWS STS using credentials from the external IdP, bypassing Identity Center.",
"isCorrect": false,
"explanation": "While AssumeRoleWithSAML is the underlying STS mechanism, when using Identity Center the portal abstracts this process. Users don't interact with STS directly."
},
{
"answer": "The external IdP creates IAM users in each AWS account when a user first authenticates.",
"isCorrect": false,
"explanation": "IAM Identity Center specifically avoids creating per-account IAM users. It uses temporary credentials and permission sets, which is a key advantage over traditional IAM user management."
},
{
"answer": "Identity Center requires users to provide their AWS account credentials before accessing the external IdP.",
"isCorrect": false,
"explanation": "The flow is the opposite: users authenticate with their corporate identity (via the external IdP) first, then access AWS. No AWS-specific credentials are required upfront."
}
]
}
]
{{< /qcm >}}