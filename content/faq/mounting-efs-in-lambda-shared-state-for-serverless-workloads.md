---
title: "Mounting EFS in Lambda: Shared State for Serverless Workloads"
---

## Mounting EFS in Lambda: Shared State for Serverless Workloads

Serverless functions are meant to be stateless. That's the promise—spin up, run, tear down. But reality is messier. Sometimes you need to share large files across multiple Lambda invocations, cache expensive computations, or load a multi-gigabyte machine learning model that you don't want to rebuild on every function call. That's where Amazon EFS mounted directly in Lambda becomes a game-changer.

For years, developers worked around Lambda's ephemeral storage by encoding dependencies into container images or fetching data from S3 on every invocation. Both approaches have their place, but they're often slow, expensive, or both. EFS gives you something different: a shared, persistent file system that multiple Lambda functions can access simultaneously, with performance characteristics that sit somewhere between S3 and local disk storage.

This guide walks you through everything you need to make EFS work reliably in Lambda, from the network plumbing to performance tuning to real-world patterns that leverage this capability effectively.

### Understanding the EFS-Lambda Integration

Before diving into configuration, it's helpful to understand what's actually happening under the hood. When you mount EFS in a Lambda function, you're attaching a network file system to that function's execution environment. Unlike the 10 GB of ephemeral `/tmp` storage that every Lambda has built-in, EFS persists across invocations and can be shared across functions in the same VPC.

The integration relies on NFSv4.1 (Network File System version 4.1), which means your Lambda function communicates with your EFS mount targets over the network. This is both powerful and important to understand—there's network latency involved, which we'll discuss in the performance section. Unlike local SSD storage, you can't just assume microsecond access times.

EFS lives inside a VPC. Lambda also needs to run inside a VPC to mount it. If you've kept your Lambda functions in AWS's default serverless environment (no VPC), you'll need to move them into a VPC first. This is a significant architectural decision because it means your Lambda will lose direct internet access unless you configure a NAT gateway or VPC endpoints.

### Prerequisites and Architectural Requirements

Getting EFS mounted in Lambda requires several pieces to be in place, and they all need to work together. Let's walk through each one.

#### Lambda Execution in a VPC

Your Lambda function must run within a VPC and, more specifically, must have network interfaces attached to subnets within that VPC. When you configure a Lambda to use a VPC, AWS creates elastic network interfaces (ENIs) in your specified subnets and associates them with your function. These ENIs are how your Lambda communicates with other resources in the VPC, including EFS.

Configuring this is straightforward in the Lambda console or via infrastructure-as-code tools. You specify the VPC ID and the subnets where the function should run. Choose at least two subnets across different availability zones for resilience.

One critical consequence: if your Lambda needs to reach the public internet (to call external APIs, for example), you'll need to route traffic through a NAT gateway. A NAT gateway costs money and introduces additional latency and complexity. For functions that only need to communicate with resources inside the VPC (including EFS), this isn't a concern. It's worth factoring into your decision.

#### EFS File System and Access Points

You need an EFS file system in the same VPC as your Lambda. When you create EFS, you specify the VPC, and AWS automatically creates mount targets in each of your availability zones. These mount targets are the network endpoints that your Lambda will connect to.

Beyond the basic file system, EFS Access Points are essential. An Access Point is a way to enforce a consistent view of a file system for applications. When you create an Access Point, you specify a POSIX user ID, group ID, and optionally a path within the EFS. When an application mounts the file system through an Access Point, it's presented with that user/group context and that specific path as the root.

This matters for two reasons. First, it provides isolation and simplicity—if you have multiple Lambda functions using the same EFS, each can have its own Access Point with its own user/group context and root path. Second, it's a security best practice. Rather than letting Lambda mount the entire file system as root, you restrict it to a specific scope.

To create an Access Point via the AWS CLI:

```bash
aws efs create-access-point \
  --file-system-id fs-12345678 \
  --posix-user Uid=1000,Gid=1000 \
  --root-directory Path="/lambda",CreationInfo={OwnerUid=1000,OwnerGid=1000,Permissions=755}
```

This creates an Access Point that presents the `/lambda` directory within the EFS as the root, with all operations performed as UID 1000, GID 1000. The CreationInfo ensures that the directory is created with the right permissions if it doesn't exist.

#### IAM Permissions

Your Lambda's execution role needs permission to mount EFS. The key permission is `elasticfilesystem:ClientMount`. You also need permissions to describe EFS resources so Lambda can find the Access Point and mount target.

Here's a minimal IAM policy:

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
      "Resource": "arn:aws:elasticfilesystem:us-east-1:123456789012:access-point/fsap-12345678"
    }
  ]
}
```

Note that you're granting permissions on the Access Point, not the file system directly. This is more secure and follows the principle of least privilege.

#### Security Groups

Traffic between Lambda and EFS flows over the network, and security groups control that traffic. Your EFS has its own security group, and your Lambda's ENI has a security group (or multiple). For communication to work, the EFS security group must allow inbound NFS traffic (port 2049) from the security group used by your Lambda.

If your Lambda and EFS are in different security groups (which they typically are), you need an inbound rule on the EFS security group like this:

```
Type: NFS (port 2049)
Source: <Lambda security group ID>
```

If you're troubleshooting connection issues, this is often the culprit. EFS connections silently fail when security group rules block them, so double-check this configuration.

### Configuring the Mount in Lambda

Once the prerequisites are met, configuring the mount is the easy part. In the Lambda console, navigate to the function's configuration and find the "File System" section. Click "Add file system" and fill in:

- The EFS Access Point ARN (format: `arn:aws:elasticfilesystem:region:account-id:access-point/fsap-id`)
- The local mount path where you want the EFS accessible within the function (e.g., `/mnt/efs`)

The local mount path can be any directory under `/mnt/`. Lambda will make the EFS available at that path when the function runs.

If you're using infrastructure-as-code, this looks similar in CloudFormation or Terraform. For example, in AWS SAM:

```yaml
MyFunction:
  Type: AWS::Serverless::Function
  Properties:
    Handler: index.handler
    Runtime: python3.11
    VpcConfig:
      SecurityGroupIds:
        - sg-12345678
      SubnetIds:
        - subnet-12345678
        - subnet-87654321
    FileSystemConfigs:
      - Arn: arn:aws:elasticfilesystem:us-east-1:123456789012:access-point/fsap-12345678
        LocalMountPath: /mnt/efs
```

Once configured, within your Lambda code, you can read and write to `/mnt/efs` just like any other directory. The EFS is mounted before your handler runs, so there's no setup code required.

### Writing to EFS from Lambda

In your function code, treat the mount path as a regular directory. Here's a simple Python example:

```python
def lambda_handler(event, context):
    # Write a file to EFS
    with open('/mnt/efs/my-data.txt', 'w') as f:
        f.write('Hello from Lambda')
    
    # Read it back
    with open('/mnt/efs/my-data.txt', 'r') as f:
        content = f.read()
    
    return {
        'statusCode': 200,
        'body': content
    }
```

On the first invocation, the write succeeds and the file persists. On subsequent invocations, the file is still there. Multiple Lambda functions can read and write the same files if they all mount the same EFS Access Point (though you'll want to coordinate writes to avoid data corruption).

### Performance Considerations and Throughput Modes

EFS offers two throughput modes, and choosing the right one significantly impacts both performance and cost. This decision should be intentional, not an afterthought.

#### Bursting Throughput Mode

Bursting mode is the default and is designed for workloads with spiky traffic patterns. EFS accumulates "burst credits" while traffic is low, which you can spend on high-throughput operations. Think of it like a battery that charges slowly but can discharge quickly when needed.

For most serverless workloads, especially those with unpredictable invocation patterns, bursting mode is cost-effective. You pay a low baseline rate and only pay more when you burst.

The catch: if you exceed your burst capacity and maintain high throughput, performance degrades significantly as EFS throttles your operations. The baseline throughput is 50 MB/s per TB of stored data. If you have 100 GB stored, your baseline is 5 MB/s (100 GB × 50 MB/s / 1000 GB). You accumulate burst credits at 100 MB/s, so if you use only your baseline, credits accumulate over time. But if you consistently exceed the baseline, credits deplete, and you're limited to the baseline again.

#### Provisioned Throughput Mode

Provisioned mode guarantees a certain throughput regardless of storage size. You pay a separate charge based on the throughput you provision (e.g., $6 per MB/s per month in most regions). This mode is suitable for workloads with predictable, sustained high throughput needs.

For Lambda workloads, provisioned mode is less common because Lambda is often bursty by nature. But if you're running continuous, concurrent inference against a large model stored in EFS, or if you have many Lambda functions simultaneously reading large files, provisioned throughput becomes necessary.

#### Practical Guidance

Start with bursting mode. Monitor your CloudWatch metrics, particularly the `BurstCreditBalance` metric. If you're consistently burning credits and hitting throttling, switch to provisioned mode. The transition is seamless—you can change modes without downtime.

For ML model loading scenarios, where a single Lambda invocation might read a 2 GB model file once, bursting mode usually suffices because the burst is temporary. For scenarios where many concurrent Lambdas are doing the same, provisioned throughput becomes more cost-effective.

### Use Cases Where EFS Shines

Understanding when to use EFS in Lambda is as important as knowing how. EFS isn't always the right answer, and there are scenarios where it's ideal.

#### Large Machine Learning Models

Suppose you're running inference on a large language model or computer vision model that's 5 GB in size. Every time your Lambda invokes, it needs access to that model. You have three broad options:

Include the model in the container image (not practical for 5 GB), fetch it from S3 on every invocation (slow and expensive in bandwidth), or mount it from EFS. With EFS, you load the model once, and subsequent invocations access it over the network without re-downloading.

The first invocation will be slower as the Lambda initializes, but subsequent invocations benefit from OS-level file caching. If your invocations are frequent enough and close enough together, you'll see warm cache hits.

#### Shared Cache Across Functions

Imagine you have multiple Lambda functions that perform expensive computations—perhaps generating thumbnails for images or running machine learning inference. These functions could cache their results in EFS. The next time the same input arrives, any function can look up the cached result rather than recomputing.

This is only viable with EFS because it's shared across invocations and functions. You can't do this with `/tmp` storage because it's local to each Lambda execution environment.

#### Stateful Batch Processing and Checkpointing

For long-running batch jobs or complex workflows, you might want to checkpoint progress. Imagine a data processing function that reads records from a source, processes them, and writes results. If the function times out or fails partway through, you want to resume from the last checkpoint rather than starting over.

Write checkpoint metadata to EFS. On retry or resumption, read the checkpoint to see where you left off. Since EFS is durable, the checkpoint survives across Lambda invocations.

#### Shared Training or Model Fine-Tuning Data

If you're fine-tuning models, you might have Lambdas that collect training data, preprocess it, and then other Lambdas that train on it. EFS lets you share that data without going through S3 twice (once to read from S3, once to write to S3). The pipeline is simpler and faster.

#### Use Cases Where EFS Is Not Ideal

It's equally important to know when not to use EFS. If your Lambda is purely stateless and data naturally fits in memory or in the Lambda's `/tmp` directory, EFS adds unnecessary complexity. If your workload requires extremely high throughput (gigabytes per second), S3 with multipart transfers or direct attached storage in EC2 might be better.

If you need strong consistency and atomic operations across concurrent writers, EFS provides POSIX semantics but not all guarantees that a transactional database would. For highly concurrent workloads with complex consistency requirements, DynamoDB or Aurora might be more appropriate.

### Troubleshooting Common Issues

Even when you've done everything right, EFS-Lambda integrations can be finicky. Here are the most common problems and how to diagnose them.

#### Connection Timeout

Your Lambda attempts to mount EFS but times out. The most common cause is security group misconfiguration. Verify that the EFS security group allows inbound traffic on port 2049 from your Lambda's security group. Test by temporarily allowing all traffic and seeing if the problem persists.

Network ACLs can also block traffic, though less commonly. If you've customized your subnet's network ACL, ensure that port 2049 is allowed both inbound and outbound.

#### Permission Denied Errors

Your function can mount EFS, but reads or writes fail with permission errors. Check two things: first, verify that your Lambda's execution role has the `elasticfilesystem:ClientMount` and `elasticfilesystem:ClientWrite` permissions for the Access Point. Second, verify that the POSIX user/group you specified in the Access Point can access the directory.

If the directory was created with restrictive permissions before you set up the Access Point, the Access Point's user might not have access. Delete the directory and let the Access Point recreate it with the correct permissions.

#### Slow Performance

EFS is slower than local SSD, and if you're copying large files or doing random I/O, you'll notice. Check your CloudWatch metrics for the file system. Look at `DataReadIOBytes` and `DataWriteIOBytes` per second. If you're hitting burst credit limits (the `BurstCreditBalance` is near zero), you're being throttled. Consider provisioned throughput or optimizing your I/O patterns.

For workloads that read a single large file sequentially, EFS performs reasonably well. For workloads with lots of random reads across many small files, performance can be disappointing. Profile your actual workload before committing to EFS.

#### Cold Start Increases

Adding EFS to Lambda increases cold start latency slightly because the system needs to attach the network interface and mount the file system. The increase is typically 100–500 milliseconds depending on your configuration. If you're in an environment where cold starts are already a problem, be aware that EFS makes them worse.

For functions that cold start frequently (because they don't get much traffic), the EFS overhead might be meaningful. For functions that stay warm, it's negligible.

### Best Practices and Optimization Strategies

Beyond getting it working, here are practices that keep your EFS-Lambda setup performant, secure, and maintainable.

**Use Access Points for Isolation** — Never mount the root of the EFS file system. Always use an Access Point. This gives you per-application isolation, security boundaries, and a clear organizational structure. If you have multiple functions or applications using the same EFS, each gets its own Access Point with its own root path and user context.

**Implement Application-Level Caching** — Don't rely entirely on OS-level caching. In your application code, cache frequently accessed files in memory. Load your model or lookup table once during function initialization, then reuse it for the lifetime of the Lambda container instance. This dramatically reduces EFS access for warm invocations.

**Batch I/O Operations** — Minimize the number of file system calls. Instead of reading one record at a time from a file, read blocks or entire files into memory and process them. Network latency to EFS is high relative to local disk, so batching amortizes the cost.

**Monitor Burst Credits** — Set up CloudWatch alarms on `BurstCreditBalance` and `StoredThroughputCapacity` (if using provisioned mode). If you're consistently running low on credits, that's a sign to switch to provisioned throughput or restructure your workload.

**Organize Files Logically** — Use sensible directory structures. If multiple functions share EFS, partition it clearly. Use a convention like `/mnt/efs/models/`, `/mnt/efs/cache/`, `/mnt/efs/shared-data/`. This prevents accidental collisions and makes it easier to reason about what's stored where.

**Consider Lifecycle Policies** — EFS doesn't have automatic cleanup. Implement application-level logic to delete old cache entries, checkpoint files, or temporary data. You can also enable Intelligent-Tiering if you want EFS to automatically move infrequently accessed files to a cheaper storage tier.

**Use EFS Backup for Critical Data** — EFS supports snapshots via AWS Backup. If your cached or checkpoint data is critical, set up automated backups. This adds cost and complexity, but protects against accidental deletion or file system corruption.

### Estimating Costs

EFS costs have multiple components, so be deliberate about budgeting.

You pay for storage (approximately $0.30 per GB-month in most regions), for data transfer out (typically $0.02 per GB out of the region), and optionally for provisioned throughput if you choose that mode. Bursting mode has a baseline included in the storage price, which is why it's attractive for variable workloads.

For a 100 GB model stored on EFS in bursting mode, you'd pay roughly $30 per month for storage. If you switch to provisioned throughput at 10 MB/s, add approximately $60 per month. The math changes if your storage grows or you need more throughput.

Lambda itself has no additional charge for using EFS, but remember that Lambda running in a VPC with ENI management incurs a modest charge (~$0.015 per vCPU-hour), and if you use a NAT gateway, that's $0.045 per hour plus data transfer costs.

### Comparing Alternatives

Before committing to EFS, consider what problem you're actually solving.

**EFS vs. S3** — S3 is cheaper for storage but slower for repeated access without caching. If your Lambda reads a 2 GB file hundreds of times per day, EFS is faster. If it reads it once per day, S3 is sufficient and cheaper.

**EFS vs. Lambda `/tmp` Storage** — The `/tmp` directory is ephemeral and limited to 10 GB. It's great for temporary files within a single invocation but not for sharing state across invocations or functions.

**EFS vs. DynamoDB or ElastiCache** — For structured data or hot-path caching (like session storage), DynamoDB or ElastiCache are more appropriate. EFS is for unstructured file data: models, large datasets, media files.

**EFS vs. Placing Data in Container Images** — If your model or dataset is smaller than a few gigabytes and doesn't change frequently, baking it into your container image is simpler and faster than mounting EFS. No network latency, no security group configuration. The tradeoff is slower image build and deployment times.

### Real-World Workflow Example

Let's tie this together with a realistic scenario. Suppose you're building an image analysis service where Lambda functions perform inference using a large vision model. Your workflow:

1. **Setup Phase** (one-time):
   - Create an EFS file system in your VPC.
   - Create an Access Point with path `/ml-models`.
   - Download your model (3 GB) and upload it to EFS via an EC2 instance or AWS DataSync.
   - Set IAM role, security groups, and VPC configuration as described.

2. **Lambda Function Configuration**:
   - Attach the Lambda to the VPC and security group.
   - Mount the EFS Access Point to `/mnt/efs`.
   - Grant the execution role the `elasticfilesystem:ClientMount` permission.

3. **Handler Code**:

```python
import json
import os
from PIL import Image
from inference_engine import load_model, run_inference

# Model loaded once per container
model = None

def lambda_handler(event, context):
    global model
    
    # Load model from EFS on first invocation
    if model is None:
        model = load_model('/mnt/efs/my-model.pth')
    
    # Get image from event
    image_data = event.get('image_data')
    image = Image.frombytes(image_data)
    
    # Run inference using cached model
    results = run_inference(model, image)
    
    return {
        'statusCode': 200,
        'results': results
    }
```

4. **Invocation**: When the function first invokes, it mounts EFS, loads the model from the EFS path, and runs inference. Subsequent invocations (within the same Lambda execution environment) reuse the cached model, avoiding the network read.

5. **Monitoring**: Watch CloudWatch for EFS throughput and burst credit metrics. If you see consistent throttling, provision throughput.

This pattern—mounting a large file once and reusing it across invocations—is where EFS in Lambda provides the most tangible benefit.

### Conclusion

EFS mounted in Lambda opens patterns that would be impossible or prohibitively expensive otherwise. Large models that used to require expensive always-warm inference instances can now run in serverless environments. Distributed batch jobs can coordinate through shared checkpoint files. Multiple functions can share cache without going back to S3.

The setup isn't trivial—you need to understand VPCs, security groups, IAM, and EFS's own configuration model. But once configured, it works transparently. Your code sees `/mnt/efs` as just another directory.

Start with a clear use case: a large file that multiple invocations or functions need to share, where the cost and complexity of S3 is undesirable, and where network latency is acceptable. Monitor your actual performance and costs. Use Access Points for isolation and security. And remember that EFS is a tool for specific problems, not a default. Many serverless workloads are better served by other storage mechanisms.

With EFS, you're removing one of the traditional boundaries of serverless architectures—the inability to share state efficiently. Use that capability thoughtfully, and you'll unlock workloads that previously required more complex, costly infrastructure.
