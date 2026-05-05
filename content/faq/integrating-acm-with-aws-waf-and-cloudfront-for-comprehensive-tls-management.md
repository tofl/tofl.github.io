---
title: "Integrating ACM with AWS WAF and CloudFront for Comprehensive TLS Management"
---

## Integrating ACM with AWS WAF and CloudFront for Comprehensive TLS Management

Every modern web application needs encryption, but managing TLS certificates across a distributed infrastructure can quickly become a maintenance nightmare. You're juggling expiration dates, provisioning new certificates when old ones are about to expire, and coordinating deployments across multiple edge locations. AWS provides elegant solutions to this problem through a tightly integrated ecosystem: AWS Certificate Manager (ACM) handles certificate lifecycle management, CloudFront delivers your content securely at scale, and AWS WAF protects your distribution from common attacks. When these three services work together, you gain not just security, but operational simplicity and peace of mind.

This article walks you through the complete TLS management journey—from requesting your first certificate in ACM, through integrating it with CloudFront, configuring WAF rules to enforce security policies, and finally, automating the monitoring that keeps your certificates valid and your applications available.

### Understanding the TLS Lifecycle and Why It Matters

Before diving into implementation, let's establish why this integration matters. Traditional TLS certificate management requires you to:

Generate a certificate signing request, wait for a certificate authority to validate and issue it, download the certificate and private key, install them on your servers, renew them before they expire (typically every year), and coordinate the renewal across all your infrastructure. One missed renewal, and your users see the dreaded browser warning—or worse, your application becomes unreachable for secure traffic.

ACM changes this equation. Instead of managing certificates yourself, ACM provisions them from trusted certificate authorities, handles automatic renewal starting 60 days before expiration, and eliminates the need to manage private keys directly. When ACM integrates with CloudFront, your distribution automatically uses the renewed certificate without any manual intervention or downtime.

This integration is particularly valuable because CloudFront sits at the edge of the AWS network, serving requests from over 600 edge locations worldwide. Managing certificates for all those locations manually would be impractical; ACM and CloudFront handle the complexity behind the scenes.

### Requesting an ACM Certificate

The journey begins in the ACM console or via the AWS CLI. You're requesting a publicly trusted certificate that certificate authorities will validate before issuing. ACM primarily uses Amazon's partnership with certificate authorities to issue certificates for free—you pay nothing for the certificate itself, only for the resources that use it.

When you request a certificate through ACM, you specify the domain names it should cover. You might request a certificate for `example.com` and `www.example.com`, or you could use a wildcard like `*.example.com` to cover all subdomains. ACM validates that you actually own or control those domains, typically through email validation or DNS record validation.

Here's how you request a certificate using the AWS CLI:

```bash
aws acm request-certificate \
  --domain-name example.com \
  --subject-alternative-names www.example.com \
  --validation-method DNS \
  --region us-east-1
```

The response includes a certificate ARN (Amazon Resource Name) that you'll use to attach this certificate to CloudFront. The validation method is important: DNS validation automates the process by having you add a CNAME record to your domain's DNS configuration, while email validation sends confirmation emails to standard addresses associated with your domain.

Once you select DNS validation, ACM provides the DNS records you need to create. Add these records to your DNS provider—whether that's Route 53, your registrar, or a third-party DNS service. ACM automatically detects these records and validates your domain ownership, then issues the certificate. This typically happens within minutes.

The beauty of DNS validation is that it's completely automatable. You can script the DNS record creation and have ACM validate and issue the certificate as part of your infrastructure-as-code pipeline. Email validation requires manual intervention—someone needs to click the validation link—making it less suitable for fully automated deployments.

### The Critical us-east-1 Requirement for CloudFront

Here's a detail that trips up many developers: ACM certificates used with CloudFront must be requested in the us-east-1 region, even if your actual origin servers run elsewhere. This quirk exists because CloudFront is a global service, and AWS stores CloudFront-related certificates in us-east-1 for historical and architectural reasons.

If you're working in a different region, you'll notice that CloudFront certificate options in other regions appear grayed out or unavailable. Don't try to work around this by creating certificates in other regions—they simply won't appear in CloudFront's certificate dropdown.

This is a one-time setup detail, but it's crucial. When you're building your infrastructure-as-code templates (whether using CloudFormation, Terraform, or another tool), ensure that your ACM certificate resource specifies `us-east-1` explicitly:

```bash
aws acm request-certificate \
  --domain-name example.com \
  --region us-east-1
```

After the certificate is issued and you're ready to attach it to CloudFront, you reference the certificate ARN in your CloudFront distribution configuration. The certificate can then serve traffic from all CloudFront edge locations worldwide.

### Attaching ACM Certificates to CloudFront Distributions

Once your certificate is issued and validated in ACM, attaching it to CloudFront is straightforward. You're essentially telling CloudFront: "Use this certificate when clients connect to my distribution over HTTPS."

In the CloudFront console, you navigate to your distribution and edit its settings. Under the "SSL/TLS Certificate" section, you'll see an option to request a certificate (which opens ACM) or to use an existing certificate. Select your issued certificate from the dropdown, which displays certificates by domain name for easy identification.

Here's the equivalent via AWS CLI using a distribution configuration:

```bash
aws cloudfront create-distribution \
  --distribution-config file://distribution-config.json
```

Your `distribution-config.json` would include:

```json
{
  "CallerReference": "my-distribution-ref-001",
  "Comment": "My secure CloudFront distribution",
  "DefaultRootObject": "index.html",
  "Origins": {
    "Quantity": 1,
    "Items": [
      {
        "Id": "my-origin",
        "DomainName": "origin.example.com",
        "CustomOriginConfig": {
          "HTTPPort": 80,
          "HTTPSPort": 443,
          "OriginProtocolPolicy": "https-only"
        }
      }
    ]
  },
  "ViewerProtocolPolicy": "redirect-to-https",
  "Enabled": true,
  "ViewerCertificate": {
    "ACMCertificateArn": "arn:aws:acm:us-east-1:123456789012:certificate/12345678-1234-1234-1234-123456789012",
    "SSLSupportMethod": "sni-only",
    "MinimumProtocolVersion": "TLSv1.2_2021"
  }
}
```

Notice the `ViewerCertificate` section, which specifies the ACM certificate ARN, the SSL support method (SNI-only is modern and cost-effective), and the minimum TLS protocol version. Setting `MinimumProtocolVersion` to TLSv1.2 or higher ensures you're not supporting outdated, vulnerable protocol versions.

When you attach the certificate, CloudFront distributes it across its global edge location network. Now, when clients visit your CloudFront domain (like `d1234567890.cloudfront.net`) or your custom domain (like `example.com`), they receive this certificate and establish encrypted connections.

### Enforcing HTTPS with WAF Rules

Having TLS certificates in place is only the first part of the security equation. You also need to enforce that clients actually use HTTPS instead of falling back to unencrypted HTTP. AWS WAF, integrated with CloudFront, lets you create rules that enforce this policy and protect against common attacks simultaneously.

AWS WAF is a web application firewall that sits in front of CloudFront and evaluates incoming requests against rules you define. You can create rules that block traffic based on IP addresses, geographic location, request headers, request size, SQL injection patterns, cross-site scripting patterns, and much more.

For enforcing HTTPS, you create a rule that blocks any request arriving via HTTP. Here's the logic: if a request's protocol is not HTTPS, block it. Let's create a web ACL (the container for WAF rules) that enforces this:

```bash
aws wafv2 create-web-acl \
  --name enforce-https \
  --scope CLOUDFRONT \
  --default-action Block={} \
  --rules file://rules.json \
  --visibility-config SampledRequestsEnabled=true,CloudWatchMetricsEnabled=true,MetricName=enforce-https-metrics \
  --region us-east-1
```

Your `rules.json` might look like:

```json
[
  {
    "Name": "AllowHTTPSOnly",
    "Priority": 0,
    "Statement": {
      "ByteMatchStatement": {
        "FieldToMatch": {
          "SingleHeader": {
            "Name": "cloudfront-forwarded-proto"
          }
        },
        "TextTransformation": [
          {
            "Priority": 0,
            "Type": "NONE"
          }
        ],
        "PositionalConstraint": "EXACTLY",
        "SearchString": "https"
      }
    },
    "Action": {
      "Allow": {}
    },
    "VisibilityConfig": {
      "SampledRequestsEnabled": true,
      "CloudWatchMetricsEnabled": true,
      "MetricName": "AllowHTTPSOnlyMetric"
    }
  }
]
```

This rule allows requests where the `cloudfront-forwarded-proto` header is exactly "https" and blocks everything else. CloudFront automatically adds this header, so any HTTP request will be blocked.

Beyond HTTPS enforcement, you might layer additional WAF rules to protect against common threats. For example, you could add rules that block requests with suspicious SQL patterns (protecting against SQL injection), block common XSS attack vectors, rate-limit requests from a single IP (protecting against brute force attacks), or block requests from known malicious IP ranges.

After creating your web ACL, you associate it with your CloudFront distribution. This is done in the CloudFront distribution settings under "WAF and Shield" or via CLI:

```bash
aws cloudfront update-distribution \
  --id DISTRIBUTION_ID \
  --distribution-config file://updated-config.json
```

The updated configuration includes:

```json
{
  "WebACLId": "arn:aws:wafv2:us-east-1:123456789012:global/webacl/enforce-https/a1234567-b890-c123-d456-e78901234567"
}
```

Once the WAF web ACL is associated, CloudFront evaluates every incoming request against your rules before processing it. Blocked requests receive a 403 Forbidden response, and allowed requests proceed normally.

### Automatic Certificate Renewal and Why It Matters

One of ACM's most valuable features is automatic renewal. Unlike traditional certificate authorities that require you to manually renew before expiration, ACM automatically renews your certificates starting 60 days before they expire. You don't need to do anything—ACM handles the renewal process in the background, validates domain ownership using the same method you originally chose (DNS or email), and replaces the certificate in your account.

This automatic renewal applies to any CloudFront distributions using that certificate. The renewed certificate is automatically available to all edge locations without any downtime or redeployment required.

But here's the important part: this automation only works if your domain ownership validation stays valid. If you chose DNS validation, the CNAME records must remain in place. If those records are deleted, ACM can't renew your certificate, and it will eventually expire.

This is why understanding the integration is crucial. You're not just getting a certificate—you're getting a commitment that as long as you maintain domain validation, your certificate will never expire. CloudFront will always have a valid certificate to serve to your users.

To check the renewal status of your certificate, you can inspect it in the ACM console or via CLI:

```bash
aws acm describe-certificate \
  --certificate-arn arn:aws:acm:us-east-1:123456789012:certificate/12345678-1234-1234-1234-123456789012 \
  --region us-east-1
```

This returns details including the expiration date, renewal status, and domain validation records. In the response, look for the `RenewalEligibility` field (which shows whether the certificate is eligible for renewal) and `Serial` (which changes when the certificate is renewed).

### Monitoring Certificate Status with CloudWatch

While automatic renewal removes most of the operational burden, you still want visibility into your certificate status. What if domain validation fails? What if something unexpected happens? CloudWatch metrics and alarms give you that visibility.

ACM publishes certificate status information that you can monitor. Additionally, CloudFront publishes metrics about your distribution's SSL/TLS usage. You can create CloudWatch alarms that notify you if anything goes wrong—for example, if a certificate's renewal fails or if renewal-related validation stops working.

Create a custom metric using CloudWatch Events (now EventBridge) and Lambda. EventBridge can trigger a Lambda function periodically to check certificate status and publish metrics to CloudWatch:

```python
import boto3
import json
from datetime import datetime, timedelta

acm_client = boto3.client('acm', region_name='us-east-1')
cloudwatch = boto3.client('cloudwatch')

def lambda_handler(event, context):
    certificate_arn = 'arn:aws:acm:us-east-1:123456789012:certificate/12345678-1234-1234-1234-123456789012'
    
    response = acm_client.describe_certificate(CertificateArn=certificate_arn)
    cert = response['Certificate']
    
    # Calculate days until expiration
    expiration_date = cert['NotAfter']
    days_remaining = (expiration_date - datetime.now(expiration_date.tzinfo)).days
    
    # Publish metric
    cloudwatch.put_metric_data(
        Namespace='CertificateMonitoring',
        MetricData=[
            {
                'MetricName': 'DaysUntilCertificateExpiration',
                'Value': days_remaining,
                'Unit': 'Count',
                'Timestamp': datetime.utcnow()
            }
        ]
    )
    
    # Check renewal eligibility
    renewal_eligible = cert.get('RenewalEligibility', 'INELIGIBLE') == 'ELIGIBLE'
    cloudwatch.put_metric_data(
        Namespace='CertificateMonitoring',
        MetricData=[
            {
                'MetricName': 'CertificateRenewalEligible',
                'Value': 1 if renewal_eligible else 0,
                'Unit': 'Count',
                'Timestamp': datetime.utcnow()
            }
        ]
    )
    
    return {
        'statusCode': 200,
        'body': json.dumps(f'Certificate expires in {days_remaining} days')
    }
```

You'd schedule this Lambda function to run daily or weekly using EventBridge:

```bash
aws events put-rule \
  --name check-certificate-status \
  --schedule-expression "rate(1 day)" \
  --state ENABLED
```

Then create alarms based on these metrics. For example, alert if days remaining drops below 30 (which shouldn't happen with automatic renewal, but alerts catch the unexpected):

```bash
aws cloudwatch put-metric-alarm \
  --alarm-name certificate-expiration-warning \
  --alarm-description "Alert if certificate expires soon" \
  --metric-name DaysUntilCertificateExpiration \
  --namespace CertificateMonitoring \
  --statistic Minimum \
  --period 300 \
  --threshold 30 \
  --comparison-operator LessThanThreshold \
  --evaluation-periods 1 \
  --alarm-actions arn:aws:sns:us-east-1:123456789012:certificate-alerts
```

This alarm triggers if the metric shows fewer than 30 days remaining, sending an SNS notification to your team. You could also create an alarm monitoring renewal eligibility, alerting if a certificate becomes ineligible (which might indicate domain validation issues).

CloudWatch Logs Insights can also help you analyze WAF logs to understand traffic patterns and ensure your HTTPS-enforcement rules are working as expected:

```
fields @timestamp, action, httpRequest.protocol
| filter httpRequest.protocol = "HTTP"
| stats count() by action
```

This query shows how many HTTP requests were blocked by your WAF rules, confirming that HTTPS enforcement is active.

### Automating About-to-Expire Detection

Beyond basic monitoring, you can implement sophisticated automation that proactively detects certificate renewal issues before they become problems. The key is automating the detection of edge cases—for instance, when a certificate's renewal hasn't completed, or when domain validation is failing.

Create a Lambda function that checks not just the certificate expiration, but also the renewal status in detail:

```python
import boto3
from datetime import datetime, timedelta

acm_client = boto3.client('acm', region_name='us-east-1')
sns_client = boto3.client('sns')

def check_certificate_renewal_status(certificate_arn):
    response = acm_client.describe_certificate(CertificateArn=certificate_arn)
    cert = response['Certificate']
    
    status = cert['Status']
    expiration = cert['NotAfter']
    days_remaining = (expiration - datetime.now(expiration.tzinfo)).days
    
    issues = []
    
    # Check if certificate will expire within 45 days and renewal hasn't started
    if days_remaining < 45 and status != 'ISSUED':
        issues.append(f"Certificate expires in {days_remaining} days but renewal hasn't completed")
    
    # Check if domain validation is failing
    if 'DomainValidationOptions' in cert:
        for option in cert['DomainValidationOptions']:
            if option.get('ValidationStatus') != 'SUCCESS':
                issues.append(f"Domain {option['DomainName']} validation status: {option.get('ValidationStatus')}")
    
    # Check if certificate is pending issuance
    if status == 'PENDING_VALIDATION':
        issues.append("Certificate is pending validation - domain ownership validation may not be complete")
    
    return {
        'healthy': len(issues) == 0,
        'days_remaining': days_remaining,
        'status': status,
        'issues': issues
    }

def lambda_handler(event, context):
    certificate_arn = 'arn:aws:acm:us-east-1:123456789012:certificate/12345678-1234-1234-1234-123456789012'
    
    result = check_certificate_renewal_status(certificate_arn)
    
    if not result['healthy']:
        message = f"""Certificate Health Check Failed

Certificate ARN: {certificate_arn}
Days Remaining: {result['days_remaining']}
Status: {result['status']}

Issues Detected:
{chr(10).join(['- ' + issue for issue in result['issues']])}

Please investigate immediately.
"""
        sns_client.publish(
            TopicArn='arn:aws:sns:us-east-1:123456789012:certificate-alerts',
            Subject='Certificate Health Check Failed',
            Message=message
        )
    
    return result
```

Schedule this to run every 3-7 days so you get early warning of any issues. The combination of basic metrics, detailed status checks, and proactive alerting ensures that no certificate surprise catches your team off-guard.

### Putting It All Together: A Complete Example

Let's walk through a realistic scenario: you're deploying a new web application and want to ensure it's secure from day one, with HTTPS enforced and certificates managed automatically.

First, request the ACM certificate in us-east-1:

```bash
aws acm request-certificate \
  --domain-name myapp.example.com \
  --subject-alternative-names www.myapp.example.com \
  --validation-method DNS \
  --region us-east-1
```

ACM returns a certificate ARN. Go to your DNS provider and add the validation CNAME record. Within minutes, ACM validates and issues the certificate.

Next, create a CloudFront distribution with the certificate attached. Instead of using the console, you might use infrastructure-as-code. Here's a CloudFormation template (simplified for clarity):

```yaml
Resources:
  MyDistribution:
    Type: AWS::CloudFront::Distribution
    Properties:
      DistributionConfig:
        Enabled: true
        Origins:
          - Id: myOrigin
            DomainName: origin.example.com
            CustomOriginConfig:
              HTTPPort: 80
              HTTPSPort: 443
              OriginProtocolPolicy: https-only
        DefaultCacheBehavior:
          AllowedMethods:
            - GET
            - HEAD
            - OPTIONS
          TargetOriginId: myOrigin
          ViewerProtocolPolicy: redirect-to-https
          ForwardedValues:
            QueryString: false
        ViewerCertificate:
          AcmCertificateArn: arn:aws:acm:us-east-1:123456789012:certificate/12345678-1234-1234-1234-123456789012
          SslSupportMethod: sni-only
          MinimumProtocolVersion: TLSv1.2_2021
        WebACLId: arn:aws:wafv2:us-east-1:123456789012:global/webacl/enforce-https/a1234567-b890-c123-d456-e78901234567

  HttpsEnforcementWebAcl:
    Type: AWS::WAFv2::WebACL
    Properties:
      Scope: CLOUDFRONT
      DefaultAction:
        Block: {}
      Rules:
        - Name: AllowHTTPSOnly
          Priority: 0
          Action:
            Allow: {}
          Statement:
            ByteMatchStatement:
              FieldToMatch:
                SingleHeader:
                  Name: cloudfront-forwarded-proto
              TextTransformation:
                - Priority: 0
                  Type: NONE
              PositionalConstraint: EXACTLY
              SearchString: https
          VisibilityConfig:
            SampledRequestsEnabled: true
            CloudWatchMetricsEnabled: true
            MetricName: AllowHTTPSOnly
      VisibilityConfig:
        SampledRequestsEnabled: true
        CloudWatchMetricsEnabled: true
        MetricName: HttpsEnforcement
```

Deploy this template, and your infrastructure is created with HTTPS enforcement active. The certificate is automatically renewed by ACM, CloudFront serves encrypted traffic from edge locations worldwide, and WAF blocks any unencrypted requests.

Finally, set up monitoring. Create an EventBridge rule to trigger your certificate status Lambda function daily, and configure CloudWatch alarms to notify you if anything goes wrong. You now have complete visibility and automation across your entire TLS lifecycle.

### Conclusion

Integrating ACM, CloudFront, and WAF creates a modern, secure, and operationally simple approach to TLS management. ACM eliminates manual certificate renewal, CloudFront distributes your content securely at scale with minimal latency, and WAF ensures that all traffic is encrypted and protected from common attacks.

The us-east-1 requirement for ACM certificates might seem like an arbitrary constraint, but it's a small price for the massive operational benefit of automatic certificate renewal across a global CDN. Once you understand this integration, setting it up is straightforward, and you gain years of uninterrupted secure operation without touching certificate management again.

The monitoring and automation layer you add on top ensures that even this well-oiled machine has visibility and alerting. You're not just securing your application—you're building a system that stays secure without ongoing manual effort, freeing your team to focus on building features instead of managing infrastructure.
