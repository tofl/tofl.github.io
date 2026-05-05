---
title: "Using ACM Certificates Across Multiple Subdomains: Wildcard and SAN Certificates"
---

## Using ACM Certificates Across Multiple Subdomains: Wildcard and SAN Certificates

Securing multiple subdomains or domains in AWS can quickly become an operational headache if you're not strategic about your certificate management. Imagine launching a microservices architecture with separate domains for your API, CDN, admin panel, and documentation site. Do you really want to manage and renew five different SSL/TLS certificates? The good news is that AWS Certificate Manager (ACM) offers elegant solutions through wildcard certificates and Subject Alternative Name (SAN) certificates—both of which can dramatically simplify your infrastructure while keeping security strong.

In this article, we'll explore how wildcard and SAN certificates work, when to use each approach, and how to make decisions that balance security, cost, and operational efficiency.

### Understanding Certificate Scope: The Foundation

Before we dive into the specifics of wildcards and SANs, let's establish what a standard SSL/TLS certificate protects. When you request a certificate for a specific domain like `api.example.com`, that certificate is valid only for that exact domain name. If you also need to secure `cdn.example.com` or `admin.example.com`, you would traditionally need separate certificates for each one.

This is where the limitations of a one-to-one domain-to-certificate model become apparent. Managing multiple certificates across your infrastructure introduces renewal cycles you need to track, more resources to monitor, and increased complexity in your automation and deployment pipelines. ACM helps you escape this trap through two primary mechanisms.

### Wildcard Certificates: Securing All Subdomains with One Certificate

A wildcard certificate uses an asterisk in the domain name, like `*.example.com`. This single certificate protects the wildcard domain and all subdomains one level deep under it. So `*.example.com` would secure `api.example.com`, `cdn.example.com`, `admin.example.com`, and literally any other subdomain you create under `example.com`—past, present, or future.

The elegance of this approach lies in its simplicity. You request one certificate, you renew one certificate, and you manage one certificate across potentially dozens of subdomains. From an operational perspective, this is a significant win. When you're building out microservices or creating new environments and services, you don't need to worry about acquiring new certificates; your existing wildcard automatically covers everything.

Let's walk through creating a wildcard certificate in ACM. Using the AWS CLI, you would request it like this:

```bash
aws acm request-certificate \
  --domain-name "*.example.com" \
  --validation-method DNS \
  --region us-east-1
```

ACM returns an ARN and validation tokens. If you're using DNS validation (which is recommended for automation), you'll add the provided DNS record to your domain's DNS configuration. Once validated, the certificate is ready for use with your AWS resources like Application Load Balancers, CloudFront distributions, or API Gateway endpoints.

However, wildcard certificates have important limitations you need to understand. A wildcard like `*.example.com` only protects subdomains one level deep. It will secure `api.example.com` but not `v1.api.example.com`. If you need to protect multiple levels of subdomains, you'd need additional certificates or a different approach.

Another critical consideration is the security boundary. If you're concerned about compartmentalization—where you want a compromised certificate for one subdomain to not automatically grant legitimacy to all others—a single wildcard certificate represents a larger blast radius. All your subdomains are, from a certificate perspective, equally trusted by that single private key.

### Subject Alternative Names: One Certificate, Multiple Distinct Domains

Subject Alternative Names (SANs) take a different approach. A SAN certificate contains a primary domain and a list of alternative domain names—all protected by the same certificate and private key. Unlike wildcards, SANs don't use pattern matching; they explicitly list each domain you want to protect.

For example, you might create a SAN certificate that explicitly includes `api.example.com`, `cdn.example.com`, `admin.example.com`, and even `docs.anotherexample.com`. Each domain is named individually on the certificate, and all are equally valid. This is particularly valuable when you need to secure multiple entirely different domains or when your subdomains follow complex naming patterns that don't fit a simple wildcard.

In ACM, creating a certificate with SANs is straightforward. You specify the primary domain and then list the additional domains you want to include:

```bash
aws acm request-certificate \
  --domain-name "api.example.com" \
  --subject-alternative-names "cdn.example.com" "admin.example.com" "docs.example.com" \
  --validation-method DNS \
  --region us-east-1
```

ACM will provide DNS validation records for each domain listed. You add these records to your respective DNS providers, validate them, and you're done. Now a single certificate protects all those explicitly named domains.

One key point: you can add SANs to a certificate request after the fact. If you requested a certificate with three SANs and later realize you need to add a fourth domain, you can't simply modify the existing certificate. ACM requires you to request a new certificate. However, ACM is quite intelligent about managing renewals—when a certificate with SANs automatically renews (which happens every 13 months for ACM certificates), the new certificate maintains all the same domains, so your infrastructure continues to work seamlessly.

### Combining Wildcards and SANs: Maximum Flexibility

Here's a powerful technique many architects don't immediately realize is possible: ACM allows you to combine wildcards and SANs on the same certificate. You could request a certificate with a primary domain of `*.example.com` and add additional SANs like `example.com` (the apex domain) and `cdn.other-example.com`.

This hybrid approach is particularly useful in real-world scenarios. For instance, you might want to protect all subdomains of your primary domain using a wildcard, while also covering a specific subdomain of another domain or the apex domain itself. Apex domain coverage is actually a common need—many users want to protect both `example.com` and `*.example.com` with a single certificate, and combining them as a wildcard plus SAN achieves exactly that.

```bash
aws acm request-certificate \
  --domain-name "*.example.com" \
  --subject-alternative-names "example.com" "cdn.other-example.com" \
  --validation-method DNS \
  --region us-east-1
```

### Security and Operational Trade-offs

When choosing between wildcard and SAN certificates, you're making subtle trade-offs between security posture and operational simplicity. Let's examine these thoughtfully.

A wildcard certificate represents a larger security perimeter. If the private key is ever compromised, an attacker can impersonate any subdomain under that wildcard. For many organizations, this is entirely acceptable—the risk is low if your key management practices are sound and your access controls are tight. However, if you're running applications with significantly different trust levels (say, a public-facing API and an internal admin panel) on the same wildcard, you might sleep better at night with separate certificates.

SAN certificates offer finer-grained control. Each domain listed on the certificate is explicitly intended for that specific service. If one service is compromised, the certificate itself is still only valid for the domains explicitly listed. However, this granularity comes at an operational cost: managing and tracking multiple SAN certificates across a large infrastructure can be more complex than managing a few wildcards.

There's also a practical consideration around certificate rotation and deployment. With a wildcard, you change the certificate in one place (your load balancer or CDN distribution) and all subdomains immediately benefit. With multiple SAN certificates covering overlapping domains, you need to ensure your routing and certificate assignments are precisely correct to avoid serving the wrong certificate to clients.

### Cost Implications and ACM Pricing

Here's encouraging news: AWS Certificate Manager pricing is refreshingly simple. ACM certificates are free. There is no charge to request, manage, or renew certificates in ACM, whether they're simple single-domain certificates, wildcards, or complex SAN certificates with dozens of domains. This is one of the great wins of using ACM over traditional certificate authorities.

The cost savings come from reduced operational overhead and by avoiding the need to purchase multiple separate certificates from external CAs. If you were buying certificates elsewhere at, say, $50–200 per certificate annually, using a single wildcard or a consolidated SAN certificate in ACM immediately saves you thousands of dollars per year.

That said, there are costs associated with the AWS services that use these certificates. If you're terminating TLS connections on an Application Load Balancer, you pay for the load balancer itself, not the certificate. If you're using CloudFront, you pay for data transfer and requests, not the certificate. So the certificate itself is free, but you're paying for the infrastructure it secures.

### Decision Framework: Choosing Your Certificate Strategy

To help you make the right choice for your architecture, here's a practical decision framework:

**Choose a wildcard certificate when:** Your subdomain structure is relatively simple and organized. You have multiple subdomains that all serve similar purposes and trust levels (all microservices, for example). You want to minimize certificate management overhead and don't mind a slightly larger security boundary. You expect to create new subdomains regularly and don't want to think about certificate provisioning each time.

**Choose SAN certificates when:** You need to protect a specific, well-defined set of domains that may not follow a wildcard pattern. You have domains across multiple parent domains (api.example.com and api.otherexample.com). You want explicit, granular control over which domains are covered by which certificates. You need to compartmentalize your security boundaries and would benefit from isolated certificates for different application tiers.

**Choose a hybrid approach (wildcard plus SANs) when:** You have most of your infrastructure following a subdomain pattern but need to explicitly cover a few additional specific domains. You want the operational simplicity of a wildcard for your main domain while extending coverage to edge cases. You need to cover both an apex domain and its subdomains.

### Validation Considerations

Both wildcard and SAN certificates in ACM support two validation methods: DNS validation and email validation. DNS validation is the modern, preferred approach, especially in automated environments. With DNS validation, you add a DNS record provided by ACM to your domain's DNS configuration. This proves you control the domain, and ACM immediately validates it.

For SAN certificates with multiple domains, ACM generates a separate DNS validation record for each domain. You must add all these records to your respective DNS providers. This is straightforward if all your domains are in the same DNS provider, but if you have domains scattered across different registrars or DNS services, coordination is required. Automation tools can help orchestrate this, but it's worth considering when planning your certificate strategy.

Email validation, the older method, sends validation emails to administrative contacts for the domain. This is slower, more manual, and less suitable for automated infrastructure. Avoid it for operational efficiency.

### Practical Integration with AWS Services

Once your certificate is validated in ACM, deploying it across your AWS infrastructure is seamless. You reference the certificate's ARN in your resource configurations.

For an Application Load Balancer, you might configure an HTTPS listener like this:

```bash
aws elbv2 create-listener \
  --load-balancer-arn arn:aws:elasticloadbalancing:region:account:loadbalancer/app/my-alb/... \
  --protocol HTTPS \
  --port 443 \
  --certificates CertificateArn=arn:aws:acm:region:account:certificate/... \
  --default-actions Type=forward,TargetGroupArn=...
```

For CloudFront distributions, you specify the certificate in your distribution configuration:

```bash
aws cloudfront create-distribution \
  --distribution-config '{
    "Enabled": true,
    "ViewerProtocolPolicy": "redirect-to-https",
    "ViewerCertificate": {
      "ACMCertificateArn": "arn:aws:acm:region:account:certificate/...",
      "SSLSupportMethod": "sni-only"
    },
    ...
  }'
```

The same certificate can be used across multiple resources if your domain coverage aligns. A wildcard `*.example.com` certificate, for instance, can protect multiple load balancers each handling different subdomains, or a CloudFront distribution serving multiple origins with different subdomain origins.

### Monitoring and Renewal

ACM handles certificate renewal automatically. Certificates are renewed 60 days before expiration, and the renewal uses the same domains as the original certificate. However, you should still monitor your certificates to ensure everything is working as expected.

You can list and inspect your certificates with the AWS CLI:

```bash
aws acm list-certificates --region us-east-1

aws acm describe-certificate \
  --certificate-arn arn:aws:acm:region:account:certificate/... \
  --region us-east-1
```

The describe command shows you the certificate's status, validation method, domains covered (including SANs), expiration date, and renewal status. Setting up CloudWatch alarms or using AWS Config to monitor certificate expiration dates adds another layer of confidence, though ACM's automatic renewal largely eliminates this concern.

### Real-world Architecture Example

Let's ground this in a real scenario. Imagine you're building a SaaS platform with the following infrastructure:

- A public API at `api.example.com` and `apiv2.example.com`
- A web application at `app.example.com`
- A CDN-fronted asset server at `cdn.example.com`
- A documentation site at `docs.example.com`
- An internal admin panel at `admin.example.com`

One approach would be to request a single wildcard certificate for `*.example.com`. This covers all your subdomains and requires managing exactly one certificate. The downside is that your admin panel and public API share the same certificate, creating a larger trust boundary than strictly necessary.

Alternatively, you could split it into two SAN certificates: one covering `api.example.com`, `apiv2.example.com`, `app.example.com`, and `cdn.example.com` for your public services, and another covering `admin.example.com` and perhaps some other internal services. This provides better security compartmentalization.

Or you could use a wildcard for `*.example.com` plus additional SANs for specific needs, such as if you later need to support `api.partner-domain.com` for third-party integrations.

Each approach is valid; the choice depends on your specific security requirements, operational preferences, and the structure of your domains.

### Conclusion

Wildcard and SAN certificates are powerful tools for managing TLS encryption across multiple domains and subdomains in AWS. Wildcard certificates provide operational simplicity when you have a clear subdomain hierarchy, while SAN certificates offer flexibility and explicit control when your domain landscape is more complex or spans multiple parent domains. The hybrid approach—combining wildcards with additional SANs—gives you the best of both worlds for many real-world scenarios.

The fact that ACM manages certificates for free and handles renewal automatically removes a significant operational burden from your infrastructure. Focus on choosing the certificate strategy that best fits your domain structure and security posture, configure it once with proper DNS validation, and let ACM take care of the rest. Your future self will thank you when you're not scrambling to renew dozens of individual certificates.
