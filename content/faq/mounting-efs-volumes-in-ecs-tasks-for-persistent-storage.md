---
title: "Mounting EFS Volumes in ECS Tasks for Persistent Storage"
---

## Mounting EFS Volumes in ECS Tasks for Persistent Storage

Container orchestration makes deploying applications at scale remarkably straightforward, but it introduces a persistent challenge: stateless containers are ephemeral by nature. When an ECS task terminates, its local storage vanishes. For many real-world applications—machine learning pipelines that need shared model artifacts, content management systems that store user uploads, or stateful microservices that maintain application data—this transience becomes a serious problem.

This is where Amazon EFS (Elastic File System) enters the picture. EFS provides a managed, scalable NFS file system that persists independently of your container lifecycle. By mounting EFS volumes into your ECS tasks, you gain the ability to share data across multiple containers, preserve data through task restarts, and build applications that would otherwise require complex workarounds. Understanding how to properly configure and authorize this integration is essential for building production-grade containerized applications on AWS.

### Why EFS Matters for ECS Workloads

Before diving into the mechanics, it's worth understanding why EFS has become the go-to solution for persistent storage in ECS environments. The core issue is simple: ECS tasks run on EC2 instances or Fargate infrastructure, and their local storage is tied to the task's lifecycle. When the task stops, that storage is gone. For many applications, this design is perfectly fine—stateless web services, for instance, thrive on this model. But applications with stateful requirements face a choice: either redesign everything to be stateless (which isn't always practical), or integrate an external persistent storage layer.

EFS solves this elegantly. Unlike EBS volumes, which attach to a single EC2 instance and require manual management, EFS scales automatically, persists independently of any compute resource, and can be mounted by multiple EC2 instances or Fargate tasks simultaneously. This means you can have dozens of ECS tasks all reading from and writing to the same shared file system—without coordination headaches or manual provisioning.

Consider a practical scenario: you're running a batch processing pipeline that generates large ML models. With EFS, all your worker tasks can write their intermediate results to the shared file system. When a task crashes and gets rescheduled, the next task picks up where the previous one left off, reading the same data. Or imagine a content platform where users upload media files. Rather than storing these in a task's ephemeral storage (which would be lost on task restart), you mount EFS and persist all uploads there. Multiple tasks can serve the same content to different users, all accessing the same underlying file system.

### Understanding ECS Volume Configuration

To use EFS with ECS, you first need to understand how volumes work in ECS task definitions. A volume is a named storage resource that can be mounted at a path inside your container. In the task definition, you define the volume at the task level, then mount it inside one or more containers.

Here's what a basic task definition looks like with an EFS volume:

```json
{
  "family": "my-app",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "256",
  "memory": "512",
  "volumes": [
    {
      "name": "efs-storage",
      "efsVolumeConfiguration": {
        "fileSystemId": "fs-12345678",
        "transitEncryption": "ENABLED",
        "authorizationConfig": {
          "accessPointId": "fsap-87654321"
        }
      }
    }
  ],
  "containerDefinitions": [
    {
      "name": "my-container",
      "image": "my-app:latest",
      "mountPoints": [
        {
          "sourceVolume": "efs-storage",
          "containerPath": "/data"
        }
      ]
    }
  ]
}
```

Let's unpack what's happening here. In the `volumes` section, you're declaring a named volume called `efs-storage` and configuring it to use EFS. The `fileSystemId` is the ID of your EFS file system—you can find this in the AWS Console under the EFS service. The `containerPath` in the `mountPoints` section tells ECS where inside the container this volume should be accessible. In this example, anything written to `/data` inside the container actually gets persisted to EFS.

The `transitEncryption` setting encrypts data in transit between your ECS tasks and the EFS file system, which is a security best practice. The `authorizationConfig` with an `accessPointId` is where access control comes in—more on that shortly.

One important note: ECS volumes can reference different storage types, not just EFS. You might also use Docker volumes, bind mounts to the host, or FSx for Windows File Server. But for Linux-based ECS tasks that need shared, scalable persistent storage, EFS is the natural choice.

### Configuring Security Groups and Network Access

EFS communicates over the NFS protocol, and like any network service on AWS, it requires proper security group configuration. This is a detail that trips up many developers: you can have everything else configured perfectly, but if your security groups aren't right, your ECS tasks won't be able to reach EFS.

Here's what you need to understand: EFS sits inside your VPC and listens on port 2049 for NFS traffic. Your ECS tasks (whether running on EC2 or Fargate) need network-level permission to reach that port. This is governed by security groups.

Typically, you'll have at least two security groups in play: one for your ECS tasks and one for your EFS mount targets. The EFS mount target is the network interface that makes the file system accessible—it lives in a subnet and is fronted by a security group.

Here's the key rule: the EFS security group must allow inbound traffic on port 2049 (NFS) from the ECS task's security group. In AWS CLI terms, it looks something like this:

```bash
aws ec2 authorize-security-group-ingress \
  --group-id sg-efs12345 \
  --protocol tcp \
  --port 2049 \
  --source-security-group-id sg-ecs-tasks-67890
```

This says: "Allow TCP traffic on port 2049 to the EFS security group, coming from the ECS task security group." Without this rule, your tasks will time out when trying to mount EFS.

If you're running ECS on EC2, you'll also need to ensure that the EC2 instances' security group allows outbound traffic on port 2049 to the EFS security group. Fargate handles some of this automatically with its managed infrastructure, but the principle remains: there must be an open network path from your compute resource to the EFS mount target.

A common gotcha: people forget to add these rules and then spend hours debugging "connection timed out" errors in their task logs. If your ECS tasks can't mount EFS, check security groups first.

### IAM Authorization and EFS Access Points

Security at the network level is just the beginning. AWS also provides identity-based authorization for EFS through IAM policies and a feature called access points. This adds a second layer of control: even if a task has network access to EFS, it still needs the right IAM permissions to read and write files.

EFS access points are a particularly elegant solution. Rather than having every task directly access the root of the file system, an access point provides a scoped entry point with enforced user identity and permissions. Think of it as a gateway that ensures tasks operate within defined boundaries.

Here's why this matters: without access points, multiple tasks might inadvertently interfere with each other's files, or a misconfigured task could overwrite critical shared data. Access points let you enforce a consistent user ID (UID/GID), set a root directory for the task, and apply Unix-style permissions.

To use an access point, you first create it on the EFS file system:

```bash
aws efs create-access-point \
  --file-system-id fs-12345678 \
  --posix-user Uid=1000,Gid=1000 \
  --root-directory Path="/app-data",CreationInfo={OwnerUid=1000,OwnerGid=1000,Permissions=755}
```

This creates an access point that enforces UID 1000 and GID 1000 (the POSIX user identity inside the container), and provides `/app-data` as the root directory. When your task mounts EFS through this access point, files are created with these ownership and permissions characteristics automatically.

On the IAM side, your ECS task needs an execution role with permissions to use the access point. Here's a minimal policy:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "elasticfilesystem:ClientMount",
        "elasticfilesystem:ClientWrite",
        "elasticfilesystem:ClientRootAccess"
      ],
      "Resource": "arn:aws:elasticfilesystem:us-east-1:123456789012:access-point/fsap-87654321"
    }
  ]
}
```

The three actions here correspond to mounting the file system, writing to it, and accessing it as root (if needed). By scoping these permissions to a specific access point rather than the entire file system, you implement the principle of least privilege. A compromised task can only access what it's been explicitly authorized to use.

### Fargate vs. EC2: Considerations and Trade-offs

The mechanics of mounting EFS differ slightly depending on whether you're running ECS on AWS Fargate (serverless containers) or EC2 instances. Understanding these differences helps you make better architectural decisions.

With Fargate, AWS handles the underlying infrastructure. Your task definition simply specifies the EFS file system and access point, and Fargate orchestrates the mount. This is the simpler path: you don't manage EC2 instances, availability, or networking infrastructure directly. Fargate handles security group association and network connectivity behind the scenes. The downside is less flexibility and potentially higher costs for certain workload profiles, plus Fargate has a performance ceiling for resource-intensive tasks.

With EC2, you have more control but more responsibility. Your ECS tasks run on EC2 instances that you've launched into your VPC. Those instances must be in the same VPC and have network access to your EFS file system. You configure the EC2 security group to allow outbound NFS traffic, and the EFS security group to allow inbound traffic from the EC2 security group. ECS's container agent handles the actual mount operation, but the groundwork falls to you.

A practical consideration: if you're running a large number of tasks on a single EC2 instance, EFS provides shared storage without duplicating data per task. This is more efficient than having each task write to its own EBS volume or ephemeral storage. With Fargate, each task is more isolated, but EFS still provides the same benefit of persistence and shareability across task restarts.

Another nuance: EFS pricing is based on storage consumed and provisioned throughput. If you have many concurrent Fargate tasks accessing the same EFS volume, ensure your throughput provisioning is adequate. EC2-based deployments might achieve better cost efficiency if you're doing heavy I/O on fewer, larger instances.

### Real-World Use Cases

To ground these concepts, let's explore a few scenarios where EFS integration transforms ECS applications.

Machine learning workflows often involve training models on large datasets and then serving those models. With EFS, your training job tasks can write the trained model to a shared location. Your inference tasks then mount that same EFS volume and load the model at startup. When a new model is trained, inference tasks automatically see the updated model without requiring redeployment. The alternative—baking models into Docker images or storing them in S3 and downloading on every task start—becomes unnecessary.

A second scenario is content management platforms. User uploads typically get stored in S3, but temporary processing files, caches, and working directories can live on EFS. Multiple API server tasks mount the same EFS volume, so a user's upload persists regardless of which task handles subsequent requests. This beats distributing files across multiple tasks or storing everything in an expensive database.

A third example: stateful batch processing. Imagine a job that runs across multiple ECS tasks, each processing a chunk of data. With EFS, all tasks can coordinate through a shared working directory, writing intermediate results that other tasks consume. One task crashes? It resumes from where it left off because the EFS data persists.

### Implementation Walkthrough

Let's walk through a concrete example from start to finish. Assume you have an ECS cluster running on Fargate, and you want to add persistent storage for a data processing application.

First, create an EFS file system in your VPC:

```bash
aws efs create-file-system \
  --performance-mode generalPurpose \
  --throughput-mode bursting \
  --encrypted \
  --region us-east-1
```

Note the file system ID returned (something like `fs-12345678`).

Next, create mount targets in your subnets so the file system is accessible:

```bash
aws efs create-mount-target \
  --file-system-id fs-12345678 \
  --subnet-id subnet-abc123 \
  --security-groups sg-efs12345
```

Repeat for each subnet where your tasks might run.

Create an access point:

```bash
aws efs create-access-point \
  --file-system-id fs-12345678 \
  --posix-user Uid=1000,Gid=1000 \
  --root-directory Path="/processing",CreationInfo={OwnerUid=1000,OwnerGid=1000,Permissions=755}
```

Configure your ECS task execution role with the IAM policy shown earlier, scoped to this access point.

In your task definition, add the EFS volume configuration and mount point:

```json
{
  "family": "data-processor",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "512",
  "memory": "1024",
  "executionRoleArn": "arn:aws:iam::123456789012:role/ecsTaskExecutionRole",
  "volumes": [
    {
      "name": "processing-storage",
      "efsVolumeConfiguration": {
        "fileSystemId": "fs-12345678",
        "transitEncryption": "ENABLED",
        "authorizationConfig": {
          "accessPointId": "fsap-87654321"
        }
      }
    }
  ],
  "containerDefinitions": [
    {
      "name": "processor",
      "image": "my-processor:latest",
      "memory": 1024,
      "mountPoints": [
        {
          "sourceVolume": "processing-storage",
          "containerPath": "/data"
        }
      ],
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "/ecs/data-processor",
          "awslogs-region": "us-east-1",
          "awslogs-stream-prefix": "ecs"
        }
      }
    }
  ]
}
```

Ensure your ECS task's security group can reach the EFS security group on port 2049 (as covered earlier). Launch a task with this definition, and inside the container, `/data` is your persistent EFS mount.

### Common Pitfalls and Troubleshooting

Even with a solid understanding, things can go wrong. Here are the most common issues and how to diagnose them.

**Mount timeouts**: Your task logs show something like "NFS mount timed out." First check: security groups. Verify that the EFS security group allows inbound NFS (port 2049) from your task's security group. Use the EC2 Console to double-check the rules. Second check: network connectivity. For Fargate, ensure your task's subnet has a route to your EFS mount target. For EC2, ensure the instance security group allows outbound NFS traffic.

**Permission denied errors**: Your task mounts EFS successfully but can't write files. This usually means a mismatch between the task's user ID and the access point's enforced UID. By default, containers often run as root (UID 0), but if your access point enforces a different UID, writes fail. Solution: either adjust your container to run as the appropriate user, or reconfigure the access point to match your application's requirements.

**Access point not found**: Your task definition references an access point ID that doesn't exist or is in a different region. Double-check the access point ID and ensure it belongs to the same EFS file system. This is particularly easy to mess up when copying task definitions across environments.

**High latency**: If your application experiences unexpectedly slow file operations, you might be bumping against EFS throughput limits or experiencing network congestion. Monitor CloudWatch metrics for EFS (particularly `MeteredIOOperations` and `BurstCreditBalance`) to see if you're exceeding your provisioned throughput. Consider switching to provisioned throughput mode if bursting isn't sufficient.

### Performance and Cost Considerations

EFS is powerful, but it's not free, and performance characteristics matter. Understanding the trade-offs helps you design cost-effective systems.

EFS pricing has two main components: storage consumed (per GB per month) and, optionally, provisioned throughput. The bursting throughput mode is simpler and works well for variable workloads—you get baseline throughput tied to your file system size, plus burst capacity. The provisioned throughput mode lets you pay for a specific throughput level regardless of storage size, which is better for consistently high-performance workloads.

For most containerized workloads, bursting is sufficient. Your initial throughput scales with storage, so a larger file system gets more baseline throughput. If your workload is bursty (short periods of intense I/O followed by idle time), this model is cost-effective. But if you need sustained high throughput (say, a streaming analytics pipeline processing gigabytes of data per minute), provisioned throughput might actually be cheaper.

From a performance standpoint, EFS is network-attached storage. It won't match the raw throughput of local NVMe storage or even EBS GP3 volumes for intensive workloads. However, for typical application patterns—reading configuration files, storing logs, persisting user data—it's perfectly adequate. The key is understanding your workload's I/O patterns and testing under realistic conditions.

One final consideration: if you're storing large amounts of data, consider whether S3 might be a better fit for certain use cases. S3 is cheaper for long-term storage and integrates well with ECS through standard AWS SDKs. EFS is better for shared access patterns and situations where you need file system semantics (traditional file operations, directory structures, permissions). Think of EFS as your shared working space and S3 as your archive.

### Monitoring and Observability

Once your EFS-backed ECS tasks are running, monitoring ensures they stay healthy. CloudWatch provides key metrics for EFS: file system size, metered I/O operations, burst credit balance, and provisioned throughput. Set up alarms on burst credit balance if you're using burst mode—if you're consistently running out of bursting capacity, that's a signal to move to provisioned throughput or optimize your I/O patterns.

For task-level visibility, enable ECS container insights. This gives you task startup times, memory usage, and CPU utilization, which help you spot when EFS latency is impacting your application. If tasks are taking significantly longer to start after you've added EFS, that's likely mount time or access point setup overhead—usually a one-time cost on task launch, but worth measuring.

Enable CloudTrail logging for EFS API calls. This helps audit who's creating or modifying access points, file systems, and mount targets. In a team environment, this provides accountability and helps troubleshoot unexpected changes.

### Conclusion

Mounting EFS volumes in ECS tasks is a powerful pattern for building stateful, scalable containerized applications. By combining ECS's orchestration capabilities with EFS's shared, persistent storage, you get the benefits of containerization without sacrificing the ability to maintain application state.

The key takeaway is that EFS integration requires attention to several layers: task definition volume configuration, network security groups, and IAM authorization through access points. Get all three right, and your tasks seamlessly persist data across restarts and share that data with other tasks. Miss one, and you'll encounter cryptic mount timeouts or permission errors.

For developers building data processing pipelines, content platforms, machine learning workflows, or any stateful application on ECS, understanding this integration is essential. It's the bridge between the transient world of containers and the persistent storage your applications need.

From here, explore related services: ECS task definitions offer many other volume types, CloudWatch provides deep observability into your EFS usage, and the ECS APIs let you automate task deployment and scaling. The AWS documentation on EFS access points is particularly worth reviewing—those details provide security and operational benefits that scale as your application grows.
