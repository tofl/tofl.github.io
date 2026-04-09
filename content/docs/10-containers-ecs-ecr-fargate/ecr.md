---
title: "33. ECR"
type: docs
weight: 2
---

## ECR (Elastic Container Registry)

When you containerize applications, you need somewhere reliable to store, version, and distribute your Docker images. ECR is AWS's fully managed container registry that solves exactly this: it gives you a private, secure, and highly available place to push images from your CI/CD pipeline and pull them into ECS, Fargate, or EKS at deploy time. Because ECR lives inside AWS, image pulls stay on the AWS network — no egress costs, lower latency, and no dependency on Docker Hub availability. [🔗](https://docs.aws.amazon.com/AmazonECR/latest/userguide/what-is-ecr.html)

## Public vs Private Repositories

ECR supports two repository types:

- **Private repositories** are the default. Access is controlled entirely through IAM policies and resource-based repository policies. Images are only reachable by authenticated AWS principals within (or explicitly granted across) your account.
- **Public repositories** are hosted on the [Amazon ECR Public Gallery](https://gallery.ecr.aws/) and allow unauthenticated pulls. This is useful for distributing open-source base images or publicly shared tooling. [🔗](https://docs.aws.amazon.com/AmazonECR/latest/public/what-is-ecr.html)

For the exam and for production workloads, private repositories are almost always the focus.

## Docker Push/Pull Workflow with ECR

Working with ECR follows the same Docker CLI commands you already know, with one extra step: authenticating the Docker client against the ECR registry using the AWS CLI.

```bash
# 1. Authenticate Docker to your ECR registry
aws ecr get-login-password --region us-east-1 \
  | docker login --username AWS --password-stdin \
    123456789012.dkr.ecr.us-east-1.amazonaws.com

# 2. Build your image locally
docker build -t my-app .

# 3. Tag it for ECR
docker tag my-app:latest \
  123456789012.dkr.ecr.us-east-1.amazonaws.com/my-app:latest

# 4. Push to ECR
docker push 123456789012.dkr.ecr.us-east-1.amazonaws.com/my-app:latest
```

Pulling works the same way — once authenticated, `docker pull` fetches the image from ECR just like any other registry. The `get-login-password` token is valid for 12 hours. [🔗](https://docs.aws.amazon.com/AmazonECR/latest/userguide/getting-started-cli.html)

## Image Tagging and Lifecycle Policies

Every image pushed to ECR is identified by its **tag** (e.g. `latest`, `v1.3.2`, a Git SHA) and an immutable **digest** (a SHA-256 hash of the image manifest). You can optionally enable **tag immutability** on a repository, which prevents an existing tag from being overwritten — an important safeguard in production environments where you need to guarantee that `v2.1.0` always refers to the same image. [🔗](https://docs.aws.amazon.com/AmazonECR/latest/userguide/image-tag-mutability.html)

As you push images over time, untagged or old images accumulate and inflate storage costs. **Lifecycle policies** let you define rules that automatically expire images based on age or count. For example: keep only the 10 most recent tagged images, and delete any untagged image older than 7 days. These rules run on a daily evaluation cycle. [🔗](https://docs.aws.amazon.com/AmazonECR/latest/userguide/LifecyclePolicies.html)

## Image Scanning

ECR can scan images for known OS-level and package vulnerabilities (CVEs). There are two scanning modes:

- **Basic scanning** uses the open-source Clair engine and can be configured to run on push or triggered manually. It covers OS package vulnerabilities.
- **Enhanced scanning** integrates with Amazon Inspector and provides continuous, automated scanning — it re-evaluates images as new CVEs are published, not just when an image is first pushed. It also covers application-level dependencies (e.g., npm, pip packages). [🔗](https://docs.aws.amazon.com/AmazonECR/latest/userguide/image-scanning.html)

Scan findings are surfaced in the ECR console, Amazon Inspector, and EventBridge, allowing you to trigger automated responses (such as blocking a deployment pipeline) when a critical vulnerability is detected.

## ECR Integration with ECS and CodePipeline

ECR is the natural image source for ECS task definitions. When you define a container in a task definition, you reference the full ECR image URI:

```json
"image": "123456789012.dkr.ecr.us-east-1.amazonaws.com/my-app:v1.3.2"
```

ECS pulls the image at task launch time using the **Task Execution Role** (discussed in the ECS section) — this is the IAM role that grants ECS the `ecr:GetAuthorizationToken`, `ecr:BatchGetImage`, and `ecr:GetDownloadUrlForLayer` permissions needed to fetch images from ECR. [🔗](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task_execution_IAM_role.html)

In a CI/CD context, CodePipeline typically orchestrates the following flow: CodeBuild builds and pushes a new image to ECR, then CodeDeploy (or ECS itself) triggers a service update that pulls the new image and performs a rolling deployment. ECR acts as the handoff point between build and deploy stages. [🔗](https://docs.aws.amazon.com/codepipeline/latest/userguide/ecs-cd-pipeline.html)

## Encryption and IAM Policies

All images stored in ECR are **encrypted at rest by default** using AES-256 managed by AWS. You can optionally configure repositories to use a **customer-managed KMS key** (AWS KMS) for additional control over the encryption lifecycle. [🔗](https://docs.aws.amazon.com/AmazonECR/latest/userguide/encryption-at-rest.html)

Access control in ECR works at two levels:

- **IAM identity policies** — attached to users, roles, or groups, granting or denying actions like `ecr:PutImage` or `ecr:BatchGetImage` across repositories.
- **Repository policies** — resource-based policies attached directly to a repository. These are essential for **cross-account access**: for example, allowing a deployment role in account B to pull images stored in account A's ECR registry, without the pulling account needing broad IAM permissions on account A. [🔗](https://docs.aws.amazon.com/AmazonECR/latest/userguide/repository-policies.html)

A common pattern in multi-account AWS organizations is to maintain a single central ECR registry in a shared services account, with repository policies granting pull access to workload accounts. This centralizes image management and vulnerability scanning while keeping deployment pipelines decoupled from the registry account.