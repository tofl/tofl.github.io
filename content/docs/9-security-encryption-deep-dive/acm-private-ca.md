---
title: "30. ACM / ACM Private CA"
type: docs
weight: 3
---

## ACM / ACM Private CA

TLS certificates are what enable HTTPS — they authenticate your server's identity and encrypt traffic between clients and your application. Without them, browsers display security warnings and connections are unencrypted. The problem they solve sounds simple, but managing certificates manually is error-prone: you have to generate them, validate domain ownership, deploy them to the right services, and renew them before they expire (typically every 13 months). A missed renewal causes an outage. **AWS Certificate Manager (ACM)** [🔗](https://docs.aws.amazon.com/acm/latest/userguide/acm-overview.html) automates all of this — provisioning, validation, deployment, and renewal — at no cost for certificates used with supported AWS services.

### Public Certificates and Domain Validation

When you request a public certificate from ACM, AWS needs to verify that you actually own the domain before issuing it. There are two validation methods:

- **DNS validation** (recommended): ACM gives you a CNAME record to add to your domain's DNS configuration. Once the record is present, ACM can validate the domain automatically and — crucially — renew the certificate automatically before it expires, as long as the CNAME remains in place. If your domain is hosted in Route 53, ACM can insert the record for you in one click.
- **Email validation**: ACM sends a validation email to the registered contacts for the domain (from WHOIS data) and to common administrative addresses like `admin@yourdomain.com`. Someone must click the approval link. This method does **not** support automatic renewal in the same seamless way, because a human has to re-approve each time.

For anything production-facing, DNS validation is the right choice. It removes the human step and keeps renewals fully automated.

### Certificate Auto-Renewal

ACM handles renewal automatically for certificates that are in use with a supported AWS service and have passed DNS validation. ACM begins attempting renewal 60 days before expiry [🔗](https://docs.aws.amazon.com/acm/latest/userguide/managed-renewal.html). You don't need to do anything — the renewed certificate is deployed to the integrated service without downtime. This is the core value proposition: you issue it once and ACM manages the lifecycle indefinitely.

### ACM Integrations

ACM certificates are **not general-purpose files you download and install anywhere**. They can only be deployed directly to specific AWS services that have native ACM integration:

- **Application Load Balancer (ALB)** — the most common pattern. The ALB terminates TLS using the ACM certificate, then forwards plain HTTP to your backend targets. This offloads encryption processing from your application servers.
- **CloudFront** — attach an ACM certificate to a distribution to serve your content over HTTPS. Note that certificates for CloudFront must be provisioned in **us-east-1** (N. Virginia), regardless of where your distribution serves traffic.
- **API Gateway** — attach a certificate to a custom domain name on your API.

Other supported services include Elastic Load Balancing (Classic and Network), AWS App Runner, and CloudFormation-managed resources. [🔗](https://docs.aws.amazon.com/acm/latest/userguide/acm-services.html)

### The Private Key Limitation

This is a frequently tested constraint: **ACM does not allow you to export the private key of a public certificate**. The private key is generated and stored inside ACM, and it never leaves AWS. This is intentional — it prevents the key from being exposed or mishandled.

The practical implication is that you cannot use an ACM public certificate on an EC2 instance, an on-premises server, or any other service that isn't in the ACM integration list above. For those use cases, you need to obtain a certificate from another CA and install it manually, or use ACM Private CA.

### ACM Private CA

**ACM Private CA** [🔗](https://aws.amazon.com/private-ca/) is a separate service that lets you operate your own private certificate authority within AWS. Rather than issuing publicly trusted certificates (the kind browsers recognise), Private CA issues certificates that are trusted only within your organisation — you control the trust chain entirely.

This is useful for internal services that still need TLS but don't have public-facing domain names: microservices communicating inside a VPC, internal APIs, IoT devices, or mTLS (mutual TLS) authentication between services. Because you control the CA, you can also issue certificates with custom validity periods, custom subject fields, and custom extensions that a public CA like ACM wouldn't allow.

Unlike public ACM certificates, **Private CA certificates can be exported** — you receive the certificate and private key, which means you can install them on EC2 instances, containers, or on-premises systems. The trade-off is cost: ACM Private CA has a monthly fee per CA plus a per-certificate charge, whereas public ACM certificates are free for use with integrated services. [🔗](https://aws.amazon.com/private-ca/pricing/)

| | ACM Public Certificates | ACM Private CA |
|---|---|---|
| Trust | Publicly trusted (browsers) | Private / internal only |
| Use with ALB / CloudFront / APIGW | ✅ | ✅ |
| Use on EC2 / on-prem | ❌ | ✅ (exportable) |
| Private key export | ❌ | ✅ |
| Auto-renewal | ✅ | Manual or scripted |
| Cost | Free | Paid per CA + per certificate |