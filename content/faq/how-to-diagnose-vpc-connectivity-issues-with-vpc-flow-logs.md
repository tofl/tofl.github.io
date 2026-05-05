---
title: "How to Diagnose VPC Connectivity Issues with VPC Flow Logs"
---

## How to Diagnose VPC Connectivity Issues with VPC Flow Logs

Network troubleshooting in AWS can feel like detective work. Your application mysteriously can't reach a database. A container can't pull an image from a registry. Traffic seems to vanish into the void. The culprit could be a security group rule, a network ACL, misconfigured routing, or something far more subtle. Without visibility into what's actually happening at the network layer, you're essentially flying blind.

Enter VPC Flow Logs—one of the most powerful and underrated tools in the AWS troubleshooting arsenal. Flow Logs capture network traffic metadata flowing through your virtual private cloud, giving you a detailed record of every packet sent and received across your infrastructure. In this guide, we'll walk through how to enable Flow Logs, configure them appropriately, understand their structure, and most importantly, use them to diagnose and resolve real connectivity problems.

### Understanding VPC Flow Logs

VPC Flow Logs is a feature that allows you to capture information about IP traffic going to and from network interfaces in your VPC. Think of it as a network packet capture, but without the overhead and storage cost of actual packet payloads. Instead, you get metadata about every connection attempt: who initiated it, where it was going, whether it succeeded or failed, and why.

The brilliance of Flow Logs lies in its versatility. You can enable it at three different scopes—VPC-wide, subnet-specific, or on individual network interfaces (ENIs). This granularity lets you focus your investigation on the exact area where you suspect trouble. A Lambda function can't reach your RDS database? Enable Flow Logs on the Lambda's ENI and the RDS instance's ENI to see exactly what's happening between them.

Flow Logs don't capture the actual payload of your traffic, which is good news for security and storage costs. They capture the metadata you need to diagnose connectivity problems without exposing sensitive data. Once enabled, logs flow into either CloudWatch Logs or S3, depending on your choice, and you can query them to answer questions like "Is traffic being accepted or rejected?" and "Which layer is blocking the traffic?"

### Enabling VPC Flow Logs

Enabling Flow Logs is straightforward, but understanding your options and choosing wisely matters more than the mechanics.

To enable Flow Logs via the AWS Management Console, navigate to your VPC and select "Flow Logs" from the sidebar. Click "Create flow log" and you'll encounter your first decision: where do you want these logs to go? CloudWatch Logs offers real-time querying and integration with CloudWatch Alarms, making it excellent for active troubleshooting and monitoring. S3 offers durable, long-term storage at a lower cost, making it ideal for compliance, historical analysis, and large-scale traffic patterns.

If you're diagnosing an active problem right now, CloudWatch Logs is your friend because you can query results in seconds. If you need to analyze weeks of network history or comply with logging retention policies, S3 is the better choice.

Here's what enabling Flow Logs looks like via the AWS CLI:

```bash
aws ec2 create-flow-logs \
  --resource-type VPC \
  --resource-ids vpc-12345678 \
  --traffic-type ALL \
  --log-destination-type cloud-watch-logs \
  --log-group-name /aws/vpc/flowlogs \
  --deliver-logs-permission-role-arn arn:aws:iam::123456789012:role/flowlogsRole
```

This command enables Flow Logs for the specified VPC, capturing all traffic (both accepted and rejected), and sends the logs to CloudWatch. The permission role is critical—it grants the VPC Flow Logs service permission to write to CloudWatch Logs.

You can also enable Flow Logs at the subnet level by changing `--resource-type` to `Subnet`, or at the ENI level with `NetworkInterface`. For targeted troubleshooting, ENI-level logging is often most useful because it eliminates noise from unrelated traffic.

There's also an important choice in `--traffic-type`. Setting it to `ALL` captures both accepted and rejected traffic, which is what you want for troubleshooting. If you set it to `ACCEPT` only, you won't see the rejected packets that are often the key to understanding why something isn't working.

### The Anatomy of a Flow Log Record

Every line in a Flow Log is a record containing specific fields. Understanding what each field means is essential for interpreting what you're looking at. The default format includes these fields:

```
version account-id interface-id srcaddr dstaddr srcport dstport protocol packets bytes start end action log-status
```

Let's break down the fields that matter most for troubleshooting:

**srcaddr** and **dstaddr** are the source and destination IP addresses. These tell you who is trying to talk to whom. If you see a Lambda function's private IP trying to reach an RDS endpoint but all the records show REJECT, you've found your problem.

**srcport** and **dstport** are the source and destination ports. Port 443 for HTTPS, port 3306 for MySQL, port 5432 for PostgreSQL—these tell you what kind of traffic is flowing. If you see traffic on the wrong port, that's a clue.

**protocol** is the IP protocol number. Protocol 6 is TCP, protocol 17 is UDP. This matters because security groups and network ACLs often apply different rules to different protocols.

**action** is the magic field for troubleshooting. It's either `ACCEPT` or `REJECT`. This single field tells you whether AWS accepted or rejected the packet at the network layer. This is crucial because it helps you narrow down which part of your network stack is the culprit.

**log-status** indicates whether the flow log data was successfully recorded. It's usually `OK`, but if it's `NODATA`, it means no traffic was captured during that sampling interval, which can also be informative.

**packets** and **bytes** tell you how much data was transferred. These are useful for understanding traffic volume and identifying data exfiltration or unusual patterns.

**start** and **end** are Unix timestamps indicating when the flow began and ended.

Here's what an actual flow log record might look like:

```
2 123456789012 eni-1a2b3c4d 10.0.1.100 10.0.2.50 54328 3306 6 10 520 1633024800 1633024810 ACCEPT OK
```

This tells us: Account 123456789012, interface eni-1a2b3c4d, source IP 10.0.1.100 on port 54328 trying to reach destination IP 10.0.2.50 on port 3306 (MySQL), using TCP, exchanging 10 packets totaling 520 bytes, and the action was ACCEPT.

### Security Groups, Network ACLs, and ACCEPT vs. REJECT

Here's where Flow Logs become genuinely powerful for troubleshooting: the relationship between ACCEPT/REJECT and which layer is blocking traffic.

When a packet is **rejected**, you need to know: is it being rejected by a security group or by a network ACL? This distinction is critical because it changes how you fix the problem.

If a flow log shows **REJECT**, it almost always means the network ACL rejected it. Security groups are stateful, so they allow return traffic automatically. When a security group denies traffic, the packet is silently dropped and never generates a flow log entry for the REJECT action. The flow log shows no entry at all for that traffic.

Network ACLs, however, are stateless and can explicitly reject traffic, and those rejections show up as REJECT in the flow logs.

This is the key insight: **ACCEPT means the network ACL allowed it, but the security group might still reject it. REJECT means the network ACL explicitly rejected it.** If you don't see a flow log entry at all, the security group rejected it before it even got to the network ACL.

Let's ground this in a practical scenario. You have a Lambda function trying to connect to an RDS database. The connection times out. You check the security group on the RDS instance and it allows inbound traffic on port 3306 from the Lambda's security group. That's correct. But the Lambda still can't connect.

You enable Flow Logs and query them. You see entries from the Lambda's IP to the RDS IP on port 3306, but they all show REJECT. This tells you the network ACL is rejecting the traffic. You check the subnet's network ACL and discover the inbound rule for port 3306 is missing or numbered incorrectly. There's your culprit.

Conversely, if you enable Flow Logs and see no entries at all from the Lambda to the RDS database, the security group is the problem. The traffic never even made it to the network ACL layer.

### Choosing Your Destination: CloudWatch Logs vs. S3

Your choice between CloudWatch Logs and S3 shapes how you'll interact with your flow logs and should be made based on your immediate needs.

**CloudWatch Logs** is ideal for real-time troubleshooting. Once enabled, logs appear in your CloudWatch log group within minutes, and you can immediately query them using CloudWatch Logs Insights. The query syntax is intuitive, and you get results back in seconds. The downside is cost—CloudWatch Logs charges per gigabyte of data ingested and stored, which can add up if you have high-traffic VPCs. However, for active debugging, this cost is usually negligible and worth it for the speed and convenience.

**S3** is ideal for long-term retention and compliance. Flow logs are delivered to S3 with a prefix structure, making them organized and queryable with Athena. S3 costs are significantly lower than CloudWatch Logs for large volumes, and you gain the flexibility of S3 retention policies, lifecycle rules, and cross-account access. The trade-off is that querying S3-based logs is slightly less immediate than CloudWatch Logs Insights.

For a production environment, a hybrid approach is sensible: enable CloudWatch Logs for active monitoring and alerting, but also deliver logs to S3 for archival and historical analysis. You can configure a single Flow Log to write to both destinations.

### Querying CloudWatch Logs with CloudWatch Logs Insights

CloudWatch Logs Insights is where the magic of Flow Log troubleshooting really happens. It's a query language designed specifically for searching and analyzing logs, and it's remarkably powerful.

To query your VPC Flow Logs, navigate to CloudWatch Logs and open your Flow Logs log group. Click "Insights" and you'll see a query editor. Here's a simple query to see rejected traffic:

```
fields srcaddr, dstaddr, srcport, dstport, action
| filter action = "REJECT"
```

This query shows you every rejected connection attempt, letting you quickly spot patterns. All traffic from a particular IP being rejected? That's your first clue.

To find traffic between two specific IPs:

```
fields srcaddr, dstaddr, srcport, dstport, protocol, action, packets
| filter (srcaddr = "10.0.1.100" and dstaddr = "10.0.2.50") or (srcaddr = "10.0.2.50" and dstaddr = "10.0.1.100")
```

This bidirectional query helps you understand the full conversation between two resources.

To identify the top rejected destination ports (useful for spotting misconfigured security groups):

```
fields dstport, action
| filter action = "REJECT"
| stats count() as rejection_count by dstport
| sort rejection_count desc
```

This groups rejections by destination port and shows you which ports are being blocked most frequently.

One invaluable query for troubleshooting is to find traffic from a specific source that was rejected:

```
fields srcaddr, dstaddr, dstport, action
| filter srcaddr = "10.0.1.100" and action = "REJECT"
```

Replace the IP with your problematic source (like a Lambda function's ENI) and you'll immediately see what it's trying to reach and what's being blocked.

CloudWatch Logs Insights automatically highlights the fields in your results, making it easy to scan for patterns. If you see 50 rejected packets all on port 3306 from the same source to the same destination, you've identified a connectivity issue that likely stems from a security group or network ACL misconfiguration.

### Querying S3 Logs with Athena

If your Flow Logs are stored in S3, Athena is your query engine. Athena is a serverless SQL query service, so you write standard SQL rather than a specialized query language.

First, you need to create an Athena table that maps to your Flow Logs S3 location. AWS provides a CloudFormation template or you can create the table manually. Here's the basic SQL structure:

```sql
CREATE EXTERNAL TABLE IF NOT EXISTS vpc_flow_logs (
  version INT,
  account INT,
  interface_id STRING,
  srcaddr STRING,
  dstaddr STRING,
  srcport INT,
  dstport INT,
  protocol INT,
  packets INT,
  bytes INT,
  start BIGINT,
  end BIGINT,
  action STRING,
  log_status STRING
)
PARTITIONED BY (region STRING, year STRING, month STRING, day STRING)
ROW FORMAT DELIMITED FIELDS TERMINATED BY ' '
LOCATION 's3://your-bucket-name/prefix/'
```

Once the table is created, you can query your Flow Logs with SQL. To find rejected traffic on a specific port:

```sql
SELECT srcaddr, dstaddr, dstport, action, COUNT(*) as flow_count
FROM vpc_flow_logs
WHERE action = 'REJECT' AND dstport = 3306
GROUP BY srcaddr, dstaddr, dstport, action
ORDER BY flow_count DESC;
```

Athena queries run against S3 data, so they're ideal for analyzing large volumes or historical trends. The time to get results is slightly longer than CloudWatch Logs Insights, but the flexibility and cost are superior for big-picture analysis.

### Walkthrough: Lambda Can't Reach RDS

Let's work through a real troubleshooting scenario to tie everything together. Your Lambda function is trying to query an RDS database, but it's timing out. The database exists, the security group rules look correct, but the connection fails.

**Step 1: Enable Flow Logs on the involved ENIs**

Rather than enabling VPC-wide logging and dealing with noise, enable Flow Logs specifically on the Lambda's ENI and the RDS instance's ENI. This keeps the signal-to-noise ratio high.

Via the CLI:

```bash
aws ec2 create-flow-logs \
  --resource-type NetworkInterface \
  --resource-ids eni-lambda001 eni-rds001 \
  --traffic-type ALL \
  --log-destination-type cloud-watch-logs \
  --log-group-name /aws/vpc/flowlogs/lambda-rds \
  --deliver-logs-permission-role-arn arn:aws:iam::123456789012:role/flowlogsRole
```

**Step 2: Reproduce the problem**

Invoke the Lambda function again while Flow Logs are active. Wait a couple of minutes for logs to appear in CloudWatch.

**Step 3: Query for traffic from Lambda to RDS**

In CloudWatch Logs Insights:

```
fields srcaddr, dstaddr, srcport, dstport, action
| filter dstport = 3306
```

Look at the results. Are you seeing ACCEPT or REJECT? Or are you seeing nothing at all?

**Case A: You see no entries.** The security group on the RDS instance is rejecting traffic before it reaches the network ACL. Check the RDS security group's inbound rules. Ensure it allows TCP on port 3306 from the Lambda's security group (not just the IP, but the security group itself).

**Case B: You see REJECT entries.** The network ACL is rejecting traffic. Check the RDS subnet's network ACL. Look for an inbound rule on port 3306. Ensure it's numbered before any deny-all rule and that it has a lower number (higher priority) than any explicit denies.

**Case C: You see ACCEPT entries, but Lambda still times out.** The network layer is fine, so the problem is elsewhere. Check the RDS security group's inbound rules more carefully. Does it match the source port range? Is the protocol correct? Double-check that the Lambda's security group is correctly referenced or that the IP allowlist is accurate.

By following the flow logs, you've narrowed the problem from a vast network stack to a specific configuration issue.

### Walkthrough: ECS Task Can't Pull Image from ECR

Here's another common scenario: your ECS task is unable to pull a Docker image from Amazon ECR, and you see an error in the task logs.

**Step 1: Identify the relevant ENI**

Find the ENI of the ECS task by checking the task details in the ECS console or via the describe-tasks API call. Also note the security group and subnet where the task is running.

**Step 2: Enable Flow Logs on the task's ENI**

```bash
aws ec2 create-flow-logs \
  --resource-type NetworkInterface \
  --resource-ids eni-ecs-task-001 \
  --traffic-type ALL \
  --log-destination-type cloud-watch-logs \
  --log-group-name /aws/vpc/flowlogs/ecs-ecr \
  --deliver-logs-permission-role-arn arn:aws:iam::123456789012:role/flowlogsRole
```

**Step 3: Trigger the task again and let it fail**

**Step 4: Query for traffic to ECR endpoints**

ECR uses HTTPS on port 443, but it also uses a custom API endpoint that resolves to an IP in AWS's address space. Query for HTTPS traffic:

```
fields srcaddr, dstaddr, dstport, action
| filter dstport = 443
| stats count() as flow_count by action
```

If all traffic to port 443 shows ACCEPT, the network ACL is fine. If you see REJECT, the network ACL on the ECS task's subnet is blocking HTTPS traffic. Add an outbound rule to allow it.

If you see ACCEPT but the image still won't pull, the problem isn't network layer connectivity—it's likely an IAM permission issue (the task role doesn't have permission to pull from ECR) or the task is using the wrong ECR registry URL.

Flow Logs help you rule out the network layer quickly, so you can focus your investigation where the actual problem lies.

### Common Gotchas and Tips

When working with Flow Logs, a few subtle issues can trip you up.

**Flow Logs have sampling.** If you enable Flow Logs at the VPC level, AWS samples traffic to keep costs reasonable. This means you might not see every single packet. For precise troubleshooting, enable Flow Logs at the ENI level to capture all traffic without sampling.

**Flow Logs can take a few minutes to appear.** After enabling Flow Logs, allow 2–5 minutes before querying. If you don't see logs, double-check that your IAM role has the necessary permissions to write to CloudWatch Logs or S3.

**Rejected traffic from a security group doesn't appear in Flow Logs.** This can be confusing. If a security group rejects traffic, the packet never reaches the network ACL, so no REJECT entry appears in Flow Logs. The absence of a log entry for certain traffic can actually be diagnostic—it suggests the security group blocked it.

**Custom log format is powerful.** By default, Flow Logs use the standard format, but you can customize it to include additional fields like TCP flags, packet information, and more. If you need to investigate unusual network behavior, consider enabling custom fields like `tcp-flags` to see SYN, FIN, and RST packets.

**Traffic to and from AWS services isn't always capturable.** Traffic to AWS service endpoints (like the metadata service or S3) might have special handling and could behave unexpectedly in Flow Logs. If something seems off, consult AWS documentation for that specific service.

### Integration with Monitoring and Alerting

Flow Logs are most valuable when integrated into your monitoring strategy. CloudWatch Logs Insights queries can be converted into CloudWatch Alarms, allowing you to be notified when suspicious traffic patterns emerge.

For instance, you might create an alarm that triggers if rejected traffic exceeds a threshold:

```
fields action
| filter action = "REJECT"
| stats count() as reject_count
```

If `reject_count` is abnormally high, it might indicate a misconfiguration or attack. By the time you receive the alert, Flow Logs are already capturing the evidence, making investigation fast.

Similarly, Athena queries on S3-stored Flow Logs can be scheduled to run periodically and generate reports or trigger actions via SNS topics.

### Conclusion

VPC Flow Logs are an indispensable tool for anyone operating infrastructure on AWS. They lift the curtain on the network layer, showing you exactly what's happening to your traffic and why connections succeed or fail. Whether you're debugging a Lambda function that can't reach a database or an ECS task struggling to pull an image, Flow Logs provide the evidence you need to diagnose the problem quickly.

The key to effective troubleshooting is understanding the structure of a flow log record, knowing when to look for ACCEPT vs. REJECT, and choosing the right query tool for your situation. Enable Flow Logs at the appropriate scope, let them run for a few minutes, then query with CloudWatch Logs Insights or Athena depending on your needs. Within minutes, you'll have a clear picture of what's actually happening on the network.

As you grow more comfortable with Flow Logs, you'll find yourself enabling them preemptively on critical infrastructure, integrating them into your monitoring dashboards, and using them not just for reactive troubleshooting but for proactive security and compliance monitoring. They're one of those features that seems esoteric until you need them, then become indispensable.
