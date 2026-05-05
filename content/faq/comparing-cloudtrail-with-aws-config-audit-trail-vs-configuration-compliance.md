---
title: "Comparing CloudTrail with AWS Config: Audit Trail vs Configuration Compliance"
---

## Comparing CloudTrail with AWS Config: Audit Trail vs Configuration Compliance

If you've spent any time studying AWS governance and compliance tools, you've probably encountered a moment of confusion: CloudTrail and AWS Config sound like they do similar things, but developers and architects keep treating them as fundamentally different. That's because they *are* fundamentally different, and understanding the distinction is crucial for building secure, auditable, and compliant systems on AWS.

The confusion is understandable. Both tools help you understand what's happening in your AWS environment. Both are often mentioned together in compliance frameworks. Both generate logs and reports. But they answer entirely different questions. CloudTrail is a *temporal* audit log that captures *who did what and when*. AWS Config is a *point-in-time* compliance tool that captures *what is the current state of my resources and does it match my rules*. In this article, we'll explore what each tool does, when to use them, and how they work together in a mature compliance program.

### Understanding CloudTrail: Your API Audit Log

Think of CloudTrail as a comprehensive security camera for your AWS account. Every API call made to AWS services—whether through the console, CLI, SDKs, or direct API calls—generates an event that CloudTrail records. This includes who made the call, what service they called, what parameters they used, when they made it, and the result of that call.

CloudTrail captures events from virtually all AWS services. When you launch an EC2 instance, terminate an RDS database, modify an IAM policy, delete an S3 bucket, or change a security group, CloudTrail records it. These events are organized chronologically and stored in JSON format, creating an immutable audit trail of activity within your account.

The events CloudTrail captures are organized into two main categories. Management events include the control plane operations you'd typically think of—creating, updating, or deleting resources. Data events, a separate category, capture operations on the actual data within resources, such as reading or writing objects to S3 buckets or writing records to DynamoDB tables. Management events are enabled by default; data events require explicit configuration because they can generate significantly higher volumes of events.

Let's say you receive a security alert that a critical S3 bucket was deleted last Tuesday. This is exactly the kind of question CloudTrail helps you answer. You'd query CloudTrail to find the DeleteBucket API call, see which IAM user or role made the call, review the timestamp, and potentially see the source IP address and user agent. CloudTrail tells you the complete story: who did it, what they did, when they did it, and what the request looked like.

CloudTrail stores events for 90 days in the default event history at no charge. For longer retention or more advanced analysis, you can enable CloudTrail logging to an S3 bucket, where events are delivered every five minutes. You can also stream events to CloudWatch Logs or EventBridge for real-time processing and alerting.

### Understanding AWS Config: Your Configuration Compliance Checker

AWS Config takes a different approach entirely. Instead of recording every API call, Config continuously monitors the configuration of your AWS resources and evaluates those configurations against rules you define. It's less concerned with *who changed what* and more concerned with *what is the current state of my resources, and is it compliant*.

Think of Config as a compliance auditor making periodic rounds through your infrastructure. At any point in time, Config can tell you the complete configuration of every resource in your AWS account. When resource configurations change—either through intentional API calls or, theoretically, through unauthorized modifications—Config detects the change and evaluates whether the new configuration still meets your compliance rules.

Config uses rules to define compliance standards. AWS provides managed rules that you can enable with a few clicks, such as "s3-bucket-server-side-encryption-enabled" (which checks that all S3 buckets have encryption enabled) or "iam-password-policy-check" (which validates that your account password policy meets minimum complexity requirements). You can also write custom rules in Lambda to enforce organization-specific compliance requirements.

Let's imagine your security team has mandated that all S3 buckets must have server-side encryption enabled. You'd create or enable a Config rule that checks this condition. Config would scan all your S3 buckets, evaluate each one against the rule, and immediately show you which buckets are compliant and which are not. If someone creates a new S3 bucket without encryption (whether intentionally or by accident), Config detects this non-compliance and can trigger notifications through SNS or EventBridge.

Config maintains a detailed configuration history for each resource, showing how the configuration has changed over time. You can view the configuration of a resource at any point in the past and understand exactly what changed between two points in time. This historical view complements CloudTrail's event log—CloudTrail tells you the API call that triggered the change, while Config shows you the before-and-after states.

### Key Differences: When to Use Each

The distinction between these tools becomes clearer when you consider the types of questions they're designed to answer.

**CloudTrail answers forensic and accountability questions.** Who deleted the database? What IAM role created those access keys? Which user changed the Lambda function code? When did the security group rule change? Which AWS account made the cross-account S3 access? If you're investigating a security incident or need to prove compliance with access controls and accountability requirements, CloudTrail is your tool. It provides the immutable record of who took what action and when.

**AWS Config answers compliance and configuration questions.** Are all my S3 buckets encrypted? Does every EC2 instance have the required security group attached? Are all RDS instances multi-AZ? Have any security group rules drifted from their intended configuration? Are there any IAM users without multi-factor authentication enabled? If you need to demonstrate that your infrastructure meets compliance standards or detect configuration drift, Config is your tool.

This difference shapes how you query each tool. With CloudTrail, you're typically searching for specific events: you know something happened and want to find the details. With Config, you're typically asking aggregate questions: you want to know the compliance status across all your resources, or you want to understand the complete configuration of a specific resource.

The time dimensions differ as well. CloudTrail events are about *change over time*—what happened at specific moments in the past. Config rules are about *state compliance*—is the current state acceptable according to our standards. CloudTrail gives you event history; Config gives you configuration snapshots and compliance status.

### Complementary Use: A Real-World Scenario

To fully appreciate how these tools complement each other, consider a realistic compliance scenario. Your security team has established that all production databases must have automated backups enabled with a retention period of at least seven days. You've created a Config rule to enforce this compliance requirement.

One Monday morning, Config alerts you that a production RDS database has become non-compliant—the backup retention period was reduced to three days. Now you have a compliance problem that needs investigation and resolution. This is where CloudTrail becomes essential. You query CloudTrail to find the ModifyDBInstance API call that changed the backup retention, identify which IAM principal made the change, review the timestamp, and determine whether this was an authorized change or a security incident.

If the change was unauthorized, CloudTrail gives you the information you need to understand the scope of the breach and potentially trace the source of the compromise (through user agent, source IP, and the chain of API calls). If the change was authorized, you can work with the team that made the change to understand why the configuration drifted and implement better processes to prevent future drift.

In this scenario, Config identified the compliance problem, and CloudTrail provided the forensic details needed to respond appropriately. Neither tool alone would have given you the complete picture.

### Practical Cost Considerations

Understanding the pricing model of each tool is important for designing cost-effective compliance programs.

**CloudTrail** charges per 100,000 events ingested after the first 100,000 per trail per month. This means you pay for the volume of activity in your account. Accounts with frequent API activity—perhaps development environments with significant automation or large production systems—will incur higher CloudTrail costs. Data events are significantly more expensive than management events because they capture the detailed operations on your actual data. In a high-volume S3 environment, for example, enabling CloudTrail data events for all S3 buckets could result in millions of events per day and correspondingly high costs.

**AWS Config** charges per resource evaluated per month. You pay a flat rate for each rule and a smaller per-resource rate for resources evaluated against those rules. This means that in a large environment with thousands of resources, Config costs scale with your infrastructure size. The pricing is more predictable because it's based on the number of resources, not the volume of activity.

In practice, this means CloudTrail is generally cost-effective for accounts with moderate API activity, while AWS Config is cost-effective for organizations with strict compliance requirements and large numbers of resources to monitor. Both tools offer value in most production environments, and their costs are typically justified by the compliance and security benefits they provide.

### Integration with Other AWS Services

Both tools integrate deeply with the broader AWS ecosystem, multiplying their value.

CloudTrail events can be streamed to CloudWatch Logs, where you can create metric filters and alarms. If you want to be alerted in real-time whenever someone attempts to delete an RDS instance or modify an IAM policy, you can use CloudWatch Logs Insights to search CloudTrail events and CloudWatch alarms to notify your security team.

Config integrates with Systems Manager for remediation, allowing you to automatically correct non-compliant resources. If a Config rule detects that an S3 bucket doesn't have encryption enabled, you can configure an SSM document to automatically enable encryption. This moves Config from simply detecting compliance problems to actively maintaining compliance.

Both tools can send events to EventBridge, enabling sophisticated event-driven architectures. You might trigger a Lambda function when CloudTrail detects a privileged API call or when Config detects a compliance violation, allowing you to implement custom response logic.

### Selecting the Right Tool for Your Needs

When you're designing a compliance program or investigating a specific issue, ask yourself what you're trying to accomplish.

If you need to **understand what happened, who did it, and when they did it**, CloudTrail is your answer. If you want to **know whether your current configurations meet your compliance standards and catch configuration drift**, AWS Config is your answer. If you need to do **both**—understand both the compliance status and the history of how you got there—you'll want both tools as complementary parts of a comprehensive compliance strategy.

For incident response, forensic investigations, and audit accountability, CloudTrail is indispensable. For continuous compliance monitoring, configuration governance, and catching unauthorized configuration changes, AWS Config is essential. A mature AWS environment typically uses both tools, each serving their specific purpose while together providing comprehensive visibility into account activity and resource configuration.

### Conclusion

CloudTrail and AWS Config serve fundamentally different purposes in AWS governance and compliance. CloudTrail is a temporal audit log that captures every API call, answering forensic questions about who did what and when. AWS Config is a configuration compliance tool that continuously monitors resource configurations against rules, answering questions about current state and compliance drift. Rather than choosing between them, successful compliance programs leverage both tools in complementary ways: Config identifies compliance problems, CloudTrail investigates the root causes, and together they provide the visibility and accountability that modern cloud security demands.
