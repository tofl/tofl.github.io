---
title: "Aurora Cluster Endpoints Explained: Writer, Reader, and Custom Endpoints"
---

## Aurora Cluster Endpoints Explained: Writer, Reader, and Custom Endpoints

If you've worked with Amazon Aurora, you've probably noticed that your cluster doesn't give you a single database hostname. Instead, you get multiple DNS names—writer endpoints, reader endpoints, maybe custom endpoints. These aren't random URLs; they're carefully designed DNS abstractions that route your connections to the right database instances and handle failover automatically. Understanding how they work is essential for building reliable applications on Aurora and for getting the most out of your cluster architecture.

In this article, we'll demystify Aurora's endpoint system. You'll learn what each endpoint type does, how Aurora's DNS magic keeps them in sync with your actual instances, how to use them effectively in your application, and how to design custom endpoints for specialized workloads.

### Why Aurora Endpoints Matter

Before diving into endpoint types, let's establish why this matters. In a traditional single-instance database setup, you connect to one host, and that's it. If something goes wrong, you're down. Aurora changes that game by spreading your data across multiple instances within a cluster, and endpoints are the abstraction layer that lets your application take advantage of this resilience.

Every Aurora cluster is a collection of database instances. One instance is the writer (also called the primary) and handles all writes. The others are read replicas. Your application could theoretically keep track of all these instances and decide which one to connect to based on whether it needs to read or write. But that's fragile—when a failover happens, your hard-coded instance list becomes wrong. Endpoints solve this problem by providing logical names that Aurora updates automatically as the cluster changes.

### Understanding Aurora Cluster Endpoints

An Aurora cluster exposes multiple endpoints, each with a distinct purpose. These endpoints are DNS names that resolve to one or more instances in your cluster. The magic is in how Aurora maintains these mappings and updates them in real time.

#### The Writer Endpoint

The writer endpoint (or primary endpoint) is the canonical entry point for all write operations. It always resolves to whichever instance is currently the primary (the writer). Every INSERT, UPDATE, DELETE, and DDL statement should go through the writer endpoint.

Here's the crucial part: when Aurora performs a failover—perhaps because the current primary has a hardware failure—the writer endpoint's DNS record updates automatically to point to the new primary. Your application doesn't need to know this happened. The next connection attempt to the writer endpoint will resolve to the new primary, and you're back in business. This automatic DNS update typically happens within seconds, making Aurora failovers largely transparent to your application.

For example, if your cluster is named `my-cluster`, the writer endpoint looks something like:

```
my-cluster.cluster-123456789.us-east-1.rds.amazonaws.com
```

When you connect to this endpoint, you're guaranteed to hit the writer instance. If you run `SELECT @@aurora_server_id` immediately after connecting, you'll see the ID of the current primary.

#### The Reader Endpoint

The reader endpoint provides read-only access and distributes connections across all available read replicas (plus the primary, if it has capacity). This is where things get interesting.

The reader endpoint's DNS name looks similar:

```
my-cluster.cluster-ro-123456789.us-east-1.rds.amazonaws.com
```

Note the `ro` in the middle—that's how you recognize it as a reader endpoint. When you query this endpoint, your connection is routed to one of the available replicas in the cluster. If you connect multiple times, Aurora attempts to spread those connections across different instances for load balancing.

However, there's an important caveat: the reader endpoint uses DNS round-robin load balancing, not connection pooling. This means each new connection you establish gets routed to the next instance in the rotation. If your application opens one connection and keeps it open, you're stuck on that same instance for the entire lifetime of the connection. This is fine for many applications, but if you have thousands of short-lived connections or if you're using a connection pool, you should understand the implications.

Consider a scenario: you have an Aurora cluster with one primary and four read replicas, connected via the reader endpoint. If your application maintains a persistent connection pool of 10 connections, those 10 connections are likely distributed across your 5 instances—maybe 2 connections per instance. When you query through the pool, you're not automatically load-balancing across all 5 instances; you're distributing load based on which instances happen to hold connections from your pool. This is usually fine, but it's not dynamic load balancing in the way a layer-7 load balancer would work.

For connection pooling scenarios, some teams use custom endpoints (which we'll cover shortly) to create smaller, more targeted pools, or they implement application-level logic to occasionally refresh connections.

#### The Instance Endpoint

Each individual instance in your cluster also has its own endpoint:

```
my-cluster-instance-1.123456789.us-east-1.rds.amazonaws.com
```

These instance endpoints are useful in specialized scenarios. You might connect directly to a specific replica if you need to run a long-running analytical query and want to ensure you're not competing with other read traffic. Or you might connect directly to the primary for a specific task. However, instance endpoints are brittle because they don't abstract away instance failures—if you connect to `instance-1` and it becomes unavailable, you won't automatically failover.

Most applications should avoid instance endpoints in favor of cluster endpoints, because you lose the resilience benefits. The exception is when you explicitly need control over which instance handles your query, which brings us to custom endpoints.

### Designing with Custom Endpoints

Custom endpoints are where Aurora's flexibility really shines. A custom endpoint is a cluster endpoint that you define to include a specific subset of instances in your cluster. This allows you to isolate workloads and optimize your cluster for different access patterns.

For example, imagine you have a cluster with one primary and three read replicas. You might want to dedicate one replica to reporting queries (which tend to be slow and resource-intensive) and use the other two for general application reads. You can create a custom endpoint that includes only the reporting replica, ensuring that your reporting jobs don't starve your application's read queries.

Creating a custom endpoint is straightforward in the AWS console or via CLI:

```bash
aws rds create-db-cluster-endpoint \
  --db-cluster-identifier my-cluster \
  --db-cluster-endpoint-identifier reporting-endpoint \
  --endpoint-type READER \
  --static-members instance-3
```

This creates a custom reader endpoint that includes only `instance-3`. Your application can then use this endpoint for reporting queries:

```python
# General application reads
app_conn = pymysql.connect(host='my-cluster.cluster-ro-123456789.us-east-1.rds.amazonaws.com')

# Reporting queries that might be heavy
reporting_conn = pymysql.connect(host='reporting-endpoint.cluster-custom-123456789.us-east-1.rds.amazonaws.com')
```

Custom endpoints can be either `READER` or `WRITER` type. A custom writer endpoint is unusual but valid—it still points to the primary, just like the regular writer endpoint. The difference is you can include only certain instances in a custom reader endpoint.

You define custom endpoints using two membership modes: static and dynamic. In static membership mode, you explicitly specify which instances are included. In dynamic membership mode, Aurora automatically includes all instances matching certain criteria (for example, all instances with a certain instance class). Dynamic membership is more flexible if your cluster topology changes frequently.

### The DNS Resolution Mechanism

Understanding the DNS magic behind endpoints helps you troubleshoot and design better. When you query a reader endpoint, AWS doesn't send you a list of all available replicas. Instead, it returns a single DNS A record pointing to one instance. Each time your client resolves the hostname, it gets a potentially different answer—that's the round-robin load balancing in action.

Here's what happens under the hood:

1. Your application performs a DNS lookup for `my-cluster.cluster-ro-123456789.us-east-1.rds.amazonaws.com`.
2. Aurora's DNS service returns multiple A records (one for each available read replica), rotated in a round-robin fashion.
3. Your DNS resolver (or your OS's resolver) picks one of these records and returns it to your application.
4. Your application connects to that IP address, which corresponds to that specific replica.

The key insight is that load balancing happens at DNS resolution time, not at the connection time. If your application caches DNS results aggressively or uses a persistent connection pool, you're not getting new round-robin distribution with each query—you're bound to whatever instance the connection pool picked.

Failover works similarly but with more sophistication. When Aurora detects that a read replica has failed, it removes that instance from the reader endpoint's DNS rotation. Clients that are already connected to that instance might experience a brief error on the next query, but new connection attempts bypass the failed instance. The primary's failover is more significant—AWS promotes a read replica to be the new primary, updates the writer endpoint's DNS record, and demotes the old primary to a read replica (if it comes back online). This whole process usually takes 30-60 seconds for a healthy replica to take over.

### Practical Connection String Examples

Let's look at how you'd configure different scenarios in your application. Here are examples using common database drivers:

For general application reads and writes, separate the concerns:

```python
import pymysql

# For writes (always use the writer endpoint)
writer_conn = pymysql.connect(
    host='my-cluster.cluster-123456789.us-east-1.rds.amazonaws.com',
    user='admin',
    password='password',
    database='mydb'
)

# For reads (use the reader endpoint for load distribution)
reader_conn = pymysql.connect(
    host='my-cluster.cluster-ro-123456789.us-east-1.rds.amazonaws.com',
    user='admin',
    password='password',
    database='mydb'
)

# Execute writes through writer
writer_conn.query("INSERT INTO users (name) VALUES ('Alice')")

# Execute reads through reader
reader_conn.query("SELECT * FROM users")
```

With a connection pool and custom endpoints for workload isolation:

```python
from sqlalchemy import create_engine

# Main application reads
app_read_pool = create_engine(
    'mysql+pymysql://admin:password@my-cluster.cluster-ro-123456789.us-east-1.rds.amazonaws.com/mydb',
    pool_size=10,
    max_overflow=20,
    pool_pre_ping=True
)

# Heavy reporting queries to a dedicated replica
reporting_pool = create_engine(
    'mysql+pymysql://admin:password@reporting-endpoint.cluster-custom-123456789.us-east-1.rds.amazonaws.com/mydb',
    pool_size=5,
    max_overflow=5,
    pool_pre_ping=True
)

# Writes to the primary
write_pool = create_engine(
    'mysql+pymysql://admin:password@my-cluster.cluster-123456789.us-east-1.rds.amazonaws.com/mydb',
    pool_size=10,
    max_overflow=20,
    pool_pre_ping=True
)
```

Notice the `pool_pre_ping=True` parameter. This tells SQLAlchemy to test each connection before using it, which is important because failed connections might not be immediately detected otherwise.

### Application Configuration Best Practices

When building applications on Aurora, keep these endpoint practices in mind:

**Always use the writer endpoint for writes.** Never try to balance writes across multiple instances or route them to read replicas. The reader endpoints accept write connections (they'll fail on the actual write operation), but this is a mistake waiting to happen.

**Separate read and write connection pools.** If you're using connection pooling, maintain separate pools for reads and writes. This prevents a single misconfiguration from affecting both. Size them appropriately for your workload—writes usually need fewer connections than reads.

**Understand your DNS resolver's behavior.** Some DNS resolvers cache results aggressively, which can interfere with round-robin load balancing across reader replicas. If you're seeing unbalanced read load, check your DNS TTL settings and resolver caching behavior. Aurora's DNS typically returns a short TTL (5 seconds) to encourage frequent re-resolution.

**Use custom endpoints for workload isolation.** If you have distinct workload patterns—like OLTP versus analytical queries—consider creating separate custom endpoints. This prevents one workload from starving another.

**Handle connection failures gracefully.** During failover, connections to the old primary might fail. Implement retry logic with exponential backoff. Most database drivers and ORMs have built-in retry mechanisms; make sure they're enabled.

**Monitor endpoint performance.** Use CloudWatch metrics to track connection counts, query latency, and CPU across your replicas. If one replica is consistently handling more traffic than others, your client's DNS resolver might be misbehaving, or your connection pool distribution needs adjustment.

### Common Pitfalls and How to Avoid Them

Several mistakes are common when working with Aurora endpoints. Understanding them helps you design more resilient systems.

The first is misunderstanding the reader endpoint as providing automatic query-level load balancing. It doesn't. If you open a connection and issue a hundred queries on that connection, they all go to the same replica. The load balancing is per-connection, not per-query. If you need finer-grained load balancing, you need either application logic to periodically refresh connections or a proxy layer.

The second is hardcoding instance endpoints instead of using cluster endpoints. Instance endpoints are tempting because they give you explicit control, but they're fragile. When an instance fails or is replaced, your hardcoded endpoint breaks. Always prefer cluster and custom endpoints.

The third is ignoring replication lag. When you read from a replica, you're reading slightly stale data. In Aurora, replication lag is typically less than 100 milliseconds, but it's not zero. If your application requires up-to-the-second consistency for certain queries, you need to route those to the writer endpoint or implement application-level consistency checks.

The fourth is creating too many custom endpoints. Custom endpoints are useful, but each one adds operational complexity. A reasonable Aurora cluster might have three to five endpoints: the standard writer, the standard reader, and two or three custom endpoints for specific workloads. If you're creating custom endpoints for every possible scenario, you're probably overcomplicating things.

### Failover and Endpoint Behavior

Understanding how endpoints behave during failover is crucial for designing resilient applications. When Aurora detects that the primary instance has failed, it begins the failover process. This involves selecting one of the read replicas (ideally the one with the least replication lag), promoting it to be the new primary, and updating the writer endpoint's DNS record to point to it.

During this process, applications connected to the writer endpoint might experience a brief connection reset. Your application should handle this by catching the connection error, waiting a moment, and retrying. Most database drivers and frameworks handle this automatically, but it's worth verifying.

Read replica failovers are less dramatic. If a read replica fails, Aurora simply stops including it in the reader endpoint's DNS rotation. New connections bypass it automatically. Existing connections to that replica will receive errors on their next query, so implementing retry logic is important.

One nuance: if you're using custom reader endpoints with static membership and a replica in that endpoint fails, the endpoint continues to include that replica in its configuration until you manually remove it. The endpoint's DNS might fail to resolve or resolve to an unhealthy instance. Monitor your custom endpoints and remove failed instances from static membership promptly.

### Monitoring and Troubleshooting

When troubleshooting endpoint-related issues, several CloudWatch metrics and logs are helpful. Check the `DatabaseConnections` metric to see how many connections each instance is handling. Significant imbalance across reader replicas suggests a DNS or pooling issue. The `AuroraGlobalDBReplicationLag` metric helps identify replication lag, which affects read consistency.

Query logs are also invaluable. Enable slow query logging to identify queries that might be better suited for a dedicated custom endpoint. Use the `general_log` (sparingly, as it's expensive) or the slow query log to understand your workload's distribution.

When debugging DNS resolution issues, use your operating system's DNS tools:

```bash
# Resolve the reader endpoint multiple times to see round-robin in action
nslookup my-cluster.cluster-ro-123456789.us-east-1.rds.amazonaws.com
nslookup my-cluster.cluster-ro-123456789.us-east-1.rds.amazonaws.com
nslookup my-cluster.cluster-ro-123456789.us-east-1.rds.amazonaws.com
```

Each invocation should potentially return a different IP address (corresponding to different replicas). If you always get the same IP, your local resolver is caching too aggressively.

### Conclusion

Aurora's endpoint system is a elegant solution to a hard problem: how do you give applications a stable interface to a distributed, changing set of database instances? The writer endpoint abstracts away primary instance failures. The reader endpoint distributes read load while remaining simple to use. Custom endpoints let you optimize for diverse workload patterns.

The key takeaway is that endpoints are DNS abstractions, not magic proxies. Load balancing happens at connection time, failover happens through DNS updates, and your application's behavior—how it pools connections, retries errors, and interprets DNS results—shapes whether you get true resilience or just the illusion of it.

When you design your application, think through your read and write patterns. Separate your connection pools. Consider whether custom endpoints would isolate your workloads effectively. Implement proper error handling for failover scenarios. And monitor your endpoint performance to ensure your actual load distribution matches your expectations.

With these practices in place, you'll build applications that fully leverage Aurora's distributed architecture and remain standing when individual instances fail.
