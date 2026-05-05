---
title: "Monitoring ACM Certificate Expiration: CloudWatch Events, SNS Alerts, and Automated Renewal"
---

## Monitoring ACM Certificate Expiration: CloudWatch Events, SNS Alerts, and Automated Renewal

SSL/TLS certificates are the backbone of secure communication on the internet. Yet organizations routinely discover their certificates have expired only when users start seeing browser warnings or services go offline. This scenario is entirely preventable through proactive monitoring, yet it remains surprisingly common in production environments. The good news is that AWS Certificate Manager (ACM) provides built-in mechanisms to detect expiration events early, and with a little integration work, you can build a robust monitoring and renewal pipeline that keeps your certificates current with minimal manual intervention.

In this guide, we'll explore how to set up comprehensive certificate lifecycle management using ACM, CloudWatch Events (now called EventBridge), SNS notifications, and automated renewal where applicable. By the end, you'll understand the different renewal behaviors depending on your certificate type, how to construct effective monitoring rules, and how to integrate alerts into your incident management workflow.

### Understanding ACM Certificates and Their Lifecycle

AWS Certificate Manager makes it easier to provision, manage, and deploy SSL/TLS certificates. However, the renewal process and expiration behavior differ significantly depending on whether you're working with ACM-issued public certificates or private certificates issued by your own certificate authority.

**Public certificates issued by ACM** are the simplest scenario from a renewal perspective. When you request a certificate from ACM for a domain you control, ACM handles the validation and issuance. Here's the critical part: if you've configured DNS validation (the recommended approach), ACM will automatically renew your certificate 60 days before expiration. You don't need to do anything—the renewal happens in the background. However, this automatic renewal only works if you maintain the DNS validation records that ACM created during the initial issuance.

**Private certificates issued through ACM Private CA** follow a different model. These certificates are issued by your own certificate authority within AWS, and they don't renew automatically. You're responsible for requesting new certificates before the current ones expire. This requires either manual renewal requests or an automated process that detects approaching expiration and requests a new certificate.

The distinction is important: public certificates can largely fend for themselves if properly configured, but private CA certificates demand active monitoring and renewal logic.

### How ACM Communicates Expiration Events

ACM sends expiration notifications through CloudWatch Events (EventBridge) in the form of events that you can capture, filter, and route to various destinations. Understanding the structure of these events is the first step toward building effective monitoring.

When ACM detects that a certificate is approaching expiration—typically 45, 30, and 7 days before expiration—it emits an event to the default EventBridge event bus. The event looks something like this in its JSON structure:

```json
{
  "version": "0",
  "id": "1234abcd-12ab-34cd-56ef-1234567890ab",
  "detail-type": "ACM Certificate Approaching Expiration",
  "source": "aws.acm",
  "account": "123456789012",
  "time": "2024-01-15T14:32:00Z",
  "region": "us-east-1",
  "resources": [
    "arn:aws:acm:us-east-1:123456789012:certificate/12345678-1234-1234-1234-123456789012"
  ],
  "detail": {
    "DaysToExpiry": 45,
    "CommonName": "example.com",
    "Serial": "01:23:45:67:89:ab:cdef:01:23:45:67:89:abcd:ef",
    "FailureReason": null,
    "EventName": "Certificate Approaching Expiration",
    "arn": "arn:aws:acm:us-east-1:123456789012:certificate/12345678-1234-1234-1234-123456789012"
  }
}
```

This event contains everything you need: the certificate ARN, the domain name (CommonName), how many days remain before expiration, and the specific region. The `FailureReason` field is particularly useful—if a certificate couldn't renew (for instance, DNS validation records were removed), that information appears here.

One thing to note: ACM emits these events only for certificates that are stored in ACM. If you're using certificates from other sources (self-signed, third-party CAs stored in AWS Secrets Manager or Parameter Store), you won't get these automatic events. However, you can still build monitoring around those certificates using custom Lambda functions that check expiration dates on a schedule.

### Setting Up EventBridge Rules for Certificate Monitoring

The foundation of your monitoring solution is an EventBridge rule that captures ACM expiration events and routes them where they're needed. Creating this rule is straightforward but requires clear thinking about your routing strategy.

First, let's create a rule that captures all ACM certificate expiration events. You can do this through the AWS Console or via the AWS CLI. Here's how you'd create it with the CLI:

```bash
aws events put-rule \
  --name acm-certificate-expiration \
  --event-pattern '{
    "source": ["aws.acm"],
    "detail-type": ["ACM Certificate Approaching Expiration"]
  }' \
  --state ENABLED
```

This rule matches any event from the ACM service with the "Certificate Approaching Expiration" detail type. The beauty of EventBridge rules is that they're flexible—you can add additional conditions if you want to filter by specific domains, regions, or days-to-expiry thresholds.

For example, if you want to trigger alerts only when a certificate has 7 or fewer days remaining, you could refine the pattern:

```bash
aws events put-rule \
  --name acm-certificate-critical-expiration \
  --event-pattern '{
    "source": ["aws.acm"],
    "detail-type": ["ACM Certificate Approaching Expiration"],
    "detail": {
      "DaysToExpiry": [{"numeric": ["<=", 7]}]
    }
  }' \
  --state ENABLED
```

Once your rule is created, you need to attach targets—destinations where the events will be sent. The most common target for this scenario is an SNS topic, which can then forward notifications to your team.

### Routing Alerts Through SNS and Incident Management Tools

SNS (Simple Notification Service) is the natural choice for distributing certificate expiration alerts to your team. An SNS topic acts as a message broker, accepting events from EventBridge and distributing them to multiple subscribers via email, SMS, HTTP webhooks, or Lambda functions.

Here's how to create an SNS topic and configure it as a target for your EventBridge rule:

```bash
# Create the SNS topic
aws sns create-topic --name acm-certificate-alerts

# Add the SNS topic as a target to your EventBridge rule
aws events put-targets \
  --rule acm-certificate-expiration \
  --targets "Id"="1","Arn"="arn:aws:sns:us-east-1:123456789012:acm-certificate-alerts"
```

Now, when a certificate approaches expiration, the event flows through EventBridge to the SNS topic. But raw SNS notifications in email can get lost in inboxes. Modern teams route these alerts into incident management platforms like PagerDuty, Slack, or Opsgenie, where they're centralized and can trigger on-call escalations.

If you want to send alerts to Slack, you'd subscribe an HTTP endpoint (typically a Slack webhook URL or a Lambda function that formats the message) to your SNS topic. Here's a simple Lambda function that transforms the ACM event into a Slack message:

```python
import json
import urllib3
import os

http = urllib3.PoolManager()

def lambda_handler(event, context):
    # Parse the SNS message
    message = json.loads(event['Records'][0]['Sns']['Message'])
    
    # Extract relevant details
    detail = message['detail']
    common_name = detail.get('CommonName', 'Unknown')
    days_to_expiry = detail.get('DaysToExpiry', 'Unknown')
    certificate_arn = detail.get('arn', 'Unknown')
    
    # Format the Slack message
    slack_message = {
        "blocks": [
            {
                "type": "header",
                "text": {
                    "type": "plain_text",
                    "text": "⚠️ ACM Certificate Expiration Alert"
                }
            },
            {
                "type": "section",
                "fields": [
                    {
                        "type": "mrkdwn",
                        "text": f"*Domain:*\n{common_name}"
                    },
                    {
                        "type": "mrkdwn",
                        "text": f"*Days to Expiry:*\n{days_to_expiry}"
                    },
                    {
                        "type": "mrkdwn",
                        "text": f"*Certificate ARN:*\n{certificate_arn}"
                    }
                ]
            }
        ]
    }
    
    # Send to Slack
    slack_webhook_url = os.environ['SLACK_WEBHOOK_URL']
    encoded_msg = json.dumps(slack_message).encode('utf-8')
    resp = http.request('POST', slack_webhook_url, body=encoded_msg)
    
    return {
        'statusCode': 200,
        'body': json.dumps('Slack notification sent')
    }
```

To use this Lambda, you'd subscribe it to your SNS topic, set the `SLACK_WEBHOOK_URL` environment variable with your Slack incoming webhook, and let it run whenever a certificate expiration event occurs. The result is a formatted, clickable alert in your Slack channel that includes the domain, days remaining, and ARN for quick reference.

For PagerDuty integration, you can use PagerDuty's SNS integration directly by subscribing the PagerDuty integration endpoint to your SNS topic, or use a similar Lambda-based approach to format events according to PagerDuty's event schema.

### Automating Public Certificate Renewal

Public certificates issued by ACM with DNS validation are the low-maintenance option, but only if you understand what keeps them renewed.

When you create a public certificate in ACM, you choose between DNS validation and email validation. DNS validation is superior because it's fully automated. ACM creates a CNAME record that you place in your domain's DNS provider. As long as that record exists, ACM will automatically renew the certificate 60 days before expiration.

Here's the catch: if someone removes or modifies that DNS validation record—perhaps during a migration, DNS cleanup, or accidental misconfiguration—the renewal fails silently. The certificate continues to exist in ACM until it expires, at which point services fail. This is where monitoring becomes critical.

When automatic renewal fails, ACM emits an event with a `FailureReason` field indicating what went wrong. A typical failure reason might be "Failed to validate domain ownership via DNS." By monitoring for events where `FailureReason` is not null, you catch renewal problems before they become outages.

You can refine your EventBridge rule to specifically target renewal failures:

```bash
aws events put-rule \
  --name acm-certificate-renewal-failure \
  --event-pattern '{
    "source": ["aws.acm"],
    "detail-type": ["ACM Certificate Approaching Expiration"],
    "detail": {
      "FailureReason": [{"exists": true}]
    }
  }' \
  --state ENABLED
```

This rule catches only events where a failure reason is present, indicating that automatic renewal didn't work. These are your critical alerts—they demand immediate investigation and remediation.

For truly critical public certificates, you might implement a Lambda function that periodically checks the certificate status and validates that the DNS records are in place, but for most cases, monitoring the ACM events is sufficient.

### Automating Private CA Certificate Renewal

Private certificates are where automation becomes more complex. Unlike public certificates, ACM doesn't automatically renew private CA certificates. You must request a new certificate before the old one expires, and this requires an active renewal process.

The typical workflow is: (1) detect that a certificate is approaching expiration, (2) request a new certificate from your private CA, (3) deploy the new certificate to the services that use it, and (4) revoke the old certificate.

This is where Lambda becomes your ally. You can create a Lambda function triggered by an SNS notification (from your EventBridge rule) that automatically requests a new certificate:

```python
import boto3
import json

acm_client = boto3.client('acm')
acm_pca_client = boto3.client('acm-pca')

def lambda_handler(event, context):
    # Parse the SNS message containing the expiring certificate details
    message = json.loads(event['Records'][0]['Sns']['Message'])
    detail = message['detail']
    
    certificate_arn = detail.get('arn')
    common_name = detail.get('CommonName')
    
    # Retrieve the current certificate to get its configuration
    cert_details = acm_client.describe_certificate(CertificateArn=certificate_arn)
    
    # Extract the Private CA ARN (this should be stored in your certificate metadata or config)
    # For this example, we'll assume it's passed as an environment variable
    private_ca_arn = os.environ.get('PRIVATE_CA_ARN')
    
    try:
        # Request a new certificate from the Private CA
        response = acm_pca_client.issue_certificate(
            CertificateAuthorityArn=private_ca_arn,
            Csr=create_csr(common_name),  # You'd need a function to generate a CSR
            SigningAlgorithm='SHA256WITHRSA',
            Validity={
                'Value': 365,
                'Type': 'DAYS'
            }
        )
        
        certificate_id = response['CertificateArn']
        
        # Log the successful request
        print(f"New certificate requested for {common_name}: {certificate_id}")
        
        # Send a notification that renewal was triggered
        sns_client = boto3.client('sns')
        sns_client.publish(
            TopicArn=os.environ.get('SNS_TOPIC_ARN'),
            Subject=f"Private CA Renewal Triggered for {common_name}",
            Message=f"A new certificate has been requested from the Private CA. Certificate ID: {certificate_id}"
        )
        
        return {'statusCode': 200, 'body': 'Renewal initiated successfully'}
        
    except Exception as e:
        print(f"Error initiating renewal: {str(e)}")
        # Send an alert that renewal failed
        sns_client = boto3.client('sns')
        sns_client.publish(
            TopicArn=os.environ.get('SNS_TOPIC_ARN'),
            Subject=f"Private CA Renewal Failed for {common_name}",
            Message=f"Automatic renewal failed: {str(e)}"
        )
        return {'statusCode': 500, 'body': 'Renewal failed'}
```

This function listens for expiration events and automatically kicks off the renewal process. However, there's an important caveat: requesting the certificate is only step one. You still need to deploy it to the systems that use it, and this part typically requires service-specific logic. For example, if the certificate is used by an Application Load Balancer, you'd need to update the listener configuration to use the new certificate.

Many teams handle this part with a post-renewal workflow: once the new certificate is issued and available in ACM, a deployment pipeline or Lambda function updates all resources that reference the old certificate. This might involve updating load balancer listeners, CloudFront distributions, API Gateways, or other services.

### Building a Comprehensive Monitoring Dashboard

While SNS alerts keep your team informed of imminent expirations, a dashboard provides visibility into the overall certificate health across your organization. CloudWatch Dashboards can aggregate ACM certificate data and give you a high-level view of what's coming due.

You can create custom metrics that track certificate expiration dates. One approach is to run a Lambda function on a schedule (say, daily) that lists all your ACM certificates, calculates days to expiration, and publishes custom metrics to CloudWatch:

```python
import boto3
from datetime import datetime

acm_client = boto3.client('acm')
cloudwatch = boto3.client('cloudwatch')

def lambda_handler(event, context):
    # List all ACM certificates
    paginator = acm_client.get_paginator('list_certificates')
    
    for page in paginator.paginate():
        for cert in page['CertificateSummaryList']:
            cert_arn = cert['CertificateArn']
            
            # Get full certificate details
            cert_details = acm_client.describe_certificate(CertificateArn=cert_arn)
            
            # Calculate days to expiration
            expiration_date = cert_details['Certificate']['NotAfter']
            days_to_expiry = (expiration_date - datetime.now(expiration_date.tzinfo)).days
            
            # Publish a custom metric
            cloudwatch.put_metric_data(
                Namespace='ACM/Certificates',
                MetricData=[
                    {
                        'MetricName': 'DaysToExpiration',
                        'Value': days_to_expiry,
                        'Dimensions': [
                            {
                                'Name': 'CertificateArn',
                                'Value': cert_arn
                            },
                            {
                                'Name': 'DomainName',
                                'Value': cert_details['Certificate']['DomainName']
                            }
                        ]
                    }
                ]
            )
    
    return {'statusCode': 200}
```

Once these metrics are in CloudWatch, you can create a dashboard showing all certificates, sorted by days remaining. You can set alarms on these metrics to trigger additional notifications if certificates enter critical warning thresholds.

### Handling Edge Cases and Special Scenarios

Real-world certificate management often involves scenarios beyond the standard public/private CA split. Here are some common complications and how to address them:

**Certificates imported from third parties:** If you import certificates from an external CA into ACM (rather than requesting them from ACM), ACM doesn't track or renew them. You can still view them in ACM and use them with AWS services, but you're responsible for renewal elsewhere. For these certificates, implement a separate monitoring process—either check expiration dates manually on a schedule or use a third-party certificate monitoring tool that integrates with your infrastructure.

**Certificates with validation failures:** Sometimes DNS validation records are accidentally deleted, or a domain registrar changes without updating ACM's records. When this happens, ACM's automatic renewal fails. Your monitoring should escalate these events to your infrastructure team immediately, as they require manual intervention. A quick fix often involves re-validating the certificate or requesting a new one with valid DNS records.

**Multi-domain and wildcard certificates:** ACM supports Subject Alternative Names (SANs) and wildcard certificates. When monitoring these, remember that a single certificate covers multiple domains. An event for a wildcard certificate like `*.example.com` will cover all subdomains, but if you're managing many such certificates, your dashboard and alerts need to clearly show which domains are covered by each certificate to avoid confusion.

**Regional considerations:** ACM certificates are region-specific. If you use the same certificate in multiple regions, you'll need to request and monitor certificates in each region separately. This is one of the reasons many teams use CloudFront with global certificate distribution—it reduces the management burden.

### Testing Your Monitoring Setup

Before relying on your monitoring in production, test it thoroughly. You don't want to discover that your alerts aren't working when a certificate actually expires.

For testing EventBridge rules, you can manually send test events that match your rule patterns:

```bash
aws events put-events \
  --entries '[
    {
      "Source": "aws.acm",
      "DetailType": "ACM Certificate Approaching Expiration",
      "Detail": "{\"DaysToExpiry\": 7, \"CommonName\": \"test.example.com\", \"arn\": \"arn:aws:acm:us-east-1:123456789012:certificate/test\", \"Serial\": \"01:23:45\", \"FailureReason\": null, \"EventName\": \"Certificate Approaching Expiration\"}"
    }
  ]'
```

This sends a synthetic event through your EventBridge rule, allowing you to verify that the rule matches correctly and targets receive notifications. Similarly, you can test your Lambda functions with sample SNS events and verify that Slack messages or PagerDuty incidents are created as expected.

Document your test results and include them in your runbooks. A well-documented test procedure ensures that future team members can validate the monitoring setup when they take over certificate management responsibilities.

### Best Practices for Certificate Lifecycle Management

Several practices will save you from certificate-related headaches over the long term. First, maintain a clear inventory of all your certificates, including where they're deployed and what depends on them. A simple spreadsheet or database, regularly updated, prevents orphaned certificates and ensures no services are left without certificates during renewal.

Second, set your monitoring thresholds conservatively. Getting a 45-day warning about a certificate expiration gives you plenty of time to respond. If you wait until the 7-day alert, you're cutting it close, especially for private CA renewals that may require deployment and testing time. Many teams follow a "three-tier" alert strategy: informational at 45 days, warning at 30 days, and critical at 7 days, with increasing urgency and escalation paths.

Third, automate what you can without sacrificing safety. Public certificate renewal with DNS validation requires almost no manual intervention once configured correctly. Private CA renewal can be partially automated with Lambda functions, but the actual deployment of new certificates to services often benefits from an approval gate to catch mistakes before they affect production.

Fourth, keep your DNS validation records intact and monitored. For public ACM certificates, losing these records is the primary cause of failed renewals. Set up monitoring that periodically verifies these records exist and are properly configured.

Finally, practice your renewal process in lower environments before relying on automation in production. A certificate renewal in staging reveals problems before they impact real users.

### Conclusion

Certificate expiration doesn't have to be a crisis. By combining ACM's built-in event notifications with EventBridge rules, SNS topics, and simple integrations to incident management tools, you build a system that keeps your team informed and ahead of expiration deadlines. For public certificates with DNS validation, much of the renewal process happens automatically in the background. For private CA certificates, a modest amount of automation using Lambda can handle certificate issuance and alert your deployment processes when new certificates are ready.

The key is starting with monitoring—knowing what's coming due is the foundation of everything else. From there, you layer in alerting and escalation procedures tailored to your organization's structure. Add automation incrementally, testing each step, and document your procedures so they survive team transitions. With this framework in place, certificate management becomes routine and predictable rather than a source of firefighting and outages.
