---
title: "23. Elastic Beanstalk"
type: docs
weight: 5
---

## Elastic Beanstalk

Deploying a web application on AWS from scratch means provisioning EC2 instances, configuring load balancers, setting up Auto Scaling groups, managing security groups, and wiring everything together — before writing a single line of application logic. Elastic Beanstalk [🔗](https://docs.aws.amazon.com/elasticbeanstalk/latest/dg/Welcome.html) solves this by handling all that infrastructure automatically. You upload your code, choose a platform, and Beanstalk provisions and manages the underlying resources. You retain full access to those resources if you need to customize them, but the heavy lifting is done for you.

This makes Beanstalk ideal for teams that want to focus on their application rather than infrastructure, while still running on standard AWS primitives (EC2, ELB, ASG, RDS) rather than a black-box PaaS.

### Supported Platforms

Beanstalk supports a wide range of managed runtimes out of the box: Node.js, Python, Ruby, Java (Tomcat), .NET on Windows Server, PHP, Go, and Docker (single-container and multi-container via ECS). AWS manages the underlying OS and runtime patches for these platforms. If none fit your needs, you can define a **custom platform** using Packer [🔗](https://docs.aws.amazon.com/elasticbeanstalk/latest/dg/custom-platforms.html).

### Core Components

Understanding Beanstalk's terminology is essential before working with it:

- **Application** — a logical container that groups environments, versions, and configuration. Think of it as your project.
- **Application version** — a specific, labeled revision of your deployable code (a ZIP or WAR stored in S3).
- **Environment** — the actual running AWS infrastructure for one version of your application (EC2 + ELB + ASG + etc.). One application can have multiple environments (e.g., `my-app-prod`, `my-app-staging`).
- **Environment tier** — determines what kind of workload the environment serves (see below).

### Web Server Tier vs Worker Tier

Beanstalk offers two environment tiers [🔗](https://docs.aws.amazon.com/elasticbeanstalk/latest/dg/concepts-worker.html):

- **Web Server tier** — handles HTTP/HTTPS traffic through an Elastic Load Balancer fronting one or more EC2 instances. This is the standard choice for APIs and web apps.
- **Worker tier** — designed for background processing. Instead of an ELB, it uses an SQS queue. A Beanstalk daemon on each instance polls the queue and delivers messages as HTTP POST requests to your application. Use this for tasks like video transcoding, report generation, or any long-running job triggered asynchronously.

A common pattern is to pair the two: the web tier accepts requests and drops messages into SQS, while the worker tier processes them independently.

### Deployment Modes

When creating an environment, you choose between two modes:

- **Single-instance** — one EC2 instance with an Elastic IP, no load balancer. Cheaper; suited for development and low-traffic environments.
- **Load-balanced** — an Auto Scaling group behind an ELB. Production-grade, horizontally scalable.

### Deployment Policies

When you push a new application version, Beanstalk needs to roll it out across your instances. The deployment policy [🔗](https://docs.aws.amazon.com/elasticbeanstalk/latest/dg/using-features.rolling-version-deploy.html) controls how that rollout happens — trading off between speed, availability, and cost.

- **All at once** — deploys to every instance simultaneously. Fastest, but causes a brief outage. Acceptable for dev environments.
- **Rolling** — updates instances in batches. Capacity is temporarily reduced during the update (some instances are out of service). No extra cost.
- **Rolling with additional batch** — launches a fresh batch of instances before taking any existing ones out of rotation. Maintains full capacity throughout. Slightly higher cost due to temporary extra instances.
- **Immutable** — launches an entirely new ASG with the new version, then shifts traffic once health checks pass, then terminates the old ASG. Safest option; easy rollback (just terminate the new ASG). Highest cost and slowest.
- **Blue/Green** — not a native Beanstalk policy, but a common pattern: create a separate environment (green) with the new version, test it, then swap CNAMEs via **Swap Environment URLs** in the console. Zero downtime; full rollback by swapping back. Requires running two full environments simultaneously.

For production, **Immutable** or **Blue/Green** are the recommended strategies when you cannot tolerate any downtime or capacity reduction.

### Customizing Environments with `.ebextensions`

Beanstalk lets you customize the environment configuration by including an `.ebextensions/` directory at the root of your application source bundle [🔗](https://docs.aws.amazon.com/elasticbeanstalk/latest/dg/ebextensions.html). Each file inside must have a `.config` extension and be written in YAML or JSON.

Common uses:
- Installing OS packages (`packages` key)
- Running shell commands at deploy time (`commands` and `container_commands`)
- Setting environment properties
- Creating or modifying AWS resources (e.g., an SQS queue) using CloudFormation syntax under the `Resources` key

```yaml
# .ebextensions/install-deps.config
packages:
  yum:
    git: []

container_commands:
  01_migrate:
    command: "python manage.py migrate"
    leader_only: true
```

`container_commands` run after the application is extracted but before it goes live — making them ideal for database migrations. The `leader_only: true` flag ensures only one instance runs the command in a rolling deployment.

### Platform Hooks (Amazon Linux 2+)

On Amazon Linux 2 and later platforms, Beanstalk introduces **.platform hooks** [🔗](https://docs.aws.amazon.com/elasticbeanstalk/latest/dg/platforms-linux-extend.html) as a more structured alternative to `.ebextensions` for running scripts during the deployment lifecycle. You place executable scripts in predefined directories:

- `.platform/hooks/prebuild/` — before the build step
- `.platform/hooks/predeploy/` — after build, before the app goes live
- `.platform/hooks/postdeploy/` — after the app is live

This gives you finer-grained control over deployment timing compared to `container_commands`.

### Environment Variables and Configuration Files

You can inject runtime configuration into your application through environment properties, set via the Beanstalk console, CLI, or `.ebextensions`. These are exposed as standard OS environment variables to your application process — no code changes needed to switch between environments.

For more structured configuration management, Beanstalk supports **saved configurations** [🔗](https://docs.aws.amazon.com/elasticbeanstalk/latest/dg/environment-configuration-savedconfig.html) — snapshots of environment settings stored in S3 that can be applied to new environments for consistent, repeatable setups.

### The `eb` CLI

The Elastic Beanstalk CLI [🔗](https://docs.aws.amazon.com/elasticbeanstalk/latest/dg/eb-cli3.html) streamlines your workflow from the terminal. Key commands:

- `eb init` — configure your project and link it to an application
- `eb create` — provision a new environment
- `eb deploy` — deploy the current source bundle to the active environment
- `eb status` — check environment health and current version
- `eb logs` — stream or retrieve logs from instances
- `eb open` — open the environment URL in a browser
- `eb terminate` — tear down an environment

### Health Monitoring and Managed Platform Updates

Beanstalk provides two levels of health reporting:

- **Basic health** — checks whether instances pass ELB health checks and reports a simple OK/Warning/Degraded/Severe status.
- **Enhanced health** [🔗](https://docs.aws.amazon.com/elasticbeanstalk/latest/dg/health-enhanced.html) — publishes detailed metrics (request latency, HTTP response codes, instance CPU) to CloudWatch. Available on load-balanced environments and requires the Beanstalk health agent on instances.

**Managed platform updates** [🔗](https://docs.aws.amazon.com/elasticbeanstalk/latest/dg/environment-platform-update-managed.html) allow Beanstalk to automatically apply minor and patch platform version updates during a maintenance window you define — keeping your runtime patched without manual intervention.

### Beanstalk with RDS: Decoupled vs Coupled

You can create an RDS database in two ways within Beanstalk:

- **Coupled (inside the environment)** — Beanstalk provisions and manages the RDS instance as part of the environment. Simple to set up, but the database is tied to the environment's lifecycle: **deleting the environment deletes the database**. Acceptable only for development.
- **Decoupled (outside the environment)** — RDS is created independently, and your Beanstalk environment is given the connection details via environment variables. The database persists independently of any environment lifecycle. This is the correct approach for production [🔗](https://docs.aws.amazon.com/elasticbeanstalk/latest/dg/AWSHowTo.RDS.html).

If you started with a coupled database and need to migrate to a decoupled setup, the process involves taking a snapshot, deleting the database from the environment (with a retained snapshot), re-creating it as a standalone RDS instance, and updating your environment variables — a non-trivial operation that reinforces why decoupling from the start is best practice.

{{< qcm >}}
[
{
"question": "A development team wants to deploy a web application to AWS without managing the underlying infrastructure. They want to retain access to the EC2 instances if needed but don't want to configure load balancers or Auto Scaling groups manually. Which AWS service best fits this requirement?",
"answers": [
{
"answer": "AWS Elastic Beanstalk",
"isCorrect": true,
"explanation": "Elastic Beanstalk automatically provisions and manages infrastructure (EC2, ELB, ASG) while still giving developers full access to the underlying resources if customization is needed."
},
{
"answer": "AWS Lambda",
"isCorrect": false,
"explanation": "Lambda is a serverless compute service. It abstracts infrastructure entirely and does not provide access to EC2 instances."
},
{
"answer": "Amazon ECS",
"isCorrect": false,
"explanation": "ECS is a container orchestration service. While it reduces some infrastructure burden, it does not automatically provision load balancers and Auto Scaling groups the way Beanstalk does."
},
{
"answer": "AWS CloudFormation",
"isCorrect": false,
"explanation": "CloudFormation is an infrastructure-as-code service. It provisions resources but requires you to define and manage all infrastructure components yourself."
}
]
},
{
"question": "Which of the following runtimes are natively supported by AWS Elastic Beanstalk managed platforms? (Select THREE)",
"answers": [
{
"answer": "Node.js",
"isCorrect": true,
"explanation": "Node.js is one of the officially supported managed runtimes in Elastic Beanstalk."
},
{
"answer": "Go",
"isCorrect": true,
"explanation": "Go is supported as a managed runtime in Elastic Beanstalk."
},
{
"answer": "Docker",
"isCorrect": true,
"explanation": "Elastic Beanstalk supports both single-container and multi-container Docker deployments."
},
{
"answer": "Rust",
"isCorrect": false,
"explanation": "Rust is not a natively supported managed runtime. You would need to create a custom platform using Packer to support Rust."
},
{
"answer": "Kotlin",
"isCorrect": false,
"explanation": "Kotlin is not a natively supported managed runtime in Elastic Beanstalk."
}
]
},
{
"question": "In AWS Elastic Beanstalk, what is an 'application version'?",
"answers": [
{
"answer": "A specific labeled revision of deployable code stored as a ZIP or WAR in S3",
"isCorrect": true,
"explanation": "An application version is a specific, labeled revision of your deployable code artifact (ZIP or WAR), stored in Amazon S3."
},
{
"answer": "The running AWS infrastructure for one version of your application",
"isCorrect": false,
"explanation": "This describes an 'environment', not an application version. An environment is the actual running infrastructure (EC2, ELB, ASG, etc.)."
},
{
"answer": "A snapshot of environment settings stored in S3",
"isCorrect": false,
"explanation": "This describes a 'saved configuration', not an application version."
},
{
"answer": "A logical container grouping all environments and configurations for a project",
"isCorrect": false,
"explanation": "This describes an 'application' in Beanstalk terminology, not an application version."
}
]
},
{
"question": "A company runs an e-commerce platform using Elastic Beanstalk. They need to process video uploads asynchronously — the uploads are triggered by users but encoding can happen in the background. Which Elastic Beanstalk architecture best fits this use case?",
"answers": [
{
"answer": "A Web Server tier environment that accepts requests and drops messages into SQS, paired with a Worker tier environment that polls SQS and processes the encoding jobs",
"isCorrect": true,
"explanation": "This is the canonical Beanstalk pattern for async processing. The web tier handles HTTP traffic and queues work in SQS; the worker tier picks up messages and processes them as background jobs."
},
{
"answer": "A single Web Server tier environment with an increased instance size to handle both HTTP requests and video encoding",
"isCorrect": false,
"explanation": "Combining synchronous web serving and long-running background jobs on the same tier is not scalable and does not leverage Beanstalk's Worker tier, which is designed exactly for this pattern."
},
{
"answer": "Two Web Server tier environments, one for accepting uploads and one for encoding",
"isCorrect": false,
"explanation": "The Worker tier, not a second Web Server tier, is the appropriate component for background processing. It integrates natively with SQS and delivers messages as POST requests to the application."
},
{
"answer": "A Worker tier environment only, using an ELB to front the encoding instances",
"isCorrect": false,
"explanation": "Worker tier environments do not use an ELB. They use an SQS queue. The web-facing component requires a Web Server tier."
}
]
},
{
"question": "A developer is setting up an Elastic Beanstalk environment for a development project with minimal traffic. They want to reduce costs as much as possible. Which deployment mode should they choose?",
"answers": [
{
"answer": "Single-instance mode",
"isCorrect": true,
"explanation": "Single-instance mode uses one EC2 instance with an Elastic IP and no load balancer, making it the cheapest option. It is suited for development and low-traffic environments."
},
{
"answer": "Load-balanced mode",
"isCorrect": false,
"explanation": "Load-balanced mode provisions an Auto Scaling group behind an ELB, which incurs higher costs. It is production-grade and not optimal for minimizing dev environment costs."
},
{
"answer": "Immutable deployment mode",
"isCorrect": false,
"explanation": "Immutable is a deployment policy, not an environment mode. It is also the most expensive deployment strategy as it launches a new ASG for every deployment."
},
{
"answer": "Blue/Green mode",
"isCorrect": false,
"explanation": "Blue/Green requires running two full environments simultaneously, doubling infrastructure costs. It is the opposite of a cost-reduction strategy."
}
]
},
{
"question": "A team is deploying a new version of their application using Elastic Beanstalk. They need zero downtime and the ability to instantly roll back if something goes wrong, but they cannot afford to run two full environments simultaneously. Which deployment policy best meets these requirements?",
"answers": [
{
"answer": "Immutable",
"isCorrect": true,
"explanation": "Immutable deployments launch a new ASG with the new version. Traffic only shifts after health checks pass, and rollback is instant by terminating the new ASG. It does not require two permanently running environments like Blue/Green."
},
{
"answer": "Blue/Green",
"isCorrect": false,
"explanation": "Blue/Green provides zero downtime and easy rollback, but requires running two full environments simultaneously, which the team cannot afford."
},
{
"answer": "Rolling",
"isCorrect": false,
"explanation": "Rolling updates reduce capacity during the rollout (some instances are out of service) and do not offer an instant rollback mechanism."
},
{
"answer": "All at once",
"isCorrect": false,
"explanation": "All at once causes a brief outage as all instances are updated simultaneously. It does not meet the zero downtime requirement."
}
]
},
{
"question": "Which Elastic Beanstalk deployment policy maintains full application capacity throughout the deployment without incurring the cost of an entirely new Auto Scaling group?",
"answers": [
{
"answer": "Rolling with additional batch",
"isCorrect": true,
"explanation": "Rolling with additional batch launches a fresh batch of instances before taking existing ones out of rotation, maintaining full capacity throughout. It costs slightly more than standard rolling due to the temporary extra instances, but does not launch a full new ASG like Immutable does."
},
{
"answer": "Rolling",
"isCorrect": false,
"explanation": "Standard rolling updates batches of existing instances, which temporarily reduces capacity during the update."
},
{
"answer": "Immutable",
"isCorrect": false,
"explanation": "Immutable maintains capacity but does so by launching an entirely new ASG, which is the most expensive option."
},
{
"answer": "All at once",
"isCorrect": false,
"explanation": "All at once deploys to every instance simultaneously, causing a brief outage and reducing capacity to zero during the update."
}
]
},
{
"question": "A developer wants to perform a zero-downtime deployment using Elastic Beanstalk and needs the ability to test the new version before directing production traffic to it. Which approach should they use?",
"answers": [
{
"answer": "Create a separate 'green' Elastic Beanstalk environment with the new version, validate it, then use 'Swap Environment URLs' to redirect traffic",
"isCorrect": true,
"explanation": "This is the Blue/Green deployment pattern for Beanstalk. You run two environments, test the green one, then swap CNAMEs via 'Swap Environment URLs'. Full rollback is possible by swapping back."
},
{
"answer": "Use the Immutable deployment policy and test via a canary percentage of traffic",
"isCorrect": false,
"explanation": "Immutable deployments do not support canary-style traffic splitting. Traffic shifts all at once after health checks pass on the new ASG."
},
{
"answer": "Deploy using Rolling with additional batch and monitor CloudWatch metrics during the rollout",
"isCorrect": false,
"explanation": "Rolling with additional batch does not allow you to test the new version in isolation before routing production traffic to it."
},
{
"answer": "Use the eb deploy command with the --staged flag to hold the new version until manually approved",
"isCorrect": false,
"explanation": "There is no --staged flag in the eb CLI that holds a deployment for manual approval. This option is fabricated."
}
]
},
{
"question": "A developer needs to run a database migration script exactly once during an Elastic Beanstalk deployment, after the application bundle is extracted but before the new version goes live. Which mechanism should they use?",
"answers": [
{
"answer": "A container_commands entry in an .ebextensions .config file with leader_only: true",
"isCorrect": true,
"explanation": "container_commands run after the application is extracted but before it goes live. The leader_only: true flag ensures the command runs on only one instance during a rolling deployment, which is ideal for database migrations."
},
{
"answer": "A commands entry in an .ebextensions .config file",
"isCorrect": false,
"explanation": "commands run before the application is extracted, making them unsuitable for post-extraction tasks like database migrations. They also lack a leader_only option."
},
{
"answer": "A script placed in .platform/hooks/prebuild/",
"isCorrect": false,
"explanation": "The prebuild hook runs before the build step, not after the application is extracted. For post-extraction, pre-live tasks, predeploy hooks or container_commands are more appropriate."
},
{
"answer": "An environment variable set via the Beanstalk console that triggers the migration on startup",
"isCorrect": false,
"explanation": "Environment variables expose configuration to the application process but do not execute commands. They cannot trigger deployment lifecycle actions."
}
]
},
{
"question": "Which directory structure and file format are required for Elastic Beanstalk environment customization using .ebextensions?",
"answers": [
{
"answer": "An .ebextensions/ directory at the root of the source bundle, containing files with a .config extension written in YAML or JSON",
"isCorrect": true,
"explanation": "Beanstalk requires the .ebextensions/ directory at the root of your application bundle. Each file must use the .config extension and be valid YAML or JSON."
},
{
"answer": "An .ebextensions/ directory anywhere in the project, containing .yaml files",
"isCorrect": false,
"explanation": "The .ebextensions/ directory must be at the root of the source bundle, not anywhere in the project. Files must also use the .config extension, not .yaml."
},
{
"answer": "A .beanstalk/ directory at the root of the source bundle, containing .config files",
"isCorrect": false,
"explanation": "The correct directory name is .ebextensions/, not .beanstalk/."
},
{
"answer": "An .ebextensions/ directory at the root of the source bundle, containing .json files only",
"isCorrect": false,
"explanation": ".ebextensions .config files can be written in either YAML or JSON, not JSON only."
}
]
},
{
"question": "On Amazon Linux 2 Elastic Beanstalk platforms, a developer wants to run a script after the application has gone live (e.g., to send a deployment notification). Where should they place the script?",
"answers": [
{
"answer": ".platform/hooks/postdeploy/",
"isCorrect": true,
"explanation": "The postdeploy hook directory contains scripts that run after the application is live, making it the correct location for post-deployment tasks like notifications."
},
{
"answer": ".platform/hooks/predeploy/",
"isCorrect": false,
"explanation": "predeploy scripts run after the build but before the application goes live. They execute too early for a post-deployment notification."
},
{
"answer": ".platform/hooks/prebuild/",
"isCorrect": false,
"explanation": "prebuild scripts run before the build step, which is far too early for a post-deployment action."
},
{
"answer": ".ebextensions/ with a container_commands entry",
"isCorrect": false,
"explanation": "container_commands run before the application goes live, not after. For post-live actions on AL2+, the postdeploy platform hook is the correct approach."
}
]
},
{
"question": "A company stores Elastic Beanstalk environment settings — including instance type, scaling thresholds, and environment variables — and wants to reuse this exact configuration when creating new environments. Which Beanstalk feature supports this?",
"answers": [
{
"answer": "Saved configurations",
"isCorrect": true,
"explanation": "Saved configurations are snapshots of environment settings stored in S3. They can be applied to new environments to ensure consistent, repeatable setups."
},
{
"answer": "Application versions",
"isCorrect": false,
"explanation": "Application versions store deployable code artifacts, not environment configuration settings."
},
{
"answer": ".ebextensions configuration files",
"isCorrect": false,
"explanation": ".ebextensions can configure environments, but they are bundled with the application source code, not stored separately as reusable environment snapshots."
},
{
"answer": "Environment variables exported via the eb CLI",
"isCorrect": false,
"explanation": "Environment variables set via the CLI apply to a specific environment. They do not create a reusable snapshot that can be applied to new environments."
}
]
},
{
"question": "Which eb CLI command is used to deploy the current source bundle to the active Elastic Beanstalk environment?",
"answers": [
{
"answer": "eb deploy",
"isCorrect": true,
"explanation": "eb deploy packages and deploys the current source bundle to the active Elastic Beanstalk environment."
},
{
"answer": "eb create",
"isCorrect": false,
"explanation": "eb create provisions a new environment. It does not deploy an updated version to an existing environment."
},
{
"answer": "eb push",
"isCorrect": false,
"explanation": "eb push is not a valid Elastic Beanstalk CLI command."
},
{
"answer": "eb release",
"isCorrect": false,
"explanation": "eb release is not a valid Elastic Beanstalk CLI command."
}
]
},
{
"question": "A team wants Elastic Beanstalk to publish detailed metrics such as request latency and HTTP response codes to CloudWatch. Which health reporting level must they enable?",
"answers": [
{
"answer": "Enhanced health reporting",
"isCorrect": true,
"explanation": "Enhanced health reporting publishes granular metrics (request latency, HTTP response codes, instance CPU) to CloudWatch. It requires a load-balanced environment and the Beanstalk health agent on instances."
},
{
"answer": "Basic health reporting",
"isCorrect": false,
"explanation": "Basic health reporting only checks ELB health checks and returns a simple OK/Warning/Degraded/Severe status. It does not publish detailed metrics to CloudWatch."
},
{
"answer": "CloudWatch detailed monitoring on EC2 instances",
"isCorrect": false,
"explanation": "CloudWatch detailed monitoring increases the frequency of EC2 metrics but does not provide application-level metrics like HTTP response codes or request latency."
},
{
"answer": "AWS X-Ray tracing",
"isCorrect": false,
"explanation": "X-Ray provides distributed tracing for application requests but is separate from Beanstalk's health reporting system."
}
]
},
{
"question": "A developer created an Elastic Beanstalk environment with an RDS database provisioned inside the environment for quick prototyping. The project is now going to production. What is the primary risk of keeping this coupled database setup?",
"answers": [
{
"answer": "Deleting the Elastic Beanstalk environment will also delete the RDS database, causing permanent data loss",
"isCorrect": true,
"explanation": "When RDS is provisioned inside a Beanstalk environment (coupled), it is tied to the environment's lifecycle. Terminating the environment will delete the database unless a snapshot is taken beforehand."
},
{
"answer": "The RDS instance inside Beanstalk cannot be accessed by other AWS services",
"isCorrect": false,
"explanation": "A coupled RDS instance can be accessed by other services using the appropriate security group and connection details. Access is not inherently restricted."
},
{
"answer": "Coupled RDS instances do not support Multi-AZ deployments",
"isCorrect": false,
"explanation": "There is no such restriction. RDS instances provisioned inside Beanstalk can be configured with Multi-AZ, though the lifecycle coupling issue remains the main concern."
},
{
"answer": "Beanstalk cannot inject the RDS connection string as an environment variable when RDS is inside the environment",
"isCorrect": false,
"explanation": "Beanstalk does inject RDS connection details as environment variables for coupled databases. The lifecycle coupling is the actual risk, not the connection configuration."
}
]
},
{
"question": "A company has an Elastic Beanstalk environment with a coupled RDS database and now needs to migrate to a decoupled setup for production. Which sequence of steps correctly describes this migration?",
"answers": [
{
"answer": "Take a snapshot of the RDS instance → delete the database from the environment retaining the snapshot → re-create it as a standalone RDS instance → update Beanstalk environment variables with the new connection details",
"isCorrect": true,
"explanation": "This is the correct migration path. You preserve the data via a snapshot, decouple the RDS lifecycle from Beanstalk, then point the application to the new standalone instance via environment variables."
},
{
"answer": "Create a new standalone RDS instance → use AWS DMS to replicate data → update environment variables → delete the coupled database",
"isCorrect": false,
"explanation": "While this could work technically, it is not the documented Beanstalk migration procedure. The snapshot-based approach is the standard method described for this scenario."
},
{
"answer": "Use the Beanstalk console to detach the RDS instance from the environment without deleting it",
"isCorrect": false,
"explanation": "Beanstalk does not offer a direct 'detach RDS' operation. The migration requires snapshotting, deleting, and re-creating the instance outside the environment."
},
{
"answer": "Terminate the environment and re-create it without RDS, then restore from a snapshot automatically detected by Beanstalk",
"isCorrect": false,
"explanation": "Beanstalk does not automatically detect or restore from RDS snapshots when creating a new environment. The process must be performed manually."
}
]
},
{
"question": "Which of the following statements about Elastic Beanstalk managed platform updates is correct?",
"answers": [
{
"answer": "Beanstalk can automatically apply minor and patch platform version updates during a configurable maintenance window",
"isCorrect": true,
"explanation": "Managed platform updates allow Beanstalk to automatically apply minor and patch updates during a maintenance window you define, keeping runtimes patched without manual intervention."
},
{
"answer": "Managed platform updates apply major version upgrades automatically without any user intervention",
"isCorrect": false,
"explanation": "Managed platform updates cover minor and patch versions only. Major version upgrades require explicit action from the developer."
},
{
"answer": "Managed platform updates are only available for Docker-based environments",
"isCorrect": false,
"explanation": "Managed platform updates are available across Beanstalk's supported platforms, not limited to Docker."
},
{
"answer": "Enabling managed platform updates disables enhanced health reporting",
"isCorrect": false,
"explanation": "Managed platform updates and enhanced health reporting are independent features. Enabling one does not affect the other."
}
]
},
{
"question": "A developer needs to use a runtime not supported by Elastic Beanstalk's managed platforms. What is the correct approach?",
"answers": [
{
"answer": "Create a custom platform using Packer",
"isCorrect": true,
"explanation": "When no managed runtime fits your needs, Elastic Beanstalk supports defining a custom platform using Packer, allowing you to build a machine image with your required runtime."
},
{
"answer": "Use the Docker platform and install the custom runtime inside the container",
"isCorrect": false,
"explanation": "While this is a valid workaround in practice, the course-defined answer for unsupported runtimes is creating a custom platform with Packer, which is the official Beanstalk mechanism."
},
{
"answer": "Submit a support request to AWS to add the runtime to the managed platform list",
"isCorrect": false,
"explanation": "AWS does not add custom runtimes on a per-customer basis. The custom platform feature via Packer is the self-service solution."
},
{
"answer": "Use .ebextensions to install the runtime on the managed platform's EC2 instances at deploy time",
"isCorrect": false,
"explanation": "While .ebextensions can install packages, it is not the intended mechanism for fundamentally unsupported runtimes. Custom platforms via Packer are the proper solution for this case."
}
]
}
]
{{< /qcm >}}