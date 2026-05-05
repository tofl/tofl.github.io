---
title: "AWS Copilot Patterns: Environment-Based Deployments for ECS and App Runner"
---

## AWS Copilot Patterns: Environment-Based Deployments for ECS and App Runner

If you've ever found yourself managing separate infrastructure configurations for development, staging, and production—wrestling with CloudFormation templates, environment variables, and inconsistent deployments—you understand the friction that grows as your application scales across environments. AWS Copilot is designed to eliminate exactly this kind of overhead. By providing a structured, opinionated approach to containerized application deployment, Copilot lets you focus on building and shipping features rather than maintaining infrastructure boilerplate.

In this guide, we'll explore how Copilot's environment concept serves as a powerful abstraction layer for managing multiple deployment targets. Whether you're running your workloads on Amazon ECS or AWS App Runner, Copilot provides a consistent pattern for defining services, orchestrating deployments, and handling environment-specific configuration. We'll walk through the manifest structure, trace how Copilot generates CloudFormation under the hood, and demonstrate a complete multi-environment workflow that you can adapt to your own projects.

### Understanding Copilot's Environment Concept

At its core, an AWS Copilot environment represents a complete, isolated deployment target—typically aligned with a stage in your software development lifecycle. Think of it as a pre-configured collection of networking, container orchestration, and security resources that's ready to host your services.

When you create a Copilot environment, you're not just naming a folder or setting a variable. You're provisioning actual AWS infrastructure: a Virtual Private Cloud (VPC) with public and private subnets, security groups, an Application Load Balancer or Network Load Balancer, and either an ECS cluster or the lightweight networking needed for App Runner. Copilot handles all of this orchestration, sparing you from writing raw CloudFormation or navigating the AWS Console.

The beauty of this abstraction is consistency with flexibility. Every environment follows the same logical structure, making your deployments predictable. At the same time, you can override settings at the environment level—adjusting instance counts, load balancer configuration, or container CPU and memory—without touching the underlying service definition.

### The Manifest Structure and Service Definition

The heart of a Copilot service is its manifest file, typically named `copilot/services/myservice/addons/manifest.yml`. This YAML file is where you declare what your containerized application needs to run.

A basic manifest looks something like this:

```yaml
name: api-service
type: 'Load Balanced Web Service'

image:
  build: ./Dockerfile

variables:
  LOG_LEVEL: INFO
  
secrets:
  DATABASE_URL: /copilot/api-service/db_url

cpu: 256
memory: 512
count: 2
exec: true

logging:
  retention: 7

network:
  vpc:
    placement: 'private'

environments:
  dev:
    count: 1
    variables:
      LOG_LEVEL: DEBUG
  prod:
    count: 3
    cpu: 512
    memory: 1024
    variables:
      LOG_LEVEL: WARN
```

Let's unpack what's happening here. The `type` field determines the deployment pattern—common choices include `Load Balanced Web Service` for traditional web applications and `Backend Service` for internal workloads without public internet access. The `image` section tells Copilot how to build your container; it can reference a local Dockerfile or point to a pre-built image in Amazon ECR.

The `variables` and `secrets` sections define environment-specific configuration. Variables are plaintext; secrets are resolved from AWS Secrets Manager or AWS Systems Manager Parameter Store at runtime. Notice that the manifest also includes an `environments` stanza, where you can override settings for specific deployment targets. In the example above, the development environment runs a single container with debug logging, while production scales to three replicas with more generous resource allocation and warning-level logs.

The `cpu` and `memory` fields specify the container's resource reservation. These values must align with valid ECS Fargate combinations—for instance, 256 CPU units pairs with 512, 1024, 2048, or more MiB of memory. The `count` field determines the desired task count in ECS, or how the service scales in App Runner.

### How Copilot Generates CloudFormation

Behind every `copilot` CLI command lies CloudFormation. Copilot is essentially a code generation and orchestration tool that translates your manifest into production-grade CloudFormation templates. Understanding this relationship clarifies how Copilot provisions and updates your infrastructure.

When you run `copilot service deploy`, Copilot performs several steps in sequence. First, it validates your manifest against a schema, ensuring all required fields are present and properly formatted. Next, it generates CloudFormation templates for the ECS service, including task definitions, service definitions, auto-scaling policies, logging configuration, and security group rules. If you're using App Runner, the generated templates reflect App Runner's service configuration instead.

These templates are then stored in your AWS CloudFormation account, typically under a stack named something like `copilot-myapp-dev-api-service`. You can inspect them in the AWS CloudFormation Console, though most teams find it more practical to trust Copilot's generation and focus on the manifest.

One key advantage of this approach is reproducibility. Because Copilot generates deterministic CloudFormation from your manifest, you can version your manifest in Git, and any team member or CI/CD pipeline can recreate the exact same infrastructure. This eliminates the manual drift that often plagues infrastructure managed through the console or ad-hoc scripts.

### Provisioning ECS Infrastructure

When you deploy a service to an ECS-based environment, Copilot orchestrates several interrelated AWS resources. At the foundation sits the ECS cluster, which is a logical grouping of compute capacity. For Copilot environments, this cluster typically uses AWS Fargate, a serverless container compute engine that abstracts away EC2 instance management.

Copilot generates an ECS task definition, which is a template describing how to run your Docker container. This includes the Docker image URI, CPU and memory allocation, port mappings, environment variables, logging driver configuration, and IAM role assignments. The task definition is versioned; each deployment creates a new revision, allowing you to roll back if needed.

The ECS service itself orchestrates task deployment and scaling. It ensures that the desired number of tasks are running at any time, replaces failed tasks, and distributes them across availability zones for high availability. Load balancing is handled by an Application Load Balancer that sits in front of your tasks, distributing incoming traffic and performing health checks.

Auto-scaling policies can be attached to your service, allowing it to scale up or down based on CloudWatch metrics like CPU utilization or request count. Copilot configures sensible defaults, but you can customize these through environment-level overrides in your manifest.

### Provisioning App Runner Infrastructure

App Runner takes a different approach to containerized deployment. Rather than managing an ECS cluster explicitly, you provide a container image, and App Runner handles the underlying infrastructure completely. It automatically scales based on incoming traffic, performs health checks, and manages the deployment lifecycle.

When Copilot deploys to an App Runner-based environment, the generated CloudFormation creates an App Runner service resource. This service references your container image—either from Amazon ECR or a public registry—and defines ingress rules, environment variables, and scaling parameters.

App Runner is an excellent choice for applications that don't require fine-grained control over resource allocation or custom networking. It's particularly well-suited for development and staging environments, or for production workloads with predictable, moderate traffic patterns. The trade-off is that App Runner offers less granular control than ECS; you can't, for instance, reserve specific CPU and memory combinations the way you can with Fargate.

### The CLI Workflow for Rapid Iteration

The true power of Copilot emerges when you interact with it through the command line. The workflow is designed for developers, not just infrastructure teams.

Start by initializing an application and creating environments:

```bash
copilot app init myapp
copilot env init --name dev --default-config
copilot env init --name prod --default-config
```

The `--default-config` flag tells Copilot to use sensible defaults without prompting. After this, you have two isolated environments ready to receive deployments.

Next, create a service:

```bash
copilot svc init --name api-service \
  --svc-type "Load Balanced Web Service" \
  --dockerfile ./Dockerfile
```

This scaffolds a service with a manifest in `copilot/services/api-service/manifest.yml`. Edit this manifest to specify your application's requirements: environment variables, secrets, CPU and memory, scaling behavior, and per-environment overrides.

Once your manifest is ready, deploy:

```bash
copilot svc deploy --name api-service --env dev
```

This command validates your manifest, generates CloudFormation, and applies it to the dev environment. The entire process typically completes in a few minutes. On subsequent deployments, Copilot compares the generated CloudFormation to what's already deployed and applies only the necessary changes, often making updates faster.

For a different environment, the command is identical except for the environment name:

```bash
copilot svc deploy --name api-service --env prod
```

Copilot applies the same service definition but respects any environment-specific overrides in your manifest. So if production is configured for three replicas and development for one, those differences flow through without any extra work.

Throughout development, you can monitor your application:

```bash
copilot svc status --name api-service --env dev
copilot svc logs --name api-service --env dev --follow
```

These commands provide visibility into your running tasks and application logs, streamed directly to your terminal.

### Environment Inheritance and Overrides

One of Copilot's most elegant patterns is how it handles environment-specific configuration. The principle is simple: define sensible defaults in your manifest's top-level sections, then override specific values for particular environments.

Consider this expanded manifest:

```yaml
name: worker-service
type: 'Backend Service'

image:
  build: ./Dockerfile

cpu: 256
memory: 512
count: 1

variables:
  WORKER_THREADS: 4
  BATCH_SIZE: 100

environments:
  dev:
    count: 1
    variables:
      BATCH_SIZE: 10  # Smaller batches for faster iteration

  staging:
    count: 2
    cpu: 512
    memory: 1024
    variables:
      BATCH_SIZE: 50

  prod:
    count: 4
    cpu: 512
    memory: 1024
    variables:
      BATCH_SIZE: 100
```

Here, the base configuration specifies one task with minimal resources. The dev environment sticks with one replica but uses a smaller batch size to speed up testing. Staging scales to two replicas and increases resources, allowing realistic load testing. Production reserves the most resources and runs four replicas.

The key insight is that you're not redefining the entire service for each environment—you're specifying deltas. This keeps your manifest DRY (Don't Repeat Yourself) and makes it easy to track what differs between environments at a glance.

Environment-level overrides apply to most manifest fields: `cpu`, `memory`, `count`, `variables`, `secrets`, and even network and logging configuration. When Copilot deploys, it merges the base definition with the environment-specific overrides, generating a complete CloudFormation template for that specific environment.

### A Complete Multi-Environment Deployment Example

Let's walk through a realistic scenario: deploying a Node.js REST API across development, staging, and production environments.

First, initialize the application and environments:

```bash
copilot app init bookstore-api
copilot env init --name dev --default-config
copilot env init --name staging --default-config
copilot env init --name prod --default-config
```

Next, create the service:

```bash
copilot svc init --name rest-api \
  --svc-type "Load Balanced Web Service" \
  --dockerfile ./Dockerfile
```

Now, craft your manifest at `copilot/services/rest-api/manifest.yml`:

```yaml
name: rest-api
type: 'Load Balanced Web Service'

image:
  build: ./Dockerfile

variables:
  NODE_ENV: production
  PORT: 3000
  LOG_LEVEL: info

secrets:
  DATABASE_URL: /bookstore/database_url
  JWT_SECRET: /bookstore/jwt_secret

cpu: 256
memory: 512
count: 2

network:
  vpc:
    placement: 'private'

logging:
  retention: 7

environments:
  dev:
    count: 1
    cpu: 256
    memory: 512
    variables:
      NODE_ENV: development
      LOG_LEVEL: debug
    logging:
      retention: 3

  staging:
    count: 2
    cpu: 512
    memory: 1024
    variables:
      LOG_LEVEL: info
    logging:
      retention: 7

  prod:
    count: 3
    cpu: 512
    memory: 1024
    variables:
      LOG_LEVEL: warn
    logging:
      retention: 30
```

This manifest defines a load-balanced web service with a base configuration suitable for staging or production, then dials things back for development (single replica, reduced resources, debug logging, shorter log retention) and scales up for production (three replicas, generous resources, warning-level logs, 30-day retention).

Your team stores this manifest in Git, alongside your application code. Before deploying, ensure your secrets are created in AWS Systems Manager Parameter Store or Secrets Manager:

```bash
aws ssm put-parameter --name /bookstore/database_url \
  --value "postgresql://..." --type SecureString

aws ssm put-parameter --name /bookstore/jwt_secret \
  --value "your-secret-key" --type SecureString
```

Now, deploy to development:

```bash
copilot svc deploy --name rest-api --env dev
```

Copilot validates the manifest, builds the Docker image, pushes it to Amazon ECR, generates CloudFormation, and deploys to the dev environment. This typically takes 3–5 minutes on the first deployment.

Once dev is live, deploy to staging:

```bash
copilot svc deploy --name rest-api --env staging
```

Same image, same service definition, but with the staging environment overrides applied: two replicas, more memory, longer log retention.

Finally, when you're confident in staging, deploy to production:

```bash
copilot svc deploy --name rest-api --env prod
```

In a real-world scenario, this production deployment would be triggered by a CI/CD pipeline, perhaps after passing automated tests and receiving an approval. The command remains the same—Copilot handles the complexities of generating the right CloudFormation with the right overrides for the prod environment.

Throughout the day, check on your service:

```bash
copilot svc status --name rest-api --env prod
copilot svc logs --name rest-api --env prod --follow
```

If you need to update your application—say, adding a new environment variable or increasing CPU for production—edit the manifest and redeploy:

```bash
# Edit copilot/services/rest-api/manifest.yml
copilot svc deploy --name rest-api --env prod
```

Copilot generates new CloudFormation, compares it to what's deployed, and applies only the necessary changes. Your running tasks are replaced rolling, ensuring zero or minimal downtime.

### Key Patterns and Best Practices

Several patterns emerge from using Copilot effectively across multiple environments.

**Use the same manifest for all environments.** Rather than maintaining separate manifests per environment, define one manifest with environment-specific overrides. This dramatically reduces the chance of configuration drift and makes changes transparent.

**Keep secrets in AWS Systems Manager or Secrets Manager.** Don't hardcode credentials or sensitive values in your manifest. Copilot integrates seamlessly with these managed secret services, and your secrets stay in AWS's encrypted storage rather than in Git.

**Test manifest changes locally or in dev first.** Before rolling out a manifest change to production, validate it in a dev or staging environment. The feedback loop is fast—Copilot deployments complete in minutes—so there's no friction to iterating safely.

**Version your manifests in Git.** Your `copilot/` directory should be committed to your repository, just like application code. This gives you full auditability and the ability to roll back infrastructure definitions if a deployment goes wrong.

**Understand the CloudFormation generated by Copilot.** While Copilot abstracts away most of the complexity, reading the generated CloudFormation occasionally helps you understand what's happening under the hood and troubleshoot issues more effectively.

**Use service discovery for inter-service communication.** If you have multiple services within an environment, Copilot automatically registers them with AWS Cloud Map, allowing services to discover and communicate with each other by name. Reference other services using environment variables like `COPILOT_APPLICATION_NAME` and `COPILOT_SERVICE_NAME`.

### Troubleshooting and Common Pitfalls

Even with Copilot handling orchestration, a few issues crop up regularly.

**Manifest validation failures.** If you get an error during `copilot svc deploy`, validate your YAML syntax first. Use an online YAML validator or your editor's YAML extension. Common mistakes include incorrect indentation, typos in field names, or mismatched quote styles.

**CloudFormation stack failures.** Occasionally, the generated CloudFormation fails to deploy. Check the CloudFormation Console to see the detailed error message. Common culprits include insufficient IAM permissions, invalid resource configurations (like an invalid CPU/memory combination for Fargate), or AWS service limits being reached.

**Secrets not found.** If your service fails to start and logs mention missing secrets, verify that the parameter exists in Systems Manager Parameter Store or Secrets Manager under the exact path specified in your manifest. Also ensure the ECS task execution role has permissions to read those secrets.

**Image not found in ECR.** If Copilot fails to push your image to ECR, verify that your Dockerfile builds successfully and that you have permissions to push to the ECR repository. Copilot automatically creates the repository on first use.

**Networking and security group issues.** If your service is unreachable from the internet, check that the environment's Application Load Balancer security group permits inbound traffic on the relevant port, and that your service manifest specifies the correct port mapping.

### Moving Forward with Copilot

AWS Copilot transforms application deployment from a chore into a streamlined workflow. By providing a consistent abstraction layer across multiple environments and orchestration engines, it lets you focus on building great features rather than wrestling with infrastructure.

The manifest-driven approach pairs well with CI/CD automation. Your pipeline can validate manifests, run tests, and trigger `copilot svc deploy` commands without ever touching the AWS Console or CloudFormation directly. Environment promotion becomes a matter of a single command, with full auditability through Git.

As your applications and teams grow, Copilot continues to scale. Add new services with `copilot svc init`, add new environments with `copilot env init`, and manage everything through familiar CLI commands and a single manifest structure. The patterns and practices described in this guide—inheritance, overrides, per-environment configuration—remain consistent regardless of how complex your application architecture becomes.

The next step is to run through the workflow yourself: initialize an app, create environments, deploy a service, and experiment with environment-specific overrides. The learning curve is gentle, and the value emerges quickly once you experience how much friction Copilot removes from the deployment process.
