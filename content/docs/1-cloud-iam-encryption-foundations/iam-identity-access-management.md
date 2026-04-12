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

{{< qcm >}}
[
{
"question": "Which of the following statements about IAM is correct?",
"answers": [
{
"answer": "IAM is a regional service and must be configured separately for each AWS region.",
"isCorrect": false,
"explanation": "IAM is a global service, not regional. Resources created in IAM (users, roles, policies) are available across all AWS regions."
},
{
"answer": "IAM is a global service and is available at no additional cost.",
"isCorrect": true,
"explanation": "IAM is indeed global (not region-scoped) and is free to use. There are no charges for creating users, groups, roles, or policies."
},
{
"answer": "IAM only controls access for human users accessing the AWS Management Console.",
"isCorrect": false,
"explanation": "IAM authenticates and authorizes every API call to AWS, whether it comes from the console, CLI, SDK, or automated processes."
}
]
},
{
"question": "A company has just created a new AWS account. What are the recommended immediate actions regarding the root user? (Select TWO)",
"answers": [
{
"answer": "Enable MFA on the root user.",
"isCorrect": true,
"explanation": "Enabling MFA on the root user is a critical security best practice. The root user has unrestricted access to everything, so it must be strongly protected."
},
{
"answer": "Create access keys for the root user so it can be used for CLI access.",
"isCorrect": false,
"explanation": "You should never create access keys for the root user. Instead, create IAM users with appropriate permissions for programmatic access."
},
{
"answer": "Use the root user for day-to-day administrative tasks to simplify management.",
"isCorrect": false,
"explanation": "The root user should never be used for day-to-day tasks. Create individual IAM users with only the permissions they need."
},
{
"answer": "Avoid using the root user for routine tasks and instead create individual IAM users.",
"isCorrect": true,
"explanation": "This follows the least privilege principle. The root user should be locked down and only used for tasks that strictly require it (e.g., changing account settings)."
}
]
},
{
"question": "A developer needs to grant the same set of S3 permissions to 20 different IAM users. What is the most efficient and maintainable approach?",
"answers": [
{
"answer": "Create an inline policy and attach it individually to each of the 20 users.",
"isCorrect": false,
"explanation": "Inline policies are embedded in a single identity and cannot be reused. Attaching them to 20 users individually is inefficient and hard to maintain."
},
{
"answer": "Create an IAM group, attach the appropriate S3 policy to the group, and add all 20 users to the group.",
"isCorrect": true,
"explanation": "Groups allow you to manage permissions for multiple users at once. Any policy change on the group automatically applies to all members, making this the most maintainable approach."
},
{
"answer": "Create a nested group hierarchy to organize the users.",
"isCorrect": false,
"explanation": "IAM groups cannot be nested — a group cannot contain another group. This approach is not possible in IAM."
},
{
"answer": "Create a customer-managed policy and attach it to each user individually.",
"isCorrect": false,
"explanation": "While a customer-managed policy is reusable, attaching it individually to 20 users is still harder to maintain than using a group. If you later need to revoke access, you'd have to detach from each user one by one."
}
]
},
{
"question": "What is the key difference between an IAM Role and an IAM User?",
"answers": [
{
"answer": "Roles can only be used by AWS services, while users can only be used by human beings.",
"isCorrect": false,
"explanation": "Roles can be assumed by AWS services, IAM users, applications, or federated identities. IAM users can also be used by applications (via access keys), though roles are the preferred approach for apps running inside AWS."
},
{
"answer": "Roles do not have long-term credentials and instead issue temporary security credentials when assumed.",
"isCorrect": true,
"explanation": "This is the defining characteristic of roles. Unlike users (which have permanent passwords or access keys), roles issue short-lived, temporary credentials via STS each time they are assumed."
},
{
"answer": "Roles can be added to IAM groups, but users cannot.",
"isCorrect": false,
"explanation": "It is the opposite: IAM users can be members of groups, but roles cannot be added to groups."
}
]
},
{
"question": "Which type of IAM policy should a developer use when a permission must be tightly coupled to one specific IAM role and must never be reused by any other identity?",
"answers": [
{
"answer": "AWS-managed policy",
"isCorrect": false,
"explanation": "AWS-managed policies are pre-built by AWS and are designed for reuse across identities. They cannot be customized or tightly coupled to a single identity."
},
{
"answer": "Customer-managed policy",
"isCorrect": false,
"explanation": "Customer-managed policies live independently in IAM and can be attached to multiple identities. They are the preferred choice for fine-grained, reusable permissions — not for identity-specific coupling."
},
{
"answer": "Inline policy",
"isCorrect": true,
"explanation": "Inline policies are embedded directly in a single user, group, or role and are deleted when that identity is deleted. They are the right choice when a permission should not exist independently or be reused."
},
{
"answer": "Resource-based policy",
"isCorrect": false,
"explanation": "Resource-based policies are attached to resources (like S3 buckets), not to identities. They specify who can access that specific resource."
}
]
},
{
"question": "An IAM user has an identity-based policy that explicitly allows `s3:DeleteObject`. A separate SCP explicitly denies `s3:DeleteObject`. What happens when this user attempts to delete an S3 object?",
"answers": [
{
"answer": "The action is allowed, because identity-based policies take precedence over SCPs.",
"isCorrect": false,
"explanation": "Identity-based policies do not take precedence over SCPs. An explicit Deny anywhere in the evaluation chain — including in an SCP — always overrides any Allow."
},
{
"answer": "The action is denied, because an explicit Deny always overrides any Allow.",
"isCorrect": true,
"explanation": "This is the fundamental rule of IAM policy evaluation: an explicit Deny in any applicable policy always wins, regardless of any Allow defined elsewhere."
},
{
"answer": "The action is allowed, because the Allow and Deny cancel each other out, defaulting to the user's permissions.",
"isCorrect": false,
"explanation": "There is no 'canceling out' in IAM. An explicit Deny always takes precedence over any Allow, with no exceptions."
}
]
},
{
"question": "A Lambda function needs to read objects from an S3 bucket in a different AWS account. Which configuration is required for this cross-account access?",
"answers": [
{
"answer": "Only the Lambda execution role in the source account needs to allow the S3 read actions.",
"isCorrect": false,
"explanation": "For cross-account access, configuration on one side alone is not sufficient. Both the identity-based policy on the caller and the resource-based policy on the target must allow the action."
},
{
"answer": "Only the S3 bucket policy in the target account needs to grant access to the Lambda function.",
"isCorrect": false,
"explanation": "While the S3 bucket policy in the target account must grant access, the Lambda execution role in the source account must also explicitly allow the S3 read actions. Both sides must be configured."
},
{
"answer": "Both the Lambda execution role policy in the source account and the S3 bucket policy in the target account must allow the actions.",
"isCorrect": true,
"explanation": "For cross-account requests, AWS requires both the identity-based policy (on the caller side) and the resource-based policy (on the target resource) to allow the action. One side is not enough."
}
]
},
{
"question": "A solutions architect wants to grant an EC2 instance permission to write logs to CloudWatch. What is the recommended approach?",
"answers": [
{
"answer": "Store the AWS access keys in the application's environment variables on the EC2 instance.",
"isCorrect": false,
"explanation": "Hardcoding or storing long-term access keys in environment variables is a security anti-pattern. If the instance is compromised, the credentials are exposed."
},
{
"answer": "Attach an IAM role with the appropriate CloudWatch permissions to the EC2 instance via an instance profile.",
"isCorrect": true,
"explanation": "Attaching an IAM role is the correct and recommended approach. The EC2 instance automatically retrieves temporary credentials from the Instance Metadata Service (IMDS), and the SDK handles refresh transparently."
},
{
"answer": "Embed the access keys directly in the application's source code.",
"isCorrect": false,
"explanation": "Hardcoded credentials in source code are a critical security risk — especially if the code is committed to a version control repository. Always use IAM roles for applications running on AWS."
},
{
"answer": "Create an IAM user for the EC2 instance and distribute its access keys via a config file.",
"isCorrect": false,
"explanation": "Creating IAM users for applications running inside AWS is an anti-pattern. IAM roles provide the same access with temporary credentials that rotate automatically, making them significantly more secure."
}
]
},
{
"question": "An application running on an EC2 instance uses the AWS SDK to access S3. Where does the SDK retrieve the temporary credentials associated with the instance's IAM role?",
"answers": [
{
"answer": "From the IAM service endpoint at `https://iam.amazonaws.com`.",
"isCorrect": false,
"explanation": "The SDK does not query the IAM service endpoint to retrieve instance credentials. It uses the EC2 Instance Metadata Service (IMDS) instead."
},
{
"answer": "From the EC2 Instance Metadata Service (IMDS) at `http://169.254.169.254`.",
"isCorrect": true,
"explanation": "The SDK automatically retrieves temporary credentials from the IMDS at the link-local address `http://169.254.169.254/latest/meta-data/iam/security-credentials/<role-name>`. This is transparent to the application."
},
{
"answer": "From the `~/.aws/credentials` file on the EC2 instance.",
"isCorrect": false,
"explanation": "While the SDK does check `~/.aws/credentials` as part of its credential provider chain, role-based credentials on EC2 come from the IMDS — not from a credentials file."
}
]
},
{
"question": "A developer's application running on EC2 is making API calls with unexpected permissions — different from what the attached IAM role allows. After investigation, the developer suspects a credential conflict. What is the most likely cause?",
"answers": [
{
"answer": "The IAM role trust policy is misconfigured.",
"isCorrect": false,
"explanation": "A misconfigured trust policy would prevent the role from being assumed entirely, causing authentication failures — not unexpected permissions."
},
{
"answer": "Environment variables (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`) are set on the instance and are taking precedence over the instance profile credentials.",
"isCorrect": true,
"explanation": "The AWS SDK credential provider chain checks environment variables first, before instance profile credentials. If environment variables are set (perhaps from a previous session), they will override the IAM role attached to the instance."
},
{
"answer": "The EC2 instance does not support IAM roles and always falls back to the shared credentials file.",
"isCorrect": false,
"explanation": "EC2 instances fully support IAM roles via instance profiles. Instance profile credentials are resolved via the IMDS and are lower in the credential provider chain than environment variables."
}
]
},
{
"question": "Which STS API call should a mobile application use to allow end-users authenticated via Amazon Cognito to obtain temporary AWS credentials scoped to their identity?",
"answers": [
{
"answer": "`sts:GetSessionToken`",
"isCorrect": false,
"explanation": "`GetSessionToken` is used to obtain temporary credentials for an existing IAM user, typically when MFA is required. It is not designed for web/mobile identity federation scenarios."
},
{
"answer": "`sts:AssumeRoleWithWebIdentity`",
"isCorrect": true,
"explanation": "`AssumeRoleWithWebIdentity` is designed exactly for this scenario: it allows principals authenticated by a web identity provider (such as Amazon Cognito, Google, or Facebook) to assume an IAM role and receive temporary AWS credentials."
},
{
"answer": "`sts:AssumeRoleWithSAML`",
"isCorrect": false,
"explanation": "`AssumeRoleWithSAML` is used for corporate SSO scenarios where users are authenticated by a SAML 2.0 identity provider such as Active Directory or Okta — not for web or mobile consumer identity providers."
},
{
"answer": "`sts:AssumeRole`",
"isCorrect": false,
"explanation": "`AssumeRole` is used for role assumption by IAM identities or AWS services (e.g., cross-account access or service delegation). It is not suitable for end-users authenticated via external identity providers."
}
]
},
{
"question": "A company uses Active Directory (AD) with SAML 2.0 federation to allow corporate employees to sign in to AWS using their existing AD credentials. Which STS API call powers this flow?",
"answers": [
{
"answer": "`sts:AssumeRoleWithWebIdentity`",
"isCorrect": false,
"explanation": "`AssumeRoleWithWebIdentity` is for web identity providers (Cognito, Google, Facebook), not for SAML 2.0-based corporate identity providers like Active Directory."
},
{
"answer": "`sts:AssumeRoleWithSAML`",
"isCorrect": true,
"explanation": "`AssumeRoleWithSAML` allows users authenticated by a SAML 2.0-compatible IdP (such as Active Directory or Okta) to obtain temporary AWS credentials, enabling corporate SSO into AWS."
},
{
"answer": "`sts:AssumeRole`",
"isCorrect": false,
"explanation": "`AssumeRole` requires the caller to already have IAM credentials. It does not handle external identity federation via SAML."
}
]
},
{
"question": "Which IAM tool provides a CSV report listing all IAM users in an account along with the status of their passwords, access keys, and MFA enrollment?",
"answers": [
{
"answer": "IAM Access Advisor",
"isCorrect": false,
"explanation": "IAM Access Advisor shows which AWS services a user or role has recently accessed and when — useful for tightening permissions. It does not provide a CSV report on credential status."
},
{
"answer": "IAM credentials report",
"isCorrect": true,
"explanation": "The IAM credentials report is a CSV export that lists all IAM users and the status of their credentials (last password use, access key rotation dates, MFA status, etc.). It is commonly used for compliance audits."
},
{
"answer": "AWS Config",
"isCorrect": false,
"explanation": "AWS Config tracks configuration changes to AWS resources over time. While it can flag IAM compliance issues, it does not produce the specific credentials report described."
},
{
"answer": "AWS Trusted Advisor",
"isCorrect": false,
"explanation": "Trusted Advisor provides recommendations across security, cost, and performance — including some IAM security checks — but it does not generate a per-user credentials status CSV report."
}
]
},
{
"question": "An IAM policy contains the following statement. What does it allow? `{ \"Effect\": \"Allow\", \"Action\": [\"s3:GetObject\", \"s3:PutObject\"], \"Resource\": \"arn:aws:s3:::my-app-bucket/*\" }`",
"answers": [
{
"answer": "Read and write access to all objects inside the `my-app-bucket` S3 bucket.",
"isCorrect": true,
"explanation": "`s3:GetObject` allows reading (downloading) objects, and `s3:PutObject` allows writing (uploading) objects. The resource ARN `arn:aws:s3:::my-app-bucket/*` targets all objects inside that specific bucket."
},
{
"answer": "Full administrative access to the `my-app-bucket` S3 bucket, including deletion and bucket-level operations.",
"isCorrect": false,
"explanation": "The policy only grants `s3:GetObject` and `s3:PutObject`. Actions like `s3:DeleteObject`, `s3:ListBucket`, or bucket-level actions are not included."
},
{
"answer": "Read and write access to all S3 buckets in the account.",
"isCorrect": false,
"explanation": "The `Resource` field is scoped to `arn:aws:s3:::my-app-bucket/*`, which limits the policy to objects inside `my-app-bucket` only — not all buckets."
}
]
},
{
"question": "A developer creates an IAM role for an EC2 instance. What component of an IAM role defines which AWS service (or account) is allowed to assume that role?",
"answers": [
{
"answer": "The permissions policy attached to the role.",
"isCorrect": false,
"explanation": "The permissions policy defines what actions the role is allowed to perform (e.g., read from S3). It does not control who can assume the role."
},
{
"answer": "The trust policy (trust relationship) of the role.",
"isCorrect": true,
"explanation": "The trust policy is a resource-based policy attached to the role that specifies which principals (services, accounts, users) are allowed to call `sts:AssumeRole` on it. For EC2, the principal would be `ec2.amazonaws.com`."
},
{
"answer": "An inline policy embedded in the role.",
"isCorrect": false,
"explanation": "An inline policy defines what the role can do — not who can assume it. The trust relationship is separate from permissions policies."
}
]
},
{
"question": "What is the correct order of the AWS SDK credential provider chain? (Ordered from highest to lowest priority)",
"answers": [
{
"answer": "Instance profile → Shared credentials file → Environment variables → Container credentials",
"isCorrect": false,
"explanation": "This order is reversed. Environment variables have the highest priority in the credential provider chain, while instance profile credentials are checked last."
},
{
"answer": "Environment variables → Shared credentials file → AWS config file → Container credentials → Instance profile",
"isCorrect": true,
"explanation": "This is the correct order. The SDK checks environment variables first, then the shared credentials file, then the config file, then container credentials (ECS), and finally the EC2 instance metadata service."
},
{
"answer": "Shared credentials file → Environment variables → Instance profile → Container credentials",
"isCorrect": false,
"explanation": "Environment variables have higher priority than the shared credentials file, not lower. Understanding this order is important for debugging unexpected credential issues."
}
]
},
{
"question": "Which of the following are valid MFA device types supported by AWS IAM? (Select TWO)",
"answers": [
{
"answer": "Virtual MFA apps such as Google Authenticator or Authy.",
"isCorrect": true,
"explanation": "AWS IAM supports virtual MFA devices — apps that generate time-based one-time passwords (TOTP) — including Google Authenticator, Authy, and compatible apps."
},
{
"answer": "SMS text messages sent to a phone number.",
"isCorrect": false,
"explanation": "AWS IAM does not support SMS-based MFA for IAM users. Supported types are virtual MFA apps, hardware TOTP tokens, and FIDO security keys."
},
{
"answer": "FIDO security keys (e.g., YubiKey).",
"isCorrect": true,
"explanation": "AWS IAM supports FIDO2/WebAuthn security keys such as YubiKey as a hardware MFA option, offering strong phishing-resistant authentication."
},
{
"answer": "Email-based one-time passwords.",
"isCorrect": false,
"explanation": "Email-based OTP is not a supported MFA method for IAM. The supported types are virtual MFA apps, hardware TOTP tokens, and FIDO security keys."
}
]
},
{
"question": "A security audit reveals that several IAM users have permissions to dozens of AWS services but have only ever used three of them in the past six months. Which IAM tool would most directly help identify and remediate this over-provisioning?",
"answers": [
{
"answer": "IAM credentials report",
"isCorrect": false,
"explanation": "The credentials report provides information about credential status (password age, MFA enrollment, key rotation) — not about which services have been accessed."
},
{
"answer": "IAM Access Advisor",
"isCorrect": true,
"explanation": "IAM Access Advisor shows, for a given user or role, which AWS services were recently accessed and when. This directly surfaces unused permissions, making it the right tool for tightening over-provisioned policies."
},
{
"answer": "AWS Trusted Advisor",
"isCorrect": false,
"explanation": "While Trusted Advisor includes some IAM security checks (e.g., flagging unused access keys), it does not provide the granular per-service access history that IAM Access Advisor does."
}
]
},
{
"question": "Which of the following best describes the principle of least privilege as it applies to IAM?",
"answers": [
{
"answer": "Start by granting `AdministratorAccess` to all users and remove permissions as issues are discovered.",
"isCorrect": false,
"explanation": "This is the opposite of least privilege. Starting with full access and reducing it reactively is a security anti-pattern that leaves accounts dangerously over-permissioned."
},
{
"answer": "Grant only the minimum permissions required to perform a specific task, and add more as needed.",
"isCorrect": true,
"explanation": "Least privilege means starting with minimal permissions and expanding them only when there is a justified need. This limits the blast radius of a compromised identity."
},
{
"answer": "Use AWS-managed policies for all identities because they are pre-tuned by AWS for least privilege.",
"isCorrect": false,
"explanation": "AWS-managed policies are broad by design (e.g., `AmazonS3FullAccess`) and often grant more permissions than necessary. Customer-managed policies with fine-grained rules are better suited for enforcing least privilege."
}
]
},
{
"question": "A request to an AWS API results in neither an explicit Allow nor an explicit Deny across all evaluated policies. What is the outcome?",
"answers": [
{
"answer": "The request is allowed by default.",
"isCorrect": false,
"explanation": "AWS does not default to allowing requests. In the absence of an explicit Allow, the default behavior is an implicit Deny."
},
{
"answer": "The request is implicitly denied.",
"isCorrect": true,
"explanation": "If no policy explicitly allows an action, the result is an implicit Deny. AWS requires an explicit Allow for any action to be permitted — there is no 'allow by default.'"
},
{
"answer": "The request is escalated to the account's root user for approval.",
"isCorrect": false,
"explanation": "There is no escalation mechanism in IAM policy evaluation. If no Allow is found, the request is simply denied."
}
]
}
]
{{< /qcm >}}