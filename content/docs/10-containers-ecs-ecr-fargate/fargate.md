---
title: "34. Fargate"
type: docs
weight: 3
---

# Fargate

AWS Fargate is a serverless compute engine for containers that works with both ECS and EKS. It eliminates the need to provision, configure, or manage EC2 instances for running containers — you define what your container needs (CPU, memory, networking), and AWS handles everything underneath. Fargate exists to solve a very specific operational burden: cluster capacity management. With EC2 launch type, you're responsible for the EC2 instances that form your cluster — choosing instance types, managing scaling of the underlying fleet, patching the OS, and ensuring there's always enough capacity. Fargate removes that entirely. You pay per task, per second, for exactly the resources your container consumes. [🔗](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/AWS_Fargate.html)

## Fargate vs EC2 Launch Type

Choosing between Fargate and EC2 comes down to control vs convenience, and cost structure.

| | **Fargate** | **EC2** |
|---|---|---|
| Infrastructure management | None (AWS-managed) | You manage EC2 instances |
| Startup time | Slightly slower (cold start) | Faster (instances already running) |
| Cost model | Per-task (vCPU + memory, per second) | Per-instance (even if underutilized) |
| Best for | Spiky, unpredictable, or low-ops workloads | High-density, cost-optimized, steady workloads |
| GPU support | Not supported | Supported |
| Windows containers | Supported | Supported |

A practical rule of thumb: if you run hundreds of tasks per day with variable demand and want zero cluster ops, use Fargate. If you're running dense, high-throughput workloads 24/7 and want to maximize cost efficiency through bin-packing, EC2 launch type may be cheaper.

## Task Sizing

In Fargate, you don't pick an EC2 instance — instead, you declare the CPU and memory your task needs directly in the **task definition**. Fargate enforces specific valid combinations (you cannot set arbitrary values freely). [🔗](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task-cpu-memory-error.html)

Valid CPU and memory combinations include:

- **0.25 vCPU** — 512 MB to 2 GB
- **0.5 vCPU** — 1 GB to 4 GB
- **1 vCPU** — 2 GB to 8 GB
- **2 vCPU** — 4 GB to 16 GB
- **4 vCPU** — 8 GB to 30 GB
- **8 vCPU** — 16 GB to 60 GB
- **16 vCPU** — 32 GB to 120 GB

These values are set at the task level. Individual containers within the task can optionally declare their own CPU/memory *reservations*, but the task-level values are the hard ceiling Fargate enforces. Over-sizing is a common cost mistake — profile your container's actual usage and size accordingly.

## Networking in Fargate (awsvpc Mode)

Fargate **exclusively uses the `awsvpc` networking mode** — there is no choice here. Every Fargate task gets its own **Elastic Network Interface (ENI)** with a private IP address within your VPC. This has several important consequences:

- Each task is a first-class VPC citizen. You can apply **Security Groups directly to the task** (not just the host, as in bridge mode).
- Tasks can communicate with other VPC resources (RDS, ElastiCache, other services) natively, using private IPs.
- Because each task gets its own ENI, there are **ENI limits per subnet** to be aware of at scale. [🔗](https://docs.aws.amazon.com/vpc/latest/userguide/amazon-vpc-limits.html)
- You choose whether to assign a **public IP** at task launch time. If your task needs to pull images from ECR or call AWS APIs and sits in a private subnet, it needs either a NAT Gateway or VPC endpoints — no different from any other VPC resource.

This per-task network isolation is also a security benefit: there's no shared network namespace between tasks, unlike the `bridge` mode on EC2.

## Fargate with ECS and EKS

Fargate integrates with both orchestrators, but the experience differs slightly:

- **ECS on Fargate** — the most common pattern for the DVA-C02 exam. You define a task definition with `requiresCompatibilities: FARGATE`, set the network mode to `awsvpc`, and your ECS Service or standalone task runs on Fargate. No cluster EC2 instances to manage. [🔗](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/getting-started-fargate.html)
- **EKS on Fargate** — Fargate can also serve as the compute layer for Kubernetes pods via **Fargate Profiles**, which define which pods (by namespace/label selectors) should run on Fargate. This is awareness-level for the DVA-C02 exam. [🔗](https://docs.aws.amazon.com/eks/latest/userguide/fargate.html)

## Fargate Spot

**Fargate Spot** lets you run Fargate tasks on spare AWS capacity at a significant discount (up to 70% cheaper than standard Fargate pricing). The trade-off is that AWS can reclaim that capacity with a **2-minute warning**, terminating your task. [🔗](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/fargate-capacity-providers.html)

Fargate Spot is well-suited for:
- Batch processing jobs that can tolerate interruption and restart
- CI/CD pipeline workers
- Non-critical background jobs

It is **not** appropriate for stateful workloads, long-running transactions, or anything that cannot be gracefully interrupted. In practice, you mix Fargate Spot with standard Fargate using **Capacity Providers** and a base + burst strategy: run a baseline on standard Fargate for reliability, and burst with Spot for cost savings.

## Storage: Ephemeral Storage and EFS Integration

By default, each Fargate task gets **20 GB of ephemeral storage** (read/write layer attached to the task's root filesystem). This storage is temporary — it is destroyed when the task stops. You can expand it up to **200 GB** by configuring `ephemeralStorage` in the task definition, though you pay for the additional allocation. [🔗](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/fargate-task-storage.html)

For persistent or shared storage, Fargate integrates with **Amazon EFS (Elastic File System)**. You mount an EFS file system as a volume in the task definition, and the container can read/write files that persist beyond the task lifecycle. This is the standard pattern for:

- Sharing data between multiple running tasks (e.g., multiple web server tasks reading the same config files)
- Persisting data from a stateful container (e.g., a CMS or ML model artifacts)

EFS works seamlessly with Fargate's `awsvpc` networking because both live in your VPC — just ensure the EFS mount target's security group allows inbound NFS (port 2049) from the task's security group.

## Security and Task Isolation

Fargate's security model is meaningfully stronger than shared EC2 instances. Each Fargate task runs in its **own dedicated kernel runtime boundary** — tasks do not share the underlying host OS kernel with each other. AWS manages the virtualization layer, and you have no access to the host. This means:

- No risk of noisy-neighbor container escape attacks between tenants
- No need to worry about kernel-level patching
- The attack surface is limited to your container image and your application code

From an IAM perspective, the same role separation applies as with ECS generally: the **Task Execution Role** gives Fargate itself the permissions to pull images from ECR and push logs to CloudWatch, while the **Task Role** grants your application code permissions to call AWS services (S3, DynamoDB, etc.). These should always be kept separate and follow least-privilege. [🔗](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task_execution_IAM_role.html)