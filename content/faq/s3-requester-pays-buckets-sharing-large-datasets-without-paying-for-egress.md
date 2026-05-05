---
title: "S3 Requester Pays Buckets: Sharing Large Datasets Without Paying for Egress"
---

## S3 Requester Pays Buckets: Sharing Large Datasets Without Paying for Egress

Imagine you've built a massive dataset—maybe genomic research data, satellite imagery, or comprehensive application logs—that you want to share with the world. You believe the data has significant value for researchers, analysts, and developers. But there's a catch: serving that data costs money. In AWS, data transfer out of S3 can add up quickly, especially when you're talking about terabytes or petabytes. Do you really want to foot the bill while others benefit from your generosity?

This is where S3 Requester Pays buckets become invaluable. Instead of the bucket owner absorbing the cost of serving data, the person or application requesting the data pays for the retrieval and transfer. It's a simple but powerful inversion of responsibility that opens up new possibilities for sharing data at scale without breaking your budget.

### Understanding the Economics of S3 Data Transfer

Before diving into how Requester Pays works, it helps to understand why this feature exists in the first place. AWS charges for data egress—that is, data leaving an S3 bucket—in most scenarios. The amount varies depending on your region and the destination, but it's typically around $0.09 per GB for data transferred outside AWS or to the internet. If you're serving a 100 TB dataset and a thousand researchers each download a copy, you're suddenly looking at a six-figure bill.

The traditional model assumes the data owner has both the incentive and the financial capacity to pay these costs. But that assumption breaks down in many real-world scenarios. Universities hosting research datasets, open data initiatives, and companies distributing large reference files often want to share their work without shouldering indefinite egress charges. Requester Pays flips the equation: now it's economically feasible for anyone with valuable data to publish it openly.

### How Requester Pays Actually Works

When you enable Requester Pays on an S3 bucket, you're telling AWS: "Anyone who wants to read data from this bucket must explicitly acknowledge that they will pay for the request and data transfer." This acknowledgment happens through a specific HTTP header included in the request.

The bucket owner still owns and controls the bucket, manages its access policies, and stores the data. But starting from the moment someone enables Requester Pays, every GET request, HEAD request, and data transfer is charged to the requester's AWS account instead of the bucket owner's account. The requester sees these charges in their own billing statement.

This arrangement only works if the requester has an AWS account. If someone tries to access a Requester Pays bucket without an AWS account, the request is rejected. This is a fundamental limitation: the feature requires both parties to be customers of AWS so that charges can be properly attributed and billed.

### When to Use Requester Pays

Requester Pays isn't appropriate for every bucket, and AWS doesn't recommend enabling it as a default practice. Instead, it's a specialized tool for specific scenarios where the cost structure makes sense.

**Large public datasets** are the primary use case. If you're maintaining a reference dataset for your research community, a machine learning dataset for training models, or a collection of historical market data, Requester Pays lets you share this at scale. Academic institutions frequently use this pattern to distribute datasets to researchers worldwide without running up massive AWS bills.

**Distributed log archives** represent another common scenario. Imagine your organization needs to retain logs for compliance or analysis, but different teams or external auditors need access to specific subsets. Instead of centralizing egress costs, you can enable Requester Pays and let each team pay for accessing the logs they actually use.

**Data sharing between AWS accounts** can also benefit from Requester Pays, especially in multi-tenant scenarios or partnerships. If your organization provides data or services to customers, enabling Requester Pays shifts the cost burden appropriately: customers pay for data they consume.

In contrast, you wouldn't enable Requester Pays for buckets where you want to minimize friction for users, such as a public website's CDN origin or a production application's data store. You also wouldn't use it for private buckets where your own applications need to access data—that would just increase your costs unnecessarily.

### Enabling Requester Pays on a Bucket

Enabling the feature is straightforward, though you'll need the right permissions. From the AWS Management Console, you can navigate to your bucket's properties and toggle the Requester Pays setting. Alternatively, you can use the AWS CLI:

```bash
aws s3api put-bucket-request-payment \
  --bucket my-dataset-bucket \
  --request-payment-configuration RequestPayer=Requester
```

To verify that Requester Pays is enabled:

```bash
aws s3api get-bucket-request-payment --bucket my-dataset-bucket
```

Once enabled, the behavior changes immediately. Any request that doesn't include the required acknowledgment header will be rejected with an HTTP 403 Forbidden error.

### The x-amz-request-payer Header

The magic that makes Requester Pays work is a simple HTTP header: `x-amz-request-payer`. When a requester wants to access data in a Requester Pays bucket, they must include this header with the value `requester` to acknowledge that they understand they will be charged.

If you're using the AWS CLI, you typically include the `--request-payer requester` parameter:

```bash
aws s3 cp s3://my-dataset-bucket/large-file.tar.gz . \
  --request-payer requester
```

When working with the AWS SDK for Python (Boto3), you'd pass the parameter in the client call:

```python
import boto3

s3_client = boto3.client('s3')

s3_client.get_object(
    Bucket='my-dataset-bucket',
    Key='large-file.tar.gz',
    RequestPayer='requester'
)
```

For JavaScript developers using the AWS SDK:

```javascript
const AWS = require('aws-sdk');
const s3 = new AWS.S3();

s3.getObject({
    Bucket: 'my-dataset-bucket',
    Key: 'large-file.tar.gz',
    RequestPayer: 'requester'
}, (err, data) => {
    if (err) console.log(err);
    else console.log(data);
});
```

Without this header, requests fail. This is intentional—it forces requesters to be explicit about accepting the cost model. You can't accidentally incur charges; you have to consciously include the header to proceed.

### IAM Policies and Permissions

Enabling Requester Pays at the bucket level doesn't automatically grant access to everyone. Access control still flows through the normal IAM and bucket policy mechanisms. A requester needs both the appropriate S3 permissions and the ability to include the `x-amz-request-payer` header.

If you want to allow users to access a Requester Pays bucket, you need to grant them the relevant S3 permissions. For example, to allow GET requests:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:GetObject"
      ],
      "Resource": "arn:aws:s3:::my-dataset-bucket/*"
    }
  ]
}
```

You can also use bucket policies to control who can make requests. This is useful if you want to restrict access to certain AWS accounts or IP address ranges:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "AWS": "arn:aws:iam::ACCOUNT-ID:root"
      },
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::my-dataset-bucket/*"
    }
  ]
}
```

One important distinction: a requester still needs to be an authenticated AWS customer to access a Requester Pays bucket. Anonymous requests—those without AWS credentials—are always rejected, regardless of bucket policy settings. This is why the feature works: AWS needs to know who to bill.

### Limitations and Considerations

While Requester Pays is powerful, it comes with important limitations that should shape your decision about whether to use it.

**Anonymous access is impossible.** If you want truly anonymous public access to data, Requester Pays won't work. All requesters must have AWS accounts and valid credentials. This makes the feature less suitable for scenarios where you want to share data with non-AWS users or where signup friction would be problematic.

**S3 List operations are not included.** Requester Pays affects GET and HEAD requests—the operations that actually retrieve data. However, ListBucket operations are not affected by Requester Pays, even when enabled. This means requesters can list objects in the bucket without incurring charges (though listing still requires permission). If you want to fully hide the bucket's contents, you need to combine Requester Pays with appropriate bucket policies that deny ListBucket operations.

**CloudFront and certain AWS services have constraints.** If you use CloudFront to distribute data from a Requester Pays bucket, you'll need to configure the CloudFront origin to include the `x-amz-request-payer` header. Some AWS services that integrate with S3, like Athena or Redshift, may have limited or no support for Requester Pays buckets. Always test your specific use case before relying on this feature.

**Cross-region replication complications.** Requester Pays affects egress charges, not storage. If you're replicating data to another region, the replication itself will incur charges to the source bucket owner. The requester benefit only applies when they access the destination bucket.

**Billing visibility.** Requesters need to understand that they will be charged. While including the header forces them to be explicit about it, providing clear documentation is important. It's worth publishing guidelines about expected costs, setting up cost controls, and being transparent about data sizes.

### A Practical Scenario

Let's walk through a concrete example. Suppose you work for a genomics research organization that has sequenced and assembled a reference genome for a species of interest. You've spent two years and a million dollars on this work, and you want the research community to benefit. You've stored the 50 TB dataset in S3.

Without Requester Pays, serving this to 100 research groups around the world would cost you roughly $450,000 in egress charges annually—potentially more than your budget can support.

With Requester Pays enabled, each research group pays for the data they download. A small lab downloading 500 GB might pay $45. A large university downloading 10 TB pays $900. This distributes the cost fairly according to actual usage rather than concentrating it on the data owner.

To implement this, you would:

1. Enable Requester Pays on your S3 bucket containing the genome data.
2. Create an IAM policy allowing read access to the bucket and configure a bucket policy to permit access from authenticated AWS users.
3. Document the feature clearly on your organization's website, explaining that users need an AWS account and must include the appropriate header.
4. Provide example code in your preferred languages showing how to include the `--request-payer` parameter.
5. Monitor your own AWS account to ensure you're not incurring unexpected charges—you should see only minimal charges for bucket operations like object uploads.

Researchers accessing the data would then use commands or code similar to the examples shown earlier, including the request payer parameter as a matter of course.

### Monitoring and Cost Management

Once Requester Pays is enabled, monitoring becomes important on both sides. As the bucket owner, you'll want to verify that you're not being charged for data access (which would indicate misconfiguration). You can review your AWS billing dashboard and filter by S3 service to confirm that your charges only reflect storage and uploads, not retrieval.

For requesters, cost management is equally important. Downloading a large dataset can accumulate charges quickly if you're not careful. AWS provides cost allocation tags, budget alerts, and detailed billing reports that can help users track their S3 spending. It's a good practice to set up a cost budget alert before downloading large amounts of data from a Requester Pays bucket.

### Comparison with Alternatives

Requester Pays isn't the only way to share large datasets. Understanding the alternatives helps clarify when it's the right choice.

**AWS Marketplace** is an option if you want to commercialize your data. You can list datasets in the Marketplace, and customers subscribe to access them. AWS handles billing directly, and you receive revenue sharing. This works well for data with clear business value.

**Amazon CloudFront** can reduce egress costs by caching data at edge locations closer to users. However, CloudFront still incurs costs, just usually less than direct S3 downloads. This doesn't eliminate the cost model problem; it just shifts the burden.

**VPC endpoints and private access** allow accessing S3 from within AWS with reduced or no egress charges. This works great for data shared between AWS accounts and services but doesn't help external users.

**Glacier and archival storage** can reduce storage costs for infrequently accessed data, but they don't change the egress cost model. If anything, Glacier has higher retrieval costs.

Requester Pays is unique in completely shifting the financial responsibility from the data owner to the requester. It's the right choice when you want to share openly without absorbing indefinite costs, and when your requesters are willing to be AWS customers.

### Security and Access Control Patterns

While Requester Pays handles the financial side, you still need to think about security. The feature doesn't grant automatic access to anyone; it just shifts who pays. You maintain full control over who can access what through IAM and bucket policies.

A common pattern is to grant broad read access to a Requester Pays bucket while maintaining strict access controls at the application level. For example, a research organization might make genome data readable to any AWS account but require users to authenticate through their own system and log into a portal before receiving credentials to access S3.

Alternatively, you might use bucket policies to allow access only from specific AWS accounts, implementing a partner or customer sharing model where only approved organizations can download the data.

Some organizations combine Requester Pays with encryption to add another layer of control. They store data encrypted with their own KMS key and grant only selected accounts permission to decrypt. The Requester Pays bucket owner still pays for the storage, but requesters pay for the retrieval.

### Final Thoughts

S3 Requester Pays is an elegant solution to a real problem in data sharing economics. When you have large datasets that multiple parties want to access, the feature lets you share openly while maintaining a sensible cost model. It's not applicable everywhere—private buckets, frequently accessed web assets, and scenarios requiring anonymous access all have different solutions. But for reference datasets, log archives, and strategic data sharing between organizations, Requester Pays can be transformative.

The feature requires minimal setup: enable it on your bucket, document it clearly, and provide examples to your users. The key technical requirement—the `x-amz-request-payer` header—is straightforward to implement in any language or tool that works with S3. Understanding when and how to use this feature gives you another tool for building scalable, cost-effective data sharing solutions on AWS.
