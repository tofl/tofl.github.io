---
title: "ECR Basic Scanning vs Enhanced Scanning with Amazon Inspector"
---

## ECR Basic Scanning vs Enhanced Scanning with Amazon Inspector

Container security has become non-negotiable in modern application development. Every container image you push to your registry is a potential attack surface, and the vulnerabilities lurking in your dependencies can compromise your entire infrastructure. AWS provides two scanning modes for Amazon ECR that help you catch these issues before they reach production, but they work quite differently under the hood. Understanding which one fits your security posture—and how to integrate them into your CI/CD pipeline—is essential for building resilient applications.

### The Container Security Challenge

When you build a Docker image, you're layering together an operating system, runtime, application libraries, and your own code. Each of these layers can contain known vulnerabilities. A vulnerability in a base OS package like OpenSSL or a transitive dependency in your npm modules could sit undiscovered in your image for months until a security researcher publishes an exploit.

ECR's scanning capabilities exist to catch these vulnerabilities automatically and early. But not all vulnerabilities are equal, and not all scanning approaches catch the same things. That's where understanding the difference between basic and enhanced scanning becomes critical.

### ECR Basic Scanning: The Foundation

Basic scanning is ECR's original vulnerability detection mechanism, and it remains included with your ECR repository at no additional cost. When you enable basic scanning, ECR analyzes the operating system packages baked into your container image layers. Think of it as a focused lens on the system-level dependencies—things like glibc, curl, nginx, or PostgreSQL client libraries that come from your base image.

Here's how it works in practice. You push an image to ECR, and the service immediately performs a static analysis of the image layers. It reads the package manifests from the operating system (focusing primarily on binaries and OS-level libraries) and cross-references them against a vulnerability database maintained by AWS. Within a few minutes, you'll have a scan result showing any known CVEs affecting those packages.

The database behind basic scanning is curated and updated regularly, but it's fundamentally limited to what can be detected through static analysis of OS-level packages. When you run `docker build` with a base image like `ubuntu:22.04` or `amazonlinux:2`, those underlying packages are what basic scanning targets. If your base image has 50 OS packages and three of them have known vulnerabilities, basic scanning will find them.

The pricing model for basic scanning is straightforward: it's free. Every ECR repository can perform unlimited basic scans at no cost, making it an obvious minimum security baseline.

### Enhanced Scanning: A Deeper Look

Enhanced scanning, powered by Amazon Inspector, extends vulnerability detection far beyond OS packages. This is where things get genuinely interesting for application developers. While basic scanning focuses on system-level binaries, enhanced scanning analyzes your application dependencies—the npm packages in your Node.js app, the Python pip packages in your ML model, the Maven artifacts in your Java service, the gems in your Ruby application.

When you enable enhanced scanning, ECR leverages Inspector's deeper analysis capabilities to examine package managers and dependency manifests embedded in your image. It parses `package.json` and `package-lock.json` for Node.js, `requirements.txt` and `poetry.lock` for Python, `pom.xml` for Maven projects, `Gemfile.lock` for Ruby, and similar files across other ecosystems. This means it catches vulnerabilities in the libraries your code directly depends on, as well as their transitive dependencies—the packages that your packages depend on.

Think of the practical difference this way: your base image might be perfectly patched at the OS level, but if your Python application requires a vulnerable version of Django or a compromised version of a logging library, basic scanning would never catch it. Enhanced scanning would.

Enhanced scanning is a paid service with a pricing model based on image scans and re-scans. You pay per ECR image scanned, and the cost is modest relative to the security value, typically ranging from a few cents to around a dollar per image depending on your region and usage patterns.

### What Gets Detected: A Practical Breakdown

Let's make this concrete with an example. Suppose you're building a Python web application that uses Flask, and your Dockerfile looks something like this:

```dockerfile
FROM python:3.11-slim

WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt

COPY . .
CMD ["python", "app.py"]
```

Your `requirements.txt` contains:

```
Flask==2.2.0
requests==2.27.1
Jinja2==3.0.3
```

**Basic scanning** will detect vulnerabilities in the base image—the Python runtime itself, system libraries like OpenSSL and libc, standard utilities. If there's a known CVE in Python 3.11-slim or any system package, basic scanning catches it.

**Enhanced scanning** will detect all of that *plus* vulnerabilities in Flask, requests, Jinja2, and critically, all of their transitive dependencies. When you run `pip install -r requirements.txt`, pip pulls down not just these three packages but everything they depend on. Enhanced scanning analyzes that entire dependency tree and flags any known vulnerabilities in any layer.

The difference becomes even more pronounced with multi-language applications. If your image includes a Node.js frontend builder stage alongside Python, or if you're using a polyglot base image, enhanced scanning handles all of it. Basic scanning would only catch OS-level issues.

### The Vulnerability Databases Behind the Scenes

Both scanning modes rely on vulnerability databases, but they use different sources and are updated at different cadences. Basic scanning primarily consults the National Vulnerability Database (NVD) and similar OS-level vulnerability feeds. These databases are comprehensive for OS packages but don't track application-level package vulnerabilities deeply.

Enhanced scanning, via Inspector, consults multiple sources including the NVD, programming language-specific vulnerability databases (like the npm advisory database), GitHub's vulnerability advisories, and other curated feeds. This multi-source approach means enhanced scanning catches vulnerabilities that might be published first in a language-specific forum before they make their way to the NVD.

The update frequency also differs. AWS updates the basic scanning database regularly, but enhanced scanning tends to incorporate new vulnerability data more quickly, sometimes within hours of public disclosure.

### Continuous Re-scanning: The Game Changer

Here's a feature that fundamentally changes how you think about container security: enhanced scanning performs continuous re-scans. This is powerful and worth understanding deeply.

When you enable enhanced scanning on a repository, ECR doesn't just scan images once at push time. Instead, Amazon Inspector continuously re-analyzes your stored images in the background as new vulnerabilities are discovered and added to the vulnerability databases. Imagine you push an image on Monday, and it's clean. On Wednesday, a new CVE is announced affecting a library in your image. With enhanced scanning, you'll automatically be notified of that new vulnerability even though nothing changed in your image.

Basic scanning does *not* provide continuous re-scanning. Once an image is scanned at push time, those results remain static. If a new vulnerability is discovered later, basic scanning won't retroactively flag your image. You'd need to rebuild and re-push the image to trigger a new scan.

This continuous re-scanning is crucial for security compliance and incident response. It means you have a running inventory of your deployed container vulnerabilities, not just a snapshot from when you built them. In regulated industries or organizations with strict security policies, this visibility can be the difference between a routine remediation and an urgent security incident.

### How Findings Flow Into Your Security Tools

Both scanning modes generate findings, but they route to different destinations and integrate differently with your security ecosystem.

Basic scan results are available directly in the ECR console and can be queried via the AWS CLI. You can programmatically retrieve findings for a specific image, but the integration story is more manual. If you want to gate your CI/CD pipeline on basic scan results, you're building custom logic to call the ECR API and evaluate the findings yourself.

Enhanced scan results flow into Amazon Inspector as native findings objects. This is significant because Inspector is AWS's centralized vulnerability management service. Once findings are in Inspector, they're automatically aggregated, correlated, and can be queried with richer context. Inspector findings can be filtered by severity, package type, and CVSS score, and they're available through the Inspector console and API.

More importantly, enhanced scan findings integrate seamlessly with Amazon EventBridge. When a new vulnerability is discovered through enhanced scanning, an event is automatically published to your EventBridge event bus. This opens up powerful automation possibilities. You can create rules that trigger Lambda functions, send notifications to SNS topics, create tickets in Jira, or invoke other AWS services based on finding severity and details.

Imagine you've set a security policy that no container with a critical severity vulnerability should be deployed. With enhanced scanning and EventBridge, you can automatically invoke a Lambda function that revokes the image from your registry, notifies your security team, and creates a remediation ticket, all without human intervention.

### Integrating Scanning Into Your CI/CD Pipeline

For developers building secure pipelines, the question isn't just "which scanning mode should I use?" but "how do I use scan results to enforce security policies?"

Let's build a practical example. Suppose you're using a CI/CD tool like AWS CodePipeline. After building your Docker image and pushing it to ECR, you want to ensure no image with critical vulnerabilities proceeds to the next stage.

With enhanced scanning and EventBridge, you could structure your pipeline like this:

1. Build stage: Create Docker image and push to ECR
2. Scan stage: Enhanced scanning immediately begins (this happens automatically once enabled)
3. Policy enforcement: EventBridge rule detects critical findings and publishes to an SNS topic or invokes a Lambda that halts the pipeline

Here's a conceptual AWS CLI workflow you might use to query enhanced scan findings programmatically:

```bash
aws inspector list-findings \
  --filter-criteria '{
    "resourceType": ["ECR_IMAGE"],
    "severity": ["CRITICAL", "HIGH"]
  }' \
  --region us-east-1
```

This query returns all findings from Inspector for ECR images with critical or high severity. You could embed this in a bash script within your CodePipeline to gate deployment.

For basic scanning, the approach is more direct but requires manual orchestration:

```bash
aws ecr describe-image-scan-findings \
  --repository-name my-app \
  --image-id imageTag=latest \
  --region us-east-1 \
  --query 'imageScanFindings.findings[?severity==`CRITICAL`]'
```

This pulls basic scan findings for a specific image and filters for critical severity. You'd then write logic to decide whether to proceed with deployment.

### Practical Considerations: When to Use Each

The decision between basic and enhanced scanning often comes down to your application architecture and risk tolerance.

**Use basic scanning if:** Your applications are primarily built on well-maintained base images with minimal application-level dependencies, your organization has limited security budgets, or you're just starting your container security journey. Basic scanning is the minimum viable security posture and catches a significant percentage of vulnerabilities in typical applications.

**Use enhanced scanning if:** Your applications heavily rely on third-party packages and libraries (which is nearly all real-world applications), your organization operates under compliance requirements that demand continuous vulnerability monitoring, you need automated responses to new vulnerabilities, or you're running mission-critical workloads where supply chain security is a concern.

Many organizations use both in parallel. They enable enhanced scanning for production-critical images while using basic scanning as a quick check for less critical workloads. This tiered approach balances cost with security needs.

### Building a Comprehensive Security Strategy

Scanning alone isn't sufficient for container security. Think of it as a foundational layer in a broader strategy. Once you've scanned your images and identified vulnerabilities, you need processes for remediation.

For basic scan findings, remediation typically involves updating the base image to a newer patch level. If your Dockerfile uses `FROM ubuntu:22.04`, upgrading to `FROM ubuntu:22.04` with the latest patches might resolve OS-level vulnerabilities.

For enhanced scan findings in application dependencies, remediation might be more nuanced. If a vulnerability exists in an old version of a library you depend on, you have options: update the library to a patched version (preferred), pin a specific patch release if updates would break compatibility, or mitigate the vulnerability through application-level controls if updating isn't feasible.

The continuous re-scanning nature of enhanced scanning actually encourages better remediation practices. Because you'll be notified of new vulnerabilities weeks or months after deployment, you establish a culture of ongoing patching rather than one-time security reviews.

### Integration Patterns and Automation

Let's explore a realistic automation scenario using enhanced scanning with EventBridge and Lambda. Suppose you want to automatically block the deployment of any image with critical vulnerabilities while allowing high and medium severity findings to proceed with approval.

You'd create an EventBridge rule that matches Inspector findings:

```json
{
  "Name": "ECRCriticalVulnerabilityRule",
  "EventPattern": {
    "source": ["aws.inspector"],
    "detail-type": ["Inspector Finding - New"],
    "detail": {
      "severity": ["CRITICAL"],
      "resource": {
        "type": ["ECR_IMAGE"]
      }
    }
  },
  "State": "ENABLED",
  "Targets": [
    {
      "Arn": "arn:aws:lambda:us-east-1:123456789012:function:BlockDeployment",
      "RoleArn": "arn:aws:iam::123456789012:role/EventBridgeRole"
    }
  ]
}
```

Your Lambda function would receive the finding details and take action—perhaps calling the ECR API to untag the image or updating a deployment control system to prevent the image from being used.

### Monitoring and Reporting

Both scanning modes integrate with CloudWatch for monitoring. You can create custom metrics and dashboards to track vulnerability trends in your images over time. For example, you might monitor the total number of images with critical vulnerabilities, the average time from discovery to remediation, or the distribution of vulnerabilities by package type.

Enhanced scanning provides particularly rich data for reporting because Inspector stores all findings historically. You can query Inspector APIs to generate compliance reports showing your organization's vulnerability remediation velocity or to track the effectiveness of your base image updates.

### Common Pitfalls and How to Avoid Them

One common mistake is enabling scanning but not acting on the results. Findings sitting unreviewed in ECR or Inspector don't improve security—they just create audit trail documentation. Build a process for reviewing and remediating findings, whether that's a weekly security team review or automated gating based on severity.

Another pitfall is over-relying on scanning to catch all vulnerabilities. Scanning is fantastic for detecting known vulnerabilities, but it can't catch zero-day exploits or vulnerabilities in your own application code. Combine scanning with runtime security tools, application security testing, and code review practices.

Finally, don't overlook the maintenance burden of base image updates. Even if enhanced scanning shows your application dependencies are all up to date, if your base image is months old, you're accumulating OS-level technical debt. Establish a cadence for rebuilding images with fresh base images, perhaps quarterly or semi-annually.

### Conclusion

ECR's basic and enhanced scanning modes serve complementary but distinct purposes in your container security strategy. Basic scanning provides essential OS-level vulnerability detection at no cost, making it a baseline practice for all ECR users. Enhanced scanning, powered by Amazon Inspector, dramatically extends that protection to application dependencies and adds the crucial capability of continuous re-scanning, enabling you to stay ahead of newly disclosed vulnerabilities throughout your image's lifetime.

The decision between them isn't necessarily binary—most organizations benefit from both, using enhanced scanning for sensitive workloads while leveraging basic scanning as a lightweight check elsewhere. What matters most is understanding what each detects, how findings route into your security toolchain, and how to build automated response mechanisms that actually enforce your security policies.

By integrating these scanning capabilities with EventBridge, Lambda, and your CI/CD pipeline, you transform vulnerability detection from a passive compliance exercise into an active, automated defense mechanism. That's where container security becomes truly effective.
