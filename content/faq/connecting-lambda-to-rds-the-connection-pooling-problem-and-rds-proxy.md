---
title: "Connecting Lambda to RDS: The Connection Pooling Problem and RDS Proxy"
---

## Connecting Lambda to RDS: The Connection Pooling Problem and RDS Proxy

Every developer who's deployed a Lambda function that talks to a relational database eventually hits the same wall: the database connection pool gets exhausted, requests start timing out, and suddenly you're fielding alerts at 3 AM. The culprit is almost always the same—a well-intentioned connection being created fresh on every single Lambda invocation. It's such a pervasive anti-pattern that understanding *why* it happens and *how* to fix it has become essential knowledge for anyone building serverless applications on AWS.

The good news is that AWS recognized this problem years ago and built RDS Proxy to solve it. But RDS Proxy isn't just a band-aid; it represents a fundamental shift in how you think about database connectivity in serverless architectures. In this article, we'll explore why traditional connection pooling breaks down in Lambda environments, how RDS Proxy acts as a managed pooling layer, and what alternatives exist when RDS isn't the right fit.

### The Lambda and Database Connection Problem

To understand the problem, you need to grasp a key architectural difference between traditional servers and Lambda functions. When you run an application on an EC2 instance or an on-premises server, your connection pool is typically instantiated once at application startup. That single pool of, say, 10 connections is reused across hundreds or thousands of requests. The pool grows and shrinks as needed, but the management overhead is spread across many requests.

Lambda changes this equation entirely. Each Lambda invocation runs in an isolated execution environment. Even within what feels like a "warm" Lambda (one that hasn't been recycled), the handler function is invoked independently. If you create a database connection inside your handler function—the code that actually runs on each invocation—you're creating a new connection for every single request.

Consider a simple Python Lambda function that queries RDS:

```python
import psycopg2
import json

def lambda_handler(event, context):
    conn = psycopg2.connect(
        host="mydb.abc123.us-east-1.rds.amazonaws.com",
        user="admin",
        password="mypassword",
        database="mydatabase"
    )
    
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM users WHERE id = %s", (event['user_id'],))
    result = cursor.fetchone()
    
    conn.close()
    
    return {
        'statusCode': 200,
        'body': json.dumps(result)
    }
```

This code looks reasonable at first glance. The connection is created, used, and closed cleanly. But now imagine this function gets invoked 1,000 times concurrently during a traffic spike. That's 1,000 new database connections being created almost simultaneously. Most RDS instances have a connection limit—typically between 100 and several hundred depending on the instance class. You'll breach that limit almost instantly, and subsequent Lambda invocations will fail with "too many connections" errors.

### Why Traditional Connection Pooling Doesn't Work in Lambda

You might be thinking: "Can't I just create a connection pool and reuse it?" That's a natural question, and it's where many developers second-guess the serverless model. The answer is both yes and no, and the nuance matters.

Connection pooling *can* work in Lambda, but only in very specific, limited scenarios. The trick is to create the connection or pool *outside* the handler function—in the initialization code that runs once per execution environment. Here's the corrected approach:

```python
import psycopg2
from psycopg2 import pool
import json

# This runs once per execution environment (not per invocation)
connection_pool = psycopg2.pool.SimpleConnectionPool(
    1, 5,  # min and max connections
    host="mydb.abc123.us-east-1.rds.amazonaws.com",
    user="admin",
    password="mypassword",
    database="mydatabase"
)

def lambda_handler(event, context):
    conn = connection_pool.getconn()
    
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM users WHERE id = %s", (event['user_id'],))
        result = cursor.fetchone()
    finally:
        connection_pool.putconn(conn)
    
    return {
        'statusCode': 200,
        'body': json.dumps(result)
    }
```

This is better. The pool is created once when the Lambda container first starts, and subsequent invocations reuse connections from that pool. In theory, this sounds good—why not just do this everywhere?

The problem reveals itself under realistic scale. Lambda's true power lies in its ability to scale elastically. When demand increases, AWS automatically launches new execution environments to handle the load. If you have 1,000 concurrent requests, you might spin up 100 new Lambda execution environments. Each of those environments creates its own connection pool, potentially with 5 connections each. Suddenly you have 500 connections to your database—and you've lost the visibility and central management you had with a single application pool on a dedicated server.

Moreover, when the spike passes and Lambda scales down, those idle connections persist for a few minutes (the lifetime of an execution environment) before being cleaned up. Your database is now managing connections that nobody's using. And if you have connection leaks—connections that are never returned to the pool—your database connection count can slowly drift upward over time until you hit the ceiling.

This isn't a bug in your code; it's a fundamental mismatch between Lambda's elastic, distributed architecture and the way traditional connection pooling was designed for monolithic applications.

### Introducing RDS Proxy: The Managed Pooling Layer

RDS Proxy sits between your Lambda functions and your RDS database instance, acting as a dedicated connection pooling and multiplexing layer. Instead of Lambda functions connecting directly to the database, they connect to RDS Proxy. RDS Proxy manages a smaller, fixed-size pool of connections to the actual RDS instance and multiplexes requests from many Lambda invocations across those few connections.

Think of it like a smart receptionist: thousands of Lambda functions are calling in, but instead of giving each one a direct line to the switchboard (the database), they go through a receptionist (RDS Proxy) who manages a much smaller set of actual lines and intelligently routes conversations to the right one.

Here's the architectural difference in practice:

**Without RDS Proxy:** Lambda → RDS (many direct connections)

**With RDS Proxy:** Lambda → RDS Proxy → RDS (many Lambda connections multiplexed onto few database connections)

The practical benefit is significant. Instead of your RDS instance managing 500 concurrent connections from Lambda, it might manage 20. Those 20 connections can handle thousands of queries because RDS Proxy manages the queueing and scheduling intelligently.

Setting up RDS Proxy starts with creating a proxy in the AWS Console or via CLI:

```bash
aws rds create-db-proxy \
  --db-proxy-name my-proxy \
  --engine-family MYSQL \
  --auth '{"AuthScheme": "SECRETS", "SecretArn": "arn:aws:secretsmanager:..."}' \
  --role-arn arn:aws:iam::ACCOUNT:role/ProxyRole \
  --max-idle-connections-percent 50 \
  --max-connections-percent 100 \
  --session-pinning-filters '["EXCLUDE_VARIABLE_SETS"]'
```

Once created, you get a proxy endpoint (something like `my-proxy.proxy-123abc.us-east-1.rds.amazonaws.com`). Your Lambda functions then connect to this endpoint instead of the RDS instance directly. From the Lambda code's perspective, it looks almost identical:

```python
import psycopg2
import json

def lambda_handler(event, context):
    conn = psycopg2.connect(
        host="my-proxy.proxy-123abc.us-east-1.rds.amazonaws.com",  # Note: proxy endpoint
        user="admin",
        password="mypassword",
        database="mydatabase"
    )
    
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM users WHERE id = %s", (event['user_id'],))
    result = cursor.fetchone()
    
    conn.close()
    
    return {
        'statusCode': 200,
        'body': json.dumps(result)
    }
```

The code is nearly identical—you've just changed the hostname. But the behavior underneath is completely different. Each Lambda invocation still opens a connection (to the proxy), but that connection is short-lived and quickly returned to the proxy's pool. The proxy maintains a much smaller set of long-lived connections to the actual RDS instance.

### IAM Authentication with RDS Proxy

One of the most powerful features of RDS Proxy is its integration with IAM authentication. Instead of storing database passwords in your Lambda environment or in Secrets Manager, you can use short-lived IAM credentials to authenticate. This reduces the blast radius if credentials are ever compromised and eliminates the need to rotate database passwords.

To enable IAM authentication on RDS Proxy, you configure it to use an IAM database user. Your Lambda execution role gets a policy allowing it to connect via the proxy:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "rds-db:connect",
      "Resource": "arn:aws:rds:us-east-1:ACCOUNT:db-proxy:my-proxy/*"
    }
  ]
}
```

Then, instead of passing a password, you generate a temporary authentication token:

```python
import boto3
import psycopg2
import json

def lambda_handler(event, context):
    rds = boto3.client('rds')
    
    # Generate temporary auth token
    token = rds.generate_db_auth_token(
        DBHostname='my-proxy.proxy-123abc.us-east-1.rds.amazonaws.com',
        Port=5432,
        DBUser='iamuser'
    )
    
    conn = psycopg2.connect(
        host='my-proxy.proxy-123abc.us-east-1.rds.amazonaws.com',
        user='iamuser',
        password=token,
        database='mydatabase',
        ssl='require'
    )
    
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM users WHERE id = %s", (event['user_id'],))
    result = cursor.fetchone()
    
    conn.close()
    
    return {
        'statusCode': 200,
        'body': json.dumps(result)
    }
```

The token is valid for 15 minutes and is generated on-the-fly using your Lambda's IAM credentials. If someone gains access to CloudWatch logs or accidentally commits code to a repository, they don't get database credentials—they get a time-bound, already-expired token that's useless.

### RDS Proxy Configuration and Cost Considerations

RDS Proxy offers several configuration parameters that directly impact performance and cost. Understanding these knobs helps you right-size the proxy for your workload.

**Max connections percent** controls the maximum number of database connections the proxy will open to the underlying RDS instance. The default is 100, meaning the proxy will use up to 100% of your RDS instance's `max_connections` setting. You might lower this if you want to reserve capacity for other applications.

**Max idle connections percent** controls how aggressively the proxy closes idle database connections. At 50 (the default), the proxy closes connections that have been idle for 30 minutes. Lowering this value makes the proxy more aggressive about reclaiming connections; raising it keeps more warm connections available.

**Session pinning filters** determine when the proxy "pins" a connection to a specific client. By default, the proxy tries to reuse connections across different client sessions whenever possible—that's the whole point of a pooling layer. But certain SQL operations (like setting session variables) might require the connection to be pinned to one client. The standard filter `EXCLUDE_VARIABLE_SETS` excludes operations like `SET` and `SET SESSION` from triggering pins.

From a cost perspective, RDS Proxy charges per vCPU-hour. A proxy with 1 vCPU costs roughly $0.015 per hour (pricing varies by region). That's about $11 per month for always-on proxy capacity. For most applications, a 1 vCPU proxy is sufficient—it can handle thousands of concurrent connections. If you're running thousands of queries per second, you might scale to 2 vCPUs, but rarely higher. The proxy cost is almost always negligible compared to the cost of your RDS instance or the cost of database connection errors from hitting connection limits.

The real ROI from RDS Proxy comes from improved reliability and reduced operational headaches, not just raw cost savings.

### Alternative Approaches: When RDS Proxy Isn't the Answer

RDS Proxy is the standard solution for Lambda-to-RDS connectivity problems, but it's not the only option. Depending on your use case, alternatives might be more appropriate.

**Aurora Serverless Data API** provides a REST endpoint for querying your database without managing connections at all. Instead of opening a persistent connection, you make HTTP POST requests to an HTTPS endpoint. Aurora Serverless v2 (the current generation) handles all connection management internally and scales automatically.

```python
import boto3
import json

def lambda_handler(event, context):
    rds_data = boto3.client('rds-data')
    
    response = rds_data.execute_statement(
        resourceArn='arn:aws:rds:us-east-1:ACCOUNT:cluster:my-aurora-cluster',
        secretArn='arn:aws:secretsmanager:us-east-1:ACCOUNT:secret:...',
        database='mydatabase',
        sql='SELECT * FROM users WHERE id = :id',
        parameters=[
            {'name': 'id', 'value': {'longValue': event['user_id']}}
        ]
    )
    
    return {
        'statusCode': 200,
        'body': json.dumps(response['records'])
    }
```

The Data API eliminates connection pooling concerns entirely, but at a trade-off: each query incurs API latency, and the Data API doesn't support all SQL operations (transactions are limited, for example). It's excellent for simple OLTP workloads and when you want the absolute minimum operational overhead.

**DynamoDB** or other NoSQL databases are another alternative if your data model fits. Serverless databases like DynamoDB are designed for Lambda workloads from the ground up—no connection pooling, no connection limits, unlimited concurrency (within account limits). The trade-off is architectural: you need to design for DynamoDB's key-value model rather than relational queries.

**Batch and queuing patterns** can reduce pressure on your database even with RDS Proxy. Instead of having every Lambda directly query the database, have Lambda write requests to an SQS queue, and use a separate application (perhaps running on ECS or EC2) that batches and processes those requests. This is more complex but gives you fine-grained control over database load.

For most greenfield serverless projects, I'd recommend starting with Aurora Serverless Data API if you have simple query patterns, or DynamoDB if you can model your data appropriately. RDS Proxy becomes the clear choice when you have an existing RDS investment, complex queries, or transaction requirements that serverless databases don't support well.

### Best Practices for Lambda Database Connectivity

Beyond choosing the right tool, a few practices ensure your Lambda-database integration stays healthy as your application scales.

**Initialize connections outside the handler.** If you're using RDS Proxy with traditional connection pools, create the pool at the module level (outside the handler function). This way, the pool is created once per execution environment and reused across invocations. Avoid creating connections inside the handler—that defeats the purpose of any pooling strategy.

**Use connection timeouts.** Always set reasonable connection and query timeouts. Lambda functions have a maximum execution time (up to 15 minutes), but your database should enforce its own limits to prevent queries from running indefinitely.

**Monitor connection counts.** Both your RDS instance and RDS Proxy expose CloudWatch metrics for active and idle connections. Set up alarms if active connections exceed a threshold—it's often a sign that your connection pool is misconfigured or your queries are too slow.

**Test connection behavior under load.** Connection pooling edge cases often emerge under realistic traffic patterns. Use load testing tools to simulate your expected peak traffic before deploying to production. Watch connection counts, query latencies, and error rates as load increases.

**Consider Lambda concurrency limits.** If you set a reserved concurrency limit on your Lambda function (to protect downstream resources), make sure your RDS Proxy or database can handle that concurrency. A proxy configured for 20 connections can't handle 1,000 concurrent Lambda invocations—you'll start queuing requests.

### Conclusion

The anti-pattern of creating a database connection per Lambda invocation stems from a fundamental misunderstanding of how serverless applications differ from traditional servers. Once you internalize the fact that Lambda execution environments are ephemeral and independently scalable, the solution becomes clear: you need a dedicated pooling layer.

RDS Proxy fills that role perfectly. It's a managed, AWS-native solution that sits between Lambda and your database, multiplexing potentially thousands of concurrent client connections onto a small pool of long-lived database connections. It integrates seamlessly with IAM authentication, eliminates password management, and costs almost nothing relative to the benefits.

That said, RDS Proxy isn't a universal answer. Aurora Serverless Data API eliminates connection concerns entirely at the cost of REST API latency, while DynamoDB and other NoSQL options avoid relational databases altogether. The right choice depends on your existing architecture, query patterns, and tolerance for refactoring.

What matters most is recognizing the problem. Once you understand why naive connection creation breaks in Lambda, the path forward becomes clear. Whether that path leads through RDS Proxy, the Data API, or a completely different database, you'll be making an informed architectural decision rather than discovering the limits of your connection pool during a production incident.
