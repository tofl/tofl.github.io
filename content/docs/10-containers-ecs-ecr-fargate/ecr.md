---
title: "33. ECR"
type: docs
weight: 2
---

## ECR (Elastic Container Registry)

When you containerize applications, you need somewhere reliable to store, version, and distribute your Docker images. ECR is AWS's fully managed container registry that solves exactly this: it gives you a private, secure, and highly available place to push images from your CI/CD pipeline and pull them into ECS, Fargate, or EKS at deploy time. Because ECR lives inside AWS, image pulls stay on the AWS network — no egress costs, lower latency, and no dependency on Docker Hub availability. [🔗](https://docs.aws.amazon.com/AmazonECR/latest/userguide/what-is-ecr.html)

### Public vs Private Repositories

ECR supports two repository types:

- **Private repositories** are the default. Access is controlled entirely through IAM policies and resource-based repository policies. Images are only reachable by authenticated AWS principals within (or explicitly granted across) your account.
- **Public repositories** are hosted on the [Amazon ECR Public Gallery](https://gallery.ecr.aws/) and allow unauthenticated pulls. This is useful for distributing open-source base images or publicly shared tooling. [🔗](https://docs.aws.amazon.com/AmazonECR/latest/public/what-is-ecr.html)

For the exam and for production workloads, private repositories are almost always the focus.

### Docker Push/Pull Workflow with ECR

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

### Image Tagging and Lifecycle Policies

Every image pushed to ECR is identified by its **tag** (e.g. `latest`, `v1.3.2`, a Git SHA) and an immutable **digest** (a SHA-256 hash of the image manifest). You can optionally enable **tag immutability** on a repository, which prevents an existing tag from being overwritten — an important safeguard in production environments where you need to guarantee that `v2.1.0` always refers to the same image. [🔗](https://docs.aws.amazon.com/AmazonECR/latest/userguide/image-tag-mutability.html)

As you push images over time, untagged or old images accumulate and inflate storage costs. **Lifecycle policies** let you define rules that automatically expire images based on age or count. For example: keep only the 10 most recent tagged images, and delete any untagged image older than 7 days. These rules run on a daily evaluation cycle. [🔗](https://docs.aws.amazon.com/AmazonECR/latest/userguide/LifecyclePolicies.html)

### Image Scanning

ECR can scan images for known OS-level and package vulnerabilities (CVEs). There are two scanning modes:

- **Basic scanning** uses the open-source Clair engine and can be configured to run on push or triggered manually. It covers OS package vulnerabilities.
- **Enhanced scanning** integrates with Amazon Inspector and provides continuous, automated scanning — it re-evaluates images as new CVEs are published, not just when an image is first pushed. It also covers application-level dependencies (e.g., npm, pip packages). [🔗](https://docs.aws.amazon.com/AmazonECR/latest/userguide/image-scanning.html)

Scan findings are surfaced in the ECR console, Amazon Inspector, and EventBridge, allowing you to trigger automated responses (such as blocking a deployment pipeline) when a critical vulnerability is detected.

### ECR Integration with ECS and CodePipeline

ECR is the natural image source for ECS task definitions. When you define a container in a task definition, you reference the full ECR image URI:

```json
"image": "123456789012.dkr.ecr.us-east-1.amazonaws.com/my-app:v1.3.2"
```

ECS pulls the image at task launch time using the **Task Execution Role** (discussed in the ECS section) — this is the IAM role that grants ECS the `ecr:GetAuthorizationToken`, `ecr:BatchGetImage`, and `ecr:GetDownloadUrlForLayer` permissions needed to fetch images from ECR. [🔗](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task_execution_IAM_role.html)

In a CI/CD context, CodePipeline typically orchestrates the following flow: CodeBuild builds and pushes a new image to ECR, then CodeDeploy (or ECS itself) triggers a service update that pulls the new image and performs a rolling deployment. ECR acts as the handoff point between build and deploy stages. [🔗](https://docs.aws.amazon.com/codepipeline/latest/userguide/ecs-cd-pipeline.html)

### Encryption and IAM Policies

All images stored in ECR are **encrypted at rest by default** using AES-256 managed by AWS. You can optionally configure repositories to use a **customer-managed KMS key** (AWS KMS) for additional control over the encryption lifecycle. [🔗](https://docs.aws.amazon.com/AmazonECR/latest/userguide/encryption-at-rest.html)

Access control in ECR works at two levels:

- **IAM identity policies** — attached to users, roles, or groups, granting or denying actions like `ecr:PutImage` or `ecr:BatchGetImage` across repositories.
- **Repository policies** — resource-based policies attached directly to a repository. These are essential for **cross-account access**: for example, allowing a deployment role in account B to pull images stored in account A's ECR registry, without the pulling account needing broad IAM permissions on account A. [🔗](https://docs.aws.amazon.com/AmazonECR/latest/userguide/repository-policies.html)

A common pattern in multi-account AWS organizations is to maintain a single central ECR registry in a shared services account, with repository policies granting pull access to workload accounts. This centralizes image management and vulnerability scanning while keeping deployment pipelines decoupled from the registry account.

{{< qcm >}}
[
{
"question": "A developer needs to push a Docker image to an Amazon ECR private repository. What is the correct sequence of steps?",
"answers": [
{
"answer": "Authenticate Docker using `aws ecr get-login-password`, build and tag the image with the ECR URI, then push with `docker push`.",
"isCorrect": true,
"explanation": "This is the correct workflow: authenticate the Docker client against ECR first (token is valid 12 hours), then build, tag with the full ECR URI, and push."
},
{
"answer": "Build the image, push it directly to ECR using `aws ecr put-image`, then tag it in the console.",
"isCorrect": false,
"explanation": "`aws ecr put-image` is a low-level API call for manifest data, not for pushing full images. Standard `docker push` is required, and authentication must happen before pushing."
},
{
"answer": "Build the image, tag it with the ECR URI, then push — no authentication is needed since ECR is an AWS-managed service.",
"isCorrect": false,
"explanation": "Authentication is always required for private ECR repositories. Without running `aws ecr get-login-password | docker login ...`, the push will be rejected."
},
{
"answer": "Run `aws ecr get-login-password` and pipe it into `docker login` with `--username AWS`, then tag and push the image.",
"isCorrect": true,
"explanation": "This correctly describes the authentication step. The username must be `AWS` (literal string) and the password is the token from `get-login-password`."
}
]
},
{
"question": "How long is the authentication token obtained from `aws ecr get-login-password` valid?",
"answers": [
{
"answer": "1 hour",
"isCorrect": false,
"explanation": "1 hour is the default duration for standard IAM temporary credentials, not for ECR authorization tokens."
},
{
"answer": "12 hours",
"isCorrect": true,
"explanation": "The ECR authorization token returned by `get-login-password` is valid for 12 hours, after which a new token must be obtained."
},
{
"answer": "24 hours",
"isCorrect": false,
"explanation": "The token is valid for 12 hours, not 24. Using an expired token will result in authentication errors when pushing or pulling."
},
{
"answer": "Until the IAM session expires",
"isCorrect": false,
"explanation": "The ECR token has its own fixed 12-hour TTL independent of the underlying IAM session duration."
}
]
},
{
"question": "A company wants to ensure that a Docker image tagged `v2.0.0` in their ECR repository always refers to the same image and can never be overwritten by a new push. What feature should they enable?",
"answers": [
{
"answer": "Image scanning",
"isCorrect": false,
"explanation": "Image scanning detects vulnerabilities in images but does not prevent tags from being overwritten."
},
{
"answer": "Tag immutability",
"isCorrect": true,
"explanation": "Enabling tag immutability on the repository prevents existing tags from being reassigned to a different image digest, guaranteeing that `v2.0.0` always points to the same image."
},
{
"answer": "Lifecycle policies",
"isCorrect": false,
"explanation": "Lifecycle policies automatically expire old or untagged images to reduce storage costs; they do not protect tags from being overwritten."
},
{
"answer": "A repository policy denying `ecr:PutImage`",
"isCorrect": false,
"explanation": "Denying `ecr:PutImage` entirely would block all future pushes to the repository, not just overwrites of existing tags. Tag immutability is the targeted feature for this use case."
}
]
},
{
"question": "An ECR repository is accumulating many untagged images, increasing storage costs. What is the recommended way to automatically clean them up?",
"answers": [
{
"answer": "Manually delete untagged images using the AWS CLI on a schedule via a cron job.",
"isCorrect": false,
"explanation": "While technically possible, this is not the recommended approach. ECR lifecycle policies handle this natively without requiring external scheduling or scripting."
},
{
"answer": "Configure an ECR lifecycle policy that expires untagged images after a defined number of days.",
"isCorrect": true,
"explanation": "Lifecycle policies are the built-in ECR feature for this. You can define a rule to delete untagged images older than a given number of days (e.g., 7 days), and ECR evaluates the rules daily."
},
{
"answer": "Enable tag immutability so untagged images are automatically removed.",
"isCorrect": false,
"explanation": "Tag immutability prevents overwriting existing tags; it has no effect on removing untagged images."
},
{
"answer": "Enable enhanced scanning, which removes vulnerable and untagged images automatically.",
"isCorrect": false,
"explanation": "Enhanced scanning identifies vulnerabilities but does not delete images. Lifecycle policies are the correct mechanism for automated image cleanup."
}
]
},
{
"question": "What is the key difference between ECR Basic scanning and ECR Enhanced scanning?",
"answers": [
{
"answer": "Basic scanning uses the open-source Clair engine and scans on push or manually; Enhanced scanning integrates with Amazon Inspector and continuously re-evaluates images as new CVEs are published.",
"isCorrect": true,
"explanation": "This accurately describes both modes. Enhanced scanning also covers application-level dependencies (e.g., npm, pip) in addition to OS packages, and is triggered by new CVE disclosures — not just image pushes."
},
{
"answer": "Basic scanning covers application-level packages; Enhanced scanning covers only OS-level packages.",
"isCorrect": false,
"explanation": "This is reversed. Basic scanning covers OS packages; Enhanced scanning covers both OS packages and application-level dependencies."
},
{
"answer": "Enhanced scanning is only triggered manually, while Basic scanning runs automatically on every push.",
"isCorrect": false,
"explanation": "It's the opposite: Enhanced scanning is continuous and automated. Basic scanning can be configured to run on push, but Enhanced scanning goes further by re-evaluating images when new CVEs emerge."
},
{
"answer": "Basic scanning integrates with Amazon Inspector; Enhanced scanning uses a third-party engine.",
"isCorrect": false,
"explanation": "Amazon Inspector integration is a feature of Enhanced scanning, not Basic scanning. Basic scanning uses the open-source Clair engine."
}
]
},
{
"question": "A security team wants to be automatically notified and block a deployment pipeline whenever a critical vulnerability is found in an ECR image. Which AWS services can surface ECR scan findings to enable this? (Select TWO)",
"answers": [
{
"answer": "Amazon EventBridge",
"isCorrect": true,
"explanation": "ECR scan findings are published as events to EventBridge, allowing you to trigger automated actions such as invoking a Lambda function to block a pipeline."
},
{
"answer": "Amazon Inspector",
"isCorrect": true,
"explanation": "Enhanced scanning integrates with Amazon Inspector, which surfaces and manages vulnerability findings centrally and can feed into automated workflows."
},
{
"answer": "AWS CloudTrail",
"isCorrect": false,
"explanation": "CloudTrail records API calls for auditing purposes but does not surface ECR image scan vulnerability findings."
},
{
"answer": "Amazon GuardDuty",
"isCorrect": false,
"explanation": "GuardDuty focuses on threat detection (e.g., unusual API calls, compromised credentials) and does not process ECR image vulnerability scan results."
}
]
},
{
"question": "An ECS task needs to pull an image from a private ECR repository at launch time. Which IAM role grants ECS the permissions to authenticate with ECR and download the image?",
"answers": [
{
"answer": "The ECS Task Role",
"isCorrect": false,
"explanation": "The Task Role grants permissions to the application running inside the container (e.g., to call S3 or DynamoDB). It is not used to pull images from ECR."
},
{
"answer": "The ECS Task Execution Role",
"isCorrect": true,
"explanation": "The Task Execution Role is assumed by the ECS agent to pull images from ECR. It must have permissions including `ecr:GetAuthorizationToken`, `ecr:BatchGetImage`, and `ecr:GetDownloadUrlForLayer`."
},
{
"answer": "The EC2 instance profile of the container instance",
"isCorrect": false,
"explanation": "While an instance profile can be used in some older ECS setups, the recommended and exam-relevant approach is the Task Execution Role, which works for both EC2 and Fargate launch types."
},
{
"answer": "No IAM role is needed — ECS automatically has access to ECR images in the same account.",
"isCorrect": false,
"explanation": "ECR access is not automatic. The Task Execution Role must explicitly include ECR read permissions, even for images in the same account."
}
]
},
{
"question": "Which IAM permissions must be granted to an ECS Task Execution Role so it can pull images from ECR? (Select THREE)",
"answers": [
{
"answer": "ecr:GetAuthorizationToken",
"isCorrect": true,
"explanation": "This permission allows ECS to obtain an authentication token to log in to the ECR registry."
},
{
"answer": "ecr:BatchGetImage",
"isCorrect": true,
"explanation": "This permission allows ECS to retrieve the image manifest from ECR."
},
{
"answer": "ecr:GetDownloadUrlForLayer",
"isCorrect": true,
"explanation": "This permission allows ECS to download the individual image layers that make up the Docker image."
},
{
"answer": "ecr:PutImage",
"isCorrect": false,
"explanation": "`ecr:PutImage` is used to push images to ECR, not to pull them. Task Execution Roles only need read permissions."
},
{
"answer": "ecr:CreateRepository",
"isCorrect": false,
"explanation": "Creating repositories is an administrative action unrelated to pulling images at task launch time."
}
]
},
{
"question": "A company uses a multi-account AWS organization with a central shared services account that hosts all Docker images in ECR. How should deployment roles in other accounts be granted pull access to those images?",
"answers": [
{
"answer": "Attach IAM policies to each deployment role that grant full access to the shared services account.",
"isCorrect": false,
"explanation": "Granting broad IAM access across accounts is not a least-privilege approach. Resource-based repository policies on the ECR side are the recommended mechanism for cross-account access."
},
{
"answer": "Configure ECR repository policies in the shared services account to explicitly grant pull permissions to the deployment roles in the workload accounts.",
"isCorrect": true,
"explanation": "Repository policies are resource-based policies that enable cross-account access. By specifying the ARNs of the deployment roles from other accounts, you allow those roles to pull images without requiring broad IAM permissions on the registry account."
},
{
"answer": "Make the ECR repositories public so all accounts can pull without authentication.",
"isCorrect": false,
"explanation": "Making repositories public removes all access control and exposes images to the internet. This is not appropriate for internal container images."
},
{
"answer": "Replicate the ECR repository to each workload account so each account has its own copy.",
"isCorrect": false,
"explanation": "Replicating images to every account defeats the purpose of a centralized registry, increases storage costs, and complicates image management and vulnerability scanning."
}
]
},
{
"question": "What are the two levels at which access to ECR repositories can be controlled? (Select TWO)",
"answers": [
{
"answer": "IAM identity policies attached to users, roles, or groups",
"isCorrect": true,
"explanation": "IAM identity policies grant or deny ECR actions (e.g., `ecr:PutImage`, `ecr:BatchGetImage`) to specific AWS principals across repositories."
},
{
"answer": "Resource-based repository policies attached directly to an ECR repository",
"isCorrect": true,
"explanation": "Repository policies allow fine-grained access control at the repository level, and are especially important for cross-account access scenarios."
},
{
"answer": "VPC endpoint policies",
"isCorrect": false,
"explanation": "VPC endpoint policies can restrict which ECR API calls are allowed through a VPC endpoint, but they are not one of the two primary access control mechanisms for ECR repositories."
},
{
"answer": "S3 bucket policies on the underlying image storage",
"isCorrect": false,
"explanation": "Although ECR uses S3 internally, you do not access or control ECR images through S3 bucket policies. All access is managed through ECR's own IAM and repository policy system."
}
]
},
{
"question": "What encryption is applied to images stored in Amazon ECR by default?",
"answers": [
{
"answer": "No encryption — encryption must be explicitly enabled.",
"isCorrect": false,
"explanation": "ECR encrypts all images at rest by default. Encryption is not opt-in."
},
{
"answer": "AES-256 encryption managed by AWS.",
"isCorrect": true,
"explanation": "All images in ECR are encrypted at rest by default using AES-256 with AWS-managed keys. You can optionally bring your own KMS key for additional control."
},
{
"answer": "TLS encryption in transit only — images at rest are not encrypted by default.",
"isCorrect": false,
"explanation": "ECR encrypts both in transit (TLS) and at rest. Images stored in ECR are encrypted at rest by default using AES-256."
},
{
"answer": "AES-128 encryption using a customer-managed KMS key.",
"isCorrect": false,
"explanation": "The default encryption algorithm is AES-256, not AES-128, and it uses AWS-managed keys by default — not customer-managed KMS keys."
}
]
},
{
"question": "A developer wants additional control over the encryption lifecycle of images stored in ECR. What option should they configure?",
"answers": [
{
"answer": "Enable tag immutability on the repository.",
"isCorrect": false,
"explanation": "Tag immutability prevents tags from being overwritten and has no relation to encryption key management."
},
{
"answer": "Configure the repository to use a customer-managed AWS KMS key.",
"isCorrect": true,
"explanation": "ECR supports customer-managed KMS keys (CMKs) for repositories, giving you control over key rotation, access policies, and key deletion — beyond the default AWS-managed encryption."
},
{
"answer": "Enable enhanced scanning, which also provides encryption at rest.",
"isCorrect": false,
"explanation": "Enhanced scanning is for vulnerability detection, not encryption. ECR already encrypts at rest by default regardless of scanning configuration."
},
{
"answer": "Upload images via the AWS console, which applies stronger encryption than the CLI.",
"isCorrect": false,
"explanation": "The upload method (console vs. CLI) has no effect on encryption. Encryption is configured at the repository level, not at the upload method level."
}
]
},
{
"question": "In a CI/CD pipeline using AWS CodePipeline, what is ECR's typical role?",
"answers": [
{
"answer": "ECR compiles application code and produces Docker images automatically.",
"isCorrect": false,
"explanation": "ECR is a registry for storing and distributing images, not a build tool. CodeBuild handles the compilation and image build step."
},
{
"answer": "ECR acts as the handoff point between the build stage (CodeBuild) and the deploy stage (CodeDeploy or ECS), storing the newly built image that ECS pulls during deployment.",
"isCorrect": true,
"explanation": "In a typical CodePipeline flow: CodeBuild builds the image and pushes it to ECR, then the deploy stage triggers ECS to pull the new image from ECR and perform a rolling update."
},
{
"answer": "ECR triggers CodePipeline executions when new code is committed to CodeCommit.",
"isCorrect": false,
"explanation": "CodePipeline is triggered by source changes (e.g., CodeCommit, S3, GitHub), not by ECR. ECR is downstream in the pipeline, not the trigger."
},
{
"answer": "ECR replaces CodeDeploy by managing blue/green deployments directly.",
"isCorrect": false,
"explanation": "ECR is a container registry, not a deployment orchestrator. Blue/green deployments are managed by CodeDeploy or ECS, using images stored in ECR."
}
]
},
{
"question": "A public ECR repository differs from a private ECR repository in which of the following ways?",
"answers": [
{
"answer": "Public repositories allow unauthenticated pulls and are listed on the Amazon ECR Public Gallery.",
"isCorrect": true,
"explanation": "Public repositories are accessible without AWS authentication, making them suitable for distributing open-source base images. They appear on gallery.ecr.aws."
},
{
"answer": "Public repositories support lifecycle policies to automatically expire images.",
"isCorrect": false,
"explanation": "Lifecycle policies are a feature of private ECR repositories. Public repositories do not support the same lifecycle management capabilities."
},
{
"answer": "Public repositories require IAM policies for all pull requests.",
"isCorrect": false,
"explanation": "IAM-based access control is characteristic of private repositories. Public repositories allow unauthenticated (anonymous) pulls."
},
{
"answer": "Private repositories can only be accessed from within the same AWS account.",
"isCorrect": false,
"explanation": "Private repositories can grant cross-account access via repository policies, allowing principals in other accounts to pull images."
}
]
},
{
"question": "What is an image digest in Amazon ECR, and why is it significant?",
"answers": [
{
"answer": "A human-readable alias (e.g., `latest`) assigned at push time that can be updated to point to a newer image.",
"isCorrect": false,
"explanation": "That describes an image tag, not a digest. Tags are mutable by default (unless tag immutability is enabled)."
},
{
"answer": "An immutable SHA-256 hash of the image manifest that uniquely and permanently identifies a specific image version.",
"isCorrect": true,
"explanation": "The digest is cryptographically derived from the image manifest and never changes, regardless of tag mutations. Referencing an image by digest guarantees you always get the exact same image."
},
{
"answer": "A checksum applied only during image transfer to detect corruption.",
"isCorrect": false,
"explanation": "While the SHA-256 digest does help verify integrity, it is a persistent identifier stored in ECR for every image — not a transient transfer checksum."
},
{
"answer": "An AWS-generated identifier used only for billing and storage tracking.",
"isCorrect": false,
"explanation": "Image digests are content-addressed identifiers derived from the image manifest, not internal billing metadata."
}
]
},
{
"question": "Which of the following are advantages of using Amazon ECR over Docker Hub for storing container images in an AWS-based architecture? (Select TWO)",
"answers": [
{
"answer": "Image pulls between ECR and AWS services (ECS, EKS, Fargate) stay on the AWS network, avoiding egress costs and reducing latency.",
"isCorrect": true,
"explanation": "Because ECR is an AWS-native service, traffic between ECR and other AWS services stays within the AWS network, eliminating data transfer costs and improving pull performance."
},
{
"answer": "ECR integrates natively with IAM for access control, enabling fine-grained and centralized permission management.",
"isCorrect": true,
"explanation": "IAM integration allows you to control who can push, pull, or manage images using the same identity and policy system used across all AWS services — something Docker Hub does not offer natively."
},
{
"answer": "ECR provides unlimited free storage for all images regardless of size.",
"isCorrect": false,
"explanation": "ECR charges for storage and data transfer (though pulls within the AWS network are free). Storage is not unlimited or free for all image data."
},
{
"answer": "ECR supports more programming languages than Docker Hub.",
"isCorrect": false,
"explanation": "Both ECR and Docker Hub are container registries that store Docker images. The programming language of the containerized application is irrelevant to registry choice."
}
]
}
]
{{< /qcm >}}