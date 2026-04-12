---
title: "34. Fargate"
type: docs
weight: 3
---

## Fargate

AWS Fargate is a serverless compute engine for containers that works with both ECS and EKS. It eliminates the need to provision, configure, or manage EC2 instances for running containers — you define what your container needs (CPU, memory, networking), and AWS handles everything underneath. Fargate exists to solve a very specific operational burden: cluster capacity management. With EC2 launch type, you're responsible for the EC2 instances that form your cluster — choosing instance types, managing scaling of the underlying fleet, patching the OS, and ensuring there's always enough capacity. Fargate removes that entirely. You pay per task, per second, for exactly the resources your container consumes. [🔗](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/AWS_Fargate.html)

### Fargate vs EC2 Launch Type

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

### Task Sizing

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

### Networking in Fargate (awsvpc Mode)

Fargate **exclusively uses the `awsvpc` networking mode** — there is no choice here. Every Fargate task gets its own **Elastic Network Interface (ENI)** with a private IP address within your VPC. This has several important consequences:

- Each task is a first-class VPC citizen. You can apply **Security Groups directly to the task** (not just the host, as in bridge mode).
- Tasks can communicate with other VPC resources (RDS, ElastiCache, other services) natively, using private IPs.
- Because each task gets its own ENI, there are **ENI limits per subnet** to be aware of at scale. [🔗](https://docs.aws.amazon.com/vpc/latest/userguide/amazon-vpc-limits.html)
- You choose whether to assign a **public IP** at task launch time. If your task needs to pull images from ECR or call AWS APIs and sits in a private subnet, it needs either a NAT Gateway or VPC endpoints — no different from any other VPC resource.

This per-task network isolation is also a security benefit: there's no shared network namespace between tasks, unlike the `bridge` mode on EC2.

### Fargate with ECS and EKS

Fargate integrates with both orchestrators, but the experience differs slightly:

- **ECS on Fargate** — the most common pattern for the DVA-C02 exam. You define a task definition with `requiresCompatibilities: FARGATE`, set the network mode to `awsvpc`, and your ECS Service or standalone task runs on Fargate. No cluster EC2 instances to manage. [🔗](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/getting-started-fargate.html)
- **EKS on Fargate** — Fargate can also serve as the compute layer for Kubernetes pods via **Fargate Profiles**, which define which pods (by namespace/label selectors) should run on Fargate. This is awareness-level for the DVA-C02 exam. [🔗](https://docs.aws.amazon.com/eks/latest/userguide/fargate.html)

### Fargate Spot

**Fargate Spot** lets you run Fargate tasks on spare AWS capacity at a significant discount (up to 70% cheaper than standard Fargate pricing). The trade-off is that AWS can reclaim that capacity with a **2-minute warning**, terminating your task. [🔗](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/fargate-capacity-providers.html)

Fargate Spot is well-suited for:
- Batch processing jobs that can tolerate interruption and restart
- CI/CD pipeline workers
- Non-critical background jobs

It is **not** appropriate for stateful workloads, long-running transactions, or anything that cannot be gracefully interrupted. In practice, you mix Fargate Spot with standard Fargate using **Capacity Providers** and a base + burst strategy: run a baseline on standard Fargate for reliability, and burst with Spot for cost savings.

### Storage: Ephemeral Storage and EFS Integration

By default, each Fargate task gets **20 GB of ephemeral storage** (read/write layer attached to the task's root filesystem). This storage is temporary — it is destroyed when the task stops. You can expand it up to **200 GB** by configuring `ephemeralStorage` in the task definition, though you pay for the additional allocation. [🔗](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/fargate-task-storage.html)

For persistent or shared storage, Fargate integrates with **Amazon EFS (Elastic File System)**. You mount an EFS file system as a volume in the task definition, and the container can read/write files that persist beyond the task lifecycle. This is the standard pattern for:

- Sharing data between multiple running tasks (e.g., multiple web server tasks reading the same config files)
- Persisting data from a stateful container (e.g., a CMS or ML model artifacts)

EFS works seamlessly with Fargate's `awsvpc` networking because both live in your VPC — just ensure the EFS mount target's security group allows inbound NFS (port 2049) from the task's security group.

### Security and Task Isolation

Fargate's security model is meaningfully stronger than shared EC2 instances. Each Fargate task runs in its **own dedicated kernel runtime boundary** — tasks do not share the underlying host OS kernel with each other. AWS manages the virtualization layer, and you have no access to the host. This means:

- No risk of noisy-neighbor container escape attacks between tenants
- No need to worry about kernel-level patching
- The attack surface is limited to your container image and your application code

From an IAM perspective, the same role separation applies as with ECS generally: the **Task Execution Role** gives Fargate itself the permissions to pull images from ECR and push logs to CloudWatch, while the **Task Role** grants your application code permissions to call AWS services (S3, DynamoDB, etc.). These should always be kept separate and follow least-privilege. [🔗](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task_execution_IAM_role.html)

{{< qcm >}}
[
{
"question": "A developer is designing an ECS-based application that must handle unpredictable spikes in traffic with minimal operational overhead. The team has no desire to manage underlying infrastructure. Which ECS launch type best fits this requirement?",
"answers": [
{
"answer": "EC2 launch type with Auto Scaling groups",
"isCorrect": false,
"explanation": "EC2 launch type still requires managing EC2 instances, scaling policies, and cluster capacity — this adds operational overhead the team wants to avoid."
},
{
"answer": "Fargate launch type",
"isCorrect": true,
"explanation": "Fargate is serverless and removes all infrastructure management. It is ideal for spiky, unpredictable workloads where the team wants zero cluster operations."
},
{
"answer": "EC2 launch type with Spot Instances",
"isCorrect": false,
"explanation": "Spot Instances reduce cost but still require managing EC2 capacity, instance types, and scaling — not a zero-ops solution."
},
{
"answer": "Fargate launch type with GPU-enabled tasks",
"isCorrect": false,
"explanation": "Fargate does not support GPU workloads. GPU support is only available with the EC2 launch type."
}
]
},
{
"question": "Which of the following are valid CPU and memory combinations for an AWS Fargate task definition? (Select TWO)",
"answers": [
{
"answer": "0.5 vCPU with 3 GB memory",
"isCorrect": true,
"explanation": "0.5 vCPU supports memory from 1 GB to 4 GB, so 3 GB is a valid combination."
},
{
"answer": "1 vCPU with 10 GB memory",
"isCorrect": false,
"explanation": "1 vCPU supports a maximum of 8 GB memory. 10 GB exceeds this limit and is not a valid combination."
},
{
"answer": "2 vCPU with 12 GB memory",
"isCorrect": true,
"explanation": "2 vCPU supports memory from 4 GB to 16 GB, so 12 GB is a valid combination."
},
{
"answer": "0.25 vCPU with 4 GB memory",
"isCorrect": false,
"explanation": "0.25 vCPU supports a maximum of 2 GB memory. 4 GB exceeds this ceiling and is not a valid combination."
},
{
"answer": "4 vCPU with 6 GB memory",
"isCorrect": false,
"explanation": "4 vCPU requires a minimum of 8 GB memory. 6 GB is below the minimum and is not a valid combination."
}
]
},
{
"question": "What networking mode does AWS Fargate exclusively use for ECS tasks?",
"answers": [
{
"answer": "bridge",
"isCorrect": false,
"explanation": "Bridge mode is available for EC2 launch type tasks, not Fargate. In bridge mode, containers share the host's network namespace."
},
{
"answer": "host",
"isCorrect": false,
"explanation": "Host networking mode is available for EC2 launch type only and binds containers directly to the host's network interface."
},
{
"answer": "awsvpc",
"isCorrect": true,
"explanation": "Fargate exclusively uses awsvpc networking mode. Each Fargate task gets its own Elastic Network Interface (ENI) with a private IP address within the VPC."
},
{
"answer": "overlay",
"isCorrect": false,
"explanation": "Overlay is a Docker Swarm networking concept and is not a valid ECS or Fargate networking mode."
}
]
},
{
"question": "A developer notices that a Fargate task in a private subnet cannot pull container images from Amazon ECR. There is no public IP assigned to the task. What are valid solutions to this problem? (Select TWO)",
"answers": [
{
"answer": "Attach a public IP to the Fargate task",
"isCorrect": true,
"explanation": "Assigning a public IP to the task at launch time allows it to reach ECR over the internet, resolving the connectivity issue."
},
{
"answer": "Add a NAT Gateway to the private subnet's route table",
"isCorrect": true,
"explanation": "A NAT Gateway allows tasks in a private subnet to access the internet (including ECR) without having a public IP, which is a standard VPC pattern."
},
{
"answer": "Switch the task to use bridge networking mode",
"isCorrect": false,
"explanation": "Fargate only supports awsvpc mode — switching to bridge mode is not possible and would not solve the connectivity issue."
},
{
"answer": "Move the task to an EC2 launch type",
"isCorrect": false,
"explanation": "Switching to EC2 launch type changes the compute layer but does not inherently resolve private subnet connectivity to ECR without additional network configuration."
},
{
"answer": "Configure VPC endpoints for ECR",
"isCorrect": true,
"explanation": "VPC endpoints for ECR (com.amazonaws.<region>.ecr.api and com.amazonaws.<region>.ecr.dkr) allow tasks in private subnets to pull images without requiring internet access or a NAT Gateway."
}
]
},
{
"question": "A Fargate task needs to share configuration files with other concurrently running tasks, and the data must persist after the tasks stop. Which storage solution should the developer use?",
"answers": [
{
"answer": "Ephemeral storage configured to 200 GB",
"isCorrect": false,
"explanation": "Ephemeral storage is task-local and destroyed when the task stops. It cannot be shared between tasks or used for persistent data."
},
{
"answer": "Amazon S3 mounted as a volume",
"isCorrect": false,
"explanation": "S3 cannot be directly mounted as a POSIX filesystem volume in Fargate task definitions. EFS is the correct integration for shared file storage."
},
{
"answer": "Amazon EFS mounted as a volume in the task definition",
"isCorrect": true,
"explanation": "EFS provides persistent, shared POSIX-compatible file storage that multiple Fargate tasks can mount simultaneously. Data persists beyond the task lifecycle, making it ideal for shared configuration files."
},
{
"answer": "Amazon EBS volume attached to the Fargate task",
"isCorrect": false,
"explanation": "EBS volumes are not natively supported as persistent volumes for Fargate tasks in the same way as EFS, and they cannot be shared between multiple tasks simultaneously."
}
]
},
{
"question": "What is the default ephemeral storage size allocated to each AWS Fargate task, and what is the maximum it can be expanded to?",
"answers": [
{
"answer": "10 GB default, expandable to 100 GB",
"isCorrect": false,
"explanation": "The default ephemeral storage for Fargate tasks is 20 GB, not 10 GB, and the maximum is 200 GB, not 100 GB."
},
{
"answer": "20 GB default, expandable to 200 GB",
"isCorrect": true,
"explanation": "Fargate tasks receive 20 GB of ephemeral storage by default. This can be expanded up to 200 GB by configuring the ephemeralStorage field in the task definition, though additional allocation incurs extra cost."
},
{
"answer": "20 GB default, expandable to 500 GB",
"isCorrect": false,
"explanation": "While the default is correctly 20 GB, the maximum ephemeral storage for Fargate is 200 GB, not 500 GB."
},
{
"answer": "30 GB default, expandable to 200 GB",
"isCorrect": false,
"explanation": "The default ephemeral storage is 20 GB, not 30 GB."
}
]
},
{
"question": "A developer is configuring IAM roles for a Fargate task that needs to pull images from ECR, write logs to CloudWatch, and read objects from S3. How should the IAM roles be structured?",
"answers": [
{
"answer": "Use a single IAM role with all permissions (ECR, CloudWatch, S3) attached to the task",
"isCorrect": false,
"explanation": "Combining all permissions into one role violates the principle of least privilege and blurs the boundary between infrastructure-level and application-level permissions."
},
{
"answer": "Use a Task Execution Role for ECR and CloudWatch permissions, and a Task Role for S3 permissions",
"isCorrect": true,
"explanation": "The Task Execution Role is used by Fargate itself to pull images and push logs (ECR, CloudWatch). The Task Role grants the application code permissions to call AWS services like S3. Keeping these separate follows least-privilege best practices."
},
{
"answer": "Use a Task Role for ECR and CloudWatch permissions, and a Task Execution Role for S3 permissions",
"isCorrect": false,
"explanation": "This reverses the correct assignment. The Task Execution Role handles infrastructure-level operations (ECR, CloudWatch), while the Task Role is for application-level AWS API calls (like S3)."
},
{
"answer": "Attach an instance profile to the Fargate task for all permissions",
"isCorrect": false,
"explanation": "Instance profiles are for EC2 instances, not Fargate. Fargate uses Task Execution Roles and Task Roles for IAM permissions."
}
]
},
{
"question": "Which of the following workloads are well-suited for Fargate Spot? (Select TWO)",
"answers": [
{
"answer": "A long-running financial transaction processing service",
"isCorrect": false,
"explanation": "Fargate Spot tasks can be interrupted with only a 2-minute warning. Long-running transactions that cannot be gracefully interrupted are not suitable for Fargate Spot."
},
{
"answer": "A nightly batch job that processes log files and can restart if interrupted",
"isCorrect": true,
"explanation": "Batch jobs that tolerate interruption and can restart are a perfect fit for Fargate Spot, which offers up to 70% cost savings over standard Fargate pricing."
},
{
"answer": "A stateful database container requiring persistent connections",
"isCorrect": false,
"explanation": "Stateful workloads with persistent connections cannot tolerate abrupt termination. Fargate Spot's interruption model makes it inappropriate for such use cases."
},
{
"answer": "A CI/CD pipeline worker running automated test suites",
"isCorrect": true,
"explanation": "CI/CD pipeline workers are a recommended use case for Fargate Spot. They are typically short-lived, interruptible, and can be retried if the task is reclaimed."
}
]
},
{
"question": "How much advance warning does AWS provide before terminating a Fargate Spot task due to capacity reclamation?",
"answers": [
{
"answer": "30 seconds",
"isCorrect": false,
"explanation": "30 seconds is not the correct interruption notice period for Fargate Spot tasks."
},
{
"answer": "2 minutes",
"isCorrect": true,
"explanation": "AWS provides a 2-minute warning before reclaiming Fargate Spot capacity. Applications must be designed to handle graceful shutdown within this window."
},
{
"answer": "5 minutes",
"isCorrect": false,
"explanation": "The interruption notice for Fargate Spot is 2 minutes, not 5 minutes."
},
{
"answer": "15 minutes",
"isCorrect": false,
"explanation": "15 minutes is the interruption notice for EC2 Spot Instances, not Fargate Spot tasks."
}
]
},
{
"question": "A team wants to run a cost-optimized ECS service that maintains a reliable baseline but can scale cheaply during burst periods. Which approach best achieves this?",
"answers": [
{
"answer": "Run all tasks on Fargate Spot only",
"isCorrect": false,
"explanation": "Using only Fargate Spot means the entire service is at risk of interruption, which is not suitable for maintaining a reliable baseline."
},
{
"answer": "Use Capacity Providers with a base on standard Fargate and burst on Fargate Spot",
"isCorrect": true,
"explanation": "This is the recommended pattern: Capacity Providers allow you to define a base count on standard Fargate for reliability, then burst additional tasks on Fargate Spot for cost savings — combining stability with efficiency."
},
{
"answer": "Use EC2 launch type with Reserved Instances for baseline and Spot Instances for burst",
"isCorrect": false,
"explanation": "While this is a valid EC2-based pattern, the question context implies a Fargate-based solution. This approach also reintroduces infrastructure management overhead."
},
{
"answer": "Use Fargate Spot for the baseline and standard Fargate for burst tasks",
"isCorrect": false,
"explanation": "Using Fargate Spot for the baseline undermines reliability since those tasks can be interrupted. The stable baseline should run on standard Fargate."
}
]
},
{
"question": "A developer needs to run a containerized workload on Kubernetes using AWS Fargate as the compute layer. Which feature enables this?",
"answers": [
{
"answer": "ECS Task Definitions with requiresCompatibilities set to FARGATE",
"isCorrect": false,
"explanation": "This configuration is specific to ECS on Fargate, not EKS. It does not apply to Kubernetes workloads."
},
{
"answer": "Fargate Profiles in EKS",
"isCorrect": true,
"explanation": "Fargate Profiles in EKS define which Kubernetes pods (selected by namespace and label selectors) should run on Fargate compute. This allows Kubernetes workloads to run serverlessly without managing EC2 nodes."
},
{
"answer": "EKS Managed Node Groups with Fargate AMIs",
"isCorrect": false,
"explanation": "Managed Node Groups use EC2 instances, not Fargate. There is no Fargate-specific AMI for node groups — Fargate integration uses Fargate Profiles instead."
},
{
"answer": "EKS Anywhere with Fargate capacity providers",
"isCorrect": false,
"explanation": "EKS Anywhere runs on-premises and does not integrate with Fargate capacity providers. Fargate Profiles are the correct EKS Fargate integration mechanism."
}
]
},
{
"question": "Which of the following statements correctly describes a key security advantage of AWS Fargate over the EC2 launch type?",
"answers": [
{
"answer": "Fargate tasks share a kernel with other tasks from the same AWS account, reducing overhead",
"isCorrect": false,
"explanation": "This is incorrect. Fargate tasks run in their own dedicated kernel runtime boundary — they do NOT share the underlying host OS kernel with any other tasks, even within the same account."
},
{
"answer": "Each Fargate task runs in its own dedicated kernel runtime boundary, eliminating shared host OS risk",
"isCorrect": true,
"explanation": "Unlike EC2-based containers that may share a host OS kernel, each Fargate task runs in an isolated runtime boundary. This eliminates risks such as container escape attacks between tenants and removes the need for the customer to manage kernel patching."
},
{
"answer": "Fargate automatically encrypts all inter-task network traffic within the same VPC",
"isCorrect": false,
"explanation": "Fargate's awsvpc mode provides network isolation via ENIs and security groups, but it does not automatically encrypt all inter-task traffic. This is not stated as a built-in Fargate security feature."
},
{
"answer": "Fargate grants customers root access to the underlying host for compliance auditing",
"isCorrect": false,
"explanation": "Fargate is fully managed — customers have no access to the underlying host. This is by design and is actually a security benefit, not a limitation."
}
]
},
{
"question": "A developer configuring a Fargate task definition for ECS must set which field to indicate Fargate compatibility?",
"answers": [
{
"answer": "launchType: FARGATE",
"isCorrect": false,
"explanation": "launchType is specified at the ECS Service or RunTask level, not in the task definition itself. The task definition uses requiresCompatibilities."
},
{
"answer": "requiresCompatibilities: FARGATE",
"isCorrect": true,
"explanation": "Setting requiresCompatibilities to FARGATE in the task definition tells ECS that this task is designed to run on Fargate. Combined with networkMode: awsvpc, this is the required configuration."
},
{
"answer": "executionMode: FARGATE",
"isCorrect": false,
"explanation": "executionMode is not a valid ECS task definition field. The correct field is requiresCompatibilities."
},
{
"answer": "capacityProvider: FARGATE",
"isCorrect": false,
"explanation": "Capacity providers are configured at the ECS cluster or service level, not as a field within the task definition to declare Fargate compatibility."
}
]
},
{
"question": "A Fargate task needs to access an Amazon EFS file system. The task's security group is sg-task and the EFS mount target's security group is sg-efs. What inbound rule must be configured on sg-efs?",
"answers": [
{
"answer": "Allow inbound TCP port 443 from sg-task",
"isCorrect": false,
"explanation": "Port 443 is used for HTTPS. EFS uses the NFS protocol on port 2049, not port 443."
},
{
"answer": "Allow inbound TCP port 2049 from sg-task",
"isCorrect": true,
"explanation": "EFS uses the NFS protocol on port 2049. The EFS mount target's security group must allow inbound NFS traffic (TCP 2049) from the Fargate task's security group to enable mounting."
},
{
"answer": "Allow inbound TCP port 22 from sg-task",
"isCorrect": false,
"explanation": "Port 22 is used for SSH. EFS mounts use NFS on port 2049."
},
{
"answer": "Allow inbound UDP port 2049 from sg-task",
"isCorrect": false,
"explanation": "While NFS historically used UDP, EFS requires TCP port 2049, not UDP."
}
]
},
{
"question": "Which of the following are true about networking in AWS Fargate? (Select TWO)",
"answers": [
{
"answer": "Security groups can be applied directly to each Fargate task",
"isCorrect": true,
"explanation": "Because each Fargate task gets its own ENI via awsvpc mode, security groups can be applied directly at the task level — providing fine-grained network isolation without relying on host-level rules."
},
{
"answer": "Multiple Fargate tasks can share a single ENI to reduce costs",
"isCorrect": false,
"explanation": "Each Fargate task receives its own dedicated ENI. There is no sharing of ENIs between tasks, which means ENI limits per subnet can become a concern at scale."
},
{
"answer": "Fargate tasks in private subnets can reach the internet through a NAT Gateway",
"isCorrect": true,
"explanation": "Fargate tasks follow standard VPC routing rules. Tasks in private subnets can reach the internet (e.g., to pull ECR images or call external APIs) by routing through a NAT Gateway."
},
{
"answer": "Fargate supports both awsvpc and bridge networking modes",
"isCorrect": false,
"explanation": "Fargate exclusively supports awsvpc networking mode. Bridge mode is only available for EC2 launch type tasks."
}
]
},
{
"question": "A company running steady, high-throughput container workloads 24/7 wants to minimize cost. They are comfortable managing underlying infrastructure. Which ECS configuration is most cost-effective?",
"answers": [
{
"answer": "Fargate with standard pricing",
"isCorrect": false,
"explanation": "Fargate's per-task billing model can be more expensive for dense, steady workloads where EC2 instances can be efficiently bin-packed with many containers."
},
{
"answer": "EC2 launch type with bin-packing",
"isCorrect": true,
"explanation": "For high-density, steady workloads where the team is comfortable managing EC2 instances, EC2 launch type is typically more cost-efficient. Bin-packing multiple tasks onto EC2 instances maximizes resource utilization and reduces per-unit cost."
},
{
"answer": "Fargate Spot for all tasks",
"isCorrect": false,
"explanation": "Fargate Spot introduces interruption risk, making it unsuitable as the sole compute layer for steady, critical workloads — even though it reduces cost."
},
{
"answer": "EKS on Fargate with Fargate Profiles",
"isCorrect": false,
"explanation": "EKS on Fargate still uses Fargate's per-task billing model, which is not optimized for dense, 24/7 workloads compared to EC2 with bin-packing."
}
]
}
]
{{< /qcm >}}