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

{{< qcm >}}
[
{
"question": "A developer is configuring an ECS task definition and needs the container to read objects from S3 and write logs to CloudWatch. Which IAM roles should be configured, and for what purpose?",
"answers": [
{
"answer": "Task Execution Role for pulling the image from ECR and writing logs to CloudWatch; Task Role for accessing S3.",
"isCorrect": true,
"explanation": "The Task Execution Role is used by the ECS infrastructure to pull container images and send logs to CloudWatch. The Task Role is used by the application code inside the container to access AWS services like S3."
},
{
"answer": "Task Role for pulling the image from ECR and writing logs to CloudWatch; Task Execution Role for accessing S3.",
"isCorrect": false,
"explanation": "This is reversed. The Task Execution Role handles infrastructure-level actions (image pull, log shipping), while the Task Role grants permissions to the running application code."
},
{
"answer": "A single IAM role attached to the task is sufficient for both infrastructure and application permissions.",
"isCorrect": false,
"explanation": "ECS distinguishes between two separate roles: the Task Execution Role (used by ECS/Fargate infrastructure) and the Task Role (used by the container application). They serve different purposes and must be configured separately."
},
{
"answer": "Task Execution Role for accessing S3; Task Role for pulling the image and writing logs.",
"isCorrect": false,
"explanation": "Incorrect. The Task Execution Role is scoped to ECS infrastructure operations (ECR pull, CloudWatch Logs). S3 access belongs in the Task Role, which governs what the container application can do."
}
]
},
{
"question": "A team is running an ECS service on the EC2 launch type. Multiple tasks run on the same instance, all listening on port 8080 inside the container. What feature allows this to work without port conflicts on the host?",
"answers": [
{
"answer": "Dynamic port mapping, by setting the host port to 0 in the task definition.",
"isCorrect": true,
"explanation": "Setting the host port to 0 tells ECS to assign a random ephemeral port at runtime. The ALB target group learns the correct host:port mapping automatically, avoiding conflicts when multiple tasks run on the same instance."
},
{
"answer": "The awsvpc networking mode, which gives each task its own ENI.",
"isCorrect": false,
"explanation": "While awsvpc solves port conflicts by assigning each task its own IP, dynamic port mapping is the specific EC2 bridge-mode feature described. awsvpc makes dynamic port mapping unnecessary, not the mechanism that enables it."
},
{
"answer": "The host networking mode, which bypasses Docker networking.",
"isCorrect": false,
"explanation": "Host networking mode actually makes port conflicts worse — two containers on the same host cannot both listen on port 8080 because they share the host's network interface directly."
},
{
"answer": "An Application Load Balancer that reassigns ports automatically.",
"isCorrect": false,
"explanation": "The ALB participates in routing after ECS assigns ephemeral ports, but it does not assign or manage host ports. Dynamic port mapping in the task definition is what enables this."
}
]
},
{
"question": "Which networking mode is required when running ECS tasks on AWS Fargate?",
"answers": [
{
"answer": "awsvpc",
"isCorrect": true,
"explanation": "Fargate only supports the awsvpc networking mode. Each task gets its own ENI with a private IP address in the VPC, enabling VPC-level features like security groups and direct addressability."
},
{
"answer": "bridge",
"isCorrect": false,
"explanation": "Bridge mode is the default for EC2 launch type only. It is not supported on Fargate."
},
{
"answer": "host",
"isCorrect": false,
"explanation": "Host mode is available only for EC2 launch type, where the container shares the host's network interface. It is not available on Fargate."
},
{
"answer": "none",
"isCorrect": false,
"explanation": "'none' disables external networking entirely and is not the required mode for Fargate. Fargate mandates awsvpc."
}
]
},
{
"question": "An ECS Service is configured with a desired count of 4 tasks, minimumHealthyPercent of 50, and maximumPercent of 200. During a rolling deployment, what is the maximum number of tasks that can be running simultaneously?",
"answers": [
{
"answer": "8",
"isCorrect": true,
"explanation": "maximumPercent of 200 means ECS can run up to 200% of the desired count simultaneously. With a desired count of 4, that is 4 × 2 = 8 tasks at peak during the deployment."
},
{
"answer": "4",
"isCorrect": false,
"explanation": "4 is the desired count, not the maximum allowed during a deployment. The maximumPercent parameter allows ECS to temporarily exceed the desired count while replacing tasks."
},
{
"answer": "6",
"isCorrect": false,
"explanation": "6 would correspond to a maximumPercent of 150. With maximumPercent set to 200 and a desired count of 4, the ceiling is 8 tasks."
},
{
"answer": "2",
"isCorrect": false,
"explanation": "2 corresponds to the minimumHealthyPercent floor (50% of 4), not the maximum. The minimumHealthyPercent defines how low the running count can drop, not how high it can rise."
}
]
},
{
"question": "A company wants to run a nightly data processing job using ECS without keeping a task permanently running. What is the recommended AWS architecture for this use case?",
"answers": [
{
"answer": "Create an EventBridge rule with a cron schedule that targets an ECS task.",
"isCorrect": true,
"explanation": "EventBridge rules can trigger ECS tasks on a schedule or in response to events. This is the standard pattern for event-driven or scheduled batch workloads — the task runs on demand and stops when done, avoiding the cost of a permanently running service."
},
{
"answer": "Create an ECS Service with a desired count of 1 and configure it to stop after execution.",
"isCorrect": false,
"explanation": "ECS Services are designed for long-running workloads and will restart tasks that stop. They are not suited for scheduled one-off jobs; EventBridge triggering a standalone task is the correct approach."
},
{
"answer": "Use an Auto Scaling Group to launch EC2 instances on a schedule, then run the container.",
"isCorrect": false,
"explanation": "While technically possible, this approach is operationally complex and unnecessary. EventBridge + ECS task (especially with Fargate) is the managed, purpose-built solution for scheduled container workloads."
},
{
"answer": "Use AWS Lambda to trigger an ECS Service update every night.",
"isCorrect": false,
"explanation": "Updating a Service is not the same as triggering a one-off task. For scheduled batch jobs, the correct pattern is an EventBridge rule targeting an ECS task directly, not a Lambda manipulating a Service."
}
]
},
{
"question": "What is the difference between an ECS Task and an ECS Service?",
"answers": [
{
"answer": "A Task is a running instance of a task definition that is ephemeral; a Service is a controller that keeps a desired number of tasks continuously running and replaces failed ones.",
"isCorrect": true,
"explanation": "Tasks are ephemeral — they run and stop. A Service wraps tasks with lifecycle management: it maintains the desired count, replaces crashed tasks, integrates with load balancers, and manages rolling deployments."
},
{
"answer": "A Task defines container configuration; a Service is a running instance of that definition.",
"isCorrect": false,
"explanation": "This confuses the Task Definition (the blueprint/JSON document) with the Task (the running instance). A Service is not a running instance — it is a long-running controller managing multiple task instances."
},
{
"answer": "A Service runs on Fargate; a Task runs on EC2.",
"isCorrect": false,
"explanation": "Both Tasks and Services can run on either EC2 or Fargate launch types. The launch type is orthogonal to the Task vs. Service distinction."
},
{
"answer": "A Task can contain multiple containers; a Service can only manage single-container tasks.",
"isCorrect": false,
"explanation": "An ECS Service can manage tasks that contain multiple containers. There is no such constraint. The key distinction is lifecycle management, not container count."
}
]
},
{
"question": "A developer sets up an ECS cluster on the EC2 launch type. After launching new EC2 instances, the tasks are not being scheduled on them. What is the most likely cause?",
"answers": [
{
"answer": "The ECS agent is not running on the EC2 instances, so they are not registered with the cluster.",
"isCorrect": true,
"explanation": "On the EC2 launch type, the ECS agent must run on each instance to register it with the cluster. Without it, ECS has no visibility into the instance and will not schedule tasks on it."
},
{
"answer": "The task definition does not specify an AMI for the EC2 instances.",
"isCorrect": false,
"explanation": "Task definitions do not specify AMIs. The AMI is chosen when provisioning the EC2 instances themselves. The task definition describes the container, not the host."
},
{
"answer": "The ECS Service desired count is set to 0.",
"isCorrect": false,
"explanation": "A desired count of 0 would cause no tasks to run, but the question describes instances not being used for scheduling — the root cause is the missing ECS agent registration, not the desired count."
},
{
"answer": "Fargate does not support EC2 instances in the same cluster.",
"isCorrect": false,
"explanation": "This is about the EC2 launch type, not Fargate. The issue is that EC2 instances must have the ECS agent running to join the cluster — Fargate is irrelevant here."
}
]
},
{
"question": "An ECS Service needs to scale automatically based on the number of requests per target coming from an ALB. Which ECS auto scaling policy type is best suited for this?",
"answers": [
{
"answer": "Target Tracking, using the RequestCountPerTarget metric.",
"isCorrect": true,
"explanation": "Target Tracking is the recommended default for ECS auto scaling. It allows you to set a desired value for a metric like RequestCountPerTarget from an ALB, and ECS automatically adjusts the task count to maintain that target."
},
{
"answer": "Step Scaling, with CloudWatch alarms on ALB request count.",
"isCorrect": false,
"explanation": "Step Scaling works but requires more manual configuration — you must define alarm thresholds and explicit scaling actions. Target Tracking is simpler and recommended unless you need granular step-based control."
},
{
"answer": "Scheduled Scaling, based on time-of-day patterns.",
"isCorrect": false,
"explanation": "Scheduled Scaling adjusts capacity at predetermined times. It does not react to real-time metrics like request count per target and is therefore not appropriate for demand-based scaling."
},
{
"answer": "ECS Cluster Auto Scaling, using a Capacity Provider.",
"isCorrect": false,
"explanation": "ECS Cluster Auto Scaling scales the underlying EC2 infrastructure (the number of instances), not the number of tasks in a Service. Task-level scaling is handled by Application Auto Scaling policies like Target Tracking."
}
]
},
{
"question": "Which of the following are valid responsibilities of the ECS Task Execution Role? (Select TWO)",
"answers": [
{
"answer": "Pulling the container image from Amazon ECR.",
"isCorrect": true,
"explanation": "The Task Execution Role grants ECS (or Fargate) the permission to pull container images from ECR before the container starts running."
},
{
"answer": "Sending container logs to Amazon CloudWatch Logs.",
"isCorrect": true,
"explanation": "The Task Execution Role also grants the ECS infrastructure the ability to publish container logs to CloudWatch Logs via the awslogs log driver."
},
{
"answer": "Reading objects from Amazon S3 inside the container.",
"isCorrect": false,
"explanation": "S3 access by the application code is governed by the Task Role, not the Task Execution Role. The Task Execution Role is strictly for ECS infrastructure operations."
},
{
"answer": "Writing items to a DynamoDB table from the application.",
"isCorrect": false,
"explanation": "Application-level AWS API calls like DynamoDB writes are authorized through the Task Role. The Task Execution Role does not control what the application code inside the container can do."
},
{
"answer": "Registering the task with the ECS Service's load balancer target group.",
"isCorrect": false,
"explanation": "Load balancer target group registration is handled by the ECS Service control plane, not the Task Execution Role. The execution role is focused on image pull and log delivery."
}
]
},
{
"question": "A developer wants to deploy a new version of an ECS Service with zero downtime and the ability to instantly roll back if issues are detected. Which deployment strategy should they use?",
"answers": [
{
"answer": "Blue/Green deployment via AWS CodeDeploy.",
"isCorrect": true,
"explanation": "Blue/Green deployment provisions a complete new set of tasks (green) alongside the existing ones (blue), shifts traffic progressively, and only terminates the old set after validation. Rollback is immediate since the blue environment remains available during the cutover."
},
{
"answer": "Rolling update with minimumHealthyPercent set to 100.",
"isCorrect": false,
"explanation": "Rolling updates replace tasks gradually. While setting minimumHealthyPercent to 100 prevents downtime, rolling updates do not maintain a full parallel environment for instant rollback the way Blue/Green does."
},
{
"answer": "Scheduled scaling to launch new tasks before the deployment.",
"isCorrect": false,
"explanation": "Scheduled scaling adjusts task count at predefined times. It is not a deployment strategy and does not provide traffic shifting or rollback capabilities."
},
{
"answer": "Recreate deployment, which terminates all old tasks before starting new ones.",
"isCorrect": false,
"explanation": "A Recreate strategy causes downtime by stopping all old tasks before new ones start. This is the opposite of what is needed for zero-downtime deployments."
}
]
},
{
"question": "A task definition uses the awsvpc networking mode on EC2 instances. A developer notices that fewer tasks than expected can run per instance. What is the most likely constraint?",
"answers": [
{
"answer": "Each awsvpc task requires its own ENI, and EC2 instances have a limited number of ENIs.",
"isCorrect": true,
"explanation": "In awsvpc mode, each task gets its own Elastic Network Interface. EC2 instance types have a fixed ENI limit, which directly caps how many awsvpc tasks can be placed on a single instance."
},
{
"answer": "The ECS agent can only manage a fixed number of tasks per instance regardless of resources.",
"isCorrect": false,
"explanation": "The ECS agent does not impose an arbitrary task count cap. The practical limit in awsvpc mode comes from the ENI limit of the underlying EC2 instance type."
},
{
"answer": "Dynamic port mapping exhausts the ephemeral port range on the instance.",
"isCorrect": false,
"explanation": "Dynamic port mapping is relevant to bridge mode, not awsvpc. In awsvpc mode, each task has its own IP and ENI, making host port exhaustion a non-issue."
},
{
"answer": "Fargate imposes a per-cluster task limit that also applies to EC2 clusters.",
"isCorrect": false,
"explanation": "Fargate limits are separate from EC2 cluster constraints. The ENI-per-instance limit is an EC2 infrastructure constraint, not a Fargate policy."
}
]
},
{
"question": "A company is migrating a containerized GPU workload to AWS. They need full control over the underlying host configuration. Which ECS launch type should they choose?",
"answers": [
{
"answer": "EC2 launch type.",
"isCorrect": true,
"explanation": "The EC2 launch type gives full control over the underlying host: instance type selection (including GPU instances like p3 or g4), custom AMIs, and storage configuration. Fargate does not expose host-level control."
},
{
"answer": "Fargate launch type.",
"isCorrect": false,
"explanation": "Fargate abstracts away the underlying host entirely. You cannot select instance types, use GPU instances, or customize AMIs on Fargate — making it unsuitable for this GPU workload requirement."
},
{
"answer": "Either launch type, since ECS manages host configuration automatically.",
"isCorrect": false,
"explanation": "ECS does not manage host configuration on the EC2 launch type — that is the developer's responsibility and also the reason to choose it. Fargate manages the host, but without user control."
},
{
"answer": "Fargate launch type with a custom AMI specified in the task definition.",
"isCorrect": false,
"explanation": "Task definitions do not accept AMI configurations, and Fargate does not allow custom AMIs. AMI selection is an EC2 launch type concern."
}
]
},
{
"question": "What is the purpose of the ECS Task Definition?",
"answers": [
{
"answer": "It is a JSON blueprint that describes how a container should run, including the Docker image, CPU/memory, environment variables, IAM roles, networking mode, and volumes.",
"isCorrect": true,
"explanation": "The task definition is the configuration document that codifies everything ECS needs to launch a container — equivalent to a docker run command captured in JSON. It is referenced by both Tasks and Services."
},
{
"answer": "It defines the number of tasks an ECS Service should keep running.",
"isCorrect": false,
"explanation": "The desired task count is configured on the ECS Service, not the task definition. The task definition describes how to run a container, not how many to run."
},
{
"answer": "It specifies the EC2 instances that form the ECS cluster.",
"isCorrect": false,
"explanation": "EC2 instances are associated with a cluster through the ECS agent, not the task definition. The task definition is container-level configuration, not infrastructure configuration."
},
{
"answer": "It configures the Auto Scaling policies for the ECS Service.",
"isCorrect": false,
"explanation": "Auto Scaling policies are configured separately through Application Auto Scaling, not within the task definition."
}
]
},
{
"question": "An ECS cluster uses the EC2 launch type. As the number of tasks increases, new tasks fail to be placed because there is insufficient EC2 capacity. Which feature automates the scaling of the underlying EC2 infrastructure to accommodate new tasks?",
"answers": [
{
"answer": "ECS Cluster Auto Scaling using a Capacity Provider backed by an Auto Scaling Group.",
"isCorrect": true,
"explanation": "ECS Cluster Auto Scaling monitors cluster capacity and automatically adjusts the Auto Scaling Group backing the cluster when there is insufficient capacity to place new tasks, ensuring tasks are not left unscheduled."
},
{
"answer": "ECS Service Auto Scaling using Target Tracking.",
"isCorrect": false,
"explanation": "ECS Service Auto Scaling controls the number of tasks in a Service, not the underlying EC2 capacity. It can create more tasks but cannot provision EC2 instances to run them."
},
{
"answer": "EventBridge rules that launch EC2 instances when task placement fails.",
"isCorrect": false,
"explanation": "While EventBridge can trigger automation, it is not the built-in mechanism for EC2 cluster capacity scaling. ECS Cluster Auto Scaling with a Capacity Provider is the managed, purpose-built solution."
},
{
"answer": "Fargate Spot, which automatically adds capacity when EC2 instances are insufficient.",
"isCorrect": false,
"explanation": "Fargate Spot is a cost-saving option for Fargate tasks, not a mechanism to scale EC2 instances in an EC2 launch type cluster."
}
]
},
{
"question": "Which ECS networking mode provides the lowest network latency by bypassing Docker's virtual network, but prevents two containers on the same host from using the same port?",
"answers": [
{
"answer": "host",
"isCorrect": true,
"explanation": "In host mode, the container uses the EC2 instance's network interface directly, eliminating the overhead of Docker's virtual bridge. The trade-off is that all containers on the host share the same IP, so port conflicts are possible."
},
{
"answer": "bridge",
"isCorrect": false,
"explanation": "Bridge mode routes traffic through Docker's virtual bridge network, which introduces some overhead compared to host mode. It supports dynamic port mapping to avoid port conflicts."
},
{
"answer": "awsvpc",
"isCorrect": false,
"explanation": "awsvpc gives each task its own ENI and IP, which avoids port conflicts entirely. It does not bypass Docker networking in the way host mode does."
},
{
"answer": "none",
"isCorrect": false,
"explanation": "'none' disables all external network access for the container. It is not related to low-latency host networking."
}
]
}
]
{{< /qcm >}}