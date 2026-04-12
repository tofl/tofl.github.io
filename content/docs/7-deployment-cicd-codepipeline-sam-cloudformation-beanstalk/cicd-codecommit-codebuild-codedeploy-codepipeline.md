---
title: "19. CI/CD (CodeCommit, CodeBuild, CodeDeploy, CodePipeline)"
type: docs
weight: 1
---

## CI/CD (CodeCommit, CodeBuild, CodeDeploy, CodePipeline)

Shipping software manually — SSHing into servers, copying files, running scripts by hand — is slow, error-prone, and impossible to scale. CI/CD (Continuous Integration / Continuous Delivery) solves this by automating the entire journey from a code commit to a running deployment. AWS provides a suite of fully managed services that each handle one stage of this pipeline: **CodeCommit** stores your source code, **CodeBuild** compiles and tests it, **CodeDeploy** pushes it to your infrastructure, and **CodePipeline** orchestrates all of these steps into a single automated workflow.

### CodeCommit

CodeCommit [🔗](https://docs.aws.amazon.com/codecommit/latest/userguide/welcome.html) is AWS's managed Git hosting service. It behaves like GitHub or Bitbucket, but runs entirely within your AWS account — meaning your repositories benefit from IAM-based access control, encryption at rest and in transit, and VPC isolation without any extra setup.

Key concepts to know:

- **Repositories** are the core resource. You create one per project and interact with it using standard Git commands.
- **Branch policies** let you protect branches (e.g., `main`) by requiring pull request approvals before merging.
- **Triggers and notifications** allow CodeCommit to invoke a Lambda function or send an SNS notification when specific events occur (push, pull request created, etc.) — useful for kicking off a pipeline or alerting a team.

> **Exam note:** AWS announced in July 2024 that CodeCommit is no longer available to new customers. Existing customers can continue using it, and it still appears on the DVA-C02 exam. For new projects, AWS recommends using **CodeStar Connections** to connect CodePipeline to GitHub or Bitbucket (covered below).

### CodeBuild

CodeBuild [🔗](https://docs.aws.amazon.com/codebuild/latest/userguide/welcome.html) is a fully managed build service. You give it your source code and a set of instructions; it spins up a temporary, isolated container, runs your build, and tears the environment down when done. You pay only for build minutes used — there are no idle servers.

**The `buildspec.yml` file** [🔗](https://docs.aws.amazon.com/codebuild/latest/userguide/build-spec-ref.html) is the heart of every CodeBuild project. It lives at the root of your repository and defines exactly what CodeBuild does. Its structure has four main phases:

```yaml
version: 0.2

phases:
  install:
    commands:
      - npm install
  pre_build:
    commands:
      - echo Running tests...
      - npm test
  build:
    commands:
      - npm run build
  post_build:
    commands:
      - echo Build complete

artifacts:
  files:
    - '**/*'
  base-directory: dist

cache:
  paths:
    - node_modules/**/*
```

- **`install`** — set up the environment (install runtimes, tools).
- **`pre_build`** — preparation steps like logging into ECR or running linters.
- **`build`** — the main compilation or packaging step.
- **`post_build`** — cleanup, pushing Docker images, sending notifications.

The **`artifacts`** block tells CodeBuild what to package up and send to S3 (or pass to the next pipeline stage). The **`cache`** block lets you persist directories — like `node_modules` — between builds to dramatically speed up build times [🔗](https://docs.aws.amazon.com/codebuild/latest/userguide/build-caching.html).

**Environment variables** can be injected into builds as plaintext, or referenced securely from **SSM Parameter Store** or **Secrets Manager** directly in the buildspec, so you never hardcode credentials [🔗](https://docs.aws.amazon.com/codebuild/latest/userguide/build-env-ref-env-vars.html).

### CodeDeploy

CodeDeploy [🔗](https://docs.aws.amazon.com/codedeploy/latest/userguide/welcome.html) automates the actual delivery of your application to its target compute. Unlike CodeBuild (which builds), CodeDeploy only deploys — it takes an artifact and installs it somewhere. It supports three deployment targets:

- **EC2 / On-Premises** — a CodeDeploy agent runs on each instance and pulls the revision from S3 or GitHub.
- **AWS Lambda** — shifts traffic between Lambda function versions using aliases.
- **Amazon ECS** — replaces task definitions in a service, supporting blue/green deployments.

**The `appspec.yml` file** [🔗](https://docs.aws.amazon.com/codedeploy/latest/userguide/reference-appspec-file.html) is CodeDeploy's equivalent of the buildspec — it describes how to install the application and defines **lifecycle hooks**: scripts that run at specific points during the deployment (e.g., before installation, after installation, during validation). For EC2 deployments a typical appspec looks like:

```yaml
version: 0.0
os: linux
files:
  - source: /
    destination: /var/www/myapp
hooks:
  BeforeInstall:
    - location: scripts/stop_server.sh
  AfterInstall:
    - location: scripts/start_server.sh
  ValidateService:
    - location: scripts/validate.sh
```

**Deployment configurations** control the rollout speed for EC2/On-Premises targets [🔗](https://docs.aws.amazon.com/codedeploy/latest/userguide/deployment-configurations.html):

- **AllAtOnce** — deploys to all instances simultaneously. Fastest, but causes downtime if something goes wrong.
- **HalfAtATime** — deploys to 50% of instances at a time. Maintains partial availability.
- **OneAtATime** — deploys to one instance at a time. Slowest, safest — availability is nearly uninterrupted.

**Lambda deployment strategies** work differently — they shift traffic gradually using Lambda aliases [🔗](https://docs.aws.amazon.com/codedeploy/latest/userguide/deployment-steps-lambda.html):

- **Linear** — shifts traffic in equal increments at regular intervals (e.g., `Linear10PercentEvery3Minutes`).
- **Canary** — shifts a small percentage first, waits, then shifts the rest (e.g., `Canary10Percent5Minutes` sends 10% of traffic to the new version, then 100% after 5 minutes).
- **AllAtOnce** — switches 100% of traffic immediately.

Linear and Canary are the safer choices because CodeDeploy can automatically roll back if a CloudWatch alarm triggers during the shift.

### CodePipeline

CodePipeline [🔗](https://docs.aws.amazon.com/codepipeline/latest/userguide/welcome.html) is the orchestration layer that connects all the pieces. A pipeline is made up of **stages** (e.g., Source → Build → Test → Deploy), and each stage contains one or more **actions** that do the actual work (invoking CodeBuild, triggering CodeDeploy, etc.). **Artifacts** are the files passed between stages — stored in an S3 bucket that CodePipeline manages automatically.

A minimal pipeline for a web application might look like:

1. **Source stage** — watches a CodeCommit branch (or GitHub via CodeStar Connections) for new commits.
2. **Build stage** — invokes a CodeBuild project; the output artifact is a deployment bundle.
3. **Deploy stage** — calls CodeDeploy to push the bundle to EC2 or Lambda.

**Transitions** between stages can be enabled or disabled manually — useful for pausing a pipeline between environments. **Manual approval actions** [🔗](https://docs.aws.amazon.com/codepipeline/latest/userguide/approvals.html) let you insert a human gate into any stage: the pipeline pauses and sends an SNS notification until someone approves or rejects via the console or API. This is commonly used before deploying to production.

Beyond CodeCommit/CodeBuild/CodeDeploy, CodePipeline integrates natively with **CloudFormation** (to deploy infrastructure stacks), **Elastic Beanstalk** (to deploy application versions), and third-party tools like Jenkins.

### CodeStar Connections

CodeStar Connections [🔗](https://docs.aws.amazon.com/dtconsole/latest/userguide/welcome-connections.html) is the mechanism for authorizing CodePipeline to pull source code from external providers like **GitHub**, **GitLab**, or **Bitbucket**. You create a connection once (which involves an OAuth handshake with the provider), then reference it as the source action in any pipeline. This is now the standard replacement for the deprecated GitHub v1 source action.

### CodeArtifact

CodeArtifact [🔗](https://docs.aws.amazon.com/codeartifact/latest/ug/welcome.html) is a fully managed artifact repository — think of it as a private npm registry, Maven repository, or PyPI index hosted inside your AWS account. It solves two problems: keeping approved packages internal to your organisation, and caching public packages from upstream registries (npm, Maven Central, PyPI) so builds don't break when an external package disappears. CodeBuild can be configured to pull dependencies from CodeArtifact instead of the public internet, improving both security and build reliability.

### CodeGuru Reviewer

CodeGuru Reviewer [🔗](https://docs.aws.amazon.com/codeguru/latest/reviewer-ug/welcome.html) uses machine learning to analyse your Java or Python code and surface potential bugs, security vulnerabilities, and deviations from AWS best practices. It integrates with CodeCommit (and GitHub via CodeStar Connections) and posts findings as pull request comments — acting as an automated code reviewer that runs on every PR without any manual effort.

### AWS Copilot

AWS Copilot [🔗](https://aws.github.io/copilot-cli/) is a CLI tool designed to make deploying containerised applications on **ECS** (and App Runner) straightforward. Rather than hand-crafting task definitions, services, and load balancers, you run `copilot init` and Copilot provisions the entire environment — VPC, ECS cluster, ECR repository, load balancer — and creates a CI/CD pipeline for you. It targets teams that want the power of ECS without the operational overhead of configuring every resource manually.

{{< qcm >}}
[
{
"question": "A developer wants to protect the `main` branch of a CodeCommit repository so that no one can push directly to it without a peer review. Which CodeCommit feature should they use?",
"answers": [
{
"answer": "Branch policies with pull request approval rules",
"isCorrect": true,
"explanation": "CodeCommit branch policies allow you to require pull request approvals before any code can be merged into a protected branch like `main`."
},
{
"answer": "IAM permission boundaries on the repository",
"isCorrect": false,
"explanation": "IAM permission boundaries restrict what permissions an IAM entity can have, but they are not the right tool for enforcing a PR-based review workflow on a specific branch."
},
{
"answer": "CodeCommit triggers connected to a Lambda function",
"isCorrect": false,
"explanation": "Triggers can invoke Lambda or SNS on events like a push, but they do not block or gate direct pushes — they only react after the fact."
},
{
"answer": "S3 bucket policies on the repository storage",
"isCorrect": false,
"explanation": "CodeCommit repositories are not stored in customer-accessible S3 buckets; S3 bucket policies have no bearing on CodeCommit branch protection."
}
]
},
{
"question": "A company's CodeBuild project takes 8 minutes per build mostly because npm downloads hundreds of packages each time. Which CodeBuild feature is the MOST cost-effective way to reduce build duration?",
"answers": [
{
"answer": "Add a `cache` block in the buildspec.yml pointing to the `node_modules` directory",
"isCorrect": true,
"explanation": "The `cache` block in buildspec.yml persists specified directories (like `node_modules`) between builds, avoiding redundant downloads and dramatically reducing build time."
},
{
"answer": "Increase the compute type of the CodeBuild environment",
"isCorrect": false,
"explanation": "A larger compute type gives more CPU/RAM but does not eliminate the time spent downloading packages from the internet on each run."
},
{
"answer": "Store the packages in an S3 bucket and download them in the `install` phase",
"isCorrect": false,
"explanation": "Manually downloading from S3 each build still re-downloads everything every time; it doesn't reduce the number of packages fetched per build."
},
{
"answer": "Use the `post_build` phase to pre-warm the next build",
"isCorrect": false,
"explanation": "The `post_build` phase runs after the build but cannot pre-warm a future isolated container; each build environment starts fresh unless caching is configured."
}
]
},
{
"question": "A developer needs to pass a database password to a CodeBuild project without hardcoding it in the buildspec.yml. Which options are valid approaches? (Select TWO)",
"answers": [
{
"answer": "Reference the secret from AWS Secrets Manager in the buildspec.yml environment variables section",
"isCorrect": true,
"explanation": "CodeBuild supports referencing secrets directly from Secrets Manager in the buildspec, injecting them as environment variables at build time without exposing them in source code."
},
{
"answer": "Reference a parameter from SSM Parameter Store in the buildspec.yml environment variables section",
"isCorrect": true,
"explanation": "CodeBuild natively integrates with SSM Parameter Store, allowing secure parameters to be resolved at runtime and injected into the build environment."
},
{
"answer": "Store the password as a plaintext environment variable in the CodeBuild project console",
"isCorrect": false,
"explanation": "Storing credentials as plaintext environment variables is a security anti-pattern; they are visible in build logs and the console."
},
{
"answer": "Embed the password in the buildspec.yml and encrypt the file with KMS",
"isCorrect": false,
"explanation": "The buildspec.yml lives in source control, so embedding credentials there — even encrypted — is risky and not the recommended approach."
}
]
},
{
"question": "Which file does CodeDeploy use to define how an application should be installed on an EC2 instance, including lifecycle hook scripts?",
"answers": [
{
"answer": "appspec.yml",
"isCorrect": true,
"explanation": "The appspec.yml file is CodeDeploy's configuration file. It specifies which files to copy, where to copy them, and which scripts to run at each lifecycle hook (e.g., BeforeInstall, AfterInstall, ValidateService)."
},
{
"answer": "buildspec.yml",
"isCorrect": false,
"explanation": "buildspec.yml is CodeBuild's configuration file for defining build phases. CodeDeploy does not use it."
},
{
"answer": "taskdef.json",
"isCorrect": false,
"explanation": "taskdef.json is an ECS task definition file, not a CodeDeploy configuration file."
},
{
"answer": "deploy.yaml",
"isCorrect": false,
"explanation": "There is no `deploy.yaml` file in CodeDeploy. The correct file name is `appspec.yml`."
}
]
},
{
"question": "A team needs to deploy a new version of a Lambda function with minimal risk. They want to send 10% of traffic to the new version immediately, then automatically shift the remaining 90% after 5 minutes if no CloudWatch alarms trigger. Which CodeDeploy deployment configuration should they use?",
"answers": [
{
"answer": "Canary10Percent5Minutes",
"isCorrect": true,
"explanation": "The Canary strategy sends a small initial percentage of traffic (10%) to the new version, waits for the specified interval (5 minutes), then shifts the remainder — allowing CloudWatch alarms to trigger an automatic rollback if issues are detected."
},
{
"answer": "Linear10PercentEvery3Minutes",
"isCorrect": false,
"explanation": "The Linear strategy shifts traffic in equal increments at regular intervals, not in a two-step canary pattern. Linear10PercentEvery3Minutes would shift 10% every 3 minutes across many steps, not 10% then 90%."
},
{
"answer": "AllAtOnce",
"isCorrect": false,
"explanation": "AllAtOnce switches 100% of traffic immediately, leaving no canary window for validation and no partial rollback capability."
},
{
"answer": "OneAtATime",
"isCorrect": false,
"explanation": "OneAtATime is an EC2/On-Premises deployment configuration that deploys to one instance at a time. It does not apply to Lambda traffic shifting."
}
]
},
{
"question": "A CodeDeploy deployment to a fleet of EC2 instances must ensure that the application remains available throughout the rollout, even if it means the deployment takes longer. Which deployment configuration should be chosen?",
"answers": [
{
"answer": "OneAtATime",
"isCorrect": true,
"explanation": "OneAtATime deploys to a single instance at a time, ensuring that all other instances remain in service throughout the deployment. It is the slowest but safest option for maintaining availability."
},
{
"answer": "AllAtOnce",
"isCorrect": false,
"explanation": "AllAtOnce deploys to every instance simultaneously, which causes downtime if the deployment fails, and takes all instances out of rotation at once."
},
{
"answer": "HalfAtATime",
"isCorrect": false,
"explanation": "HalfAtATime deploys to 50% of instances at once, maintaining partial availability, but it is not the safest option — OneAtATime minimizes risk further."
},
{
"answer": "Canary10Percent5Minutes",
"isCorrect": false,
"explanation": "Canary deployments are a Lambda traffic-shifting strategy, not an EC2/On-Premises deployment configuration."
}
]
},
{
"question": "A developer is setting up a CodePipeline pipeline. Before deploying to production, a senior engineer must manually approve the release. How should this be implemented?",
"answers": [
{
"answer": "Add a Manual Approval action in the pipeline stage before the production Deploy stage",
"isCorrect": true,
"explanation": "CodePipeline supports Manual Approval actions that pause the pipeline and send an SNS notification. The pipeline only continues once an authorized user approves (or rejects) via the console or API."
},
{
"answer": "Disable the transition between the staging and production stages",
"isCorrect": false,
"explanation": "Disabling a transition prevents the pipeline from moving forward entirely, but it must be manually re-enabled each time. It does not provide a formal approval workflow with notifications."
},
{
"answer": "Configure a CloudWatch Events rule to pause the pipeline",
"isCorrect": false,
"explanation": "CloudWatch Events can react to pipeline events, but there is no native mechanism to pause a pipeline via a CloudWatch rule; Manual Approval actions are the proper solution."
},
{
"answer": "Use a Lambda action in the pipeline to send an email and wait",
"isCorrect": false,
"explanation": "While technically possible, implementing a wait loop in Lambda is complex and unnecessary when CodePipeline's built-in Manual Approval action already handles this pattern natively."
}
]
},
{
"question": "What is the role of artifacts in AWS CodePipeline?",
"answers": [
{
"answer": "They are files passed between pipeline stages, stored in an S3 bucket managed by CodePipeline",
"isCorrect": true,
"explanation": "Artifacts are the outputs of one stage that become the inputs of the next. CodePipeline automatically manages an S3 bucket to store these intermediate files between stages."
},
{
"answer": "They are IAM roles that grant each stage permission to execute actions",
"isCorrect": false,
"explanation": "IAM roles control permissions, but they are not called artifacts. Artifacts specifically refer to the file packages passed between pipeline stages."
},
{
"answer": "They are CloudWatch log groups created by each pipeline action",
"isCorrect": false,
"explanation": "CloudWatch logs capture execution output but are not the same as pipeline artifacts, which are deployable file packages."
},
{
"answer": "They are Docker images stored in ECR and pulled by CodeDeploy",
"isCorrect": false,
"explanation": "While ECR images can be part of a deployment workflow, pipeline artifacts are generic file bundles stored in S3, not specifically Docker images in ECR."
}
]
},
{
"question": "A startup is migrating from GitHub to a fully AWS-managed source control solution. Which service should they use, and what is an important consideration for new AWS customers?",
"answers": [
{
"answer": "CodeCommit, but note that it is no longer available to new customers as of July 2024; GitHub via CodeStar Connections is the recommended alternative",
"isCorrect": true,
"explanation": "CodeCommit is AWS's managed Git service, but AWS announced in July 2024 that it is closed to new customers. New projects should connect to GitHub or Bitbucket using CodeStar Connections."
},
{
"answer": "CodeBuild, which can also act as a source control repository",
"isCorrect": false,
"explanation": "CodeBuild is a build service, not a source control system. It compiles and tests code but does not host Git repositories."
},
{
"answer": "CodeArtifact, which stores source code packages for retrieval",
"isCorrect": false,
"explanation": "CodeArtifact is a package repository for build dependencies (npm, Maven, PyPI), not a Git-based source control system."
},
{
"answer": "CodeDeploy, which can mirror GitHub repositories inside AWS",
"isCorrect": false,
"explanation": "CodeDeploy deploys applications to compute targets; it does not host or mirror source code repositories."
}
]
},
{
"question": "A team uses CodePipeline and wants to connect it to their existing GitHub repository as the source. Which AWS service should they use?",
"answers": [
{
"answer": "CodeStar Connections",
"isCorrect": true,
"explanation": "CodeStar Connections provides an OAuth-based mechanism to authorize CodePipeline to pull source code from external providers like GitHub, GitLab, and Bitbucket. It is the standard replacement for the deprecated GitHub v1 source action."
},
{
"answer": "CodeCommit replication",
"isCorrect": false,
"explanation": "CodeCommit does not offer a built-in replication feature from GitHub. CodeStar Connections is the correct approach for connecting external Git providers."
},
{
"answer": "AWS Direct Connect",
"isCorrect": false,
"explanation": "AWS Direct Connect is a dedicated network connection between on-premises environments and AWS — it has nothing to do with connecting to GitHub."
},
{
"answer": "AWS Transfer Family",
"isCorrect": false,
"explanation": "AWS Transfer Family provides SFTP/FTP file transfer capabilities; it is not used to connect source code providers to CodePipeline."
}
]
},
{
"question": "Which of the following are valid deployment targets for AWS CodeDeploy? (Select THREE)",
"answers": [
{
"answer": "EC2 instances and on-premises servers",
"isCorrect": true,
"explanation": "CodeDeploy supports EC2 and on-premises servers via a CodeDeploy agent that runs on each instance and pulls the application revision."
},
{
"answer": "AWS Lambda functions",
"isCorrect": true,
"explanation": "CodeDeploy can shift traffic between Lambda function versions using aliases with Linear, Canary, or AllAtOnce strategies."
},
{
"answer": "Amazon ECS services",
"isCorrect": true,
"explanation": "CodeDeploy supports ECS deployments, including blue/green deployments that replace task definitions in a service."
},
{
"answer": "Amazon RDS database instances",
"isCorrect": false,
"explanation": "CodeDeploy does not deploy to RDS. It targets compute resources (EC2, Lambda, ECS), not managed database services."
},
{
"answer": "Amazon S3 static websites",
"isCorrect": false,
"explanation": "While you can sync files to S3 manually or via scripts, S3 is not a supported CodeDeploy deployment target."
}
]
},
{
"question": "A security-conscious team wants their CodeBuild project to pull npm packages from a private, internal registry instead of the public npm registry. Which AWS service enables this?",
"answers": [
{
"answer": "AWS CodeArtifact",
"isCorrect": true,
"explanation": "CodeArtifact is a fully managed artifact repository that can act as a private npm registry (and Maven, PyPI). CodeBuild can be configured to pull dependencies from CodeArtifact, improving security and build reliability."
},
{
"answer": "AWS CodeGuru Reviewer",
"isCorrect": false,
"explanation": "CodeGuru Reviewer uses ML to analyze code for bugs and security issues; it does not serve as a package registry."
},
{
"answer": "Amazon ECR",
"isCorrect": false,
"explanation": "ECR is a private Docker container image registry, not an npm or general package repository."
},
{
"answer": "AWS CodeStar Connections",
"isCorrect": false,
"explanation": "CodeStar Connections authorizes pipelines to access external source code providers; it is not a package registry."
}
]
},
{
"question": "A developer working on a Python project wants automated code review feedback on every pull request without adding manual review steps. Which AWS service provides this capability?",
"answers": [
{
"answer": "Amazon CodeGuru Reviewer",
"isCorrect": true,
"explanation": "CodeGuru Reviewer uses machine learning to analyze Java and Python code, surfacing bugs, security vulnerabilities, and AWS best practice deviations. It integrates with CodeCommit and GitHub and posts findings directly as pull request comments."
},
{
"answer": "AWS CodeBuild with a linting step in the buildspec.yml",
"isCorrect": false,
"explanation": "While you can add linting in CodeBuild, it requires manual configuration of linting tools and does not provide ML-driven code quality insights or automatic PR comments like CodeGuru Reviewer does."
},
{
"answer": "AWS CodePipeline with a manual approval action",
"isCorrect": false,
"explanation": "Manual approval actions pause a pipeline for a human reviewer; they do not provide automated code analysis or inline PR comments."
},
{
"answer": "AWS CodeDeploy with validation hooks",
"isCorrect": false,
"explanation": "CodeDeploy lifecycle hooks (like ValidateService) run scripts after deployment to verify the application is healthy; they do not perform static code analysis on pull requests."
}
]
},
{
"question": "In a CodeBuild buildspec.yml, in which phase would you typically log in to Amazon ECR before building and pushing a Docker image?",
"answers": [
{
"answer": "pre_build",
"isCorrect": true,
"explanation": "The `pre_build` phase is designed for preparation steps like authenticating with ECR (`aws ecr get-login-password | docker login ...`) before the main build phase runs."
},
{
"answer": "install",
"isCorrect": false,
"explanation": "The `install` phase is for setting up the build environment — installing runtimes and tools — not for authentication to external services."
},
{
"answer": "build",
"isCorrect": false,
"explanation": "The `build` phase is where compilation and image building occur. Authentication should happen before this phase, in `pre_build`."
},
{
"answer": "post_build",
"isCorrect": false,
"explanation": "The `post_build` phase runs after the build completes; logging into ECR here would be too late since the Docker build already needs registry access during the `build` phase."
}
]
},
{
"question": "A team wants to deploy containerized applications to Amazon ECS without manually configuring VPCs, task definitions, load balancers, and CI/CD pipelines. Which AWS tool is designed for this use case?",
"answers": [
{
"answer": "AWS Copilot",
"isCorrect": true,
"explanation": "AWS Copilot is a CLI that automates provisioning the full ECS environment — VPC, cluster, ECR repository, load balancer — and creates a CI/CD pipeline, abstracting away the manual operational overhead."
},
{
"answer": "AWS CloudFormation",
"isCorrect": false,
"explanation": "CloudFormation can provision all these resources but requires the developer to write detailed templates for every resource. It doesn't provide an opinionated, simplified experience like Copilot."
},
{
"answer": "AWS CodeDeploy",
"isCorrect": false,
"explanation": "CodeDeploy handles the deployment step of pushing a new version to ECS, but does not scaffold the full environment (VPC, cluster, load balancer, pipeline)."
},
{
"answer": "AWS Elastic Beanstalk",
"isCorrect": false,
"explanation": "Elastic Beanstalk simplifies deployment but targets its own managed platform, not ECS task/service-based deployments. Copilot is purpose-built for the ECS use case."
}
]
},
{
"question": "A pipeline in CodePipeline has been paused between the staging and production stages for several weeks during a feature freeze. When the freeze ends, what must the team do to let deployments flow to production again?",
"answers": [
{
"answer": "Re-enable the disabled transition between the staging and production stages",
"isCorrect": true,
"explanation": "CodePipeline transitions between stages can be manually disabled to pause the flow of artifacts. Re-enabling the transition allows the pipeline to continue passing artifacts to subsequent stages."
},
{
"answer": "Delete and recreate the production Deploy stage",
"isCorrect": false,
"explanation": "Recreating a stage is destructive and unnecessary. Transitions can simply be re-enabled without modifying the pipeline structure."
},
{
"answer": "Approve the manual approval action that was automatically inserted",
"isCorrect": false,
"explanation": "A manual approval action must be explicitly added to a pipeline. Disabling a transition is a separate concept and does not automatically create an approval action."
},
{
"answer": "Update the IAM role to grant CodePipeline access to the production environment again",
"isCorrect": false,
"explanation": "Disabling a transition does not revoke IAM permissions. The pipeline is paused at the transition level, not at the permissions level."
}
]
},
{
"question": "Which of the following correctly describes the difference between CodeBuild and CodeDeploy?",
"answers": [
{
"answer": "CodeBuild compiles and tests source code in an ephemeral container; CodeDeploy takes a built artifact and installs it on compute targets like EC2, Lambda, or ECS",
"isCorrect": true,
"explanation": "CodeBuild is a build service that runs your buildspec phases and produces an artifact. CodeDeploy is a deployment service that takes that artifact and delivers it to infrastructure — it does not build code."
},
{
"answer": "CodeBuild deploys applications to EC2; CodeDeploy compiles source code and runs tests",
"isCorrect": false,
"explanation": "This has the roles reversed. CodeBuild builds and tests; CodeDeploy deploys."
},
{
"answer": "CodeBuild and CodeDeploy are interchangeable services that both build and deploy applications",
"isCorrect": false,
"explanation": "They serve distinct, complementary roles in a pipeline. CodeBuild handles the build phase; CodeDeploy handles the deployment phase."
},
{
"answer": "CodeBuild stores source code; CodeDeploy stores compiled artifacts in S3",
"isCorrect": false,
"explanation": "Source code is stored in CodeCommit (or GitHub). Artifacts are stored in S3 by CodePipeline. Neither CodeBuild nor CodeDeploy is a storage service."
}
]
},
{
"question": "A company's buildspec.yml defines a `artifacts` block with `base-directory: dist` and `files: ['**/*']`. What does this configuration do?",
"answers": [
{
"answer": "It packages everything inside the `dist` directory and uploads it to S3 (or passes it to the next pipeline stage) as the build artifact",
"isCorrect": true,
"explanation": "The `base-directory` tells CodeBuild to use `dist` as the root of the artifact, and `'**/*'` includes all files recursively within it. The resulting package is sent to S3 or the next CodePipeline stage."
},
{
"answer": "It deletes the `dist` directory after the build completes",
"isCorrect": false,
"explanation": "The `artifacts` block specifies what to upload, not what to delete. Post-build cleanup is handled in the `post_build` phase."
},
{
"answer": "It caches the `dist` directory to speed up future builds",
"isCorrect": false,
"explanation": "Caching is configured in the `cache` block, not the `artifacts` block. The `artifacts` block defines what to export as output."
},
{
"answer": "It deploys the contents of `dist` directly to an EC2 instance",
"isCorrect": false,
"explanation": "CodeBuild does not deploy to EC2. The `artifacts` block packages files for S3 storage or pipeline handoff; actual deployment is handled by CodeDeploy."
}
]
}
]
{{< /qcm >}}