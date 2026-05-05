---
title: "SSL/TLS Termination on ELB with ACM and SNI for Multiple Domains"
---

## SSL/TLS Termination on ELB with ACM and SNI for Multiple Domains

Every developer has felt that moment of anxiety when deploying an application to production and realizing HTTPS isn't properly configured. The good news? AWS makes it remarkably straightforward to implement secure HTTPS communication at scale. The challenge isn't the complexity—it's understanding the moving pieces and how they work together.

SSL/TLS termination at the load balancer is one of the most common architectural patterns in AWS. Rather than managing certificates on individual EC2 instances or containers, you offload that burden to the Elastic Load Balancer, which handles the encrypted connection from clients while you manage just one place: AWS Certificate Manager. Add Server Name Indication (SNI) to the mix, and you can host multiple HTTPS domains on a single listener without the complexity that used to plague system administrators.

This guide walks you through the entire process—from requesting certificates in ACM to configuring SNI for multiple domains, choosing appropriate TLS security policies, and understanding how end-to-end encryption works when you want to extend security all the way to your backend servers.

### Understanding SSL/TLS Termination and Why It Matters

SSL/TLS termination is the process of decrypting incoming HTTPS traffic at the load balancer level, then handling communication with backend instances according to your design. Think of it as a security checkpoint: clients connect securely to the load balancer, which verifies their identity using your certificate, and then the load balancer forwards the request downstream.

This architecture offers several advantages. First, you avoid the computational overhead of encryption and decryption on individual application servers, which can be significant under heavy load. Second, you centralize certificate management—you maintain certificates in one place (ACM) rather than distributing them across dozens of instances. Third, you gain operational flexibility: you can rotate certificates, update security policies, or add new domains without touching application code or redeploying instances.

Without termination, every backend instance would need its own certificate and would bear the cryptographic load. With an Application Load Balancer (ALB) or Network Load Balancer (NLB), you shift that responsibility to infrastructure designed specifically for that task.

### Getting Started with AWS Certificate Manager

AWS Certificate Manager is a managed service that lets you provision, manage, and deploy public and private SSL/TLS certificates. For most applications, you'll work with public certificates, which authenticate your domain to the internet and are trusted by all browsers and clients.

The process begins with requesting a certificate. Navigate to the ACM console and choose "Request a certificate." You'll specify which domain names the certificate should cover. AWS supports both explicit domains (like `api.example.com`) and wildcard certificates (like `*.example.com`). Wildcard certificates are particularly useful if you have multiple subdomains you want to secure with a single certificate.

When you request a certificate, ACM requires you to validate ownership of the domain. You have two primary options: DNS validation and email validation. DNS validation is recommended because it's automated and doesn't require manual action from a domain administrator. With DNS validation, ACM gives you a CNAME record to add to your domain's DNS configuration. Once you add that record, ACM automatically verifies it and issues the certificate. This typically takes a few minutes.

Here's what the DNS validation record looks like. ACM provides you with something like:

```
Name: _abc123.example.com
Type: CNAME
Value: _xyz789.acm-validations.aws.
```

Add this record to your DNS provider's configuration. Once DNS propagates and ACM detects it, your certificate moves to the "Issued" status. From that point forward, ACM handles renewal automatically—typically 60 days before expiration—so you never have to manually refresh the certificate again.

### Requesting Multiple Certificates for SNI

If you need to host multiple domains on a single ALB listener, you have two strategies: include them all on one certificate, or request separate certificates for each domain and use Server Name Indication to serve the appropriate one.

Including multiple domains on a single certificate is the simplest approach when you own or control a small number of domains. You can add multiple Subject Alternative Names (SANs) during the request. For example, you could request a certificate valid for `example.com`, `www.example.com`, `api.example.com`, and `admin.example.com`—all on one certificate. ACM makes validation straightforward: if you choose DNS validation, you receive one validation record that covers all domains.

The separate-certificate approach becomes useful when you have many domains, expect domains to be added or removed frequently, or want to manage certificate lifecycles independently. This is where SNI becomes essential.

### Understanding Server Name Indication (SNI)

Historically, serving multiple HTTPS websites on a single IP address was impossible. The TLS handshake happens before the HTTP request, so the server couldn't know which domain the client wanted until after the certificate was already presented. This was called the "one certificate per IP" limitation.

Server Name Indication solves this elegantly. SNI is a TLS extension that allows the client to specify which hostname it's connecting to during the TLS handshake itself. The server can then present the appropriate certificate for that hostname. Modern browsers and clients have supported SNI for over a decade, making it safe to rely on in production.

On an ALB, SNI works like this: a client connects and says "I'm trying to reach api.example.com." The ALB sees that SNI request, looks up which certificate corresponds to `api.example.com`, and presents that certificate. The handshake completes successfully, and traffic flows normally. If another client connects wanting `admin.example.com`, the ALB presents a different certificate instead.

### Configuring an ALB Listener with HTTPS and Multiple Certificates

Let's walk through the practical configuration. First, ensure you have your certificates ready in ACM. You can have one certificate with multiple SANs, or multiple separate certificates—both work with SNI.

In the ALB configuration, navigate to the "Listeners" section and either create a new HTTPS:443 listener or edit an existing one. Here's what you'll see:

**Protocol and Port**: Set to HTTPS and 443 respectively. If you want to also redirect HTTP traffic to HTTPS (a best practice), create a separate HTTP:80 listener that forwards to HTTPS.

**Default Certificate**: Select one certificate as the default. This is the certificate that gets presented if the client doesn't send an SNI extension, or if the SNI value doesn't match any configured certificate. In practice, almost all modern clients support SNI, but having a default provides a fallback.

**Additional Certificates**: This is where SNI comes in. You can add additional certificates and associate them with specific hostnames. For example, you might add:
- `api.example.com` → certificate-for-api
- `admin.example.com` → certificate-for-admin
- `*.internal.example.com` → wildcard-certificate

The ALB intelligently routes incoming TLS connections based on the SNI extension and serves the appropriate certificate.

To configure this via the AWS CLI, you would create the listener like so:

```bash
aws elbv2 create-listener \
  --load-balancer-arn arn:aws:elasticloadbalancing:region:account-id:loadbalancer/app/name/id \
  --protocol HTTPS \
  --port 443 \
  --certificates CertificateArn=arn:aws:acm:region:account-id:certificate/certificate-id \
  --default-actions Type=forward,TargetGroupArn=arn:aws:elasticloadbalancing:region:account-id:targetgroup/name/id
```

Then add additional certificates with listener rules or directly to the listener:

```bash
aws elbv2 add-listener-certificates \
  --listener-arn arn:aws:elasticloadbalancing:region:account-id:listener/app/name/id/listener-id \
  --certificates CertificateArn=arn:aws:acm:region:account-id:certificate/additional-certificate-id
```

When you add multiple certificates this way, the ALB uses SNI to determine which to present. You can also create listener rules that route based on the hostname and apply different backend target groups if needed, though that's orthogonal to the certificate selection.

### TLS Security Policies and Choosing the Right One

An ALB's TLS security policy defines which TLS versions and ciphers are allowed during the handshake. Think of it as a set of rules that say "I will only accept connections using TLS 1.2 or higher" and "I will only use these specific encryption algorithms."

AWS provides several predefined policies, and they have evolved over time. A typical policy name looks like `ELBSecurityPolicy-TLS-1-2-2017-01`. The policy controls:

**TLS Protocol Versions**: Older versions like TLS 1.0 and 1.1 are cryptographically weak and should be avoided. Modern policies enforce TLS 1.2 as a minimum, with TLS 1.3 support increasingly common. TLS 1.3 is faster and more secure, offering better forward secrecy and reduced latency.

**Cipher Suites**: These are the algorithms used for key exchange, encryption, and authentication. Strong policies prefer AEAD ciphers (Authenticated Encryption with Associated Data) and elliptic curve key exchange over older mechanisms.

**Certificate Signing Algorithms**: Policies specify whether RSA or ECDSA certificates are accepted.

For new deployments, AWS recommends policies that support TLS 1.3, such as `ELBSecurityPolicy-TLS13-1-2-2021-06`. These provide the best security posture and performance. If you have legacy clients that require older TLS versions, you might need a policy like `ELBSecurityPolicy-2016-08`, but this should be temporary and upgraded as soon as possible.

You can view available policies in the console or via CLI:

```bash
aws elbv2 describe-ssl-policies
```

This returns detailed information about each policy, including the TLS versions and ciphers it supports. When you configure a listener, you specify which policy to use. The policy applies to all certificates on that listener.

A practical tip: test your configuration with tools like `openssl` or online SSL checkers to verify that you're using the desired TLS version and that your certificates are correctly presented for each domain.

### Certificate Renewal and Lifecycle Management

One of the biggest wins with ACM is automatic certificate renewal. When you use DNS validation and your certificate is issued, ACM automatically attempts to renew it 60 days before expiration. It uses the same DNS validation method you set up originally, so no manual intervention is needed.

This is a game-changer compared to self-managed certificates, where missing an expiration date can take a service offline. With ACM, certificates simply stay fresh indefinitely, provided your DNS records remain in place.

However, there's an important operational detail: if you change your domain's DNS provider or remove the validation record, ACM won't be able to renew. Monitor your ACM console or set up CloudWatch alarms to watch certificate expiration dates. AWS sends email notifications to your account's root email address when certificates are about to expire, but relying on email alone isn't ideal in a busy organization.

You can view certificate details and their renewal status in the console. If a certificate enters a "Renewal Failed" status, ACM will provide details about why and what action to take—usually, it's to ensure the DNS validation record is still present and resolvable.

### End-to-End Encryption: Extending HTTPS to Backend Instances

So far, we've discussed terminating HTTPS at the ALB—decrypting traffic and then forwarding it to backend instances. But what if your security requirements mandate encryption all the way from the client to the backend? This is where end-to-end encryption comes in.

With an ALB, you have options for how the load balancer communicates with backend targets. The default is unencrypted HTTP. But you can configure the ALB to use HTTPS when forwarding to targets, provided those targets have their own certificates and are listening on HTTPS.

To enable this, you configure the target group's protocol to HTTPS instead of HTTP. The ALB will then establish a fresh TLS connection to each backend instance and forward the request over that encrypted channel. The backend sees an HTTPS request and can decrypt it with its own certificate.

This requires managing certificates on your backend instances, which adds operational overhead—but it provides defense in depth. Even if someone compromised the ALB or the network path to it, they couldn't see the actual traffic flowing to your backends.

In practice, this is less common than simple TLS termination at the ALB, especially when backends are in a private subnet not exposed to untrusted networks. But for highly regulated environments or when you're handling particularly sensitive data, it's a valuable option.

You configure this in the target group settings:

```bash
aws elbv2 modify-target-group \
  --target-group-arn arn:aws:elasticloadbalancing:region:account-id:targetgroup/name/id \
  --protocol HTTPS \
  --port 443
```

The ALB will now use HTTPS to communicate with targets. You can also specify whether to verify the target's certificate (useful if targets have self-signed or internally-signed certificates).

### Practical Example: Multi-Domain Setup

Let's tie this together with a realistic scenario. Imagine you're building a SaaS application with three customer-facing domains: the main application at `app.example.com`, an API at `api.example.com`, and an admin panel at `admin.example.com`. All three should run behind a single ALB for cost efficiency and operational simplicity.

Your setup would look like this:

First, request or import three certificates in ACM (or one certificate with all three domains as SANs). For this example, assume three separate certificates for flexibility:
- Certificate 1: `app.example.com`
- Certificate 2: `api.example.com`
- Certificate 3: `admin.example.com`

All three are validated with DNS records in your Route 53 zone and are now in "Issued" status.

Create your ALB and three target groups—one for the app servers, one for the API servers, and one for admin. Configure them to listen on HTTP:80 (for health checks and backward compatibility) and ensure they respond to their respective paths or headers.

Create an HTTPS:443 listener on the ALB, and set Certificate 1 (`app.example.com`) as the default certificate.

Add listener rules that match based on the hostname and route to the appropriate target group:
- If hostname is `app.example.com`, forward to the app target group
- If hostname is `api.example.com`, forward to the API target group
- If hostname is `admin.example.com`, forward to the admin target group

Add the additional certificates (Certificate 2 and 3) to the listener so the ALB knows to present them for SNI.

When a client connects to `api.example.com`, the ALB's SNI extension handler sees the request, presents Certificate 2, completes the TLS handshake, and then applies the hostname-based listener rule to forward the traffic to the API target group.

This entire setup can be automated with CloudFormation or Terraform, treating your infrastructure as code and making it reproducible and versionable.

### Troubleshooting Common Issues

**Certificate Not Presenting for a Domain**: If clients report certificate errors for a particular domain, verify that the certificate is added to the listener and that its Common Name or SAN matches the domain exactly. SNI matching is case-insensitive and whitespace-sensitive, so `api.example.com` and `API.EXAMPLE.COM` will both match, but `api.example.com ` (with a trailing space) will not.

**TLS Handshake Failures**: Check your security policy. If legacy clients are failing to connect, they might not support TLS 1.2 or the ciphers in your policy. You may need to temporarily use a more permissive policy, but this should be a short-term measure while you upgrade clients.

**Certificate Renewal Failures**: The most common cause is a missing or unreachable DNS validation record. Verify that the validation CNAME is present in your DNS zone and that it resolves. You can check this with `nslookup` or `dig`.

**Mixed Content Errors in Browsers**: If your backend targets return HTTP URLs in links or resources, browsers will block them when accessed over HTTPS (unless your security policy allows it). Ensure your application generates absolute URLs that use HTTPS when served over HTTPS. This is often handled by setting a header like `X-Forwarded-Proto: https` that your application reads.

### Monitoring and Alerting

As your HTTPS infrastructure matures, set up monitoring. CloudWatch metrics on your ALB show the number of ClientTLS* metrics, which can reveal TLS handshake failures. Monitor target health to catch issues where backends become unhealthy.

For certificate lifecycle management, create a CloudWatch alarm that triggers if a certificate is within 30 days of expiration (even though ACM should handle renewal automatically, belt-and-suspenders is wise). Use EventBridge to send notifications to Slack or PagerDuty if certificate validation fails or a listener certificate changes.

This proactive monitoring prevents the scenario where a certificate quietly expires and takes your service offline at an inopportune moment.

### Conclusion

SSL/TLS termination at the load balancer with AWS Certificate Manager is one of the most robust and operationally sound patterns in AWS. By offloading encryption to a managed service, you reduce toil, improve security, and gain flexibility to scale and evolve your infrastructure without managing certificates on individual servers.

Server Name Indication makes it possible to host multiple HTTPS domains on a single listener, multiplying the benefits. Combined with automatic certificate renewal and the flexibility to route requests to different backends based on hostname or path, you have a powerful foundation for building secure, scalable applications.

The key takeaways are straightforward: use DNS validation for certificate issuance, choose a modern TLS security policy that supports TLS 1.3, configure SNI by adding multiple certificates to your listener, and leverage listener rules to route traffic intelligently. Monitor certificate expiration and TLS metrics, and consider end-to-end encryption if your security posture demands it.

As you grow your AWS footprint, this pattern becomes second nature. You'll find yourself provisioning HTTPS listeners with multiple certificates almost reflexively, secure in the knowledge that ACM is handling renewal invisibly and that your clients are getting the certificate they need without any manual intervention on your part. That's the promise of managed services: infrastructure that simply works.
