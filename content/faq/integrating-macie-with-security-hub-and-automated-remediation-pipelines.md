---
title: "Integrating Macie with Security Hub and Automated Remediation Pipelines"
---

## Integrating Macie with Security Hub and Automated Remediation Pipelines

Imagine you're working on a data governance initiative where hundreds of S3 buckets hold customer data, payment information, and intellectual property. Someone accidentally makes a bucket public, or a developer uploads an unencrypted database backup to the wrong location. You'd want to know about it immediately—not hours later when a security audit uncovers the problem. This is where Amazon Macie, combined with AWS Security Hub and intelligent automation, becomes your organization's proactive security muscle.

Macie discovers and classifies sensitive data in S3, but discovering a problem is only half the battle. The real power emerges when you centralize those findings, correlate them with other security events, and trigger immediate, automated responses. In this article, we'll explore how to integrate Macie with Security Hub for unified security visibility, then build automated remediation pipelines that respond to threats before they become breaches.

### Understanding the Foundation: Macie and Security Hub

Before we talk about building integrations, let's establish what each service does and why they work well together.

Amazon Macie is a managed data security service that uses machine learning to discover and protect sensitive data in your AWS environment. It continuously scans S3 buckets, identifies personally identifiable information (PII), financial data, and other sensitive content, then generates findings when it detects policy violations or misconfigurations. A Macie finding might alert you that a bucket containing credit card numbers is publicly readable, or that sensitive documents are stored without encryption.

AWS Security Hub serves as your central security findings aggregator. Think of it as a command center that collects security events from multiple AWS services—Macie, GuardDuty, Inspector, Config, and more—into a single pane of glass. Security Hub normalizes these findings into a common format, removes duplicates, and helps you track remediation status. Rather than logging into five different services to understand your security posture, you see everything in one place.

The synergy is clear: Macie finds data risks, and Security Hub ensures those findings are visible, correlated, and actionable across your entire security program.

### How Security Hub Aggregates Macie Findings

When you enable Security Hub and Macie in the same AWS account or across a multi-account organization, Security Hub automatically ingests Macie findings. Each finding includes rich metadata: the affected S3 bucket, the type of sensitive data detected, severity level, and recommended remediation steps.

Let's say Macie discovers that a bucket named `analytics-backups` contains unencrypted personally identifiable information and is accessible via a bucket policy that allows the public internet. Macie generates a finding, and Security Hub ingests it, normalizing it into the AWS Security Finding Format (ASFF). This normalized finding becomes searchable and actionable. You can filter by severity, finding type, resource type, or timestamp. You can also correlate it with other findings—perhaps Config has flagged the same bucket for missing encryption, and GuardDuty has detected unusual access patterns. Security Hub shows you the full picture.

One critical advantage: Security Hub provides compliance mapping. If your organization follows PCI DSS, HIPAA, or CIS benchmarks, Security Hub maps findings to specific control requirements. A Macie finding about unencrypted sensitive data directly maps to encryption controls, giving you immediate insight into compliance gaps.

### Centralizing Findings Across Multiple Accounts

In larger organizations, you rarely operate in a single AWS account. Security Hub excels at aggregating findings across accounts using its delegated administrator model. One central account acts as the security hub, collecting findings from member accounts across your organization. This architectural pattern scales elegantly: as you add new accounts or regions, their Macie findings flow automatically to your central hub.

To set this up, you designate a delegated administrator account in AWS Organizations. This account enables Security Hub and registers member accounts as aggregation targets. When Macie in a member account generates a finding, Security Hub automatically routes it to the delegated administrator's hub. You can then apply organization-wide remediation policies and create unified dashboards without manually checking each account.

This matters for remediation because centralized visibility enables centralized response. Instead of each account team handling Macie findings independently, your security team defines standardized remediation workflows that apply consistently across the organization.

### Building Custom Routing with EventBridge

Security Hub and Macie findings alone won't fix your problems automatically. To achieve true automation, you need to route findings to remediation systems. This is where Amazon EventBridge comes in.

EventBridge allows you to create rules that match on specific finding attributes and trigger actions. When Security Hub detects a new finding matching your rule conditions, EventBridge fires the corresponding target—typically a Lambda function, SNS topic, or external webhook.

Here's the pattern: create an EventBridge rule that listens for Security Hub finding events, matches on Macie finding types, and invokes a Lambda function to remediate. For example, you might create a rule like this:

```json
{
  "Name": "MacieSensitiveDataRemediationRule",
  "Description": "Route Macie findings about public buckets to Lambda remediation",
  "EventBusName": "default",
  "EventPattern": {
    "source": ["aws.securityhub"],
    "detail-type": ["Security Hub Findings - Imported"],
    "detail": {
      "findings": {
        "source": {
          "identifier": ["macie"]
        },
        "severity": {
          "label": ["HIGH", "CRITICAL"]
        },
        "types": ["Software and Configuration Checks/AWS Security Best Practices"]
      }
    }
  },
  "State": "ENABLED",
  "Targets": [
    {
      "Arn": "arn:aws:lambda:us-east-1:123456789012:function:RemediateMacieFinding",
      "RoleArn": "arn:aws:iam::123456789012:role/EventBridgeInvokeLambdaRole"
    }
  ]
}
```

This rule captures high and critical severity Macie findings and sends them to a remediation Lambda function. The matching criteria are flexible—you can filter by specific finding types, affected resource types, or custom attributes that Macie includes in its findings.

### Implementing Automated Remediation with Lambda

Now comes the enforcement. Your Lambda function receives the finding event and takes corrective action. Let's walk through a concrete example: automatically quarantining S3 objects containing sensitive data.

When Macie detects that an object in a bucket contains credit card numbers, your remediation Lambda can move that object to a quarantine prefix. This prevents accidental exposure while preserving the object for forensic analysis.

```python
import json
import boto3
from urllib.parse import unquote_plus

s3_client = boto3.client('s3')

def lambda_handler(event, context):
    """
    Remediate Macie findings by moving sensitive objects to quarantine.
    """
    
    # Parse the finding from the EventBridge event
    findings = event['detail']['findings']
    
    for finding in findings:
        # Extract bucket and object information from finding metadata
        bucket_name = finding['Resources'][0]['Id'].split(':')[-1]
        
        # Get the object key from custom metadata if available
        # In a real scenario, you'd parse this from Macie's detailed output
        object_key = finding.get('Resources')[0].get('Details', {}).get('AwsS3Object', {}).get('Key')
        
        if not object_key or not bucket_name:
            print(f"Skipping finding - unable to extract object metadata: {finding['Id']}")
            continue
        
        try:
            # Move object to quarantine prefix
            quarantine_key = f"quarantine/{object_key}"
            
            # Copy object to quarantine location
            copy_source = {'Bucket': bucket_name, 'Key': object_key}
            s3_client.copy_object(
                CopySource=copy_source,
                Bucket=bucket_name,
                Key=quarantine_key,
                ServerSideEncryption='AES256'
            )
            
            # Delete original object
            s3_client.delete_object(Bucket=bucket_name, Key=object_key)
            
            print(f"Successfully quarantined {object_key} in {bucket_name}")
            
            # Send notification (optional - integrate with SNS)
            notify_data_owner(bucket_name, object_key, finding)
            
        except Exception as e:
            print(f"Error remediating finding {finding['Id']}: {str(e)}")
            return {
                'statusCode': 500,
                'body': json.dumps(f'Remediation failed: {str(e)}')
            }
    
    return {
        'statusCode': 200,
        'body': json.dumps('Remediation completed successfully')
    }

def notify_data_owner(bucket_name, object_key, finding):
    """
    Send SNS notification to data owner about quarantined object.
    """
    sns_client = boto3.client('sns')
    
    message = f"""
    A sensitive object has been automatically quarantined.
    
    Bucket: {bucket_name}
    Object: {object_key}
    Reason: {finding['Title']}
    Severity: {finding['Severity']['Label']}
    
    The object has been moved to a quarantine prefix and is no longer accessible
    through normal application workflows. Contact your security team for review.
    """
    
    try:
        sns_client.publish(
            TopicArn='arn:aws:sns:us-east-1:123456789012:DataSecurityAlerts',
            Subject='Sensitive Object Quarantined',
            Message=message
        )
    except Exception as e:
        print(f"Failed to send notification: {str(e)}")
```

This function extracts bucket and object information from the Macie finding, moves the sensitive object to a quarantine prefix (with encryption enabled), and notifies the data owner. The quarantine approach balances security with forensic capability—the object is isolated but not permanently deleted, allowing investigation if needed.

### Applying Stricter Bucket Policies and IAM Controls

Beyond object-level remediation, you might need to tighten access controls on entire buckets. If Macie finds that a bucket is publicly readable and contains sensitive data, you should restrict access immediately.

```python
import boto3
import json

s3_client = boto3.client('s3')

def apply_restrictive_bucket_policy(bucket_name):
    """
    Apply a restrictive bucket policy that blocks public access.
    """
    
    # First, block all public access at the bucket level
    s3_client.put_public_access_block(
        Bucket=bucket_name,
        PublicAccessBlockConfiguration={
            'BlockPublicAcls': True,
            'IgnorePublicAcls': True,
            'BlockPublicPolicy': True,
            'RestrictPublicBuckets': True
        }
    )
    
    # Define a restrictive policy that only allows internal IAM principals
    restrictive_policy = {
        "Version": "2012-10-17",
        "Statement": [
            {
                "Sid": "DenyAllPublicAccess",
                "Effect": "Deny",
                "Principal": "*",
                "Action": "s3:*",
                "Resource": [
                    f"arn:aws:s3:::{bucket_name}",
                    f"arn:aws:s3:::{bucket_name}/*"
                ],
                "Condition": {
                    "StringLike": {
                        "aws:PrincipalArn": "*"
                    }
                }
            },
            {
                "Sid": "AllowInternalAccess",
                "Effect": "Allow",
                "Principal": {
                    "AWS": "arn:aws:iam::123456789012:root"
                },
                "Action": [
                    "s3:GetObject",
                    "s3:ListBucket"
                ],
                "Resource": [
                    f"arn:aws:s3:::{bucket_name}",
                    f"arn:aws:s3:::{bucket_name}/*"
                ]
            }
        ]
    }
    
    s3_client.put_bucket_policy(
        Bucket=bucket_name,
        Policy=json.dumps(restrictive_policy)
    )
    
    print(f"Applied restrictive policy to {bucket_name}")
```

This approach uses both S3's public access block feature (which is forceful and hard to accidentally override) and a bucket policy that explicitly denies public access while allowing internal principals. It's defense in depth—multiple layers preventing the same mistake.

### Real-World Remediation Pipeline Example

Let's tie this together into a complete, production-ready scenario. Imagine your compliance requirements mandate that any bucket containing credit card data must be encrypted, private, and accessed only through specific applications.

Your pipeline looks like this:

1. **Detection**: Macie scans `customer-data` bucket and finds unencrypted credit card numbers accessible via a public bucket policy.

2. **Aggregation**: Macie sends the finding to Security Hub, which normalizes it and enriches it with compliance mappings (PCI DSS encryption requirement, etc.).

3. **Routing**: EventBridge rule matches the finding (type: sensitive financial data, severity: CRITICAL) and invokes the remediation Lambda.

4. **Remediation - Phase 1**: Lambda applies the restrictive bucket policy and enables S3 Public Access Block, immediately preventing public access.

5. **Remediation - Phase 2**: Lambda identifies which objects contain credit card data (using Macie's detailed metadata) and moves them to the quarantine prefix.

6. **Notification**: Lambda sends SNS messages to the data owner, the security team, and a webhook to your incident management system.

7. **Tracking**: Security Hub's finding status updates to "REMEDIATED," and the dashboard shows which findings have been automatically resolved.

8. **Forensics**: Your security team can later review quarantined objects, determine how they ended up unencrypted, and implement process changes to prevent recurrence.

The beauty of this pipeline is that it's automated, logged, and repeatable. The next time someone makes the same mistake, the system catches and corrects it without manual intervention.

### Integration with Third-Party SIEM Tools

Many organizations use third-party SIEM systems (Splunk, Datadog, Sumo Logic) for consolidated security monitoring. Security Hub can feed findings to these platforms, creating a unified security view across AWS and on-premises infrastructure.

EventBridge can route findings to an HTTPS endpoint via a webhook, or you can configure EventBridge to send findings to an SNS topic that a SIEM connector subscribes to. When a Macie finding fires, your SIEM ingests it alongside other security events, enabling correlation across your entire environment.

For example, you might use EventBridge to forward Macie findings to Splunk:

```python
import boto3
import json
import requests

def send_to_siem(finding, siem_endpoint, siem_token):
    """
    Forward Security Hub findings to external SIEM via HTTP.
    """
    
    # Transform finding to SIEM-friendly format
    siem_event = {
        "event_type": "aws_security_hub",
        "source": "macie",
        "finding_id": finding['Id'],
        "resource": finding['Resources'][0]['Id'],
        "severity": finding['Severity']['Label'],
        "title": finding['Title'],
        "description": finding['Description'],
        "timestamp": finding['FirstObservedAt']
    }
    
    headers = {
        "Authorization": f"Bearer {siem_token}",
        "Content-Type": "application/json"
    }
    
    try:
        response = requests.post(
            siem_endpoint,
            json=siem_event,
            headers=headers,
            timeout=10
        )
        
        if response.status_code == 200:
            print(f"Successfully sent finding to SIEM: {finding['Id']}")
        else:
            print(f"SIEM rejected finding: {response.status_code}")
    
    except Exception as e:
        print(f"Failed to forward to SIEM: {str(e)}")
```

This enables your SIEM to trigger its own downstream actions—correlating with network logs, triggering incident tickets, or initiating additional investigation workflows. Your security operations center sees Macie findings in the same interface as everything else.

### Best Practices for Automated Remediation

Building automated remediation is powerful, but it requires careful planning to avoid unintended consequences.

**Test in non-production first.** Before deploying remediation Lambda functions to production, validate them in a development environment with test buckets and synthetic Macie findings. Ensure your function correctly parses finding metadata and performs the intended action without side effects.

**Implement idempotency.** Your remediation function should handle cases where the same finding triggers multiple times (due to retries or duplicate events). Moving an object to quarantine twice should not cause an error—check if it already exists before attempting the move.

**Use AWS Secrets Manager for credentials.** If your remediation function needs to authenticate with external systems (SIEM APIs, ticketing systems), retrieve credentials from Secrets Manager rather than embedding them in code.

**Log all actions extensively.** Every remediation action should be logged with timestamps, affected resources, and outcomes. Use CloudWatch Logs and ensure your logging role has appropriate permissions. These logs become your audit trail proving that remediation occurred.

**Implement a manual approval workflow for destructive actions.** While moving objects to quarantine is reversible, some actions (like permanent deletion) should require human approval. Consider using SNS topics with manual confirmation before executing irreversible changes.

**Handle failures gracefully.** If remediation fails (e.g., you lack permissions to modify a bucket), ensure your function logs the failure and sends an alert. Don't fail silently—escalate to your security team.

### Monitoring and Maintaining Your Pipeline

Once your remediation pipeline is live, you need visibility into its operation. Create CloudWatch metrics and dashboards that answer key questions:

How many Macie findings are being generated daily? What's the remediation success rate? Which finding types cause remediation failures? Are there edge cases your function isn't handling correctly?

Set up CloudWatch alarms that trigger if remediation functions fail repeatedly or if high-severity findings aren't being remediated within your target timeframe. Integrate these alarms with your on-call rotation so your team is immediately aware of problems.

Additionally, conduct periodic reviews of your remediation rules and Lambda code. As your environment evolves, as you adopt new applications or data types, update your rules to handle new scenarios. A rule that works perfectly for one type of sensitive data might miss emerging risks.

### Conclusion

Macie finds sensitive data risks, but the real security value emerges when you integrate it with Security Hub for centralized visibility and EventBridge plus Lambda for automated response. This combination transforms reactive, manual security operations into a proactive, intelligent system that catches and corrects problems at machine speed.

The pipeline we've discussed—detecting sensitive data exposure, centralizing findings, routing to remediation functions, and notifying stakeholders—represents a mature approach to cloud data governance. By implementing these patterns in your environment, you shift from spending time investigating and manually fixing security issues to spending time building resilience and preventing issues from occurring in the first place.

Start small: build a single remediation rule for your highest-risk scenario (perhaps publicly accessible buckets containing sensitive data), test it thoroughly, then expand to other finding types. Each remediation rule you add compounds the security value, and over time, your automated system becomes indispensable to your security posture.
