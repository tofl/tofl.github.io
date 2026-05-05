---
title: "Mounting EFS in Fargate Tasks: Step-by-Step Configuration"
---

## Mounting EFS in Fargate Tasks: Step-by-Step Configuration

When you're running containerized applications on AWS Fargate, you often need persistent storage that can be shared across multiple task instances or retained between task lifecycle events. Amazon Elastic File System (EFS) provides exactly that—a fully managed, scalable network file system that integrates seamlessly with Fargate. Unlike EC2 instances where you might mount EFS directly to the host, Fargate requires a different approach since you don't manage the underlying infrastructure. In this guide, we'll walk through the complete process of configuring EFS for your Fargate tasks, from initial setup through security configuration and practical implementation.

### Understanding EFS and Fargate Integration

Before diving into configuration, let's establish why EFS matters for Fargate workloads. EFS provides shared storage that persists independently of your task lifecycle. This is crucial for scenarios like persisting application logs, sharing data between multiple task replicas, or maintaining state that needs to survive a task restart. Unlike Fargate's default ephemeral storage, which is task-specific and temporary, EFS allows data to outlive individual container instances.

The integration works through the Network File System (NFS) protocol, which means EFS mounts appear as standard filesystem paths within your container. Your application code doesn't need to know about S3 or any AWS-specific APIs—it simply reads and writes files as if they were on a local disk. This familiarity makes EFS particularly attractive for legacy applications or codebases that weren't designed with cloud-native storage in mind.

### Creating Your EFS File System

The foundation of any EFS integration begins with the file system itself. Start by creating an EFS resource in the same Virtual Private Cloud (VPC) where your Fargate tasks will run. This is not a decision to take lightly—EFS is region-specific and VPC-bound, so you need to plan this carefully as part of your overall architecture.

When you create an EFS file system through the AWS Management Console, you'll specify a name and optional tags for organizational purposes. More importantly, you'll choose between Standard and One Zone storage classes. Standard storage provides high availability across all availability zones in your region, while One Zone storage is constrained to a single zone but costs less. For production workloads, Standard is typically the safer choice since it provides resilience against zone failures.

After creating the file system, AWS provides a file system ID that you'll reference in your task definition. Take note of this ID—you'll need it when configuring the volumes section of your task definition.

### Setting Up Mount Targets

Here's where many developers encounter their first gotcha: EFS itself isn't directly attached to your VPC networking. Instead, you create mount targets, which are the actual network endpoints through which your Fargate tasks access the file system. Think of mount targets as the bridges between your containerized application and the EFS backend.

You need to create at least one mount target, but AWS strongly recommends creating one mount target per availability zone in your region where you plan to run Fargate tasks. This ensures that your tasks can access EFS with minimal latency and that the system remains available if a zone experiences issues.

When creating a mount target, you specify a subnet and a security group. The subnet determines which zone the mount target lives in, while the security group controls network access. This is critical: the security group you assign to your mount target must allow inbound NFS traffic (port 2049, TCP protocol) from the security group that your Fargate tasks use.

Let's say you have a security group named `ecs-tasks-sg` for your Fargate tasks and another named `efs-sg` for your EFS mount targets. You'd configure an inbound rule on `efs-sg` that allows NFS traffic from `ecs-tasks-sg`. This creates the networking path your containers need to communicate with EFS.

### Configuring Security Groups for NFS Communication

Security group configuration is where the rubber meets the road. Without proper network rules, your Fargate tasks will be unable to reach EFS, and you'll see timeout errors when your application tries to mount the file system.

The key rule is straightforward but must be exact: your EFS security group needs an inbound rule that allows TCP traffic on port 2049 from the source security group of your Fargate tasks. In AWS security group terminology, this rule would look like:

Type: NFS, Protocol: TCP, Port Range: 2049, Source: sg-xxxxxxxx (the Fargate task security group)

Some teams prefer to add UDP on port 2049 as well for NFS version 3 compatibility, though NFS version 4.1 (which EFS uses by default) primarily uses TCP. Including both rarely hurts and can prevent subtle compatibility issues.

Additionally, you should ensure that your Fargate tasks' security group allows outbound traffic on port 2049 to the EFS security group. In many cases, if you have a permissive outbound rule (which allows all traffic), you're fine. But in restricted security postures where outbound traffic is explicitly limited, you'll need to explicitly allow this connection.

### Configuring the Task Definition: Volumes Section

Now we move into the actual Fargate task definition, which is a JSON document that describes how to run your containerized application. The volumes section is where you declare that you want to use EFS.

Here's a minimal volumes configuration:

```json
"volumes": [
  {
    "name": "efs-storage",
    "efsVolumeConfiguration": {
      "fileSystemId": "fs-12345678"
    }
  }
]
```

In this configuration, you're declaring a volume named `efs-storage` and pointing it to your EFS file system using its file system ID. The volume name is arbitrary and used only within the task definition to reference this storage.

There are additional options you can include in the `efsVolumeConfiguration` object to fine-tune behavior. The `rootDirectory` option allows you to mount a specific subdirectory within EFS rather than the root. This is useful when multiple applications share a single EFS file system and you want each to use a different directory path.

The `transitEncryption` option, which we'll discuss in detail later, encrypts data in flight between your task and EFS. The `authorizationConfig` object enables IAM-based access control rather than relying solely on POSIX permissions and security groups.

### Configuring MountPoints: Connecting Volumes to Containers

Declaring a volume isn't enough—you need to tell your container where to mount it. This happens in the `containerDefinitions` section of your task definition, within the `mountPoints` array.

Here's an example:

```json
"containerDefinitions": [
  {
    "name": "my-application",
    "image": "my-registry/my-app:latest",
    "mountPoints": [
      {
        "sourceVolume": "efs-storage",
        "containerPath": "/mnt/efs",
        "readOnly": false
      }
    ],
    "cpu": 256,
    "memory": 512
  }
]
```

The `sourceVolume` must match the name you declared in the volumes section. The `containerPath` is the filesystem path inside your container where EFS will be mounted—in this example, `/mnt/efs`. Your application will read and write files to this path as if it were a regular directory.

The `readOnly` flag determines whether the container can write to the mounted volume. Setting it to `true` prevents your container from modifying anything on EFS, which can be useful for security-conscious deployments or when multiple containers share the same EFS volume and you only want specific ones to modify it.

### Leveraging EFS Access Points for Fine-Grained Permission Control

As your infrastructure grows more complex, you'll likely want more sophisticated permission management than what basic POSIX file permissions provide. EFS Access Points solve this by creating virtualized file system entry points with specific POSIX user and group IDs, plus a root directory context.

Here's the scenario where Access Points shine: imagine you have a single EFS file system shared by three different Fargate services. Without Access Points, managing permissions becomes messy because all containers effectively act as the same user on the file system. Access Points let you enforce that Service A can only access `/data/service-a/`, Service B can access `/data/service-b/`, and each runs with its own designated POSIX user ID.

To use an Access Point, you create it through the AWS console or API, specifying:

The file system to which it belongs, the root directory it represents (for example, `/application-data`), the POSIX user ID that access through this point will assume, and optionally the POSIX group ID and secondary group IDs.

Then, in your task definition's `efsVolumeConfiguration`, you reference the Access Point by its ARN:

```json
"volumes": [
  {
    "name": "efs-storage",
    "efsVolumeConfiguration": {
      "fileSystemId": "fs-12345678",
      "authorizationConfig": {
        "accessPointId": "fsap-0123456789abcdef0"
      }
    }
  }
]
```

When your Fargate task mounts EFS through this Access Point, the container sees the root directory as the path you specified when creating the Access Point, and the effective user ID is the one you configured. This provides application-level isolation and permission enforcement without requiring your application code to handle it.

### Enabling EFS IAM Authorization

By default, EFS relies on security groups and POSIX file permissions for access control. This works fine for many use cases, but if you want an additional layer of identity-based access control, EFS supports IAM authorization.

When you enable IAM authorization, the Fargate task's underlying execution role (the IAM role that Fargate assumes to run your task) must have permission to perform the `elasticfilesystem:ClientMount` and related actions against your specific EFS file system. This means you can use IAM policies to control which tasks can mount which file systems, providing another dimension of security.

To enable this in your task definition:

```json
"volumes": [
  {
    "name": "efs-storage",
    "efsVolumeConfiguration": {
      "fileSystemId": "fs-12345678",
      "authorizationConfig": {
        "iam": "ENABLED"
      }
    }
  }
]
```

And your task execution role needs a policy like:

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
      "Resource": "arn:aws:elasticfilesystem:us-east-1:123456789012:file-system/fs-12345678"
    }
  ]
}
```

Note that IAM authorization adds latency to mount operations because EFS must validate your credentials, so only enable it if you genuinely need that extra layer. For most single-team internal deployments, security groups provide sufficient protection.

### Implementing Transit Encryption

Data in transit between your Fargate task and EFS can be encrypted using TLS. This is particularly important if your VPC spans multiple availability zones and traffic might traverse multiple network hops, or if you have regulatory requirements for encryption.

Enabling transit encryption is as simple as adding a flag to your task definition:

```json
"volumes": [
  {
    "name": "efs-storage",
    "efsVolumeConfiguration": {
      "fileSystemId": "fs-12345678",
      "transitEncryption": "ENABLED",
      "transitEncryptionPort": 3049
    }
  }
]
```

When transit encryption is enabled, EFS uses port 3049 (by default) instead of port 2049. You'll need to update your security groups to allow this port instead. The `transitEncryptionPort` is configurable if port 3049 conflicts with other services in your environment, but 3049 is the standard default.

There is a small performance cost to transit encryption due to the TLS handshake and encryption overhead, but modern systems typically see less than 5% throughput impact. Unless you're running extremely latency-sensitive workloads with massive EFS throughput requirements, the security benefit usually justifies the minimal cost.

### Complete Task Definition Example

Let's bring everything together with a comprehensive task definition that demonstrates all the concepts we've covered:

```json
{
  "family": "my-efs-app",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "256",
  "memory": "512",
  "executionRoleArn": "arn:aws:iam::123456789012:role/ecsTaskExecutionRole",
  "taskRoleArn": "arn:aws:iam::123456789012:role/ecsTaskRole",
  "volumes": [
    {
      "name": "efs-storage",
      "efsVolumeConfiguration": {
        "fileSystemId": "fs-12345678",
        "rootDirectory": "/app-data",
        "transitEncryption": "ENABLED",
        "transitEncryptionPort": 3049,
        "authorizationConfig": {
          "accessPointId": "fsap-0123456789abcdef0",
          "iam": "ENABLED"
        }
      }
    }
  ],
  "containerDefinitions": [
    {
      "name": "my-application",
      "image": "123456789012.dkr.ecr.us-east-1.amazonaws.com/my-app:latest",
      "portMappings": [
        {
          "containerPort": 8080,
          "hostPort": 8080,
          "protocol": "tcp"
        }
      ],
      "mountPoints": [
        {
          "sourceVolume": "efs-storage",
          "containerPath": "/mnt/efs",
          "readOnly": false
        }
      ],
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "/ecs/my-efs-app",
          "awslogs-region": "us-east-1",
          "awslogs-stream-prefix": "ecs"
        }
      },
      "essential": true
    }
  ]
}
```

In this example, we're using an EFS Access Point for permission enforcement, enabling both transit encryption and IAM authorization for defense in depth, and mounting a specific subdirectory within EFS. The task assumes a specific IAM execution role that has the necessary permissions to interact with both ECS and EFS.

### Best Practices and Common Pitfalls

When implementing EFS with Fargate, several patterns emerge from real-world deployments. First, always create mount targets in multiple availability zones if your Fargate service spans multiple zones. A single mount target creates a single point of failure, and if that zone experiences issues, your service loses access to EFS.

Second, monitor EFS performance metrics like throughput and operations per second. EFS has performance characteristics that differ significantly from local storage. If your application performs millions of small file operations per second, you might encounter throughput limits. In such cases, consider batching operations or caching frequently accessed data in your application.

Third, be cautious about using EFS for high-concurrency database operations. While EFS supports concurrent access, databases typically expect storage with stronger consistency guarantees than NFS provides. If you're running a database in Fargate, use Amazon RDS or a container-based database with local EBS volumes rather than EFS.

Fourth, test your mount configuration thoroughly before deploying to production. The most common error is a misconfigured security group where the EFS security group doesn't allow inbound NFS traffic from the Fargate task security group. These errors manifest as timeout failures when the container tries to mount the file system, and they're frustrating to debug if you haven't tested locally first.

Finally, consider using EFS encryption at rest in addition to transit encryption. While transit encryption protects data in flight, at-rest encryption protects the data on disk. You enable this at file system creation time, not in the task definition, so plan ahead.

### Monitoring and Troubleshooting

Once your Fargate tasks are running with EFS mounted, monitoring becomes crucial. CloudWatch provides metrics for EFS file systems including throughput, operations per second, and storage capacity. Set alarms on these metrics so you're alerted if your workload is approaching limits.

If tasks fail to start, check CloudWatch Logs for the Fargate tasks themselves—mount errors will appear there. Additionally, EFS access point errors often show up in task logs if there's a permission issue. If you enable IAM authorization, check that your task execution role has the necessary policies.

For performance issues, use CloudWatch Container Insights to track task-level performance and correlate it with EFS metrics. If throughput seems limited, consider whether your access pattern might benefit from caching or whether you're hitting EFS's performance limits.

### Conclusion

Configuring EFS for Fargate tasks requires careful attention to networking, security, and task definition details, but the result is a robust, scalable persistent storage solution that requires minimal application code changes. By properly setting up mount targets across availability zones, configuring security groups to allow NFS communication, and leveraging Access Points and IAM authorization for fine-grained control, you create an infrastructure that's both secure and operationally sound.

The complete task definition example we walked through demonstrates how these pieces fit together in a real-world scenario. Whether you're building a new application or adapting an existing one to cloud infrastructure, EFS provides the persistence layer that allows your containerized applications to reliably store and access data across task lifecycle events and multiple instances. With the patterns and configurations covered in this guide, you're well-equipped to implement EFS in your own Fargate deployments with confidence.
