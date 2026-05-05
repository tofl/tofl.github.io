---
title: "Lambda /tmp Storage: Use Cases, Limits, and Configuration"
---

## Lambda /tmp Storage: Use Cases, Limits, and Configuration

When you deploy a Lambda function, you're not just getting compute—you're also getting a slice of the function's execution environment's filesystem. That slice, mounted at `/tmp`, is one of the most underutilized features in AWS Lambda, yet it can be the difference between an elegant solution and an architectural headache. Whether you're downloading multi-gigabyte machine learning models, processing large files, or caching intermediate results, understanding how to leverage (and configure) this ephemeral storage is essential for building efficient, cost-effective serverless applications.

### Understanding Lambda's Ephemeral Storage

Every Lambda function execution runs in a sandboxed environment that includes a small amount of temporary storage at `/tmp`. This storage is ephemeral, meaning it's tied to the lifecycle of the execution environment itself—not to individual invocations. That distinction matters more than you might initially think.

The default allocation is 512 MB, which covers many common use cases: temporary log files, intermediate processing results, or small cached data. But for functions that work with larger datasets or complex computational tasks, 512 MB can feel constraining. The good news is that AWS allows you to configure this allocation up to a maximum of 10 GB, giving you significantly more room to work with without needing to redesign your architecture.

### The Default 512 MB: When It's Enough

In most scenarios, 512 MB is perfectly adequate. If your function is primarily doing lightweight transformations, writing to databases, or orchestrating other AWS services, you'll likely never touch the `/tmp` directory at all. The real sweet spot for the default allocation includes functions that perform quick data transformations, manipulate small configuration files, or store temporary encryption keys and credentials during execution.

Think of a Lambda function that processes API Gateway events and writes to DynamoDB—it might create a small JSON file in `/tmp` for intermediate validation results, then delete it before the function returns. In this scenario, you're using only a few kilobytes of storage, and the 512 MB default is more than sufficient.

### When You Need More: Scaling Beyond 512 MB

The picture changes once you start working with larger files or computationally intensive workloads. Machine learning inference is a classic example. Many pre-trained models—whether they're computer vision models from TensorFlow, language models from PyTorch, or custom models trained on your own data—easily exceed 512 MB. A ResNet50 model might be 100 MB, but when you add its dependencies and supporting libraries, you're quickly looking at several hundred megabytes. Add multiple models for an ensemble approach, and you're over the limit.

Data processing pipelines often face similar constraints. If your Lambda function needs to download a CSV file, transform it, and prepare it for downstream analysis, and that CSV file is, say, 800 MB uncompressed, you'll immediately run into space limitations with the default allocation.

CI/CD pipelines that run within Lambda—building Docker images, compiling source code, or creating deployable artifacts—are another practical use case. You might download source code, run build steps, and stage the output in `/tmp` before uploading to S3. Depending on the complexity of your build, that process can consume gigabytes of space.

### Configuring /tmp Storage: The Mechanics

Configuring Lambda's ephemeral storage is straightforward from an operational perspective. When you create or update a Lambda function, you can specify the `EphemeralSize` parameter through the AWS Management Console, the AWS CLI, Infrastructure as Code tools like CloudFormation or Terraform, or programmatically through the AWS SDKs.

Via the AWS CLI, you'd update a function with a command like:

```bash
aws lambda update-function-configuration \
  --function-name my-processor \
  --ephemeral-size 2048
```

This allocates 2 GB of `/tmp` storage to your function. If you're using Infrastructure as Code, the syntax varies slightly depending on your tool. In CloudFormation, for example, you'd use the `EphemeralSize` property within your `AWS::Lambda::Function` resource.

The key point is that this configuration is set at the function level, not per invocation. Every execution of that function will have access to the amount of storage you've configured. There's no fine-grained per-invocation control—it's all or nothing.

### Understanding the Cost Implications

Here's where the economics of Lambda storage become important. The first 512 MB of `/tmp` storage per invocation is included in Lambda's standard pricing. Beyond that, you pay approximately $0.0000166 per GB-hour. To put that in perspective, allocating an additional 9.5 GB (the maximum beyond the included 512 MB) to a function that runs 1 million times per month, with an average duration of 30 seconds, would add roughly $200 to your monthly bill.

For many workloads, that's entirely reasonable. A function that downloads a 2 GB model and runs it thousands of times per month benefits enormously from caching that model in `/tmp`, and the storage cost is a small fraction of what you'd pay if you had to download that model from S3 on every single invocation. But it's worth calculating the cost-benefit for your specific use case. If you're running functions frequently and using large amounts of storage, those costs can accumulate.

### Ephemeral Storage Persistence: The Warm Execution Environment

This is where understanding Lambda's execution model becomes crucial. The `/tmp` directory persists across multiple invocations of the same Lambda function, provided those invocations occur within the same execution environment. In other words, if your function is "warm"—if AWS hasn't recycled its environment—then files you write to `/tmp` in one invocation are still there in the next invocation.

This behavior is a feature and a footgun at the same time. Used thoughtfully, it's incredibly powerful for caching. You can download a large machine learning model once, store it in `/tmp`, and reuse it across dozens or hundreds of invocations without the network overhead and latency of re-downloading it. The first invocation takes longer because the model is being downloaded; subsequent "warm" invocations are dramatically faster because they're reading from local disk.

But there's a critical security and correctness implication: you must assume that `/tmp` is not guaranteed to be fresh on every invocation. If your code writes sensitive data to `/tmp`—API keys, customer data, authentication tokens—that data persists across invocations. An attacker or a misconfigured downstream process could potentially access it. Always clean up sensitive data explicitly, even though you might expect a new environment. Better yet, avoid storing truly sensitive information in `/tmp` altogether; use AWS Secrets Manager or Parameter Store instead.

Additionally, you can't rely on `/tmp` being clean as a prerequisite for your function's logic. If your function assumes that `/tmp` is empty when it starts, and it reuses environments where the directory isn't empty, you might encounter unexpected behavior—duplicate files, stale data, or resource contention if you're not careful.

### Practical Use Cases for Ephemeral Storage

Machine learning inference is perhaps the most common and compelling use case. If you're running inference on pre-trained models, downloading the model on every invocation is wasteful. Instead, download it once, store it in `/tmp`, and reuse it. For a function that might be invoked thousands of times per day, the cumulative time and cost savings are substantial. You can even load the model into memory during the function initialization code (which runs once per container), making subsequent invocations nearly instantaneous.

File processing and transformation represents another strong use case. You might download a large file from S3, decompress it, process it in memory, and write results back to S3—all within `/tmp`. The local disk is orders of magnitude faster than downloading and uploading repeatedly to S3, so this pattern is both faster and more cost-effective.

Data caching is similarly valuable. If your function frequently queries data that's expensive to compute or retrieve, you can cache results in `/tmp` and return cached data on subsequent warm invocations. A common pattern is a simple in-memory cache built on top of `/tmp` files, where you check whether the cache is valid, and if so, return the cached result rather than recomputing or re-querying.

Build and packaging workflows benefit as well. CI/CD pipelines that run in Lambda might download source code, run build steps, and stage compiled artifacts in `/tmp` before uploading them to S3 or publishing them to registries. The amount of temporary space needed during these builds can easily exceed the default 512 MB.

### Alternatives to Consider: EFS for Shared Persistence

It's important to acknowledge that `/tmp` isn't always the right choice. Lambda can mount Amazon EFS (Elastic File System), which provides persistent, shared storage across multiple function executions and even across different functions. If you need truly persistent storage that survives environment recycling, or if you need multiple concurrent Lambda functions to access and modify the same files, EFS is the appropriate tool.

However, EFS has different performance characteristics and cost implications than `/tmp`. EFS involves network latency (even though it's optimized for low latency), and you pay for provisioned throughput and storage capacity regardless of whether you're actively using it. For workloads where you want true persistence or shared access across functions, EFS is excellent. For ephemeral, function-specific temporary storage, `/tmp` is faster and often more cost-effective.

The decision often comes down to whether you need persistence beyond the function's execution environment. If you do, EFS is worth considering. If you just need temporary space within a single function invocation or across warm invocations of the same environment, `/tmp` is simpler and faster.

### Best Practices and Patterns

Start by monitoring your actual storage usage. Don't blindly allocate 10 GB because it's available; understand what your functions actually need. Use CloudWatch Logs to instrument your code and track `/tmp` utilization, then right-size your allocation accordingly. You can write a simple function that checks available disk space and logs it at the start of each invocation:

```python
import os
import shutil

def lambda_handler(event, context):
    stat = shutil.disk_usage('/tmp')
    available_mb = stat.free / (1024 * 1024)
    print(f"Available /tmp space: {available_mb:.2f} MB")
    # ... rest of your function logic
```

Clean up explicitly. Don't rely on environment recycling to clean up `/tmp`. If your function creates temporary files, delete them when you're done. This is both a best practice for resource management and a security practice for sensitive data.

Consider the persistence of `/tmp` in your caching strategy. If you're caching data that's expensive to compute, add versioning or timestamps so you can detect stale data and invalidate caches when necessary. For example, if you're caching an external API response, store the timestamp of when you fetched it and refresh if it's older than some threshold.

Implement error handling that accounts for disk space exhaustion. If your function unexpectedly runs out of `/tmp` space, it might fail in cryptic ways. Add explicit checks and handle the error gracefully:

```python
import os
import tempfile

def lambda_handler(event, context):
    try:
        # Do your work
        with tempfile.NamedTemporaryFile(dir='/tmp') as f:
            # Write to the file
            pass
    except OSError as e:
        if "No space left on device" in str(e):
            print("Ephemeral storage exhausted")
            # Handle gracefully—clean up or fail fast
            raise
```

### Monitoring and Optimization

CloudWatch provides metrics that can help you understand your function's resource utilization. While there's no specific metric for `/tmp` usage, you can instrument your code to track it. Combine this with Lambda's built-in memory utilization metrics to get a complete picture of your function's resource footprint.

X-Ray can help you visualize the performance characteristics of your functions, including the latency impact of downloading large files or loading models. If you notice that the first invocation after an environment recycling is significantly slower than warm invocations, that's a signal that you're benefiting from caching in `/tmp`.

### Conclusion

Lambda's `/tmp` ephemeral storage is a powerful but often overlooked tool in the serverless architect's toolkit. The default 512 MB is sufficient for lightweight workloads, but for functions that handle larger files, cache expensive computations, or load complex models, expanding the allocation to several gigabytes can dramatically improve performance and reduce costs. Understanding the distinction between the included 512 MB and additional storage beyond that—both in terms of cost and mechanics—allows you to make informed decisions about when to use `/tmp` versus alternatives like EFS.

The key to using `/tmp` effectively is treating it as what it is: a fast, local cache that persists across warm invocations but isn't guaranteed to be present on every cold start. Design your functions with this model in mind, monitor actual usage, and size your allocation based on real data rather than guesswork. Done right, `/tmp` becomes an invisible but powerful optimization that makes your Lambda functions faster, more efficient, and ultimately more cost-effective.
