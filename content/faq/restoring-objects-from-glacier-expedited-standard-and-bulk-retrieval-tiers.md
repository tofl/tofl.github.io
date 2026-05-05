---
title: "Restoring Objects from Glacier: Expedited, Standard, and Bulk Retrieval Tiers"
---

## Restoring Objects from Glacier: Expedited, Standard, and Bulk Retrieval Tiers

When you archive data to AWS Glacier, you're making a deliberate trade-off: lower storage costs in exchange for longer retrieval times. But "longer" doesn't mean you're stuck waiting days for every file. AWS offers three distinct retrieval tiers that let you choose the speed-cost balance that fits your needs. Understanding these tiers—and how to use them correctly—is essential for building cost-effective storage strategies and passing your AWS developer certification.

In this article, we'll explore how Glacier retrieval works, examine each retrieval tier in detail, and walk through the practical mechanics of restoring objects using the RestoreObject API. Whether you're dealing with Glacier Flexible Retrieval or the deeper archive of Glacier Deep Archive, you'll come away with the knowledge to make smart retrieval decisions.

### Understanding Glacier Storage Classes and Why Retrieval Matters

Before we talk about retrieval, let's establish why it matters. S3 offers two Glacier storage classes: Glacier Flexible Retrieval and Glacier Deep Archive. Both are designed for infrequent access and long-term archival. Glacier Flexible Retrieval costs less per gigabyte than standard S3 but more than Deep Archive. Deep Archive is the cheapest option but expects the longest wait times for retrieval.

The key insight is this: objects in Glacier are not immediately available for download. They're in a cold storage state optimized for durability and cost, not for speed. When you need an object, you must explicitly request its restoration. AWS then retrieves it from cold storage, places a temporary copy in S3 Standard for a number of days you specify, and charges you per gigabyte for that retrieval.

This restore process is where the three retrieval tiers come into play.

### The Three Retrieval Tiers Explained

#### Expedited Retrieval: When You Need It Fast

Expedited retrieval is the fastest option, ideal for urgent scenarios. For Glacier Flexible Retrieval, expedited restoration completes within one to five minutes. For Glacier Deep Archive, expedited restoration takes up to twelve hours. (Yes, Deep Archive's "expedited" is still measured in hours—that's the nature of deep archival storage.)

The speed comes at a premium. Expedited retrieval costs significantly more per gigabyte than standard or bulk options. However, if you're recovering from an unexpected data loss or need a file urgently, the extra cost is often worthwhile.

Here's an important caveat: expedited retrieval capacity is shared across all AWS customers in your region. If there's a surge in demand, AWS may not be able to guarantee expedited retrieval in rare situations. If you absolutely need guaranteed expedited throughput—say, for a mission-critical recovery process—you can purchase provisioned capacity.

#### Standard Retrieval: The Balanced Middle Ground

Standard retrieval is the default option and the most cost-effective for most use cases. For Glacier Flexible Retrieval, standard restoration takes three to five hours. For Glacier Deep Archive, it takes twelve hours. Standard retrieval costs less per gigabyte than expedited but more than bulk.

Most recovery scenarios fall into this category. You know you'll need the data, but you can wait a few hours. This tier represents a reasonable balance between speed and cost.

#### Bulk Retrieval: Maximum Savings for Patient Waits

Bulk retrieval is the slowest and cheapest option. For Glacier Flexible Retrieval, bulk restoration takes five to twelve hours. For Glacier Deep Archive, bulk retrieval takes forty-eight hours. Bulk is ideal when you're processing large amounts of data and can tolerate significant latency.

Imagine you're migrating petabytes of historical data from Glacier to a data warehouse. Bulk retrieval lets you restore everything at minimal cost, and you don't care if it takes two days.

### Provisioned Capacity: Guaranteeing Expedited Throughput

By default, expedited retrieval requests are fulfilled on a best-effort basis. In extremely rare circumstances, during periods of exceptional demand, AWS cannot guarantee expedited capacity will be available.

If your business requires guaranteed expedited retrieval—for example, if you have a disaster recovery system that depends on restoring large volumes of data within minutes—you can purchase provisioned capacity. This guarantees that your expedited requests will succeed.

Provisioned capacity is sold in units, and each unit provides a guaranteed three hundred megabytes per second of retrieval throughput for expedited requests. You pay an upfront cost for the capacity for a one-month term, regardless of whether you use it. This is a commitment-based pricing model, similar to Reserved Instances.

Most developers won't need provisioned capacity. Reserve it for cases where the business impact of retrieval failure is truly severe.

### How the Restore Process Works

When you initiate a restore request, here's what happens behind the scenes:

First, you submit a RestoreObject request specifying the retrieval tier, the number of days you want the restored copy to remain accessible, and optionally a description of the restore job.

AWS then retrieves the object from Glacier storage—this takes anywhere from one minute to forty-eight hours depending on your chosen tier.

Once retrieved, AWS places a temporary copy of the object in S3 Standard storage. This copy is available for normal S3 access (GET requests, downloads, etc.). The restored object exists alongside your original Glacier copy; you're not moving the data, you're creating a temporary duplicate.

The temporary copy persists for the number of days you specified—typically between one and thirty-five days. After that period expires, the temporary copy is automatically deleted. Your original object remains in Glacier.

During this period, you pay both the original Glacier storage cost and the S3 Standard storage cost for the temporary copy. This is why specifying the minimum number of days you need is important; it reduces unnecessary storage costs.

### Understanding Retrieval Costs

AWS charges per gigabyte for restoration from Glacier. The cost varies by retrieval tier and storage class.

For Glacier Flexible Retrieval, expedited retrieval is the most expensive, standard is moderate, and bulk is the cheapest. Deep Archive follows the same pattern but with different absolute prices (generally lower than Flexible Retrieval).

Let's say you're restoring a fifty-gigabyte object from Glacier Flexible Retrieval using standard retrieval. You'll pay a per-gigabyte fee for the restoration operation itself. Then, while the restored copy sits in S3 Standard, you'll pay S3 Standard storage rates. If you keep it for ten days, you'll pay ten days' worth of S3 Standard storage fees for fifty gigabytes. After those ten days, the copy is deleted automatically, and you only pay Glacier storage rates for the original.

This means restoring large objects for extended periods can become expensive. Always balance speed against the cost of holding data in S3 Standard.

### Tracking Restore Status

When you initiate a restore, the object transitions to a "restoring" state. You can check the status by retrieving the object's metadata using the HeadObject API call. The response includes the RestoreStatus field, which tells you whether the restore is in progress, and when it will be complete.

Additionally, S3 can send you event notifications through S3 Event Notifications when a restore completes. You can configure S3 to publish events to an SNS topic, SQS queue, or Lambda function, allowing your application to react automatically when data becomes available.

### Practical Example: Restoring an Object

Let's walk through a concrete example using the AWS SDK. Here's how you'd restore an object from Glacier using Python and boto3:

```python
import boto3
from datetime import datetime, timedelta

s3_client = boto3.client('s3')

bucket_name = 'my-archive-bucket'
object_key = 'important-data/backup-2023.tar.gz'

# Calculate restore expiration: 7 days from now
restore_days = 7
expiration = datetime.utcnow() + timedelta(days=restore_days)

# Initiate the restore using standard tier
try:
    response = s3_client.restore_object(
        Bucket=bucket_name,
        Key=object_key,
        RestoreRequest={
            'Days': restore_days,
            'GlacierJobParameters': {
                'Tier': 'Standard'  # Options: 'Expedited', 'Standard', 'Bulk'
            },
            'Description': 'Restoring backup for data analysis'
        }
    )
    print(f"Restore request submitted. Request ID: {response['ResponseMetadata']['RequestId']}")
except Exception as e:
    print(f"Error initiating restore: {e}")

# Check the restore status
try:
    head_response = s3_client.head_object(
        Bucket=bucket_name,
        Key=object_key
    )
    
    # Check if restore is in progress
    if 'RestoreStatus' in head_response:
        restore_status = head_response['RestoreStatus']
        print(f"Restore Status: {restore_status}")
        # Output example: {'IsRestoring': True, 'ExpiryDate': datetime.datetime(...)}
    else:
        print("Object is not currently being restored.")
        
except Exception as e:
    print(f"Error checking restore status: {e}")
```

In this example, we're restoring an object from Glacier using the Standard tier with a seven-day retention window. The restore will typically complete within three to five hours for Glacier Flexible Retrieval.

If you wanted to use expedited retrieval instead, you'd simply change the `'Tier'` value to `'Expedited'`. For bulk retrieval, you'd use `'Bulk'`.

Here's another example showing how to use provisioned capacity (if you've purchased it):

```python
# Restore using provisioned capacity (for guaranteed expedited throughput)
response = s3_client.restore_object(
    Bucket=bucket_name,
    Key=object_key,
    RestoreRequest={
        'Days': 7,
        'GlacierJobParameters': {
            'Tier': 'Expedited'
        }
    }
)
```

With provisioned capacity purchased, your expedited request is guaranteed to succeed.

### Best Practices for Glacier Restoration

**Choose the right tier based on your timeline, not your preferences.** If you can wait five to twelve hours, use bulk retrieval and save money. Reserve expedited for genuine emergencies.

**Specify the minimum number of days needed.** Every extra day of S3 Standard storage costs money. If you only need the data for three days, don't request thirty-five.

**Monitor restore operations.** Use CloudWatch metrics or S3 Event Notifications to track when restores complete. Automate the next step of your workflow to begin immediately when data becomes available.

**Consider your retrieval patterns.** If you frequently restore from Glacier, you might be storing the wrong data in Glacier in the first place. Evaluate whether S3 Standard Infrequent Access (S3 Standard-IA) might be more appropriate.

**Test your restoration process.** Before you depend on Glacier restoration in production, restore a test object and verify the timing. Expedited retrieval is fast, but it's not instantaneous.

**Calculate total costs carefully.** The per-gigabyte retrieval fee plus temporary S3 Standard storage can add up quickly for large objects. Use the AWS Pricing Calculator to model your scenarios.

### Conclusion

Glacier restoration is straightforward once you understand the three tiers and how costs work. Expedited retrieval gets your data back in minutes to hours, standard retrieval offers a balanced approach within a few hours, and bulk retrieval minimizes costs when time isn't a constraint. Provisioned capacity is available if you need guaranteed expedited throughput for critical scenarios.

The RestoreObject API makes initiating a restore simple, and you can track progress through HeadObject calls or event notifications. By choosing the appropriate retrieval tier and retention window for each restore, you'll keep your data accessible without overspending on retrieval operations.

As you work with S3 and archival storage in your AWS projects, remember that the cost savings from Glacier storage only make sense if you've thought through your retrieval strategy. Plan your restores with the same care you put into choosing your storage class.
