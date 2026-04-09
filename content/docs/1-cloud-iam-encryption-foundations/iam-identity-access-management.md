---
title: "1. IAM (Identity & Access Management)"
type: docs
weight: 1
---

## IAM (Identity & Access Management)

AWS Identity and Access Management (IAM) is the service that controls **who** can do **what** in your AWS account. Every API call made to AWS — whether from the console, CLI, or SDK — is authenticated and authorized through IAM. Without it, there would be no way to distinguish between a developer who should read S3 buckets and an automated process that should write to DynamoDB. IAM is free and global (not region-scoped), and understanding it deeply is a prerequisite for everything else in AWS. [🔗](https://docs.aws.amazon.com/IAM/latest/UserGuide/introduction.html)

### Users, Groups, Roles, and Policies

IAM is built around four core concepts that work together:

- **Users** represent individual humans or applications that need long-term credentials (a username/password for console access, or access keys for programmatic access). A fresh AWS account comes with a **root user** — an identity with unrestricted access to everything. You should lock it down immediately (enable MFA, don't create access keys for it) and never use it for day-to-day tasks. [🔗](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_root-user.html)

- **Groups** are collections of users. You attach permissions to the group, and all members inherit them. A typical setup might have a `Developers` group with read/write access to certain services, and an `Ops` group with broader infrastructure access. Groups cannot be nested — a group cannot contain another group. [🔗](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_groups.html)

- **Roles** are identities with permissions, but with no long-term credentials attached. Instead of a username and password, a role issues **temporary security credentials** when assumed. Roles are the standard way to grant permissions to AWS services (e.g., an EC2 instance that needs to read from S3), to applications running in Lambda, or to external identities (federated users, other AWS accounts). If you find yourself creating access keys for an application running inside AWS, that's a signal you should be using a role instead. [🔗](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles.html)

- **Policies** are JSON documents that define permissions. They are attached to users, groups, or roles and specify exactly what actions are allowed or denied on which resources. [🔗](https://docs.aws.amazon.com/IAM/latest/UserGuide/access_policies.html)

### Policy Types

Not all policies are the same. Understanding the differences matters for both the exam and real-world debugging.

- **AWS-managed policies** are pre-built by AWS and cover common use cases — `AmazonS3ReadOnlyAccess`, `AdministratorAccess`, and so on. They are maintained by AWS (updated when new service features are added), reusable across your account, but not customizable. Good starting points, not always suitable for production.

- **Customer-managed policies** are policies you create and manage. They live independently in IAM and can be attached to multiple identities. This is the right choice when you need fine-grained, tailored permissions — for example, allowing access only to a specific S3 bucket, or only to DynamoDB tables with a particular name prefix.

- **Inline policies** are embedded directly into a single user, group, or role. They are deleted when the identity is deleted. Use them when a permission should be tightly coupled to one specific identity and shouldn't be reused elsewhere. In practice, customer-managed policies are usually preferred for maintainability.

- **Resource-based policies** are attached directly to a resource rather than to an identity — an S3 bucket policy is the most common example. They specify *who* (which principals) can perform *what* actions on *that resource*, and they can grant cross-account access without requiring the external account to also have an IAM role. [🔗](https://docs.aws.amazon.com/IAM/latest/UserGuide/access_policies_identity-vs-resource.html)

A typical policy document looks like this:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:GetObject", "s3:PutObject"],
      "Resource": "arn:aws:s3:::my-app-bucket/*"
    }
  ]
}
```

Each statement has an `Effect` (`Allow` or `Deny`), a list of `Action`s (API calls), and a `Resource` (the ARN of what the actions apply to). Conditions can be added to restrict further — for example, requiring requests to come from a specific IP range or to use MFA. [🔗](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_elements.html)

### Policy Evaluation Logic

When an IAM principal makes a request, AWS evaluates all applicable policies and reaches an authorization decision. The core rule is: **an explicit `Deny` always wins**, regardless of any `Allow` elsewhere.

The full evaluation order is:

1. If there is an **explicit Deny** in any policy — in an SCP, resource-based policy, identity-based policy, or permission boundary — the request is **denied immediately**.
2. If there is an **explicit Allow** and no Deny, the request is **allowed**.
3. If there is **neither** an Allow nor a Deny, the default is an **implicit Deny**.

For cross-account requests, both the identity-based policy on the caller *and* the resource-based policy (or role trust policy) on the target must allow the action. One side allowing it is not enough. [🔗](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_evaluation-logic.html)

### Least Privilege Principle

IAM's guiding principle is **least privilege**: grant only the permissions needed to perform a task, and nothing more. In practice, this means starting with minimal permissions and adding more as needed — not starting with `AdministratorAccess` and hoping nothing goes wrong. The **IAM Access Advisor** [🔗](https://docs.aws.amazon.com/IAM/latest/UserGuide/access_policies_access-advisor.html) and **IAM credentials report** [🔗](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_credentials_getting-report.html) are two tools that help you audit and tighten permissions:

- The **credentials report** is a CSV export of all IAM users in your account and the status of their credentials — when passwords and access keys were last used, whether MFA is enabled, etc. Useful for compliance audits.
- The **access advisor** shows, for a given user or role, which services were recently accessed and when. If a user has permissions to 20 services but only ever uses 3, you have a clear signal to tighten the policy.

### MFA and Password Policies

Multi-Factor Authentication (MFA) adds a second layer of verification beyond a password. For IAM users with console access, enabling MFA is strongly recommended — especially for accounts with elevated permissions. AWS supports virtual MFA apps (Google Authenticator, Authy), hardware TOTP tokens, and FIDO security keys. [🔗](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_credentials_mfa.html)

For accounts with many IAM users, **IAM password policies** let you enforce requirements across the board — minimum length, required character types, password expiration, and prevention of password reuse. [🔗](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_credentials_passwords_account-policy.html)

### Trust Relationships and Cross-Account Role Assumption

Every IAM role has two parts: a **permissions policy** (what the role can do) and a **trust policy** (who is allowed to assume the role). The trust policy is a resource-based policy attached to the role itself, and it specifies the **principals** — AWS accounts, IAM users, AWS services, or identity providers — that are allowed to call `sts:AssumeRole` on it.

A trust policy that allows EC2 to assume a role looks like:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": { "Service": "ec2.amazonaws.com" },
      "Action": "sts:AssumeRole"
    }
  ]
}
```

For cross-account access, the principal would instead be the ARN of an IAM user or role from the other account. The target account's role trust policy allows the assumption, and the originating account's identity policy must also allow calling `sts:AssumeRole` on that role. Both sides must be configured. [🔗](https://docs.aws.amazon.com/IAM/latest/UserGuide/tutorial_cross-account-with-roles.html)

### STS — Temporary Credentials

AWS Security Token Service (STS) is the underlying service that issues temporary, short-lived credentials whenever a role is assumed. The main STS API calls you'll encounter: [🔗](https://docs.aws.amazon.com/STS/latest/APIReference/welcome.html)

- **`AssumeRole`** — assumes an IAM role and returns temporary credentials (access key, secret key, session token). Used for cross-account access, service-to-service delegation, and granting elevated permissions temporarily.
- **`GetSessionToken`** — issues temporary credentials for an IAM user, commonly used when MFA is required to access certain resources.
- **`AssumeRoleWithWebIdentity`** — allows principals authenticated by a web identity provider (Cognito, Google, Facebook, etc.) to assume an IAM role. Used heavily in mobile and web app architectures where end-users need scoped AWS access.
- **`AssumeRoleWithSAML`** — allows users authenticated via a SAML 2.0-compatible identity provider (Active Directory, Okta, etc.) to assume an IAM role. This powers corporate SSO into AWS. [🔗](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_providers_saml.html)

Temporary credentials expire automatically — they cannot be permanently revoked the way long-term access keys can, though you can reduce their TTL or revoke active sessions on the role itself. [🔗](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_use_revoke-sessions.html)

### IAM Roles for EC2 and Other Services

When an application running on EC2 needs to call an AWS API (read from S3, write to SQS, etc.), the right approach is to attach an **IAM role to the EC2 instance** — not to hardcode access keys in the application. The role is associated with the instance through an **instance profile**, which is a container for the role that EC2 understands. [🔗](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_use_switch-role-ec2_instance-profiles.html)

When the application uses the AWS SDK, it automatically retrieves temporary credentials from the **EC2 Instance Metadata Service (IMDS)** at `http://169.254.169.254/latest/meta-data/iam/security-credentials/<role-name>`. The SDK handles credential refresh transparently. The same pattern applies to Lambda (the execution role), ECS tasks (task roles), and most other compute services.

### Credential Provider Chain

When your code uses the AWS SDK, it doesn't require you to explicitly pass credentials — it looks for them automatically in a **defined order**, stopping at the first match. This is the credential provider chain: [🔗](https://docs.aws.amazon.com/sdkref/latest/guide/standardized-credentials.html)

1. **Environment variables** — `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, optionally `AWS_SESSION_TOKEN`
2. **Shared credentials file** — `~/.aws/credentials` (populated by `aws configure`)
3. **AWS config file** — `~/.aws/config`
4. **Container credentials** — if running in ECS, credentials from the task role via an internal endpoint
5. **Instance profile credentials** — if running on EC2, credentials from the instance metadata service

Understanding this chain is important for debugging unexpected permission errors. For example, if a developer's machine has environment variables set from a previous session, those will override the profile configured in `~/.aws/credentials`. In production on EC2 or Lambda, you should expect the instance/task role to be used — which means those services need no hardcoded credentials at all.

The strong recommendation for any code running inside AWS is to rely on roles and let the SDK resolve credentials automatically via the instance or task metadata endpoint. Hardcoded or long-lived credentials in application code or environment variables are an anti-pattern and a security risk.