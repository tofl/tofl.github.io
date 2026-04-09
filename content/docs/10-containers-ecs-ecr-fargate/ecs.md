---
title: "32. ECS"
type: docs
weight: 1
---

## ECS (Elastic Container Service)

Modern applications are increasingly built as collections of small, independent services packaged in containers. Containers are lightweight, portable, and consistent across environments — but running them reliably at scale introduces real operational complexity: Where do containers run? How do you restart failed ones? How do you distribute traffic? ECS is AWS's answer to these questions. It is a fully managed **container orchestration service** that handles scheduling, placement, scaling, and lifecycle management of Docker containers on your behalf — without requiring you to operate Kubernetes.

### Core Architecture

ECS is built around four key concepts that stack on top of each other:

- **Cluster** — The logical boundary for your ECS resources. A cluster groups the infrastructure (EC2 instances or Fargate capacity) that your containers run on. [🔗](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/clusters.html)
- **Task Definition** — A blueprint (JSON document) that describes *how* a container should run: which Docker image to use, how much CPU and memory to allocate, environment variables, networking mode, IAM roles, and mounted volumes. Think of it as the equivalent of a `docker run` command, codified. [🔗](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task_definitions.html)
- **Task** — A running instance of a task definition. A task can contain one or more tightly coupled containers (similar to a Kubernetes Pod). Tasks are ephemeral — they run, complete their work, and stop.
- **Service** — A long-running controller that ensures a specified number of tasks are always running. If a task crashes, the service replaces it. Services also handle integration with load balancers and manage rolling deployments. [🔗](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/ecs_services.html)

### Launch Types: EC2 vs Fargate

When you run tasks in ECS, you choose *where* the compute comes from:

- **EC2 launch type** — You provision and manage a group of EC2 instances that form the cluster's capacity. The ECS agent runs on each instance and registers it with the cluster. You have full control over the underlying host (instance type, AMI, storage), but you are responsible for patching, scaling, and managing that fleet.
- **Fargate launch type** — AWS provisions and manages the underlying compute entirely. You define what your container needs (CPU, memory), and Fargate runs it without you ever seeing or touching a server. This is the default choice for teams that want to focus on application code rather than infrastructure. [🔗](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/launch_types.html)

The practical rule: use **Fargate** unless you have a specific reason to control the host (e.g., GPU workloads, custom AMIs, or cost optimization at very high scale with reserved instances).

### Task Definitions in Detail

The task definition is the most configuration-dense part of ECS. Key fields include:

- **CPU and memory** — Defined at the task level (required for Fargate) and optionally at the container level. Fargate enforces specific valid CPU/memory combinations. [🔗](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task-cpu-memory-error.html)
- **Container definitions** — Each container in the task specifies its image URI (typically from ECR), port mappings, environment variables, log configuration (usually `awslogs` for CloudWatch), and health checks.
- **Volumes** — Tasks can mount EFS file systems for persistent shared storage, or use bind mounts and ephemeral scratch space for short-lived data. [🔗](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/using_data_volumes.html)
- **Networking mode** — Controls how containers communicate (covered below).
- **IAM roles** — Two distinct roles apply at the task level (see the IAM section below).

### IAM Roles: Task Role vs Task Execution Role

This distinction is frequently tested and easy to confuse:

- **Task Execution Role** — Used by the ECS *infrastructure* (the ECS agent or Fargate) to act on your behalf *before and around* the container runs. Its responsibilities include pulling the container image from ECR and sending container logs to CloudWatch Logs. Without this role, ECS cannot launch your container. [🔗](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task_execution_IAM_role.html)
- **Task Role** — Used by the *application code running inside the container*. If your container needs to read from S3, write to DynamoDB, or call any other AWS service, those permissions go in the Task Role. This follows the same least-privilege principle as EC2 instance profiles.

A common mental model: the execution role gets the container *started*; the task role is what the container *can do* once running.

### ECS Services: Desired Count, Updates, and Deployment Strategies

An ECS Service maintains a target number of running tasks (the **desired count**) and handles replacements automatically. Beyond that baseline, services support configurable deployment strategies: [🔗](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/deployment-types.html)

- **Rolling update (default)** — ECS gradually replaces old tasks with new ones. You control the pace with `minimumHealthyPercent` (how low the running count can drop) and `maximumPercent` (how high it can temporarily surge). For example, with a desired count of 4, `minimumHealthyPercent: 50` and `maximumPercent: 200`, ECS can spin up 4 new tasks before terminating the old 4.
- **Blue/Green deployment (via CodeDeploy)** — ECS provisions a completely new set of tasks (green), shifts traffic to them, and only then terminates the old set (blue). Supports canary and linear traffic shifting for progressive rollouts. Best used when zero-downtime deploys and easy rollback are critical.

### ECS with ALB: Dynamic Port Mapping

When running multiple tasks on the same EC2 instance (EC2 launch type), each task needs a unique host port, but you can't hardcode port 8080 for every task. ECS solves this with **dynamic port mapping**: you set the host port to `0` in the task definition, and ECS assigns a random ephemeral port at runtime. The Application Load Balancer's target group automatically learns the correct host:port mapping through ECS service integration, so traffic routing stays seamless regardless of how many tasks are running on a given host. [🔗](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/service-load-balancing.html)

With Fargate and `awsvpc` networking mode, each task gets its own ENI and private IP, so dynamic port mapping is unnecessary — the task is directly addressable.

### Networking Modes

The networking mode in a task definition controls how containers inside the task communicate with each other and with the outside world: [🔗](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task-networking.html)

- **`bridge`** — The default for EC2 launch type. Containers connect through Docker's virtual bridge network on the host. Port mapping (static or dynamic) is required to expose containers to external traffic.
- **`host`** — The container uses the EC2 host's network interface directly, bypassing Docker networking. Provides the lowest latency but means you can't run two containers listening on the same port on the same host.
- **`awsvpc`** — Each task gets its own **Elastic Network Interface (ENI)** with a private IP address within your VPC. This is the only mode supported on Fargate, and the recommended mode for EC2 as well. It gives each task full VPC-level networking features: security groups, VPC flow logs, and direct IP addressability. The trade-off is that EC2 instances have a limited number of ENIs, which caps how many `awsvpc` tasks can run per host.

### ECS Auto Scaling

ECS Services can scale the number of running tasks automatically using **Application Auto Scaling**: [🔗](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/service-auto-scaling.html)

- **Target Tracking** — The simplest approach. You pick a metric (e.g., average CPU utilization at 60%, or ECS-specific metrics like `RequestCountPerTarget` from an ALB) and a target value. ECS adjusts the desired count to keep the metric near the target. This is the recommended default.
- **Step Scaling** — You define explicit scaling actions tied to CloudWatch alarm thresholds. Gives more granular control (e.g., add 2 tasks when CPU > 70%, add 5 tasks when CPU > 90%), at the cost of more configuration.

For EC2 launch type clusters, you also need to scale the underlying EC2 capacity independently. **ECS Cluster Auto Scaling** (using a Capacity Provider backed by an Auto Scaling Group) can automate this, ensuring there's always enough EC2 capacity to place new tasks. [🔗](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/cluster-auto-scaling.html)

### ECS with EventBridge for Event-Driven Tasks

Not every workload is a long-running service. ECS tasks can be triggered on-demand in response to events using **Amazon EventBridge**. A common pattern: an EventBridge rule fires on a schedule (cron) or in response to an event (e.g., a file uploaded to S3, a DynamoDB stream event, or a custom application event), and the rule's target is an ECS task. This lets you run batch jobs, data processing pipelines, or report generation workloads without keeping a task permanently running. [🔗](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/scheduled_tasks.html)

The ECS task in this pattern needs the Task Execution Role to launch, and a Task Role with permissions to access whatever AWS resources the job processes (S3, DynamoDB, etc.).