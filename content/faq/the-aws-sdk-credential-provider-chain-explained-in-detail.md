---
title: "The AWS SDK Credential Provider Chain Explained in Detail"
---

## The AWS SDK Credential Provider Chain Explained in Detail

When you write code that interacts with AWS services, you need to authenticate somehow. You can't just send a request to S3 or Lambda without proving who you are and what you're allowed to do. The question is: how does your code know which credentials to use?

The answer lies in what AWS calls the *credential provider chain*—a systematic, ordered sequence that the SDK checks to find valid credentials. It's not magic; it's a deliberate design that balances convenience with security. Understanding this chain is crucial because it affects how your applications authenticate in development, testing, and production environments. Get it wrong, and you might accidentally commit credentials to version control, hardcode secrets, or fail to authenticate altogether. Get it right, and your applications will smoothly find the right credentials in any context.

This article walks you through the credential provider chain step by step, explains the order in which providers are evaluated, covers the nuances of profiles and SSO, and shows you how to debug when things go wrong.

### Understanding Why a Credential Chain Matters

Before diving into the mechanics, it's worth asking: why does AWS design things this way? Why not just ask for credentials every time?

The answer is that different environments have different credential requirements. When you're developing locally on your laptop, you might use long-lived access keys stored in a file. When your code runs on an EC2 instance, those same file-based credentials would be insecure—it's better to use temporary credentials delivered by the instance metadata service. When your code runs in a container orchestrated by ECS, you might use task role credentials delivered via a local HTTP endpoint. When you're using federated identity through AWS Single Sign-On (SSO), you need yet another mechanism.

The credential provider chain solves this by checking multiple sources in a predetermined order. The SDK tries each source in sequence and uses the first one that successfully provides credentials. This means the same code can work across all these environments without modification—the chain automatically finds the right credentials for the context.

### The Standard Credential Provider Chain Order

The exact order can vary slightly between SDKs (AWS SDK for Python, JavaScript, Java, Go, and so on), but the general pattern is consistent. Here's the typical sequence that the AWS SDKs follow:

**1. Explicit Credentials in Code** — If you pass credentials directly when creating a client (hardcoding them in your code), those take precedence. This is the most explicit and, frankly, the least recommended approach for most use cases, but it does take priority.

**2. Environment Variables** — The SDK checks for the `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, and optionally `AWS_SESSION_TOKEN` environment variables.

**3. Credentials File (AWS Credentials File)** — Located at `~/.aws/credentials` on macOS and Linux, or `%USERPROFILE%\.aws\credentials` on Windows, this file contains named profiles with access key pairs. The SDK defaults to the `default` profile unless you specify otherwise.

**4. Configuration File with Profiles** — The `~/.aws/config` file (or `%USERPROFILE%\.aws\config` on Windows) can define profiles with various settings, including credential sources. This is where SSO configurations and role assumption configurations live.

**5. Container Credentials (ECS Task Credentials)** — If your code runs inside an ECS task and the task has an IAM role, the SDK checks for credentials via the ECS task metadata service, typically accessed through an endpoint specified by the `AWS_CONTAINER_CREDENTIALS_RELATIVE_URI` or `AWS_CONTAINER_AUTHORIZATION_TOKEN_FILE` environment variables.

**6. Instance Metadata (EC2 Instance Credentials)** — If your code runs on an EC2 instance with an attached IAM role, the SDK queries the EC2 instance metadata service (IMDSv2 by default in modern SDKs) to retrieve temporary credentials from that role.

Understanding this order is the foundation of using credentials correctly. Let's look at each step in more detail.

### Explicit Credentials: The Anti-Pattern You Should Avoid

Explicit credentials are credentials you pass directly when instantiating an AWS service client. In Python, that might look like this:

```python
import boto3

client = boto3.client(
    's3',
    aws_access_key_id='AKIAIOSFODNN7EXAMPLE',
    aws_secret_access_key='wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY'
)
```

Yes, it works. No, you shouldn't do it in production. Hardcoding credentials means they live in your source code, where they can be accidentally committed to a repository, exposed in logs, or reviewed by someone who shouldn't see them. The only reasonable use case for explicit credentials is in scripts for personal testing or in emergency situations where you need to authenticate with a specific non-default principal.

Even in these cases, prefer reading the credentials from environment variables rather than hardcoding them:

```python
import boto3
import os

client = boto3.client(
    's3',
    aws_access_key_id=os.environ['AWS_ACCESS_KEY_ID'],
    aws_secret_access_key=os.environ['AWS_SECRET_ACCESS_KEY']
)
```

This is slightly better because the credentials are external to the code, but honestly, if you're going to set environment variables, you might as well let the SDK find them automatically (which brings us to the next step).

### Environment Variables: Simple and Portable

The second provider in the chain checks environment variables. The SDK looks for three variables:

`AWS_ACCESS_KEY_ID` — Your access key ID.

`AWS_SECRET_ACCESS_KEY` — Your secret access key.

`AWS_SESSION_TOKEN` — Optional, used for temporary credentials (from STS assume-role or similar).

This approach is popular in containerized environments and CI/CD pipelines because you can pass environment variables to containers or pipeline jobs without modifying code or managing files. For example, in a GitHub Actions workflow, you might do:

```yaml
env:
  AWS_ACCESS_KEY_ID: ${{ secrets.AWS_ACCESS_KEY_ID }}
  AWS_SECRET_ACCESS_KEY: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
```

The CI/CD system injects the secrets at runtime, and your code simply creates a client without any credential arguments:

```python
import boto3

client = boto3.client('s3')  # SDK finds credentials from environment
```

Environment variables are convenient and work well for temporary credentials (which expire and should be rotated regularly). They're less ideal for long-lived access keys in local development because you'd need to set them in your shell profile, which is also a form of persistence that could leak.

### The Credentials File: Local Development's Best Friend

Most developers working locally use the `~/.aws/credentials` file, which is the third provider in the chain. This file stores named profiles, each containing an access key pair. It looks like this:

```ini
[default]
aws_access_key_id = AKIAIOSFODNN7EXAMPLE
aws_secret_access_key = wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY

[dev-account]
aws_access_key_id = AKIAIOSFODNN7ANOTHER
aws_secret_access_key = anotherSecretKeyHere1234567890abcDEFGHIJ

[prod-account]
aws_access_key_id = AKIAIOSFODNN7PRODKEY
aws_secret_access_key = prodSecretKeyHere1234567890abcDEFGHIJ
```

By default, the SDK uses the `default` profile. To use a different profile, you set the `AWS_PROFILE` environment variable:

```bash
export AWS_PROFILE=dev-account
aws s3 ls  # Uses dev-account credentials
```

In code, you can specify the profile when creating a client:

```python
import boto3

session = boto3.Session(profile_name='dev-account')
client = session.client('s3')
```

The credentials file is practical for local development because you create it once (typically using `aws configure` or by editing it manually) and then forget about it. The file should only be readable by your user account; the AWS CLI automatically sets restrictive permissions when creating it. However, the credentials in this file are long-lived, so if your computer is compromised, an attacker could abuse those credentials until you rotate them. Many teams now prefer temporary credentials even in local development, which is where the config file and SSO come in.

### The Config File: Profiles, Assume-Role, and SSO

The fourth provider checks the `~/.aws/config` file (sometimes called the configuration file), which is separate from the credentials file. The config file is where you define profiles, their regions, output formats, and—crucially—how to obtain credentials. This is where the more sophisticated credential sources live: assume-role profiles and SSO.

Here's what a typical config file looks like:

```ini
[default]
region = us-east-1
output = json

[profile dev]
region = us-west-2
role_arn = arn:aws:iam::123456789012:role/DeveloperRole
source_profile = aws-account

[profile prod]
region = us-east-1
role_arn = arn:aws:iam::987654321098:role/ProductionRole
source_profile = aws-account

[profile aws-account]
sso_start_url = https://my-organization.awsapps.com/start
sso_region = us-east-1
sso_account_id = 123456789012
sso_role_name = DeveloperRole
```

Let's break down what's happening here. The `dev` profile has a `role_arn` and `source_profile`. This is an assume-role configuration: the SDK uses credentials from the `source_profile` (in this case, `aws-account`) to assume the specified role. The `aws-account` profile is configured with SSO, which means credentials come from your organization's AWS SSO setup.

When you run a command with the `dev` profile, here's what happens behind the scenes:

1. The SDK sees the `source_profile` and looks up that profile's credentials (from SSO in this case).
2. The SDK uses those credentials to call the STS `AssumeRole` API with the specified `role_arn`.
3. STS returns temporary credentials for the assumed role.
4. Those temporary credentials are used for subsequent AWS API calls.

This is powerful because it means you don't need to manage multiple sets of long-lived credentials. Instead, you have one SSO identity, and it can assume different roles in different accounts or for different purposes.

### Single Sign-On (SSO) Credentials

SSO integration deserves special attention because it's increasingly common in enterprise environments. When you configure an SSO profile, you're telling the SDK to obtain credentials through your organization's SSO provider rather than managing access keys directly.

Setting up SSO typically involves running:

```bash
aws configure sso
```

You'll be prompted for your organization's SSO start URL, the AWS region where SSO is configured, the account ID, and the role name. Once configured, your profile in the config file will look something like:

```ini
[profile my-sso-profile]
sso_start_url = https://my-organization.awsapps.com/start
sso_region = us-east-1
sso_account_id = 123456789012
sso_role_name = MyRole
```

When you use this profile, the SDK handles the authentication flow: it opens a browser, you log in through your SSO provider, and temporary credentials are cached locally. Those credentials are valid for a limited time (typically 12 hours by default, but configurable), and the SDK automatically refreshes them when they expire.

The advantage is significant: credentials are temporary, rotation is automatic, and you're not managing access keys at all. The trade-off is a slight increase in complexity and a dependency on network access to your SSO provider for initial login.

### Assume-Role Profiles: Cross-Account and Multi-Role Access

Building on SSO, assume-role profiles allow you to assume different IAM roles. A common pattern is to have a single identity (SSO or long-lived credentials) and then assume role A for development work, role B for production operations, and role C for compliance auditing.

Here's an example configuration:

```ini
[profile source]
aws_access_key_id = AKIAIOSFODNN7EXAMPLE
aws_secret_access_key = wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY

[profile assume-dev-role]
role_arn = arn:aws:iam::123456789012:role/DevRole
source_profile = source

[profile assume-prod-role]
role_arn = arn:aws:iam::999999999999:role/ProdRole
source_profile = source
```

When you use `assume-dev-role`, the SDK assumes the DevRole in account 123456789012 using credentials from the `source` profile. This is useful for cross-account access: you might have development and production in separate AWS accounts, and assuming a role is how you switch between them securely.

You can also chain assume-role operations using `role_session_name` and `duration_seconds`:

```ini
[profile intermediate]
role_arn = arn:aws:iam::111111111111:role/IntermediateRole
source_profile = source
role_session_name = my-session
duration_seconds = 3600
```

The `role_session_name` provides a memorable name for the session (useful for CloudTrail logs), and `duration_seconds` specifies how long the temporary credentials are valid.

### Container Credentials: ECS Task Roles

When your code runs inside an ECS task, the environment is different. There's no `~/.aws/credentials` file, and you typically don't set environment variables for credentials. Instead, ECS provides credentials through a local HTTP endpoint.

For this to work, you need to:

1. Create an IAM role for your ECS task (the task role).
2. Attach the role to the ECS task definition.
3. ECS injects environment variables that point to the credentials endpoint.

The SDK checks for the `AWS_CONTAINER_CREDENTIALS_RELATIVE_URI` environment variable (and in some cases, `AWS_CONTAINER_CREDENTIALS_FULL_URI`). If found, it makes an HTTP request to the ECS task metadata service to fetch temporary credentials.

This is secure because:

- The credentials are temporary and short-lived.
- They're delivered over a local network (the metadata endpoint is only accessible from within the container).
- You never store credentials in the container image or configuration.
- The credentials are automatically rotated by ECS.

From a developer's perspective, you typically don't need to do anything special. You just create a client, and if the code is running in ECS with a task role attached, the SDK finds the credentials automatically:

```python
import boto3

client = boto3.client('s3')  # Credentials come from ECS task role
```

### Instance Metadata: EC2 Instance Roles

Similarly, when your code runs on an EC2 instance, you can attach an IAM role directly to the instance. The SDK then fetches temporary credentials from the EC2 instance metadata service.

By default, modern SDKs use IMDSv2 (Instance Metadata Service Version 2), which requires a token and is more secure than IMDSv1. The flow is automatic: the SDK requests a token from the metadata service, then uses that token to fetch credentials.

As with ECS, you don't need to do anything special in your code:

```python
import boto3

client = boto3.client('s3')  # Credentials come from EC2 instance role
```

The instance role credentials are automatically rotated by AWS, so you're always working with current temporary credentials. This is the gold standard for running code on AWS infrastructure: no credentials to manage, automatic rotation, and high security.

One important caveat: the EC2 instance must have the appropriate IAM role attached, and that role must have the permissions you need. If the instance doesn't have a role, or if the role doesn't grant necessary permissions, the SDK won't fail at credential time—it'll fail later when you try to perform an action the role doesn't allow.

### The Role of AWS_SDK_LOAD_CONFIG

There's a subtle but important detail about how the credential chain works with profiles: the `AWS_SDK_LOAD_CONFIG` environment variable.

By default, the AWS CLI loads settings from both the `~/.aws/credentials` file (for credentials) and the `~/.aws/config` file (for other settings). However, some older SDKs and applications are more conservative. To ensure that SSO profiles, assume-role profiles, and other advanced configuration from the config file are loaded, you may need to set:

```bash
export AWS_SDK_LOAD_CONFIG=true
```

This is particularly important if you're using SSO or assume-role profiles and they're not being recognized. The AWS CLI sets this automatically, but if you're writing a custom application, you might need to set it yourself.

In Python, you can set this programmatically:

```python
import os
os.environ['AWS_SDK_LOAD_CONFIG'] = 'true'

import boto3
session = boto3.Session()
```

Setting it before importing boto3 ensures it takes effect during session initialization.

### Debugging Credential Resolution Issues

When credentials aren't being found or the wrong credentials are being used, debugging can be frustrating. Here are some strategies.

**First, verify which profile is active.** Check your `AWS_PROFILE` environment variable:

```bash
echo $AWS_PROFILE
```

If it's empty, you're using the `default` profile. To see what credentials are actually being used, you can inspect the environment and files.

**Second, use verbose logging.** Most SDKs support debug-level logging that shows the credential resolution process. In Python:

```python
import boto3
import logging

logging.basicConfig(level=logging.DEBUG)
boto3.set_stream_logger('', logging.DEBUG)

client = boto3.client('s3')
```

This will print detailed information about which providers are being checked and why each one is accepted or rejected.

**Third, use the AWS CLI itself to test.** The CLI uses the same credential chain as the SDKs, so if the CLI works, your SDK should too (assuming you're using the same profile):

```bash
aws sts get-caller-identity --profile my-profile
```

This command returns information about the identity currently in use. If credentials are working, you'll see your account ID and the ARN of the principal being used.

**Fourth, verify file permissions.** The `~/.aws/credentials` file must be readable only by you. If permissions are wrong, the SDK will skip it:

```bash
ls -la ~/.aws/credentials
```

The permissions should be `-rw-------` (600). If they're not, fix them:

```bash
chmod 600 ~/.aws/credentials ~/.aws/config
```

**Fifth, check for expired credentials.** If you're using temporary credentials from assume-role or SSO, they might have expired. SSO credentials are cached locally and refreshed automatically, but if you're manually using assume-role credentials, check the expiration:

```bash
aws sts get-caller-identity
```

If the response includes an expiration time and it's in the past, your credentials have expired.

**Sixth, verify IAM permissions.** Even with correct credentials, you might not have permission to perform a specific action. This isn't a credential resolution issue; it's a permissions issue. To debug:

```bash
aws s3 ls --debug 2>&1 | grep -i "Authorization\|Forbidden"
```

A 403 Forbidden response indicates a permissions problem, not a credential problem.

### Best Practices for Production

When deploying code to production, follow these principles:

**Use instance or task roles whenever possible.** If your code runs on EC2 or in ECS, let the infrastructure provide credentials. This eliminates the need to manage long-lived credentials.

**Never commit credentials to version control.** Use `.gitignore` to exclude credential files, and consider using pre-commit hooks to catch accidental commits of sensitive data.

**Rotate long-lived credentials regularly.** If you must use access keys, rotate them every 90 days at minimum. Some organizations rotate more frequently.

**Use temporary credentials with short expiration times.** If you're managing credentials manually, prefer temporary credentials (from STS assume-role) with short durations (e.g., 1 hour) over long-lived access keys.

**Implement least-privilege IAM policies.** Grant only the minimum permissions necessary for your code to function. Use condition-based policies to further restrict access (e.g., allow S3 access only to specific buckets).

**Monitor credential usage with CloudTrail.** Enable CloudTrail logging and review it regularly to detect unauthorized access or unusual patterns.

**Use credential versioning and rotation tools.** Some organizations use tools like HashiCorp Vault or AWS Secrets Manager to centrally manage and rotate credentials. This is a more advanced approach but provides better security and auditability.

**Test credential resolution in your staging environment.** Before deploying to production, verify that credentials are being found correctly in your actual production environment (or a staging environment that mirrors it). Don't assume that because it works locally, it'll work on production infrastructure.

### A Practical Example: Multi-Environment Setup

Let's tie everything together with a realistic example. Imagine you're developing an application that needs to access S3 in multiple AWS accounts: development, staging, and production.

Your `~/.aws/config` might look like:

```ini
[profile base]
sso_start_url = https://mycompany.awsapps.com/start
sso_region = us-east-1
sso_account_id = 111111111111
sso_role_name = SSORoleForDevelopers

[profile dev]
role_arn = arn:aws:iam::222222222222:role/CrossAccountDevRole
source_profile = base
region = us-west-2

[profile staging]
role_arn = arn:aws:iam::333333333333:role/CrossAccountStagingRole
source_profile = base
region = us-east-1

[profile prod]
role_arn = arn:aws:iam::444444444444:role/CrossAccountProdRole
source_profile = base
region = us-east-1
mfa_serial = arn:aws:iam::444444444444:mfa/my-device
```

Note that the prod profile includes an MFA device. When you use this profile, you'll be prompted for your MFA token.

Your application code is simple:

```python
import boto3
import os

# The profile is determined at runtime
profile_name = os.environ.get('AWS_PROFILE', 'dev')

session = boto3.Session(profile_name=profile_name)
s3_client = session.client('s3')

# Your application code uses s3_client normally
```

To test in development:

```bash
export AWS_PROFILE=dev
python app.py
```

To deploy to staging:

```bash
export AWS_PROFILE=staging
# Deploy and run your app
```

To deploy to production:

```bash
export AWS_PROFILE=prod
# Deploy and run your app (will prompt for MFA)
```

The same code works in all three environments. The credential resolution chain automatically finds the right credentials based on the profile, and roles are assumed as needed. This is the power of understanding and leveraging the credential provider chain correctly.

### Conclusion

The AWS SDK credential provider chain is a systematic mechanism for finding credentials in order of precedence, from explicit credentials all the way through to instance metadata. Understanding the order and how each provider works is essential for writing secure, portable AWS applications.

In practice, your strategy should match your environment: use the credentials file for local development (optionally with SSO for better security), use environment variables for CI/CD pipelines, and use instance or task roles for code running on AWS infrastructure. Assume-role profiles and SSO provide flexibility for managing multiple accounts and identities without maintaining multiple sets of long-lived credentials.

When things go wrong—and they will—remember to check your profile configuration, verify file permissions, enable debug logging, and test with the AWS CLI. The credential chain is deterministic; once you understand it, troubleshooting becomes straightforward. Master these concepts, and you'll be confident deploying applications across any AWS environment.
