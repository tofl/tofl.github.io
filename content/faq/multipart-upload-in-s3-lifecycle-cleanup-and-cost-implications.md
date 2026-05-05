---
title: "Multipart Upload in S3: Lifecycle, Cleanup, and Cost Implications"
---

## Multipart Upload in S3: Lifecycle, Cleanup, and Cost Implications

Amazon S3 multipart upload is one of those features that seems straightforward on the surface—split a file into chunks, upload them in parallel, and you're done. But scratch that surface, and you'll find hidden costs, orphaned data, and subtle configuration decisions that can either optimize your storage costs or quietly drain your budget. Whether you're uploading large video files, database backups, or machine learning datasets, understanding how multipart uploads work from creation through completion—and what happens when they go wrong—is essential for building reliable, cost-effective applications on AWS.

In this article, we'll go beyond the basics and explore the complete lifecycle of S3 multipart uploads, including the APIs you'll interact with, the common pitfalls that catch developers off guard, and the practical strategies for managing uploads at scale.

### Understanding the S3 Multipart Upload API

S3 multipart upload is fundamentally a three-step dance. Understanding each step clearly will help you reason about what happens at each stage and why certain configurations matter.

The first step is **CreateMultipartUpload**. When you initiate a multipart upload, S3 creates a container for your upload and returns a unique upload ID. This ID is your ticket to upload individual parts. Behind the scenes, S3 is reserving resources and preparing to track which parts you send. The upload ID itself doesn't consume storage yet—it's metadata. However, from this point forward, you're on the clock. If you initiate an upload but never complete it, those reserved resources (and the upload ID record) will persist in S3 until you either complete the upload or explicitly abort it.

The second step involves **UploadPart**, called repeatedly as you send each chunk of your file. Each part is identified by a part number (ranging from 1 to 10,000) and must be at least 5 MB in size—except for the final part, which can be smaller. This constraint exists by design: it encourages efficient parallel transfers while maintaining backward compatibility with S3's architecture. When you upload a part, S3 calculates and returns an ETag (a checksum-like identifier for that part), which you'll need to provide when completing the upload.

The third step is **CompleteMultipartUpload**. You provide the upload ID and a list of part numbers with their corresponding ETags. S3 verifies that all parts are present and valid, then assembles them into the final object. Only after this step is the object visible to the rest of your application and billable as completed storage.

### The Hidden Cost of Incomplete Uploads

Here's where many developers encounter an unpleasant surprise: incomplete multipart uploads are still billed.

Imagine you initiate a multipart upload, send five parts (each 100 MB), and then your application crashes or the network connection drops before you call CompleteMultipartUpload. Those five parts remain in S3, occupying 500 MB of storage, and you'll be charged for that storage at your standard S3 rate—just as if they were parts of a completed object. Meanwhile, the upload is invisible to the S3 List Objects operations; you can't see it when you browse your bucket through the console or API, and you certainly can't download it. It's orphaned data, silently accumulating charges.

This situation is surprisingly common in production systems, especially those handling high-volume uploads. Network timeouts, process crashes, scaling events, or simply bugs in upload logic can leave incomplete uploads scattered across your bucket. At scale—imagine thousands of concurrent uploads in a data processing pipeline—this orphaned data can easily add up to significant unplanned costs.

The key insight is that incomplete multipart uploads are not the same as failed uploads. A failed upload is one that was never initiated. An incomplete upload is one that was initiated but not finalized, leaving behind artifacts that consume real storage.

### Lifecycle Rules: Automatic Cleanup with AbortIncompleteMultipartUpload

AWS provides a purpose-built mechanism for cleaning up incomplete multipart uploads: the **AbortIncompleteMultipartUpload** action within S3 Lifecycle policies. This is not a reactive bandage; it's a proactive, automatic cleanup strategy that should be part of your standard S3 bucket configuration.

A lifecycle rule with this action will automatically terminate any multipart upload that remains incomplete for a specified number of days. Here's what a typical configuration looks like in AWS CloudFormation or the AWS CLI:

```json
{
  "Rules": [
    {
      "Id": "AbortIncompleteMultipartUpload",
      "Status": "Enabled",
      "AbortIncompleteMultipartUpload": {
        "DaysAfterInitiation": 7
      }
    }
  ]
}
```

In this example, any multipart upload that hasn't been completed or explicitly aborted within 7 days will be automatically terminated by S3. The parts associated with that upload are deleted, and you stop being charged for their storage. The 7-day threshold is arbitrary—adjust it based on your use case. For high-velocity systems with rapid upload cycles, you might use 1 day. For long-running batch jobs, you might use 14 days or more.

The beauty of this approach is that it's completely automatic. You don't need to poll S3, write cleanup scripts, or add custom monitoring. S3 handles the cleanup on a schedule, and you can rest assured that orphaned uploads won't accumulate indefinitely.

To apply this rule to an existing bucket using the AWS CLI, you'd use:

```bash
aws s3api put-bucket-lifecycle-configuration \
  --bucket my-bucket \
  --lifecycle-configuration file://lifecycle.json
```

### Listing In-Progress Uploads with ListMultipartUploads

While lifecycle rules provide automatic cleanup, visibility into what's happening in your bucket is equally important. The **ListMultipartUploads** operation gives you a window into all currently active multipart uploads on a given bucket or prefix.

This API is useful for debugging, monitoring, and understanding upload patterns. For example, if you're troubleshooting why a particular upload seems stuck, or if you're building a dashboard to track upload health, ListMultipartUploads is your tool.

Here's how you'd call it:

```bash
aws s3api list-multipart-uploads --bucket my-bucket
```

The response includes details about each in-progress upload: the key (object name), the upload ID, the initiation time, and the initiator. If you have many concurrent uploads, you can filter by prefix:

```bash
aws s3api list-multipart-uploads --bucket my-bucket --prefix logs/2024/
```

This operation doesn't show you the individual parts that have been uploaded; for that, you'd use **ListParts** with a specific upload ID. ListParts is helpful when you're resuming an interrupted upload and need to know which parts are already on S3 to avoid re-uploading them.

### Part Size Constraints and Upload Limits

S3 imposes specific constraints on multipart uploads, and understanding these limits is crucial for designing robust upload workflows.

Each part (except the last) must be at least 5 MB. This is a hard floor—if you try to upload a part smaller than 5 MB, S3 will reject it with an error. The 5 MB minimum exists to ensure efficient storage and indexing; it discourages overly granular uploads that would create management overhead. However, there's no upper limit on individual part size; you could upload a single part that's multiple gigabytes if you wanted.

You can have a maximum of 10,000 parts per upload. This means the largest object you can upload is theoretically 10,000 parts times your part size. AWS recommends part sizes between 100 MB and 5 GB for optimal performance. With 10,000 parts at 5 GB each, you're looking at a 50 TB object—which is also the documented maximum object size in S3. This rarely matters in practice for most applications, but it's good to know your bounds.

The part number must be between 1 and 10,000. You don't need to upload parts in order, and you don't need to upload all parts from the same process or even the same server. This flexibility is powerful—it means you can resume uploads from different machines, implement redundant upload clients, or split the work across a distributed system.

### How the SDK Abstracts Complexity

All of this—CreateMultipartUpload, UploadPart loops, ETags, retries, and CompleteMultipartUpload—sounds like a lot of manual orchestration. Fortunately, AWS SDKs provide high-level abstractions that handle much of this complexity for you.

The AWS SDK for Python (boto3) includes a **transfer manager** that automatically uses multipart upload for large files and handles the entire workflow transparently. When you use `boto3.client('s3').upload_file()`, the SDK examines the file size and automatically switches to multipart upload if it exceeds a configurable threshold (default is 8 MB). The parts are uploaded in parallel using a thread pool, and ETags are collected and passed to CompleteMultipartUpload automatically.

Here's a simple example:

```python
import boto3

s3_client = boto3.client('s3')
s3_client.upload_file('local_file.bin', 'my-bucket', 'remote_key')
```

Behind the scenes, if `local_file.bin` is larger than 8 MB, the SDK is already running multipart upload with sensible defaults (part size around 8 MB, 10 concurrent threads). You get parallelism and resilience without writing any multipart logic yourself.

For more control, you can configure the transfer manager directly:

```python
from boto3.s3.transfer import S3Transfer, TransferConfig

config = TransferConfig(
    multipart_threshold=1024 * 25,  # 25 MB threshold
    max_concurrency=20,
    multipart_chunksize=1024 * 50,  # 50 MB parts
    max_in_memory_upload_chunks=10,
    max_bandwidth=100 * 1024 * 1024,  # 100 MB/s limit
)

transfer = S3Transfer(s3_client, config=config)
transfer.upload_file('local_file.bin', 'my-bucket', 'remote_key')
```

This level of control is useful when you're optimizing for specific scenarios—slower networks might benefit from smaller part sizes and lower concurrency, while fast networks with ample bandwidth can use larger parts and more threads.

The JavaScript SDK (AWS SDK for JavaScript / v3) provides similar abstractions through the `Upload` class or the higher-level `@aws-sdk/lib-storage` package. The Java SDK offers the `TransferManager` and `TransferManagerConfiguration` for comparable functionality. Regardless of your language, the principle is the same: the SDK handles the multipart details so you can focus on application logic.

### Designing for Upload Reliability

Understanding these mechanics helps you design more reliable upload systems. Here are some practical considerations:

**Set appropriate lifecycle policies on all production buckets.** Even if you think your upload code is bulletproof, external factors (network failures, out-of-memory conditions, deployment events) can leave incomplete uploads. A lifecycle rule with `AbortIncompleteMultipartUpload` set to 1-7 days is cheap insurance.

**Monitor with ListMultipartUploads.** Add periodic checks to your observability pipeline. If you suddenly see thousands of in-progress uploads that aren't completing, that's a signal that something is wrong upstream—perhaps your upload logic has a bug, or your network has degraded. Early detection prevents large bills.

**Choose part sizes thoughtfully.** Larger parts (100 MB to 1 GB) reduce the number of API calls and are more efficient for fast networks with low latency. Smaller parts (5-50 MB) are better for unreliable networks because fewer parts mean less data to re-upload if a transfer fails. The SDK's defaults are reasonable for most cases, but don't be afraid to tune them for your specific environment.

**Implement idempotency in your upload workflows.** Multipart upload is inherently idempotent for the final step—you can call CompleteMultipartUpload multiple times with the same upload ID, and S3 will return success (idempotency is built in). Use this to your advantage. If your application isn't sure whether CompleteMultipartUpload succeeded, retry it without fear of creating duplicate objects.

**Use tags and metadata to track uploads.** When you initiate a multipart upload, you can attach metadata and tags. Use these to link uploads back to your application's business context—a request ID, timestamp, or job identifier. This makes debugging and auditing much easier.

### Cost Implications and Best Practices

Multipart uploads have subtle cost implications beyond the obvious storage charges. API calls have costs in some scenarios (though S3 API calls are generally very cheap). More importantly, incomplete uploads can silently inflate your storage bill. A single production bucket with high upload volume can easily accumulate megabytes or gigabytes of orphaned parts per day if you're not careful.

The cost of implementing automatic cleanup is essentially zero—it's a bucket configuration with no additional charges. The cost of not doing so can be significant. In terms of pure cost-benefit analysis, enabling `AbortIncompleteMultipartUpload` on every S3 bucket is a no-brainer.

Beyond cleanup, consider the cost-performance tradeoff of part size. Smaller parts mean more API calls and smaller bandwidth utilization per connection, but they also mean more granular recovery in case of failure. Larger parts mean fewer API calls and better bandwidth utilization, but failures are more costly. Most applications find their sweet spot somewhere in the 50-500 MB range.

### Conclusion

S3 multipart upload is a powerful mechanism for reliable, efficient data transfer at scale. The three-step API—CreateMultipartUpload, UploadPart, and CompleteMultipartUpload—provides the building blocks, but the real craft lies in understanding the edge cases: incomplete uploads that accumulate silently, lifecycle policies that prevent orphaned data, and SDK abstractions that let you focus on what matters.

As you work with S3 in production, remember that multipart upload is not a "set and forget" feature. Incomplete uploads *will* happen—not because of carelessness, but because of the inherent unreliability of networks and distributed systems. The question is whether you've planned for it. Lifecycle rules are cheap insurance. ListMultipartUploads is your visibility into what's happening. And the SDK's transfer manager is your ally in keeping the complexity manageable.

By internalizing these concepts, you'll build S3 workflows that are not only faster and more resilient, but also easier to reason about and cheaper to operate. That's the mark of solid AWS architecture.
