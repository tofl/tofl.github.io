---
title: "How to Use IAM Identity Center (formerly AWS SSO) for Developer Access"
---

## How to Use IAM Identity Center (formerly AWS SSO) for Developer Access

If you've been managing developer access to AWS by creating individual IAM users and issuing long-term access keys, you're using an approach that's falling behind modern security best practices. AWS has moved decisively toward IAM Identity Center as the recommended way to grant human users access to AWS accounts—and for good reason. It's more secure, easier to manage at scale, and integrates seamlessly with your development workflow.

In this article, we'll explore what IAM Identity Center is, how it differs from traditional IAM user management, and how to set it up so your development team can authenticate securely using temporary credentials. By the end, you'll understand why this shift matters and how to implement it in your own environment.

### The Problem With Long-Term IAM Access Keys

Before we dive into the solution, let's acknowledge why the old way of doing things has fallen out of favor.

When you create an IAM user and generate access keys, you're creating a long-lived credential that essentially never expires (unless you explicitly rotate it). This credential typically gets stored in a configuration file on a developer's laptop, in environment variables, or worse—hardcoded into application code or shared via Slack. Each of these scenarios presents a security risk. The longer a credential exists, the longer the window of opportunity for it to be compromised, leaked, or misused.

Managing these credentials across a growing team becomes administratively complex, too. You need to track who has which keys, enforce rotation policies, audit key usage, and revoke access when someone leaves the team or changes roles. Scale this to dozens or hundreds of developers, and the operational burden becomes substantial.

IAM Identity Center solves these problems by replacing long-lived keys with a different authentication model entirely: temporary, short-lived credentials managed by AWS.

### What Is IAM Identity Center?

IAM Identity Center (formerly known as AWS SSO) is AWS's identity and access management service designed specifically for human users. Unlike IAM, which was built around service-to-service authentication and programmatic access, IAM Identity Center is built around the needs of actual people accessing AWS resources.

At its core, IAM Identity Center provides single sign-on capabilities, meaning your developers authenticate once and gain access to multiple AWS accounts and applications. It acts as an identity broker between your corporate identity provider (or its own built-in directory) and your AWS environment.

The key innovation for developers is that IAM Identity Center handles the credential lifecycle for you. Instead of storing permanent access keys, developers authenticate interactively—typically using their existing corporate credentials—and receive temporary credentials valid for a configurable duration (usually one hour by default). When those credentials expire, the developer reauthenticates to get a fresh set.

### How IAM Identity Center Issues Temporary Credentials

Understanding the credential flow helps clarify why this approach is superior to long-term keys.

When a developer wants to access AWS, they initiate a login through IAM Identity Center. This can happen through the AWS Management Console, or more commonly for developers, through the AWS CLI. The developer provides their credentials to IAM Identity Center (which might be a username and password, or might be federated from an external identity provider like Okta, Azure AD, or your corporate directory).

IAM Identity Center validates these credentials. If they're valid, it creates a temporary security token—specifically, it assumes an IAM role on behalf of the user and returns temporary credentials consisting of an access key, secret key, and session token. These credentials are valid only for the duration specified in the IAM Identity Center configuration, typically one hour.

Critically, these are not the same as long-term IAM user access keys. The session token acts as a cryptographic proof that these credentials were issued by the identity center and haven't been tampered with. When the developer uses these credentials to call AWS APIs, the session token is validated as part of the request. The credentials simply cannot be used after they expire—there's no way to extend them or use them indefinitely.

The developer's computer stores these temporary credentials (the AWS CLI handles this automatically), uses them for API calls, and when they expire, the developer reauthenticates to get a fresh set. This entire flow is transparent and requires minimal intervention from the developer.

### Setting Up IAM Identity Center

Let's walk through the practical steps to get IAM Identity Center running for your development team.

#### Enabling IAM Identity Center

First, you need to enable IAM Identity Center in your AWS environment. Navigate to the IAM Identity Center console and select "Enable" if it's not already active. When you enable it for the first time, AWS creates a default organization and sets up the necessary foundational infrastructure. You'll also need to configure your identity source—this is where IAM Identity Center learns about your users and groups.

IAM Identity Center offers three identity source options: the AWS managed directory (a simple directory built into IAM Identity Center), your existing Active Directory or Okta instance via identity provider federation, or external identity providers through SAML. For many development teams, the AWS managed directory is sufficient if you don't have an existing identity system, though most enterprises federate with their corporate identity provider.

#### Creating Users and Groups

Once identity source is configured, you'll create users and groups. If you're using the AWS managed directory, you do this directly in the IAM Identity Center console. You can create groups like "frontend-developers," "backend-developers," or "devops-team" and assign users to them.

If you're federating with an external provider, users and groups are created in that provider, and IAM Identity Center simply pulls the membership information. This is more scalable for larger organizations because you manage identities in one place.

#### Setting Up Permission Sets

This is where you define what your developers can actually do in AWS. A permission set is an IAM Identity Center concept that represents a collection of IAM policies. You might create a permission set called "DeveloperAccess" that includes policies allowing EC2, S3, Lambda, and CloudWatch access, but not IAM or billing permissions.

You create a permission set by selecting the policies you want it to contain—these can be AWS managed policies or custom policies you've written. Then you assign the permission set to users or groups, specifying which AWS accounts they apply to.

For example, you might assign the "DeveloperAccess" permission set to the "backend-developers" group in your development AWS account, while assigning a more restrictive "ReadOnlyAccess" permission set to the same group in your production account. This gives developers full access where they're building and testing, but read-only visibility into production.

#### Account Assignment

Account assignments connect users or groups to specific AWS accounts with a particular permission set. This is straightforward: you select a user or group, an AWS account, and a permission set, and IAM Identity Center handles the rest. Internally, it creates IAM roles in those accounts and manages the trust relationships.

Once you've completed this setup, your developers can authenticate and gain access immediately. They don't need to wait for you to create IAM users, generate keys, or manage key rotation.

### Integrating IAM Identity Center With the AWS CLI v2

This is where the user experience really shines. AWS CLI v2 has built-in, first-class support for IAM Identity Center, making it nearly effortless for developers to use temporary credentials.

#### Configuring the AWS CLI for IAM Identity Center

Configuration starts with a one-time setup. A developer runs:

```bash
aws configure sso
```

This launches an interactive prompt. The developer provides the IAM Identity Center start URL (something like `https://my-org.awsapps.com/start`), the region where IAM Identity Center is enabled (typically `us-east-1`), and selects their account and role from a list.

The CLI generates a configuration profile that references the IAM Identity Center configuration. Here's what a sample profile in `~/.aws/config` looks like:

```
[profile dev]
sso_start_url = https://my-org.awsapps.com/start
sso_region = us-east-1
sso_account_id = 123456789012
sso_role_name = DeveloperAccess
region = us-west-2
```

Notice there's no access key or secret key anywhere. Just a reference to the IAM Identity Center configuration and the role the developer is entitled to assume.

#### Using the Credentials

When a developer runs any AWS CLI command using this profile:

```bash
aws s3 ls --profile dev
```

The CLI checks if there's a valid cached session token from IAM Identity Center. If there is and it hasn't expired, the command executes immediately using the cached temporary credentials. If the token is expired or doesn't exist, the CLI opens a browser and directs the developer to IAM Identity Center's login page.

The developer authenticates (entering their password or authenticating through their corporate identity provider), and IAM Identity Center redirects them back to the CLI with a valid session token. The CLI stores this token and uses it to request temporary credentials, which are cached locally.

From that point on, the developer can run AWS CLI commands without reauthenticating for the duration of the session (typically one hour). They don't need to think about access keys, rotation, or credential management. When the session expires, they simply reauthenticate the next time they run an AWS CLI command.

#### Multiple Profiles and Switching Accounts

Developers often need access to multiple AWS accounts or roles. IAM Identity Center handles this elegantly. A developer can configure multiple profiles, each pointing to a different account and role:

```
[profile dev]
sso_start_url = https://my-org.awsapps.com/start
sso_region = us-east-1
sso_account_id = 111111111111
sso_role_name = DeveloperAccess
region = us-west-2

[profile staging]
sso_start_url = https://my-org.awsapps.com/start
sso_region = us-east-1
sso_account_id = 222222222222
sso_role_name = DeveloperAccess
region = us-west-2

[profile prod]
sso_start_url = https://my-org.awsapps.com/start
sso_region = us-east-1
sso_account_id = 333333333333
sso_role_name = ReadOnlyAccess
region = us-west-2
```

They can switch between accounts by changing the profile:

```bash
aws ec2 describe-instances --profile dev
aws ec2 describe-instances --profile prod
```

If a session has expired, the CLI reauthenticates transparently. This seamless switching across accounts is a significant quality-of-life improvement over managing separate long-term keys for each account.

### Why IAM Identity Center Is Better Than Long-Term Keys

Let's step back and look at the security and operational advantages more explicitly.

**Temporary credentials reduce the blast radius of compromise.** If a developer's laptop is stolen or their credentials are leaked, the damage is automatically limited to an hour (or whatever duration you've configured). A long-term access key could potentially be exploited indefinitely.

**Credential rotation happens automatically.** With long-term keys, you need policies to enforce periodic rotation—and then you need to actually monitor compliance with those policies. With IAM Identity Center, every session is implicitly a new credential. The developer doesn't need to do anything.

**Identity remains centralized and auditable.** All authentication events flow through IAM Identity Center, which logs them to CloudTrail. You can see exactly when someone authenticated, from where, and what they accessed. This visibility is crucial for compliance and incident response. Long-term keys, by contrast, provide no authentication audit trail—you only see the key being used, not who was actually using it.

**Onboarding and offboarding are simpler.** When a new developer joins, you add them to the identity source and assign them to a group with appropriate permission sets. They're ready to go. When someone leaves, you deactivate their user in the identity source, and all their access to all AWS accounts is immediately revoked. No need to hunt down and delete individual IAM users and keys.

**It scales better.** Managing dozens of long-term keys becomes administratively burdensome. Permission sets and group-based assignment scale to hundreds or thousands of users with minimal operational overhead.

**It integrates with your existing identity infrastructure.** If you're already using Active Directory, Okta, or another identity provider, IAM Identity Center federates with it. Your developers use their existing corporate credentials. You're not maintaining a separate identity system just for AWS.

### Common Considerations and Best Practices

As you roll out IAM Identity Center, keep a few things in mind.

**Session duration and reauthentication frequency.** IAM Identity Center allows you to set session duration anywhere from one to twelve hours. Shorter durations are more secure but mean developers reauthenticate more frequently. Most organizations find one to two hours is a good balance. You can also allow developers to refresh their session within a certain window, so if a session is about to expire while they're actively working, they can request a new one without a full reauthentication.

**Programmatic access for CI/CD.** Developers aren't the only ones who need access to AWS. CI/CD pipelines, automated tests, and other programmatic workloads also need credentials. IAM Identity Center works great for human access but doesn't directly address programmatic access. For CI/CD, you typically use IAM roles (specifically, if your CI/CD system runs on EC2 or ECS, you use instance profiles; if it's GitHub Actions or another external service, you use OpenID Connect federation). The point is that IAM Identity Center solves the human access problem, but you still need a separate strategy for programmatic access.

**Permission sets and least privilege.** Take time to think carefully about your permission sets. The temptation is to create a single "FullDeveloperAccess" set and assign it to everyone, but this violates the principle of least privilege. Instead, create role-specific sets like "FrontendDeveloperAccess," "BackendDeveloperAccess," and "DevOpsEngineerAccess," each tailored to the minimum permissions that role needs. This is easier to manage with IAM Identity Center than with traditional IAM users because you're managing templates (permission sets) rather than individual credentials.

**Federation with external identity providers.** If you're federating with an external provider, ensure that provider is healthy and responsive. If authentication against the external provider fails, developers can't access AWS. Consider maintaining a break-glass manual access method—perhaps a secondary IAM Identity Center configuration using the AWS managed directory—for emergency situations.

**CLI caching and shared credentials.** By default, the AWS CLI v2 caches IAM Identity Center session tokens in a file on the developer's computer. These cached tokens are valid until they expire. On shared machines or in environments where multiple people might access the same computer, be aware that anyone with access to the credentials file could use the cached token. In most cases, this is acceptable (developers on the same team likely have the same permissions anyway), but it's worth understanding.

### Migration From Long-Term Keys

If you currently issue long-term access keys to developers, you don't need to migrate everyone overnight. IAM Identity Center and traditional IAM users can coexist. You might start by enabling IAM Identity Center, setting it up with a pilot group of developers, and monitoring its effectiveness. Once you're confident it works for your use case, gradually encourage or require other developers to switch to IAM Identity Center.

When you do migrate, plan to disable or delete the old long-term access keys. You can do this gradually per developer as they transition to IAM Identity Center. Before deleting a key, verify that the developer is successfully using IAM Identity Center and that no application or script still depends on the old key.

### Conclusion

IAM Identity Center represents a fundamental shift in how AWS recommends managing human access. Instead of creating individual IAM users and issuing long-lived access keys, you use a centralized identity and access management service that issues temporary credentials, integrates seamlessly with the AWS CLI, and provides far better visibility and control over who can access what.

For developers, the experience is dramatically improved: authenticate once, access multiple accounts, and never think about credential management or rotation. For security and operations teams, the benefits are equally compelling: reduced blast radius from compromised credentials, automatic credential rotation, centralized auditing, and simpler lifecycle management.

If you haven't already, prioritize setting up IAM Identity Center in your AWS environment. The investment in configuration time will pay dividends in security posture and operational simplicity as your team scales.
