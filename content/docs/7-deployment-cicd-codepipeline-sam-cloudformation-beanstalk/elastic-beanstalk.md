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