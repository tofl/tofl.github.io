---
title: "S3 Strong Consistency Model Explained: What Changed in 2020"
---

## S3 Strong Consistency Model Explained: What Changed in 2020

Amazon S3 has been the bedrock of cloud object storage for nearly two decades, but for most of that time, developers had to navigate a tricky consistency model that often felt counterintuitive. In December 2020, AWS made a significant change that fundamentally shifted how S3 handles data consistency. What once required careful architectural workarounds and defensive coding patterns is now straightforward. Understanding this evolution—and what it means for your applications—is essential for anyone working with S3 today.

### What Happened in December 2020

Before December 2020, S3 offered what AWS called "eventual consistency" for overwrites and deletes. This meant that if you wrote an object and immediately tried to read it back, you might get the old version (or no object at all if you were reading after a delete). The consistency guarantee only applied to new object creations—a PUT to a key that didn't previously exist would be immediately readable.

In December 2020, AWS upgraded S3 to provide **read-after-write strong consistency** for all operations, including PUT, DELETE, and conditional PUT requests. This change applied automatically and globally across all S3 buckets—no configuration or opt-in required. What this means in practice is profound: the moment a write operation succeeds, subsequent reads will reflect that change. Delete operations also follow this pattern; once a DELETE completes, the object is immediately gone from all reads.

### Understanding Strong Consistency in Practice

Let's ground this in concrete behavior. Imagine you're building a web application that stores user profile data in S3. A user updates their avatar, and your application performs a PUT operation to upload the new image. Under the old eventually consistent model, there was a window—potentially lasting seconds—where subsequent GET requests might return the old image. Your application would need defensive logic to handle this: retries, explicit waits, or reading from a cache until consistency was guaranteed.

With the new strong consistency model, that concern evaporates. The moment the PUT succeeds (you receive a 200 response), the next GET to that same object key will return the new data. This simplification cascades through your application architecture. You can remove retry loops designed to work around eventual consistency. You don't need to maintain a secondary consistency layer or add artificial delays before reading newly written objects.

The same principle applies to DELETE operations. When you delete an object and receive a successful response, subsequent GET requests will immediately return a 404 (or, in the context of a list operation, the object won't appear). This means you can write code that assumes immediate effect without worrying about stale reads after deletion.

### How List Operations Fit In

The strong consistency model also extends to list operations, which is particularly important for certain application patterns. When you call `ListObjects` or `ListObjectsV2` after uploading an object, the newly uploaded object will immediately appear in the results. Similarly, if you delete an object and subsequently list the bucket, that object won't show up.

This is more than a convenience—it's critical for applications that rely on discovering new objects. Consider a batch processing system where workers poll an S3 bucket for jobs uploaded by a queue system. Under eventual consistency, a worker might check the bucket, find no new jobs, and exit, only to have jobs appear moments later when consistency caught up. With strong consistency, once a job is uploaded, the next list operation will find it.

### Consistency and Overwrite Operations

One nuance worth understanding is that strong consistency applies specifically to overwrites of existing objects. When you PUT a new version of an object that already exists, strong consistency ensures that the next read returns the new version. This is where the old behavior was most problematic.

Before the change, if you had an object at `data/config.json` containing version 1, and you overwrote it with version 2, reads immediately following the successful PUT might still return version 1. This wasn't a rare edge case—it was a documented behavior that affected real applications. Developers working with configuration files, metadata, or any frequently-updated objects had to build around this limitation.

### Versioning and Consistency

S3 versioning introduces an important dimension to consistency discussions. When you enable versioning on a bucket, each object automatically gets a version ID. Here's where it gets interesting: strong consistency applies to all versions as well. If you write an object with versioning enabled, you get a version ID back. Immediately reading that specific version ID will return the data you just wrote.

If you're working with versioned objects and you want the latest version, a GET without specifying a version ID will return the current version—consistent with what you just wrote. The strong consistency model means you no longer need to poll or wait to confirm that a new version is the current version.

One scenario where this clarity matters: imagine an application that updates a versioned configuration object and needs to broadcast the new version ID to multiple consumers. With strong consistency, you can include the version ID in your message with confidence that consumers can immediately read that specific version without encountering "not found" errors.

### Implications for Application Design

The shift to strong consistency has profound implications for how you design applications. First, it eliminates an entire class of bugs. You no longer need to account for the window where a write has succeeded but reads return old data. This simplifies testing, reduces edge cases, and makes application behavior more predictable.

Second, it changes how you approach read-after-write workflows. A common pattern in the eventual consistency era was the "read-modify-write" loop with retries. You'd write an object, read it back, and if the data didn't match, you'd assume it hadn't replicated yet and retry. This pattern is now unnecessary. If a write succeeds and you read immediately, you get your data back.

Third, it enables more straightforward distributed systems architectures. S3 was often used as a coordination point between services—one service would write a file, another would look for it and process it. This worked but required careful coordination around consistency windows. With strong consistency, these handoff patterns become much more robust.

### What About Global Replication and Consistency?

Strong consistency within a region is the default behavior. S3 handles replication within a region transparently and consistently. However, if you're using S3 Cross-Region Replication (CRR) or S3 Multi-Region Access Points, you're explicitly introducing a distributed system with its own timing considerations. The strong consistency guarantee applies within each region independently—the replicated copies in other regions will eventually become consistent, but that's governed by replication speed, not the S3 consistency model itself.

If your application depends on data being available in a specific other region immediately after writing, you'll need to handle that through your application logic, possibly by writing to multiple regions directly or by polling the destination region until replication completes. Strong consistency doesn't change the inherent nature of geographic replication—it just means you have consistent behavior within each region.

### The Business of Backward Compatibility

An interesting aspect of this change is that AWS deployed it universally without requiring any configuration or opt-in. This was possible because strong consistency is a superset of eventual consistency—code that worked correctly under eventual consistency works just fine under strong consistency. In fact, it often works *better* because edge cases disappear.

There is no scenario where the new behavior breaks existing applications. Code that added defensive retries and waits may become overly cautious (wasting a bit of time with unnecessary waits), but it won't break. This is why you might still encounter legacy code or architectural patterns designed around eventual consistency—they're simply no longer necessary, not harmful.

### Practical Considerations for Your Code

When you're writing applications today, you can assume strong consistency and simplify your code accordingly. If you're uploading a configuration file and then reading it back, you can do so sequentially without special handling:

```python
# Upload new configuration
s3_client.put_object(
    Bucket='my-config-bucket',
    Key='app-config.json',
    Body=json.dumps(new_config)
)

# Read it back immediately - guaranteed to get what we just wrote
response = s3_client.get_object(
    Bucket='my-config-bucket',
    Key='app-config.json'
)
config = json.loads(response['Body'].read())
```

This pattern is now safe and reliable. Under the old model, this would sometimes fail—the read might return old data or throw a NoSuchKey exception even though the write succeeded.

Similarly, when checking for object existence after a delete:

```python
# Delete an object
s3_client.delete_object(
    Bucket='my-bucket',
    Key='temporary-file.txt'
)

# Check that it's gone
try:
    s3_client.head_object(Bucket='my-bucket', Key='temporary-file.txt')
    # Object exists - this won't happen
except s3_client.exceptions.NoSuchKey:
    # Object definitely doesn't exist
    pass
```

Again, this now behaves as you'd expect. The object is immediately gone after deletion.

### Consistency in Multi-Object Operations

It's worth noting that strong consistency applies per-object, not atomically across multiple objects. If you're performing a batch upload of ten objects, each individual object follows the strong consistency model—once a PUT returns successfully, that object is consistent. However, there's no atomic guarantee that all ten objects are visible in list operations simultaneously.

In practice, this distinction rarely matters because list operations are typically bounded by their execution time, and S3's internal replication is fast. But in high-throughput systems uploading many objects per second, you might theoretically encounter a list operation that shows nine of your ten new objects. This is an edge case, but understanding it helps you build appropriately resilient batch processing systems.

### Conclusion

The December 2020 shift to strong consistency in S3 represents a maturation of one of AWS's most fundamental services. What was once a constraint that shaped application architecture is now a non-issue. Developers today benefit from simpler, more intuitive code that doesn't require defensive patterns for handling eventual consistency windows.

When you're designing applications with S3, you can now assume that write operations are immediately readable and deletions are immediately effective. This doesn't mean S3 is magical—it's still a distributed system with its own performance characteristics and trade-offs. But it means those trade-offs are now more favorable for most common application patterns.

As you work with S3 or encounter interview questions about its consistency model, remember that the baseline assumption is strong consistency. If you're working on code that includes workarounds for eventual consistency, it might be worth revisiting those patterns. Modern S3 is simpler and more predictable than it once was, and your applications can be too.
