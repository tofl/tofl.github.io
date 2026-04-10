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