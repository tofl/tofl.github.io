---
title: "AWS CLI Named Profiles and Configuring Multiple Accounts"
---

## AWS CLI Named Profiles and Configuring Multiple Accounts

If you've ever found yourself juggling multiple AWS accounts—switching between a personal sandbox, a development environment, a staging account, and a production account—you've likely experienced the friction of constantly updating credentials. The AWS CLI's named profiles feature exists precisely to solve this problem. Rather than managing a single set of credentials or swapping files around, you can define multiple named profiles in your configuration and easily switch between them with a single flag or environment variable. This approach scales elegantly from small teams to large organizations with dozens of accounts and complex role assumptions.

In this guide, we'll explore how to configure and use named profiles effectively, understand the underlying credential provider chain, and master the cross-account access patterns that make multi-account AWS architectures work smoothly from the command line.

### Understanding Named Profiles: The Basics

A named profile is essentially a named set of AWS credentials and configuration settings stored in two files in your home directory: `~/.aws/credentials` and `~/.aws/config`. When you first install the AWS CLI and run `aws configure`, you're actually creating a profile called `default`. This profile is used automatically whenever you run an AWS CLI command without explicitly specifying a different profile.

The real power of named profiles emerges when you create additional profiles beyond the default. Each profile can contain different credentials, different regions, different output formats, and different IAM role configurations. This means you can have a profile for your development account, another for staging, and another for production—all accessible instantly without any credential swapping.

Let's look at what a realistic multi-profile setup might look like. The `~/.aws/credentials` file contains the actual access keys:

```
[default]
aws_access_key_id = AKIAIOSFODNN7EXAMPLE
aws_secret_access_key = wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY

[dev-account]
aws_access_key_id = AKIAIOSFODNN7DEVEXMP
aws_secret_access_key = wJalrXUtnFEMI/K7MDENG/bPxRfiCYDEVEXAMPLE

[prod-account]
aws_access_key_id = AKIAIOSFODNN7PRODEXP
aws_secret_access_key = wJalrXUtnFEMI/K7MDENG/bPxRfiCYPRODEXAMPLE
```

The `~/.aws/config` file contains region, output format, and role assumption settings:

```
[default]
region = us-east-1
output = json

[profile dev-account]
region = us-west-2
output = json

[profile prod-account]
region = eu-west-1
output = json
```

Notice the subtle syntax difference: in the credentials file, you write `[profile-name]`, but in the config file, you write `[profile profile-name]` (except for the default profile, which doesn't need the `profile` prefix in either file).

### Using Named Profiles in Practice

Once you've defined multiple profiles, using them is straightforward. You can specify a profile in three ways: via the `--profile` flag, through the `AWS_PROFILE` environment variable, or by setting `AWS_DEFAULT_PROFILE`. The flag takes precedence over the environment variable, which takes precedence over the default profile.

For example, to list S3 buckets using your dev-account profile:

```bash
aws s3 ls --profile dev-account
```

Or set the environment variable once and all subsequent commands in that shell session will use that profile:

```bash
export AWS_PROFILE=dev-account
aws s3 ls
aws ec2 describe-instances
aws dynamodb list-tables
```

To switch back to the default profile, you can either unset the variable or explicitly use `--profile default`. Many developers find it helpful to add the current profile to their shell prompt, which provides a visual reminder of which account they're operating on:

```bash
export PS1="[\$AWS_PROFILE] \u@\h:\w\$ "
```

This simple change prevents the expensive mistake of running a destructive command against the wrong account.

### Cross-Account Access with source_profile and role_arn

The real sophistication in named profile configuration comes when you need to access a different AWS account without storing credentials for that account directly. This is where `source_profile` and `role_arn` come into play, and it's essential for understanding how modern AWS organizations manage access.

Consider this scenario: your organization has a central security account where all human users have IAM credentials. From that central account, you need to assume roles in development, staging, and production accounts. This is a common architecture in AWS organizations using AWS Identity Center (formerly AWS SSO) or federated identity.

You'd configure this in `~/.aws/config` like this:

```
[default]
region = us-east-1
output = json
aws_access_key_id = AKIAIOSFODNN7EXAMPLE
aws_secret_access_key = wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY

[profile dev-role]
role_arn = arn:aws:iam::123456789012:role/DeveloperRole
source_profile = default
region = us-west-2

[profile prod-role]
role_arn = arn:aws:iam::987654321098:role/ProdAdminRole
source_profile = default
region = eu-west-1
```

Here's what happens when you run a command with the `dev-role` profile: the AWS CLI takes the credentials from the `default` profile (the `source_profile`), uses those to call the AWS Security Token Service (STS), and assumes the specified role in the target account. The STS service returns temporary credentials for that role, which the CLI then uses for your actual API calls. You get short-lived, temporary credentials with exactly the permissions defined in that role, without ever needing to store permanent credentials for the remote account.

This pattern scales beautifully. You can have dozens of roles defined, each one assuming into different accounts and with different permission sets, all managed from a single set of source credentials.

### Adding Multi-Factor Authentication to the Mix

In security-conscious organizations, assuming a cross-account role requires MFA (multi-factor authentication). If you try to assume a role that has an MFA requirement without providing an MFA device, the STS call will fail. You configure this through the `mfa_serial` setting in your profile configuration.

The `mfa_serial` parameter specifies the ARN of your virtual or hardware MFA device:

```
[default]
region = us-east-1
output = json
aws_access_key_id = AKIAIOSFODNN7EXAMPLE
aws_secret_access_key = wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
mfa_serial = arn:aws:iam::123456789012:mfa/alice

[profile prod-role]
role_arn = arn:aws:iam::987654321098:role/ProdAdminRole
source_profile = default
mfa_serial = arn:aws:iam::123456789012:mfa/alice
region = eu-west-1
```

When you run a command with the `prod-role` profile, the CLI will prompt you for your MFA token code:

```bash
$ aws s3 ls --profile prod-role
Enter MFA code for arn:aws:iam::123456789012:mfa/alice:
```

You'd type in the six-digit code from your authenticator app or hardware token, and then the STS AssumeRole call proceeds with MFA validation. This adds a crucial security layer: even if someone compromises your long-term credentials, they can't access production without also having your MFA device.

### The AWS Credential Provider Chain

Understanding how the AWS CLI resolves which credentials to use is essential for debugging authentication issues and designing robust multi-account setups. The CLI follows a specific order of precedence, checking each location in sequence until it finds credentials.

The credential provider chain looks like this, in order: environment variables (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN`) take the highest priority. If those aren't set, the CLI checks the named profile's credentials (either from `~/.aws/credentials` or `~/.aws/config`). If the profile specifies a `source_profile` and `role_arn`, the CLI uses the source profile's credentials to assume the role via STS. After that, the CLI checks for credentials from an EC2 instance metadata service (useful when running on EC2), then an ECS container metadata service, and finally an external credential process if configured.

This chain design means you can override credentials for a single command using environment variables, while still maintaining your default profile-based setup. It also means that if you're running on an EC2 instance with an IAM instance profile, you don't need to store credentials in files at all—the instance metadata service provides temporary credentials automatically.

A common gotcha occurs when developers set environment variables for one account and then forget they're set, accidentally running commands against the wrong account. The environment variable take precedence over the profile, so the CLI will use those credentials even if you explicitly specify a profile. Always check your environment variables if things seem amiss:

```bash
env | grep AWS
```

### Practical Multi-Account Workflow

Let's walk through a realistic scenario to tie everything together. Imagine you're part of a team with three AWS accounts: a shared services account, a development account, and a production account. Your IAM user exists in the shared services account, and you have roles in the other two accounts that you can assume.

Your `~/.aws/config` might look like:

```
[default]
region = us-east-1
output = json

[profile shared-services]
aws_access_key_id = AKIAIOSFODNN7SHARED
aws_secret_access_key = wJalrXUtnFEMI/K7MDENG/bPxRfiCYSHARED
region = us-east-1
mfa_serial = arn:aws:iam::111111111111:mfa/yourself

[profile dev]
role_arn = arn:aws:iam::222222222222:role/DeveloperRole
source_profile = shared-services
region = us-west-2
mfa_serial = arn:aws:iam::111111111111:mfa/yourself

[profile prod]
role_arn = arn:aws:iam::333333333333:role/ReadOnlyRole
source_profile = shared-services
region = eu-west-1
mfa_serial = arn:aws:iam::111111111111:mfa/yourself
```

Now you can work seamlessly across accounts:

```bash
# Check CloudFormation stacks in dev
aws cloudformation list-stacks --profile dev

# Deploy a Lambda function to dev
aws lambda update-function-code --function-name my-function \
  --zip-file fileb://function.zip --profile dev

# Read some logs from prod (read-only role)
aws logs describe-log-groups --profile prod
```

Each command that crosses account boundaries will prompt for your MFA code. The temporary credentials returned by the STS AssumeRole call are cached in memory for a short period, so subsequent commands won't immediately ask for MFA again. This caching is handled transparently by the CLI and makes workflows feel natural without sacrificing security.

### Advanced Configuration: External Credential Providers

For teams using centralized identity providers—such as Okta, Azure AD, or AWS Identity Center—the CLI can integrate with external credential providers. This is configured through the `credential_process` parameter in your config file.

With Identity Center integration, AWS automatically manages this for you. When you authenticate through Identity Center, it updates your local profiles with temporary credentials that have appropriate expiration times. However, for custom integrations, you might specify:

```
[profile federated-dev]
credential_process = /usr/local/bin/get-credentials dev
region = us-west-2
```

When you use this profile, the CLI executes `/usr/local/bin/get-credentials dev`, which should output JSON with the access key, secret key, and optional session token. This approach lets organizations integrate any identity system they already use, making the CLI part of a unified authentication story.

### Troubleshooting Profile Issues

When something goes wrong with profiles, a few diagnostic techniques help. The `--debug` flag shows you exactly which credentials the CLI is using and in what order:

```bash
aws s3 ls --profile dev --debug 2>&1 | grep -A5 -B5 credential
```

You can also validate your configuration syntax without making any API calls:

```bash
aws configure list --profile dev
```

This shows you exactly which credentials, region, and output format the profile resolves to. If you see "None" for any expected value, you've found your problem.

If you're having trouble assuming a role, make sure the source profile has permissions to call `sts:AssumeRole` on the target role's ARN. The trust relationship on the role in the target account must allow assumption from the principal in the source account. A common mistake is forgetting to configure MFA when the role requires it, or providing an incorrect MFA device ARN.

### Security Best Practices with Named Profiles

Since your credentials are stored in plain text in `~/.aws/credentials`, file permissions matter tremendously. The directory and files should only be readable by your user:

```bash
chmod 700 ~/.aws
chmod 600 ~/.aws/credentials
chmod 600 ~/.aws/config
```

Many teams use `~/.aws/config` and `~/.aws/credentials` management tools that integrate with password managers or hardware security keys, which store credentials encrypted and only decrypt them as needed. This adds an extra layer of protection against credential theft if your machine is compromised.

Avoid committing either file to version control, even partially. Add them to your `.gitignore` immediately. Some teams use tools that temporarily assume roles and inject credentials as environment variables, which are automatically cleaned up after the operation completes, reducing the window of exposure.

For production access, prefer short-lived temporary credentials wherever possible. Configure your profiles to assume roles rather than using long-term credentials. If you must use long-term credentials, rotate them regularly and use access key metadata to track which credentials are actually in use.

### Conclusion

Named profiles transform the AWS CLI from a single-account tool into a multi-account powerhouse. By understanding the syntax of `~/.aws/config` and `~/.aws/credentials`, leveraging `source_profile` and `role_arn` for cross-account access, and incorporating MFA for security, you gain the ability to operate cleanly across complex account structures. The credential provider chain ensures that your configuration plays well with environment variables and instance metadata, and diagnostic tools help you troubleshoot when something feels off.

Whether you're managing two accounts or twenty, the patterns described here provide the foundation for a secure, scalable approach to AWS CLI configuration. Start with the basics—create a few profiles, switch between them, and become comfortable with the mechanics. Once that feels natural, layer in cross-account roles and MFA. Your future self will thank you when you can switch between accounts with confidence, knowing exactly where your commands are running and who authorized them.
