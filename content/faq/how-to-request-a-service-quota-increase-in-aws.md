---
title: "How to Request a Service Quota Increase in AWS"
---

## How to Request a Service Quota Increase in AWS

You're building a successful application, and suddenly your Lambda function starts throwing throttling errors. Or perhaps you're scaling your database workload and hit a hard wall on vCPU allocation. These moments of friction stem from AWS service quotas—the guardrails AWS puts in place to prevent runaway costs and maintain service stability. The good news is that most quotas are adjustable, and AWS provides multiple pathways to request increases. Understanding how to navigate this process efficiently can mean the difference between a smooth scaling operation and unexpected downtime.

Service quotas represent the maximum number of resources you can create or the maximum throughput you can consume in an AWS Region for a specific service. Unlike hard limits (which are few and far between), most quotas can be increased on request. This article walks you through the mechanics of identifying, monitoring, and requesting quota increases across different AWS services, with practical guidance on accelerating approvals and avoiding common pitfalls.

### Understanding Service Quotas and Why They Matter

Before diving into the request process, it's worth understanding what service quotas actually represent and why they exist. AWS implements quotas as a protective measure—they prevent account-level issues that could cascade into problems for the broader AWS infrastructure. For example, if an account could spin up an unlimited number of EC2 instances without oversight, a runaway script or security breach could rapidly consume resources across an entire Region, creating availability challenges not just for that customer but potentially for others sharing underlying capacity.

From a developer's perspective, quotas serve another purpose: they're often a sign that you've reached a scale worth optimizing. If you're hitting Lambda concurrent execution limits, it's worth asking whether your architecture could benefit from asynchronous processing patterns. If you're constrained by S3 PUT request rates, perhaps you need request rate partitioning. That said, sometimes the answer really is just "request a higher quota," and AWS has made that process straightforward.

The critical distinction to understand is that quotas are adjustable—they're different from hard limits. Quotas live in the Service Quotas console and can be modified on request. Hard limits, by contrast, cannot be changed. A hard limit might be something like "each EC2 reservation can last a maximum of three years." Fortunately, the vast majority of resource constraints you'll encounter are quotas, not hard limits.

### Locating Your Current Quotas in the Service Quotas Console

The Service Quotas console is your command center for managing quotas. To access it, navigate to the AWS Management Console, search for "Service Quotas," and open the service. The interface is intuitive but worth exploring methodically.

Once inside, you'll see a list of AWS services on the left sidebar. Select the service whose quotas you want to examine—let's say Lambda for a concrete example. The main panel displays all quotas for that service in your current Region, including the quota name, your current quota value, the current usage, and whether the quota is adjustable.

Look specifically for the "Adjustable" column. A checkmark or "Yes" designation means AWS will consider a request to increase that quota. The absence of a checkmark means it's a hard limit or not currently adjustable, and you won't be able to request an increase. This distinction is your first filtering mechanism.

Key quotas to monitor across common services include the following: for Lambda, the concurrent executions limit (the number of function instances that can run simultaneously), which is set to 1,000 by default in new accounts; for EC2, vCPU limits vary by instance family, and you might have separate limits for on-demand and reserved instances; for S3, the put request rate limit is initially 3,500 per second per partition (though this has become less of a practical constraint with newer bucket configurations); and for RDS, database instances per account, storage quotas, and backup retention periods.

The usage metrics displayed in the Service Quotas console are near-real-time, pulling data from CloudWatch. If your usage is approaching your quota, the percentage indicator will show you exactly how much headroom remains. This is invaluable for capacity planning.

### Requesting a Quota Increase Through the Console

The console provides the most user-friendly path to requesting a quota increase. Navigate to the quota you need to increase in the Service Quotas console, click on the quota name to open its detail page, and you'll see a button labeled "Request quota increase." Click it.

A dialog box appears asking you to specify the desired quota value. Here's an important principle: request what you actually need, plus a reasonable buffer. If you're currently using 800 concurrent Lambda executions and anticipate growing to 1,200, don't just request 1,200. Request something like 1,500 to give yourself headroom for unexpected spikes. AWS approval processes usually approve requests that seem reasonable relative to projected usage, so padding modestly strengthens your case.

After entering the desired value, you'll see an estimated approval timeline. This is AWS's estimate—don't treat it as a guarantee, but it gives you a realistic picture. Many quotas are approved within minutes, while others might take hours or occasionally a day. The most common quotas (Lambda concurrent executions, EC2 vCPUs) typically see very fast approval, often within the hour. More specialized quotas or those from newer services might take longer.

Once you submit, AWS generates a Service Quota Request ID. Save this. You can use it to track the request's progress. The console allows you to view all open and recently resolved quota requests, complete with timestamps and current status. You'll also receive email notifications when your request is approved or denied.

### Using the AWS CLI for Quota Increase Requests

For developers who prefer command-line workflows or want to automate quota management, the AWS CLI offers the `request-service-quota-increase` command. This is particularly useful in infrastructure-as-code scenarios or when managing quotas across multiple AWS accounts.

The basic syntax looks like this:

```bash
aws service-quotas request-service-quota-increase \
  --service-code lambda \
  --quota-code L-B99B6C67 \
  --desired-value 2000 \
  --region us-east-1
```

Breaking this down: the `service-code` is a short identifier for the AWS service (you can find these by listing available services with `aws service-quotas list-services`). The `quota-code` is a unique identifier for the specific quota you're targeting. To find quota codes, use the `list-service-quotas` command for your chosen service:

```bash
aws service-quotas list-service-quotas \
  --service-code lambda \
  --region us-east-1 \
  --query 'Quotas[?Adjustable==`true`].[QuotaName,QuotaCode]' \
  --output table
```

This command filters to show only adjustable quotas for Lambda in the us-east-1 region, displaying their names and codes in a readable table format. You can then use the quota code from the output in your request command.

The CLI response includes the request token, the status (usually "PENDING"), and the desired quota value. You can check on your request's status using:

```bash
aws service-quotas get-requested-service-quota-change \
  --service-code lambda \
  --requested-quota-change-id <request-id>
```

The CLI approach shines when you're managing multiple quota requests or integrating quota management into deployment pipelines. Some organizations use it to automatically request quota increases before scaling operations, reducing manual overhead.

### Identifying Common Quotas You'll Hit First

Certain quotas are encountered far more frequently than others, and knowing these can help you plan proactively. Let's explore the most common ones.

**Lambda Concurrent Executions** is perhaps the most frequently encountered quota in modern serverless architectures. By default, your account can run 1,000 concurrent Lambda function instances across all functions in a Region. If you have a function that takes three seconds to process a request and receives 400 requests per second, you'd need 1,200 concurrent execution capacity. AWS Lambda now allows requesting much higher concurrency limits—accounts have requested and received limits in the tens of thousands. Approval is typically very fast for this quota.

**EC2 vCPU Limits** are equally common, especially for teams scaling traditional workloads. What catches many developers off guard is that different instance families have separate vCPU quotas. You might have a quota of 64 vCPUs for m5 instances but only 16 for t2 instances. Calculating your actual vCPU requirement involves knowing your instance types and their sizes. A t3.xlarge instance (4 vCPUs) and an m5.2xlarge instance (8 vCPUs) both consume toward their respective family quotas.

**S3 PUT Request Rate** limits apply at the partition level (not the bucket level, though AWS now recommends ignoring this limit for practical purposes with modern S3 architecture). The default is 3,500 PUT requests per second per partition. If your application batches uploads or uses multi-part upload efficiently, you're unlikely to hit this. But workloads performing many discrete small-object uploads can hit it quickly. Interestingly, AWS has gradually de-emphasized this limit as it improved backend performance, and modern best practices assume you can achieve much higher rates with proper partitioning.

**RDS Database Instances** quotas limit how many database instances you can create in a Region. The default is usually quite modest—perhaps 40 instances. If you're building a multi-tenant application with database per tenant or running many small specialized databases, you might hit this quickly.

**NAT Gateways and Elastic IPs** limits affect network-heavy applications. Each NAT Gateway costs money and there's a per-Region quota on how many you can create. Similarly, Elastic IP addresses have per-Region limits, which can constrain highly distributed architectures.

Understanding which quotas apply to your workload requires examining your architecture and projecting growth. A microservices application deployed on Fargate might need high Lambda concurrent execution limits and moderate EC2 quotas for Fargate infrastructure, while a traditional application stack might have the opposite profile.

### Monitoring Quota Usage with CloudWatch

Reactive quota management—discovering you've hit a limit when errors start appearing—is never ideal. Proactive monitoring through CloudWatch metrics prevents these surprises.

The Service Quotas service integrates with CloudWatch, automatically pushing quota usage metrics into a custom namespace. You can create dashboards and alarms to track quota consumption over time and alert you when you're approaching limits.

To set up monitoring, navigate to CloudWatch, create a new dashboard, and add widgets that display metrics from the `AWS/ServiceQuotas` namespace. The metrics available include the current quota value and the current usage. For example, creating a widget that displays Lambda concurrent execution usage as a percentage of your current quota gives you a visual representation of headroom.

More usefully, set up CloudWatch alarms to notify you when usage exceeds a threshold—say, 80% of your quota. This gives you time to request an increase before you actually hit the limit. An alarm that triggers when Lambda concurrent execution usage exceeds 800 out of your 1,000-unit quota is reasonable, allowing you to request an increase well before actual throttling occurs.

You can configure alarms to send notifications to SNS topics, which can then trigger Lambda functions, invoke PagerDuty, or send Slack messages. This integration allows you to build quota management into your broader operational processes.

```bash
aws cloudwatch put-metric-alarm \
  --alarm-name lambda-concurrency-approaching-limit \
  --alarm-description "Alert when Lambda concurrency usage exceeds 80%" \
  --metric-name UsageCount \
  --namespace AWS/ServiceQuotas \
  --statistic Average \
  --period 300 \
  --threshold 800 \
  --comparison-operator GreaterThanThreshold \
  --alarm-actions arn:aws:sns:us-east-1:123456789012:ops-alerts
```

This approach transforms quota management from a reactive scramble into a planned operational practice.

### Understanding Approval Timelines and Factors That Influence Decisions

AWS doesn't publish a formal service-level agreement for quota increase approval, but typical timelines fall into predictable patterns. The most commonly requested quotas—Lambda concurrent executions, EC2 vCPUs for common instance families—usually approve within minutes to an hour. The Service Quotas console typically shows an estimated approval time, which provides a reasonable expectation, though actual times can vary.

Several factors influence approval decisions and timelines. Account history matters—accounts with good standing (no past security incidents, no history of policy violations) tend to see faster approvals. The magnitude of the requested increase also plays a role. A request to increase from 1,000 to 1,200 Lambda concurrent executions is likely approved immediately, while a request to jump from 1,000 to 50,000 might trigger additional review. AWS needs to ensure you're not requesting capacity you'll never use or that might expose account to unusual cost patterns.

Your account's usage history helps inform AWS's decision. If you've been consistently using 900 concurrent Lambda executions and you're requesting 1,200, AWS sees a clear pattern of growth and approves readily. If you've never used more than 100 concurrent executions but suddenly request 10,000, AWS might question whether the request reflects genuine need or misunderstanding.

The quota's novelty in AWS's service catalog also affects approval speed. Newer quotas or those from less-common services might require manual review rather than automated approval, adding time to the process.

### Tips for Getting Requests Approved Faster

While many quota increases are approved automatically, there are tactical steps you can take to smooth the process.

**First, ensure your request is reasonable and justified.** AWS's systems are designed to detect anomalous requests. A request that doubles your current quota is usually seen as reasonable. A request that multiplies it by ten should probably be accompanied by context—not because AWS will necessarily deny it, but because exceptional requests sometimes route to manual review, which takes longer. If you're building a viral application or anticipating a major traffic event, you might include this context in your request.

**Second, request increases before you're in crisis mode.** Once you're actively hitting a quota limit and errors are propagating through your system, you're in a reactive position. Quota increases requested during a production incident are still processed at the standard timeline, but your team is under pressure and more prone to mistakes. Proactive requests, made as part of capacity planning, are less stressful to manage.

**Third, consolidate multiple quota requests where possible.** If you need to increase Lambda concurrency and also EC2 vCPUs, submit both requests simultaneously rather than sequentially. Each request still processes independently, but you avoid the delay of waiting for the first approval before identifying the need for the second.

**Fourth, for time-sensitive scaling operations, consider opening a support ticket in advance.** AWS Support can sometimes expedite quota increase processing if you have an upcoming event or scheduled scaling operation. Business and Enterprise support plans include this as part of their service. While standard quota requests through the console don't typically require support escalation, there's no harm in opening a ticket well in advance of a major event to let AWS know about anticipated needs.

**Finally, understand regional quota dynamics.** Quotas are per-Region. If you're expanding to a new region, you'll start with default quotas there, even if you have high quotas in other regions. Plan quota requests for new regions as part of your expansion process rather than discovering them mid-deployment.

### Handling Quota Increase Denials

While most reasonable requests are approved, denials do happen. Understanding why and how to respond matters.

AWS doesn't typically provide detailed explanations for denials through the console interface, but they're rare enough that if your request is denied, it usually signals something unusual. The most common scenario is a request that conflicts with account policies or security concerns—for instance, if your account has been flagged for unusual activity, AWS might deny quota increases until the concern is resolved.

If you receive a denial, your recourse is to contact AWS Support. Premium support plans provide direct channels to escalate quota decisions and get explanations. For accounts on the free tier, you can open a support case, though response times will be longer. When you escalate, provide context: your use case, your current usage metrics, and your growth projections. AWS Support engineers can sometimes unlock approvals that were initially denied or provide alternatives.

More commonly, you might receive a quota increase that's approved but at a lower value than requested. AWS might approve your request to increase Lambda concurrency from 1,000 to 5,000 but only grant an increase to 2,000. This is more of a soft limit than a denial. You can immediately resubmit a request for the additional 3,000, and it will typically be approved if the first request was approved.

### Quota Considerations Across Multi-Region Deployments

If your application spans multiple AWS Regions, quota management becomes more complex. Each Region has independent quotas, and you must manage them separately.

This creates a few operational patterns worth understanding. If you're deploying the same application stack to five regions, you'll need to request the same quota increases in all five regions. Some organizations automate this using Infrastructure as Code and scripts that apply quota requests across regions in parallel. Others manage them manually during deployment preparation, budgeting the time for quota approval as part of their regional expansion timeline.

One subtle point: quota requests in one region don't affect quota availability in others. You might have been approved for 10,000 Lambda concurrent executions in us-east-1 but only start with the default 1,000 in eu-west-1. This is by design—each region is independently managed.

The Service Quotas console lets you select your region in the upper right, just like other AWS services. To get a comprehensive view of your quotas across regions, you'll need to check each region separately or use the CLI to query all regions programmatically.

### Service Quotas and Infrastructure as Code

For teams using infrastructure as code with tools like Terraform or CloudFormation, quota management typically falls outside the scope of traditional IaC tools. You can't provision EC2 instances via CloudFormation and simultaneously request a vCPU quota increase to guarantee those instances will be created—it doesn't work that way.

The practical pattern is to request quota increases before running your IaC deployments. Some organizations handle this through preliminary scripts that check quotas and request increases if needed, then wait for approvals before proceeding with the full infrastructure deployment. Others manage quotas through a separate operational process that runs before scheduled scaling events.

AWS doesn't yet provide first-class CloudFormation or Terraform support for requesting quota increases, though some third-party tools have built wrappers around the Service Quotas API to provide this functionality. If you're building custom deployment orchestration, leveraging the CLI commands or AWS SDK calls to request quotas as a preliminary step is feasible.

### Real-World Scenarios and Decision Trees

Let's ground this in concrete situations to illustrate decision-making.

**Scenario One: You're deploying a new microservices application to Lambda.** You've designed it to use 50 Lambda functions. Each function will handle concurrent load independently. You estimate peak concurrency across all functions will be 500. Your default quota is 1,000. Should you request an increase? Probably not immediately. You have headroom. However, you should set up CloudWatch monitoring to track actual usage as the application scales. Once you're consistently hitting 700 concurrent executions, request an increase to 1,500. This gives you a 2x buffer relative to current usage and reduces the likelihood of future throttling.

**Scenario Two: You're migrating a traditional three-tier application from on-premises to AWS.** The application runs on 20 servers, each with 4 vCPUs. You're planning to use m5.xlarge instances (4 vCPUs each) to start. That's 80 vCPUs across instance count. Your default quota is probably 64 vCPUs for on-demand m5 instances. You need to request an increase to at least 80, but you should request 120 to account for a production deployment plus a staging environment. Submit this request before starting the migration, allowing time for approval.

**Scenario Three: You've built a data processing pipeline using S3 events triggering Lambda functions.** The workload is bursty—when data arrives in S3, you get rapid ingestion but long periods of quiet. During peak ingestion, you might generate thousands of S3 PUT requests across multiple objects. You're hitting the 3,500 PUTs per second quota regularly. Should you request an increase? First, evaluate whether you can optimize—perhaps batch smaller objects or implement exponential backoff if the service is being called by multiple processes simultaneously. If optimization doesn't help, yes, request an increase. Modern S3 supports much higher rates, and AWS regularly approves large increases to this quota. Request something like 20,000 to give yourself significant headroom.

### Quota Best Practices Summary

Approaching quota management systematically prevents many operational headaches. First, audit your quotas during architecture review and planning phases, not during crisis response. Understanding your expected usage and requesting appropriate quotas before scaling ensures smooth operations.

Second, implement monitoring for quotas you expect to grow or that are critical to your workload. CloudWatch integration makes this straightforward, and the early warning that monitoring provides is invaluable.

Third, request increases conservatively but thoughtfully. Don't request massive increases you don't need—it doesn't help you and might trigger unnecessary reviews. But do request enough headroom to accommodate growth between approval and the next expected review.

Fourth, maintain clear documentation of your quota strategy. Why did you request the quotas you have? What growth patterns justified them? This documentation helps when you need to explain decisions to stakeholders or when new team members take over quota management.

Finally, stay aware that quotas are one dimension of capacity planning but not the only one. You can always request higher quotas, but they're often a symptom that it's time to think about architectural optimization, cost management, or both.

### Conclusion

Service quotas are a fundamental aspect of operating at scale in AWS, and the ability to request and manage them is an essential operational skill. Whether you're building a nascent startup application or managing large-scale enterprise infrastructure, you'll encounter quotas and need to manage them. The good news is AWS has made the process straightforward across multiple access patterns—the console for interactive management, the CLI for automation, and AWS Support for edge cases and escalations.

The key insight to carry forward is that quotas are enablers, not blockers. They provide guardrails during account setup that prevent runaway costs, but they're almost always adjustable on request. By understanding which quotas apply to your workload, monitoring their usage proactively, and requesting increases before hitting hard limits, you transform quota management from a reactive fire-fighting exercise into a planned operational practice. Combined with architectural thinking about whether quota increases are the right answer versus architectural optimization, this approach keeps your applications running smoothly as they scale.
