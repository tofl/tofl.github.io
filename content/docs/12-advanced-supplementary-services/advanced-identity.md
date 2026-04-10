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