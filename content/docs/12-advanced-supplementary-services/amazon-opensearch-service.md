---
title: "42. Amazon OpenSearch Service"
type: docs
weight: 5
---

## Amazon OpenSearch Service

Relational databases like RDS are optimized for structured queries, and DynamoDB excels at key-value lookups — but both fall short when you need to search across large volumes of unstructured or semi-structured text, or to run real-time analytics on log data. Amazon OpenSearch Service [🔗](https://docs.aws.amazon.com/opensearch-service/latest/developerguide/what-is.html) is a managed service built for exactly these use cases: full-text search, log and event analytics, and observability pipelines. It is the AWS-managed successor to Amazon Elasticsearch Service, based on the open-source OpenSearch project (itself a fork of Elasticsearch 7.10).

A common real-world pattern: your application stores orders in DynamoDB, but you also stream those records into OpenSearch so users can search by product name, description, or any text field — something DynamoDB cannot do efficiently.

### Core Concepts

OpenSearch organizes data differently from a relational database. Instead of tables and rows, it uses **indexes** and **documents**. A document is a JSON object (analogous to a row), and an index is a named collection of documents (analogous to a table). Under the hood, each index is split into **shards** — independent units of storage and computation distributed across the cluster nodes. Each shard can have one or more **replicas**, which are copies that provide both redundancy and additional read capacity. [🔗](https://docs.aws.amazon.com/opensearch-service/latest/developerguide/sizing-domains.html)

When sizing a domain, the number of shards and replicas directly affects both performance and fault tolerance — more shards allow parallelism; replicas protect against node failure.

### Ingestion Patterns

Getting data into OpenSearch typically follows one of three patterns:

- **Kinesis Data Firehose** — The most common serverless approach. Firehose can directly deliver streaming data (from Kinesis Data Streams, application logs, etc.) to an OpenSearch domain with built-in batching and retry. No custom code required. [🔗](https://docs.aws.amazon.com/firehose/latest/dev/create-destination.html#create-destination-elasticsearch)
- **Lambda** — A Lambda function reacts to events (a DynamoDB Stream, an S3 upload, an SQS message) and writes documents to OpenSearch via the OpenSearch REST API. This gives you full control over transformation logic before indexing.
- **Logstash** — Part of the classic ELK/OpenSearch stack. Logstash is an open-source data pipeline tool that collects, filters, and ships logs to OpenSearch. Useful when migrating existing Logstash-based pipelines to AWS.

### OpenSearch Dashboards

OpenSearch Dashboards [🔗](https://docs.aws.amazon.com/opensearch-service/latest/developerguide/dashboards.html) is the built-in web UI bundled with every OpenSearch domain (the open-source equivalent of Kibana). It lets you explore indexed data, build visualizations (bar charts, time-series graphs, maps), and assemble them into dashboards — making it the primary tool for log analytics and operational monitoring. Access is controlled through the domain's authentication settings.

### Search Capabilities

OpenSearch's core value is its query engine. Beyond simple keyword matching, it supports:

- **Full-text search** — Tokenizes and scores documents using relevance algorithms (BM25 by default), enabling "fuzzy" matching, partial matches, and ranked results.
- **Filters** — Exact-match conditions (e.g., `status = "active"`) that do not affect relevance scoring. Filters are cached and faster than full-text queries.
- **Aggregations** — Compute metrics over result sets: counts, averages, histograms, top-N terms. This is what powers the charts in Dashboards. [🔗](https://opensearch.org/docs/latest/aggregations/)

These three capabilities are often combined in a single query — for example, search for documents matching "payment failed", filter to the last 24 hours, then aggregate by error code to see which errors are most frequent.

### Security

OpenSearch domains support several layers of security [🔗](https://docs.aws.amazon.com/opensearch-service/latest/developerguide/security.html):

- **VPC access** — Deploy your domain inside a VPC so it is never reachable from the public internet. This is the recommended approach for production workloads. Note that a VPC domain cannot also have a public endpoint — you choose one or the other at creation time.
- **Fine-grained access control (FGAC)** [🔗](https://docs.aws.amazon.com/opensearch-service/latest/developerguide/fgac.html) — Goes beyond IAM resource-level policies. FGAC lets you define roles at the index, document, and field level: for example, one IAM role can write to a specific index while another can only read certain fields within it. It is implemented using the OpenSearch security plugin and can be combined with IAM, Cognito, or SAML-based authentication.
- **Encryption** — Data at rest is encrypted via KMS, and data in transit is enforced with TLS. Both are configurable at domain creation. [🔗](https://docs.aws.amazon.com/opensearch-service/latest/developerguide/encryption-at-rest.html)

For the exam, remember the VPC-vs-public trade-off, and that fine-grained access control must be enabled at domain creation — it cannot be enabled after the fact on an existing domain.

{{< qcm >}}
[
{
"question": "A company stores customer orders in DynamoDB and wants to allow users to search orders by product description, keywords, and partial text matches. Which AWS service should the developer integrate with DynamoDB to support this requirement?",
"answers": [
{
"answer": "Amazon OpenSearch Service",
"isCorrect": true,
"explanation": "OpenSearch is purpose-built for full-text search across unstructured or semi-structured data. A common pattern is streaming DynamoDB records into OpenSearch to enable text-based search that DynamoDB cannot perform efficiently."
},
{
"answer": "Amazon RDS",
"isCorrect": false,
"explanation": "RDS is optimized for structured relational queries, not full-text search across large volumes of unstructured data."
},
{
"answer": "Amazon ElastiCache",
"isCorrect": false,
"explanation": "ElastiCache is an in-memory caching service used for low-latency key-value reads, not for full-text search capabilities."
},
{
"answer": "Amazon Athena",
"isCorrect": false,
"explanation": "Athena is used for SQL-based querying of data stored in S3, not for real-time full-text search on application data."
}
]
},
{
"question": "In Amazon OpenSearch Service, what is the correct analogy for an 'index' and a 'document' when compared to a relational database?",
"answers": [
{
"answer": "An index is analogous to a table, and a document is analogous to a row.",
"isCorrect": true,
"explanation": "OpenSearch uses indexes (collections of documents) and documents (individual JSON objects), which map conceptually to tables and rows in a relational database."
},
{
"answer": "An index is analogous to a row, and a document is analogous to a table.",
"isCorrect": false,
"explanation": "This is reversed. An index is the higher-level container (like a table), and a document is the individual record (like a row)."
},
{
"answer": "An index is analogous to a database, and a document is analogous to a table.",
"isCorrect": false,
"explanation": "While an index can loosely be compared to a database in some contexts, the course material specifically maps indexes to tables and documents to rows."
},
{
"answer": "An index is analogous to a shard, and a document is analogous to a replica.",
"isCorrect": false,
"explanation": "Shards and replicas are internal infrastructure concepts in OpenSearch, not conceptual equivalents of indexes and documents."
}
]
},
{
"question": "A developer needs to stream application log data from Kinesis Data Streams into Amazon OpenSearch Service with minimal operational overhead and no custom code. Which ingestion method should they use?",
"answers": [
{
"answer": "Kinesis Data Firehose",
"isCorrect": true,
"explanation": "Kinesis Data Firehose is the most common serverless approach. It can directly deliver streaming data to an OpenSearch domain with built-in batching and retry, requiring no custom code."
},
{
"answer": "AWS Lambda",
"isCorrect": false,
"explanation": "Lambda can write to OpenSearch but requires custom code to handle the ingestion logic. It is better suited when you need full control over transformation before indexing."
},
{
"answer": "Logstash",
"isCorrect": false,
"explanation": "Logstash is useful for migrating existing pipelines to AWS but is not a serverless AWS-native solution and requires operational management."
},
{
"answer": "Amazon SQS",
"isCorrect": false,
"explanation": "SQS is a message queuing service. It does not natively deliver data to OpenSearch; a consumer such as Lambda would still be needed."
}
]
},
{
"question": "A developer wants to index a document in Amazon OpenSearch every time a new item is written to a DynamoDB table, while applying custom transformation logic before indexing. Which ingestion pattern is most appropriate?",
"answers": [
{
"answer": "Use AWS Lambda triggered by a DynamoDB Stream to write the transformed document to OpenSearch via the REST API.",
"isCorrect": true,
"explanation": "Lambda reacting to DynamoDB Streams gives full control over transformation logic before writing to OpenSearch through its REST API. This is the recommended pattern when custom processing is required."
},
{
"answer": "Use Kinesis Data Firehose to read from DynamoDB and deliver directly to OpenSearch.",
"isCorrect": false,
"explanation": "Firehose does not natively read from DynamoDB tables. DynamoDB Streams combined with Lambda is the standard pattern for reacting to DynamoDB changes."
},
{
"answer": "Use Logstash to poll DynamoDB and push records to OpenSearch.",
"isCorrect": false,
"explanation": "While Logstash can be configured to ingest data, it is not the standard AWS-native approach for DynamoDB-to-OpenSearch integration with custom transformation."
},
{
"answer": "Configure DynamoDB to write directly to OpenSearch using a native integration.",
"isCorrect": false,
"explanation": "There is no native direct integration between DynamoDB and OpenSearch. An intermediary service such as Lambda or Firehose is required."
}
]
},
{
"question": "Which of the following are valid ingestion patterns for loading data into Amazon OpenSearch Service? (Select THREE)",
"answers": [
{
"answer": "Kinesis Data Firehose delivering streaming data directly to an OpenSearch domain",
"isCorrect": true,
"explanation": "Firehose is a fully managed, serverless delivery stream that can directly target OpenSearch with built-in batching and retry."
},
{
"answer": "AWS Lambda writing documents to OpenSearch via the REST API",
"isCorrect": true,
"explanation": "Lambda can be triggered by various event sources and write transformed documents to OpenSearch using its REST API, providing full control over ingestion logic."
},
{
"answer": "Logstash pipeline shipping logs to an OpenSearch domain",
"isCorrect": true,
"explanation": "Logstash is part of the classic ELK/OpenSearch stack and is a valid ingestion option, especially when migrating existing Logstash-based pipelines to AWS."
},
{
"answer": "Amazon RDS replication directly to OpenSearch",
"isCorrect": false,
"explanation": "There is no native RDS-to-OpenSearch replication. Data would need to flow through an intermediary such as Lambda or Firehose."
},
{
"answer": "AWS Glue ETL jobs streaming data in real time to OpenSearch",
"isCorrect": false,
"explanation": "AWS Glue is primarily a batch ETL service. It is not a standard or recommended real-time ingestion path for OpenSearch."
}
]
},
{
"question": "What is OpenSearch Dashboards, and what is its primary purpose in an OpenSearch deployment?",
"answers": [
{
"answer": "A built-in web UI for exploring indexed data, building visualizations, and creating operational monitoring dashboards.",
"isCorrect": true,
"explanation": "OpenSearch Dashboards is bundled with every OpenSearch domain and serves as the primary tool for log analytics, data exploration, and visualization — the open-source equivalent of Kibana."
},
{
"answer": "A command-line tool used to manage OpenSearch cluster configuration and scaling.",
"isCorrect": false,
"explanation": "OpenSearch Dashboards is a web-based UI, not a CLI tool. Cluster management is handled through the AWS Console, CLI, or APIs."
},
{
"answer": "An AWS Console extension that provides billing and usage metrics for the OpenSearch domain.",
"isCorrect": false,
"explanation": "OpenSearch Dashboards is focused on data visualization and log analytics, not AWS billing or infrastructure cost monitoring."
},
{
"answer": "A separate paid add-on that must be purchased and configured independently for each OpenSearch domain.",
"isCorrect": false,
"explanation": "OpenSearch Dashboards is bundled with every OpenSearch domain at no extra cost — it is not a separate paid add-on."
}
]
},
{
"question": "A developer writes a query that searches for documents containing 'timeout error', filters results to only those from the last 24 hours, and then groups the results by error code to count occurrences. Which OpenSearch capabilities does this query use? (Select THREE)",
"answers": [
{
"answer": "Full-text search",
"isCorrect": true,
"explanation": "Searching for 'timeout error' uses OpenSearch's full-text search engine, which tokenizes and scores documents using relevance algorithms such as BM25."
},
{
"answer": "Filters",
"isCorrect": true,
"explanation": "Restricting results to the last 24 hours is an exact-match condition that uses a filter. Filters do not affect relevance scoring and are faster due to caching."
},
{
"answer": "Aggregations",
"isCorrect": true,
"explanation": "Grouping results by error code and counting occurrences is an aggregation — specifically a terms aggregation — which computes metrics over the result set."
},
{
"answer": "Sharding",
"isCorrect": false,
"explanation": "Sharding is an infrastructure concept related to how data is distributed across the cluster. It is not a query capability invoked explicitly by the developer."
},
{
"answer": "Replicas",
"isCorrect": false,
"explanation": "Replicas provide redundancy and additional read capacity at the cluster level. They are not a query feature used when building searches."
}
]
},
{
"question": "What is the key difference between a full-text search query and a filter in Amazon OpenSearch Service?",
"answers": [
{
"answer": "Full-text queries score documents by relevance, while filters perform exact-match conditions that do not affect scoring and are cached for better performance.",
"isCorrect": true,
"explanation": "Full-text search uses algorithms like BM25 to rank results by relevance. Filters apply exact-match conditions (e.g., status = 'active'), are not scored, and benefit from caching, making them faster."
},
{
"answer": "Filters support partial and fuzzy matching, while full-text queries only support exact keyword matches.",
"isCorrect": false,
"explanation": "This is the opposite of the truth. Full-text queries support fuzzy and partial matching, while filters are for exact-match conditions."
},
{
"answer": "Full-text queries operate only on string fields, while filters can be applied to any field type including numbers and dates.",
"isCorrect": false,
"explanation": "While full-text queries are primarily used on text fields, the key distinction in the course is about relevance scoring and caching, not field type restrictions."
},
{
"answer": "Filters are only available when using OpenSearch Dashboards, not via the REST API.",
"isCorrect": false,
"explanation": "Filters are a native part of the OpenSearch query DSL and are fully available via the REST API, not limited to Dashboards."
}
]
},
{
"question": "A security-conscious team wants to ensure their Amazon OpenSearch domain is never accessible from the public internet. Which configuration should they apply?",
"answers": [
{
"answer": "Deploy the OpenSearch domain inside a VPC.",
"isCorrect": true,
"explanation": "VPC access is the recommended approach for production workloads. A VPC-deployed domain is not reachable from the public internet. Note that a domain cannot have both VPC access and a public endpoint simultaneously."
},
{
"answer": "Enable fine-grained access control (FGAC) on the domain.",
"isCorrect": false,
"explanation": "FGAC controls what authenticated users can do within the domain (index, document, and field-level permissions), but it does not prevent the domain from being publicly reachable on its own."
},
{
"answer": "Enable encryption at rest using AWS KMS.",
"isCorrect": false,
"explanation": "Encryption at rest protects stored data from unauthorized physical access, but does not restrict network-level access to the domain endpoint."
},
{
"answer": "Attach a resource-based IAM policy that denies all public IP addresses.",
"isCorrect": false,
"explanation": "While IAM policies can restrict access, the recommended and most effective approach to prevent any public internet access is to deploy the domain inside a VPC."
}
]
},
{
"question": "A developer needs to configure an Amazon OpenSearch domain so that one IAM role can write to a specific index, while another IAM role can only read certain fields within that index. Which OpenSearch security feature enables this?",
"answers": [
{
"answer": "Fine-grained access control (FGAC)",
"isCorrect": true,
"explanation": "FGAC allows defining roles at the index, document, and field level. It goes beyond standard IAM resource-level policies and supports granular permissions such as write access to a specific index or read access to specific fields."
},
{
"answer": "VPC access",
"isCorrect": false,
"explanation": "VPC access controls network-level reachability of the domain but does not provide granular index, document, or field-level permissions."
},
{
"answer": "TLS enforcement",
"isCorrect": false,
"explanation": "TLS encrypts data in transit but does not control which users or roles can access specific indexes or fields."
},
{
"answer": "AWS IAM resource-level policies",
"isCorrect": false,
"explanation": "Standard IAM resource-level policies are not granular enough to control access at the index, document, or field level within OpenSearch. FGAC is required for that level of control."
}
]
},
{
"question": "When must Fine-Grained Access Control (FGAC) be enabled on an Amazon OpenSearch domain?",
"answers": [
{
"answer": "At domain creation time — it cannot be enabled on an existing domain after the fact.",
"isCorrect": true,
"explanation": "FGAC must be enabled when the domain is first created. It is not possible to enable it on an already existing OpenSearch domain, so this decision must be made upfront."
},
{
"answer": "At any time by updating the domain's access policy through the AWS Console.",
"isCorrect": false,
"explanation": "Unlike some other settings, FGAC cannot be enabled retroactively. It is a creation-time configuration only."
},
{
"answer": "Only after enabling VPC access for the domain.",
"isCorrect": false,
"explanation": "FGAC can be combined with VPC access, IAM, Cognito, or SAML, but enabling VPC access is not a prerequisite. The key constraint is that FGAC must be set at domain creation."
},
{
"answer": "Only when the domain is deployed in a public subnet.",
"isCorrect": false,
"explanation": "FGAC can be used with both VPC-based and public endpoint domains. The constraint is about when it must be configured (at creation), not where the domain is deployed."
}
]
},
{
"question": "Which of the following statements about Amazon OpenSearch Service domain access modes is correct?",
"answers": [
{
"answer": "A domain can be configured with either VPC access or a public endpoint, but not both simultaneously.",
"isCorrect": true,
"explanation": "This is an important exam fact: when you deploy an OpenSearch domain inside a VPC, it cannot also have a public endpoint. You choose one or the other at creation time."
},
{
"answer": "A domain can have both a VPC endpoint and a public endpoint enabled at the same time for maximum flexibility.",
"isCorrect": false,
"explanation": "OpenSearch does not support having both access modes simultaneously. Enabling VPC access removes the ability to have a public endpoint."
},
{
"answer": "Public endpoint access is the recommended configuration for production workloads.",
"isCorrect": false,
"explanation": "VPC access is the recommended approach for production workloads, as it ensures the domain is never reachable from the public internet."
},
{
"answer": "VPC access can be added to an existing public endpoint domain without recreating it.",
"isCorrect": false,
"explanation": "The access mode (VPC vs. public) is chosen at domain creation time and cannot be changed afterward without creating a new domain."
}
]
},
{
"question": "What are shards and replicas in the context of Amazon OpenSearch Service, and why do they matter?",
"answers": [
{
"answer": "Shards are independent units of storage distributed across nodes that allow parallel processing; replicas are copies of shards that provide redundancy and additional read capacity.",
"isCorrect": true,
"explanation": "Each OpenSearch index is split into shards for parallelism and distributed storage. Replicas are copies of those shards that protect against node failures and increase read throughput."
},
{
"answer": "Shards are backups of an index stored in S3, and replicas are in-memory caches that speed up queries.",
"isCorrect": false,
"explanation": "Shards are not S3 backups — they are distributed units of storage within the cluster. Replicas are also stored in the cluster, not as in-memory caches."
},
{
"answer": "Shards define the access control policies for an index, and replicas define the encryption settings.",
"isCorrect": false,
"explanation": "Shards and replicas are infrastructure and performance concepts, not security or access control constructs."
},
{
"answer": "Shards are read-only copies of an index used for search, and replicas are write-enabled primary copies.",
"isCorrect": false,
"explanation": "This is backwards. The primary shards handle writes, and replicas are the copies that provide redundancy and additional read capacity."
}
]
},
{
"question": "Which encryption capabilities does Amazon OpenSearch Service support? (Select TWO)",
"answers": [
{
"answer": "Encryption at rest using AWS KMS",
"isCorrect": true,
"explanation": "OpenSearch supports KMS-based encryption at rest to protect stored data. This is configurable at domain creation."
},
{
"answer": "Encryption in transit enforced with TLS",
"isCorrect": true,
"explanation": "TLS is enforced for data in transit to and from the OpenSearch domain, ensuring that communications are encrypted over the network."
},
{
"answer": "Client-side encryption managed entirely by the application before indexing",
"isCorrect": false,
"explanation": "While client-side encryption is possible in theory, it is not an OpenSearch Service feature. The service provides server-side encryption at rest (KMS) and in transit (TLS)."
},
{
"answer": "Automatic field-level encryption applied to individual document fields",
"isCorrect": false,
"explanation": "OpenSearch does not natively encrypt individual fields within documents. Field-level security is handled by FGAC (access control), not encryption."
}
]
},
{
"question": "Amazon OpenSearch Service is the AWS-managed successor to which service, and on which open-source project is it based?",
"answers": [
{
"answer": "It is the successor to Amazon Elasticsearch Service, based on the open-source OpenSearch project — a fork of Elasticsearch 7.10.",
"isCorrect": true,
"explanation": "When Elastic changed the license of Elasticsearch, AWS forked version 7.10 and created the open-source OpenSearch project. Amazon OpenSearch Service replaced Amazon Elasticsearch Service as the managed offering."
},
{
"answer": "It is the successor to Amazon CloudSearch, based on the open-source Apache Solr project.",
"isCorrect": false,
"explanation": "OpenSearch Service replaced Amazon Elasticsearch Service, not CloudSearch. It is based on OpenSearch (a fork of Elasticsearch), not Apache Solr."
},
{
"answer": "It is a new service with no predecessor, built entirely on AWS-proprietary technology.",
"isCorrect": false,
"explanation": "OpenSearch Service is the direct successor to Amazon Elasticsearch Service and is based on the open-source OpenSearch project, not proprietary AWS technology."
},
{
"answer": "It is the successor to Amazon Redshift, designed to handle unstructured search workloads.",
"isCorrect": false,
"explanation": "Redshift is a data warehousing service for structured analytics, not a search service. OpenSearch Service succeeded Amazon Elasticsearch Service."
}
]
},
{
"question": "A developer is designing an OpenSearch domain for a production workload and needs to ensure high availability in case a cluster node fails. Which configuration strategy should they apply?",
"answers": [
{
"answer": "Configure multiple replicas for each index so that copies of the data exist on other nodes if one fails.",
"isCorrect": true,
"explanation": "Replicas are copies of shards distributed across nodes. If a node fails, the replica on another node can serve requests, providing both fault tolerance and continued read availability."
},
{
"answer": "Increase the number of primary shards to ensure data is duplicated across the cluster.",
"isCorrect": false,
"explanation": "Primary shards distribute data for parallelism but are not redundant copies of each other. Replicas, not additional primary shards, provide redundancy against node failure."
},
{
"answer": "Deploy the domain with a single large shard to centralize data and simplify recovery.",
"isCorrect": false,
"explanation": "A single large shard is a single point of failure and does not benefit from parallelism. Best practice is to distribute data across multiple shards with replicas."
},
{
"answer": "Enable automatic snapshots to S3, which will restore the domain automatically if a node fails.",
"isCorrect": false,
"explanation": "Snapshots are useful for disaster recovery and restoring data, but they do not provide real-time fault tolerance during a node failure. Replicas handle that."
}
]
},
{
"question": "Which of the following use cases are best suited for Amazon OpenSearch Service rather than Amazon DynamoDB or Amazon RDS? (Select TWO)",
"answers": [
{
"answer": "Allowing users to search a product catalog using partial text matches and ranked results",
"isCorrect": true,
"explanation": "Full-text search with partial matching and relevance ranking is a core OpenSearch capability. DynamoDB cannot do this efficiently, and RDS would require complex full-text indexing configurations."
},
{
"answer": "Running real-time analytics on application log data with visualizations",
"isCorrect": true,
"explanation": "OpenSearch is purpose-built for log and event analytics, and OpenSearch Dashboards provides built-in visualization. This is one of its primary use cases."
},
{
"answer": "Storing financial transaction records that require ACID-compliant operations",
"isCorrect": false,
"explanation": "ACID compliance for transactional workloads is best handled by relational databases like Amazon RDS, not OpenSearch, which is optimized for search and analytics."
},
{
"answer": "Performing high-throughput key-value lookups with single-digit millisecond latency",
"isCorrect": false,
"explanation": "High-throughput key-value lookups are DynamoDB's strength. OpenSearch is not optimized for simple key-value access patterns."
}
]
}
]
{{< /qcm >}}