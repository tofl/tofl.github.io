---
title: "44. MSK"
type: docs
weight: 7
---

## MSK (Managed Streaming for Apache Kafka)

Amazon MSK (Managed Streaming for Apache Kafka) [🔗](https://docs.aws.amazon.com/msk/latest/developerguide/what-is-msk.html) is a fully managed service that runs Apache Kafka on AWS. The problem it solves is operational: running Kafka yourself means provisioning brokers, managing ZooKeeper (or KRaft), handling upgrades, configuring storage, and wiring up monitoring. MSK removes all of that, leaving you with native Kafka APIs and none of the cluster management overhead. If your team is already building on Kafka — or needs a battle-tested, high-throughput event streaming platform — MSK lets you do it without becoming a Kafka infrastructure expert.

### Kafka Fundamentals

Before working with MSK, you need a solid mental model of how Kafka itself works [🔗](https://kafka.apache.org/documentation/).

A **topic** is a named stream of records — think of it as a durable, append-only log. Topics are split into **partitions**, which are the unit of parallelism and ordering. Within a partition, records are strictly ordered; across partitions, there is no ordering guarantee. Each partition is replicated across multiple **brokers** (the Kafka servers) for fault tolerance.

**Producers** write records to a topic. They choose which partition to write to — either via a key hash, a custom partitioner, or round-robin. **Consumers** read records from topics. Consumers belong to a **consumer group**: each partition is assigned to exactly one consumer within the group, which means adding more consumers in a group scales read throughput (up to the number of partitions). Multiple independent consumer groups can each read the same topic from the beginning without interfering with one another — this is a key difference from SQS, where a message is consumed once and gone.

A useful mental model:

```
Producer → [Topic: "orders"] → Partition 0  → Consumer Group A (Consumer 1)
                              → Partition 1  → Consumer Group A (Consumer 2)
                              → Partition 2  → Consumer Group A (Consumer 3)
                                               Consumer Group B (separate offset)
```

### MSK vs Kinesis

Both MSK and Kinesis Data Streams are designed for real-time event streaming, but they target different teams and use cases [🔗](https://docs.aws.amazon.com/msk/latest/developerguide/msk-vs-kinesis.html).

- **Protocol**: MSK uses the native Kafka protocol, so any existing Kafka application, library, or connector works without modification. Kinesis uses a proprietary AWS API.
- **Ecosystem**: Kafka has a massive open-source ecosystem — Kafka Connect, Kafka Streams, ksqlDB, thousands of connectors. Kinesis integrates tightly with AWS services but has a narrower third-party ecosystem.
- **Retention**: Kafka retention is configurable per topic (time or size-based), and can be extended indefinitely with tiered storage. Kinesis retention maxes out at 365 days.
- **Partition model**: Kinesis uses shards (fixed throughput per shard: 1 MB/s in, 2 MB/s out). Kafka partitions have no fixed throughput cap — throughput scales with broker capacity.
- **Operational model**: Kinesis is fully serverless and deeply AWS-native. MSK still requires you to think about broker sizing and storage, even in managed form.

**Choose MSK** when you are migrating an existing Kafka workload, need Kafka-ecosystem tooling, or require fine-grained control over topic configuration. **Choose Kinesis** when you want the simplest possible AWS-native stream with tight Lambda/Firehose/Analytics integration and no Kafka expertise on the team.

### MSK Cluster Types: Provisioned vs Serverless

MSK offers two deployment modes [🔗](https://docs.aws.amazon.com/msk/latest/developerguide/msk-cluster-types.html).

**Provisioned** clusters give you full control over broker instance type, number of brokers, and EBS storage per broker. You right-size the cluster for your expected throughput and pay for the brokers whether you use them or not. This is the right choice for predictable, high-throughput workloads where you want deterministic performance.

**MSK Serverless** [🔗](https://docs.aws.amazon.com/msk/latest/developerguide/serverless.html) abstracts away broker management entirely. You create a cluster, define topics, and produce/consume — capacity scales automatically. You pay per partition-hour and per GB of data throughput. It is well-suited for variable or unpredictable workloads, development environments, or teams that want Kafka semantics without any capacity planning. The trade-off is less control over broker-level tuning and a higher per-unit cost at sustained high throughput.

### MSK Connect

MSK Connect [🔗](https://docs.aws.amazon.com/msk/latest/developerguide/msk-connect.html) is a managed environment for running **Kafka Connect** workers. Kafka Connect is a framework for building reliable, scalable pipelines between Kafka and external systems — databases, S3, OpenSearch, and hundreds of others — without writing producer/consumer code.

You deploy a **connector** (a JAR-based plugin, either from the Confluent Hub or custom-built) into MSK Connect, configure it with source/sink details, and MSK handles the worker fleet, scaling, and availability. For example, a Debezium source connector can stream database change events (CDC) from RDS into an MSK topic with no custom code, and a separate S3 sink connector can archive those events to S3 automatically.

### MSK Security

MSK runs inside your VPC, so network-level isolation is your first layer of defense. Within that, MSK supports several security controls [🔗](https://docs.aws.amazon.com/msk/latest/developerguide/msk-security.html):

- **Encryption in transit**: TLS between clients and brokers, and between brokers. You can enforce TLS-only or allow plaintext alongside TLS.
- **Encryption at rest**: EBS volumes are encrypted using AWS KMS, with either an AWS-managed key or a customer-managed CMK.
- **Client authentication** — three options:
    - **IAM authentication** [🔗](https://docs.aws.amazon.com/msk/latest/developerguide/iam-access-control.html): Clients authenticate using their AWS IAM identity (via SigV4 signing). This is the recommended approach for AWS-native workloads because it unifies Kafka authorization with your existing IAM policies — no separate credential management.
    - **SASL/SCRAM**: Username/password authentication backed by credentials stored in AWS Secrets Manager. Useful when clients cannot use IAM (e.g., on-premises producers).
    - **Mutual TLS (mTLS)**: Client certificates signed by a trusted CA. Suitable for strict PKI environments.

For the exam, remember that IAM authentication is the AWS-native choice, and that SASL/SCRAM credentials live in Secrets Manager.

### MSK with Lambda Event Source Mapping

Lambda can consume records from MSK topics directly via an **event source mapping** [🔗](https://docs.aws.amazon.com/lambda/latest/dg/with-msk.html). Lambda polls the topic, batches records from one or more partitions, and invokes your function. This pattern is useful for lightweight stream processing — filtering, transforming, or routing events — without managing a long-running consumer process.

Key behaviors to know:

- Lambda manages the consumer group and offset commits automatically.
- Each partition maps to one concurrent Lambda invocation at most, so the number of partitions caps your parallelism.
- Works with both Provisioned and Serverless MSK clusters, and also with self-managed Kafka clusters (non-MSK).
- For authentication, configure the event source mapping with the appropriate method (IAM, SASL/SCRAM, or mTLS) matching your MSK cluster's settings.
- Failed batches can be sent to an **on-failure destination** (SQS or SNS) to avoid data loss from poison-pill messages.

A common exam scenario: a Lambda function processes order events from an MSK topic and writes aggregated results to DynamoDB. If the Lambda function throws an error, Kafka does not advance the offset — the batch is retried. Configure a bisect-on-error strategy or a failure destination to handle persistent failures gracefully.

{{< qcm >}}
[
{
"question": "A company is migrating an existing Apache Kafka workload to AWS. They use Kafka Connect connectors from the Confluent Hub and need to preserve their existing Kafka client code without modification. Which AWS service should they choose?",
"answers": [
{
"answer": "Amazon Kinesis Data Streams",
"isCorrect": false,
"explanation": "Kinesis uses a proprietary AWS API, meaning existing Kafka clients would require modification. It also lacks native Kafka Connect support."
},
{
"answer": "Amazon MSK (Managed Streaming for Apache Kafka)",
"isCorrect": true,
"explanation": "MSK uses the native Kafka protocol, so existing Kafka clients, libraries, and Confluent Hub connectors work without any modification. It also supports MSK Connect for running Kafka Connect workers."
},
{
"answer": "Amazon SQS",
"isCorrect": false,
"explanation": "SQS is a message queue service, not an event streaming platform. It does not support the Kafka protocol or Kafka Connect."
},
{
"answer": "Amazon EventBridge",
"isCorrect": false,
"explanation": "EventBridge is an event bus service focused on routing events between AWS services and SaaS applications. It does not support the Kafka protocol."
}
]
},
{
"question": "A team is using Amazon MSK and wants to authenticate Kafka clients using their existing AWS IAM identities without managing separate credentials. Which authentication method should they configure?",
"answers": [
{
"answer": "SASL/SCRAM with credentials stored in AWS Secrets Manager",
"isCorrect": false,
"explanation": "SASL/SCRAM uses username/password credentials and is recommended when clients cannot use IAM (e.g., on-premises producers), not for AWS-native workloads."
},
{
"answer": "Mutual TLS (mTLS) with client certificates",
"isCorrect": false,
"explanation": "mTLS uses client certificates from a trusted CA and is suited for strict PKI environments, not for unified IAM-based access control."
},
{
"answer": "IAM authentication via SigV4 signing",
"isCorrect": true,
"explanation": "IAM authentication is the recommended AWS-native approach. It uses SigV4 signing so that Kafka authorization is unified with existing IAM policies, requiring no separate credential management."
},
{
"answer": "Plaintext authentication with VPC security groups",
"isCorrect": false,
"explanation": "Plaintext provides no client authentication. Security groups control network access but do not authenticate Kafka clients."
}
]
},
{
"question": "An on-premises application needs to produce messages to an Amazon MSK cluster. The application cannot use IAM authentication. Which MSK authentication method is most appropriate?",
"answers": [
{
"answer": "IAM authentication",
"isCorrect": false,
"explanation": "IAM authentication requires AWS IAM identities, which are not readily available to on-premises applications that are not integrated with AWS."
},
{
"answer": "SASL/SCRAM with credentials stored in AWS Secrets Manager",
"isCorrect": true,
"explanation": "SASL/SCRAM uses username/password credentials backed by Secrets Manager and is specifically designed for clients that cannot use IAM, such as on-premises producers."
},
{
"answer": "Amazon Cognito user pools",
"isCorrect": false,
"explanation": "Amazon Cognito is not a supported authentication mechanism for MSK clients."
},
{
"answer": "Mutual TLS (mTLS)",
"isCorrect": true,
"explanation": "mTLS with client certificates signed by a trusted CA is a valid alternative for on-premises clients operating in strict PKI environments when IAM is not available."
}
]
},
{
"question": "A developer is designing a system where multiple independent applications must each read all records from the same Kafka topic on Amazon MSK, starting from the earliest available record. How should this be implemented?",
"answers": [
{
"answer": "Use a single consumer group with one consumer per application",
"isCorrect": false,
"explanation": "With a single consumer group, partitions are shared across all consumers, meaning each record is processed by only one consumer in the group — not by all applications independently."
},
{
"answer": "Use a separate consumer group for each application",
"isCorrect": true,
"explanation": "Each consumer group maintains its own independent offset. Multiple consumer groups can read the same topic from the beginning without interfering with one another, which is a key Kafka capability."
},
{
"answer": "Use SQS instead, as MSK does not support multiple readers for the same message",
"isCorrect": false,
"explanation": "This describes SQS behavior, not Kafka/MSK. MSK fully supports multiple independent consumer groups reading the same topic."
},
{
"answer": "Duplicate the topic for each application",
"isCorrect": false,
"explanation": "Duplicating topics wastes resources and is unnecessary. Consumer groups handle this use case natively without any topic duplication."
}
]
},
{
"question": "What is the maximum data retention period supported by Amazon Kinesis Data Streams?",
"answers": [
{
"answer": "7 days",
"isCorrect": false,
"explanation": "7 days is the default extended retention for Kinesis, but the maximum supported retention is 365 days."
},
{
"answer": "90 days",
"isCorrect": false,
"explanation": "90 days is not the maximum. Kinesis Data Streams supports up to 365 days of retention."
},
{
"answer": "365 days",
"isCorrect": true,
"explanation": "Kinesis Data Streams supports a maximum retention period of 365 days. In contrast, Kafka/MSK allows configurable retention with no fixed upper limit, especially with tiered storage."
},
{
"answer": "Unlimited",
"isCorrect": false,
"explanation": "Unlimited retention applies to MSK (Kafka), not Kinesis. Kinesis caps out at 365 days."
}
]
},
{
"question": "A team wants to run Apache Kafka on AWS for a development environment with unpredictable and variable traffic. They want Kafka semantics without performing any capacity planning. Which MSK deployment type is best suited?",
"answers": [
{
"answer": "MSK Provisioned",
"isCorrect": false,
"explanation": "MSK Provisioned requires you to select broker instance types, number of brokers, and storage. It is designed for predictable, high-throughput workloads — not for variable or development environments."
},
{
"answer": "MSK Serverless",
"isCorrect": true,
"explanation": "MSK Serverless abstracts away broker management entirely, scales capacity automatically, and is billed per partition-hour and GB of throughput. It is ideal for variable workloads and development environments where capacity planning is not desired."
},
{
"answer": "Amazon Kinesis Data Streams with on-demand mode",
"isCorrect": false,
"explanation": "Kinesis on-demand mode is serverless, but it uses the proprietary Kinesis API, not native Kafka protocol. If Kafka semantics are required, MSK Serverless is the correct choice."
},
{
"answer": "Self-managed Kafka on EC2 Auto Scaling",
"isCorrect": false,
"explanation": "Self-managed Kafka on EC2 still requires significant operational overhead including cluster management, ZooKeeper, and upgrades — exactly what the team wants to avoid."
}
]
},
{
"question": "A developer configures an AWS Lambda function with an Amazon MSK event source mapping to process order events. During processing, the Lambda function throws an unhandled exception. What happens to the Kafka offset?",
"answers": [
{
"answer": "The offset is advanced and the failed records are skipped",
"isCorrect": false,
"explanation": "Lambda does not advance the Kafka offset on failure. Skipping records automatically would risk data loss."
},
{
"answer": "The offset is not advanced and the batch is retried",
"isCorrect": true,
"explanation": "When a Lambda function fails to process a batch, Kafka does not advance the offset. The same batch is retried, which ensures at-least-once delivery semantics."
},
{
"answer": "The failed records are sent to a Dead Letter Queue automatically",
"isCorrect": false,
"explanation": "A Dead Letter Queue is not configured automatically. You must explicitly configure an on-failure destination (SQS or SNS) to capture failed batches."
},
{
"answer": "The MSK topic partition is paused until the issue is resolved manually",
"isCorrect": false,
"explanation": "MSK does not pause the partition manually. Lambda retries the failed batch according to its retry configuration."
}
]
},
{
"question": "A Lambda function consuming from an Amazon MSK topic is encountering a 'poison-pill' message that causes repeated failures and blocks all subsequent records in that partition. Which strategies can help resolve this? (Select TWO)",
"answers": [
{
"answer": "Configure an on-failure destination (SQS or SNS) for the event source mapping",
"isCorrect": true,
"explanation": "An on-failure destination captures failed batches and allows processing to continue past the problematic message, preventing indefinite blocking."
},
{
"answer": "Enable bisect-on-error for the event source mapping",
"isCorrect": true,
"explanation": "Bisect-on-error splits a failing batch in two and retries each half separately, helping isolate the specific poison-pill message so that valid records can be processed."
},
{
"answer": "Increase the number of Kafka partitions",
"isCorrect": false,
"explanation": "Adding partitions does not resolve the poison-pill issue; the problematic message will still block its partition regardless of the total partition count."
},
{
"answer": "Switch the MSK cluster to Serverless mode",
"isCorrect": false,
"explanation": "The cluster deployment type (Provisioned vs Serverless) has no effect on Lambda's retry behavior or poison-pill handling."
}
]
},
{
"question": "Which of the following accurately describes the parallelism model when using AWS Lambda with an Amazon MSK event source mapping?",
"answers": [
{
"answer": "Lambda scales the number of concurrent invocations based on the volume of records, independently of partition count",
"isCorrect": false,
"explanation": "Lambda's concurrency for MSK is bounded by the partition count, not just by record volume. Each partition maps to at most one concurrent Lambda invocation."
},
{
"answer": "Each partition maps to at most one concurrent Lambda invocation",
"isCorrect": true,
"explanation": "Lambda assigns one concurrent invocation per partition at most. Therefore, the number of partitions sets the upper limit on Lambda's parallelism for that topic."
},
{
"answer": "All partitions are processed by a single Lambda invocation sequentially",
"isCorrect": false,
"explanation": "Lambda can invoke multiple concurrent instances, one per partition. It does not serialize all partitions into a single invocation."
},
{
"answer": "Lambda concurrency is capped at the number of consumer groups configured on the cluster",
"isCorrect": false,
"explanation": "Lambda's concurrency is capped by partition count, not consumer group count. Lambda manages its own internal consumer group."
}
]
},
{
"question": "A company wants to stream change data capture (CDC) events from an Amazon RDS database into an MSK topic and then archive them to Amazon S3, without writing custom producer or consumer code. Which MSK feature enables this?",
"answers": [
{
"answer": "MSK Connect with a Debezium source connector and an S3 sink connector",
"isCorrect": true,
"explanation": "MSK Connect is a managed environment for running Kafka Connect workers. A Debezium source connector streams CDC events from RDS into an MSK topic, while an S3 sink connector archives those events to S3 — all without custom producer or consumer code."
},
{
"answer": "AWS Glue streaming ETL job reading from MSK",
"isCorrect": false,
"explanation": "Glue streaming ETL can read from Kafka, but it requires writing and managing ETL job code. The question specifically asks for a solution without custom code, making MSK Connect the better fit."
},
{
"answer": "Lambda event source mapping with MSK and S3 PutObject calls",
"isCorrect": false,
"explanation": "This approach requires writing Lambda function code to read from MSK and write to S3. The question asks for a no-custom-code solution."
},
{
"answer": "Amazon Kinesis Data Firehose connected to MSK",
"isCorrect": false,
"explanation": "Kinesis Data Firehose cannot directly consume from MSK. MSK Connect's S3 sink connector is the appropriate tool for this pipeline."
}
]
},
{
"question": "Which of the following statements correctly differentiate Amazon MSK from Amazon Kinesis Data Streams? (Select TWO)",
"answers": [
{
"answer": "Kinesis shards have a fixed throughput cap (1 MB/s in, 2 MB/s out), while Kafka partitions scale throughput with broker capacity",
"isCorrect": true,
"explanation": "This is a fundamental architectural difference. Kinesis shard throughput is fixed, whereas Kafka partition throughput scales with the underlying broker resources."
},
{
"answer": "MSK supports native Kafka APIs, allowing existing Kafka applications to run without modification",
"isCorrect": true,
"explanation": "MSK uses the native Kafka protocol, so any Kafka client, library, or connector works without code changes. Kinesis uses a proprietary AWS API that requires specific SDKs."
},
{
"answer": "Kinesis supports indefinite retention with tiered storage, while MSK caps retention at 365 days",
"isCorrect": false,
"explanation": "This is reversed. MSK (Kafka) supports configurable and potentially indefinite retention with tiered storage. Kinesis caps retention at 365 days."
},
{
"answer": "MSK is fully serverless by default, while Kinesis requires broker provisioning",
"isCorrect": false,
"explanation": "This is reversed. Kinesis is the fully serverless option. MSK offers both Provisioned and Serverless modes, but requires broker consideration even in managed form."
}
]
},
{
"question": "How does Amazon MSK encrypt data stored on broker EBS volumes?",
"answers": [
{
"answer": "Data at rest is not encrypted by default; you must enable client-side encryption",
"isCorrect": false,
"explanation": "MSK encrypts EBS volumes at rest using AWS KMS by default. Client-side encryption is not required."
},
{
"answer": "EBS volumes are encrypted using AWS KMS, with either an AWS-managed key or a customer-managed CMK",
"isCorrect": true,
"explanation": "MSK uses AWS KMS for encryption at rest on EBS volumes. You can use an AWS-managed key or bring your own customer-managed CMK (CMK) for additional control."
},
{
"answer": "MSK uses AES-256 encryption managed entirely by Apache Kafka, independent of AWS KMS",
"isCorrect": false,
"explanation": "MSK integrates with AWS KMS for encryption at rest. It does not use a Kafka-native encryption mechanism independent of AWS."
},
{
"answer": "Encryption at rest is only available for MSK Serverless clusters",
"isCorrect": false,
"explanation": "Encryption at rest with KMS is available for both MSK Provisioned and Serverless clusters."
}
]
},
{
"question": "Within an Apache Kafka topic, what ordering guarantees are provided?",
"answers": [
{
"answer": "Records are strictly ordered across all partitions in the topic",
"isCorrect": false,
"explanation": "Kafka does not guarantee ordering across partitions. Strict ordering is only maintained within a single partition."
},
{
"answer": "Records are strictly ordered within each partition, but there is no ordering guarantee across partitions",
"isCorrect": true,
"explanation": "Kafka guarantees strict ordering within a partition (records are appended sequentially). Across partitions, no global ordering is maintained."
},
{
"answer": "Records are ordered by producer timestamp across all partitions",
"isCorrect": false,
"explanation": "Kafka does not globally order records by producer timestamp across partitions. Only intra-partition ordering is guaranteed."
},
{
"answer": "Ordering is only guaranteed when a single consumer group is used",
"isCorrect": false,
"explanation": "The ordering guarantee is a property of the partition itself, not of the consumer group configuration."
}
]
},
{
"question": "A team uses MSK Provisioned and wants to increase read throughput for a high-volume topic. What is the most effective approach within Kafka's model?",
"answers": [
{
"answer": "Increase the replication factor of the topic",
"isCorrect": false,
"explanation": "Increasing the replication factor improves fault tolerance but does not increase read throughput. Replication is for durability, not parallelism."
},
{
"answer": "Add more consumers to the same consumer group, and ensure the topic has enough partitions to match",
"isCorrect": true,
"explanation": "Each partition is assigned to exactly one consumer within a consumer group. Adding consumers only increases throughput if there are enough partitions to assign to them. Scaling read throughput requires both more partitions and more consumers."
},
{
"answer": "Create additional consumer groups reading the same topic",
"isCorrect": false,
"explanation": "Multiple consumer groups read the topic independently, which is useful for separate applications — but it does not increase the throughput of a single consumer group processing the data."
},
{
"answer": "Switch to MSK Serverless to automatically scale read throughput",
"isCorrect": false,
"explanation": "MSK Serverless scales infrastructure capacity, but the fundamental Kafka model still applies: partition count bounds consumer parallelism within a group."
}
]
},
{
"question": "An AWS Lambda function is configured with an Amazon MSK event source mapping using IAM authentication. The Lambda function fails to poll records and logs an access denied error. What is the most likely cause?",
"answers": [
{
"answer": "The MSK cluster does not support IAM authentication",
"isCorrect": false,
"explanation": "IAM authentication is a fully supported option for MSK clusters. If it was enabled on the cluster, the issue lies elsewhere."
},
{
"answer": "The Lambda execution role lacks the necessary IAM permissions to authenticate with the MSK cluster",
"isCorrect": true,
"explanation": "With IAM authentication, Lambda uses its execution role's IAM identity (via SigV4 signing) to authenticate. If the execution role does not have the required MSK permissions (e.g., kafka-cluster:Connect, kafka-cluster:ReadData), access is denied."
},
{
"answer": "Lambda event source mappings cannot use IAM authentication; SASL/SCRAM must be used instead",
"isCorrect": false,
"explanation": "Lambda event source mappings support IAM, SASL/SCRAM, and mTLS authentication. IAM is a valid and recommended option for AWS-native workloads."
},
{
"answer": "The Lambda function's VPC configuration prevents it from reaching the MSK cluster",
"isCorrect": false,
"explanation": "A VPC connectivity issue would typically produce a timeout or connection refused error, not an access denied error. Access denied points to an IAM permissions problem."
}
]
}
]
{{< /qcm >}}