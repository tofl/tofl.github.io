---
title: "Using CloudTrail Logs to Detect Unauthorized or Anomalous Activity"
---

## Using CloudTrail Logs to Detect Unauthorized or Anomalous Activity

Security incidents are inevitable in cloud environments—it's not a question of if, but when. When something goes wrong, you need a way to understand exactly what happened, who did it, and when. That's where AWS CloudTrail comes in. CloudTrail records API calls made within your AWS account, creating an immutable audit trail that lets you investigate incidents, prove compliance, and detect threats before they become catastrophes.

The challenge isn't just collecting logs; it's knowing what to look for and how to act on it. This guide walks you through practical techniques for detecting unauthorized and anomalous activity using CloudTrail logs, from manual forensic analysis to automated detection systems that alert you in real time.

### Understanding CloudTrail as Your Security Audit Trail

CloudTrail is AWS's foundational logging service that records every API call—successful or failed—across your AWS infrastructure. When you enable CloudTrail, it captures details like who made the call, what service was affected, what action was taken, and the timestamp. Each event is logged in JSON format, making it machine-readable and queryable.

Think of CloudTrail as your security camera system for the cloud. Just as a physical camera records who entered a building and when, CloudTrail records who accessed your AWS resources and when. But unlike a static video feed, CloudTrail logs are structured data that you can search, analyze, and act upon programmatically.

By default, CloudTrail logs management events—the control plane actions like creating EC2 instances or modifying IAM policies. For forensic investigations, you'll want to ensure CloudTrail is enabled and logging to an S3 bucket where logs can be retained long-term and protected from tampering. Many organizations also enable data events to capture object-level activity in S3 or API calls to Lambda functions, though these generate significantly more volume.

### Common Attack Patterns and What to Hunt For

Before diving into queries and automation, you need to know what suspicious activity actually looks like. Real-world attacks and compromises follow predictable patterns. By understanding these patterns, you can write better queries and configure smarter alerts.

#### Root Account API Usage

The root account in AWS is supremely powerful—it bypasses all IAM policies and can do anything. AWS strongly recommends against using the root account for daily operations. If you see API calls originating from the root account (indicated by the `userIdentity.type` field being "Root" and the `userIdentity.principalId` matching your account ID), that's a red flag.

Legitimate root account usage is rare: emergency access during an incident, initial account setup, or billing operations. Anything else warrants investigation. An attacker with root credentials has essentially won—they can erase logs, disable security controls, and cover their tracks.

#### Sudden Spike in Failed Authentication Attempts

When an attacker is trying to guess credentials or brute-force access, you'll see a surge in failed authentication events. Look for events with `errorCode` values like "UnauthorizedOperation," "AccessDenied," or "InvalidUserID.Malformed." A single failed attempt is normal; dozens within minutes from the same source IP is not.

This pattern is especially dangerous with user accounts that have programmatic access keys. If an attacker obtains an access key, they might try to use it before you revoke it, and you'll see a flood of access denied errors from unexpected IP addresses.

#### Unauthorized Policy Changes

IAM policies control permissions. If an attacker gains credentials for a user with even minimal permissions, they might immediately attempt to escalate privileges by modifying policies or creating new users with broad permissions. Look for events like `PutUserPolicy`, `AttachUserPolicy`, `CreateAccessKey`, `CreateUser`, and `AssumeRole` from unexpected sources or at unusual times.

Legitimate policy changes happen, but they're usually planned and documented. Unscheduled policy modifications at 3 AM deserve scrutiny, especially if they come from an unknown IP address or a user who typically doesn't handle IAM.

#### Data Exfiltration via GetObject and CopyObject

Once inside your account, attackers often try to steal data. S3 is a common target. Look for unusual spikes in `GetObject` or `CopyObject` calls, particularly if they're downloading large volumes of sensitive data or copying it to external buckets you don't recognize.

The suspicious signature here is volume and speed: thousands of object reads in minutes, or copying objects to an S3 bucket in a different AWS account. Combined with source IP analysis, you can often pinpoint whether this is a compromised credential or a misconfiguration.

#### Persistence Mechanisms

Attackers want to maintain access even after the initial compromise is discovered. Watch for the creation of new IAM users, the addition of SSH keys or console login certificates to existing users, and the creation of long-lived access keys. These are indicators that an attacker is establishing a back door.

### Setting Up CloudTrail for Forensic Investigation

Before you can investigate, you need to have logs. The basic setup is straightforward, but there are decisions to make about retention, storage, and accessibility.

Start by creating a CloudTrail that logs to an S3 bucket. This bucket should be in a separate AWS account if possible—the "logging account"—to prevent a compromised production account from tampering with logs. Enable log file validation, which uses cryptographic signing to ensure logs haven't been altered after delivery.

```
aws cloudtrail create-trail \
  --name my-organization-trail \
  --s3-bucket-name my-cloudtrail-logs-bucket \
  --is-multi-region-trail \
  --enable-log-file-validation
```

The `--is-multi-region-trail` flag ensures you capture activity across all AWS regions, not just one. This is essential because attackers might launch resources in unexpected regions hoping you won't notice.

Once the trail is created, start logging and consider enabling both management events and data events:

```
aws cloudtrail start-logging --trail-name my-organization-trail

aws cloudtrail put-event-selectors \
  --trail-name my-organization-trail \
  --event-selectors '[
    {
      "ReadWriteType": "All",
      "IncludeManagementEvents": true
    },
    {
      "ReadWriteType": "All",
      "IncludeManagementEvents": false,
      "DataResources": [
        {
          "Type": "AWS::S3::Object",
          "Values": ["arn:aws:s3:::*/*"]
        }
      ]
    }
  ]'
```

Data events will significantly increase your log volume and costs, but they're invaluable for detecting data theft. You can be selective and only enable them for sensitive buckets if cost is a concern.

Finally, set up log aggregation. CloudTrail can deliver logs to CloudWatch Logs, which makes them queryable via CloudWatch Logs Insights. You can also use Amazon Athena to query CloudTrail logs directly in S3 for larger-scale investigations.

### Querying CloudTrail Logs with CloudWatch Logs Insights

CloudWatch Logs Insights is purpose-built for analyzing logs at scale. It uses a simple query language that lets you extract, filter, and aggregate CloudTrail events. This is perfect for interactive forensic investigation when you have a hypothesis to test.

Let's walk through some practical queries you'll use during incident response.

#### Finding Root Account Activity

```
fields @timestamp, userIdentity.principalId, eventName, sourceIPAddress
| filter userIdentity.type = "Root" 
  and userIdentity.principalId = "AIDAI1234567890ABCDE"
| stats count() by eventName, sourceIPAddress
```

This query shows every action taken by the root account, grouped by action type and source IP. If you see unexpected IPs or actions, you've found a serious problem.

#### Detecting Authentication Failures

```
fields @timestamp, userIdentity.principalId, errorCode, sourceIPAddress, awsRegion
| filter errorCode like /Unauthorized|AccessDenied|InvalidUserID/
| stats count() as attempt_count by sourceIPAddress, userIdentity.principalId, awsRegion
| filter attempt_count > 10
```

This query aggregates failed authentication attempts and shows you source IPs with more than ten failures. Adjust the threshold based on your environment's baseline. A single compromised access key might generate thousands of failures across minutes—adjust accordingly if investigating an active incident.

#### Spotting Suspicious Policy Changes

```
fields @timestamp, userIdentity.principalId, eventName, sourceIPAddress, requestParameters
| filter eventName in ["PutUserPolicy", "AttachUserPolicy", "PutRolePolicy", 
  "AttachRolePolicy", "CreateAccessKey", "CreateUser"]
| stats count() by userIdentity.principalId, eventName, sourceIPAddress
```

This query finds all policy modifications and access key creations. Cross-reference the source IPs against your known office networks and VPN ranges. Anything from a residential IP address at 2 AM warrants investigation.

#### Identifying Data Exfiltration

```
fields @timestamp, userIdentity.principalId, eventName, sourceIPAddress, 
  requestParameters.bucketName, requestParameters.key
| filter eventName in ["GetObject", "CopyObject"] 
  and requestParameters.bucketName = "my-sensitive-data-bucket"
| stats count() as read_count, count_distinct(requestParameters.key) as unique_objects 
  by userIdentity.principalId, @timestamp/@timestamp as 1m
| filter read_count > 100
```

This query looks for bulk reads of objects in a sensitive bucket within one-minute windows. The aggregation by one-minute buckets helps you spot sudden spikes. Adjust the bucket name and threshold based on your environment.

#### Finding Cross-Account Activity

```
fields @timestamp, userIdentity.principalId, userIdentity.accountId, eventName, sourceIPAddress
| filter userIdentity.accountId != "123456789012"
| stats count() by userIdentity.accountId, eventName, sourceIPAddress
```

Replace "123456789012" with your account ID. This query reveals when users from other accounts are accessing your resources, which might be legitimate cross-account access or a red flag depending on your organization's architecture.

The beauty of CloudWatch Logs Insights is that you can run these queries in seconds and pivot based on what you find. If you discover suspicious activity from a specific principal, you can drill down further:

```
fields @timestamp, eventName, sourceIPAddress, requestParameters, responseElements, errorCode
| filter userIdentity.principalId = "AIDAI1234567890SUSPECT"
| sort @timestamp desc
```

This chronological view of a suspect user's activity helps you understand the attack sequence.

### Analyzing CloudTrail Logs with Amazon Athena

For deeper forensic work or when investigating large date ranges, Amazon Athena offers powerful SQL-based querying of CloudTrail logs in S3. Unlike CloudWatch Logs Insights, which is good for recent logs, Athena excels at historical analysis across months or years of data.

To query CloudTrail logs with Athena, you first need to create an external table pointing to your CloudTrail S3 bucket. AWS provides a DDL statement that creates the schema:

```sql
CREATE EXTERNAL TABLE cloudtrail_logs (
  eventVersion STRING,
  userIdentity STRUCT<
    type: STRING,
    principalId: STRING,
    arn: STRING,
    accountId: STRING,
    invokedBy: STRING,
    accessKeyId: STRING,
    userName: STRING,
    sessionContext: STRUCT<
      attributes: STRUCT<
        mfaAuthenticated: STRING,
        creationDate: STRING>,
      sessionIssuer: STRUCT<
        type: STRING,
        principalId: STRING,
        arn: STRING,
        accountId: STRING,
        userName: STRING>>>,
  eventTime STRING,
  eventSource STRING,
  eventName STRING,
  awsRegion STRING,
  sourceIPAddress STRING,
  userAgent STRING,
  errorCode STRING,
  errorMessage STRING,
  requestParameters STRING,
  responseElements STRING,
  additionaleventdata STRING,
  requestId STRING,
  eventId STRING,
  resources ARRAY<STRUCT<
    arn: STRING,
    accountId: STRING,
    type: STRING>>,
  eventType STRING,
  recipientAccountId STRING,
  sharedEventID STRING,
  vpcendpointid STRING
)
PARTITIONED BY (region STRING, year STRING, month STRING, day STRING)
ROW FORMAT SERDE 'com.amazon.emr.hive.serde.CloudTrailSerde'
STORED AS INPUTFORMAT 'com.amazon.emr.cloudtrail.CloudTrailInputFormat'
OUTPUTFORMAT 'org.apache.hadoop.hive.ql.io.HiveIgnoreKeyTextOutputFormat'
LOCATION 's3://my-cloudtrail-logs-bucket/AWSLogs/'
```

Once your table exists, you can write SQL queries. Here's a query to find all API calls by a specific user over a date range:

```sql
SELECT eventTime, eventName, sourceIPAddress, requestParameters, 
  errorCode, awsRegion
FROM cloudtrail_logs
WHERE useridentity.principalId = 'AIDAI1234567890SUSPECT'
  AND eventTime >= '2024-01-01'
  AND eventTime < '2024-01-07'
  AND region = 'us-east-1'
ORDER BY eventTime DESC
```

For finding patterns across multiple users, you might aggregate:

```sql
SELECT sourceIPAddress, eventName, COUNT(*) as call_count
FROM cloudtrail_logs
WHERE eventName IN ('PutUserPolicy', 'AttachUserPolicy', 'CreateAccessKey', 'CreateUser')
  AND eventTime >= '2024-01-01'
  AND errorCode IS NULL
GROUP BY sourceIPAddress, eventName
ORDER BY call_count DESC
```

This finds which IP addresses have been successfully making privilege escalation moves. Athena is slower than CloudWatch Logs Insights (queries take seconds to minutes rather than milliseconds), but it's more powerful for complex analysis and handles far larger datasets.

### Automated Detection with EventBridge and CloudWatch Alarms

Manual investigation is essential for deep forensics, but you can't rely on security teams to constantly monitor logs. You need automation. AWS EventBridge lets you create rules that trigger on specific CloudTrail events, enabling real-time alerts for suspicious activity.

EventBridge rules work by matching patterns. When a CloudTrail event matches your pattern, EventBridge can send a notification, trigger a Lambda function, or invoke other AWS services.

Here's an EventBridge rule that alerts whenever the root account is used:

```json
{
  "Name": "RootAccountUsageAlert",
  "State": "ENABLED",
  "EventPattern": {
    "source": ["aws.cloudtrail"],
    "detail-type": ["AWS API Call via CloudTrail"],
    "detail": {
      "userIdentity": {
        "type": ["Root"],
        "principalId": ["AIDAI1234567890ABCDE"]
      }
    }
  },
  "Targets": [
    {
      "Arn": "arn:aws:sns:us-east-1:123456789012:SecurityAlerts",
      "Id": "RootUsageSNSTarget"
    }
  ]
}
```

You'd create this rule via the EventBridge console or CLI and specify an SNS topic as the target. Every time the root account makes an API call, you get an instant notification.

Here's a rule that alerts on unauthorized policy changes:

```json
{
  "Name": "UnauthorizedPolicyChangeAlert",
  "State": "ENABLED",
  "EventPattern": {
    "source": ["aws.cloudtrail"],
    "detail-type": ["AWS API Call via CloudTrail"],
    "detail": {
      "eventSource": ["iam.amazonaws.com"],
      "eventName": [
        "PutUserPolicy", "AttachUserPolicy", "PutRolePolicy", "AttachRolePolicy",
        "CreateAccessKey", "CreateUser"
      ],
      "errorCode": [{"exists": false}]
    }
  },
  "Targets": [
    {
      "Arn": "arn:aws:lambda:us-east-1:123456789012:function:InvestigateIAMChange",
      "Id": "IAMChangeLambdaTarget"
    }
  ]
}
```

Notice the `"errorCode": [{"exists": false}]` clause—this filters for successful API calls only. Failed attempts are less concerning than successful modifications.

Instead of just sending a notification, you could invoke a Lambda function that automatically gathers context:

```python
import boto3
import json

cloudtrail = boto3.client('cloudtrail')
sns = boto3.client('sns')

def lambda_handler(event, context):
    detail = event['detail']
    principal_id = detail['userIdentity']['principalId']
    event_name = detail['eventName']
    source_ip = detail['sourceIPAddress']
    
    # Look up recent activity by this principal
    response = cloudtrail.lookup_events(
        LookupAttributes=[
            {
                'AttributeKey': 'ResourceName',
                'AttributeValue': principal_id
            }
        ],
        MaxResults=10
    )
    
    # Build an alert message
    message = f"""
    Suspicious IAM Activity Detected
    
    Principal: {principal_id}
    Action: {event_name}
    Source IP: {source_ip}
    Time: {detail['eventTime']}
    
    Recent actions by this principal:
    {json.dumps(response['Events'], indent=2, default=str)}
    """
    
    sns.publish(
        TopicArn='arn:aws:sns:us-east-1:123456789012:SecurityAlerts',
        Subject='ALERT: Suspicious IAM Activity',
        Message=message
    )
    
    return {'statusCode': 200}
```

This Lambda function not only alerts you but enriches the alert with context—it shows you other recent actions by the suspicious principal, helping you understand whether this is part of a larger attack.

You can also create CloudWatch alarms based on CloudWatch Logs Insights insights. An insight automatically detects anomalies in your logs. You set a threshold, and when CloudWatch detects an abnormal spike, it triggers an alarm:

```json
{
  "AlarmName": "HighFailedAuthenticationRate",
  "MetricName": "FailedAuthAttempts",
  "Namespace": "CloudTrailMetrics",
  "Statistic": "Sum",
  "Period": 300,
  "EvaluationPeriods": 1,
  "Threshold": 20,
  "ComparisonOperator": "GreaterThanOrEqualToThreshold",
  "AlarmActions": [
    "arn:aws:sns:us-east-1:123456789012:SecurityAlerts"
  ]
}
```

In practice, you'd create a CloudWatch Logs Insights query that counts failed authentication attempts and pushes that metric to CloudWatch as a custom metric. When the metric exceeds your threshold, the alarm fires.

### Correlating Events for Complete Incident Context

Real incidents rarely involve a single suspicious event. Instead, they're a sequence of events that, taken together, tell a story. Good forensic investigation involves correlating events across services to build a complete timeline.

Imagine a scenario: you've discovered that sensitive data was copied from S3 to an external account. To understand how this happened, you'd investigate in sequence:

1. **Identify the principal and time**: Query CloudTrail for the CopyObject call. Extract the IAM user, access key, and timestamp.

2. **Trace back to initial compromise**: Query for when this access key was created. Was it legitimate?

3. **Check for privilege escalation**: Did this principal recently gain new permissions? Query for IAM policy changes affecting this user around the time of initial compromise.

4. **Examine login history**: If the principal is a human user with console access, check CloudTrail for ConsoleLogin events. From which IP addresses did they log in?

5. **Identify the attack path**: Piece together the sequence of events. Perhaps the attacker:
   - Compromised the user's password (failed login attempts followed by successful login from a new IP)
   - Escalated privileges (policy changes shortly after)
   - Accessed sensitive data (GetObject calls)
   - Exfiltrated data (CopyObject to external account)

6. **Establish timeline and scope**: Determine exactly when the compromise occurred and what data was accessed. This informs your response: Do you need to reset credentials? Rotate keys? Notify customers?

CloudWatch Logs Insights makes this correlation easier by letting you query related events efficiently. Start broad, then narrow down based on findings.

### Best Practices for CloudTrail-Based Security

Implementing CloudTrail logging is just the beginning. To actually use it effectively for security, follow these practices:

**Protect your CloudTrail logs.** Store them in an S3 bucket with versioning enabled and MFA delete required. Consider using S3 Object Lock in compliance mode to make logs immutable. Enable log file validation to cryptographically prove logs haven't been tampered with. If a security team member or attacker can modify logs, your audit trail becomes worthless.

**Log to a separate account.** If possible, deliver CloudTrail logs from all your AWS accounts to a centralized logging account. This prevents a compromised account from disabling CloudTrail or tampering with logs. Use CloudTrail organization trails if you're using AWS Organizations.

**Alert on changes to CloudTrail itself.** An attacker's first instinct might be to disable CloudTrail or stop logging. Create EventBridge rules for events like StopLogging, DeleteTrail, and PutEventSelectors. These should always trigger an alert.

**Establish a baseline.** Understand what normal activity looks like in your environment. Know which IPs are legitimate, which API calls are expected, and what volume of traffic is typical. This lets you spot anomalies more effectively.

**Tune your alerts.** Too many false positives and your team will ignore alerts (alert fatigue). Too few and you'll miss incidents. Start with the high-confidence patterns described earlier—root account usage, data exfiltration, policy changes from unexpected sources—and refine based on your environment.

**Retain logs for compliance duration.** Regulations like HIPAA, PCI-DSS, and SOX require log retention for specified periods. CloudTrail logs should be retained at least as long as your compliance requirements demand, preferably longer. S3 Lifecycle policies can automatically move old logs to cheaper storage classes.

**Integrate with your SIEM.** If your organization uses a Security Information and Event Management system, forward CloudTrail logs to it. This lets your security team correlate AWS events with logs from other systems and applications.

### Real-World Incident Example

Let's walk through a simplified but realistic incident to see how these techniques work together.

You receive an alert: CloudWatch detected an anomalously high spike in S3 GetObject calls from your production environment. You immediately open the CloudWatch dashboard and run a query:

```
fields @timestamp, userIdentity.principalId, sourceIPAddress, requestParameters.bucketName
| filter eventName = "GetObject"
  and requestParameters.bucketName = "prod-customer-data"
| stats count() as read_count by userIdentity.principalId, sourceIPAddress
| filter read_count > 1000
```

You find that the principal `AIDAI9876543210STUDY` from IP address `203.0.113.42` has made over 2000 GetObject calls in the last hour. You don't recognize this IP. Now you drill deeper:

```
fields @timestamp, userIdentity.principalId, eventName, sourceIPAddress
| filter userIdentity.principalId = "AIDAI9876543210STUDY"
| sort @timestamp desc
```

This shows that the access key was used earlier today with different IPs, and in the last hour, every call has been from `203.0.113.42`. You run another query to find when this access key was created:

```
fields @timestamp, eventName, userIdentity.principalId, requestParameters
| filter eventName = "CreateAccessKey"
  and requestParameters.userName = "app-service-user"
| sort @timestamp desc
```

You discover the key was created 48 hours ago—legitimate and expected. But then:

```
fields @timestamp, eventName, sourceIPAddress, requestParameters
| filter userIdentity.principalId = "AIDAI9876543210STUDY"
  and eventName in ["GetObject", "CopyObject"]
  and requestParameters.bucketName = "prod-customer-data"
| sort @timestamp asc
```

Starting 2 hours ago, this key was used to copy 50 GB of customer data to an external S3 bucket in a different account. The CopyObject calls came from `203.0.113.42`. You immediately know:

1. The access key for this service account has been compromised.
2. The attacker is likely outside your infrastructure (unfamiliar IP).
3. Sensitive customer data has been exfiltrated.
4. The attack started 2 hours ago.

You trigger your incident response protocol: revoke the access key, alert the security team, begin forensics on systems that might have been compromised, and notify legal/compliance about the data breach.

This incident, detected within minutes, is handled far better than if CloudTrail hadn't been in place. Without logs, you'd have no idea when or how the breach occurred.

### Conclusion

CloudTrail logs are your forensic record for AWS. They tell the story of who accessed what, when, and from where. By understanding common attack patterns, learning to query logs effectively, and setting up automated alerts, you transform raw logs into a security superpower.

The journey starts with ensuring CloudTrail is enabled and logging to a protected S3 bucket. From there, you can use CloudWatch Logs Insights for interactive investigation, Amazon Athena for deep historical analysis, and EventBridge for real-time detection. Combined, these tools give you visibility into incidents from detection to resolution.

Security in the cloud is a shared responsibility. AWS provides the tools—CloudTrail, CloudWatch, EventBridge, and Athena. You provide the vigilance, the tuning, and the response. Start by implementing the patterns described here: alert on root account usage, suspicious policy changes, and data exfiltration. As you grow more comfortable, expand your monitoring to catch subtler indicators of compromise. Over time, your organization will develop the muscle memory and institutional knowledge to respond faster and more effectively to incidents. That's when you know CloudTrail is working as intended—not just logging activity, but actively protecting your business.
