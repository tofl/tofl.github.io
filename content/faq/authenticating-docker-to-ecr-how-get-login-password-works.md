---
title: "Authenticating Docker to ECR: How get-login-password Works"
---

## Authenticating Docker to ECR: How get-login-password Works

Docker image registries require authentication. When you want to push your application's container image to Amazon Elastic Container Registry (ECR) or pull images from it, Docker needs credentials to prove you have permission. Unlike some registries that use static username-password pairs, ECR uses temporary, time-limited authorization tokens. Understanding how these tokens work—and what happens when they expire—is essential for anyone building containerized applications on AWS.

This article walks you through the complete authentication flow. We'll explore the `get-login-password` command that most developers encounter first, examine why tokens expire after 12 hours, discuss strategies for automating token refresh in CI/CD pipelines and long-running build agents, and explore alternatives like the Amazon ECR credential helper. By the end, you'll have a complete mental model of ECR authentication that will help you troubleshoot issues, design robust automation, and make informed decisions about which authentication approach suits your workflow.

### The Problem: Why ECR Authentication Matters

When Docker interacts with a registry—whether pushing a newly built image or pulling a base image—it must authenticate. Docker stores these credentials in a local configuration file (typically `~/.docker/config.json`). The format of these credentials varies by registry. For registries like Docker Hub, you might use a static username and password. For ECR, things work differently.

AWS IAM is the source of truth for permissions. When you authenticate to ECR, you're not creating a permanent credential. Instead, you're exchanging your AWS credentials (access key and secret access key, or temporary session credentials from an IAM role) for a short-lived authorization token. This token is valid for exactly 12 hours. After that, you need to refresh it.

This design has real benefits. A leaked Docker registry credential can't be used indefinitely to access your private images. An attacker would have at most 12 hours to exploit it before the token becomes worthless. It also ties access control to IAM, so you can use familiar AWS identity and access management policies to control who can push and pull container images.

But it also means automation scripts and long-running systems need to handle token refresh gracefully. Understanding this flow is what separates developers who occasionally get frustrated by authentication errors from those who build reliable, self-healing container pipelines.

### Understanding the get-login-password Command

The most straightforward way to authenticate Docker to ECR is using the AWS CLI command `aws ecr get-login-password`. Let's walk through what this command actually does.

When you run:

```bash
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin <account-id>.dkr.ecr.us-east-1.amazonaws.com
```

You're executing two separate operations. First, `aws ecr get-login-password` contacts AWS and requests an authorization token. This command does the following behind the scenes:

The AWS CLI uses your configured credentials—either an IAM user's access key pair, temporary credentials from an assumed role, or credentials from an EC2 instance's IAM instance profile—to make an authenticated request to the ECR service. The request essentially says: "I'm this AWS identity, and I'd like a token to authenticate to my ECR registry." ECR validates that your identity has permission to access the registry (via IAM policies), and if it does, it generates a temporary token.

This token is cryptographically signed and includes encoded information about which AWS identity it was issued to, when it was issued, and when it will expire (always 12 hours in the future). The token is then returned as plain text to stdout.

Second, `docker login` takes that token and stores it in Docker's configuration. Specifically, it:

- Takes the token you piped from the AWS CLI
- Creates a base64-encoded credential string where the username is literally "AWS" and the password is the token
- Stores this credential in `~/.docker/config.json` under the registry domain
- From this point forward, Docker will automatically include these credentials when making requests to that registry

Let's look at what actually gets stored. If you inspect your Docker config file after logging in, you'll see something like:

```json
{
  "auths": {
    "123456789012.dkr.ecr.us-east-1.amazonaws.com": {
      "auth": "QVdTOmV5SndZWGt...",
      "email": "none"
    }
  }
}
```

That `auth` field is a base64-encoded string of "AWS:TOKEN". When Docker needs to authenticate to ECR, it decodes this string and sends it as an HTTP Authorization header using Basic authentication.

### The 12-Hour Token Validity Window

ECR tokens are valid for exactly 12 hours. This isn't arbitrary; it's a security design decision. Here's why this matters.

AWS constructs the token with an expiration timestamp. When a registry receives a request with the token as the password, it validates the signature and checks whether the token has expired. After 12 hours, the cryptographic validation will fail, and Docker will be unable to push or pull images.

For developers working on their laptops, this is rarely an issue. You build and push an image, and within 12 hours, your token is still valid. But in CI/CD pipelines, the situation is different.

Consider a Jenkins agent that has been running for three days. The first time it needs to push an image, someone runs `aws ecr get-login-password` and logs in. Twelve hours later, the credentials in Docker's config file are stale. When the build job attempts to push, Docker sends the expired token to ECR, which rejects it. The push fails, the build fails, and your deployment is blocked.

This is one of the most common authentication errors developers encounter: `denied: User: arn:aws:iam::123456789012:user/build-agent is not authorized to perform: ecr:BatchGetImage on resource...` or more cryptically, the push simply fails with an authentication error.

### Automating Token Refresh in Long-Running Environments

If your build agents, CI/CD systems, or container orchestration platforms run for longer than 12 hours without restarting, you need a strategy to refresh tokens before they expire. Here are the practical approaches.

#### Periodic Refresh in CI/CD Jobs

For most CI/CD systems, the simplest approach is to refresh the token at the beginning of every job. This ensures that whenever your job runs, it has a fresh token valid for 12 more hours. A typical pattern in Jenkins, GitLab CI, GitHub Actions, or similar systems is:

```bash
#!/bin/bash
set -e

# Refresh ECR login token
aws ecr get-login-password --region us-east-1 | \
  docker login --username AWS --password-stdin 123456789012.dkr.ecr.us-east-1.amazonaws.com

# Now proceed with your build and push
docker build -t 123456789012.dkr.ecr.us-east-1.amazonaws.com/myapp:latest .
docker push 123456789012.dkr.ecr.us-east-1.amazonaws.com/myapp:latest
```

This approach works because it's simple and reliable. Your CI/CD job is typically short-lived, so the token will remain valid throughout execution.

#### Scheduled Refresh for Always-On Build Agents

Some organizations use persistent build agents that stay online for weeks or months. For these, you might implement a scheduled refresh. For example, a cron job that refreshes the token every 11 hours:

```bash
# /etc/cron.d/ecr-token-refresh
0 */11 * * * /opt/scripts/refresh-ecr-token.sh
```

The script might look like:

```bash
#!/bin/bash
aws ecr get-login-password --region us-east-1 | \
  docker login --username AWS --password-stdin 123456789012.dkr.ecr.us-east-1.amazonaws.com

# Log the refresh
echo "ECR token refreshed at $(date)" >> /var/log/ecr-refresh.log
```

By scheduling the refresh every 11 hours, you ensure the token always has at least an hour of validity remaining before it expires.

#### Handling Multiple Regions

If you're pushing to ECR in multiple AWS regions, you need to refresh tokens for each region separately:

```bash
for region in us-east-1 us-west-2 eu-west-1; do
  aws ecr get-login-password --region $region | \
    docker login --username AWS --password-stdin $(aws sts get-caller-identity --query Account --output text).dkr.ecr.$region.amazonaws.com
done
```

#### Detecting Expiration and Failing Fast

In some scenarios, you might want to proactively detect whether your credentials are about to expire and refresh them before attempting an operation. You can decode and inspect the JWT token:

```bash
#!/bin/bash
TOKEN=$(aws ecr get-login-password --region us-east-1)
DECODED=$(echo $TOKEN | cut -d'.' -f2 | base64 -d)
EXPIRY=$(echo $DECODED | grep -o '"exp":[0-9]*' | cut -d':' -f2)
CURRENT_TIME=$(date +%s)

if [ $((EXPIRY - CURRENT_TIME)) -lt 3600 ]; then
  echo "Token expiring within 1 hour, refreshing..."
  echo $TOKEN | docker login --username AWS --password-stdin 123456789012.dkr.ecr.us-east-1.amazonaws.com
fi
```

This approach checks whether the token will expire within the next hour and refreshes preemptively.

### The Amazon ECR Credential Helper Alternative

While `get-login-password` works well, there's another approach that many organizations prefer for long-running systems: the Amazon ECR credential helper. This tool is a Docker credential helper that automatically handles token refresh for you.

The credential helper is a separate binary called `docker-credential-ecr-login` that you install on your system. Once installed and configured, Docker delegates credential lookup to this helper instead of reading static tokens from the config file.

Here's how the setup works. First, you install the credential helper:

```bash
# On Amazon Linux 2 or similar
sudo yum install amazon-ecr-credential-helper

# Or on macOS with Homebrew
brew install amazon-ecr-credential-helper

# Or build from source if needed
go install github.com/awslabs/amazon-ecr-credential-helper/ecr-login/cli/docker-credential-ecr-login@latest
```

Then, you configure Docker to use it by editing `~/.docker/config.json`:

```json
{
  "credHelpers": {
    "123456789012.dkr.ecr.us-east-1.amazonaws.com": "ecr-login",
    "123456789012.dkr.ecr.us-west-2.amazonaws.com": "ecr-login"
  }
}
```

From that point forward, whenever Docker needs credentials for an ECR registry, it automatically calls the credential helper. The helper checks whether it has a cached token and whether that token is still valid. If the token is expired or missing, it automatically calls `aws ecr get-login-password` to fetch a fresh one. All of this happens transparently—you just push and pull images as normal.

The advantage is that you don't need to manually refresh tokens or write scripts to manage token lifecycle. The credential helper handles it. This is particularly valuable in long-running build agents, development machines, or CI/CD runners that operate indefinitely.

The credential helper caches tokens in `~/.docker/config.json.d/` and automatically refreshes them when needed. It uses your existing AWS credentials (either configured in `~/.aws/credentials`, environment variables, or IAM instance profiles), so there's nothing new to manage from a credentials perspective.

One thing to note: the credential helper must have access to valid AWS credentials. If you're using an EC2 instance, this means the instance needs an IAM instance profile attached. If you're running locally, you need AWS CLI credentials configured. If those credentials are missing or invalid, the credential helper can't obtain tokens, and Docker operations will fail.

### Automatic Authentication in ECS and EKS

If you're running containers on Amazon ECS or Amazon EKS, you get authentication to ECR almost for free. This is one of the nice benefits of staying within the AWS ecosystem.

In ECS, when you define a task, you specify an execution role. This IAM role is assumed by the ECS agent running on your container instance. If the execution role has permissions to access ECR (typically via the `AmazonEC2ContainerRegistryPowerUser` or `AmazonEC2ContainerRegistryReadOnly` managed policy), the ECS agent can automatically pull images from ECR without any manual authentication steps.

You don't need to provide Docker credentials at all. The ECS agent uses the instance's IAM instance profile to authenticate to ECR automatically. It's seamless.

Similarly, in EKS, the Kubelet running on each node can be configured to authenticate to ECR using the node's IAM instance profile. When you specify a container image from your ECR registry in a Kubernetes pod, the Kubelet automatically pulls it without any manual credentials.

There's a caveat: the node's IAM instance profile must have permissions to access ECR. By default, Amazon EKS node groups come with a role that includes ECR pull permissions, so this typically works out of the box.

If you want to be more precise about who can pull which images, you can use cross-account ECR access. For instance, you might have your ECR registries in a central AWS account and pull them from ECS or EKS running in different accounts. This requires configuring trust relationships between the ECR registry's account and the account running the containers, but once set up, authentication is still automatic via IAM roles.

### Common Authentication Errors and Troubleshooting

Let's walk through the most common ECR authentication errors developers encounter and how to diagnose them.

#### "no basic auth credentials"

This error usually means Docker doesn't have any credentials stored for your ECR registry. The solution is straightforward: run the login command again:

```bash
aws ecr get-login-password --region us-east-1 | \
  docker login --username AWS --password-stdin 123456789012.dkr.ecr.us-east-1.amazonaws.com
```

If you get this error, verify that:
- Your AWS credentials are valid and configured
- You're using the correct ECR registry URL (check the account ID and region)
- Your Docker client has write access to `~/.docker/config.json`

#### "denied: User is not authorized to perform: ecr:BatchGetImage"

This error typically indicates one of two things. First, your credentials are expired. If you logged in more than 12 hours ago, the token is stale. Refresh it:

```bash
aws ecr get-login-password --region us-east-1 | \
  docker login --username AWS --password-stdin 123456789012.dkr.ecr.us-east-1.amazonaws.com
```

Second, your IAM user or role doesn't have permission to access ECR. Check your IAM policy:

```bash
aws iam list-attached-user-policies --user-name <your-username>
```

Make sure a policy granting ECR permissions is attached. The policy should include actions like `ecr:GetDownloadUrlForLayer`, `ecr:BatchGetImage`, and potentially `ecr:PutImage` and `ecr:InitiateLayerUpload` depending on what you're doing.

#### "error storing credentials... permission denied"

This usually means Docker can't write to `~/.docker/config.json`. Check file permissions:

```bash
ls -la ~/.docker/
```

The directory should be owned by your user. If it's owned by root or has restrictive permissions, fix it:

```bash
sudo chown -R $(whoami):$(whoami) ~/.docker
chmod 700 ~/.docker
chmod 600 ~/.docker/config.json
```

#### "no matching manifest for linux/arm64/v8"

This error is related to image architecture, not authentication. But it's common enough to mention. It usually means you built an image on one architecture (say, your Mac with Apple Silicon) and are trying to run it on a different architecture (say, a Linux x86_64 instance). Push multi-architecture images using Docker buildx, or ensure your base images match your target architecture.

### IAM Permissions Required for ECR Authentication

To use ECR authentication successfully, your IAM user or role needs specific permissions. Here's what the minimum policy looks like:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "ecr:GetAuthorizationToken"
      ],
      "Resource": "*"
    }
  ]
}
```

The `ecr:GetAuthorizationToken` permission is what allows the AWS CLI to obtain the authentication token. This permission is special—it applies to the ECR service itself, not to a specific registry, so the resource is always "*".

If you also need to push images, add these permissions:

```json
{
  "Effect": "Allow",
  "Action": [
    "ecr:BatchCheckLayerAvailability",
    "ecr:PutImage",
    "ecr:InitiateLayerUpload",
    "ecr:UploadLayerPart",
    "ecr:CompleteLayerUpload"
  ],
  "Resource": "arn:aws:ecr:us-east-1:123456789012:repository/myapp"
}
```

If you only need to pull images, use these permissions instead:

```json
{
  "Effect": "Allow",
  "Action": [
    "ecr:BatchGetImage",
    "ecr:GetDownloadUrlForLayer"
  ],
  "Resource": "arn:aws:ecr:us-east-1:123456789012:repository/myapp"
}
```

Most organizations use AWS's managed policies for convenience. `AmazonEC2ContainerRegistryPowerUser` grants full access to ECR operations, while `AmazonEC2ContainerRegistryReadOnly` allows only pulling images.

### Best Practices for ECR Authentication

As you design your container deployment pipeline, keep these best practices in mind.

First, always use IAM roles instead of IAM user access keys when possible. If you're running containers on EC2, ECS, or EKS, attach an IAM instance profile or task role instead of hardcoding access keys. This is more secure and requires less credential management.

Second, implement token refresh automation early. Whether you use a cron job, the ECR credential helper, or a custom script in your CI/CD pipeline, don't wait until you hit a token expiration error in production. Make token refresh automatic and transparent.

Third, use separate IAM roles for different workloads when possible. Your build agent pushing images might have `ecr:PutImage` permissions, while your application running in ECS might only have `ecr:BatchGetImage` permissions. This applies the principle of least privilege and limits the blast radius if credentials are compromised.

Fourth, monitor authentication failures. Log failed push and pull attempts, set up CloudWatch alarms for ECR API errors, and alert your team when something goes wrong. Authentication issues are often early warnings that credentials need refreshing or IAM permissions have drifted.

Fifth, document your authentication setup. Whether you're using `get-login-password`, the credential helper, or automatic ECS/EKS authentication, document it clearly so your team knows how it works and how to troubleshoot it.

### Conclusion

ECR authentication is elegant in its design: short-lived tokens derived from AWS IAM credentials, automatic in container orchestration platforms, and manageable with simple CLI commands or credential helpers. The 12-hour token validity window is a security feature, not a limitation, provided you have a strategy to refresh tokens in long-running systems.

The key takeaway is this: understand the token lifecycle. Know that tokens expire, have automation in place to refresh them, and monitor authentication failures. Whether you're pushing images from a laptop, a Jenkins agent, or a container running on ECS, you now understand exactly what's happening behind the scenes when Docker authenticates to ECR. You can troubleshoot authentication errors confidently, design reliable automation, and choose the authentication approach that best fits your workflow.
