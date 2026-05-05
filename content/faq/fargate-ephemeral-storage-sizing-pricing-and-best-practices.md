---
title: "Fargate Ephemeral Storage: Sizing, Pricing, and Best Practices"
---

## Fargate Ephemeral Storage: Sizing, Pricing, and Best Practices

AWS Fargate abstracts away the underlying infrastructure complexity, letting you focus on containerized applications rather than managing EC2 instances. But this convenience comes with constraints—and ephemeral storage is one of them. Every Fargate task gets a slice of temporary storage that's perfect for intermediate files, caches, and build artifacts, yet it's often misunderstood or overlooked until you hit a "disk full" error in production.

In this article, we'll demystify Fargate's ephemeral storage: how much you get by default, how to expand it when you need more, what it costs, when it disappears, and how to use it effectively. Whether you're processing large files, building artifacts inside containers, or simply need temporary scratch space, understanding ephemeral storage will help you architect more reliable and cost-effective applications.

### Understanding Fargate's Default Ephemeral Storage Allocation

By default, every Fargate task receives 20 GB of ephemeral storage. This space is reserved for the container's writable layer—the temporary filesystem changes that don't persist beyond the task's lifetime. It's separate from your container image size and from any persistent volumes you might attach via EBS or EFS.

Think of ephemeral storage as the task's personal workspace. When your application writes logs to a local file, caches data, or creates temporary directories, those writes consume ephemeral storage. Once the task stops, this storage is wiped clean—there's no way to recover those files. This ephemeral nature is both a feature and a constraint: it's feature because it prevents storage bloat and ensures clean slate deployments, and it's a constraint because you can't rely on local files persisting across task restarts.

The 20 GB default handles most containerized workloads comfortably. A typical web service, microservice, or worker task rarely exhausts this quota. However, certain use cases—batch processing, machine learning inference with large models, complex build pipelines—can legitimately need more.

### Expanding Ephemeral Storage Beyond the Default

If 20 GB isn't enough, Fargate lets you expand ephemeral storage up to 200 GB per task by using the `ephemeralStorage` parameter in your task definition. This is straightforward to implement but requires understanding where the configuration lives and how it interacts with your container environment.

When you define a Fargate task in the AWS Management Console, look for the "Storage" section. You'll find a field labeled "Ephemeral storage" where you can specify a value between 21 and 200 GB in 1 GB increments. The minimum value of 21 GB (just above the default) exists because you can only increase ephemeral storage, never decrease it below the default.

Using the AWS CLI, you'd configure it like this:

```json
{
  "family": "my-task-definition",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "256",
  "memory": "512",
  "ephemeralStorage": {
    "sizeInGiB": 100
  },
  "containerDefinitions": [
    {
      "name": "my-container",
      "image": "my-image:latest",
      "memory": 512
    }
  ]
}
```

When you run `aws ecs register-task-definition` with this definition, the task will have 100 GB of ephemeral storage available. Inside the container, this space appears as `/dev/shm` (shared memory) or as additional capacity on the root filesystem, depending on your container's mount configuration. Most applications see this as additional disk space they can write to without worrying about implementation details.

One important detail: the `ephemeralStorage` parameter applies to the entire task, not to individual containers within it. If your task definition includes multiple containers, they share the allocated ephemeral storage. This means you need to plan accordingly if you're running sidecar containers or multiple application containers in a single task.

### Pricing Implications of Expanded Ephemeral Storage

Here's where cost enters the picture. The default 20 GB of ephemeral storage is included in your Fargate pricing—you don't pay extra for it. However, any storage beyond 20 GB incurs additional charges. As of now, AWS charges approximately $0.111 per GB-month for Fargate ephemeral storage beyond the default allocation.

The cost calculation is straightforward: if you provision 100 GB of ephemeral storage and your task runs for a full month, you're paying for 80 GB of additional storage (100 - 20 = 80). Multiply that by the per-GB-month rate, and you have the additional storage cost. For a task running continuously, this adds up quickly. For tasks that run intermittently—say, a batch job that runs for a few hours daily—the effective monthly cost is proportionally lower.

Let's work through a concrete example. Suppose you're running a batch processing task with 150 GB of ephemeral storage. That task runs for 8 hours per day, 30 days per month. The additional storage beyond the default is 130 GB. The task runs for approximately 240 hours monthly (8 hours × 30 days), which is about 10% of the month. So the effective monthly cost would be: 130 GB × 0.111 ($/GB-month) × 0.10 (monthly utilization factor) ≈ $1.44 per month. Not terrible, but it's worth calculating when you're scaling horizontally with many tasks.

This pricing structure incentivizes thoughtful storage allocation. Rather than blindly expanding ephemeral storage to a comfortable 200 GB "just in case," you should measure your actual needs and provision accordingly. Tools like CloudWatch can help you monitor disk usage within your containers to inform these decisions.

### When Ephemeral Storage Gets Wiped

Understanding the lifecycle of ephemeral storage is crucial for designing fault-tolerant applications. Here's the key principle: **ephemeral storage is destroyed when the task stops, for any reason**.

This includes normal task shutdown, task replacement during a deployment, task termination due to resource constraints, or even a simple restart. There's no persistence, no snapshots, no recovery mechanism. If your application writes data to ephemeral storage expecting it to survive a task restart, you'll lose that data.

This design pattern has important implications for application architecture. If you need data to survive task restarts, you must use persistent storage—Amazon EFS for shared filesystems or Amazon EBS for block storage. Ephemeral storage is ideal for caches that can be rebuilt, temporary files that are consumed before task termination, or working directories for batch jobs that complete within a single task's lifetime.

Consider a machine learning inference task that downloads a large model file (say, 15 GB) at startup. Storing this in ephemeral storage makes sense because the file is temporary—it's only needed during that task's execution. When the task terminates, losing the file is fine; the next task will download it again. However, if you wanted to cache the model across multiple tasks to avoid repeated downloads, you'd use EFS instead, accepting the latency and cost of persistent storage in exchange for better performance and efficiency.

### Ephemeral Storage and Docker Image Layers

This is a subtle but important interaction that catches many developers off guard. Your container's Docker image consists of layers—a base OS layer, application layers, configuration layers, and so on. The image is immutable and lives in a container registry or locally on the Fargate infrastructure. When a container starts, Fargate creates a writable layer on top of the image layers, and that writable layer consumes ephemeral storage.

Here's the scenario: you have a Docker image that's 18 GB in size (compressed and layered in the registry, but expanded when pulled and decompressed). When a Fargate task launches, this image is pulled and the layers are decompressed. With the default 20 GB of ephemeral storage, you might find that you only have about 2 GB of free space for your application to write to, since the image layers themselves occupy most of the ephemeral storage allocation.

If your application tries to write more than the remaining free space, you'll get a "No space left on device" error. This is particularly problematic for applications that extract or build large artifacts at runtime.

To avoid this surprise, consider: what's the uncompressed size of your Docker image? What's the typical working set of files your application needs to write during execution? If the sum approaches 20 GB, increase your ephemeral storage allocation accordingly. Many developers allocate 100-150 GB of ephemeral storage specifically to account for large image sizes plus application working sets.

You can optimize your Docker images to reduce their footprint—using multi-stage builds, removing unnecessary files, choosing lighter base images—which directly reduces the ephemeral storage you need to provision and thus your costs.

### Encrypting Ephemeral Storage

By default, Fargate encrypts your ephemeral storage using an AWS-managed encryption key. This means your temporary files are encrypted at rest without any configuration on your part. AWS handles key management, rotation, and all the cryptographic details behind the scenes.

For many applications, AWS-managed encryption is perfectly adequate. It provides encryption coverage without operational overhead. However, if your organization requires stricter control over encryption keys—perhaps for compliance reasons or because you need to manage key rotation policies yourself—Fargate supports customer-managed AWS KMS keys.

To use a customer-managed KMS key, you specify the key ARN in your task definition's `ephemeralStorage` block:

```json
{
  "ephemeralStorage": {
    "sizeInGiB": 100,
    "encrypted": true,
    "kmsKeyId": "arn:aws:kms:us-east-1:123456789012:key/12345678-1234-1234-1234-123456789012"
  }
}
```

When you use a customer-managed KMS key, ensure that your ECS task execution role has permissions to use that key. You'll need to add a KMS policy that allows the `kms:Decrypt` and `kms:GenerateDataKey` actions for the key. Without proper permissions, your task will fail to start with cryptic error messages about not being able to access the encryption key.

The advantage of customer-managed keys is control: you can audit key usage, set up key policies precisely as you need them, and handle key rotation through your own processes. The disadvantage is operational responsibility—you're now responsible for key management, and misconfigured keys can break your deployments.

For most applications, AWS-managed encryption is the right choice. Reserve customer-managed keys for scenarios where compliance requirements or organizational policies demand it.

### Real-World Use Cases for Expanded Ephemeral Storage

Understanding when to use ephemeral storage starts with identifying workloads that genuinely benefit from it. Let's explore several realistic scenarios.

**Building and Compiling Artifacts**: Imagine a Fargate task that pulls source code from a repository, compiles it, and outputs a binary or package. The compilation process might require significant temporary space for intermediate object files, cache directories, and temporary builds. If your project is large or uses resource-intensive build tools, ephemeral storage becomes crucial. A 100 GB allocation might be entirely appropriate here.

**Processing Large CSV or JSON Files**: Data transformation tasks often download large input files, process them, and produce output. If you're working with multi-gigabyte datasets, you need ephemeral storage not just for the input file but also for any intermediate processing artifacts, sorted data structures, or temporary indexes. Using EFS for such transient data would be inefficient and expensive; ephemeral storage is the right choice.

**Machine Learning Inference with Large Models**: Modern large language models, computer vision models, and other ML artifacts can be enormous—10 GB, 50 GB, or more. Downloading and loading these at task startup requires ephemeral storage. If you're running inference tasks that complete in minutes or hours, ephemeral storage is ideal. The model is downloaded once per task, used for inference, and discarded when the task terminates.

**Video or Image Processing**: Media processing pipelines often need temporary space for intermediate frames, extracted audio, encoded outputs, or format conversions. A single video file might be 5 GB, and the processing pipeline might require several GB of additional scratch space for buffers and working data.

**Complex Cache Hierarchies**: Some applications build sophisticated in-memory caches or temporary index structures. While you might ordinarily use a cache service like ElastiCache, sometimes it's more efficient to build these structures in ephemeral storage if they're task-specific and short-lived.

In all these cases, the pattern is consistent: the data is temporary, the task completes (or doesn't need persistence), and ephemeral storage is the most cost-effective and performant solution.

### Monitoring and Optimizing Ephemeral Storage Usage

Once you've deployed tasks with expanded ephemeral storage, how do you ensure you're not over-provisioning or hitting capacity limits unexpectedly? Monitoring is key.

CloudWatch doesn't provide a built-in metric for Fargate ephemeral storage usage directly, so you need to implement it yourself. One approach is to have your application periodically check available disk space using standard OS tools (`df` on Linux) and emit a custom CloudWatch metric. Here's a simple bash snippet you might include in your container's startup script:

```bash
#!/bin/bash
while true; do
  DISK_USAGE=$(df /tmp | tail -1 | awk '{print int($3/$2 * 100)}')
  aws cloudwatch put-metric-data \
    --namespace "MyApp/Storage" \
    --metric-name "EphemeralStorageUtilization" \
    --value $DISK_USAGE \
    --unit Percent
  sleep 300
done &
```

This publishes disk usage every five minutes. You can then set CloudWatch alarms to alert you if usage approaches capacity (e.g., 85% full), giving you a signal to either optimize your application or increase the allocation.

From an optimization perspective, periodically review your task logs and metrics to understand actual usage patterns. If you've provisioned 150 GB but metrics show you consistently use only 30 GB, you're paying for unused capacity. Conversely, if you see errors indicating disk full or warnings about low disk space, you need to increase your allocation or optimize your application to use less space.

Another optimization strategy is to implement cleanup routines within your application. If you're writing temporary files to ephemeral storage, explicitly delete them when you're done rather than relying on task termination. This can reduce overall storage pressure and improve application performance by keeping the filesystem clean.

### Best Practices for Ephemeral Storage

Drawing together everything we've covered, here are the key best practices for working with Fargate ephemeral storage:

Start with the default 20 GB and measure your actual needs. Don't over-provision speculatively. Use CloudWatch metrics or application-level monitoring to understand your typical and peak usage patterns before increasing the allocation.

Architect for ephemerality. Design your applications assuming ephemeral storage will be wiped when the task stops. Use persistent storage (EFS or EBS) only for data that genuinely needs to survive beyond a single task's lifetime. This clarity in design prevents data loss bugs and improves cost efficiency.

Optimize your Docker images. Smaller images mean more free ephemeral storage for your application's working set. Use multi-stage builds, remove unnecessary files, and choose lean base images. Every gigabyte you eliminate from your image is a gigabyte available for runtime operations or a gigabyte you don't need to provision.

Implement explicit cleanup. Don't rely on task termination to clean up temporary files. Have your application delete intermediate artifacts when they're no longer needed. This reduces storage pressure and improves performance.

Monitor actual usage. Set up metrics that track ephemeral storage utilization in your containers. Use these metrics to inform capacity planning and to catch unexpected storage spikes early.

Use AWS-managed encryption by default unless you have specific compliance requirements for customer-managed keys. This gives you security without operational overhead.

Be deliberate about cost. Calculate the monthly cost impact of expanded ephemeral storage, especially if you're running many tasks or tasks that run continuously. A task with 150 GB of ephemeral storage running 24/7 costs significantly more than one with 50 GB.

Document your choices. If you've provisioned ephemeral storage at a specific size, document why. Make it clear to other developers on your team what workload characteristics drove that decision, so future maintainers don't second-guess or accidentally over-provision.

### Conclusion

Fargate's ephemeral storage is a simple concept with important nuances. The default 20 GB handles most workloads, but when you need more—whether for large build artifacts, temporary processing files, or cached data—Fargate lets you expand up to 200 GB. Understanding the cost implications, the lifecycle of ephemeral storage, and how it interacts with your Docker images ensures you make informed decisions about your Fargate deployments.

The key takeaway is this: ephemeral storage is a tool for temporary, task-specific data. Use it generously for caches, intermediate files, and working directories. Use persistent storage for anything that needs to survive beyond a single task. Monitor your actual usage, optimize your applications, and let cost metrics guide your capacity decisions. With these principles in mind, you'll architect Fargate workloads that are both efficient and reliable.
