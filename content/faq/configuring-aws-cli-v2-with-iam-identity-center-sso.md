---
title: "Configuring AWS CLI v2 with IAM Identity Center (SSO)"
---

## Configuring AWS CLI v2 with IAM Identity Center (SSO)

If you've been managing AWS credentials through long-lived access keys stored in `~/.aws/credentials`, you're working with a security model that's increasingly considered outdated. AWS IAM Identity Center (the managed version of AWS Single Sign-On) offers a modern, enterprise-friendly alternative that integrates seamlessly with AWS CLI v2. This guide walks you through setting it up, understanding how it works, and troubleshooting the inevitable hiccups you'll encounter along the way.

### Why Move Away from Long-Term Access Keys?

Before diving into the mechanics, it's worth understanding why this transition matters. Long-lived access keys are static credentials—they don't expire unless you manually rotate them, and rotating them across your development team requires coordination and discipline that rarely happens in practice. A compromised key could grant an attacker persistent access to your AWS environment.

IAM Identity Center introduces temporary, short-lived credentials that are automatically refreshed. Your authentication happens through your organization's identity provider (like Okta, Azure AD, or even AWS's managed directory), and you get credentials valid for a limited time window—typically one hour by default. This dramatically reduces your attack surface and aligns with modern security best practices like the principle of least privilege.

### Understanding the Moving Parts

When you configure AWS CLI with IAM Identity Center, several pieces work together:

The **IAM Identity Center** itself is the identity provider and permission boundary. It manages your user accounts, organizes them into groups, and defines which permission sets (essentially pre-baked IAM policies) users can assume across which AWS accounts. Your organization's administrator sets this up, usually at the AWS Organizations level.

The **AWS CLI v2** is your client. When you run `aws configure sso`, it guides you through storing the necessary connection information. Later, when you run `aws sso login`, it kicks off the authentication flow, opens your browser to your identity provider's login page, and handles the credential exchange behind the scenes.

The **credential provider chain** is how AWS SDKs and CLI tools decide which credentials to use. IAM Identity Center credentials slot into this chain—when AWS CLI needs credentials, it checks your configured SSO profiles and automatically refreshes them as needed.

### Setting Up Your First SSO Profile

Start by ensuring you have AWS CLI v2 installed. You can verify with:

```bash
aws --version
```

You should see output indicating version 2.x or higher. If you're on v1, upgrading is straightforward on most systems.

Next, run the configuration wizard:

```bash
aws configure sso
```

This launches an interactive prompt. Here's what you'll be asked:

**SSO session name**: This is a label for your SSO configuration session. You might call it something like `my-org` or `production-sso`. This name is used internally to help AWS CLI organize your SSO setup. Keep it memorable but brief.

**SSO start URL**: Your organization's IAM Identity Center portal URL. This typically looks like `https://my-org-account-id.awsapps.com/start`. Your administrator should provide this—it's where you'd normally log in to access AWS accounts through a web browser.

**SSO region**: The AWS region where your IAM Identity Center is configured. This is usually `us-east-1`, but check with your admin if you're unsure.

**CLI default client name**: This can usually stay as the default. It's used internally for the OAuth2 flow.

Here's what a typical interaction looks like:

```bash
$ aws configure sso
SSO session name [None]: my-org
SSO start URL [None]: https://d-1234567890.awsapps.com/start
Attempting to automatically open the SSO authorization page in your default browser.
If the browser does not open or you wish to use a different device to authorize this request, open the following URL:

https://device.sso.us-east-1.amazonaws.com/?client_id=...&request_id=...&redirect_uri=...

Then authorize the request in the browser, and enter the authorization code here (or leave blank to skip):
```

At this point, your default browser opens. You authenticate using your organization's identity provider credentials. Once authenticated, you'll see a confirmation page. Copy the authorization code back into your terminal, or if your browser integration works smoothly, it might happen automatically.

After authorization, the wizard asks you to select which AWS account and permission set you want to use for this profile:

```bash
There are N AWS accounts available to you.
[0] Account 1 (123456789012)
[1] Account 2 (987654321098)
...
```

Select the account, then choose your permission set (the role-like permission boundary you'll assume), and give the profile a name. This name is what you'll use when running AWS commands—for example, `dev-account` or `prod-engineer`.

### Understanding the Configuration Structure

Once you've run `aws configure sso`, open up your `~/.aws/config` file. You'll see something like this:

```ini
[sso-session my-org]
sso_start_url = https://d-1234567890.awsapps.com/start
sso_region = us-east-1
sso_registration_scopes = sso:account:access

[profile dev-account]
sso_session = my-org
sso_account_id = 123456789012
sso_role_name = DeveloperAccess
region = us-west-2

[profile prod-account]
sso_session = my-org
sso_account_id = 987654321098
sso_role_name = ReadOnlyAccess
region = us-east-1
```

This structure is key to understanding how AWS CLI resolves credentials. The `[sso-session]` block defines your SSO configuration—it's the common foundation for multiple profiles. Each `[profile]` block references an SSO session and specifies which account and role combination to use.

The `sso_registration_scopes` parameter tells AWS what kind of access you're requesting. The default `sso:account:access` is what you want for most use cases.

### Logging In and How Credentials Are Cached

Now that your configuration is in place, authenticate with:

```bash
aws sso login --profile dev-account
```

This opens your browser again, asking you to confirm your identity. After you authenticate, AWS CLI performs an OAuth2 token exchange and receives temporary AWS credentials. These credentials are cached in `~/.aws/sso/cache/`, in JSON files whose names are derived from your SSO session configuration.

Here's what happens behind the scenes: AWS Identity Center issues you a **refresh token** (valid for a longer period, typically up to 12 hours) and short-lived **access credentials** (usually valid for one hour). The refresh token is stored in the cache and reused transparently—when your short-lived credentials expire, AWS CLI automatically fetches new ones using the refresh token, so you don't have to run `aws sso login` repeatedly during a single session.

The cached credentials look something like this (actual values redacted):

```json
{
  "accessToken": "...",
  "refreshToken": "...",
  "expiresAt": "2024-01-15T10:30:00UTC",
  "clientId": "...",
  "clientSecret": "...",
  "registrationExpiresAt": "2024-04-15T10:30:00UTC"
}
```

When you run an AWS CLI command using an SSO profile, AWS CLI checks if cached credentials exist and are still valid. If they're valid, it uses them. If they've expired, it uses the refresh token to fetch new ones automatically. If the refresh token itself has expired (which might happen if you haven't used your profile in a while), you'll see an error message telling you to run `aws sso login` again.

### Using Your SSO Profile

Once you're logged in, using your SSO-authenticated profile is identical to using access key credentials:

```bash
aws s3 ls --profile dev-account
aws ec2 describe-instances --profile dev-account
aws dynamodb list-tables --profile dev-account
```

You can also set a default profile to avoid typing `--profile` every time:

```bash
export AWS_PROFILE=dev-account
aws s3 ls
```

Or configure it in your `~/.aws/config`:

```ini
[default]
sso_session = my-org
sso_account_id = 123456789012
sso_role_name = DeveloperAccess
region = us-west-2
```

### Managing Multiple Accounts and Permission Sets

One of the strengths of IAM Identity Center is its ability to grant you access to multiple accounts with different permission sets. In practice, you might have permissions to assume different roles in different accounts, and you configure each as a separate profile.

Run `aws configure sso` again, select a different account or permission set, and give it a new profile name. You can repeat this as many times as you need. Your `~/.aws/config` will grow accordingly:

```ini
[sso-session my-org]
sso_start_url = https://d-1234567890.awsapps.com/start
sso_region = us-east-1
sso_registration_scopes = sso:account:access

[profile dev]
sso_session = my-org
sso_account_id = 111111111111
sso_role_name = DeveloperAccess
region = us-west-2

[profile staging]
sso_session = my-org
sso_account_id = 222222222222
sso_role_name = DeveloperAccess
region = us-west-2

[profile prod]
sso_session = my-org
sso_account_id = 333333333333
sso_role_name = ReadOnlyAccess
region = us-east-1

[profile admin]
sso_session = my-org
sso_account_id = 333333333333
sso_role_name = AdministratorAccess
region = us-east-1
```

Notice that multiple profiles can reference the same SSO session but differ in account ID, role, or region. This is exactly what you want for a multi-account environment.

When you run `aws sso login --profile dev`, you authenticate once and the refresh token is stored at the session level. Subsequent commands against `staging`, `prod`, or `admin` profiles can reuse that same authentication without requiring you to log in again, as long as the refresh token hasn't expired.

### The Credential Provider Chain in Action

AWS SDKs (including the CLI) use a well-defined credential provider chain to determine which credentials to use. For AWS CLI v2 with SSO, here's the order it checks:

First, it looks for credentials in environment variables like `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, and `AWS_SESSION_TOKEN`. These override everything else, which is useful for CI/CD pipelines but rarely needed in local development.

Next, it checks for a profile specified via the `--profile` flag or the `AWS_PROFILE` environment variable. If you've specified a profile, it looks for that profile's configuration in `~/.aws/config`. If the profile uses IAM Identity Center (has `sso_session`, `sso_account_id`, and `sso_role_name`), AWS CLI uses the SSO credential provider.

Then it looks for the default profile if no profile was explicitly specified.

Finally, if you're running on an EC2 instance or ECS task, it checks for an attached IAM role via the instance metadata service.

This chain means you can mix credentials sources in your environment—perhaps you use SSO for local development but rely on instance roles in production, and AWS CLI will automatically use the right credentials in each context.

### Troubleshooting Common Issues

**"The SSO session associated with this profile has expired"**

This occurs when your refresh token has expired—usually because you haven't used the profile in 12 or more hours. The fix is simple:

```bash
aws sso login --profile your-profile-name
```

Re-authenticate, and you'll get a fresh set of tokens.

**"Unable to locate credentials"**

If you see this error, AWS CLI couldn't find valid credentials for your profile. Check a few things:

Ensure the profile name matches exactly (case-sensitive). Verify that your `~/.aws/config` file has the correct `sso_session`, `sso_account_id`, and `sso_role_name` values. Confirm that you've run `aws sso login` at least once for that profile. Check whether your refresh token has expired (see the previous issue).

**"NoCredentialProviders" or credential errors in SDK code**

If you're writing code using an AWS SDK (boto3, Node.js SDK, etc.), the SDK must also be configured to use your SSO profile. In most cases, setting the `AWS_PROFILE` environment variable or explicitly passing the profile name to the SDK client constructor works:

```python
import boto3

session = boto3.Session(profile_name='dev-account')
s3_client = session.client('s3')
```

**Browser doesn't open during `aws sso login`**

On headless or remote systems, your default browser might not be available. The AWS CLI provides a URL you can manually visit from another machine:

```bash
aws sso login --profile dev-account
# Output includes: "Attempting to automatically open the SSO authorization page..."
# If it fails, you'll see a URL to visit manually
```

Copy that URL, open it in a browser on any machine, authenticate, and paste the authorization code back into the terminal.

**Credentials work with CLI but not with SDK code**

This often indicates a region mismatch or a missing region configuration. IAM Identity Center operates within a specific region (typically `us-east-1`). Ensure your `~/.aws/config` includes a region for your profile:

```ini
[profile dev-account]
sso_session = my-org
sso_account_id = 123456789012
sso_role_name = DeveloperAccess
region = us-west-2  # This is important
```

If the region is missing or misconfigured, some SDK operations might fail.

### Best Practices and Tips

**Organize your profiles logically**: Use consistent naming conventions like `{environment}-{purpose}` (e.g., `dev-engineer`, `prod-readonly`). This makes it obvious which profile you're using at a glance and reduces the risk of accidentally running a dangerous command against production.

**Set a sensible default**: If most of your work happens in one account and role, configure it as your default profile. This saves you from typing `--profile` constantly.

**Use short-lived credentials everywhere**: This includes CI/CD pipelines, Lambda functions, and any automated systems. IAM Identity Center's short-lived credentials are far superior to static access keys for these use cases.

**Keep your `~/.aws/config` committed (selectively)**: You can safely commit your `~/.aws/config` to version control since it contains no secrets—just references to SSO configurations. Your `~/.aws/credentials` file, on the other hand, should never be committed, though with SSO you won't have one anyway (or it'll be empty).

**Monitor cached tokens**: The `~/.aws/sso/cache/` directory contains your cached tokens. Keep this directory secure and never share its contents. Consider setting restrictive file permissions if you're in a shared environment.

**Understand your organization's SSO setup**: Talk to your AWS administrator about which accounts and permission sets are available to you. Understanding your permission structure prevents frustration when a profile returns "access denied" errors.

**Use assume-role for additional delegation**: If your permission set grants you the ability to assume other roles (via STS AssumeRole), you can configure additional profiles that use IAM Identity Center as a base, then assume a role on top of it. This is an advanced pattern useful for delegated access scenarios.

### Integrating with IDEs and Development Tools

Most modern IDEs and development tools integrate with AWS CLI profiles seamlessly. VS Code's AWS Toolkit extension, JetBrains IDEs, and others all pick up your `~/.aws/config` automatically. They'll use your SSO credentials just as the CLI does.

For terminal-based workflows, consider adding a prompt indicator showing your current profile:

```bash
export PS1="[\$AWS_PROFILE] $PS1"
```

This ensures you always see which AWS account and role you're about to execute commands against—a small safeguard against costly mistakes.

### Transitioning Your Team

If you're migrating a team away from access keys, plan the transition carefully:

Set up IAM Identity Center at the organization level first. Configure permission sets that match your team's existing access patterns. Have each team member configure their local AWS CLI with `aws configure sso` and test against non-production resources first. Once everyone's comfortable, disable old access keys. Document the new process and troubleshoot as issues arise.

Most teams find that the initial setup effort pays dividends quickly. Developers appreciate not having to rotate keys manually, security teams appreciate the audit trail and automatic expiration, and your organization's security posture improves measurably.

### Looking Forward

IAM Identity Center with AWS CLI v2 represents a significant step forward in how developers authenticate with AWS. It's more secure, easier to manage, and aligns with modern cloud practices. If your organization hasn't yet adopted it, now is an excellent time to advocate for the migration. The short-term effort of configuration pays long-term dividends in security and operational simplicity.

As you deepen your AWS expertise, you'll likely encounter more advanced credential scenarios—cross-account role assumption, federated access from third-party identity providers, and integration with SAML or OpenID Connect. These all build on the foundation of understanding how IAM Identity Center and the credential provider chain work, making this knowledge foundational to your growth as an AWS developer.
