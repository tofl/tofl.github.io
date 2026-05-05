---
title: "Migrating from Logstash to AWS-Native Ingestion: Firehose and OpenSearch Ingestion"
---

## Migrating from Logstash to AWS-Native Ingestion: Firehose and OpenSearch Ingestion

If you've spent the last few years maintaining Logstash pipelines on AWS, you've probably asked yourself: "Is there a better way?" The good news is that AWS has invested heavily in managed log ingestion services that can often replace Logstash entirely, eliminating operational overhead while potentially reducing costs. The challenge is figuring out which service fits your workload and how to actually make the migration without losing data or visibility into your systems.

This article walks you through the landscape of AWS-native log ingestion, compares it directly to what you're doing with Logstash, and shows you how to migrate a real pipeline step by step. Whether you're handling simple log delivery or complex transformations, you'll find practical guidance to modernize your observability stack.

### Understanding the Logstash Problem

Let's start with why teams are looking beyond Logstash in the first place. Logstash is a powerful, flexible tool—it's been the industry standard for log processing for over a decade. You can chain together inputs, filters, and outputs with an intuitive configuration language, and the plugin ecosystem is vast. But that flexibility comes with a cost.

Running Logstash means managing compute instances or containers. You need to patch them, monitor them for memory leaks (Logstash can be memory-hungry), handle JVM tuning, and scale horizontally when log volume spikes. In a cloud environment like AWS, where managed services handle these headaches for you, maintaining your own Logstash infrastructure starts to feel like technical debt.

Moreover, Logstash's horizontal scaling isn't trivial. You need load balancing, coordination between instances, and a way to ensure your filters run consistently across the fleet. For teams already deep in the AWS ecosystem, this friction is especially noticeable. Why manage JVM processes when you could invoke a managed service and pay only for what you use?

AWS recognized this pain point and built two complementary services designed to replace Logstash in most real-world scenarios: Amazon Kinesis Data Firehose for straightforward ingestion and delivery, and Amazon OpenSearch Ingestion for complex transformations. Let's explore each.

### Kinesis Data Firehose: The Simple Path

Amazon Kinesis Data Firehose is the simpler of the two services, and for many teams, it's all you need. Think of it as a managed pipeline that automatically scales to handle whatever log volume you throw at it, with built-in support for common transformations and multiple destination services.

Firehose excels when your log processing needs are moderate. You might want to parse JSON, add a timestamp, filter out noise, or reformat fields before delivering to Amazon OpenSearch, S3, Redshift, or Datadog. Firehose handles all of this without you managing a single server.

Here's a typical Firehose workflow: logs arrive at the Firehose delivery stream, optional record transformation kicks in, and then your data lands in the destination. The transformation layer is where the real work happens. Unlike Logstash's rich plugin ecosystem, Firehose transformations happen via Lambda functions. You write a small Python or Node.js function that receives each batch of records, transforms them, and returns the result.

Let's look at a concrete example. Imagine you're currently using Logstash to:
- Parse Apache access logs
- Extract fields like IP, HTTP method, status code, and response time
- Filter out health check requests
- Deliver to OpenSearch

With Firehose, that entire pipeline becomes much simpler. You'd create a Lambda function like this:

```python
import json
import re
from base64 import b64decode

def lambda_handler(event, context):
    output = []
    
    for record in event['records']:
        payload = b64decode(record['data']).decode('utf-8')
        
        # Parse Apache access log
        match = re.match(
            r'(\d+\.\d+\.\d+\.\d+) .* \[.*\] "(\w+) (\S+) \S+" (\d+) (\d+) .* (\d+)',
            payload
        )
        
        if match:
            ip, method, path, status, bytes_sent, response_time = match.groups()
            
            # Filter out health checks
            if path == '/health':
                output.append({
                    'recordId': record['recordId'],
                    'result': 'Dropped'
                })
                continue
            
            # Transform to structured event
            transformed = {
                'timestamp': int(time.time() * 1000),
                'ip': ip,
                'method': method,
                'path': path,
                'status': int(status),
                'bytes_sent': int(bytes_sent),
                'response_time_ms': int(response_time)
            }
            
            output.append({
                'recordId': record['recordId'],
                'result': 'Ok',
                'data': b64encode(json.dumps(transformed).encode()).decode()
            })
    
    return {'records': output}
```

This Lambda function does the heavy lifting. Firehose calls it, passes records in batches, and handles buffering and delivery to your destination. You don't think about scaling, concurrency, or failed deliveries—Firehose manages all of that.

The appeal here is profound: you've replaced a long-running process that you manage with a serverless function that scales automatically. You pay for execution time, not for idle capacity. If your log volume drops to zero, your bill drops to zero.

However, Firehose does have limitations compared to Logstash. The transformation Lambda runs for up to five minutes on a batch and has memory constraints (3 GB maximum). If you need real-time processing or have complex multi-stage pipelines with conditional logic spanning many states, Firehose might feel constraining.

### Amazon OpenSearch Ingestion: The Sophisticated Sibling

For more complex log processing scenarios, AWS offers Amazon OpenSearch Ingestion, which is essentially a managed version of Data Prepper, an open-source log processor that AWS maintains. If Firehose is a lightweight alternative to Logstash, OpenSearch Ingestion is the heavyweight replacement that doesn't sacrifice capability.

OpenSearch Ingestion is purpose-built for complex data pipelines. It supports multiple sources, flexible transformations, and conditional routing. Where Firehose shines for linear pipelines (input → optional transform → destination), OpenSearch Ingestion excels when you need branching logic, multiple transformations, or different routing based on content.

The configuration language is YAML-based and deliberately reminiscent of Logstash's approach, which makes migration easier for teams coming from Logstash. Here's what a comparable pipeline looks like:

```yaml
source:
  http:
    path: "/logs"

processor:
  - parse_json:
  - rename_keys:
      entries:
        - from: "log_level"
          to: "level"
        - from: "msg"
          to: "message"
  - filter:
      regex: 'message: "/health"'
  - add:
      entries:
        environment: "production"
        timestamp: $${now()}

sink:
  - opensearch:
      hosts:
        - "https://my-domain.us-east-1.es.amazonaws.com"
      index: "logs-%{+YYYY.MM.dd}"
      auth:
        aws_sigv4:
          region: "us-east-1"
```

Notice how this mirrors Logstash's input-filter-output model. You define sources (multiple inputs are supported), processors (chained transformations), and sinks (destinations). The syntax is familiar to anyone who's written Logstash configs.

OpenSearch Ingestion processors are extensive. You can parse structured data (JSON, XML, CSV, syslog), enrich records using lookup tables, apply conditional logic, buffer to disk for reliability, and route traffic based on content patterns. For teams running sophisticated Logstash deployments, this is the "apples to apples" replacement.

One significant advantage of OpenSearch Ingestion over Logstash is its built-in integration with Amazon OpenSearch domains. It understands OpenSearch best practices, handles index management, and provides native monitoring and alerting. If your logs ultimately land in OpenSearch (a common pattern), the integration is seamless.

### Feature Parity: What You Lose and Gain

Let's be direct: neither Firehose nor OpenSearch Ingestion will give you 100% feature parity with Logstash's plugin ecosystem. Logstash has hundreds of plugins for niche sources and destinations. If you're ingesting logs from an obscure proprietary system or routing to a specialized platform, Logstash might still be your only option.

However, for the 80% of deployments that use standard sources (CloudWatch Logs, Kinesis, HTTP endpoints) and common destinations (OpenSearch, S3, Datadog), the coverage is excellent. OpenSearch Ingestion in particular has a rich processor library covering parsing, filtering, enrichment, and routing.

One key difference: error handling. Logstash has sophisticated retry mechanisms and dead-letter queue patterns built in. OpenSearch Ingestion provides buffering to disk and circuit breakers, but the error handling model is different. You need to understand that failed records are retried according to the service's configuration, not your custom logic.

For Firehose, transformation failures are handled by sending records to an optional failure S3 bucket. This is simpler than Logstash's approach and works well for detecting issues, but it's less flexible if you need to retry with exponential backoff or reroute based on error type.

Another consideration is stateful processing. Logstash filters can maintain state across records, useful for pattern detection or aggregation. Neither Firehose nor OpenSearch Ingestion natively support stateful processing in the same way. If you're doing complex correlation or machine learning within your pipeline, you'll need a different approach (perhaps Lambda with external state storage, or a stream processing service like Kinesis Analytics).

### Cost Comparison: Where the Economics Shift

This is where the narrative changes for many teams. Logstash's operational cost is often invisible—you're paying for EC2 instances, data transfer, and your time managing them. When you switch to managed services, those costs become explicit, which can initially seem expensive.

Let's work through an example. Suppose you have two Logstash instances in an autoscaling group, each running on a t3.large instance ($0.1032/hour). They process 100 GB of logs per day. Your current monthly cost is approximately $1,440 for compute alone, plus data transfer, storage, and operational overhead.

With Firehose processing the same 100 GB daily, you'd pay $0.029 per GB ingested (pricing varies by region). That's roughly $87/month for ingestion. Add OpenSearch costs for storage and you're competitive or ahead, depending on your OpenSearch configuration.

The key insight: managed services don't have idle time. You're not paying for capacity; you're paying for usage. If your log volume varies significantly, this becomes a major advantage. Logstash instances sit at half capacity most of the time, but you pay for them anyway.

However, Firehose's Lambda transformation has its own cost. If you're processing billions of records daily, Lambda costs can add up. OpenSearch Ingestion charges by the processing pipeline capacity and instance hours, similar to traditional infrastructure pricing. For moderate workloads, the math favors managed services. For very high volume (petabytes daily), the economics depend on your specific scenario.

A useful mental model: if your Logstash deployment is oversized relative to average load, you'll save money with managed services. If it's tightly tuned and always under high load, the savings are modest but still exist due to eliminating operational overhead.

### Migration: A Practical Walkthrough

Now let's actually do a migration. We'll assume you have an existing Logstash pipeline and want to move to OpenSearch Ingestion (the more feature-rich option, though similar principles apply to Firehose).

**Step 1: Inventory Your Current Pipeline**

Start by documenting exactly what your Logstash config does. Extract inputs, list all filters with their parameters, note destinations, and identify any custom logic or plugins.

For example, if your current Logstash config looks like this:

```
input {
  tcp {
    port => 5000
    codec => json
  }
}

filter {
  mutate {
    rename => { "message" => "msg" }
  }
  
  if [level] == "ERROR" {
    metrics {
      meter => "errors"
    }
  }
}

output {
  elasticsearch {
    hosts => ["localhost:9200"]
    index => "logs-%{+YYYY.MM.dd}"
  }
}
```

You're accepting TCP connections, parsing JSON, renaming a field, counting errors, and writing to Elasticsearch. That's your migration target.

**Step 2: Map to OpenSearch Ingestion Processors**

Translate each Logstash filter into OpenSearch Ingestion processors:

```yaml
source:
  tcp:
    address: "0.0.0.0:5000"
    mode: "server"
    format: "json"

processor:
  - rename_keys:
      entries:
        - from: "message"
          to: "msg"
  - conditional:
      routes:
        - condition: "/level == \"ERROR\""
          processor:
            - add:
                entries:
                  error_metric: true

sink:
  - opensearch:
      hosts:
        - "https://my-domain.us-east-1.es.amazonaws.com"
      index: "logs-%{+YYYY.MM.dd}"
      auth:
        aws_sigv4:
          region: "us-east-1"
```

Not every Logstash feature has a direct equivalent, but the pattern is clear: you're translating imperative logic into a declarative processor pipeline.

**Step 3: Set Up Parallel Ingestion**

Don't cut over immediately. Run both Logstash and OpenSearch Ingestion in parallel for a period, ideally 2-4 weeks. Send logs to both systems simultaneously using a tool like Kafka or a simple script that duplicates events.

This parallel running accomplishes two things: it builds confidence that OpenSearch Ingestion is handling your workload correctly, and it lets you compare outputs to detect any subtle behavioral differences.

```python
# Pseudo-code: duplicate events to both systems
import socket

def send_log(log_event):
    logstash_sock = socket.socket()
    logstash_sock.connect(('logstash-host', 5000))
    logstash_sock.sendall(json.dumps(log_event).encode())
    logstash_sock.close()
    
    firehose_sock = socket.socket()
    firehose_sock.connect(('opensearch-ingestion-endpoint', 5000))
    firehose_sock.sendall(json.dumps(log_event).encode())
    firehose_sock.close()
```

**Step 4: Validate Output and Performance**

While running in parallel, monitor both systems. Compare record counts, check for transformation accuracy, and measure latency. OpenSearch Ingestion should handle your volume without breaking a sweat—it's purpose-built for log ingestion at scale.

Create a test query in your log analysis tool (OpenSearch Dashboards, or wherever you analyze logs) that validates key metrics:
- Total document count (should be identical between systems)
- Distribution of log levels, sources, or other dimensions
- Presence of expected enriched fields
- Absence of corrupted records

```
# Query to compare record counts between Logstash and OpenSearch Ingestion sources
GET logs-*/_count

# Should include both sources for comparison
```

**Step 5: Cutover with a Rollback Plan**

Once you're confident, gradually shift traffic. Start with 10% of log volume, monitor for 24 hours, then 50%, then 100%. Keep Logstash running as a fallback for at least a week post-cutover.

Define a clear rollback trigger: if error rates spike, if latency exceeds thresholds, or if record loss occurs, you switch back to Logstash immediately. This psychological safety net helps teams move faster because the risk is contained.

**Step 6: Decommission Logstash**

Once you've verified OpenSearch Ingestion is stable for 2-4 weeks in production, you can safely decommission Logstash. This is where the cost savings become real.

### Handling Special Cases

Some teams have Logstash features that don't map neatly to managed services. Let's address a few.

**Custom Plugins or Complex Logic**

If you've written custom Logstash plugins or have extremely complex filter logic, you have options. For Firehose, you can embed that logic in your transformation Lambda. For OpenSearch Ingestion, you might need to combine it with Lambda enrichment or accept that certain complex logic moves to a different layer (e.g., post-ingest processing in OpenSearch itself).

**Multi-Destination Pipelines**

Logstash lets you conditionally route logs to different destinations in a single config. Both Firehose and OpenSearch Ingestion support this, though the patterns differ. OpenSearch Ingestion's conditional processors and multiple sinks handle this elegantly. Firehose requires a more creative approach—you might use a single Lambda transformation that adds tags, then use OpenSearch Ingestion downstream to route based on those tags.

**High-Volume, Low-Latency Requirements**

If you're processing millions of events per second with sub-second latency requirements, Logstash's design (direct stream processing) might offer lower latency than Firehose's batching model. OpenSearch Ingestion is designed for this workload and should handle it well. However, for the highest throughput scenarios, a Kinesis-based approach (raw Kinesis Streams with Lambda consumers) might be more cost-effective.

**Handling Late-Arriving Data**

Logstash has built-in resilience for out-of-order events. OpenSearch Ingestion buffers to disk by default, providing similar guarantees. Firehose's behavior depends on your transformation Lambda. In general, both AWS-native services handle this better than many teams expect, but you should verify that your specific use case works as required.

### Operational Considerations

Beyond the technical migration, there are operational aspects to think about.

**Monitoring and Debugging**

Logstash has a rich ecosystem of monitoring tools. AWS-native services integrate with CloudWatch. You'll want to set up metrics for record count, processing latency, and error rate in CloudWatch. OpenSearch Ingestion also provides pipeline statistics that are valuable for understanding bottlenecks.

Setting up proper alarms is critical. You want to know immediately if your pipeline stops processing, if error rates spike, or if latency degrades.

**Testing and Validation**

With Logstash, you might have run test files through your filter chains. Replicate this with OpenSearch Ingestion by creating small test datasets and validating the transformation output locally (you can test the YAML config without deploying). Firehose requires testing in AWS itself, usually via a test Lambda invocation with sample data.

**Governance and Change Management**

Logstash configs live in files, usually in version control. OpenSearch Ingestion configs also live in code, making them easy to track and review. However, some of the supporting infrastructure (IAM roles, OpenSearch domain configuration) needs version control discipline as well. Treat your AWS infrastructure as code from day one.

**Cost Monitoring**

Set up billing alerts immediately after migration. AWS cost tools will help you track Firehose or OpenSearch Ingestion spend. Compare this against your previous Logstash infrastructure costs to validate the business case.

### When to Stick with Logstash

We've focused on when to migrate, but there are legitimate reasons to keep Logstash.

If you're not on AWS—if you're a hybrid or multi-cloud organization—Logstash is more portable. AWS-native services are specific to AWS, so they don't help you on GCP or Azure.

If you have deeply customized Logstash deployments with many proprietary plugins, migration might not be worth the effort. You'd need to either rewrite plugins as Lambda functions or find alternative processors in OpenSearch Ingestion.

If you're processing logs locally before they reach AWS (e.g., on-premises log collection feeding to cloud), Logstash's deployment flexibility is valuable.

And if your organizational processes, runbooks, and team expertise are deeply rooted in Logstash, the switching cost might outweigh the operational benefits. This is a real consideration: people and process matter as much as technology.

### Conclusion

The shift from Logstash to AWS-native log ingestion isn't a simple technology decision—it's about reducing operational burden, potentially lowering costs, and gaining the scalability that comes with managed services. Kinesis Data Firehose is ideal for straightforward pipelines with modest transformation needs. Amazon OpenSearch Ingestion handles complex scenarios without sacrificing flexibility or control.

The migration path is well-defined: inventory your current pipeline, map features to AWS services, run in parallel to build confidence, then gradually shift traffic. Most teams complete a full migration in 2-4 months.

The real win isn't just eliminating Logstash processes to manage—it's reclaiming engineering time and operational capacity. Your team spends hours patching JVMs and debugging memory leaks instead of working on features. Moving those problems to AWS means your team can focus on what matters: understanding your logs and fixing the issues they reveal.

If you've been running Logstash on AWS for years, it's worth seriously evaluating whether one of these managed alternatives makes sense for your workload. The answer, for most teams, will be yes.
