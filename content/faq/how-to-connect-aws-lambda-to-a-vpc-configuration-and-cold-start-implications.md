---
title: "How to Connect AWS Lambda to a VPC: Configuration and Cold Start Implications"
---

## How to Connect AWS Lambda to a VPC: Configuration and Cold Start Implications

### Introduction

If you've worked with AWS Lambda for any meaningful duration, you've likely encountered the question: should my function run inside a VPC? It sounds straightforward, but the implications are profound. Attaching a Lambda function to a VPC unlocks access to private resources—your RDS database, ElastiCache cluster, or internal microservices—but comes with architectural trade-offs that many developers underestimate. The cold start penalties used to be severe enough to make VPC attachment a major performance concern, but AWS has made significant improvements that change the calculus considerably.

This guide walks you through the practical realities of VPC-attached Lambda functions: how to configure them properly, why IP address planning matters at scale, the modern cold start story, and most importantly, when you actually *need* VPC attachment and when it's unnecessary complexity. By the end, you'll understand not just *how* to wire up Lambda to a VPC, but *why* you'd make that choice and what pitfalls to avoid.

### Understanding Lambda Network Architecture

Before configuring anything, you need to understand what happens under the hood when you attach a Lambda function to a VPC.

By default, Lambda functions run in an AWS-managed VPC isolated from your own infrastructure. This is incredibly convenient for stateless, publicly-accessible workloads. But when you specify that a function should run inside your VPC, Lambda needs to establish a network interface in your subnets so traffic can reach your private resources.

Lambda accomplishes this by creating **Elastic Network Interfaces (ENIs)** attached to the subnets you specify. These ENIs are temporary constructs that exist for the duration of your function execution. When the Lambda container is created and initialized, an ENI is allocated from your subnet's available IP address pool. This ENI provides a private IP address within your VPC's CIDR block and allows bidirectional communication with other resources in that VPC.

Here's the key insight: Lambda doesn't create one ENI per invocation. Instead, it maintains a pool of ENIs that can be reused across multiple invocations. When a function scales and needs more concurrent capacity, Lambda creates additional ENIs up to a limit. This pooling approach is efficient for steady-state workloads but has implications for cold starts and IP address planning.

### Configuring Lambda VPC Attachment

Setting up VPC attachment is straightforward from a configuration perspective, but the details matter.

When you configure a Lambda function to use a VPC, you specify two things: one or more subnets and one or more security groups. In the AWS Console, this appears under the function's VPC section. Via the CLI, you'd use the `vpc-config` parameter when creating or updating a function.

Here's what a practical CLI invocation looks like:

```bash
aws lambda create-function \
  --function-name my-vpc-function \
  --runtime python3.11 \
  --role arn:aws:iam::123456789012:role/lambda-role \
  --handler index.handler \
  --zip-file fileb://function.zip \
  --vpc-config SubnetIds=subnet-12345,subnet-67890 \
            SecurityGroupIds=sg-abcdef
```

The subnets you select should have available IP addresses. This is not a trivial requirement at scale—we'll discuss IP planning in detail shortly. The security groups act as a firewall governing which traffic is allowed to reach the ENI from other resources and which outbound connections the function can initiate.

A common mistake is specifying subnets in different availability zones thinking it provides redundancy. While high availability is valuable, Lambda's ENI pooling already handles cross-AZ distribution. What matters more is that your subnets collectively have enough IP space to support your expected concurrency.

The security group configuration deserves careful attention. If your function needs to reach an RDS instance, the RDS security group must allow inbound traffic from the Lambda function's security group. If the function needs to reach the internet (say, to call a public API), your subnets must route traffic through a NAT gateway in a public subnet, and the security group must allow outbound traffic. These dependencies are easy to overlook and can lead to mysterious connectivity timeouts.

### The ENI and Cold Start Story: Before and After Hyperplane

The relationship between VPC attachment and Lambda cold starts has been a contentious topic in the AWS community, and understanding the evolution is important for context.

Prior to 2021, attaching a Lambda function to a VPC imposed a significant cold start penalty. When a Lambda container needed to be initialized with VPC access, it had to go through a process called "ENI attachment." The hypervisor had to allocate an ENI from your subnet's pool, assign it a private IP address, and configure network connectivity—a process that could add 5-10 seconds to a cold start. For latency-sensitive workloads, this was a hard blocker against VPC attachment.

AWS addressed this with **Hyperplane ENIs**, introduced in late 2021. Hyperplane fundamentally changed the architecture: instead of attaching traditional ENIs during container initialization, Lambda now uses shared, pre-initialized network infrastructure. The Hyperplane ENI is created once and shared across multiple Lambda execution contexts within the same function. This allows new execution environments to reuse network connectivity that's already established.

The practical impact is dramatic. Cold starts for VPC-attached functions now add roughly 1-2 milliseconds of overhead, compared to the previous 5-10 seconds. For most real-world applications, VPC attachment is no longer a significant performance concern.

However, Hyperplane doesn't eliminate all cold start overhead—your function code still needs to initialize, dependencies need to load, and memory needs to be allocated. VPC attachment just means the *network* part of initialization is no longer the bottleneck.

There's a subtle caveat worth understanding: while Hyperplane reduced cold start penalties dramatically, IP address exhaustion can still cause problems. If your subnet runs out of available IP addresses, Lambda can't create the Hyperplane infrastructure it needs, and you'll see errors or throttling. This is why IP address planning remains critical, even in the Hyperplane era.

### IP Address Planning for High-Concurrency Functions

This is where many teams stumble. IP address planning for Lambda might seem unnecessary—after all, you're not running permanent servers. But at scale, the numbers surprise people.

Each Lambda function requires a private IP address from your subnet's CIDR block. If you have a function that scales to 1,000 concurrent executions, Lambda needs 1,000 IP addresses available. Add another function with the same concurrency, and you need 2,000 addresses. Multiply that by the number of functions you plan to run, and the math becomes demanding.

Let's work through an example. Suppose you have a /24 subnet, giving you 256 usable IP addresses (minus network, broadcast, and reserved AWS addresses—really about 250 available). That subnet can support approximately 250 concurrent Lambda invocations before exhaustion. If your functions regularly scale beyond that, requests will fail with errors mentioning VPC IP space exhaustion.

The solution is to either provision larger subnets or distribute Lambda execution across multiple subnets. A /20 subnet gives you approximately 4,000 usable addresses. Many teams allocate a /19 or even /18 for Lambda execution to provide substantial headroom.

Here's a practical formula: estimate your peak concurrent Lambda invocations across all functions targeting a subnet, then multiply by 1.5 to provide headroom for scaling spikes. Size your subnets accordingly. This is a conversation you should have during VPC design, not discovered during an outage.

One sophisticated pattern is to use separate subnets for different Lambda functions or function types. This segregation can simplify security group rules and allows more granular IP address allocation. Some teams dedicate specific subnets just for database-accessing functions, others for functions that need internet access, and so on.

Also be aware that Lambda Hyperplane uses IP addresses from your subnet as well. While the overhead per function is much lower than pre-Hyperplane, you should still account for it in your planning. AWS doesn't publish exact numbers, but assuming one address per function environment is a safe conservative estimate.

### Security Group Configuration for Lambda Functions

Security groups are the gatekeepers of network traffic, and getting them right is essential for Lambda connectivity.

When a Lambda function runs in a VPC, the security group you assign to it controls *outbound* traffic (ingress to other resources) and inbound traffic *to the ENI itself*. In practice, you're primarily concerned with outbound rules since Lambda functions rarely receive inbound traffic directly.

If your function needs to communicate with an RDS database, your security group must have an outbound rule allowing traffic to the RDS instance's security group on the appropriate port (5432 for PostgreSQL, 3306 for MySQL, etc.). The RDS security group, in turn, must allow inbound traffic from the Lambda security group.

A common configuration pattern looks like this in AWS CLI syntax:

```bash
# Allow Lambda to reach RDS
aws ec2 authorize-security-group-ingress \
  --group-id sg-rds-id \
  --protocol tcp \
  --port 5432 \
  --source-group sg-lambda-id

# Allow Lambda outbound to RDS (often implicit in default rules)
aws ec2 authorize-security-group-egress \
  --group-id sg-lambda-id \
  --protocol tcp \
  --port 5432 \
  --cidr 10.0.0.0/8
```

For functions that need to reach the public internet or AWS public services, the approach differs. Your subnet must have a route to a NAT gateway, and your security group must allow outbound traffic to 0.0.0.0/0 on the necessary ports. This is often already configured in default security groups, but it's worth verifying.

A subtle but important detail: Lambda security groups should typically allow *all* outbound traffic unless you have strict egress controls. Trying to whitelist specific destinations can become unwieldy and is often unnecessary for Lambda's transient workloads. Reserve restrictive egress rules for truly high-security environments, and document them carefully to avoid future debugging headaches.

### Reaching AWS Public Services from a VPC-Attached Lambda

Here's a question that confuses many developers: if my Lambda is in a VPC, can it still reach S3, DynamoDB, and other AWS public services?

The answer is yes, but there's a routing caveat. By default, VPC-attached Lambda functions route through a NAT gateway to reach AWS public endpoints. This works but incurs modest latency and data transfer costs. Your function's subnet must have a route to a NAT gateway in a public subnet for this to work.

A better approach is to use **VPC endpoints** (specifically, gateway endpoints for S3 and DynamoDB). A gateway endpoint allows your VPC to reach these services without traversing the public internet. You create the endpoint, associate it with your subnet or route table, and traffic to S3 or DynamoDB automatically routes through the endpoint instead of the NAT gateway.

Setting up an S3 gateway endpoint looks like this:

```bash
aws ec2 create-vpc-endpoint \
  --vpc-id vpc-12345 \
  --service-name com.amazonaws.us-east-1.s3 \
  --route-table-ids rtb-12345
```

Once created, any Lambda function in that VPC automatically uses the endpoint for S3 traffic. This is faster, more reliable, and cheaper than NAT gateway routing. For functions that do heavy S3 or DynamoDB work, VPC endpoints are almost always the right choice.

For other AWS services—CloudWatch Logs, Secrets Manager, Systems Manager Parameter Store—you have two options. You can route through a NAT gateway to reach their public endpoints, or you can use interface endpoints, which are more sophisticated but also more complex to manage. Interface endpoints create an ENI in your subnet and route traffic through it. They're necessary if your function must reach AWS services and you have no NAT gateway, but for most scenarios, NAT gateway routing is sufficient.

### When You Actually Need VPC Attachment

The critical question is knowing when to attach a Lambda function to a VPC in the first place. Too many teams assume VPC attachment is always necessary or always problematic. In reality, it's a tool for a specific set of use cases.

You need VPC attachment when your Lambda function must access private resources that are only reachable from within your VPC. This includes RDS databases, ElastiCache clusters, internal microservices running on EC2 or ECS, or Redshift clusters. If the resource you need is private—not publicly accessible—you need to be in the VPC to reach it.

You also might need VPC attachment for security reasons, even if the resource is technically public. Some organizations require all database access to go through private connections. In these cases, VPC attachment enforces that policy.

Conversely, you don't need VPC attachment when your function only consumes public APIs or AWS services. If you're calling DynamoDB, S3, or an external REST API, your function can run in the default AWS-managed VPC. Attaching it to your VPC adds complexity without benefit.

A practical heuristic: ask yourself whether your Lambda function needs to connect to anything that doesn't have a public IP address or endpoint. If the answer is no, skip VPC attachment. If the answer is yes, attach it.

### Handling Outbound Internet Access for VPC-Attached Functions

When a Lambda function is VPC-attached, it loses the automatic outbound internet access that functions in the default VPC enjoy. To reach external resources—third-party APIs, webhooks, or even AWS public endpoints—you must explicitly route traffic through a NAT gateway.

A NAT gateway sits in a public subnet and allows resources in private subnets to reach the internet while preventing inbound internet connections. It's a standard part of VPC architecture, but many developers only think about it for traditional servers. Lambda needs the same access pattern.

Setting up NAT gateway access involves several steps. First, you create a NAT gateway in a public subnet and attach an Elastic IP address to it. Then, you update your private subnet's route table to add a default route (0.0.0.0/0) pointing to the NAT gateway. Once that's in place, any Lambda function in that private subnet can reach external destinations.

This setup incurs data transfer charges—AWS bills for NAT gateway usage by the gigabyte. For functions that make heavy external API calls, this can add meaningful cost. It's worth understanding your function's network behavior and estimating data transfer volume before deploying at scale.

One optimization is to use VPC endpoints for frequently-accessed AWS services, bypassing the NAT gateway for those calls. This reduces both latency and data transfer costs. It's a common pattern in production architectures: direct routing to VPC endpoints for frequent, predictable traffic, and NAT gateway routing for everything else.

### Practical Configuration Example: Lambda Accessing RDS

Let's walk through a complete, realistic example: a Lambda function that queries an RDS PostgreSQL database.

Your VPC has a private subnet (10.0.1.0/24) for Lambda functions and another private subnet (10.0.2.0/24) for the RDS instance. Both subnets have a route to a NAT gateway for external access.

First, you create security groups:

```bash
# Security group for Lambda
aws ec2 create-security-group \
  --group-name lambda-sg \
  --description "Security group for Lambda functions" \
  --vpc-id vpc-12345
LAMBDA_SG=sg-lambda123

# Security group for RDS
aws ec2 create-security-group \
  --group-name rds-sg \
  --description "Security group for RDS" \
  --vpc-id vpc-12345
RDS_SG=sg-rds456
```

Next, you configure the rules so Lambda can reach RDS:

```bash
# Allow Lambda to connect to RDS on port 5432
aws ec2 authorize-security-group-ingress \
  --group-id $RDS_SG \
  --protocol tcp \
  --port 5432 \
  --source-group $LAMBDA_SG
```

Now, when you create or update your Lambda function, you specify the VPC and security group:

```bash
aws lambda update-function-configuration \
  --function-name my-db-function \
  --vpc-config SubnetIds=subnet-lambda,SecurityGroupIds=$LAMBDA_SG
```

Your Lambda function code would use a PostgreSQL driver (psycopg2 for Python, pg for Node.js) to connect to the RDS endpoint:

```python
import psycopg2
import os

def handler(event, context):
    conn = psycopg2.connect(
        host=os.environ['DB_HOST'],
        user=os.environ['DB_USER'],
        password=os.environ['DB_PASSWORD'],
        database=os.environ['DB_NAME']
    )
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM users LIMIT 10")
    results = cursor.fetchall()
    conn.close()
    return {'statusCode': 200, 'body': results}
```

The environment variables would be stored in Lambda's environment configuration or, more securely, in AWS Secrets Manager. If using Secrets Manager, your Lambda would need an IAM role with permissions to read the secret, but no additional VPC configuration is needed—Secrets Manager is reached via an interface endpoint or the public API through your NAT gateway.

This is a complete, production-ready pattern: Lambda with VPC attachment, database connectivity, and proper security group isolation.

### Monitoring and Troubleshooting VPC-Attached Lambda Functions

When things go wrong with VPC-attached Lambda functions, diagnosis can be tricky. Understanding where to look is half the battle.

Start with CloudWatch Logs. When a function fails due to VPC misconfiguration, the error messages are usually informative. "Unable to connect to database" suggests a security group or routing problem. "VPC IP space exhausted" indicates you've run out of IP addresses. "UnknownError" from Lambda's internal systems might indicate ENI allocation failures, often related to IP address availability.

If a function is taking unexpectedly long to execute after its first invocation, and you've confirmed the code isn't the issue, suspect cold start overhead. Enable X-Ray tracing in your function's configuration to visualize where time is spent. Hyperplane has made VPC cold starts much more predictable, but if you're seeing 5+ second delays, you might be hitting IP address exhaustion or ENI allocation contention.

Network connectivity issues are best debugged with intentional test functions. Create a simple Lambda in your VPC that attempts to connect to your target resource and logs the result. This isolates the network problem from application logic. Test both the connection itself and DNS resolution, as misconfigured security groups often manifest as DNS timeout errors.

CloudWatch also provides VPC endpoint metrics. If your functions are using VPC endpoints for S3 or DynamoDB, you can monitor endpoint usage and spot any anomalies. High error rates on endpoint calls might indicate the endpoint configuration is broken or the security groups are misconfigured.

Finally, if you suspect IP address exhaustion, check your subnet's available IP count via the EC2 console or CLI:

```bash
aws ec2 describe-subnets \
  --subnet-ids subnet-12345 \
  --query 'Subnets[0].AvailableIpAddressCount'
```

Compare this to your expected Lambda concurrency. If the available count is consistently near zero, you've found your bottleneck.

### Common Pitfalls and How to Avoid Them

Experience reveals predictable patterns of misconfiguration. Knowing these in advance can save you hours of debugging.

**Pitfall 1: Forgetting NAT gateway routing.** You attach Lambda to a VPC, and suddenly calls to external APIs start timing out. The reason is almost always a missing NAT gateway route. When you create a Lambda subnet, immediately verify the route table includes a default route to a NAT gateway. Make this a checklist item in your infrastructure-as-code templates.

**Pitfall 2: Restrictive security groups.** A common setup is to create separate security groups for different resource types (Lambda, RDS, ElastiCache) but forget to fully wire the egress rules. Lambda's security group might not explicitly allow outbound traffic to RDS's security group. Always double-check both the source security group (Lambda) and destination security group (RDS) are configured to allow the traffic.

**Pitfall 3: Underestimating IP address requirements.** Teams provision a /24 subnet for Lambda functions, deploy them successfully with low traffic, then see cryptic failures when concurrency spikes during a promotional event. Size your subnets generously. A /20 is a reasonable minimum for production Lambda workloads. IP addresses are cheap; the operational headaches of exhaustion are expensive.

**Pitfall 4: Attaching functions to VPC unnecessarily.** Some teams assume VPC attachment is always required or always good. This adds latency and complexity to functions that don't need it. Be intentional about VPC attachment. Only attach functions that genuinely need private resource access.

**Pitfall 5: Mixing subnets without understanding AZ distribution.** It's fine to specify multiple subnets across availability zones, but understand that Lambda doesn't guarantee even distribution. If you specify two subnets but traffic happens to concentrate on one, you might exhaust IP addresses in that subnet while the other remains underutilized. Monitor subnet-level IP usage and adjust accordingly.

### Conclusion

Connecting Lambda to a VPC is a powerful capability that unlocks access to private infrastructure, but it's not a default choice. Modern AWS—with Hyperplane ENIs dramatically reducing cold start penalties—has made VPC attachment far less costly than it used to be. Today, the decision should be based on whether your function genuinely needs private resource access, not on performance anxiety.

When you do decide to attach Lambda to a VPC, be deliberate about configuration: right-size your subnets for expected concurrency, carefully configure security groups for both the Lambda function and target resources, and plan for outbound connectivity through NAT gateways. Use VPC endpoints for frequent AWS service calls to optimize latency and cost.

The security group and subnet decisions you make at the start of your Lambda architecture have lasting implications. A well-planned VPC setup is resilient and maintainable. A hasty one becomes a source of mysterious failures and late-night debugging. Take the time to understand your function's networking requirements upfront, and you'll build systems that scale predictably and fail clearly when something goes wrong.
