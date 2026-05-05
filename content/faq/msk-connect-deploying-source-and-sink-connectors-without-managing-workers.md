---
title: "MSK Connect: Deploying Source and Sink Connectors Without Managing Workers"
---

## MSK Connect: Deploying Source and Sink Connectors Without Managing Workers

Running Apache Kafka in AWS is one thing—but getting data into and out of Kafka at scale is another challenge entirely. That's where MSK Connect comes in. If you've ever wrestled with deploying and managing Kafka Connect workers, patching them, handling failures, or scaling them manually, MSK Connect offers a compelling alternative: a fully managed service that handles all the infrastructure complexity while you focus on your connectors.

This guide walks you through everything you need to know to deploy source and sink connectors using MSK Connect. We'll cover the practical steps of getting connectors running, explore real-world use cases like capturing database changes, and examine what MSK Connect handles for you versus what you still need to think about.

### Understanding MSK Connect and Why It Matters

Before diving into mechanics, let's clarify what problem MSK Connect solves. Kafka Connect is a framework for building scalable, reliable connectors that move data between Kafka and external systems. In a traditional self-managed setup, you'd run Kafka Connect workers on EC2 instances, manage their lifecycle, handle upgrades, deal with worker failures, and scale them based on throughput needs.

MSK Connect removes that operational burden. AWS manages the underlying worker infrastructure, scales it automatically based on your capacity settings, handles patching and updates, and provides built-in monitoring. You define what you want to move and where it should go; MSK Connect handles the plumbing.

This is particularly valuable for organizations running Amazon MSK (Managed Streaming for Apache Kafka) already. Instead of managing yet another set of infrastructure just to connect Kafka to RDS, S3, or OpenSearch, you get a service that integrates seamlessly with your managed Kafka cluster.

### Core Architecture: How MSK Connect Works

At its heart, MSK Connect orchestrates Kafka Connect for you. The service manages a pool of worker instances, distributes your connectors across them, handles rebalancing when workers fail, and scales capacity up or down as needed. You interact with MSK Connect through the AWS Console or API—never touching worker instances directly.

A connector in MSK Connect runs as a set of tasks distributed across managed workers. For a source connector pulling data from RDS, MSK Connect spreads those tasks across its worker pool, ensuring high availability. If a worker fails, MSK Connect automatically redeploys the failed tasks to another worker. This happens transparently, without you needing to diagnose or manually intervene.

Behind the scenes, MSK Connect manages the worker configuration, including properties like the number of worker threads, memory allocation, and internal converter settings. You control throughput and reliability through worker capacity settings rather than EC2 instance sizing.

### Setting Up Your First MSK Connect Connector

Getting a connector running involves several steps: preparing a custom plugin if needed, creating a connector configuration, and deploying it. Let's walk through the process.

#### Step 1: Uploading Custom Plugins to S3

MSK Connect needs access to connector JAR files and their dependencies. Many popular connectors come as managed plugins from Confluent or the open-source community. However, custom plugins—or specific versions of standard connectors—must be uploaded to S3.

Suppose you're deploying Debezium, a popular CDC (Change Data Capture) connector for capturing database changes. You'd download the Debezium MySQL connector package, extract it, and upload the entire plugin directory to an S3 bucket:

```bash
# Download and extract Debezium MySQL connector
wget https://repo1.maven.org/maven2/io/debezium/debezium-connector-mysql/2.4.0.Final/debezium-connector-mysql-2.4.0.Final-plugin.tar.gz
tar xzf debezium-connector-mysql-2.4.0.Final-plugin.tar.gz

# Upload to S3
aws s3 sync debezium-connector-mysql/ s3://my-kafka-plugins/debezium-mysql/
```

MSK Connect will retrieve these JARs from S3 when initializing workers. The service caches them locally, so repeated deployments don't re-download unless you update the S3 objects.

#### Step 2: Creating the MSK Connect Plugin

Within MSK Connect, you create a "custom plugin" resource that points to your S3 location. This tells MSK Connect where to find the connector code. You can do this via the console or API:

```bash
aws kafkaconnect create-custom-plugin \
  --name debezium-mysql-plugin \
  --content-type JAR \
  --location s3LocationBucketArn=arn:aws:s3:::my-kafka-plugins,s3ObjectKey=debezium-mysql/
```

MSK Connect validates that the S3 location is accessible and that the plugin structure is valid. Once created, this plugin is a reusable resource—you can deploy multiple connectors using the same plugin.

#### Step 3: Configuring the Connector

Now comes the critical part: defining your actual connector configuration. This includes the connector properties (like database connection details), capacity settings, and networking configuration.

A connector configuration specifies several key elements:

**Connector class and properties** tell MSK Connect which connector to use and how to configure it. For a Debezium MySQL source connector, you'd specify the MySQL host, port, username, password, and which tables to capture. For an S3 sink connector, you'd specify the bucket, region, and output format.

**Worker capacity** defines how many managed workers the connector uses and how much compute power each has. Capacity isn't measured in EC2 instance types but in "capacity units" (MCUs). One MCU provides 1 vCPU and 4 GB of memory. Most connectors run fine on 2–4 MCUs unless you're processing extremely high throughput.

**Worker configuration** includes things like the number of tasks the connector should use, converter settings for keys and values, and other Kafka Connect worker properties. You can either use a pre-built worker configuration from AWS or create a custom one stored in S3.

**IAM role** grants the connector permissions to access external systems and S3. This is crucial—the connector needs to authenticate with RDS, write to S3, or access OpenSearch, all without storing credentials in the configuration itself.

**Networking** specifies the VPC, subnets, and security groups where the managed workers run. These workers need network access to your MSK cluster and to whatever external system you're connecting to.

Here's a conceptual example of creating a Debezium source connector via the AWS CLI:

```bash
aws kafkaconnect create-connector \
  --connector-name rds-to-msk-cdc \
  --kafka-cluster brokerNodeGroupInfo={brokerAZDistribution=DEFAULT} \
  --kafka-cluster-client-authentication type=IAM \
  --kafka-cluster-encryption-in-transit type=TLS \
  --capacity maxWorkerCount=3,minWorkerCount=1,mcuCount=2 \
  --connector-configuration \
    "connector.class=io.debezium.connector.mysql.MySqlConnector" \
    "database.hostname=mydb.123456789.us-east-1.rds.amazonaws.com" \
    "database.port=3306" \
    "database.user=dbuser" \
    "database.password=dbpassword" \
    "database.server.id=1" \
    "database.include.list=myapp_db" \
    "table.include.list=myapp_db.users,myapp_db.orders" \
    "topic.prefix=rds_" \
  --service-execution-role-arn arn:aws:iam::123456789012:role/msk-connector-role \
  --plugins custom-plugin-arn=arn:aws:kafkaconnect:us-east-1:123456789012:custom-plugin/debezium-mysql-plugin/1
```

This configuration tells MSK Connect to run a Debezium MySQL connector that captures changes from a specific database and tables, publishing them to MSK topics with the `rds_` prefix.

### Real-World Example: CDC from RDS to MSK

Let's walk through a complete, practical scenario: capturing changes from an RDS MySQL database and streaming them to your MSK cluster.

Your application uses RDS MySQL to store customer and order data. You want to consume those changes in real time—perhaps to update a search index, trigger downstream workflows, or synchronize a data warehouse. Debezium + MSK Connect makes this straightforward.

First, prepare your RDS instance. MySQL needs binlog enabled and the Debezium user needs appropriate permissions:

```sql
-- Grant permissions to Debezium user
GRANT SELECT, RELOAD, SHOW DATABASES, REPLICATION SLAVE, REPLICATION CLIENT ON *.* TO 'debezium_user'@'%' IDENTIFIED BY 'secure_password';
FLUSH PRIVILEGES;
```

Next, create an IAM role that the connector can assume. This role needs permissions to read from RDS (via Secrets Manager if you store credentials there) and write to MSK:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "kafka-cluster:Connect",
        "kafka-cluster:AlterCluster",
        "kafka-cluster:DescribeCluster"
      ],
      "Resource": "arn:aws:kafka:us-east-1:123456789012:cluster/my-msk-cluster/*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "kafka-cluster:*Topic*",
        "kafka-cluster:WriteData",
        "kafka-cluster:ReadData"
      ],
      "Resource": "arn:aws:kafka:us-east-1:123456789012:topic/*"
    }
  ]
}
```

Upload the Debezium MySQL connector to S3, create the custom plugin in MSK Connect, then deploy the connector with appropriate capacity. For a typical CDC workload capturing a few hundred tables, 2 MCUs with 2 tasks is often sufficient. MSK Connect will distribute these tasks across managed workers.

Once the connector is running, Debezium creates topics for each table (e.g., `rds_myapp_db.users`, `rds_myapp_db.orders`) and publishes change events. Each message includes the operation type (INSERT, UPDATE, DELETE), the row values before and after the change, and metadata like the transaction ID and timestamp. Your downstream consumers can then react to these changes in real time.

### Exploring Common Connector Types

MSK Connect supports hundreds of connectors built by Confluent, the open-source community, and custom organizations. A few stand out as particularly relevant for typical AWS workloads.

**Debezium source connectors** capture changes from databases like MySQL, PostgreSQL, MongoDB, and SQL Server. They read the database's transaction log (binlog, WAL, etc.) and emit change events to Kafka. This enables real-time data replication, triggering workflows based on data changes, and keeping analytical systems in sync.

**S3 sink connectors** write Kafka messages to S3, partitioning them by time or topic. They handle compression, format conversion (JSON, Avro, Parquet), and batching. This is ideal for archiving Kafka data, feeding data lakes, or creating long-term backups.

**OpenSearch sink connectors** index Kafka messages directly into OpenSearch (or Elasticsearch). They handle schema mapping, bulk indexing, and error handling. Combined with OpenSearch dashboards, this enables real-time log analytics and search on your Kafka topics.

**JDBC sink connectors** write messages to relational databases. Though generic, they work with RDS, and they're useful when you want to push aggregated data or specific topics back to a database for operational dashboards.

**Kinesis sink connectors** (via community connectors) move data from MSK to Amazon Kinesis Data Streams, enabling integration with other AWS services like Lambda or Kinesis Analytics.

Each connector has its own configuration properties. The key is consulting the documentation for your specific connector and understanding what external permissions it needs.

### Autoscaling and Capacity Management

MSK Connect doesn't magically know your throughput needs, but it does provide autoscaling based on the metrics you care about. You define minimum and maximum MCU counts, and MSK Connect scales between them based on CPU and memory utilization on the workers.

If your connector consistently uses more than 80% of available CPU, MSK Connect scales up by adding MCUs. Conversely, if utilization drops, it scales down. This is useful for variable workloads—a CDC connector that gets hammered during the day but idles at night can shrink during off-peak hours.

However, autoscaling has limits. First, it takes several minutes to scale—there's no instant response to traffic spikes. Second, the scaling metrics are basic (CPU and memory), not application-specific metrics like lag or throughput. If you need precise control, you might manually set min and max to the same value and manage capacity explicitly.

For connectors with predictable, steady workloads, autoscaling is convenient. For connectors where responsiveness matters (e.g., a critical real-time CDC pipeline), understanding and proactively setting capacity is safer.

### Monitoring and Observability

MSK Connect integrates with CloudWatch, providing metrics and logs to understand your connector's health and behavior.

**Metrics** include worker CPU and memory utilization, the number of running tasks, and the number of failed tasks. These are available in CloudWatch and help you spot capacity problems. If CPU is consistently near 100%, your MCU count is likely too low.

**Logs** from the Kafka Connect workers are streamed to CloudWatch Logs. These include connector startup messages, configuration validation, and any errors the connector encounters (e.g., a network timeout connecting to RDS, or a schema mismatch when writing to OpenSearch). Diving into logs is often the first step when troubleshooting a stuck or failing connector.

You can also enable custom metrics by configuring the worker configuration to include metrics plugins, though this is an advanced topic.

In practice, set up CloudWatch alarms for failed task count and high CPU utilization. If either exceeds a threshold, investigate via logs. A simple dashboard showing worker health, task status, and key metrics takes minutes to set up and pays dividends in troubleshooting.

### Limitations and Trade-offs

MSK Connect is powerful but not a universal solution. Understanding its limitations helps you make informed decisions about when it's the right tool.

**Limited worker customization**: You can't install arbitrary OS-level dependencies or run custom initialization scripts on workers. If your connector needs a specific library or system package that isn't in the standard image, you need to package it into the connector JAR itself.

**No direct worker access**: You can't SSH into a worker instance for debugging. You're limited to CloudWatch logs and metrics. This can make troubleshooting complex connector issues harder compared to a self-managed setup where you can inspect worker processes directly.

**Connector code limitations**: Your connector code must fit within the constraints of the Kafka Connect framework. If you need to run arbitrary code or manage stateful resources beyond what Kafka Connect provides, a self-managed or custom solution might be necessary.

**Networking overhead**: Workers run in a VPC managed by AWS. If your external systems (RDS, S3, OpenSearch) are in a different VPC or region, you'll incur cross-region or cross-VPC data transfer costs. This is usually fine but worth considering for very high-throughput workloads.

**Audit and compliance**: For heavily regulated environments, the lack of direct infrastructure access might complicate compliance audits or incident response. Some organizations require the ability to inspect and approve every system in their pipeline.

Comparing to self-managed Kafka Connect: self-managed gives you full control but requires managing workers, handling failures, and scaling manually. MSK Connect trades some control for operational simplicity. For most organizations, that's a worthwhile trade, especially when already using managed services like MSK.

### Networking and Security Considerations

Deploying a connector in MSK Connect means networking and security setup correctly from the start. The connector runs in a managed VPC and needs to reach both your MSK cluster and any external systems.

Your MSK cluster should have IAM-based authentication enabled. The MSK Connect workers authenticate using the IAM role you assigned, eliminating the need to manage SASL credentials. Ensure the security group of your MSK brokers allows inbound traffic from the security group you assign to MSK Connect workers.

For external systems, the workers need network path and credentials. If your RDS instance is in the same VPC, just ensure the RDS security group allows inbound from the MSK Connect security group. If RDS is in a different VPC, you'll need VPC peering or a transit gateway. Credentials for RDS can come from environment variables, the connector configuration, or Secrets Manager—never hardcode them in the configuration.

S3 access is typically via the IAM role; no credentials needed. OpenSearch similarly uses the IAM role if it's in the same AWS account, or credentials if cross-account.

### Practical Deployment Checklist

Before deploying a connector, ensure you've covered these bases:

Have you uploaded the connector plugin to S3 and created the custom plugin resource? Verify the S3 path is correct and the bucket allows access from MSK Connect's execution role.

Is your external system prepared? For RDS, enable binlog and create appropriate users. For S3, ensure the bucket exists and the IAM role has permissions. For OpenSearch, create the index templates and set up user authentication if needed.

Have you created an IAM role with the minimum necessary permissions? Overly permissive roles create security risks. Be specific about which tables, buckets, or resources the connector needs to access.

Have you sized the worker capacity appropriately? Start conservative (2 MCUs) and monitor. If the connector lags or CPU maxes out, scale up.

Have you configured networking? Ensure the VPC and security groups allow the connector to reach MSK and external systems.

Have you tested connectivity before deploying? A simple test—like querying RDS or listing S3 objects from the same VPC—confirms the network path works.

### Key Takeaways

MSK Connect abstracts away the operational complexity of running Kafka Connect workers, letting you focus on moving data rather than managing infrastructure. With a managed plugin, a clear connector configuration, and appropriate permissions, you can have CDC from RDS or data flowing into S3 within minutes.

The service shines for typical workloads: capturing database changes, archiving to S3, or indexing into OpenSearch. It's particularly valuable in AWS-native environments where you're already using managed services. The trade-off—less control over worker internals—is minimal for most use cases.

As you build more connectors, patterns emerge. You'll refine your worker configurations, learn which capacity settings work for different scenarios, and develop intuitions about when to autoscale versus manual capacity management. MSK Connect rewards that investment by keeping infrastructure concerns at bay, freeing you to focus on the data architecture that actually matters.
