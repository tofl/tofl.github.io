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